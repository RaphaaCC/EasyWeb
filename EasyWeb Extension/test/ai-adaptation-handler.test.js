const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createRuntimeElement(overrides = {}) {
  const attributes = new Map();
  return {
    isConnected: true,
    parentElement: null,
    computedStyle: {
      color: "rgb(120, 120, 120)",
      backgroundColor: "rgb(255, 255, 255)",
      backgroundImage: "none",
      display: "block",
      visibility: "visible",
      opacity: "1",
      fontSize: "16px",
      fontWeight: "400",
      ...overrides
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    matches() {
      return true;
    },
    querySelectorAll() {
      return [];
    }
  };
}

function loadHandler({ runtimeElements = [] } = {}) {
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
  const defaultStyles = {
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgb(255, 255, 255)",
    backgroundImage: "none",
    display: "block",
    visibility: "visible",
    opacity: "1",
    fontSize: "16px",
    fontWeight: "400"
  };
  const root = {
    isConnected: true,
    parentElement: null,
    computedStyle: defaultStyles,
    append(element) {
      element.isConnected = true;
      elements.set(element.id, element);
    },
    matches() {
      return false;
    },
    querySelectorAll() {
      return runtimeElements;
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
      },
      querySelectorAll() {
        return [root];
      }
    },
    getComputedStyle(element) {
      return element?.computedStyle || defaultStyles;
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

test("amplia visualmente os controles em um plano pessoal", () => {
  const { handler, elements } = loadHandler();
  const plan = {
    schemaVersion: 1,
    planId: "personal:example:buttons",
    planScope: "personal",
    origin: "https://example.com",
    siteScript: {
      version: 1,
      triggers: ["document-ready"],
      steps: [{ type: "apply-style", target: "controls", preset: "large-controls", parameters: { minimumSize: 48 } }]
    }
  };

  assert.equal(handler.apply(plan).applied, true);
  const css = elements.get("easyweb-ai-personal-style").textContent;
  assert.match(css, /min-block-size: 48px/);
  assert.match(css, /padding-inline/);
  assert.match(css, /font-size: max\(1em, 16px\)/);
});

test("não apresenta plano sem etapas como uma adaptação aplicada", () => {
  const { handler } = loadHandler();
  const plan = {
    schemaVersion: 1,
    planId: "personal:example:empty",
    planScope: "personal",
    origin: "https://example.com",
    siteScript: { version: 1, triggers: ["document-ready"], steps: [] }
  };

  const result = handler.apply(plan);
  assert.equal(result.applied, false);
  assert.equal(result.reason, "empty-plan");
});

test("compila melhorias limitadas para navegação, formulários e hierarquia de leitura", () => {
  const { handler, elements } = loadHandler();
  const plan = {
    schemaVersion: 1,
    planId: "personal:example:clarity",
    planScope: "personal",
    origin: "https://example.com",
    siteScript: {
      version: 1,
      triggers: ["document-ready"],
      steps: [
        { type: "apply-style", target: "document", preset: "navigation-clarity", parameters: {} },
        { type: "apply-style", target: "controls", preset: "form-legibility", parameters: {} },
        { type: "apply-style", target: "main-content", preset: "heading-clarity", parameters: {} }
      ]
    }
  };

  assert.equal(handler.apply(plan).applied, true);
  const css = elements.get("easyweb-ai-personal-style").textContent;
  assert.match(css, /role="navigation"/);
  assert.match(css, /font-weight: 700/);
  assert.match(css, /scroll-margin-block-start/);
});

test("compila uma cor pessoal somente a partir da paleta segura", () => {
  const { handler } = loadHandler();
  const basePlan = {
    schemaVersion: 1,
    planId: "personal:example:color",
    planScope: "personal",
    origin: "https://example.com",
    siteScript: {
      version: 1,
      triggers: ["document-ready"],
      steps: [{ type: "apply-style", target: "document", preset: "text-color", parameters: { color: "#b00020" } }]
    }
  };

  assert.match(handler.compilePlan(basePlan).css, /color: #b00020 !important/);
  const normalized = handler.validatePlan({
    ...basePlan,
    planId: "personal:example:unsafe-color",
    siteScript: {
      ...basePlan.siteScript,
      steps: [{ type: "apply-style", target: "document", preset: "text-color", parameters: { color: "url(javascript:alert(1))" } }]
    }
  });
  assert.equal(normalized.siteScript.steps[0].parameters.color, "#005fcc");
});

test("contrast-support escolhe uma cor que atinge contraste mensurável", () => {
  const paragraph = createRuntimeElement({ color: "rgb(180, 180, 180)" });
  const { handler, elements } = loadHandler({ runtimeElements: [paragraph] });
  const plan = {
    schemaVersion: 1,
    planId: "personal:example:contrast",
    planScope: "personal",
    origin: "https://example.com",
    siteScript: {
      version: 1,
      triggers: ["document-ready"],
      steps: [{ type: "apply-style", target: "main-content", preset: "contrast-support", parameters: {} }]
    }
  };

  assert.equal(handler.apply(plan).applied, true);
  assert.equal(paragraph.getAttribute("data-easyweb-ai-personal-contrast"), "dark");
  assert.match(elements.get("easyweb-ai-personal-style").textContent, /color: #000000 !important/);
});

test("text-color não aplica uma cor permitida quando ela falha no contraste do fundo", () => {
  const paragraph = createRuntimeElement({ color: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)" });
  const { handler } = loadHandler({ runtimeElements: [paragraph] });
  const plan = {
    schemaVersion: 1,
    planId: "personal:example:white-on-white",
    planScope: "personal",
    origin: "https://example.com",
    siteScript: {
      version: 1,
      triggers: ["document-ready"],
      steps: [{ type: "apply-style", target: "document", preset: "text-color", parameters: { color: "#ffffff" } }]
    }
  };

  assert.equal(handler.apply(plan).applied, true);
  assert.equal(paragraph.getAttribute("data-easyweb-ai-personal-text-color"), null);
});

test("text-color aplica a cor pedida quando a combinação passa no contraste", () => {
  const paragraph = createRuntimeElement({ color: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)" });
  const { handler } = loadHandler({ runtimeElements: [paragraph] });
  const plan = {
    schemaVersion: 1,
    planId: "personal:example:blue-on-white",
    planScope: "personal",
    origin: "https://example.com",
    siteScript: {
      version: 1,
      triggers: ["document-ready"],
      steps: [{ type: "apply-style", target: "document", preset: "text-color", parameters: { color: "#005fcc" } }]
    }
  };

  assert.equal(handler.apply(plan).applied, true);
  assert.equal(paragraph.getAttribute("data-easyweb-ai-personal-text-color"), "blue");
});
