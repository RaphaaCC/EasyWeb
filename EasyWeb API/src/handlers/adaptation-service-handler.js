import { createHash, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createAiRequestQueue } from "./ai-request-queue-handler.js";

const FAMILY_SIMILARITY_THRESHOLD = 0.72;
const MAX_CANDIDATE_SNAPSHOTS = 8;
const PLAN_TTL_DAYS = 30;
const MIN_TRUSTED_TREE_NODES = 2;
const MIN_SINGLE_INSTALLATION_OBSERVATION_MS = 10 * 60_000;
const STATIC_FAMILY_MIN_SAMPLES = 2;
const DYNAMIC_FAMILY_MIN_SAMPLES = 3;
const FAMILY_CONFIDENCE_THRESHOLD = 0.72;
const DYNAMIC_FAMILY_THRESHOLD = 0.45;
const MIN_OPPORTUNITY_SCORE = 0.15;
const MAX_BASE_JOB_ATTEMPTS = 4;
const STALE_JOB_LOCK_MINUTES = 5;
const MAX_SITE_SCRIPT_STEPS = 8;
const PERSONAL_INTENT_TAGS = new Set([
  "reading-difficulty",
  "navigation-confusion",
  "small-controls",
  "form-difficulty",
  "low-contrast",
  "text-color"
]);
const PERSONAL_INTENT_PRESETS = Object.freeze({
  "reading-difficulty": new Set(["readable-text", "reading-spacing", "content-width", "heading-clarity"]),
  "navigation-confusion": new Set(["navigation-clarity", "focus-ring", "link-clarity", "control-boundaries"]),
  "small-controls": new Set(["large-controls"]),
  "form-difficulty": new Set(["form-legibility"]),
  "low-contrast": new Set(["contrast-support", "link-clarity", "control-boundaries"]),
  "text-color": new Set(["text-color"])
});
const PERSONAL_TEXT_COLORS = Object.freeze({
  azul: "#005fcc",
  blue: "#005fcc",
  vermelho: "#b00020",
  red: "#b00020",
  verde: "#006b3c",
  green: "#006b3c",
  preto: "#000000",
  black: "#000000",
  branco: "#ffffff",
  white: "#ffffff",
  roxo: "#6a1b9a",
  purple: "#6a1b9a"
});

function hash(value) {
  return createHash("sha256").update(value).digest();
}

function hex(value) {
  return Buffer.isBuffer(value) ? value.toString("hex") : Buffer.from(value || []).toString("hex");
}

function toDateString(days, now) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function flattenTree(node, summary = { tags: new Map(), interactive: 0, landmarks: 0, headings: 0, total: 0 }) {
  if (!node || typeof node !== "object") return summary;
  const tag = typeof node.tag === "string" ? node.tag : "unknown";
  summary.tags.set(tag, (summary.tags.get(tag) || 0) + 1);
  summary.total += 1;
  if (node.interactive === true) summary.interactive += 1;
  if (node.landmark === true) summary.landmarks += 1;
  if (Number.isInteger(node.headingLevel)) summary.headings += 1;
  for (const child of Array.isArray(node.children) ? node.children : []) flattenTree(child, summary);
  return summary;
}

function jaccard(left, right) {
  const tags = new Set([...left.tags.keys(), ...right.tags.keys()]);
  if (tags.size === 0) return 1;
  let intersection = 0;
  let union = 0;
  for (const tag of tags) {
    intersection += Math.min(left.tags.get(tag) || 0, right.tags.get(tag) || 0);
    union += Math.max(left.tags.get(tag) || 0, right.tags.get(tag) || 0);
  }
  return union ? intersection / union : 1;
}

function closeness(left, right) {
  const maximum = Math.max(left, right, 1);
  return 1 - Math.abs(left - right) / maximum;
}

export function calculateStructuralSimilarity(leftSnapshot, rightSnapshot) {
  const left = flattenTree(leftSnapshot?.structure?.tree);
  const right = flattenTree(rightSnapshot?.structure?.tree);
  return Number((
    jaccard(left, right) * 0.55 +
    closeness(left.total, right.total) * 0.2 +
    closeness(left.interactive, right.interactive) * 0.1 +
    closeness(left.landmarks, right.landmarks) * 0.1 +
    closeness(left.headings, right.headings) * 0.05
  ).toFixed(5));
}

function summarizeSnapshot(snapshot) {
  const structure = flattenTree(snapshot.structure?.tree);
  return {
    tags: [...structure.tags.entries()].sort(([a], [b]) => a.localeCompare(b)),
    interactive: structure.interactive,
    landmarks: structure.landmarks,
    headings: structure.headings,
    total: structure.total,
    styles: snapshot.styles,
    scripts: snapshot.scripts
  };
}

