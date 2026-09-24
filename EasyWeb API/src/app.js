import cors from "cors";
import express from "express";
import helmet from "helmet";
import { timingSafeEqual } from "node:crypto";
import { diagnosticsDashboardHtml, diagnosticsDashboardScript } from "./handlers/diagnostics-dashboard.js";
import { createDiagnosticsHandler } from "./handlers/diagnostics-handler.js";
import { colorFilters, profiles } from "./profiles.js";
import { createRecommendations } from "./recommendations.js";

const MAX_BODY_SIZE = "100kb";

function createCorsOptions() {
  const origin = process.env.CORS_ORIGIN || "*";
  return { origin: origin === "*" ? true : origin.split(",").map((item) => item.trim()) };
}

function validateAnalysisRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "O corpo da requisição deve ser um objeto JSON.";
  }

  if (!body.summary || typeof body.summary !== "object" || Array.isArray(body.summary)) {
    return "O campo summary é obrigatório e deve ser um objeto.";
  }

  return null;
}

function tokenMatches(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const receivedToken = Buffer.from(received);
  const expectedToken = Buffer.from(expected);
  return receivedToken.length === expectedToken.length && timingSafeEqual(receivedToken, expectedToken);
}

export function createApp({ database, gemini, adminToken = process.env.EASYWEB_ADMIN_TOKEN } = {}) {
  const app = express();
  app.locals.database = database;
  const diagnostics = createDiagnosticsHandler({ database, gemini });
  const internalToken = typeof adminToken === "string" ? adminToken.trim() : "";

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: MAX_BODY_SIZE }));

  app.get("/api/v1/health", (request, response) => {
    response.status(200).json({
      status: "ok",
      service: "easyweb-api",
      version: "v1.0.0 Beta",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/v1/health/database", async (request, response, next) => {
    try {
      const database = request.app.locals.database;
      if (!database) {
        response.status(200).json({ status: "not-configured", configured: false });
        return;
      }

      const result = await database.health();
      response.status(result.status === "ok" || result.status === "not-configured" ? 200 : 503).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/profiles", (request, response) => {
    response.status(200).json({ profiles, colorFilters });
  });

  app.get("/api/v1/profiles/:id", (request, response) => {
    const profile = profiles.find((item) => item.id === request.params.id);
    if (!profile) {
      response.status(404).json({ error: "Perfil não encontrado." });
      return;
    }
    response.status(200).json({ profile });
  });

  app.get("/api/v1/internal/dashboard", (request, response) => {
    if (!internalToken) {
      response.status(404).json({ error: "Rota não encontrada." });
      return;
    }
    response.type("html").send(diagnosticsDashboardHtml());
  });

  app.get("/api/v1/internal/dashboard.js", (request, response) => {
    if (!internalToken) {
      response.status(404).type("text").send("Rota não encontrada.");
      return;
    }
    response.type("application/javascript").send(diagnosticsDashboardScript());
  });

  app.get("/api/v1/internal/diagnostics", async (request, response) => {
    if (!internalToken || !tokenMatches(request.get("X-EasyWeb-Admin-Token"), internalToken)) {
      response.status(401).json({ error: "Não autorizado." });
      return;
    }
    const result = await diagnostics.getDiagnostics();
    response.status(result.status === "unavailable" ? 503 : 200).json(result);
  });

  app.post("/api/v1/accessibility/analyze", (request, response) => {
    const validationError = validateAnalysisRequest(request.body);
    if (validationError) {
      response.status(400).json({ error: validationError });
      return;
    }

    const { page = {}, summary } = request.body;
    response.status(200).json({
      page: {
        url: typeof page.url === "string" ? page.url : null,
        type: typeof summary.pageType === "string" ? summary.pageType : "unknown"
      },
      ...createRecommendations(summary)
    });
  });

  app.use((request, response) => {
    response.status(404).json({ error: "Rota não encontrada." });
  });

  app.use((error, request, response, next) => {
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({ error: "JSON inválido." });
      return;
    }

    if (error.type === "entity.too.large") {
      response.status(413).json({ error: "O corpo da requisição excede o limite de 100kb." });
      return;
    }

    next(error);
  });

  app.use((error, request, response, next) => {
    response.status(500).json({ error: "Erro interno do servidor." });
  });

  return app;
}
