import "dotenv/config";
import { synchronizeDatabaseSchema } from "../handlers/database-schema-handler.js";
import { createMySqlHandler } from "../handlers/mysql-handler.js";

const database = createMySqlHandler();

if (!database.configured) {
  throw new Error("Configure MYSQL_HOST, MYSQL_USER e MYSQL_DATABASE antes de sincronizar o schema.");
}

try {
  const result = await synchronizeDatabaseSchema(database);
  const detail = result.changes.length
    ? `${result.changes.length} alteração(ões) aplicada(s)`
    : "nenhuma alteração necessária";
  console.log(`Schema MySQL v${result.schemaVersion} sincronizado: ${detail}.`);
} finally {
  await database.close();
}