function parseSnapshotRow(row) {
  try {
    const payload = gunzipSync(row.payload).toString("utf8");
    return {
      sampleKey: row.id ? `id:${row.id}` : `path:${hex(row.path_hash)}:${hex(row.content_hash)}`,
      installationHash: hex(row.installation_hash),
      contentHash: hex(row.content_hash),
      templateHash: hex(row.template_hash),
      createdAt: timestamp(row.created_at),
      lastSeenAt: timestamp(row.last_seen_at),
      snapshot: JSON.parse(payload)
    };
  } catch {
    return null;
  }
}

function parsedPairs(rows) {
  const snapshots = rows.map(parseSnapshotRow).filter(Boolean);
  const pairs = [];
  for (let leftIndex = 0; leftIndex < snapshots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < snapshots.length; rightIndex += 1) {
      const left = snapshots[leftIndex];
      const right = snapshots[rightIndex];
      if (left.sampleKey === right.sampleKey) continue;
      pairs.push({ left, right, similarity: calculateStructuralSimilarity(left.snapshot, right.snapshot) });
    }
  }
  return pairs;
}

function findBestPair(rows) {
  return parsedPairs(rows).reduce((best, pair) => !best || pair.similarity > best.similarity ? pair : best, null);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function parsePixelSize(value) {
  const match = typeof value === "string" && value.trim().match(/^(\d+(?:\.\d+)?)px$/i);
  return match ? Number(match[1]) : null;
}

function assessSnapshotDynamism(snapshot) {
  const scripts = snapshot?.scripts || {};
  const structure = flattenTree(snapshot?.structure?.tree);
  const totalScripts = Number(scripts.total) || 0;
  const moduleScripts = Number(scripts.moduleCount) || 0;
  const asyncScripts = Number(scripts.asyncCount) || 0;
  const pressure = totalScripts / Math.max(12, structure.total * 2);
  return Number(clamp(
    pressure * 0.45 + (moduleScripts > 0 ? 0.15 : 0) + (asyncScripts >= 3 ? 0.1 : 0) +
    (snapshot?.structure?.truncated === true ? 0.25 : 0)
  ).toFixed(5));
}

function assessSnapshotOpportunity(snapshot) {
  const structure = flattenTree(snapshot?.structure?.tree);
  const styles = snapshot?.styles || {};
  const fontSizes = Array.isArray(styles.fontSizes) ? styles.fontSizes.map(parsePixelSize).filter(Number.isFinite) : [];
  const hasStyleEvidence = fontSizes.length > 0 || (Array.isArray(styles.colors) && styles.colors.length > 0);
  let score = 0;
  if (structure.landmarks === 0) score += 0.35;
  if (structure.headings === 0) score += 0.2;
  if (structure.interactive >= 6) score += 0.1;
  if (fontSizes.some((size) => size < 14)) score += 0.35;
  // Missing style details are inconclusive, not evidence that a page needs no help.
  if (score === 0 && !hasStyleEvidence) score = 0.2;
  return Number(clamp(score).toFixed(5));
}

function createPairs(snapshots) {
  const pairs = [];
  for (let leftIndex = 0; leftIndex < snapshots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < snapshots.length; rightIndex += 1) {
      const left = snapshots[leftIndex];
      const right = snapshots[rightIndex];
      if (left.sampleKey === right.sampleKey) continue;
      pairs.push({ left, right, similarity: calculateStructuralSimilarity(left.snapshot, right.snapshot) });
    }
  }
  return pairs;
}

