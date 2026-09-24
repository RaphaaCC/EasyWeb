import assert from "node:assert/strict";
import test from "node:test";
import { createAiRequestQueue } from "../src/handlers/ai-request-queue-handler.js";

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test("processa uma solicitação pessoal antes dos próximos trabalhos de fundo", async () => {
  const events = [];
  const queue = createAiRequestQueue({
    logger: { info: (event, fields) => events.push({ event, fields }) }
  });
  const gate = deferred();
  const order = [];

  const firstBase = queue.enqueue({
    type: "base",
    origin: "https://example.com",
    execute: async () => {
      order.push("base-1");
      await gate.promise;
      return { siteScript: { steps: [{ preset: "focus-ring" }] } };
    }
  });
  await Promise.resolve();
  const secondBase = queue.enqueue({
    type: "base",
    origin: "https://example.com",
    execute: async () => {
      order.push("base-2");
      return { siteScript: { steps: [] } };
    }
  });
  const personal = queue.enqueue({
    type: "personal",
    origin: "https://example.com",
    request: "Aumente o tamanho dos botões",
    execute: async () => {
      order.push("personal");
      return { siteScript: { steps: [{ preset: "large-controls" }] } };
    }
  });

  gate.resolve();
  await Promise.all([firstBase, secondBase, personal]);

  assert.deepEqual(order, ["base-1", "personal", "base-2"]);
  assert.equal(events.some((entry) => entry.event === "ai.request.queued" &&
    entry.fields.type === "personal" && entry.fields.request === "Aumente o tamanho dos botões"), true);
  assert.equal(events.some((entry) => entry.event === "ai.request.completed" &&
    entry.fields.type === "personal" && entry.fields.steps === 1), true);
});

test("limita trabalhos aguardando sem interromper o trabalho ativo", async () => {
  const gate = deferred();
  const events = [];
  const queue = createAiRequestQueue({
    maxBaseWaiting: 1,
    logger: { warn: (event, fields) => events.push({ event, fields }) }
  });

  const active = queue.enqueue({ type: "base", execute: () => gate.promise });
  await Promise.resolve();
  const waiting = queue.enqueue({ type: "base", execute: async () => ({}) });
  await assert.rejects(
    queue.enqueue({ type: "base", execute: async () => ({}) }),
    (error) => error.code === "EASYWEB_AI_QUEUE_FULL" && error.retryable === true
  );

  gate.resolve({});
  await Promise.all([active, waiting]);
  assert.equal(events.some((entry) => entry.event === "ai.request.rejected" && entry.fields.reason === "queue-full"), true);
});
