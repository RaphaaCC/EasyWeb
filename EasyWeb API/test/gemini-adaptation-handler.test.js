import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiAdaptationHandler, normalizeGeneratedPlan } from "../src/handlers/gemini-adaptation-handler.js";

test("normalizes the bounded EasyWebSiteScriptV1 contract", () => {
  const plan = normalizeGeneratedPlan({
    confidence: 0.9,
    summary: "Reading is more comfortable.",
    siteScript: {
      version: 1,
      triggers: ["route-change", "unknown-trigger"],
      steps: [
        {
          type: "apply-style",
          target: "main-content",
          preset: "readable-text",
          parameters: {}
        },
        {
          type: "apply-style",
          target: "document",
          preset: "arbitrary-code",
          parameters: { source: "alert(1)" }
        }
      ]
    }
  });

  assert.deepEqual(plan.siteScript.triggers, ["document-ready", "route-change"]);
  assert.equal(plan.siteScript.steps.length, 1);
  assert.deepEqual(plan.siteScript.steps[0].parameters, { scale: 1.15 });
});

test("converts legacy action plans only for compatibility with stored plans", () => {
  const plan = normalizeGeneratedPlan({
    confidence: 0.8,
    summary: "Older plan.",
    actions: [{
      type: "improve-focus-ring",
      scope: "interactive-elements",
      parameters: { width: 3, offset: 2 }
    }]
  });

  assert.deepEqual(plan.siteScript.steps, [{
    type: "apply-style",
    target: "interactive-elements",
    preset: "focus-ring",
    parameters: { width: 3, offset: 2 }
  }]);
});

test("uses structured JSON output from Gemini", async () => {
  const requests = [];
  const handler = createGeminiAdaptationHandler({
    client: {
      models: {
        generateContent: async (request) => {
          requests.push(request);
          return {
            text: JSON.stringify({
              confidence: 0.7,
              summary: "Improve focus.",
              siteScript: {
                version: 1,
                triggers: ["document-ready"],
                steps: [{
                  type: "apply-style",
                  target: "interactive-elements",
                  preset: "focus-ring",
                  parameters: { width: 3, offset: 2 }
                }]
              }
            })
          };
        }
      }
    }
  });

  const generated = await handler.generate({
    origin: "https://example.com",
    snapshots: [{ structure: { tree: { tag: "main" } } }]
  });

  assert.equal(handler.configured, true);
  assert.equal(generated.siteScript.steps[0].preset, "focus-ring");
  assert.equal(requests[0].config.responseMimeType, "application/json");
  assert.equal(requests[0].config.temperature, 0.15);
  assert.equal(requests[0].config.httpOptions.retryOptions.attempts, 3);
  assert.ok(requests[0].config.abortSignal instanceof AbortSignal);
  assert.equal(requests[0].config.responseJsonSchema.required.includes("siteScript"), true);
});

test("opens the circuit breaker after consecutive transient failures", async () => {
  let calls = 0;
  let clock = 10;
  const handler = createGeminiAdaptationHandler({
    environment: {
      GEMINI_CIRCUIT_FAILURE_THRESHOLD: "2",
      GEMINI_CIRCUIT_COOLDOWN_MS: "100"
    },
    now: () => clock,
    client: {
      models: {
        generateContent: async () => {
          calls += 1;
          const error = new Error("busy");
          error.status = 429;
          throw error;
        }
      }
    }
  });
  const request = { origin: "https://example.com", snapshots: [] };

  await assert.rejects(handler.generate(request), { code: "EASYWEB_GEMINI_REQUEST_FAILED" });
  await assert.rejects(handler.generate(request), { code: "EASYWEB_GEMINI_REQUEST_FAILED" });
  await assert.rejects(handler.generate(request), { code: "EASYWEB_GEMINI_CIRCUIT_OPEN" });
  assert.equal(calls, 2);

  clock += 101;
  await assert.rejects(handler.generate(request), { code: "EASYWEB_GEMINI_REQUEST_FAILED" });
  assert.equal(calls, 3);
});