function createFamilyCandidate(rows) {
  const snapshots = rows.map(parseSnapshotRow).filter(Boolean);
  const allPairs = createPairs(snapshots).sort((left, right) => right.similarity - left.similarity);
  if (!allPairs.length) return { state: "awaiting-second-snapshot" };

  const seed = allPairs.find((pair) => pair.similarity >= FAMILY_SIMILARITY_THRESHOLD);
  if (!seed) {
    return { state: "awaiting-compatible-snapshot", similarity: allPairs[0].similarity };
  }

  const members = snapshots.filter((candidate) => candidate.sampleKey === seed.left.sampleKey ||
    candidate.sampleKey === seed.right.sampleKey ||
    (calculateStructuralSimilarity(candidate.snapshot, seed.left.snapshot) >= FAMILY_SIMILARITY_THRESHOLD &&
      calculateStructuralSimilarity(candidate.snapshot, seed.right.snapshot) >= FAMILY_SIMILARITY_THRESHOLD));
  const pairs = createPairs(members).filter((pair) => pair.similarity >= FAMILY_SIMILARITY_THRESHOLD);
  const pair = pairs.sort((left, right) => right.similarity - left.similarity)[0] || seed;
  const stabilityScore = median(pairs.map((candidate) => candidate.similarity));
  const sampleCount = members.length;
  const distinctPathCount = new Set(members.map((member) => member.snapshot.page?.path).filter(Boolean)).size;
  const installationCount = new Set(members.map((member) => member.installationHash).filter(Boolean)).size;
  const firstObservedAt = Math.min(...members.map((member) => member.createdAt || Infinity));
  const lastObservedAt = Math.max(...members.map((member) => member.lastSeenAt || 0));
  const observationMs = Number.isFinite(firstObservedAt) ? Math.max(0, lastObservedAt - firstObservedAt) : 0;
  const dynamismScore = average(members.map((member) => assessSnapshotDynamism(member.snapshot)));
  const opportunityScore = average(members.map((member) => assessSnapshotOpportunity(member.snapshot)));
  const dynamic = dynamismScore >= DYNAMIC_FAMILY_THRESHOLD;
  const requiredSamples = dynamic ? DYNAMIC_FAMILY_MIN_SAMPLES : STATIC_FAMILY_MIN_SAMPLES;
  const independentEvidence = installationCount >= 2;
  const routeEvidence = distinctPathCount >= 2;
  const temporalEvidence = observationMs >= MIN_SINGLE_INSTALLATION_OBSERVATION_MS;
  const evidenceSatisfied = dynamic
    ? sampleCount >= requiredSamples && (independentEvidence || routeEvidence || temporalEvidence)
    : sampleCount >= requiredSamples && (independentEvidence || routeEvidence || temporalEvidence);
  const confidenceScore = Number(clamp(
    stabilityScore * 0.55 +
    Math.min(sampleCount / requiredSamples, 1) * 0.2 +
    (independentEvidence ? 0.15 : routeEvidence ? 0.1 : 0) +
    (temporalEvidence ? 0.1 : 0) -
    (dynamic ? 0.03 : 0)
  ).toFixed(5));
  const reason = !evidenceSatisfied
    ? dynamic && sampleCount < requiredSamples
      ? "dynamic-family-needs-more-snapshots"
      : "awaiting-independent-route-or-time-evidence"
    : confidenceScore < FAMILY_CONFIDENCE_THRESHOLD
      ? "family-confidence-below-threshold"
      : opportunityScore < MIN_OPPORTUNITY_SCORE
        ? "no-safe-accessibility-opportunity"
        : "eligible";
  const confidence = {
    score: confidenceScore,
    stabilityScore: Number(stabilityScore.toFixed(5)),
    dynamismScore: Number(dynamismScore.toFixed(5)),
    opportunityScore: Number(opportunityScore.toFixed(5)),
    sampleCount,
    requiredSamples,
    distinctPathCount,
    installationCount,
    observationMs,
    dynamic,
    reason
  };
  const trust = {
    trusted: evidenceSatisfied && confidenceScore >= FAMILY_CONFIDENCE_THRESHOLD,
    basis: independentEvidence ? "independent-installations" : routeEvidence ? "distinct-routes" : temporalEvidence ? "time-observed" : null,
    observationMs
  };
  const adaptationFingerprint = createAdaptationFingerprint(pair.left.snapshot.page.origin, pair);
  if (!evidenceSatisfied || confidenceScore < FAMILY_CONFIDENCE_THRESHOLD) {
    return { state: "awaiting-family-confidence", pair, adaptationFingerprint, similarity: stabilityScore, confidence, trust };
  }
  if (opportunityScore < MIN_OPPORTUNITY_SCORE) {
    return { state: "family-stable-no-opportunity", pair, adaptationFingerprint, similarity: stabilityScore, confidence, trust };
  }
  return { state: "eligible", pair, adaptationFingerprint, similarity: stabilityScore, confidence, trust };
}

function publicCandidate(candidate) {
  const { pair, adaptationFingerprint, ...publicValue } = candidate;
  return publicValue;
}

export function assessSnapshotPairTrust(pair) {
  if (!pair) return { trusted: false, reason: "awaiting-second-snapshot" };
  const leftSummary = flattenTree(pair.left.snapshot.structure?.tree);
  const rightSummary = flattenTree(pair.right.snapshot.structure?.tree);
  if (leftSummary.total < MIN_TRUSTED_TREE_NODES || rightSummary.total < MIN_TRUSTED_TREE_NODES) {
    return { trusted: false, reason: "insufficient-structure" };
  }
  if (pair.left.installationHash && pair.right.installationHash && pair.left.installationHash !== pair.right.installationHash) {
    return { trusted: true, basis: "independent-installations" };
  }

  const differentPaths = pair.left.snapshot.page?.path !== pair.right.snapshot.page?.path;
  const firstObservedAt = Math.min(pair.left.createdAt || Infinity, pair.right.createdAt || Infinity);
  const lastObservedAt = Math.max(pair.left.lastSeenAt, pair.right.lastSeenAt);
  const observationMs = Number.isFinite(firstObservedAt) ? Math.max(0, lastObservedAt - firstObservedAt) : 0;
  if (differentPaths && observationMs >= MIN_SINGLE_INSTALLATION_OBSERVATION_MS) {
    return { trusted: true, basis: "stable-cross-route-observation", observationMs };
  }
  return {
    trusted: false,
    reason: "awaiting-independent-or-stable-snapshot",
    observationMs
  };
}

