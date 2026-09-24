(() => {
  const HANDLER_VERSION = 6;
  const SITE_SCRIPT_VERSION = 1;
  const MAX_STEPS = 8;
  const ALLOWED_TRIGGERS = new Set(["document-ready", "route-change"]);
  const ALLOWED_SCOPES = new Set(["main-content", "interactive-elements", "links", "controls", "document"]);
  const ALLOWED_PRESETS = new Set([
    "readable-text",
    "reading-spacing",
    "focus-ring",
    "link-clarity",
    "control-boundaries",
    "contrast-support",
    "reduced-motion",
    "large-controls",
    "content-width",
    "navigation-clarity",
    "form-legibility",
    "heading-clarity",
    "text-color"
  ]);
  const ALLOWED_TEXT_COLORS = new Set(["#005fcc", "#b00020", "#006b3c", "#000000", "#ffffff", "#6a1b9a"]);
  const STYLE_IDS = Object.freeze({
    base: "easyweb-ai-base-style",
    personal: "easyweb-ai-personal-style"
  });
  const activeCompiled = { base: null, personal: null };
  const activePlans = { base: null, personal: null };
  const runtimeAdjusted = { base: new Set(), personal: new Set() };
  let retentionObserver;
  let retainedHead;
  let retentionQueued = false;
  const SELECTORS = Object.freeze({
    "main-content": ":where(main, article, [role=\"main\"])",
    "interactive-elements": ":where(a[href], button, input, select, textarea, summary, [role=\"button\"], [role=\"link\"])",
    links: ":where(a[href])",
    controls: ":where(button, input, select, textarea, summary, [role=\"button\"], [role=\"checkbox\"], [role=\"tab\"])",
    document: ":root"
  });
  const CONTROL_SIZE_SELECTOR = [
    "button",
    "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=file]):not([type=color])",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=tab]",
    "[role=menuitem]"
  ].map((selector) => `:where(${selector})`).join(", ");
  const NAVIGATION_SELECTOR = ':where(nav, [role="navigation"], [role="menubar"], [role="tablist"])';
  const FORM_SELECTOR = ':where(form, [role="form"])';
  const FORM_CONTROL_SELECTOR = ':where(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=file]):not([type=color]), select, textarea)';
  const TEXT_CANDIDATE_SELECTOR = [
    "p", "span", "li", "dt", "dd", "th", "td", "label", "legend", "blockquote",
    "h1", "h2", "h3", "h4", "h5", "h6", "a[href]", "button",
    "input:not([type=hidden])", "select", "textarea", "summary",
    "[role=button]", "[role=link]", "[role=menuitem]", "[role=tab]"
  ].map((selector) => `:where(${selector})`).join(", ");
  const TEXT_COLOR_ALIASES = Object.freeze({
    "#005fcc": "blue",
    "#b00020": "red",
    "#006b3c": "green",
    "#000000": "black",
    "#ffffff": "white",
    "#6a1b9a": "purple"
  });

  function clamp(value, minimum, maximum, fallback = minimum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Math.max(number, minimum), maximum) : fallback;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isPlanExpired(plan) {
    return Boolean(plan?.expiresAt) && Number.isFinite(Date.parse(plan.expiresAt)) && Date.parse(plan.expiresAt) <= Date.now();
  }

  function normalizeParameters(preset, value) {
    const parameters = isPlainObject(value) ? value : {};
    if (preset === "readable-text") return { scale: clamp(parameters.scale, 0.9, 1.35, 1.15) };
    if (preset === "reading-spacing") {
      return {
        lineHeight: clamp(parameters.lineHeight, 1.35, 2, 1.6),
        letterSpacing: clamp(parameters.letterSpacing, 0, 2, 0.3)
      };
    }
    if (preset === "focus-ring") {
      return { width: clamp(parameters.width, 2, 4, 3), offset: clamp(parameters.offset, 1, 5, 3) };
    }
    if (preset === "control-boundaries") return { width: clamp(parameters.width, 1, 3, 2) };
    if (preset === "large-controls") return { minimumSize: clamp(parameters.minimumSize, 36, 48, 40) };
    if (preset === "content-width") return { maxWidth: clamp(parameters.maxWidth, 42, 90, 68) };
    if (preset === "text-color") {
      const color = String(parameters.color || "").trim().toLowerCase();
      return { color: ALLOWED_TEXT_COLORS.has(color) ? color : "#005fcc" };
    }
    return {};
  }

  function legacyActionsToSiteScript(actions) {
    const steps = (Array.isArray(actions) ? actions : []).slice(0, MAX_STEPS).flatMap((action) => {
      if (!isPlainObject(action) || !ALLOWED_SCOPES.has(action.scope)) return [];
      const parameters = isPlainObject(action.parameters) ? action.parameters : {};
      const directPreset = {
        "set-text-scale": "readable-text",
        "set-reading-spacing": "reading-spacing",
        "improve-focus-ring": "focus-ring",
        "improve-link-distinction": "link-clarity",
        "improve-control-boundaries": "control-boundaries",
        "raise-insufficient-contrast": "contrast-support",
        "reduce-motion": "reduced-motion",
        "increase-hit-targets": "large-controls"
      }[action.type];
      if (directPreset) return [{ type: "apply-style", target: action.scope, preset: directPreset, parameters }];
      if (action.type !== "css-adjustment" || !Array.isArray(parameters.rules)) return [];
      return parameters.rules.slice(0, 4).flatMap((rule) => {
        if (!isPlainObject(rule)) return [];
        const preset = {
          "font-size-scale": "readable-text",
          "line-height": "reading-spacing",
          "letter-spacing": "reading-spacing",
          "max-reading-width": "content-width"
        }[rule.property];
        if (!preset) return [];
        const converted = rule.property === "font-size-scale" ? { scale: rule.value }
          : rule.property === "line-height" ? { lineHeight: rule.value }
            : rule.property === "letter-spacing" ? { letterSpacing: rule.value }
              : { maxWidth: rule.value };
        return [{ type: "apply-style", target: action.scope, preset, parameters: converted }];
      });
    });
    return { version: SITE_SCRIPT_VERSION, triggers: ["document-ready"], steps };
  }

  function normalizeSiteScript(value, legacyActions) {
    const source = isPlainObject(value) ? value : legacyActionsToSiteScript(legacyActions);
    if (source.version !== SITE_SCRIPT_VERSION) return null;
    const triggers = [...new Set((Array.isArray(source.triggers) ? source.triggers : [])
      .filter((trigger) => ALLOWED_TRIGGERS.has(trigger)))];
    if (!triggers.includes("document-ready")) triggers.unshift("document-ready");
    const steps = (Array.isArray(source.steps) ? source.steps : []).slice(0, MAX_STEPS).flatMap((step) => {
      if (!isPlainObject(step) || step.type !== "apply-style" ||
        !ALLOWED_SCOPES.has(step.target) || !ALLOWED_PRESETS.has(step.preset)) return [];
      return [{
        type: "apply-style",
        target: step.target,
        preset: step.preset,
        parameters: normalizeParameters(step.preset, step.parameters)
      }];
    });
    return { version: SITE_SCRIPT_VERSION, triggers: triggers.slice(0, 2), steps };
  }

  function validatePlan(plan, origin = window.location.origin) {
    if (!isPlainObject(plan) || plan.schemaVersion !== 1 || plan.origin !== origin || isPlanExpired(plan)) return null;
    if ((plan.planScope !== "base" && plan.planScope !== "personal") || typeof plan.planId !== "string" || !plan.planId) return null;
    const siteScript = normalizeSiteScript(plan.siteScript, plan.actions);
    return siteScript ? { ...plan, siteScript } : null;
  }

  function selectorFor(scope) {
    return SELECTORS[scope] || SELECTORS.document;
  }

  function parseColor(value) {
    const match = String(value || "").trim().match(/^rgba?\((.+)\)$/i);
    if (!match) return null;
    const rawChannels = match[1].trim();
    const channels = rawChannels.includes(",")
      ? rawChannels.split(",").map((channel) => channel.trim())
      : rawChannels.replace("/", " / ").split(/\s+/);
    const separatorIndex = channels.indexOf("/");
    const alphaValue = separatorIndex === -1 ? channels[3] : channels[separatorIndex + 1];
    const colorChannels = separatorIndex === -1 ? channels.slice(0, 3) : channels.slice(0, separatorIndex);
    if (colorChannels.length < 3) return null;
    const values = colorChannels.map((channel) => channel.endsWith("%") ? Number(channel.slice(0, -1)) * 2.55 : Number(channel));
    const alpha = alphaValue?.endsWith("%") ? Number(alphaValue.slice(0, -1)) / 100 : Number(alphaValue ?? 1);
    if (values.some((channel) => !Number.isFinite(channel)) || !Number.isFinite(alpha)) return null;
    return { r: values[0], g: values[1], b: values[2], a: alpha };
  }

  function hexColor(value) {
    const match = String(value || "").match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!match) return null;
    return { r: Number.parseInt(match[1], 16), g: Number.parseInt(match[2], 16), b: Number.parseInt(match[3], 16), a: 1 };
  }

  function channelToLinear(channel) {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }

  function luminance(color) {
    return 0.2126 * channelToLinear(color.r) + 0.7152 * channelToLinear(color.g) + 0.0722 * channelToLinear(color.b);
  }

  function contrastRatio(first, second) {
    const brightest = Math.max(luminance(first), luminance(second));
    const darkest = Math.min(luminance(first), luminance(second));
    return (brightest + 0.05) / (darkest + 0.05);
  }

  function blendWithBackground(foreground, background) {
    const alpha = foreground.a;
    return {
      r: foreground.r * alpha + background.r * (1 - alpha),
      g: foreground.g * alpha + background.g * (1 - alpha),
      b: foreground.b * alpha + background.b * (1 - alpha),
      a: 1
    };
  }

  function effectiveBackground(element) {
    for (let current = element; current; current = current.parentElement) {
      const styles = getComputedStyle(current);
      if (styles.backgroundImage && styles.backgroundImage !== "none") return null;
      const color = parseColor(styles.backgroundColor);
      if (color?.a >= 0.99) return color;
      if (color && color.a > 0) return null;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function minimumContrast(element) {
    const styles = getComputedStyle(element);
    const fontSize = Number.parseFloat(styles.fontSize);
    const numericWeight = Number.parseInt(styles.fontWeight, 10);
    const weight = Number.isFinite(numericWeight) ? numericWeight : ["bold", "bolder"].includes(styles.fontWeight) ? 700 : 400;
    const largeText = Number.isFinite(fontSize) && (fontSize >= 24 || (fontSize >= 18.66 && weight >= 700));
    return largeText ? 3 : 4.5;
  }

  function isVisible(element) {
    const styles = getComputedStyle(element);
    return styles.display !== "none" && styles.visibility !== "hidden" && Number.parseFloat(styles.opacity || "1") !== 0;
  }

  function scopedTextElements(scope) {
    const roots = scope === "document"
      ? [document.documentElement].filter(Boolean)
      : [...document.querySelectorAll(selectorFor(scope))];
    const elements = [];
    const seen = new Set();
    const add = (element) => {
      if (element && !seen.has(element)) {
        seen.add(element);
        elements.push(element);
      }
    };
    for (const root of roots) {
      if (root.matches?.(TEXT_CANDIDATE_SELECTOR)) add(root);
      for (const element of root.querySelectorAll?.(TEXT_CANDIDATE_SELECTOR) || []) add(element);
    }
    return elements;
  }

  function runtimeAttribute(scope, kind) {
    return `data-easyweb-ai-${scope}-${kind}`;
  }

  function clearRuntimeAdjustments(scope) {
    const contrastAttribute = runtimeAttribute(scope, "contrast");
    const textColorAttribute = runtimeAttribute(scope, "text-color");
    for (const element of runtimeAdjusted[scope]) {
      if (element.isConnected !== false) {
        element.removeAttribute(contrastAttribute);
        element.removeAttribute(textColorAttribute);
      }
    }
    runtimeAdjusted[scope].clear();
  }

  function applyRuntimeAdjustments(scope, plan) {
    clearRuntimeAdjustments(scope);
    if (!plan?.siteScript?.steps?.length) return;
    const contrastAttribute = runtimeAttribute(scope, "contrast");
    const textColorAttribute = runtimeAttribute(scope, "text-color");
    for (const step of plan.siteScript.steps) {
      if (step.preset !== "contrast-support" && step.preset !== "text-color") continue;
      for (const element of scopedTextElements(step.target)) {
        if (!isVisible(element)) continue;
        const background = effectiveBackground(element);
        if (!background) continue;
        const styles = getComputedStyle(element);
        const opacity = Number.parseFloat(styles.opacity || "1");
        const effectiveOpacity = Number.isFinite(opacity) ? opacity : 1;
        const threshold = minimumContrast(element);

        if (step.preset === "contrast-support") {
          const parsedForeground = parseColor(styles.color);
          if (!parsedForeground) continue;
          const currentColor = blendWithBackground({ ...parsedForeground, a: parsedForeground.a * effectiveOpacity }, background);
          const currentRatio = contrastRatio(currentColor, background);
          if (currentRatio >= threshold) continue;
          const candidates = [
            { name: "dark", color: { r: 0, g: 0, b: 0, a: effectiveOpacity } },
            { name: "light", color: { r: 255, g: 255, b: 255, a: effectiveOpacity } }
          ].map((candidate) => ({
            ...candidate,
            ratio: contrastRatio(blendWithBackground(candidate.color, background), background)
          })).sort((first, second) => second.ratio - first.ratio);
          const best = candidates[0];
          if (best.ratio >= threshold && best.ratio > currentRatio) {
            element.setAttribute(contrastAttribute, best.name);
            runtimeAdjusted[scope].add(element);
          }
          continue;
        }

        const requested = hexColor(step.parameters.color);
        const alias = TEXT_COLOR_ALIASES[step.parameters.color];
        if (!requested || !alias) continue;
        const requestedEffective = blendWithBackground({ ...requested, a: effectiveOpacity }, background);
        if (contrastRatio(requestedEffective, background) >= threshold) {
          element.setAttribute(textColorAttribute, alias);
          runtimeAdjusted[scope].add(element);
        }
      }
    }
  }

  function hasActionablePlan(plan) {
    const validPlan = validatePlan(plan);
    return Boolean(validPlan?.siteScript?.steps?.length);
  }

  function compileStep(step, planScope) {
    const selector = selectorFor(step.target);
    const p = step.parameters;
    switch (step.preset) {
      case "readable-text":
        return `${selector} { font-size: calc(1em * ${p.scale}) !important; }`;
      case "reading-spacing":
        return `${selector} { line-height: ${p.lineHeight} !important; letter-spacing: ${p.letterSpacing}px !important; }`;
      case "focus-ring":
        return `${SELECTORS["interactive-elements"]}:focus-visible { outline: ${p.width}px solid #005fcc !important; outline-offset: ${p.offset}px !important; }`;
      case "link-clarity":
        return `${SELECTORS.links} { text-decoration-line: underline !important; text-decoration-thickness: max(2px, 0.12em) !important; text-underline-offset: 0.16em !important; }`;
      case "control-boundaries":
        return `${SELECTORS.controls} { border: ${p.width}px solid currentColor !important; }`;
      case "contrast-support": {
        const attribute = runtimeAttribute(planScope, "contrast");
        return `:where([${attribute}="dark"]) { color: #000000 !important; }\n:where([${attribute}="light"]) { color: #ffffff !important; }`;
      }
      case "reduced-motion":
        return ":where(*, *::before, *::after) { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: 0.01ms !important; }";
      case "large-controls":
        return `${CONTROL_SIZE_SELECTOR} { box-sizing: border-box !important; min-block-size: ${p.minimumSize}px !important; min-inline-size: ${p.minimumSize}px !important; padding-block: max(0.45em, 6px) !important; padding-inline: max(0.7em, 10px) !important; font-size: max(1em, 16px) !important; line-height: 1.25 !important; }`;
      case "content-width":
        return `${SELECTORS["main-content"]} { max-width: ${p.maxWidth}ch !important; }`;
      case "navigation-clarity":
        return `${NAVIGATION_SELECTOR} { line-height: 1.35 !important; }\n${NAVIGATION_SELECTOR} :where(a[href], button, [role="link"], [role="button"], [role="menuitem"], [role="tab"]) { min-block-size: 40px !important; padding-block: max(0.3em, 4px) !important; padding-inline: max(0.55em, 8px) !important; margin: 2px !important; }`;
      case "form-legibility":
        return `${FORM_SELECTOR} :where(label, legend) { display: block !important; font-weight: 700 !important; line-height: 1.4 !important; margin-block-end: 0.35rem !important; }\n${FORM_SELECTOR} ${FORM_CONTROL_SELECTOR} { min-block-size: 44px !important; font-size: max(1em, 16px) !important; line-height: 1.3 !important; padding: max(0.45em, 6px) max(0.6em, 9px) !important; }`;
      case "heading-clarity":
        return `${SELECTORS["main-content"]} :where(h1, h2, h3, h4, h5, h6) { line-height: 1.22 !important; scroll-margin-block-start: 1rem !important; }\n${SELECTORS["main-content"]} :where(h2, h3, h4, h5, h6) { margin-block-start: 1.35em !important; }`;
      case "text-color": {
        const alias = TEXT_COLOR_ALIASES[p.color];
        const attribute = runtimeAttribute(planScope, "text-color");
        return alias ? `:where([${attribute}="${alias}"]) { color: ${p.color} !important; }` : "";
      }
      default:
        return "";
    }
  }

  function compilePlan(plan) {
    const validPlan = validatePlan(plan);
    if (!validPlan) return null;
    const css = validPlan.siteScript.steps.map((step) => compileStep(step, validPlan.planScope)).filter(Boolean).join("\n");
    if (!css || css.length > 12_000) return null;
    return {
      css: `@layer easyweb-ai-${validPlan.planScope} {\n${css}\n}`,
      handlerVersion: HANDLER_VERSION,
      planId: validPlan.planId,
      planScope: validPlan.planScope,
      siteScriptVersion: SITE_SCRIPT_VERSION
    };
  }

  function installCompiledStyle(scope, compiled) {
    const style = document.getElementById(STYLE_IDS[scope]) || document.createElement("style");
    style.id = STYLE_IDS[scope];
    style.dataset.easywebAiPlan = compiled.planId;
    style.dataset.easywebSiteScript = String(SITE_SCRIPT_VERSION);
    style.textContent = compiled.css;
    if (!style.isConnected) (document.head || document.documentElement).append(style);
    return style;
  }

  function retainActiveStyles() {
    retentionQueued = false;
    startRetention();
    for (const scope of Object.keys(activeCompiled)) {
      const compiled = activeCompiled[scope];
      if (!compiled) continue;
      const style = document.getElementById(STYLE_IDS[scope]);
      if (!style || style.dataset?.easywebAiPlan !== compiled.planId || style.textContent !== compiled.css) {
        installCompiledStyle(scope, compiled);
      }
    }
    for (const scope of Object.keys(activePlans)) {
      if (activePlans[scope]) applyRuntimeAdjustments(scope, activePlans[scope]);
    }
  }

  function scheduleRetention() {
    if (retentionQueued) return;
    retentionQueued = true;
    if (typeof queueMicrotask === "function") {
      queueMicrotask(retainActiveStyles);
      return;
    }
    Promise.resolve().then(retainActiveStyles);
  }

  function startRetention() {
    if (typeof MutationObserver !== "function" || !document.documentElement) return;
    if (retentionObserver && retainedHead === document.head) return;
    retentionObserver?.disconnect();
    retentionObserver = new MutationObserver(scheduleRetention);
    retentionObserver.observe(document.documentElement, { childList: true });
    if (document.head && document.head !== document.documentElement) {
      retentionObserver.observe(document.head, { childList: true });
    }
    retainedHead = document.head;
  }

  function stopRetention() {
    retentionObserver?.disconnect();
    retentionObserver = undefined;
    retainedHead = undefined;
    retentionQueued = false;
  }

  function remove(scope) {
    activeCompiled[scope] = null;
    activePlans[scope] = null;
    clearRuntimeAdjustments(scope);
    document.getElementById(STYLE_IDS[scope])?.remove();
    if (!activeCompiled.base && !activeCompiled.personal) stopRetention();
  }

  function apply(plan) {
    const validPlan = validatePlan(plan);
    if (!validPlan) return { applied: false, reason: "invalid-plan" };
    if (!validPlan.siteScript.steps.length) return { applied: false, reason: "empty-plan" };
    const compiled = compilePlan(validPlan);
    if (!compiled) return { applied: false, reason: "invalid-plan" };
    activeCompiled[compiled.planScope] = compiled;
    activePlans[compiled.planScope] = validPlan;
    installCompiledStyle(compiled.planScope, compiled);
    applyRuntimeAdjustments(compiled.planScope, validPlan);
    startRetention();
    return { applied: true, compiled };
  }

  function applyCached(plan, cached) {
    const validPlan = validatePlan(plan);
    if (!validPlan || !validPlan.siteScript.steps.length || !isPlainObject(cached) || cached.handlerVersion !== HANDLER_VERSION ||
      cached.siteScriptVersion !== SITE_SCRIPT_VERSION || typeof cached.css !== "string" || cached.css.length > 12_000 ||
      !cached.css.startsWith(`@layer easyweb-ai-${validPlan.planScope} {`)) {
      return { applied: false, reason: "invalid-cache" };
    }
    const compiled = { ...cached, planId: validPlan.planId, planScope: validPlan.planScope };
    activeCompiled[validPlan.planScope] = compiled;
    activePlans[validPlan.planScope] = validPlan;
    installCompiledStyle(validPlan.planScope, compiled);
    applyRuntimeAdjustments(validPlan.planScope, validPlan);
    startRetention();
    return { applied: true, compiled };
  }

  function clear() {
    remove("base");
    remove("personal");
  }

  globalThis.EasyWebAiAdaptationHandler = Object.freeze({
    HANDLER_VERSION,
    SITE_SCRIPT_VERSION,
    validatePlan,
    hasActionablePlan,
    compilePlan,
    apply,
    applyCached,
    remove,
    clear
  });
})();
