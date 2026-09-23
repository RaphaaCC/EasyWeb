import { WebSocketServer } from "ws";

const MAX_MESSAGE_BYTES = 768 * 1024;
const PROTOCOL_VERSION = 1;
const MIN_SNAPSHOT_INTERVAL_MS = 3_000;
const MIN_PERSONAL_REQUEST_INTERVAL_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const PERSONAL_RESULT_TTL_MS = 10 * 60_000;
const MAX_COMPLETED_PERSONAL_RESULTS = 1_000;

function send(socket, payload) {
  if (socket.readyState !== socket.OPEN) {
    return false;
  }
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    return false;
  }
}

function parseMessage(raw, isBinary) {
  if (isBinary || raw.length > MAX_MESSAGE_BYTES) {
    return null;
  }

  try {
    const message = JSON.parse(raw.toString("utf8"));
    return message && typeof message === "object" && !Array.isArray(message) ? message : null;
  } catch (error) {
    return null;
  }
}

function isInstallationId(value) {
  return typeof value === "string" && /^[a-z\d-]{16,128}$/i.test(value);
}

function isSnapshotId(value) {
  return typeof value === "string" && /^[a-z\d-]{16,128}$/i.test(value);
}

function isOrigin(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && url.origin === value && !url.username && !url.password;
  } catch (error) {
    return false;
  }
}

function respondWithStoreError(socket, error, snapshotId) {
  const retryable = error?.code === "EASYWEB_DATABASE_UNAVAILABLE";
  const reason = retryable
    ? "Armazenamento de snapshots indisponível."
    : "Não foi possível filtrar e armazenar o snapshot.";
  send(socket, { type: "easyweb:mapping:rejected", snapshotId, reason, retryable });
}

function sendAdaptationStatus(socket, origin, result, extra = {}) {
  if (result?.state === "ready" && result.plan) {
    send(socket, {
      type: "easyweb:adaptation:base-plan",
      origin,
      plan: result.plan,
      ...extra
    });
    return;
  }

  send(socket, {
    type: "easyweb:adaptation:status",
    origin,
    state: result?.state || "unavailable",
    similarity: result?.similarity,
    trust: result?.trust,
    ...extra
  });
}

async function publishBaseAdaptation(socket, adaptationService, origin, snapshotId) {
  if (!adaptationService) {
    return;
  }

  try {
    const result = await adaptationService.considerSnapshot({ origin });
    sendAdaptationStatus(socket, origin, result, { snapshotId });
  } catch (error) {
    send(socket, {
      type: "easyweb:adaptation:error",
      origin,
      snapshotId,
      reason: "Não foi possível preparar a adaptação de IA para este site."
    });
  }
}

function sendPersonalResult(socket, requestId, origin, result) {
  if (result?.state === "ready" && result.plan) {
    send(socket, {
      type: "easyweb:adaptation:personal-plan",
      requestId,
      origin,
      plan: result.plan
    });
    return;
  }

  send(socket, {
    type: "easyweb:adaptation:personal-status",
    requestId,
    origin,
    state: result?.state || "unavailable"
  });
}

function sendPersonalFailure(socket, requestId, origin) {
  send(socket, {
    type: "easyweb:adaptation:error",
    requestId,
    origin,
    reason: "Nao foi possivel processar seu pedido de adaptacao."
  });
}

function takeCompletedPersonalResult(results, requestKey, origin) {
  const cached = results.get(requestKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now() || cached.origin !== origin) {
    results.delete(requestKey);
    return null;
  }
  return cached.result;
}

function rememberCompletedPersonalResult(results, requestKey, origin, result) {
  const now = Date.now();
  for (const [key, cached] of results) {
    if (cached.expiresAt <= now) {
      results.delete(key);
    }
  }
  while (results.size >= MAX_COMPLETED_PERSONAL_RESULTS) {
    const oldestKey = results.keys().next().value;
    if (!oldestKey) {
      break;
    }
    results.delete(oldestKey);
  }
  results.set(requestKey, { origin, result, expiresAt: now + PERSONAL_RESULT_TTL_MS });
}

