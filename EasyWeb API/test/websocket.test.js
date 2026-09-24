import { createServer } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { attachWebSocketServer } from "../src/websocket.js";

function waitForMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", (message) => resolve(JSON.parse(message.toString("utf8"))));
    socket.once("error", reject);
  });
}

function waitForMatchingMessage(socket, matches) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      const parsed = JSON.parse(message.toString("utf8"));
      if (matches(parsed)) {
        socket.off("message", onMessage);
        socket.off("error", onError);
        resolve(parsed);
      }
    };
    const onError = (error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
  });
}

test("aceita hello e responde ao heartbeat pelo WebSocket", async (context) => {
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);

  context.after(() => {
    socket.close();
    webSocketServer.close();
    server.close();
  });

  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  socket.send(JSON.stringify({
    type: "easyweb:hello",
    protocolVersion: 1,
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7"
  }));
  assert.equal((await waitForMessage(socket)).type, "easyweb:hello");

  socket.send(JSON.stringify({ type: "easyweb:ping" }));
  assert.equal((await waitForMessage(socket)).type, "easyweb:pong");
});

test("exige handshake antes de responder a heartbeat", async (context) => {
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server);
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

  const closed = new Promise((resolve) => socket.once("close", (code) => resolve(code)));
  socket.send(JSON.stringify({ type: "easyweb:ping" }));
  assert.equal(await closed, 1008);
});

test("recusa conexões WebSocket iniciadas por páginas Web", async (context) => {
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => {
    webSocketServer.close();
    server.close();
  });

  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, {
    origin: "https://example.com"
  });
  const outcome = await new Promise((resolve) => {
    socket.once("open", () => resolve("opened"));
    socket.once("error", () => resolve("rejected"));
  });

  assert.equal(outcome, "rejected");
});

test("remove somente os snapshots identificados pela instalação da conexão", async (context) => {
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server, {
    snapshotStore: {
      deleteForInstallation: async ({ installationId }) => ({ snapshots: installationId === "ca5ce777-31e1-4892-b93c-9d282b0732f7" ? 2 : 0, plans: 1, families: 1, jobs: 0 })
    }
  });
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
  socket.send(JSON.stringify({
    type: "easyweb:hello",
    protocolVersion: 1,
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7"
  }));
  await waitForMessage(socket);

  const reply = waitForMatchingMessage(socket, (message) => message.type === "easyweb:privacy:snapshots-deleted");
  socket.send(JSON.stringify({ type: "easyweb:privacy:delete-snapshots", requestId: "ca5ce777-31e1-4892-b93c-9d282b0732f7" }));
  assert.deepEqual(await reply, {
    type: "easyweb:privacy:snapshots-deleted",
    requestId: "ca5ce777-31e1-4892-b93c-9d282b0732f7",
    snapshots: 2,
    plans: 1,
    families: 1,
    jobs: 0
  });
});

test("encaminha snapshots estruturais após o handshake", async (context) => {
  const stored = [];
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server, {
    snapshotStore: {
      store: async (payload) => {
        stored.push(payload);
        return {
          page: { origin: "https://example.com", path: "/" },
          contentHash: "a".repeat(64),
          templateHash: "b".repeat(64),
          payloadBytes: 120
        };
      }
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);

  context.after(() => {
    socket.close();
    webSocketServer.close();
    server.close();
  });

  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({
    type: "easyweb:hello",
    protocolVersion: 1,
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7"
  }));
  await waitForMessage(socket);

  socket.send(JSON.stringify({
    type: "easyweb:mapping:snapshot",
    snapshotId: "ca5ce777-31e1-4892-b93c-9d282b0732f7",
    snapshot: {
      captureVersion: 1,
      page: { origin: "https://example.com", path: "/" },
      structure: { tree: { tag: "main" } },
      html: "<html><body><main></main></body></html>",
      css: "main { color: black; }",
      styles: {},
      scripts: {}
    }
  }));

  const reply = await waitForMessage(socket);
  assert.equal(reply.type, "easyweb:mapping:stored");
  assert.equal(reply.snapshotId, "ca5ce777-31e1-4892-b93c-9d282b0732f7");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].snapshot.page.origin, "https://example.com");
});

