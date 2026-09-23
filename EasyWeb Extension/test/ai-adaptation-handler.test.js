const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHandler() {
  const elements = new Map();
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe() {}

    disconnect() {}
  }
  const root = {
    append(element) {
      element.isConnected = true;
      elements.set(element.id, element);
    }
  };
  const context = {
    window: { location: { origin: "https://example.com" } },
    document: {
      head: root,
      documentElement: root,
      createElement() {
        return { dataset: {}, isConnected: false, textContent: "" };
      },
      getElementById(id) {
        return elements.get(id);
      }
    },
    Date,
    Set,
    Math,
    Number,
    Boolean,
    Object,
    Array,
    String
  };
  context.MutationObserver = FakeMutationObserver;
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "handlers", "ai-adaptation-handler.js"), "utf8"),
    context
  );
  return {
    handler: context.EasyWebAiAdaptationHandler,
    elements,
    notifyDomMutation() {
      for (const observer of observers) observer.callback([]);
    }
  };
}

test("compiles and installs a validated site script immediately", () => {
  const { handler, elements } = loadHandler();
  const plan = {
    schemaVersion: 1,
    planId: "base:example:v1",
    planScope: "base",
    origin: "https://example.com",
    siteScript: {
      version: 1,
      triggers: ["document-ready", "route-change"],
      steps: [{
        type: "apply-style",
        target: "main-content",
        preset: "readable-text",
        parameters: { scale: 1.2 }
      }]
    }
  };

  const applied = handler.apply(plan);

  assert.equal(applied.applied, true);
  assert.match(elements.get("easyweb-ai-base-style").textContent, /@layer easyweb-ai-base/);
  assert.match(elements.get("easyweb-ai-base-style").textContent, /1\.2/);
  assert.equal(applied.compiled.siteScriptVersion, 1);
});

test("converts a cached legacy action plan without accepting arbitrary code", () => {
  const { handler } = loadHandler();
  const plan = {
    schemaVersion: 1,
    planId: "personal:example:v1",
    planScope: "personal",
    origin: "https://example.com",
    actions: [{
      type: "improve-focus-ring",
      scope: "interactive-elements",
      parameters: { width: 3, offset: 2 }
    }]
  };

  const validated = handler.validatePlan(plan);

  assert.equal(validated.siteScript.steps[0].preset, "focus-ring");
  const sanitized = handler.validatePlan({
    ...plan,
    siteScript: { version: 1, triggers: [], steps: [{ type: "run-code" }] }
  });
  assert.deepEqual(sanitized.siteScript.steps, []);
});

test("reinstalls an active style after a SPA replaces the document head", async () => {
  const { handler, elements, notifyDomMutation } = loadHandler();
  const plan = {
    schemaVersion: 1,
    planId: "base:example:v2",
    planScope: "base",
    origin: "https://example.com",
    siteScript: {
      version: 1,
      triggers: ["document-ready", "route-change"],
      steps: [{ type: "apply-style", target: "links", preset: "link-clarity", parameters: {} }]
    }
  };

  assert.equal(handler.apply(plan).applied, true);
  elements.delete("easyweb-ai-base-style");
  notifyDomMutation();
  await Promise.resolve();

  assert.equal(elements.get("easyweb-ai-base-style").dataset.easywebAiPlan, plan.planId);
});