async function handleMessage(socket, state, snapshotStore, adaptationService, pendingPersonalRequests, completedPersonalResults, raw, isBinary) {
  const message = parseMessage(raw, isBinary);
  if (!message) {
    socket.close(1008, "Mensagem inválida.");
    return;
  }

  if (message.type === "easyweb:hello" && message.protocolVersion === PROTOCOL_VERSION) {
    if (!isInstallationId(message.installationId)) {
      socket.close(1008, "Instalação inválida.");
      return;
    }

    state.installationId = message.installationId;
    send(socket, {
      type: "easyweb:hello",
      protocolVersion: PROTOCOL_VERSION,
      serverTime: new Date().toISOString()
    });
    return;
  }

  if (message.type === "easyweb:ping") {
    if (!state.installationId) {
      socket.close(1008, "Handshake obrigatorio antes do heartbeat.");
      return;
    }
    send(socket, { type: "easyweb:pong", timestamp: new Date().toISOString() });
    return;
  }

  if (message.type === "easyweb:mapping:snapshot") {
    if (!state.installationId) {
      send(socket, { type: "easyweb:mapping:rejected", reason: "Handshake obrigatório antes do snapshot." });
      return;
    }
    if (!isSnapshotId(message.snapshotId)) {
      send(socket, { type: "easyweb:mapping:rejected", reason: "Identificação do snapshot inválida." });
      return;
    }
    if (Date.now() - state.lastSnapshotAt < MIN_SNAPSHOT_INTERVAL_MS) {
      send(socket, {
        type: "easyweb:mapping:rejected",
        snapshotId: message.snapshotId,
        reason: "Envio muito frequente; tente novamente em alguns segundos.",
        retryable: true
      });
      return;
    }

    state.lastSnapshotAt = Date.now();
    try {
      const result = await snapshotStore?.store({
        installationId: state.installationId,
        snapshot: message.snapshot
      });
      if (!result) {
        throw Object.assign(new Error("Armazenamento indisponível."), { code: "EASYWEB_DATABASE_UNAVAILABLE" });
      }
      console.info(
        `[mapping] snapshot recebido: ${result.page.origin}${result.page.path} ` +
        `(${result.payloadBytes} bytes, template ${result.templateHash.slice(0, 12)})`
      );
      state.subscribedOrigins.add(result.page.origin);
      send(socket, {
        type: "easyweb:mapping:stored",
        snapshotId: message.snapshotId,
        contentHash: result.contentHash,
        templateHash: result.templateHash,
        payloadBytes: result.payloadBytes
      });
      void publishBaseAdaptation(socket, adaptationService, result.page.origin, message.snapshotId);
    } catch (error) {
      respondWithStoreError(socket, error, message.snapshotId);
    }
    return;
  }

  if (message.type === "easyweb:adaptation:lookup") {
    if (!state.installationId || !isOrigin(message.origin)) {
      send(socket, { type: "easyweb:adaptation:error", reason: "Consulta de adaptação inválida." });
      return;
    }
    state.subscribedOrigins.add(message.origin);
    try {
      const result = await adaptationService?.lookup({ origin: message.origin });
      sendAdaptationStatus(socket, message.origin, result);
    } catch (error) {
      send(socket, {
        type: "easyweb:adaptation:error",
        origin: message.origin,
        reason: "Não foi possível consultar a adaptação deste site."
      });
    }
    return;
  }

  if (message.type === "easyweb:adaptation:personal-request") {
    if (!state.installationId || !isSnapshotId(message.requestId) || !isOrigin(message.origin)) {
      send(socket, { type: "easyweb:adaptation:error", reason: "Solicitação pessoal inválida." });
      return;
    }
    if (state.pendingPersonalRequestIds.has(message.requestId)) {
      return;
    }
    const requestKey = `${state.installationId}:${message.requestId}`;
    const completedResult = takeCompletedPersonalResult(completedPersonalResults, requestKey, message.origin);
    if (completedResult) {
      sendPersonalResult(socket, message.requestId, message.origin, completedResult);
      return;
    }
    const pendingRequest = pendingPersonalRequests.get(requestKey);
    if (pendingRequest) {
      state.pendingPersonalRequestIds.add(message.requestId);
      try {
        sendPersonalResult(socket, message.requestId, message.origin, await pendingRequest);
      } catch (error) {
        sendPersonalFailure(socket, message.requestId, message.origin);
      } finally {
        state.pendingPersonalRequestIds.delete(message.requestId);
      }
      return;
    }
    if (Date.now() - state.lastPersonalRequestAt < MIN_PERSONAL_REQUEST_INTERVAL_MS) {
      send(socket, {
        type: "easyweb:adaptation:personal-status",
        requestId: message.requestId,
        origin: message.origin,
        state: "rate-limited"
      });
      return;
    }
    state.lastPersonalRequestAt = Date.now();
    state.pendingPersonalRequestIds.add(message.requestId);
    const personalRequest = Promise.resolve().then(() => adaptationService?.createPersonalPlan({
      installationId: state.installationId,
      origin: message.origin,
      snapshot: message.snapshot,
      basePlanId: message.basePlanId,
      profile: message.profile,
      userRequest: message.userRequest,
      previousPersonalPlan: message.previousPersonalPlan,
      snapshotStore
    }));
    pendingPersonalRequests.set(requestKey, personalRequest);
    try {
      const result = await personalRequest;
      if (result?.state === "ready" && result.plan) {
        rememberCompletedPersonalResult(completedPersonalResults, requestKey, message.origin, result);
      }
      sendPersonalResult(socket, message.requestId, message.origin, result);
    } catch (error) {
      sendPersonalFailure(socket, message.requestId, message.origin);
    } finally {
      state.pendingPersonalRequestIds.delete(message.requestId);
      if (pendingPersonalRequests.get(requestKey) === personalRequest) {
        pendingPersonalRequests.delete(requestKey);
      }
    }
    return;
  }

  send(socket, { type: "easyweb:error", error: "Mensagem não permitida." });
}