test("marca uma falha definitiva ao armazenar o snapshot como nao reenviavel", async (context) => {
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server, {
    snapshotStore: {
      store: async () => {
        throw Object.assign(new Error("Snapshot invalido."), { code: "EASYWEB_INVALID_SNAPSHOT" });
      }
    }
  });
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
  socket.send(JSON.stringify({
    type: "easyweb:hello",
    protocolVersion: 1,
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7"
  }));
  await waitForMessage(socket);

  const rejection = waitForMatchingMessage(socket, (message) => message.type === "easyweb:mapping:rejected");
  socket.send(JSON.stringify({
    type: "easyweb:mapping:snapshot",
    snapshotId: "ca5ce777-31e1-4892-b93c-9d282b0732f7",
    snapshot: { captureVersion: 1, page: { origin: "https://example.com", path: "/" } }
  }));

  const reply = await rejection;
  assert.equal(reply.snapshotId, "ca5ce777-31e1-4892-b93c-9d282b0732f7");
  assert.equal(reply.retryable, false);
});

test("entrega o plano base depois de confirmar o snapshot", async (context) => {
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server, {
    snapshotStore: {
      store: async () => ({
        page: { origin: "https://example.com", path: "/" },
        contentHash: "a".repeat(64),
        templateHash: "b".repeat(64),
        payloadBytes: 120
      })
    },
    adaptationService: {
      considerSnapshot: async () => ({
        state: "ready",
        plan: { schemaVersion: 1, planScope: "base", planId: "base:example", origin: "https://example.com" }
      })
    }
  });
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
  socket.send(JSON.stringify({
    type: "easyweb:hello",
    protocolVersion: 1,
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7"
  }));
  await waitForMessage(socket);

  const storedReply = waitForMatchingMessage(socket, (message) => message.type === "easyweb:mapping:stored");
  const planReply = waitForMatchingMessage(socket, (message) => message.type === "easyweb:adaptation:base-plan");
  socket.send(JSON.stringify({
    type: "easyweb:mapping:snapshot",
    snapshotId: "ca5ce777-31e1-4892-b93c-9d282b0732f7",
    snapshot: { captureVersion: 1, page: { origin: "https://example.com", path: "/" } }
  }));

  assert.equal((await storedReply).type, "easyweb:mapping:stored");
  assert.equal((await planReply).plan.planId, "base:example");
});

test("entrega pedidos pessoais apenas como resposta transitória do WebSocket", async (context) => {
  const calls = [];
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server, {
    adaptationService: {
      createPersonalPlan: async (payload) => {
        calls.push(payload);
        return {
          state: "ready",
          plan: { schemaVersion: 1, planScope: "personal", planId: "personal:example", origin: "https://example.com" }
        };
      }
    }
  });
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
  socket.send(JSON.stringify({
    type: "easyweb:hello",
    protocolVersion: 1,
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7"
  }));
  await waitForMessage(socket);

  const queued = waitForMatchingMessage(socket, (message) =>
    message.type === "easyweb:adaptation:personal-status" && message.state === "queued"
  );
  const reply = waitForMatchingMessage(socket, (message) => message.type === "easyweb:adaptation:personal-plan");
  socket.send(JSON.stringify({
    type: "easyweb:adaptation:personal-request",
    requestId: "ca5ce777-31e1-4892-b93c-9d282b0732f7",
    origin: "https://example.com",
    snapshot: { captureVersion: 1, page: { origin: "https://example.com", path: "/" } },
    profile: "elderly",
    userRequest: { text: "Não consigo ler" }
  }));

  assert.equal((await queued).requestId, "ca5ce777-31e1-4892-b93c-9d282b0732f7");
  assert.equal((await reply).plan.planScope, "personal");
  assert.equal(calls[0].installationId, "ca5ce777-31e1-4892-b93c-9d282b0732f7");
  assert.equal(calls[0].profile, "elderly");
  assert.equal(calls[0].basePlanId, undefined);

  const throttled = waitForMatchingMessage(socket, (message) =>
    message.type === "easyweb:adaptation:personal-status" && message.state === "rate-limited"
  );
  socket.send(JSON.stringify({
    type: "easyweb:adaptation:personal-request",
    requestId: "3c5ce777-31e1-4892-b93c-9d282b0732f7",
    origin: "https://example.com",
    snapshot: { captureVersion: 1, page: { origin: "https://example.com", path: "/" } },
    profile: "elderly",
    userRequest: { text: "Preciso de outro ajuste" }
  }));
  assert.equal((await throttled).state, "rate-limited");
  assert.equal(calls.length, 1);
});

