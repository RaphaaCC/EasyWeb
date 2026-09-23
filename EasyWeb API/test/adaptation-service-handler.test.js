import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { calculateStructuralSimilarity, createAdaptationService } from "../src/handlers/adaptation-service-handler.js";

function createSnapshot(tree, { styles = { styleSheetCount: 1 }, scripts = { total: 1 } } = {}) {
  return {
    captureVersion: 1,
    page: { origin: "https://example.com", path: "/" },
    structure: { tree },
    styles,
    scripts
  };
}

function createRow(contentHash, snapshot, pathMarker = 1, installationMarker = pathMarker) {
  return {
    content_hash: Buffer.from(contentHash.repeat(64 / contentHash.length), "hex"),
    path_hash: Buffer.alloc(32, pathMarker),
    template_hash: Buffer.alloc(32, 1),
    installation_hash: Buffer.alloc(32, installationMarker),
    created_at: "2026-09-20T12:00:00.000Z",
    last_seen_at: "2026-09-20T12:00:00.000Z",
    payload: gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"))
  };
}

test("calcula similaridade estrutural sem considerar conteúdo textual", () => {
  const first = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "h1", headingLevel: 1 }, { tag: "a", interactive: true }] });
  const second = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "h1", headingLevel: 1 }, { tag: "a", interactive: true }] });

  assert.equal(calculateStructuralSimilarity(first, second), 1);
});

test("aguarda duas amostras antes de solicitar uma análise", async () => {
  const service = createAdaptationService({
    database: {
      configured: true,
      query: async () => ({ rows: [] })
    },
    gemini: { configured: false }
  });

  assert.deepEqual(await service.considerSnapshot({ origin: "https://example.com" }), {
    state: "awaiting-second-snapshot"
  });
});

test("não chama o modelo sem uma chave configurada", async () => {
  const first = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "h1", headingLevel: 1 }] });
  const second = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "h1", headingLevel: 1 }, { tag: "p" }] });
  const rows = [createRow("a", first, 1, 1), createRow("b", second, 2, 2)];
  const service = createAdaptationService({
    database: {
      configured: true,
      query: async (statement) => ({ rows: /easyweb_site_snapshots/.test(statement) ? rows : [] })
    },
    gemini: { configured: false }
  });

  assert.deepEqual(await service.considerSnapshot({ origin: "https://example.com" }), {
    state: "model-unavailable"
  });
});

test("nao enfileira uma familia estavel sem oportunidade automatica segura", async () => {
  const styleEvidence = { styleSheetCount: 1, fontSizes: ["18px"], colors: ["#111111", "#ffffff"] };
  const first = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "h1", headingLevel: 1 }] }, { styles: styleEvidence });
  const second = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "h1", headingLevel: 1 }, { tag: "p" }] }, { styles: styleEvidence });
  second.page.path = "/sobre";
  const rows = [createRow("a", first, 1, 1), createRow("b", second, 2, 2)];
  const service = createAdaptationService({
    database: {
      configured: true,
      query: async (statement) => ({ rows: /easyweb_site_snapshots/.test(statement) ? rows : [] })
    },
    gemini: { configured: true }
  });

  const result = await service.considerSnapshot({ origin: "https://example.com" });
  assert.equal(result.state, "family-stable-no-opportunity");
  assert.equal(result.confidence.reason, "no-safe-accessibility-opportunity");
  assert.equal(result.confidence.sampleCount, 2);
});

test("compara rotas distintas mesmo quando a estrutura sanitizada é idêntica", () => {
  const snapshot = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "h1", headingLevel: 1 }] });
  const service = createAdaptationService({
    database: { configured: true, query: async () => ({ rows: [] }) },
    gemini: { configured: false }
  });

  const pair = service.findBestPair([createRow("a", snapshot, 1), createRow("a", snapshot, 2)]);
  assert.equal(pair.similarity, 1);
});

test("prefere uma dupla confiável quando a dupla mais parecida não atende à política", async () => {
  const repeatedPath = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "h1", headingLevel: 1 }] });
  const independentRoute = createSnapshot({
    tag: "main",
    landmark: true,
    children: [{ tag: "h1", headingLevel: 1 }, { tag: "p" }]
  });
  independentRoute.page.path = "/guia";
  const rows = [
    createRow("a", repeatedPath, 1, 1),
    createRow("b", repeatedPath, 1, 1),
    createRow("c", independentRoute, 2, 2)
  ];
  const service = createAdaptationService({
    database: {
      configured: true,
      query: async (statement) => ({ rows: /easyweb_site_snapshots/.test(statement) ? rows : [] })
    },
    gemini: { configured: false }
  });

  assert.deepEqual(await service.considerSnapshot({ origin: "https://example.com" }), {
    state: "model-unavailable"
  });
});

test("cria um plano pessoal direto sem exigir um plano base", async () => {
  const snapshot = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "p" }] });
  const generatedRequests = [];
  const service = createAdaptationService({
    database: { configured: true, query: async () => ({ rows: [] }) },
    gemini: {
      configured: true,
      generate: async (request) => {
        generatedRequests.push(request);
        return {
          confidence: 0.8,
          summary: "Leitura mais confortável.",
          siteScript: {
            version: 1,
            triggers: ["document-ready"],
            steps: [{ type: "apply-style", target: "main-content", preset: "readable-text", parameters: { scale: 1.15 } }]
          }
        };
      },
      normalizeGeneratedPlan: () => ({ siteScript: { steps: [] } })
    }
  });

  const result = await service.createPersonalPlan({
    installationId: "ca5ce777-31e1-4892-b93c-9d282b0732f7",
    origin: "https://example.com",
    snapshot,
    profile: "default",
    userRequest: { text: "Não consigo ler esta página", intentTags: ["reading-difficulty"] },
    snapshotStore: { prepare: ({ snapshot: value }) => ({ normalized: value }) }
  });

  assert.equal(result.state, "ready");
  assert.equal(result.plan.planScope, "personal");
  assert.equal(result.plan.basePlanId, null);
  assert.equal(result.plan.adaptationFingerprint, null);
  assert.match(result.plan.planId, /^personal:direct:/);
  assert.equal(generatedRequests[0].basePlan, null);
});

test("entrega um plano ativo do mesmo site quando as observações atuais ainda não são confiáveis", async () => {
  const snapshot = createSnapshot({ tag: "main", landmark: true, children: [{ tag: "h1", headingLevel: 1 }] });
  const storedPlan = {
    schemaVersion: 1,
    planId: "base:example:cached:v1",
    planScope: "base",
    origin: "https://example.com",
    actions: []
  };
  const service = createAdaptationService({
    database: {
      configured: true,
      query: async (statement) => {
        if (/easyweb_site_snapshots/.test(statement)) {
          return { rows: [createRow("a", snapshot, 1, 1)] };
        }
        if (/INNER JOIN easyweb_adaptation_families/.test(statement)) {
          return { rows: [{ plan_json: JSON.stringify(storedPlan) }] };
        }
        return { rows: [] };
      }
    },
    gemini: { configured: false }
  });

  assert.deepEqual(await service.lookup({ origin: "https://example.com" }), {
    state: "ready",
    plan: storedPlan,
    source: "origin-cache"
  });
});