export function attachWebSocketServer(httpServer, { snapshotStore, adaptationService } = {}) {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES
  });
  const connections = new Map();
  const pendingPersonalRequests = new Map();
  const completedPersonalResults = new Map();
  const unsubscribeBasePlans = typeof adaptationService?.onBasePlan === "function"
    ? adaptationService.onBasePlan(({ origin, plan }) => {
      for (const [socket, state] of connections) {
        if (state.subscribedOrigins.has(origin)) {
          send(socket, { type: "easyweb:adaptation:base-plan", origin, plan });
        }
      }
    })
    : () => {};

  httpServer.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url, "http://localhost");
    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket) => {
    const state = {
      installationId: null,
      lastSnapshotAt: 0,
      lastPersonalRequestAt: 0,
      pendingPersonalRequestIds: new Set(),
      subscribedOrigins: new Set()
    };
    connections.set(socket, state);
    const handshakeTimer = setTimeout(() => {
      if (!state.installationId) {
        socket.close(1008, "Handshake obrigatório.");
      }
    }, HANDSHAKE_TIMEOUT_MS);
    socket.on("message", (raw, isBinary) => {
      handleMessage(socket, state, snapshotStore, adaptationService, pendingPersonalRequests, completedPersonalResults, raw, isBinary).then(() => {
        if (state.installationId) {
          clearTimeout(handshakeTimer);
        }
      }).catch(() => {
        socket.close(1011, "Erro ao processar a mensagem.");
      });
    });
    socket.on("close", () => {
      clearTimeout(handshakeTimer);
      connections.delete(socket);
    });
    socket.on("error", () => {
      // Falhas de transporte não devem encerrar o processo da API.
    });
  });

  webSocketServer.once("close", unsubscribeBasePlans);

  return webSocketServer;
}