function createAdaptationFingerprint(origin, pair) {
  const summaries = [summarizeSnapshot(pair.left.snapshot), summarizeSnapshot(pair.right.snapshot)]
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return hash(JSON.stringify({ origin, summaries })).toString("hex");
}

function parsePlan(row) {
  try {
    return JSON.parse(row.plan_json);
  } catch {
    return null;
  }
}

function createPlanKey(origin, adaptationFingerprint, version) {
  const host = new URL(origin).hostname.replace(/[^a-z\d.-]/gi, "-");
  return `base:${host}:${adaptationFingerprint.slice(0, 16)}:v${version}`;
}

function affectedRows(result) {
  return Number(result?.rows?.affectedRows) || 0;
}

function retryDelaySeconds(attempts) {
  return Math.min(60 * (2 ** Math.max(0, attempts - 1)), 3_600);
}

function createServiceError(code, retryable) {
  const error = new Error(code);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function normalizedSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inferPersonalIntentTags(text) {
  const source = normalizedSearchText(text);
  const tags = [];
  if (/(?:nao consigo ler|leitura|texto|fonte|letras?|legibil)/.test(source)) {
    tags.push("reading-difficulty");
  }
  if (/(?:navega|menu|confus|encontrar|organiz)/.test(source)) {
    tags.push("navigation-confusion");
  }
  if (/(?:bot(?:ao|oes)|button|controles?|clic(?:ar|avel|aveis)|toque|alvo)/.test(source)) {
    tags.push("small-controls");
  }
  if (/(?:\bformulario\b|\bform\b|\bcampo(?:s)?\b|\bpreench|\bcadastro\b|\bdigitar\b)/.test(source)) {
    tags.push("form-difficulty");
  }
  if (/(?:\bcontraste\b|\bcores?\b|\bescuro\b|\bclaro\b|\bvisibil)/.test(source)) {
    tags.push("low-contrast");
  }
  if (/(?:texto|letras?|fonte).{0,40}(?:azul|blue|vermelh|red|verde|green|pret|black|branc|white|rox|purple)|(?:azul|blue|vermelh|red|verde|green|pret|black|branc|white|rox|purple).{0,40}(?:texto|letras?|fonte)/.test(source)) {
    tags.push("text-color");
  }
  return tags;
}

function requestedTextColor(text) {
  const source = normalizedSearchText(text);
  const match = Object.keys(PERSONAL_TEXT_COLORS).find((name) => source.includes(name));
  return PERSONAL_TEXT_COLORS[match] || "#005fcc";
}

function fallbackStepsForIntent(tag, request) {
  switch (tag) {
    case "reading-difficulty":
      return [
        { type: "apply-style", target: "main-content", preset: "readable-text", parameters: { scale: 1.18 } },
        { type: "apply-style", target: "main-content", preset: "reading-spacing", parameters: { lineHeight: 1.7, letterSpacing: 0.35 } },
        { type: "apply-style", target: "main-content", preset: "heading-clarity", parameters: {} }
      ];
    case "navigation-confusion":
      return [
        { type: "apply-style", target: "document", preset: "navigation-clarity", parameters: {} },
        { type: "apply-style", target: "links", preset: "link-clarity", parameters: {} },
        { type: "apply-style", target: "interactive-elements", preset: "focus-ring", parameters: { width: 3, offset: 3 } }
      ];
    case "small-controls":
      return [{ type: "apply-style", target: "controls", preset: "large-controls", parameters: { minimumSize: 48 } }];
    case "form-difficulty":
      return [
        { type: "apply-style", target: "controls", preset: "form-legibility", parameters: {} },
        { type: "apply-style", target: "interactive-elements", preset: "focus-ring", parameters: { width: 3, offset: 3 } }
      ];
    case "low-contrast":
      return [
        { type: "apply-style", target: "main-content", preset: "contrast-support", parameters: {} },
        { type: "apply-style", target: "links", preset: "link-clarity", parameters: {} }
      ];
    case "text-color":
      return [{
        type: "apply-style",
        target: "document",
        preset: "text-color",
        parameters: { color: requestedTextColor(request?.text) }
      }];
    default:
      return [];
  }
}

function ensurePersonalRequestCoverage(generated, request) {
  const steps = [...(generated?.siteScript?.steps || [])];
  const requestedTags = request?.intentTags || [];
  const allRequiredPresets = new Set(requestedTags.flatMap((tag) => [...(PERSONAL_INTENT_PRESETS[tag] || [])]));

  for (const tag of requestedTags) {
    const requiredPresets = PERSONAL_INTENT_PRESETS[tag];
    if (!requiredPresets || steps.some((step) => requiredPresets.has(step.preset))) continue;
    for (const fallback of fallbackStepsForIntent(tag, request)) {
      if (steps.some((step) => step.target === fallback.target && step.preset === fallback.preset)) continue;
      if (steps.length >= MAX_SITE_SCRIPT_STEPS) {
        const replaceAt = steps.findIndex((step) => !allRequiredPresets.has(step.preset));
        if (replaceAt < 0) break;
        steps.splice(replaceAt, 1);
      }
      steps.push(fallback);
    }
  }

  return {
    ...generated,
    siteScript: { ...generated.siteScript, steps: steps.slice(0, MAX_SITE_SCRIPT_STEPS) }
  };
}

export function createAdaptationService({ database, gemini, aiQueue, now = () => new Date() } = {}) {
  const basePlanListeners = new Set();
  const requestQueue = typeof aiQueue?.enqueue === "function" ? aiQueue : createAiRequestQueue();

  function generateWithQueue(type, request, payload) {
    return requestQueue.enqueue({
      type,
      origin: payload.origin,
      request: type === "personal" ? request?.text : "",
      execute: () => gemini.generate(payload)
    });
  }

  function publishBasePlan(origin, plan) {
    for (const listener of basePlanListeners) {
      try {
        listener({ origin, plan });
      } catch {
        // A delivery listener is isolated from persistence and other subscribers.
      }
    }
  }

  async function recentSnapshots(origin) {
    const result = await database.query(
      `SELECT id, installation_hash, path_hash, content_hash, template_hash, payload, created_at, last_seen_at
       FROM easyweb_site_snapshots
       WHERE origin_hash = ?
       ORDER BY last_seen_at DESC
       LIMIT ?`,
      [hash(origin), MAX_CANDIDATE_SNAPSHOTS]
    );
    return Array.isArray(result.rows) ? result.rows : [];
  }

  function resolveCandidate(rows) {
    return createFamilyCandidate(rows);
  }

  async function loadActivePlan(adaptationFingerprint, origin) {
    const result = await database.query(
      `SELECT plan_json
       FROM easyweb_adaptation_base_plans
       WHERE family_id = (
         SELECT id FROM easyweb_adaptation_families WHERE adaptation_hash = ? LIMIT 1
       ) AND status = 'active' AND expires_at > UTC_TIMESTAMP()
       ORDER BY plan_version DESC
       LIMIT 1`,
      [Buffer.from(adaptationFingerprint, "hex")]
    );
    const plan = result.rows?.[0] ? parsePlan(result.rows[0]) : null;
    return plan?.origin === origin ? plan : null;
  }

  async function persistFamily(origin, candidate, status = "observing") {
    const { pair, adaptationFingerprint, similarity, confidence } = candidate;
    await database.query(
      `INSERT INTO easyweb_adaptation_families (
        origin_hash, site_origin, adaptation_hash, primary_content_hash,
        secondary_content_hash, similarity, status, sample_count, distinct_path_count,
        installation_count, stability_score, dynamism_score, opportunity_score,
        confidence_score, evaluation_reason, last_evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE
        primary_content_hash = VALUES(primary_content_hash),
        secondary_content_hash = VALUES(secondary_content_hash),
        similarity = VALUES(similarity),
        status = IF(status = 'ready' AND VALUES(status) <> 'ready', 'ready', VALUES(status)),
        sample_count = VALUES(sample_count),
        distinct_path_count = VALUES(distinct_path_count),
        installation_count = VALUES(installation_count),
        stability_score = VALUES(stability_score),
        dynamism_score = VALUES(dynamism_score),
        opportunity_score = VALUES(opportunity_score),
        confidence_score = VALUES(confidence_score),
        evaluation_reason = VALUES(evaluation_reason),
        last_evaluated_at = UTC_TIMESTAMP(),
        last_seen_at = CURRENT_TIMESTAMP`,
      [
        hash(origin),
        origin,
        Buffer.from(adaptationFingerprint, "hex"),
        Buffer.from(pair.left.contentHash, "hex"),
        Buffer.from(pair.right.contentHash, "hex"),
        similarity,
        status,
        confidence.sampleCount,
        confidence.distinctPathCount,
        confidence.installationCount,
        confidence.stabilityScore,
        confidence.dynamismScore,
        confidence.opportunityScore,
        confidence.score,
        confidence.reason
      ]
    );
    const result = await database.query(
      "SELECT id FROM easyweb_adaptation_families WHERE adaptation_hash = ? LIMIT 1",
      [Buffer.from(adaptationFingerprint, "hex")]
    );
    return result.rows?.[0]?.id || null;
  }

  async function persistPlan({ origin, candidate, familyId, generated }) {
    const { pair, adaptationFingerprint, confidence } = candidate;
    const versionResult = await database.query(
      "SELECT COALESCE(MAX(plan_version), 0) + 1 AS next_version FROM easyweb_adaptation_base_plans WHERE family_id = ?",
      [familyId]
    );
    const version = Number(versionResult.rows?.[0]?.next_version) || 1;
    const plan = {
      schemaVersion: 1,
      planId: createPlanKey(origin, adaptationFingerprint, version),
      planScope: "base",
      origin,
      snapshotTemplateHashes: [pair.left.templateHash, pair.right.templateHash],
      sourceContentHashes: [pair.left.contentHash, pair.right.contentHash],
      adaptationFingerprint,
      familyConfidence: confidence,
      profile: "universal",
      confidence: generated.confidence,
      summary: generated.summary || "Ajustes de acessibilidade sugeridos para esta estrutura.",
      recommendedLevel: 1,
      siteScript: generated.siteScript,
      verification: {
        requirePreview: false,
        requireUserApproval: false,
        automaticApplication: true,
        rollbackOnLayoutInstability: true
      },
      expiresAt: new Date(now().getTime() + PLAN_TTL_DAYS * 86_400_000).toISOString()
    };
    await database.query(
      `INSERT INTO easyweb_adaptation_base_plans (
        family_id, plan_key, plan_version, plan_json, model_name, prompt_version,
        status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      [
        familyId,
        plan.planId,
        version,
        JSON.stringify(plan),
        gemini.model,
        gemini.promptVersion,
        toDateString(PLAN_TTL_DAYS, now())
      ]
    );
    return plan;
  }

  async function markFamilyReady(familyId) {
    await database.query(
      "UPDATE easyweb_adaptation_families SET status = 'ready', last_evaluated_at = UTC_TIMESTAMP() WHERE id = ?",
      [familyId]
    );
  }

  async function createBasePlan(origin, candidate) {
    const { pair, adaptationFingerprint } = candidate;
    const existing = await loadActivePlan(adaptationFingerprint, origin);
    if (existing) {
      const existingFamilyId = await persistFamily(origin, candidate, "eligible");
      if (existingFamilyId) await markFamilyReady(existingFamilyId);
      return existing;
    }
    if (!gemini?.configured) throw createServiceError("EASYWEB_GEMINI_UNAVAILABLE", false);
    const familyId = await persistFamily(origin, candidate, "eligible");
    if (!familyId) throw createServiceError("EASYWEB_ADAPTATION_FAMILY_UNAVAILABLE", true);
    const generated = await generateWithQueue("base", null, {
      origin,
      planScope: "base",
      profile: "universal",
      snapshots: [pair.left.snapshot, pair.right.snapshot]
    });
    const plan = await persistPlan({ origin, candidate, familyId, generated });
    await markFamilyReady(familyId);
    return plan;
  }

  async function enqueueBaseAnalysis(origin, pair, adaptationFingerprint) {
    await database.query(
      `INSERT INTO easyweb_adaptation_jobs (
        origin_hash, site_origin, adaptation_hash, primary_content_hash, secondary_content_hash,
        similarity, state, attempts, run_after
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE
        site_origin = VALUES(site_origin),
        primary_content_hash = VALUES(primary_content_hash),
        secondary_content_hash = VALUES(secondary_content_hash),
        similarity = VALUES(similarity),
        attempts = IF(state IN ('completed', 'failed'), 0, attempts),
        run_after = IF(state IN ('completed', 'failed'), UTC_TIMESTAMP(), run_after),
        last_error = IF(state IN ('completed', 'failed'), NULL, last_error),
        state = IF(state IN ('completed', 'failed'), 'queued', state)`,
      [
        hash(origin),
        origin,
        Buffer.from(adaptationFingerprint, "hex"),
        Buffer.from(pair.left.contentHash, "hex"),
        Buffer.from(pair.right.contentHash, "hex"),
        pair.similarity
      ]
    );
    const result = await database.query(
      "SELECT id, state FROM easyweb_adaptation_jobs WHERE adaptation_hash = ? LIMIT 1",
      [Buffer.from(adaptationFingerprint, "hex")]
    );
    return result.rows?.[0] || { id: null, state: "queued" };
  }

  async function claimNextBaseJob() {
    const candidateResult = await database.query(
      `SELECT id, site_origin, adaptation_hash, primary_content_hash, secondary_content_hash, attempts
       FROM easyweb_adaptation_jobs
       WHERE (state IN ('queued', 'retry') AND run_after <= UTC_TIMESTAMP())
          OR (state = 'running' AND locked_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${STALE_JOB_LOCK_MINUTES} MINUTE))
       ORDER BY run_after ASC, id ASC
       LIMIT 1`
    );
    const candidate = candidateResult.rows?.[0];
    if (!candidate) return null;
    const lockToken = randomBytes(16);
    const claimed = await database.query(
      `UPDATE easyweb_adaptation_jobs
       SET state = 'running', attempts = attempts + 1, locked_at = UTC_TIMESTAMP(), lock_token = ?
       WHERE id = ? AND (
         (state IN ('queued', 'retry') AND run_after <= UTC_TIMESTAMP())
         OR (state = 'running' AND locked_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${STALE_JOB_LOCK_MINUTES} MINUTE))
       )`,
      [lockToken, candidate.id]
    );
    if (affectedRows(claimed) !== 1) return null;
    return { ...candidate, lockToken, attempts: Number(candidate.attempts || 0) + 1 };
  }

  async function settleJob(job, state, { retryAfterSeconds = 0, error = null } = {}) {
    await database.query(
      `UPDATE easyweb_adaptation_jobs
       SET state = ?, run_after = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND),
           locked_at = NULL, lock_token = NULL, completed_at = IF(? = 'completed', UTC_TIMESTAMP(), completed_at),
           last_error = ?
       WHERE id = ? AND lock_token = ?`,
      [state, retryAfterSeconds, state, error ? String(error).slice(0, 500) : null, job.id, job.lockToken]
    );
  }

  function findJobPair(rows, job) {
    const primaryHash = hex(job.primary_content_hash);
    const secondaryHash = hex(job.secondary_content_hash);
    return parsedPairs(rows).find((pair) => {
      const hashes = new Set([pair.left.contentHash, pair.right.contentHash]);
      return hashes.has(primaryHash) && hashes.has(secondaryHash);
    }) || null;
  }

  async function processNextBaseJob() {
    if (!database?.configured) return { state: "storage-unavailable" };
    const job = await claimNextBaseJob();
    if (!job) return { state: "idle" };
    try {
      const rows = await recentSnapshots(job.site_origin);
      if (!findJobPair(rows, job)) {
        await settleJob(job, "failed", { error: "source-snapshots-unavailable" });
        return { state: "failed", reason: "source-snapshots-unavailable", jobId: job.id };
      }
      const candidate = resolveCandidate(rows);
      if (candidate.state !== "eligible") {
        await settleJob(job, "failed", { error: `family-${candidate.state}` });
        return { state: "failed", reason: `family-${candidate.state}`, jobId: job.id };
      }
      if (candidate.adaptationFingerprint !== hex(job.adaptation_hash)) {
        await settleJob(job, "failed", { error: "source-snapshots-changed" });
        return { state: "failed", reason: "source-snapshots-changed", jobId: job.id };
      }
      const plan = await createBasePlan(job.site_origin, candidate);
      await settleJob(job, "completed");
      publishBasePlan(job.site_origin, plan);
      return { state: "ready", jobId: job.id, plan };
    } catch (error) {
      const retryable = error?.retryable !== false;
      if (retryable && job.attempts < MAX_BASE_JOB_ATTEMPTS) {
        await settleJob(job, "retry", {
          retryAfterSeconds: retryDelaySeconds(job.attempts),
          error: error?.code || error?.message || "base-analysis-failed"
        });
        return { state: "retry", jobId: job.id, attempts: job.attempts };
      }
      await settleJob(job, "failed", { error: error?.code || error?.message || "base-analysis-failed" });
      return { state: "failed", jobId: job.id, reason: error?.code || "base-analysis-failed" };
    }
  }

  async function considerSnapshot({ origin }) {
    if (!database?.configured) return { state: "storage-unavailable" };
    const candidate = resolveCandidate(await recentSnapshots(origin));
    if (candidate.pair) {
      await persistFamily(origin, candidate, candidate.state === "eligible" ? "eligible" : "observing");
    }
    if (candidate.state !== "eligible") {
      return publicCandidate(candidate);
    }
    const existing = await loadActivePlan(candidate.adaptationFingerprint, origin);
    if (existing) return { state: "ready", plan: existing };
    if (!gemini?.configured) return { state: "model-unavailable" };
    const job = await enqueueBaseAnalysis(origin, candidate.pair, candidate.adaptationFingerprint);
    return { state: "analyzing-base", adaptationFingerprint: candidate.adaptationFingerprint, jobId: job.id };
  }

  async function lookup({ origin }) {
    if (!database?.configured) return { state: "storage-unavailable" };
    const candidate = resolveCandidate(await recentSnapshots(origin));
    if (candidate.state !== "eligible") {
      return publicCandidate(candidate);
    }
    const plan = await loadActivePlan(candidate.adaptationFingerprint, origin);
    if (plan) return { state: "ready", plan };
    if (!gemini?.configured) return { state: "model-unavailable" };
    const job = await enqueueBaseAnalysis(origin, candidate.pair, candidate.adaptationFingerprint);
    return { state: "analyzing-base", adaptationFingerprint: candidate.adaptationFingerprint, jobId: job.id };
  }

  async function loadBasePlanById(planId, origin) {
    const result = await database.query(
      `SELECT plan_json
       FROM easyweb_adaptation_base_plans
       WHERE plan_key = ? AND status = 'active' AND expires_at > UTC_TIMESTAMP()
       LIMIT 1`,
      [planId]
    );
    const plan = result.rows?.[0] ? parsePlan(result.rows[0]) : null;
    return plan?.origin === origin ? plan : null;
  }

  function normalizePersonalRequest(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = typeof value.text === "string" ? value.text.replace(/\s+/g, " ").trim() : "";
    const text = source
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[dado removido]")
      .replace(/(?:\d[ -]?){13,19}/g, "[dado removido]")
      .replace(/\b\d{3}[.-]?\d{3}[.-]?\d{3}[.-]?\d{2}\b/g, "[dado removido]");
    if (!text || text.length > 280) return null;
    const suppliedTags = Array.isArray(value.intentTags)
      ? value.intentTags.filter((tag) => PERSONAL_INTENT_TAGS.has(tag))
      : [];
    const intentTags = [...new Set([...suppliedTags, ...inferPersonalIntentTags(text)])].slice(0, 4);
    return { text, intentTags };
  }

  function normalizePreviousPersonalPlan(value, origin, basePlanId = null) {
    const normalizedBasePlanId = typeof basePlanId === "string" && basePlanId ? basePlanId : null;
    const previousBasePlanId = typeof value?.basePlanId === "string" && value.basePlanId ? value.basePlanId : null;
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.planScope !== "personal" || value.origin !== origin || previousBasePlanId !== normalizedBasePlanId) return null;
    try {
      const normalized = gemini.normalizeGeneratedPlan({
        confidence: value.confidence,
        summary: value.summary,
        siteScript: value.siteScript,
        // Planos mantidos de versoes anteriores ainda podem ser usados como contexto.
        actions: value.actions
      }, { planScope: "personal" });
      return normalized.siteScript.steps.length ? normalized : null;
    } catch {
      return null;
    }
  }

  async function createPersonalPlan({
    installationId,
    origin,
    snapshot,
    basePlanId,
    profile,
    userRequest,
    previousPersonalPlan,
    snapshotStore
  }) {
    if (!gemini?.configured) return { state: "model-unavailable" };
    if (typeof snapshotStore?.prepare !== "function") return { state: "storage-unavailable" };
    const request = normalizePersonalRequest(userRequest);
    if (!request) return { state: "invalid-personal-request" };
    const basePlan = database?.configured && typeof basePlanId === "string" && basePlanId
      ? await loadBasePlanById(basePlanId, origin)
      : null;
    const prepared = snapshotStore.prepare({ installationId, snapshot });
    if (prepared.normalized.page.origin !== origin) return { state: "invalid-personal-request" };
    let generated;
    try {
      generated = await generateWithQueue("personal", request, {
        origin,
        planScope: "personal",
        profile: typeof profile === "string" ? profile.slice(0, 64) : "default",
        snapshots: [prepared.normalized],
        basePlan,
        previousPersonalPlan: normalizePreviousPersonalPlan(previousPersonalPlan, origin, basePlan?.planId),
        userRequest: request
      });
    } catch (error) {
      if (error?.retryable) return { state: "model-temporarily-unavailable" };
      throw error;
    }
    const covered = ensurePersonalRequestCoverage(generated, request);
    if (!covered.siteScript.steps.length) {
      return { state: "no-compatible-adjustment" };
    }
    return {
      state: "ready",
      plan: {
        schemaVersion: 1,
        planId: `personal:${basePlan?.planId || "direct"}:${Date.now().toString(36)}:${randomBytes(4).toString("hex")}`,
        planScope: "personal",
        origin,
        basePlanId: basePlan?.planId || null,
        adaptationFingerprint: basePlan?.adaptationFingerprint || null,
        profile: typeof profile === "string" ? profile.slice(0, 64) : "default",
        confidence: covered.confidence,
        summary: covered.summary || "Ajustes adicionais preparados para sua solicitacao.",
        recommendedLevel: 1,
        siteScript: covered.siteScript,
        verification: {
          requirePreview: false,
          requireUserApproval: false,
          automaticApplication: true,
          rollbackOnLayoutInstability: true
        },
        expiresAt: new Date(now().getTime() + PLAN_TTL_DAYS * 86_400_000).toISOString()
      }
    };
  }

  function onBasePlan(listener) {
    if (typeof listener !== "function") throw new TypeError("O listener de plano base deve ser uma funcao.");
    basePlanListeners.add(listener);
    return () => basePlanListeners.delete(listener);
  }

  return Object.freeze({
    considerSnapshot,
    lookup,
    createPersonalPlan,
    processNextBaseJob,
    onBasePlan,
    calculateStructuralSimilarity,
    findBestPair,
    assessSnapshotPairTrust
  });
}
