import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { attachWebSocketServer } from "../src/websocket.js";

function waitForMessage(socket, matches) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      const parsed = JSON.parse(message.toString("utf8"));
      if (!matches(parsed)) return;
      socket.off("message", onMessage);
      socket.off("error", onError);
      resolve(parsed);
    };
    const onError = (error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

test("entrega plano base concluido pelo worker aos sockets inscritos", async (context) => {
  let publish;
  const adaptationService = {
    lookup: async () => ({ state: "analyzing-base" }),
    onBasePlan: (listener) => {
      publish = listener;
      return () => { publish = undefined; };
    }
  };
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server, { adaptationService });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);

  context.after(() => {
    socket.close();
    webSocketServer.close();
    server.close();
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const hello = waitForMessage(socket, (message) => message.type === "easyweb:hello");
  socket.send(JSON.stringify({
    type: "easyweb:hello",
    protocolVersion: 1,
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7"
  }));
  await hello;

  const status = waitForMessage(socket, (message) => message.type === "easyweb:adaptation:status");
  socket.send(JSON.stringify({ type: "easyweb:adaptation:lookup", origin: "https://example.com" }));
  assert.equal((await status).state, "analyzing-base");

  const plan = waitForMessage(socket, (message) => message.type === "easyweb:adaptation:base-plan");
  publish({
    origin: "https://example.com",
    plan: { schemaVersion: 1, planScope: "base", planId: "base:example", origin: "https://example.com" }
  });
  assert.equal((await plan).plan.planId, "base:example");
});
