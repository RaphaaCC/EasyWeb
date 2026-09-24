import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeDatabaseSchema } from "../src/handlers/database-schema-handler.js";

const TABLE_COLUMNS = {
  easyweb_site_snapshots: [
    "id", "installation_hash", "origin_hash", "path_hash", "template_hash", "content_hash",
    "site_origin", "page_path", "capture_version", "payload_encoding", "payload_bytes", "payload",
    "capture_count", "created_at", "last_seen_at"
  ],
  easyweb_adaptation_families: [
    "id", "origin_hash", "site_origin", "adaptation_hash", "primary_content_hash", "secondary_content_hash",
    "similarity", "status", "sample_count", "distinct_path_count", "installation_count", "stability_score",
    "dynamism_score", "opportunity_score", "confidence_score", "evaluation_reason", "last_evaluated_at",
    "created_at", "last_seen_at"
  ],
  easyweb_adaptation_base_plans: [
    "id", "family_id", "plan_key", "plan_version", "plan_json", "model_name", "prompt_version",
    "status", "expires_at", "created_at", "updated_at"
  ],
  easyweb_adaptation_jobs: [
    "id", "origin_hash", "site_origin", "adaptation_hash", "primary_content_hash", "secondary_content_hash",
    "similarity", "state", "attempts", "run_after", "locked_at", "lock_token", "completed_at",
    "last_error", "created_at", "updated_at"
  ]
};

const TABLE_INDEXES = {
  easyweb_site_snapshots: [
    ["PRIMARY", true, ["id"]],
    ["easyweb_unique_snapshot_page", true, ["installation_hash", "origin_hash", "path_hash", "content_hash"]],
    ["easyweb_snapshot_site_seen", false, ["origin_hash", "last_seen_at"]],
    ["easyweb_snapshot_origin_content", false, ["origin_hash", "content_hash", "last_seen_at"]]
  ],
  easyweb_adaptation_families: [
    ["PRIMARY", true, ["id"]],
    ["easyweb_unique_adaptation_family", true, ["origin_hash", "adaptation_hash"]],
    ["easyweb_adaptation_family_origin_seen", false, ["origin_hash", "last_seen_at"]]
  ],
  easyweb_adaptation_base_plans: [
    ["PRIMARY", true, ["id"]],
    ["easyweb_unique_base_plan_key", true, ["plan_key"]],
    ["easyweb_unique_base_plan_version", true, ["family_id", "plan_version"]],
    ["easyweb_base_plan_family_status", false, ["family_id", "status", "expires_at"]]
  ],
  easyweb_adaptation_jobs: [
    ["PRIMARY", true, ["id"]],
    ["easyweb_unique_adaptation_job", true, ["adaptation_hash"]],
    ["easyweb_adaptation_job_schedule", false, ["state", "run_after", "id"]],
    ["easyweb_adaptation_job_origin", false, ["origin_hash", "updated_at"]]
  ]
};

function rowsForColumns(columns = TABLE_COLUMNS) {
  return Object.entries(columns).flatMap(([tableName, names]) => names.map((columnName) => ({ tableName, columnName })));
}

function rowsForIndexes(indexes = TABLE_INDEXES) {
  return Object.entries(indexes).flatMap(([tableName, definitions]) => definitions.flatMap(([indexName, unique, columns]) =>
    columns.map((columnName, position) => ({
      tableName,
      indexName,
      nonUnique: unique ? 0 : 1,
      sequence: position + 1,
      columnName
    }))
  ));
}

function createDatabase({ columns = TABLE_COLUMNS, indexes = TABLE_INDEXES, obsoleteTables = [] } = {}) {
  const statements = [];
  return {
    configured: true,
    statements,
    query: async (statement, values) => {
      statements.push({ statement, values });
      if (/information_schema\.TABLES/.test(statement)) {
        return { rows: obsoleteTables.map((tableName) => ({ tableName })) };
      }
      if (/information_schema\.COLUMNS/.test(statement)) return { rows: rowsForColumns(columns) };
      if (/information_schema\.STATISTICS/.test(statement)) return { rows: rowsForIndexes(indexes) };
      return { rows: [] };
    }
  };
}

test("não tenta sincronizar MySQL quando ele não foi configurado", async () => {
  const result = await synchronizeDatabaseSchema({ configured: false });
  assert.deepEqual(result, {
    synchronized: false,
    reason: "not-configured",
    schemaVersion: 5,
    tables: [],
    changes: []
  });
});

test("remove somente a tabela legada de matrícula", async () => {
  const database = createDatabase({ obsoleteTables: ["easyweb_installations"] });
  const result = await synchronizeDatabaseSchema(database);

  assert.ok(result.changes.some((change) =>
    change.operation === "drop-obsolete-table" && change.table === "easyweb_installations"));
  assert.ok(database.statements.some(({ statement }) => statement === "DROP TABLE `easyweb_installations`"));
});

test("verifica o schema canônico completo a cada sincronização", async () => {
  const database = createDatabase();
  const result = await synchronizeDatabaseSchema(database);

  assert.deepEqual(result, {
    synchronized: true,
    schemaVersion: 5,
    tables: [
      "easyweb_site_snapshots",
      "easyweb_adaptation_families",
      "easyweb_adaptation_base_plans",
      "easyweb_adaptation_jobs"
    ],
    changes: []
  });
  assert.equal(database.statements.filter(({ statement }) => /CREATE TABLE IF NOT EXISTS easyweb_/.test(statement)).length, 4);
  assert.ok(database.statements.some(({ statement }) => /information_schema\.COLUMNS/.test(statement)));
  assert.ok(database.statements.some(({ statement }) => /information_schema\.STATISTICS/.test(statement)));
  assert.ok(!database.statements.some(({ statement }) => /easyweb_schema_migrations/.test(statement)));
});

test("reconcilia o índice legado de snapshots sem apagar dados", async () => {
  const indexes = {
    ...TABLE_INDEXES,
    easyweb_site_snapshots: [
      ["PRIMARY", true, ["id"]],
      ["easyweb_unique_snapshot", true, ["installation_hash", "origin_hash", "template_hash"]]
    ]
  };
  const database = createDatabase({ indexes });
  const result = await synchronizeDatabaseSchema(database);

  assert.ok(result.changes.some((change) => change.operation === "drop-obsolete-index" && change.name === "easyweb_unique_snapshot"));
  assert.ok(database.statements.some(({ statement }) => /DROP INDEX `easyweb_unique_snapshot`/.test(statement)));
  assert.ok(database.statements.some(({ statement }) => /ADD UNIQUE KEY `easyweb_unique_snapshot_page`/.test(statement)));
  assert.ok(database.statements.some(({ statement }) => /ADD KEY `easyweb_snapshot_origin_content`/.test(statement)));
});

test("adiciona uma coluna ausente conforme o schema canônico", async () => {
  const columns = {
    ...TABLE_COLUMNS,
    easyweb_site_snapshots: TABLE_COLUMNS.easyweb_site_snapshots.filter((column) => column !== "payload")
  };
  const database = createDatabase({ columns });
  const result = await synchronizeDatabaseSchema(database);

  assert.ok(result.changes.some((change) => change.operation === "add-column" && change.name === "payload"));
  assert.ok(database.statements.some(({ statement }) => /ADD COLUMN `payload` LONGBLOB NOT NULL/.test(statement)));
});
