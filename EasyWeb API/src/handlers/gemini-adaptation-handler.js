import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-3.8-flash";
const PROMPT_VERSION = "easyweb-site-script-v3";
const SITE_SCRIPT_VERSION = 1;
const MAX_STEPS = 8;
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 60_000;
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
const ALLOWED_TEXT_COLORS = Object.freeze({
  blue: "#005fcc",
  azul: "#005fcc",
  red: "#b00020",
  vermelho: "#b00020",
  green: "#006b3c",
  verde: "#006b3c",
  black: "#000000",
  preto: "#000000",
  white: "#ffffff",
  branco: "#ffffff",
  purple: "#6a1b9a",
  roxo: "#6a1b9a"
});

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    confidence: { type: "number" },
    summary: { type: "string" },
    siteScript: {
      type: "object",
      properties: {
        version: { type: "integer", enum: [SITE_SCRIPT_VERSION] },
        triggers: { type: "array", items: { type: "string", enum: [...ALLOWED_TRIGGERS] } },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["apply-style"] },
              target: { type: "string", enum: [...ALLOWED_SCOPES] },
              preset: { type: "string", enum: [...ALLOWED_PRESETS] },
              parameters: { type: "object" }
            },
            required: ["type", "target", "preset", "parameters"]
          }
        }
      },
      required: ["version", "triggers", "steps"]
    }
  },
  required: ["confidence", "summary", "siteScript"]
};

const SYSTEM_INSTRUCTION = [
  "Voce cria EasyWebSiteScriptV1 para melhorar acessibilidade de uma pagina.",
  "Analise somente snapshots estruturais protegidos e responda somente com JSON valido no schema solicitado.",
  "Nao escreva JavaScript, HTML, CSS livre, URLs, seletores CSS, instrucoes de rede, comandos ou codigo executavel.",
  "siteScript deve ter version 1, triggers e steps. Use document-ready em todos os scripts; inclua route-change somente quando a pagina puder trocar de rota sem recarregar.",
  "Cada step deve ser apenas { type: apply-style, target, preset, parameters }. Os targets permitidos sao main-content, interactive-elements, links, controls e document.",
  "Os presets permitidos sao readable-text, reading-spacing, focus-ring, link-clarity, control-boundaries, contrast-support, reduced-motion, large-controls, content-width, navigation-clarity, form-legibility, heading-clarity e text-color.",
  "Use no maximo 8 steps. Parametros aceitos: readable-text.scale 0.9-1.35; reading-spacing.lineHeight 1.35-2 e letterSpacing 0-2; focus-ring.width 2-4 e offset 1-5; control-boundaries.width 1-3; large-controls.minimumSize 36-48; content-width.maxWidth 42-90; text-color.color deve ser uma das cores seguras informadas no contrato. Os demais presets usam objeto vazio.",
  "Quando planScope for personal, userRequest e a prioridade. Ela deve gerar uma alteracao verificavel: reading-difficulty usa readable-text, reading-spacing ou heading-clarity; small-controls usa large-controls em controls; navigation-confusion usa navigation-clarity, focus-ring ou link-clarity; form-difficulty usa form-legibility; low-contrast usa contrast-support, link-clarity ou control-boundaries; text-color usa text-color em document.",
  "large-controls aumenta o tamanho visual e a area de acionamento de botoes, campos e controles compativeis. Use minimumSize 48 quando o usuario pedir botoes ou controles maiores.",
  "Nunca remova conteudo, altere formularios, clique em acoes, mude URLs, acesse dados do usuario ou desative controles.",
  "Para planos base, sem evidencia de melhoria segura, devolva steps vazios e explique em summary. Para planos pessoais, devolva steps vazios somente se o pedido nao puder ser atendido com seguranca."
].join("\n");

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, minimum), maximum) : fallback;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function statusCode(error) {
  const candidates = [error?.status, error?.statusCode, error?.response?.status];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isInteger(parsed)) return parsed;
  }
  return 0;
}

