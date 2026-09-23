import mysql from "mysql2/promise";

const DEFAULT_CONNECTION_LIMIT = 10;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isEnabled(value) {
  return String(value).trim().toLowerCase() === "true" || String(value).trim() === "1";
}

function createUnavailableError(message) {
  const error = new Error(message);
  error.code = "EASYWEB_DATABASE_UNAVAILABLE";
  return error;
}

export function readMySqlConfiguration(environment = process.env) {
  const required = {
    host: environment.MYSQL_HOST,
    user: environment.MYSQL_USER,
    database: environment.MYSQL_DATABASE
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => `MYSQL_${key.toUpperCase()}`);

  if (missing.length > 0) {
    return { configured: false, missing };
  }

  const sslEnabled = isEnabled(environment.MYSQL_SSL);
  return {
    configured: true,
    poolOptions: {
      host: required.host.trim(),
      port: readPositiveInteger(environment.MYSQL_PORT, 3306),
      user: required.user.trim(),
      password: environment.MYSQL_PASSWORD || "",
      database: required.database.trim(),
      waitForConnections: true,
      connectionLimit: readPositiveInteger(environment.MYSQL_CONNECTION_LIMIT, DEFAULT_CONNECTION_LIMIT),
      queueLimit: 0,
      connectTimeout: readPositiveInteger(environment.MYSQL_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS),
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      ...(sslEnabled
        ? { ssl: { rejectUnauthorized: !String(environment.MYSQL_SSL_REJECT_UNAUTHORIZED).trim().toLowerCase().includes("false") } }
        : {})
    }
  };
}

export function createMySqlHandler({ environment = process.env, client = mysql } = {}) {
  const configuration = readMySqlConfiguration(environment);
  let pool;

  function getPool() {
    if (!configuration.configured) {
      throw createUnavailableError(`MySQL não configurado. Variáveis ausentes: ${configuration.missing.join(", ")}.`);
    }

    pool ??= client.createPool(configuration.poolOptions);
    return pool;
  }

  async function query(statement, values = []) {
    if (typeof statement !== "string" || !statement.trim()) {
      throw new TypeError("A consulta MySQL deve ser uma string não vazia.");
    }

    const [rows, fields] = await getPool().execute(statement, values);
    return { rows, fields };
  }

  async function transaction(work) {
    if (typeof work !== "function") {
      throw new TypeError("Uma transação MySQL exige uma função de trabalho.");
    }

    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const result = await work({
        query: async (statement, values = []) => {
          const [rows, fields] = await connection.execute(statement, values);
          return { rows, fields };
        }
      });
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original database failure for the caller.
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function health() {
    if (!configuration.configured) {
      return { status: "not-configured", configured: false };
    }

    try {
      await query("SELECT 1 AS connected");
      return { status: "ok", configured: true };
    } catch (error) {
      return { status: "unavailable", configured: true };
    }
  }

  async function close() {
    if (pool) {
      await pool.end();
      pool = undefined;
    }
  }

  return Object.freeze({
    configured: configuration.configured,
    query,
    transaction,
    health,
    close
  });
}
