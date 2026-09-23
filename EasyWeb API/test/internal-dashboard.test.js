import { createServer } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

function createDatabase() {
  return {
    configured: true,
    health: async () => ({ status: "ok", configured: true }),
    query: async (sql) => {
      if (sql.includes("COUNT(DISTINCT origin_hash)")) return { rows: [{ total: 0, siteCount: 0, payloadBytes: 0, lastSeenAt: null }] };
      if (sql.includes("easyweb_site_snapshots")) return { rows: [] };
      if (sql.includes("easyweb_adaptation_families")) return { rows: [{ total: 0, observing: 0, eligible: 0, ready: 0, noOpportunity: 0, averageConfidence: 0 }] };
      if (sql.includes("easyweb_adaptation_base_plans")) return { rows: [{ total: 0, active: 0, latestUpdateAt: null }] };
      if (sql.includes("GROUP BY state")) return { rows: [] };
      if (sql.includes("easyweb_adaptation_jobs")) return { rows: [] };
      throw new Error("Consulta inesperada");
    }
  };
}

test("protege as métricas internas com token e mantém a página do painel separada", async (context) => {
  const server = createServer(createApp({
    database: createDatabase(),
    gemini: { configured: false, model: null },
    adminToken: "token-de-teste"
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const root = `http://127.0.0.1:${server.address().port}`;

  const dashboard = await fetch(`${root}/api/v1/internal/dashboard`);
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Monitoramento operacional/);

  const denied = await fetch(`${root}/api/v1/internal/diagnostics`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${root}/api/v1/internal/diagnostics`, {
    headers: { "X-EasyWeb-Admin-Token": "token-de-teste" }
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).status, "ok");
});
