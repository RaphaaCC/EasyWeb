import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_HTML_CHARACTERS = 180_000;
const MAX_CSS_CHARACTERS = 160_000;
const SNAPSHOT_CAPTURE_VERSION = 1;
const MAX_TREE_NODES = 1_500;
const MAX_TREE_DEPTH = 12;
const MAX_CHILDREN_PER_NODE = 40;
const MAX_ORIGINS = 20;
const MAX_STYLE_TOKENS = 8;
const REMOVED_HTML_TAGS = new Set(["embed", "iframe", "noscript", "object", "script", "style", "template"]);

function createValidationError(message) {
  const error = new Error(message);
  error.code = "EASYWEB_INVALID_SNAPSHOT";
  return error;
}

function hash(value) {
  return createHash("sha256").update(value).digest();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePage(page) {
  if (!isPlainObject(page) || typeof page.origin !== "string" || typeof page.path !== "string") {
    throw createValidationError("O snapshot precisa informar origem e caminho da página.");
  }

  let origin;
  try {
    const url = new URL(page.origin);
    if (!/^https?:$/.test(url.protocol) || url.origin !== page.origin || url.username || url.password) {
      throw new Error("Origem inválida.");
    }
    origin = url.origin;
  } catch (error) {
    throw createValidationError("A origem do snapshot é inválida.");
  }

  if (!page.path.startsWith("/") || page.path.includes("?") || page.path.includes("#") ||
    page.path.length > 2048 || /[\u0000-\u001f\u007f]/.test(page.path)) {
    throw createValidationError("O caminho do snapshot é inválido.");
  }

  const path = page.path.split("/").map((segment) => {
    if (!segment || segment === ":id" || segment === ":private") return segment;
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch (error) {
      // A normalização abaixo ainda limita segmentos que pareçam identificadores.
    }
    if (/^\d{4,}$/.test(decoded)) return ":id";
    if (/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(decoded)) return ":id";
    if (decoded.includes("@") || /^[a-f\d]{16,}$/i.test(decoded) || /^[a-z\d_-]{24,}$/i.test(decoded)) {
      return ":private";
    }
    return segment.slice(0, 120);
  }).join("/");

  return { origin, path: path || "/" };
}

function normalizeStructuralHtml(value) {
  const source = typeof value === "string" ? value.slice(0, MAX_HTML_CHARACTERS) : "";
  const structuralTags = source.match(/<[^>]*>/g) || [];
  const sanitized = structuralTags.map((rawTag) => {
    const match = rawTag.match(/^<\s*(\/?)\s*([a-z][a-z\d-]{0,63})\b[^>]*>$/i);
    if (!match) {
      return "";
    }
    const [, closing, rawName] = match;
    const name = rawName.toLowerCase();
    if (REMOVED_HTML_TAGS.has(name)) {
      return "";
    }
    return closing ? `</${name}>` : `<${name}>`;
  }).join("");

  // A API retém somente a topologia de tags. Texto e todos os atributos são
  // descartados mesmo quando um cliente enviar um snapshot incompletamente limpo.
  return sanitized || "<html><body></body></html>";
}

function normalizeCss(value) {
  const source = typeof value === "string" ? value.slice(0, MAX_CSS_CHARACTERS) : "";
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[^;]*;/gi, "")
    .replace(/@font-face\s*\{[^}]*\}/gi, "")
    .replace(/url\([^)]*(?:\)|$)/gi, "url()")
    .replace(/\bcontent\s*:\s*[^;}]+[;}]/gi, "")
    .replace(/\b(?:behavior|expression)\s*:[^;}]+[;}]/gi, "")
    .replace(/javascript\s*:/gi, "")
    .trim();
}

function boundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, maximum) : 0;
}

function normalizeOrigins(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const origins = new Set();
  for (const value of values) {
    if (origins.size >= MAX_ORIGINS || typeof value !== "string") {
      continue;
    }
    try {
      const url = new URL(value);
      if (/^https?:$/.test(url.protocol) && url.origin === value) {
        origins.add(url.origin);
      }
    } catch (error) {
      // Valores inválidos são removidos do snapshot em vez de serem persistidos.
    }
  }
  return [...origins];
}

