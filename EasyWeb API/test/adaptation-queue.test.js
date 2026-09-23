import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createAdaptationService } from "../src/handlers/adaptation-service-handler.js";
import { createAdaptationJobWorker } from "../src/handlers/adaptation-job-worker.js";

function snapshot(path, children, scripts = { total: 1 }) {
  return {
    captureVersion: 1,
    page: { origin: "https://example.com", path },
    structure: { tree: { tag: "main", landmark: true, children } },
    styles: { styleSheetCount: 1 },
    scripts
  };
}

function row(contentHash, value, pathMarker, installationMarker, createdAt = "2026-09-20T12:00:00.000Z", lastSeenAt = createdAt) {
  return {
    content_hash: Buffer.from(contentHash.repeat(64 / contentHash.length), "hex"),
    path_hash: Buffer.alloc(32, pathMarker),
    template_hash: Buffer.alloc(32, 1),
    installation_hash: Buffer.alloc(32, installationMarker),
    created_at: createdAt,
    last_seen_at: lastSeenAt,
    payload: gzipSync(Buffer.from(JSON.stringify(value), "utf8"))
  };
}

function validRows({ sameInstallation = false, scripts } = {}) {
  return [
    row("a", snapshot("/", [{ tag: "h1", headingLevel: 1 }], scripts), 1, 1),
    row("b", snapshot("/sobre", [{ tag: "h1", headingLevel: 1 }, { tag: "p" }], scripts), 2, sameInstallation ? 1 : 2)
  ];
}

test("aguarda uma terceira captura para uma familia com sinais dinamicos", async () => {
  const rows = validRows({
    sameInstallation: true,
    scripts: { total: 20, moduleCount: 1, asyncCount: 4 }
  });
  const service = createAdaptationService({
    database: { configured: true, query: async () => ({ rows }) },
    gemini: { configured: true }
  });

  const result = await service.considerSnapshot({ origin: "https://example.com" });
  assert.equal(result.state, "awaiting-family-confidence");
  assert.equal(result.confidence.dynamic, true);
  assert.equal(result.confidence.requiredSamples, 3);
  assert.equal(result.confidence.reason, "dynamic-family-needs-more-snapshots");
});

test("persiste, executa e publica um plano base confiavel", async () => {
  const rows = validRows();
  let job;
  const statements = [];
  const service = createAdaptationService({
    database: {
      configured: true,
      query: async (statement, values = []) => {
        statements.push({ statement, values });
        if (/easyweb_site_snapshots/.test(statement)) return { rows };
        if (/FROM easyweb_adaptation_base_plans/.test(statement)) return { rows: [] };
        if (/INSERT INTO easyweb_adaptation_jobs/.test(statement)) {
          job = {
            id: 7,
            site_origin: "https://example.com",
            adaptation_hash: values[2],
            primary_content_hash: values[3],
            secondary_content_hash: values[4],
            attempts: 0,
            state: "queued"
          };
          return { rows: { affectedRows: 1 } };
        }
        if (/SELECT id, state FROM easyweb_adaptation_jobs/.test(statement)) return { rows: [{ id: job.id, state: job.state }] };
        if (/SELECT id, site_origin, adaptation_hash/.test(statement)) return { rows: [job] };
        if (/SET state = 'running'/.test(statement)) return { rows: { affectedRows: 1 } };
        if (/SELECT id FROM easyweb_adaptation_families/.test(statement)) return { rows: [{ id: 22 }] };
        if (/next_version/.test(statement)) return { rows: [{ next_version: 1 }] };
        return { rows: [] };
      }
    },
    gemini: {
      configured: true,
      model: "test-model",
      promptVersion: "test-v1",
      generate: async () => ({
        confidence: 0.8,
        summary: "Plano base",
        siteScript: { version: 1, triggers: ["document-ready"], steps: [] }
      })
    }
  });
  const events = [];
  service.onBasePlan((event) => events.push(event));

  const queued = await service.considerSnapshot({ origin: "https://example.com" });
  assert.equal(queued.state, "analyzing-base");
  assert.equal(queued.jobId, 7);

  const result = await service.processNextBaseJob();
  assert.equal(result.state, "ready");
  assert.equal(result.plan.planScope, "base");
  assert.equal(events.length, 1);
  assert.equal(events[0].origin, "https://example.com");
  assert.ok(statements.some(({ statement }) => statement.includes("sample_count") && statement.includes("confidence_score")));
  assert.ok(statements.some(({ statement }) => /INSERT INTO easyweb_adaptation_jobs/.test(statement)));
  assert.ok(statements.some(({ statement }) => /UPDATE easyweb_adaptation_jobs/.test(statement)));
});

test("worker nao executa dois jobs ao mesmo tempo", async () => {
  let calls = 0;
  let release;
  const worker = createAdaptationJobWorker({
    adaptationService: {
      processNextBaseJob: async () => {
        calls += 1;
        await new Promise((resolve) => { release = resolve; });
        return { state: "idle" };
      }
    },
    logger: { warn() {}, error() {} }
  });

  const first = worker.runOnce();
  assert.deepEqual(await worker.runOnce(), { state: "busy" });
  release();
  await first;
  assert.equal(calls, 1);
});
