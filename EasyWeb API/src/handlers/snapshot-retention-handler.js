const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 500;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function pruneOrphanedAdaptations(query) {
  const jobs = await query(
    `DELETE jobs FROM easyweb_adaptation_jobs jobs
     LEFT JOIN easyweb_site_snapshots primary_snapshot ON primary_snapshot.content_hash = jobs.primary_content_hash
     LEFT JOIN easyweb_site_snapshots secondary_snapshot ON secondary_snapshot.content_hash = jobs.secondary_content_hash
     WHERE primary_snapshot.id IS NULL OR secondary_snapshot.id IS NULL`
  );
  const plans = await query(
    `DELETE plans FROM easyweb_adaptation_base_plans plans
     INNER JOIN easyweb_adaptation_families families ON families.id = plans.family_id
     LEFT JOIN easyweb_site_snapshots primary_snapshot ON primary_snapshot.content_hash = families.primary_content_hash
     LEFT JOIN easyweb_site_snapshots secondary_snapshot ON secondary_snapshot.content_hash = families.secondary_content_hash
     WHERE primary_snapshot.id IS NULL OR secondary_snapshot.id IS NULL`
  );
  const families = await query(
    `DELETE families FROM easyweb_adaptation_families families
     LEFT JOIN easyweb_site_snapshots primary_snapshot ON primary_snapshot.content_hash = families.primary_content_hash
     LEFT JOIN easyweb_site_snapshots secondary_snapshot ON secondary_snapshot.content_hash = families.secondary_content_hash
     WHERE primary_snapshot.id IS NULL OR secondary_snapshot.id IS NULL`
  );
  return {
    jobs: Number(jobs.rows?.affectedRows) || 0,
    plans: Number(plans.rows?.affectedRows) || 0,
    families: Number(families.rows?.affectedRows) || 0
  };
}

export function createSnapshotRetentionHandler({ database, retentionDays, batchSize, now = () => new Date() } = {}) {
  const configuredRetentionDays = readPositiveInteger(retentionDays ?? process.env.SNAPSHOT_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
  const configuredBatchSize = readPositiveInteger(batchSize ?? process.env.SNAPSHOT_RETENTION_BATCH_SIZE, DEFAULT_BATCH_SIZE);

  async function deleteInstallationSnapshots(installationHash) {
    if (!database?.configured) throw Object.assign(new Error("Storage unavailable."), { code: "EASYWEB_DATABASE_UNAVAILABLE" });
    return database.transaction(async ({ query }) => {
      const snapshots = await query(
        "DELETE FROM easyweb_site_snapshots WHERE installation_hash = ?",
        [installationHash]
      );
      const pruned = await pruneOrphanedAdaptations(query);
      return { snapshots: Number(snapshots.rows?.affectedRows) || 0, ...pruned };
    });
  }

  async function deleteExpiredSnapshots() {
    if (!database?.configured) return { state: "storage-unavailable", deleted: 0 };
    const cutoff = new Date(now().getTime() - configuredRetentionDays * 24 * 60 * 60 * 1000);
    return database.transaction(async ({ query }) => {
      const snapshots = await query(
        "DELETE FROM easyweb_site_snapshots WHERE last_seen_at < ? LIMIT ?",
        [cutoff, configuredBatchSize]
      );
      const deleted = Number(snapshots.rows?.affectedRows) || 0;
      const pruned = deleted > 0 ? await pruneOrphanedAdaptations(query) : { jobs: 0, plans: 0, families: 0 };
      return { state: "completed", deleted, retentionDays: configuredRetentionDays, ...pruned };
    });
  }

  return Object.freeze({ configuredRetentionDays, configuredBatchSize, deleteInstallationSnapshots, deleteExpiredSnapshots });
}
