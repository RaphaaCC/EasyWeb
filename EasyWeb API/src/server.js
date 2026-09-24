import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createAiRequestQueue } from "./handlers/ai-request-queue-handler.js";
import { createApiLogger } from "./handlers/api-logger-handler.js";
import { synchronizeDatabaseSchema } from "./handlers/database-schema-handler.js";
import { createAdaptationJobWorker } from "./handlers/adaptation-job-worker.js";
import { createAdaptationService } from "./handlers/adaptation-service-handler.js";
import { createGeminiAdaptationHandler } from "./handlers/gemini-adaptation-handler.js";
import { createMySqlHandler } from "./handlers/mysql-handler.js";
import { createSnapshotRetentionHandler } from "./handlers/snapshot-retention-handler.js";
import { createSiteSnapshotHandler } from "./handlers/site-snapshot-handler.js";
import { attachWebSocketServer } from "./websocket.js";

const port = Number.parseInt(process.env.PORT || "3001", 10);
const host = process.env.HOST || "127.0.0.1";
const logger = createApiLogger();
const database = createMySqlHandler();
const snapshotStore = createSiteSnapshotHandler({ database });
const retentionHandler = createSnapshotRetentionHandler({ database });
const gemini = createGeminiAdaptationHandler();
const aiRequestQueue = createAiRequestQueue({ logger });
const adaptationService = createAdaptationService({ database, gemini, aiQueue: aiRequestQueue });
const adaptationWorker = createAdaptationJobWorker({
  adaptationService,
  intervalMs: process.env.ADAPTATION_WORKER_INTERVAL_MS,
  logger
});
const app = createApp({ database, gemini });
const server = createServer(app);
const webSocketServer = attachWebSocketServer(server, {
  snapshotStore,
  adaptationService,
  retentionHandler,
  logger
});
let shuttingDown = false;
let retentionTimer;

server.on("error", (error) => {
  logger.error("api.listen.failed", {
    host,
    port,
    code: error?.code || "unknown",
    reason: error?.message || "unknown"
  });
  if (!shuttingDown) {
    shuttingDown = true;
    adaptationWorker.stop();
    clearInterval(retentionTimer);
    void database.close().finally(() => {
      process.exitCode = 1;
    });
  }
});

function scheduleSnapshotRetention() {
  const run = () => retentionHandler.deleteExpiredSnapshots().then((result) => {
    if (result.deleted > 0) {
      logger.info("retention.completed", {
        snapshots: result.deleted,
        plans: result.plans,
        families: result.families,
        jobs: result.jobs
      });
    }
  }).catch((error) => logger.warn("retention.failed", {
    code: error?.code || "unknown",
    reason: error?.message || "unknown"
  }));
  void run();
  retentionTimer = setInterval(run, 24 * 60 * 60 * 1000);
  retentionTimer.unref?.();
}

async function start() {
  if (database.configured) {
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
      adaptationWorker.start();
      scheduleSnapshotRetention();
    } catch (error) {
      const detail = error?.code ? `${error.code}: ${error.message}` : error?.message || "Erro desconhecido.";
      logger.error("database.schema.failed", { reason: detail });
      await database.close();
      process.exitCode = 1;
      return;
    }
  } else {
    logger.warn("database.not-configured", { mode: "api-without-persistence" });
  }

  server.listen(port, host, () => {
    logger.info("api.ready", {
      http: `http://${host}:${port}`,
      websocket: `ws://${host}:${port}/ws`,
      database: database.configured ? "configured" : "disabled",
      gemini: gemini.configured ? gemini.model : "not-configured"
    });
  });
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  adaptationWorker.stop();
  clearInterval(retentionTimer);
  for (const client of webSocketServer.clients) {
    client.terminate();
  }
  webSocketServer.close(() => {
    server.close(() => {
      database.close().finally(() => {
        logger.info("api.stopped", { signal });
        process.exitCode = 0;
      });
    });
    server.closeAllConnections?.();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
