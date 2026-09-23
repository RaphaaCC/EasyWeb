const LATEST_ROWS_LIMIT = 20;

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asRows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function publicSnapshot(row) {
  return {
    origin: row.siteOrigin || null,
    path: row.pagePath || null,
    captures: asNumber(row.captureCount),
    bytes: asNumber(row.payloadBytes),
    firstSeenAt: row.createdAt || null,
    lastSeenAt: row.lastSeenAt || null
  };
}

function publicJob(row) {
  return {
    id: asNumber(row.id),
    origin: row.siteOrigin || null,
    state: row.state || "unknown",
    attempts: asNumber(row.attempts),
    similarity: row.similarity === null || row.similarity === undefined ? null : Number(row.similarity),
    runAfter: row.runAfter || null,
    updatedAt: row.updatedAt || null,
    lastError: row.lastError || null
  };
}

export function createDiagnosticsHandler({ database, gemini, now = () => new Date() } = {}) {
  async function getDiagnostics() {
    const generatedAt = now().toISOString();
    if (!database?.configured) {
      return {
        status: "not-configured",
        generatedAt,
        database: { configured: false, status: "not-configured" },
        gemini: { configured: Boolean(gemini?.configured), model: gemini?.model || null },
        snapshots: { total: 0, sites: 0, bytes: 0, latest: [] },
        plans: { total: 0, active: 0, latestUpdateAt: null },
        jobs: { totals: {}, latest: [] }
      };
    }

    try {
      const [health, snapshotTotals, latestSnapshots, planTotals, jobTotals, latestJobs] = await Promise.all([
        database.health(),
        database.query(
          `SELECT COUNT(*) AS total, COUNT(DISTINCT origin_hash) AS siteCount,
                  COALESCE(SUM(payload_bytes), 0) AS payloadBytes, MAX(last_seen_at) AS lastSeenAt
           FROM easyweb_site_snapshots`
        ),
        database.query(
          `SELECT site_origin AS siteOrigin, page_path AS pagePath, capture_count AS captureCount,
                  payload_bytes AS payloadBytes, created_at AS createdAt, last_seen_at AS lastSeenAt
           FROM easyweb_site_snapshots
           ORDER BY last_seen_at DESC
           LIMIT ${LATEST_ROWS_LIMIT}`
        ),
        database.query(
          `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'active'), 0) AS active,
                  MAX(updated_at) AS latestUpdateAt
           FROM easyweb_adaptation_base_plans`
        ),
        database.query(
          `SELECT state, COUNT(*) AS total
           FROM easyweb_adaptation_jobs
           GROUP BY state`
        ),
        database.query(
          `SELECT id, site_origin AS siteOrigin, state, attempts, similarity,
                  run_after AS runAfter, updated_at AS updatedAt, last_error AS lastError
           FROM easyweb_adaptation_jobs
           ORDER BY updated_at DESC, id DESC
           LIMIT ${LATEST_ROWS_LIMIT}`
        )
      ]);
      const snapshot = asRows(snapshotTotals)[0] || {};
      const plans = asRows(planTotals)[0] || {};
      const totals = Object.fromEntries(asRows(jobTotals).map((row) => [row.state, asNumber(row.total)]));
      return {
        status: health.status === "ok" ? "ok" : "degraded",
        generatedAt,
        database: health,
        gemini: { configured: Boolean(gemini?.configured), model: gemini?.model || null },
        snapshots: {
          total: asNumber(snapshot.total),
          sites: asNumber(snapshot.siteCount),
          bytes: asNumber(snapshot.payloadBytes),
          lastSeenAt: snapshot.lastSeenAt || null,
          latest: asRows(latestSnapshots).map(publicSnapshot)
        },
        plans: {
          total: asNumber(plans.total),
          active: asNumber(plans.active),
          latestUpdateAt: plans.latestUpdateAt || null
        },
        jobs: {
          totals,
          latest: asRows(latestJobs).map(publicJob)
        }
      };
    } catch (error) {
      return {
        status: "unavailable",
        generatedAt,
        database: { configured: true, status: "unavailable" },
        gemini: { configured: Boolean(gemini?.configured), model: gemini?.model || null },
        snapshots: { total: 0, sites: 0, bytes: 0, latest: [] },
        plans: { total: 0, active: 0, latestUpdateAt: null },
        jobs: { totals: {}, latest: [] },
        error: "Não foi possível consultar os dados operacionais."
      };
    }
  }

  return Object.freeze({ getDiagnostics });
}