test("nao inicia duas analises para o mesmo pedido pessoal em andamento", async (context) => {
  const calls = [];
  let resolvePlan;
  const pendingPlan = new Promise((resolve) => {
    resolvePlan = resolve;
  });
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server, {
    adaptationService: {
      createPersonalPlan: async (payload) => {
        calls.push(payload);
        return pendingPlan;
      }
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const firstSocket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  const secondSocket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);

  context.after(() => {
    firstSocket.close();
    secondSocket.close();
    webSocketServer.close();
    server.close();
  });
  await Promise.all([firstSocket, secondSocket].map((socket) => new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  })));
  const hello = JSON.stringify({
    type: "easyweb:hello",
    protocolVersion: 1,
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7"
  });
  firstSocket.send(hello);
  secondSocket.send(hello);
  await Promise.all([waitForMessage(firstSocket), waitForMessage(secondSocket)]);

  const request = {
    type: "easyweb:adaptation:personal-request",
    requestId: "ca5ce777-31e1-4892-b93c-9d282b0732f7",
    origin: "https://example.com",
    snapshot: { captureVersion: 1, page: { origin: "https://example.com", path: "/" } },
    profile: "elderly",
    userRequest: { text: "Preciso de letras maiores" }
  };
  const reply = waitForMatchingMessage(secondSocket, (message) => message.type === "easyweb:adaptation:personal-plan");
  firstSocket.send(JSON.stringify(request));
  secondSocket.send(JSON.stringify(request));

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  resolvePlan({
    state: "ready",
    plan: { schemaVersion: 1, planScope: "personal", planId: "personal:example", origin: "https://example.com" }
  });
  assert.equal((await reply).plan.planId, "personal:example");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const replay = waitForMatchingMessage(secondSocket, (message) => message.type === "easyweb:adaptation:personal-plan");
  secondSocket.send(JSON.stringify(request));
  assert.equal((await replay).plan.planId, "personal:example");
  assert.equal(calls.length, 1);
});

test("informa uma falha temporária do Gemini no pedido pessoal", async (context) => {
  const server = createServer(createApp());
  const webSocketServer = attachWebSocketServer(server, {
    adaptationService: {
      createPersonalPlan: async () => {
        throw Object.assign(new Error("Tempo esgotado."), { code: "EASYWEB_GEMINI_TIMEOUT", retryable: true });
      }
    }
  });
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
  socket.send(JSON.stringify({
    type: "easyweb:hello",
    protocolVersion: 1,
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7"
  }));
  await waitForMessage(socket);

  const failure = waitForMatchingMessage(socket, (message) =>
    message.type === "easyweb:adaptation:personal-status" &&
    message.state === "model-temporarily-unavailable"
  );
  socket.send(JSON.stringify({
    type: "easyweb:adaptation:personal-request",
    requestId: "fa5ce777-31e1-4892-b93c-9d282b0732f7",
    origin: "https://example.com",
    snapshot: { captureVersion: 1, page: { origin: "https://example.com", path: "/" } },
    profile: "default",
    userRequest: { text: "Aumente os botões" }
  }));

  const reply = await failure;
  assert.equal(reply.reason, "A IA demorou para responder ou está temporariamente indisponível. Tente novamente em alguns instantes.");
});
