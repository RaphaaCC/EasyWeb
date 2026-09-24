import "dotenv/config";
import { synchronizeDatabaseSchema } from "../handlers/database-schema-handler.js";
import { createApiLogger } from "../handlers/api-logger-handler.js";
import { createMySqlHandler } from "../handlers/mysql-handler.js";

const database = createMySqlHandler();
const logger = createApiLogger();

if (!database.configured) {
  throw new Error("Configure MYSQL_HOST, MYSQL_USER e MYSQL_DATABASE antes de sincronizar o schema.");
}

try {
  const result = await synchronizeDatabaseSchema(database);
  const detail = result.changes.length
    ? `${result.changes.length} alteração(ões) aplicada(s)`
    : "nenhuma alteração necessária";
  logger.info("database.schema.synchronized", {
    version: result.schemaVersion,
    changes: result.changes.length,
    detail
  });
} finally {
  await database.close();
}
