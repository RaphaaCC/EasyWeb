const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createStorage() {
  const values = Object.create(null);
  return {
    async get(keys) {
      const names = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys || {});
      return Object.fromEntries(names.map((key) => [key, values[key]]));
    },
    async set(entries) {
      Object.assign(values, entries);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete values[key];
      }
    }
  };
}

function loadSettings() {
  const storage = createStorage();
  const context = {
    chrome: { storage: { local: storage } },
    URL,
    Date,
    Math,
    Number,
    Boolean,
    Object,
    Array,
    String,
    Promise
  };
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "handlers", "settings-handler.js"), "utf8"),
    context
  );
  return context.EasyWebSettingsHandler.create({ origin: "https://example.com", href: "https://example.com/" });
}

function plan(id, scope = "base") {
  return {
    schemaVersion: 1,
    planId: id,
    planScope: scope,
    planVersion: 1,
    origin: "https://example.com",
    adaptationFingerprint: `fingerprint-${id}`
  };
}

test("mantém histórico local do plano e restaura a versão anterior", async () => {
  const settings = loadSettings();
  await settings.saveAiBasePlan(plan("base:v1"));
  await settings.saveAiBasePlan(plan("base:v2"));

  const beforeRestore = await settings.loadAiPlanState("default");
  assert.equal(beforeRestore.basePlan.planId, "base:v2");
  assert.equal(beforeRestore.previous.scope, "base");
  assert.equal(beforeRestore.previous.entry.plan.planId, "base:v1");

  const restored = await settings.restorePreviousAiPlan("base", "default");
  assert.equal(restored.restored, true);
  assert.equal(restored.plan.planId, "base:v1");

  const afterRestore = await settings.loadAiPlanState("default");
  assert.equal(afterRestore.basePlan.planId, "base:v1");
  assert.equal(afterRestore.previous.entry.plan.planId, "base:v2");
});

test("registra qual plano foi aplicado sem guardar dados da página", async () => {
  const settings = loadSettings();
  const applied = plan("personal:v1", "personal");
  await settings.recordAiPlanApplication(applied, { source: "websocket" }, "elderly");

  const state = await settings.loadAiPlanState("elderly");
  assert.equal(state.applied.planId, "personal:v1");
  assert.equal(state.applied.planScope, "personal");
  assert.equal(state.applied.planVersion, 1);
  assert.equal(state.applied.adaptationFingerprint, "fingerprint-personal:v1");
  assert.deepEqual([...state.applied.sourceContentHashes], []);
  assert.equal(state.applied.source, "websocket");
  assert.match(state.applied.appliedAt, /^\d{4}-\d{2}-\d{2}T/);
});
