import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { synchronizeDatabaseSchema } from "./handlers/database-schema-handler.js";
import { createAdaptationJobWorker } from "./handlers/adaptation-job-worker.js";
import { createAdaptationService } from "./handlers/adaptation-service-handler.js";
import { createGeminiAdaptationHandler } from "./handlers/gemini-adaptation-handler.js";
import { createMySqlHandler } from "./handlers/mysql-handler.js";
import { createSiteSnapshotHandler } from "./handlers/site-snapshot-handler.js";
import { attachWebSocketServer } from "./websocket.js";

const port = Number.parseInt(process.env.PORT || "3001", 10);
const host = process.env.HOST || "127.0.0.1";
const database = createMySqlHandler();
const snapshotStore = createSiteSnapshotHandler({ database });
const gemini = createGeminiAdaptationHandler();
const adaptationService = createAdaptationService({ database, gemini });
const adaptationWorker = createAdaptationJobWorker({
  adaptationService,
  intervalMs: process.env.ADAPTATION_WORKER_INTERVAL_MS
});
const app = createApp({ database, gemini });
const server = createServer(app);
const webSocketServer = attachWebSocketServer(server, { snapshotStore, adaptationService });
let shuttingDown = false;

async function start() {
  if (database.configured) {
    try {
      const result = await synchronizeDatabaseSchema(database);
      const detail = result.changes.length
        ? `${result.changes.length} alteração(ões) aplicada(s)`
        : "nenhuma alteração necessária";
      console.log(`Schema MySQL v${result.schemaVersion} sincronizado: ${detail}.`);
      adaptationWorker.start();
    } catch (error) {
      const detail = error?.code ? `${error.code}: ${error.message}` : error?.message || "Erro desconhecido.";
      console.error(`Não foi possível sincronizar a estrutura MySQL; a API não será iniciada. ${detail}`);
      await database.close();
      process.exitCode = 1;
      return;
    }
  } else {
    console.log("MySQL não configurado; a API seguirá disponível sem banco.");
  }

  server.listen(port, host, () => {
    console.log(`EasyWeb API disponível em http://${host}:${port}`);
    console.log(`WebSocket disponível em ws://${host}:${port}/ws`);
    console.log(gemini.configured
      ? `Análise de IA disponível com ${gemini.model}.`
      : "Análise de IA aguardando a configuração de GEMINI_API_KEY.");
  });
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  adaptationWorker.stop();
  webSocketServer.close(() => {
    server.close(() => {
      database.close().finally(() => {
        console.log(`EasyWeb API encerrada após ${signal}.`);
        process.exitCode = 0;
      });
    });
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