function isRetryableProviderError(error) {
  if (error?.code === "EASYWEB_GEMINI_INVALID_RESPONSE") return false;
  if (error?.name === "AbortError" || error?.code === "EASYWEB_GEMINI_TIMEOUT") return true;
  const status = statusCode(error);
  return status === 408 || status === 429 || status >= 500 ||
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(error?.code);
}

function createGeminiError(error, { code, retryable, message }) {
  const normalized = new Error(message || error?.message || "Falha na analise do Gemini.");
  normalized.code = code;
  normalized.retryable = retryable;
  normalized.cause = error;
  return normalized;
}

function normalizeParameters(preset, source) {
  const parameters = plainObject(source) ? source : {};
  switch (preset) {
    case "readable-text":
      return { scale: clamp(parameters.scale, 0.9, 1.35, 1.15) };
    case "reading-spacing":
      return {
        lineHeight: clamp(parameters.lineHeight, 1.35, 2, 1.6),
        letterSpacing: clamp(parameters.letterSpacing, 0, 2, 0.3)
      };
    case "focus-ring":
      return { width: clamp(parameters.width, 2, 4, 3), offset: clamp(parameters.offset, 1, 5, 3) };
    case "control-boundaries":
      return { width: clamp(parameters.width, 1, 3, 2) };
    case "large-controls":
      return { minimumSize: clamp(parameters.minimumSize, 36, 48, 40) };
    case "content-width":
      return { maxWidth: clamp(parameters.maxWidth, 42, 90, 68) };
    case "text-color": {
      const requested = String(parameters.color || "").trim().toLowerCase();
      const allowedHex = Object.values(ALLOWED_TEXT_COLORS);
      return { color: ALLOWED_TEXT_COLORS[requested] || (allowedHex.includes(requested) ? requested : "#005fcc") };
    }
    default:
      return {};
  }
}

