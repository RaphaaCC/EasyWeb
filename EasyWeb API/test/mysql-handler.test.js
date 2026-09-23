import assert from "node:assert/strict";
import test from "node:test";
import { createMySqlHandler, readMySqlConfiguration } from "../src/handlers/mysql-handler.js";

test("mantém MySQL desativado quando faltam credenciais essenciais", async () => {
  const database = createMySqlHandler({ environment: {} });

  assert.equal(database.configured, false);
  assert.deepEqual(await database.health(), { status: "not-configured", configured: false });
  await assert.rejects(database.query("SELECT 1"), { code: "EASYWEB_DATABASE_UNAVAILABLE" });
});

test("reutiliza um pool e parametriza consultas", async () => {
  const calls = [];
  const pool = {
    execute: async (statement, values) => {
      calls.push({ statement, values });
      return [[{ id: 7 }], []];
    },
    end: async () => undefined
  };
  let poolCreations = 0;
  const database = createMySqlHandler({
    environment: { MYSQL_HOST: "127.0.0.1", MYSQL_USER: "easyweb", MYSQL_DATABASE: "easyweb" },
    client: { createPool: () => { poolCreations += 1; return pool; } }
  });

  assert.equal(readMySqlConfiguration({ MYSQL_HOST: "db", MYSQL_USER: "user", MYSQL_DATABASE: "easyweb" }).poolOptions.port, 3306);
  assert.deepEqual(await database.query("SELECT id FROM users WHERE id = ?", [7]), { rows: [{ id: 7 }], fields: [] });
  assert.deepEqual(await database.health(), { status: "ok", configured: true });
  assert.equal(poolCreations, 1);
  assert.deepEqual(calls[0], { statement: "SELECT id FROM users WHERE id = ?", values: [7] });
  await database.close();
});

test("faz rollback e libera a conexão quando uma transação falha", async () => {
  const steps = [];
  const connection = {
    beginTransaction: async () => steps.push("begin"),
    execute: async () => { throw new Error("falha simulada"); },
    commit: async () => steps.push("commit"),
    rollback: async () => steps.push("rollback"),
    release: () => steps.push("release")
  };
  const database = createMySqlHandler({
    environment: { MYSQL_HOST: "127.0.0.1", MYSQL_USER: "easyweb", MYSQL_DATABASE: "easyweb" },
    client: { createPool: () => ({ getConnection: async () => connection }) }
  });

  await assert.rejects(database.transaction(({ query }) => query("UPDATE users SET name = ?", ["Ana"])), /falha simulada/);
  assert.deepEqual(steps, ["begin", "rollback", "release"]);
});
