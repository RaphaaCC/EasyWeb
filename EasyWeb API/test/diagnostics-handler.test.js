import assert from "node:assert/strict";
import test from "node:test";
import { createDiagnosticsHandler } from "../src/handlers/diagnostics-handler.js";

function createDatabase() {
  return {
    configured: true,
    health: async () => ({ status: "ok", configured: true }),
    query: async (sql) => {
      if (sql.includes("COUNT(DISTINCT origin_hash)")) {
        return { rows: [{ total: "3", siteCount: "2", payloadBytes: "2048", lastSeenAt: "2026-09-22T12:00:00.000Z" }] };
      }
      if (sql.includes("FROM easyweb_site_snapshots") && sql.includes("page_path")) {
        return { rows: [{ siteOrigin: "https://example.com", pagePath: "/account", captureCount: "2", payloadBytes: "1024", createdAt: "2026-09-22T11:00:00.000Z", lastSeenAt: "2026-09-22T12:00:00.000Z", payload: "must-not-leak" }] };
      }
      if (sql.includes("FROM easyweb_adaptation_families")) {
        return { rows: [{ total: "4", observing: "2", eligible: "1", ready: "1", noOpportunity: "1", averageConfidence: "0.81" }] };
      }
      if (sql.includes("easyweb_adaptation_base_plans")) {
        return { rows: [{ total: "2", active: "1", latestUpdateAt: "2026-09-22T12:05:00.000Z" }] };
      }
      if (sql.includes("GROUP BY state")) {
        return { rows: [{ state: "queued", total: "2" }] };
      }
      if (sql.includes("FROM easyweb_adaptation_jobs")) {
        return { rows: [{ id: "7", siteOrigin: "https://example.com", state: "queued", attempts: "1", similarity: "0.92", runAfter: null, updatedAt: "2026-09-22T12:01:00.000Z", lastError: null }] };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    }
  };
}

test("publica somente métricas e metadados seguros no diagnóstico", async () => {
  const diagnostics = createDiagnosticsHandler({
    database: createDatabase(),
    gemini: { configured: true, model: "gemini-test" },
    now: () => new Date("2026-09-22T12:10:00.000Z")
  });

  const result = await diagnostics.getDiagnostics();

  assert.equal(result.status, "ok");
  assert.equal(result.snapshots.total, 3);
  assert.equal(result.snapshots.latest[0].origin, "https://example.com");
  assert.equal(result.snapshots.latest[0].payload, undefined);
  assert.equal(result.families.observing, 2);
  assert.equal(result.families.averageConfidence, 0.81);
  assert.deepEqual(result.jobs.totals, { queued: 2 });
  assert.equal(result.jobs.latest[0].similarity, 0.92);
});

test("continua seguro quando o banco não está configurado", async () => {
  const diagnostics = createDiagnosticsHandler({ database: { configured: false } });
  const result = await diagnostics.getDiagnostics();

  assert.equal(result.status, "not-configured");
  assert.equal(result.snapshots.total, 0);
  assert.deepEqual(result.jobs.latest, []);
});