function legacyActionsToSiteScript(actions) {
  const steps = (Array.isArray(actions) ? actions : []).slice(0, MAX_STEPS).flatMap((action) => {
    if (!plainObject(action) || !ALLOWED_SCOPES.has(action.scope)) return [];
    const parameters = plainObject(action.parameters) ? action.parameters : {};
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
      if (!plainObject(rule)) return [];
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
  const source = plainObject(value) ? value : legacyActionsToSiteScript(legacyActions);
  if (source.version !== SITE_SCRIPT_VERSION) return null;
  const triggers = [...new Set((Array.isArray(source.triggers) ? source.triggers : [])
    .filter((trigger) => ALLOWED_TRIGGERS.has(trigger)))];
  if (!triggers.includes("document-ready")) triggers.unshift("document-ready");
  const steps = (Array.isArray(source.steps) ? source.steps : []).slice(0, MAX_STEPS).flatMap((step) => {
    if (!plainObject(step) || step.type !== "apply-style" ||
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

export function normalizeGeneratedPlan(value, { planScope = "base" } = {}) {
  if (!plainObject(value) || (planScope !== "base" && planScope !== "personal")) {
    throw createGeminiError(null, {
      code: "EASYWEB_GEMINI_INVALID_RESPONSE",
      retryable: false,
      message: "A IA nao retornou um plano JSON valido."
    });
  }
  const siteScript = normalizeSiteScript(value.siteScript, value.actions);
  if (!siteScript) {
    throw createGeminiError(null, {
      code: "EASYWEB_GEMINI_INVALID_RESPONSE",
      retryable: false,
      message: "A IA nao retornou um EasyWebSiteScriptV1 valido."
    });
  }
  return {
    confidence: clamp(value.confidence, 0, 1),
    summary: typeof value.summary === "string" ? value.summary.trim().slice(0, 420) : "",
    siteScript
  };
}

function createPrompt({ origin, snapshots, planScope, profile, basePlan, previousPersonalPlan, userRequest }) {
  return JSON.stringify({
    promptVersion: PROMPT_VERSION,
    origin,
    planScope,
    profile,
    siteScriptContract: {
      version: SITE_SCRIPT_VERSION,
      triggers: [...ALLOWED_TRIGGERS],
      stepType: "apply-style",
      targets: [...ALLOWED_SCOPES],
      presets: [...ALLOWED_PRESETS],
      textColors: [...new Set(Object.values(ALLOWED_TEXT_COLORS))],
      maxSteps: MAX_STEPS
    },
    basePlan: basePlan || null,
    previousPersonalPlan: previousPersonalPlan || null,
    userRequest: userRequest || null,
    personalRequestRequirements: planScope === "personal" ? {
      "reading-difficulty": ["readable-text", "reading-spacing", "content-width", "heading-clarity"],
      "navigation-confusion": ["navigation-clarity", "focus-ring", "link-clarity", "control-boundaries"],
      "small-controls": ["large-controls"],
      "form-difficulty": ["form-legibility"],
      "low-contrast": ["contrast-support", "link-clarity", "control-boundaries"],
      "text-color": ["text-color"]
    } : null,
    snapshots
  });
}

export function createGeminiAdaptationHandler({ environment = process.env, client, now = () => Date.now() } = {}) {
  const apiKey = String(environment.GEMINI_API_KEY || "").trim();
  const model = String(environment.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const ai = client || (apiKey ? new GoogleGenAI({ apiKey }) : null);
  const timeoutMs = readPositiveInteger(environment.GEMINI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const retryAttempts = readPositiveInteger(environment.GEMINI_RETRY_ATTEMPTS, DEFAULT_RETRY_ATTEMPTS);
  const circuitFailureThreshold = readPositiveInteger(environment.GEMINI_CIRCUIT_FAILURE_THRESHOLD, DEFAULT_CIRCUIT_FAILURE_THRESHOLD);
  const circuitCooldownMs = readPositiveInteger(environment.GEMINI_CIRCUIT_COOLDOWN_MS, DEFAULT_CIRCUIT_COOLDOWN_MS);
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  async function generate({
    origin,
    snapshots,
    planScope = "base",
    profile = "universal",
    basePlan = null,
    previousPersonalPlan = null,
    userRequest = null
  }) {
    if (!ai) {
      throw createGeminiError(null, {
        code: "EASYWEB_GEMINI_UNAVAILABLE",
        retryable: false,
        message: "GEMINI_API_KEY nao configurada."
      });
    }
    if (now() < circuitOpenUntil) {
      const error = createGeminiError(null, {
        code: "EASYWEB_GEMINI_CIRCUIT_OPEN",
        retryable: true,
        message: "O Gemini esta temporariamente indisponivel para novas analises."
      });
      error.retryAfterMs = circuitOpenUntil - now();
      throw error;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await ai.models.generateContent({
        model,
        contents: createPrompt({ origin, snapshots, planScope, profile, basePlan, previousPersonalPlan, userRequest }),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
          temperature: 0.15,
          abortSignal: controller.signal,
          httpOptions: {
            timeout: timeoutMs,
            retryOptions: {
              attempts: retryAttempts,
              initialDelay: 1,
              maxDelay: 8,
              expBase: 2,
              httpStatusCodes: [408, 429, 500, 502, 503, 504]
            }
          }
        }
      });
      const text = typeof response.text === "string" ? response.text : "";
      let generated;
      try {
        generated = JSON.parse(text);
      } catch (error) {
        throw createGeminiError(error, {
          code: "EASYWEB_GEMINI_INVALID_RESPONSE",
          retryable: false,
          message: "A IA retornou uma resposta que nao e JSON."
        });
      }
      const plan = normalizeGeneratedPlan(generated, { planScope });
      consecutiveFailures = 0;
      circuitOpenUntil = 0;
      return plan;
    } catch (error) {
      const timedOut = controller.signal.aborted;
      const retryable = timedOut || isRetryableProviderError(error);
      if (retryable) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= circuitFailureThreshold) circuitOpenUntil = now() + circuitCooldownMs;
      }
      throw createGeminiError(error, {
        code: timedOut ? "EASYWEB_GEMINI_TIMEOUT" : error?.code || "EASYWEB_GEMINI_REQUEST_FAILED",
        retryable,
        message: timedOut ? "A analise do Gemini excedeu o tempo limite." : error?.message
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return Object.freeze({
    configured: Boolean(ai),
    model,
    promptVersion: PROMPT_VERSION,
    timeoutMs,
    generate,
    normalizeGeneratedPlan
  });
}
