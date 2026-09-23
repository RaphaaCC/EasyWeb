const SCHEMA_VERSION = 2;

const TABLES = Object.freeze([
  {
    name: "easyweb_site_snapshots",
    createStatement: `CREATE TABLE IF NOT EXISTS easyweb_site_snapshots (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      installation_hash BINARY(32) NOT NULL,
      origin_hash BINARY(32) NOT NULL,
      path_hash BINARY(32) NOT NULL,
      template_hash BINARY(32) NOT NULL,
      content_hash BINARY(32) NOT NULL,
      site_origin VARCHAR(255) NOT NULL,
      page_path VARCHAR(2048) NOT NULL,
      capture_version TINYINT UNSIGNED NOT NULL,
      payload_encoding VARCHAR(16) NOT NULL,
      payload_bytes INT UNSIGNED NOT NULL,
      payload LONGBLOB NOT NULL,
      capture_count INT UNSIGNED NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY easyweb_unique_snapshot_page (installation_hash, origin_hash, path_hash, content_hash),
      KEY easyweb_snapshot_site_seen (origin_hash, last_seen_at),
      KEY easyweb_snapshot_origin_content (origin_hash, content_hash, last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    columns: [
      ["id", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT"],
      ["installation_hash", "BINARY(32) NOT NULL"],
      ["origin_hash", "BINARY(32) NOT NULL"],
      ["path_hash", "BINARY(32) NOT NULL"],
      ["template_hash", "BINARY(32) NOT NULL"],
      ["content_hash", "BINARY(32) NOT NULL"],
      ["site_origin", "VARCHAR(255) NOT NULL"],
      ["page_path", "VARCHAR(2048) NOT NULL"],
      ["capture_version", "TINYINT UNSIGNED NOT NULL"],
      ["payload_encoding", "VARCHAR(16) NOT NULL"],
      ["payload_bytes", "INT UNSIGNED NOT NULL"],
      ["payload", "LONGBLOB NOT NULL"],
      ["capture_count", "INT UNSIGNED NOT NULL DEFAULT 1"],
      ["created_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ["last_seen_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
    ],
    primaryKey: ["id"],
    indexes: [
      { name: "easyweb_unique_snapshot_page", unique: true, columns: ["installation_hash", "origin_hash", "path_hash", "content_hash"] },
      { name: "easyweb_snapshot_site_seen", unique: false, columns: ["origin_hash", "last_seen_at"] },
      { name: "easyweb_snapshot_origin_content", unique: false, columns: ["origin_hash", "content_hash", "last_seen_at"] }
    ],
    obsoleteIndexes: ["easyweb_unique_snapshot"]
  },
  {
    name: "easyweb_adaptation_families",
    createStatement: `CREATE TABLE IF NOT EXISTS easyweb_adaptation_families (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      origin_hash BINARY(32) NOT NULL,
      site_origin VARCHAR(255) NOT NULL,
      adaptation_hash BINARY(32) NOT NULL,
      primary_content_hash BINARY(32) NOT NULL,
      secondary_content_hash BINARY(32) NOT NULL,
      similarity DECIMAL(6,5) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'ready',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY easyweb_unique_adaptation_family (origin_hash, adaptation_hash),
      KEY easyweb_adaptation_family_origin_seen (origin_hash, last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    columns: [
      ["id", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT"],
      ["origin_hash", "BINARY(32) NOT NULL"],
      ["site_origin", "VARCHAR(255) NOT NULL"],
      ["adaptation_hash", "BINARY(32) NOT NULL"],
      ["primary_content_hash", "BINARY(32) NOT NULL"],
      ["secondary_content_hash", "BINARY(32) NOT NULL"],
      ["similarity", "DECIMAL(6,5) NOT NULL"],
      ["status", "VARCHAR(32) NOT NULL DEFAULT 'ready'"],
      ["created_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ["last_seen_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
    ],
    primaryKey: ["id"],
    indexes: [
      { name: "easyweb_unique_adaptation_family", unique: true, columns: ["origin_hash", "adaptation_hash"] },
      { name: "easyweb_adaptation_family_origin_seen", unique: false, columns: ["origin_hash", "last_seen_at"] }
    ],
    obsoleteIndexes: []
  },
  {
    name: "easyweb_adaptation_base_plans",
    createStatement: `CREATE TABLE IF NOT EXISTS easyweb_adaptation_base_plans (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      family_id BIGINT UNSIGNED NOT NULL,
      plan_key VARCHAR(180) NOT NULL,
      plan_version INT UNSIGNED NOT NULL,
      plan_json LONGTEXT NOT NULL,
      model_name VARCHAR(120) NOT NULL,
      prompt_version VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY easyweb_unique_base_plan_key (plan_key),
      UNIQUE KEY easyweb_unique_base_plan_version (family_id, plan_version),
      KEY easyweb_base_plan_family_status (family_id, status, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    columns: [
      ["id", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT"],
      ["family_id", "BIGINT UNSIGNED NOT NULL"],
      ["plan_key", "VARCHAR(180) NOT NULL"],
      ["plan_version", "INT UNSIGNED NOT NULL"],
      ["plan_json", "LONGTEXT NOT NULL"],
      ["model_name", "VARCHAR(120) NOT NULL"],
      ["prompt_version", "VARCHAR(32) NOT NULL"],
      ["status", "VARCHAR(32) NOT NULL DEFAULT 'active'"],
      ["expires_at", "DATETIME NOT NULL"],
      ["created_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ["updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
    ],
    primaryKey: ["id"],
    indexes: [
      { name: "easyweb_unique_base_plan_key", unique: true, columns: ["plan_key"] },
      { name: "easyweb_unique_base_plan_version", unique: true, columns: ["family_id", "plan_version"] },
      { name: "easyweb_base_plan_family_status", unique: false, columns: ["family_id", "status", "expires_at"] }
    ],
    obsoleteIndexes: []
  },
  {
    name: "easyweb_adaptation_jobs",
    createStatement: `CREATE TABLE IF NOT EXISTS easyweb_adaptation_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      origin_hash BINARY(32) NOT NULL,
      site_origin VARCHAR(255) NOT NULL,
      adaptation_hash BINARY(32) NOT NULL,
      primary_content_hash BINARY(32) NOT NULL,
      secondary_content_hash BINARY(32) NOT NULL,
      similarity DECIMAL(6,5) NOT NULL,
      state VARCHAR(16) NOT NULL DEFAULT 'queued',
      attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      run_after DATETIME NOT NULL,
      locked_at DATETIME NULL,
      lock_token BINARY(16) NULL,
      completed_at DATETIME NULL,
      last_error VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY easyweb_unique_adaptation_job (adaptation_hash),
      KEY easyweb_adaptation_job_schedule (state, run_after, id),
      KEY easyweb_adaptation_job_origin (origin_hash, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    columns: [
      ["id", "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT"],
      ["origin_hash", "BINARY(32) NOT NULL"],
      ["site_origin", "VARCHAR(255) NOT NULL"],
      ["adaptation_hash", "BINARY(32) NOT NULL"],
      ["primary_content_hash", "BINARY(32) NOT NULL"],
      ["secondary_content_hash", "BINARY(32) NOT NULL"],
      ["similarity", "DECIMAL(6,5) NOT NULL"],
      ["state", "VARCHAR(16) NOT NULL DEFAULT 'queued'"],
      ["attempts", "TINYINT UNSIGNED NOT NULL DEFAULT 0"],
      ["run_after", "DATETIME NOT NULL"],
      ["locked_at", "DATETIME NULL"],
      ["lock_token", "BINARY(16) NULL"],
      ["completed_at", "DATETIME NULL"],
      ["last_error", "VARCHAR(500) NULL"],
      ["created_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"],
      ["updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
    ],
    primaryKey: ["id"],
    indexes: [
      { name: "easyweb_unique_adaptation_job", unique: true, columns: ["adaptation_hash"] },
      { name: "easyweb_adaptation_job_schedule", unique: false, columns: ["state", "run_after", "id"] },
      { name: "easyweb_adaptation_job_origin", unique: false, columns: ["origin_hash", "updated_at"] }
    ],
    obsoleteIndexes: []
  }
]);

const TABLE_NAMES = TABLES.map(({ name }) => name);

function quoteIdentifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_]+$/.test(value)) {
    throw new TypeError("Identificador de schema MySQL inválido.");
  }
  return `\`${value}\``;
}

function indexMatches(index, expected) {
  return Boolean(index) &&
    index.unique === expected.unique &&
    index.columns.length === expected.columns.length &&
    index.columns.every((column, position) => column === expected.columns[position]);
}

function groupColumns(rows) {
  const columnsByTable = new Map(TABLE_NAMES.map((name) => [name, new Set()]));
  for (const row of rows || []) {
    const columns = columnsByTable.get(row.tableName);
    if (columns && typeof row.columnName === "string") columns.add(row.columnName);
  }
  return columnsByTable;
}

function groupIndexes(rows) {
  const indexesByTable = new Map(TABLE_NAMES.map((name) => [name, new Map()]));
  for (const row of rows || []) {
    const indexes = indexesByTable.get(row.tableName);
    if (!indexes || typeof row.indexName !== "string" || typeof row.columnName !== "string") continue;
    const index = indexes.get(row.indexName) || {
      unique: Number(row.nonUnique) === 0,
      columns: []
    };
    index.columns[Number(row.sequence) - 1] = row.columnName;
    indexes.set(row.indexName, index);
  }
  return indexesByTable;
}

async function readColumns(database) {
  const placeholders = TABLE_NAMES.map(() => "?").join(", ");
  const result = await database.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
    TABLE_NAMES
  );
  return groupColumns(result.rows);
}

async function readIndexes(database) {
  const placeholders = TABLE_NAMES.map(() => "?").join(", ");
  const result = await database.query(
    `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
            SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    TABLE_NAMES
  );
  return groupIndexes(result.rows);
}

async function ensurePrimaryKey(database, table, existingIndexes, changes) {
  const primaryKey = { unique: true, columns: table.primaryKey };
  const existing = existingIndexes.get("PRIMARY");
  if (!existing) {
    await database.query(
      `ALTER TABLE ${quoteIdentifier(table.name)} ADD PRIMARY KEY (${table.primaryKey.map(quoteIdentifier).join(", ")})`
    );
    changes.push({ table: table.name, operation: "add-primary-key", name: "PRIMARY" });
    return;
  }
  if (!indexMatches(existing, primaryKey)) {
    throw new Error(`A chave primária existente em ${table.name} não corresponde ao schema EasyWeb.`);
  }
}

async function ensureColumns(database, table, currentColumns, changes) {
  for (const [name, definition] of table.columns) {
    if (currentColumns.has(name)) continue;
    await database.query(
      `ALTER TABLE ${quoteIdentifier(table.name)} ADD COLUMN ${quoteIdentifier(name)} ${definition}`
    );
    changes.push({ table: table.name, operation: "add-column", name });
  }
}

async function ensureIndexes(database, table, currentIndexes, changes) {
  for (const name of table.obsoleteIndexes) {
    if (!currentIndexes.has(name)) continue;
    await database.query(`ALTER TABLE ${quoteIdentifier(table.name)} DROP INDEX ${quoteIdentifier(name)}`);
    changes.push({ table: table.name, operation: "drop-obsolete-index", name });
  }

  for (const expected of table.indexes) {
    const existing = currentIndexes.get(expected.name);
    if (indexMatches(existing, expected)) continue;
    if (existing) {
      await database.query(`ALTER TABLE ${quoteIdentifier(table.name)} DROP INDEX ${quoteIdentifier(expected.name)}`);
      changes.push({ table: table.name, operation: "replace-index", name: expected.name });
    }
    const uniqueness = expected.unique ? "UNIQUE " : "";
    const columns = expected.columns.map(quoteIdentifier).join(", ");
    await database.query(
      `ALTER TABLE ${quoteIdentifier(table.name)} ADD ${uniqueness}KEY ${quoteIdentifier(expected.name)} (${columns})`
    );
    changes.push({ table: table.name, operation: "add-index", name: expected.name });
  }
}

export async function synchronizeDatabaseSchema(database) {
  if (!database?.configured) {
    return { synchronized: false, reason: "not-configured", schemaVersion: SCHEMA_VERSION, tables: [], changes: [] };
  }

  for (const table of TABLES) {
    await database.query(table.createStatement);
  }

  const changes = [];
  const columnsByTable = await readColumns(database);
  for (const table of TABLES) {
    await ensureColumns(database, table, columnsByTable.get(table.name), changes);
  }

  const indexesByTable = await readIndexes(database);
  for (const table of TABLES) {
    const indexes = indexesByTable.get(table.name);
    await ensurePrimaryKey(database, table, indexes, changes);
    await ensureIndexes(database, table, indexes, changes);
  }

  return {
    synchronized: true,
    schemaVersion: SCHEMA_VERSION,
    tables: TABLE_NAMES,
    changes
  };
}
