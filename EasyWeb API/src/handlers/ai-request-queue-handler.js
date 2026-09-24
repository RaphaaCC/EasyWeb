function safeText(value, maximum = 180) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function stepCount(result) {
  return Array.isArray(result?.siteScript?.steps) ? result.siteScript.steps.length : undefined;
}

function errorCode(error) {
  return safeText(error?.code || error?.message || "unknown", 80);
}

export function createAiRequestQueue({
  logger = {},
  now = () => Date.now(),
  maxPersonalWaiting = 100,
  maxBaseWaiting = 500
} = {}) {
  const personalQueue = [];
  const baseQueue = [];
  let activeJob = null;
  let sequence = 0;

  function waitingCount() {
    return personalQueue.length + baseQueue.length;
  }

  function log(event, job, extra = {}) {
    const request = job.request ? { request: job.request } : {};
    logger.info?.(event, {
      type: job.type,
      origin: job.origin,
      ...request,
      waiting: waitingCount(),
      ...extra
    });
  }

  async function drain() {
    if (activeJob) return;
    const next = personalQueue.shift() || baseQueue.shift();
    if (!next) return;

    activeJob = next;
    const startedAt = now();
    log("ai.request.started", next);
    try {
      const result = await next.execute();
      log("ai.request.completed", next, {
        durationMs: Math.max(0, now() - startedAt),
        steps: stepCount(result)
      });
      next.resolve(result);
    } catch (error) {
      logger.warn?.("ai.request.failed", {
        type: next.type,
        origin: next.origin,
        ...(next.request ? { request: next.request } : {}),
        durationMs: Math.max(0, now() - startedAt),
        code: errorCode(error),
        retryable: error?.retryable === true
      });
      next.reject(error);
    } finally {
      activeJob = null;
      void drain();
    }
  }

  function enqueue({ type = "base", origin, request, execute } = {}) {
    if (typeof execute !== "function") {
      return Promise.reject(new TypeError("A fila de IA exige uma função de execução."));
    }
    const job = {
      id: ++sequence,
      type: type === "personal" ? "personal" : "base",
      origin: safeText(origin, 240) || "unknown",
      request: safeText(request),
      execute
    };
    const targetQueue = job.type === "personal" ? personalQueue : baseQueue;
    const queueLimit = job.type === "personal" ? maxPersonalWaiting : maxBaseWaiting;
    if (targetQueue.length >= queueLimit) {
      const error = new Error("A fila de solicitações de IA está temporariamente cheia.");
      error.code = "EASYWEB_AI_QUEUE_FULL";
      error.retryable = true;
      logger.warn?.("ai.request.rejected", {
        type: job.type,
        origin: job.origin,
        reason: "queue-full",
        waiting: waitingCount(),
        limit: queueLimit
      });
      return Promise.reject(error);
    }
    const result = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    targetQueue.push(job);
    log("ai.request.queued", job, {
      priority: job.type === "personal" ? "realtime" : "background",
      personalWaiting: personalQueue.length,
      baseWaiting: baseQueue.length
    });
    void drain();
    return result;
  }

  function getStatus() {
    return {
      active: activeJob ? { type: activeJob.type, origin: activeJob.origin } : null,
      personalWaiting: personalQueue.length,
      baseWaiting: baseQueue.length
    };
  }

  return Object.freeze({ enqueue, getStatus });
}