function normalizeStyleTokens(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const tokens = new Set();
  for (const value of values) {
    const token = typeof value === "string" ? value.trim() : "";
    if (tokens.size < MAX_STYLE_TOKENS && /^[#(),.%\w\s/"'-]{1,128}$/i.test(token)) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

function normalizeTree(value, state, depth = 0) {
  if (!isPlainObject(value) || state.nodeCount >= MAX_TREE_NODES || depth > MAX_TREE_DEPTH) {
    state.truncated = true;
    return null;
  }

  const tag = typeof value.tag === "string" ? value.tag.toLowerCase() : "";
  if (!/^[a-z][a-z\d-]{0,63}$/.test(tag)) {
    state.truncated = true;
    return null;
  }

  state.nodeCount += 1;
  const node = { tag };
  if (typeof value.role === "string" && /^[a-z-]{1,64}$/.test(value.role)) {
    node.role = value.role;
  }
  if (value.landmark === true) {
    node.landmark = true;
  }
  if (value.interactive === true) {
    node.interactive = true;
  }
  if (Number.isInteger(value.headingLevel) && value.headingLevel >= 1 && value.headingLevel <= 6) {
    node.headingLevel = value.headingLevel;
  }

  if (Array.isArray(value.children)) {
    const children = value.children
      .slice(0, MAX_CHILDREN_PER_NODE)
      .map((child) => normalizeTree(child, state, depth + 1))
      .filter(Boolean);
    if (value.children.length > MAX_CHILDREN_PER_NODE) {
      state.truncated = true;
    }
    if (children.length > 0) {
      node.children = children;
    }
  }
  return node;
}

function normalizeStructure(value) {
  const source = isPlainObject(value) ? value : {};

  const state = { nodeCount: 0, truncated: source.truncated === true };
  const tree = normalizeTree(source.tree, state) || { tag: "html" };
  return { nodeCount: state.nodeCount, truncated: state.truncated, tree };
}

function normalizeStyles(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    styleSheetCount: boundedInteger(source.styleSheetCount, 10_000),
    inlineStyleCount: boundedInteger(source.inlineStyleCount, 10_000),
    externalStyleSheetCount: boundedInteger(source.externalStyleSheetCount, 10_000),
    externalOrigins: normalizeOrigins(source.externalOrigins),
    colors: normalizeStyleTokens(source.colors),
    fontFamilies: normalizeStyleTokens(source.fontFamilies),
    fontSizes: normalizeStyleTokens(source.fontSizes),
    lineHeights: normalizeStyleTokens(source.lineHeights)
  };
}

function normalizeScripts(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    total: boundedInteger(source.total, 10_000),
    inlineCount: boundedInteger(source.inlineCount, 10_000),
    externalCount: boundedInteger(source.externalCount, 10_000),
    moduleCount: boundedInteger(source.moduleCount, 10_000),
    asyncCount: boundedInteger(source.asyncCount, 10_000),
    deferCount: boundedInteger(source.deferCount, 10_000),
    externalOrigins: normalizeOrigins(source.externalOrigins)
  };
}

function normalizeSnapshot(snapshot) {
  if (!isPlainObject(snapshot) || snapshot.captureVersion !== SNAPSHOT_CAPTURE_VERSION) {
    throw createValidationError("A versão do snapshot não é suportada.");
  }

  const page = normalizePage(snapshot.page);
  const normalized = {
    captureVersion: SNAPSHOT_CAPTURE_VERSION,
    page,
    structure: normalizeStructure(snapshot.structure),
    html: normalizeStructuralHtml(snapshot.html),
    css: normalizeCss(snapshot.css),
    styles: normalizeStyles(snapshot.styles),
    scripts: normalizeScripts(snapshot.scripts)
  };
  const serialized = JSON.stringify(normalized);
  const payload = Buffer.from(serialized, "utf8");
  if (payload.byteLength > MAX_SNAPSHOT_BYTES) {
    throw createValidationError("O snapshot excede o limite de 512KB.");
  }

  return { normalized, serialized, payload };
}

export function createSiteSnapshotHandler({ database } = {}) {
  function prepare({ installationId, snapshot }) {
    if (typeof installationId !== "string" || !/^[a-z\d-]{16,128}$/i.test(installationId)) {
      throw createValidationError("A identificação da instalação é inválida.");
    }
    const { normalized, serialized, payload } = normalizeSnapshot(snapshot);
    return {
      installationId,
      normalized,
      payload,
      contentHash: hash(serialized),
      templateHash: hash(JSON.stringify({
      css: normalized.css,
      styles: normalized.styles,
      scripts: normalized.scripts
      }))
    };
  }

  async function store(input) {
    if (!database?.configured) {
      const error = new Error("MySQL não está configurado para receber snapshots.");
      error.code = "EASYWEB_DATABASE_UNAVAILABLE";
      throw error;
    }

    const prepared = prepare(input);
    const { installationId, normalized, payload, contentHash, templateHash } = prepared;
    const compressedPayload = gzipSync(payload);
    await database.query(
      `INSERT INTO easyweb_site_snapshots (
        installation_hash, origin_hash, path_hash, template_hash, content_hash, site_origin, page_path,
        capture_version, payload_encoding, payload_bytes, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        capture_count = capture_count + 1,
        last_seen_at = CURRENT_TIMESTAMP`,
      [
        hash(installationId),
        hash(normalized.page.origin),
        hash(normalized.page.path),
        templateHash,
        contentHash,
        normalized.page.origin,
        normalized.page.path,
        normalized.captureVersion,
        "gzip-json",
        payload.byteLength,
        compressedPayload
      ]
    );

    return {
      stored: true,
      page: normalized.page,
      contentHash: contentHash.toString("hex"),
      templateHash: templateHash.toString("hex"),
      payloadBytes: payload.byteLength
    };
  }

  async function deleteForInstallation({ installationId, retentionHandler } = {}) {
    if (typeof installationId !== "string" || !/^[a-z\d-]{16,128}$/i.test(installationId)) {
      throw createValidationError("A identificacao da instalacao e invalida.");
    }
    if (!retentionHandler?.deleteInstallationSnapshots) {
      throw Object.assign(new Error("Retencao de snapshots indisponivel."), { code: "EASYWEB_RETENTION_UNAVAILABLE" });
    }
    return retentionHandler.deleteInstallationSnapshots(hash(installationId));
  }

  return Object.freeze({ prepare, store, deleteForInstallation });
}
