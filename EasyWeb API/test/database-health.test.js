import { createServer } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("expõe a disponibilidade do MySQL sem tornar a saúde da API dependente dele", async (context) => {
  const app = createApp({
    database: {
      health: async () => ({ status: "unavailable", configured: true })
    }
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  context.after(() => server.close());

  const apiHealth = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  assert.equal(apiHealth.status, 200);

  const databaseHealth = await fetch(`http://127.0.0.1:${port}/api/v1/health/database`);
  assert.equal(databaseHealth.status, 503);
  assert.deepEqual(await databaseHealth.json(), { status: "unavailable", configured: true });
});
