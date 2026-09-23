const DEFAULT_INTERVAL_MS = 5_000;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createAdaptationJobWorker({ adaptationService, intervalMs, logger = console } = {}) {
  if (typeof adaptationService?.processNextBaseJob !== "function") {
    throw new TypeError("O worker exige um servico de adaptacao com fila persistente.");
  }

  const effectiveIntervalMs = readPositiveInteger(intervalMs, DEFAULT_INTERVAL_MS);
  let timer;
  let running = false;

  async function runOnce() {
    if (running) return { state: "busy" };
    running = true;
    try {
      const result = await adaptationService.processNextBaseJob();
      if (result?.state === "failed") {
        logger.warn?.(`[adaptation] job ${result.jobId || "unknown"} failed: ${result.reason || "unknown"}`);
      }
      return result;
    } catch (error) {
      logger.error?.("[adaptation] persistent worker failed", error?.code || error?.message || "unknown");
      return { state: "error" };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    void runOnce();
    timer = setInterval(() => {
      void runOnce();
    }, effectiveIntervalMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return Object.freeze({ start, stop, runOnce, intervalMs: effectiveIntervalMs });
}
