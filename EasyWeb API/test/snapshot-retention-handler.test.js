import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotRetentionHandler } from "../src/handlers/snapshot-retention-handler.js";

function createDatabase({ expired = 0, installation = 0 } = {}) {
  const statements = [];
  return {
    configured: true,
    statements,
    transaction: async (work) => work({
      query: async (statement, values = []) => {
        statements.push({ statement, values });
        if (statement.startsWith("DELETE FROM easyweb_site_snapshots WHERE installation_hash")) return { rows: { affectedRows: installation } };
        if (statement.startsWith("DELETE FROM easyweb_site_snapshots WHERE last_seen_at")) return { rows: { affectedRows: expired } };
        return { rows: { affectedRows: 1 } };
      }
    })
  };
}

test("remove snapshots vencidos em lote e limpa adaptações sem fontes", async () => {
  const database = createDatabase({ expired: 3 });
  const retention = createSnapshotRetentionHandler({
    database,
    retentionDays: 14,
    batchSize: 50,
    now: () => new Date("2026-09-23T12:00:00.000Z")
  });
  const result = await retention.deleteExpiredSnapshots();

  assert.equal(result.deleted, 3);
  assert.equal(result.retentionDays, 14);
  assert.equal(database.statements[0].values[1], 50);
  assert.ok(database.statements.some(({ statement }) => statement.includes("easyweb_adaptation_base_plans")));
  assert.ok(database.statements.some(({ statement }) => statement.includes("easyweb_adaptation_families")));
});

test("remove apenas os snapshots vinculados à instalação solicitante", async () => {
  const database = createDatabase({ installation: 2 });
  const retention = createSnapshotRetentionHandler({ database });
  const result = await retention.deleteInstallationSnapshots(Buffer.alloc(32, 7));

  assert.equal(result.snapshots, 2);
  assert.equal(database.statements[0].values[0].length, 32);
});
