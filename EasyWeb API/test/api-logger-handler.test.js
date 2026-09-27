import assert from "node:assert/strict";
import test from "node:test";
import { createApiLogger } from "../src/handlers/api-logger-handler.js";

test("mantém logs operacionais concisos e remove dados sensíveis do texto", () => {
  const output = [];
  const logger = createApiLogger({
    output: { info: (line) => output.push(line) }
  });

  logger.info("ai.request.queued", {
    type: "personal",
    origin: "https://example.com",
    request: "Aumente os botões para contato@example.com",
    userRequest: "Meu telefone é 11999999999",
    payloadBytes: 120
  });

  assert.equal(output.length, 1);
  assert.match(output[0], /^\[easyweb\] ai\.request\.queued /);
  assert.match(output[0], /type=personal/);
  assert.match(output[0], /request=\[oculto\]/);
  assert.match(output[0], /userRequest=\[oculto\]/);
  assert.match(output[0], /payloadBytes=\[oculto\]/);
  assert.doesNotMatch(output[0], /contato@example\.com/);
  assert.doesNotMatch(output[0], /11999999999/);
});
