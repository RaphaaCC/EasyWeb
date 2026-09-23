importScripts("handlers/settings-handler.js", "handlers/content-injection-handler.js");

const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const MAX_MAPPING_SNAPSHOT_BYTES = 512 * 1024;
const MAX_QUEUED_SNAPSHOTS = 20;
const MIN_MAPPING_SEND_INTERVAL_MS = 3_000;
const MIN_ADAPTATION_LOOKUP_INTERVAL_MS = 20_000;
const MIN_PERSONAL_SEND_INTERVAL_MS = 15_250;
const SNAPSHOT_ACK_TIMEOUT_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const CONFIRMED_TEMPLATE_REFRESH_MS = 10 * 60_000;
const INSTALLATION_ID_KEY = "easyweb:installation-id";

let apiSocket;
let heartbeatTimer;
let handshakeTimer;
let reconnectTimer;
let mappingFlushTimer;
let personalFlushTimer;
let nextMappingSendAt = 0;
let nextPersonalSendAt = 0;
let reconnectAttempt = 0;
let apiEnabled = true;
const mappingSnapshotQueue = new Map();
const adaptationLookupQueue = new Map();
const personalAdaptationQueue = new Map();
const recentMappingTabs = new Map();
let connectionStatus = {
  state: "idle",
  url: null,
  reason: "A conexão com a API ainda não foi iniciada."
};

function setConnectionStatus(state, url, reason) {
  connectionStatus = { state, url, reason };
}

function getWebSocketUrl(baseUrl) {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  // A API local utiliza IPv4 por padrão. Evita que localhost seja resolvido
  // como ::1 quando o servidor estiver escutando somente em 127.0.0.1.
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
  }

  return url.toString();
}

function clearConnectionTimers() {
  clearInterval(heartbeatTimer);
  clearTimeout(handshakeTimer);
  clearTimeout(reconnectTimer);
  clearTimeout(mappingFlushTimer);
  clearTimeout(personalFlushTimer);
  heartbeatTimer = undefined;
  handshakeTimer = undefined;
  reconnectTimer = undefined;
  mappingFlushTimer = undefined;
  personalFlushTimer = undefined;
}

function startHandshakeTimeout(socket, socketUrl) {
  clearTimeout(handshakeTimer);
  handshakeTimer = setTimeout(() => {
    if (socket !== apiSocket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    setConnectionStatus("disconnected", socketUrl, "A API nao confirmou o handshake; nova tentativa agendada.");
    socket.close(1008, "Handshake nao confirmado.");
  }, HANDSHAKE_TIMEOUT_MS);
}

function closeApiSocket(reason = "EasyWeb desativado.") {
  clearConnectionTimers();
  const socket = apiSocket;
  apiSocket = undefined;
  socket?.close(1000, reason);
}

async function getInstallationId() {
  const saved = await chrome.storage.local.get(INSTALLATION_ID_KEY);
  if (typeof saved[INSTALLATION_ID_KEY] === "string" && /^[a-f\d-]{16,128}$/i.test(saved[INSTALLATION_ID_KEY])) {
    return saved[INSTALLATION_ID_KEY];
  }

  const installationId = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALLATION_ID_KEY]: installationId });
  return installationId;
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  const delay = Math.min(1_000 * (2 ** reconnectAttempt), MAX_RECONNECT_DELAY_MS);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    startConnectionAttempt();
  }, delay);
}

function startConnectionAttempt() {
  connectToApi().catch(() => {
    if (!apiEnabled) {
      return;
    }
    setConnectionStatus("disconnected", connectionStatus.url, "Não foi possível iniciar a conexão com a API; nova tentativa agendada.");
    scheduleReconnect();
  });
}

function hasConfirmedApiConnection(socket = apiSocket) {
  return socket === apiSocket && socket?.readyState === WebSocket.OPEN && connectionStatus.state === "connected";
}

function startHeartbeat(socket) {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (socket !== apiSocket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      socket.send(JSON.stringify({ type: "easyweb:ping" }));
    } catch (error) {
      socket.close(1011, "Heartbeat indisponível.");
      return;
    }
    flushMappingSnapshots(socket);
    flushAdaptationLookups(socket);
    flushPersonalAdaptationRequests(socket);
  }, HEARTBEAT_INTERVAL_MS);
}

function isSnapshotFromSender(snapshot, sender) {
  if (!sender.tab?.id || !snapshot?.page?.origin || !snapshot?.page?.path || !sender.url) {
    return false;
  }

  try {
    const senderUrl = new URL(sender.url);
    return senderUrl.origin === snapshot.page.origin && senderUrl.pathname === snapshot.page.path;
  } catch (error) {
    return false;
  }
}

function getConfirmedTemplateStorageKey(origin) {
  return `${EasyWebSettingsHandler.MAPPING_CONFIRMED_TEMPLATE_PREFIX}${origin}`;
}

function getConfirmedTemplateEntry(snapshot) {
  return `${snapshot.page.path}:${snapshot.templateFingerprint}`;
}

function normalizeConfirmedTemplateEntry(value) {
  if (typeof value === "string") {
    // Entradas antigas não registram horário e precisam de uma revalidação.
    return { template: value, lastStoredAt: 0 };
  }
  if (value && typeof value === "object" && typeof value.template === "string") {
    const lastStoredAt = Number(value.lastStoredAt);
    return {
      template: value.template,
      lastStoredAt: Number.isFinite(lastStoredAt) && lastStoredAt > 0 ? lastStoredAt : 0
    };
  }
  return null;
}

async function getConfirmedTemplate(snapshot) {
  const { origin } = snapshot.page;
  const storageKey = getConfirmedTemplateStorageKey(origin);
  const saved = await chrome.storage.local.get(storageKey);
  const target = getConfirmedTemplateEntry(snapshot);
  const entries = Array.isArray(saved[storageKey]) ? saved[storageKey] : [];
  return entries.map(normalizeConfirmedTemplateEntry).find((entry) => entry?.template === target) || null;
}

async function rememberConfirmedTemplate(snapshot) {
  const { origin } = snapshot.page;
  const storageKey = getConfirmedTemplateStorageKey(origin);
  const saved = await chrome.storage.local.get(storageKey);
  const templates = Array.isArray(saved[storageKey]) ? saved[storageKey] : [];
  const entry = getConfirmedTemplateEntry(snapshot);
  const normalized = templates.map(normalizeConfirmedTemplateEntry).filter(Boolean)
    .filter((candidate) => candidate.template !== entry);
  await chrome.storage.local.set({
    [storageKey]: [{ template: entry, lastStoredAt: Date.now() }, ...normalized].slice(0, 16)
  });
}

function scheduleMappingSnapshotFlush(socket, delay = MIN_MAPPING_SEND_INTERVAL_MS) {
  clearTimeout(mappingFlushTimer);
  mappingFlushTimer = setTimeout(() => {
    mappingFlushTimer = undefined;
    flushMappingSnapshots(socket);
  }, Math.max(0, delay));
}

function schedulePersonalAdaptationFlush(socket, delay = MIN_PERSONAL_SEND_INTERVAL_MS) {
  clearTimeout(personalFlushTimer);
  personalFlushTimer = setTimeout(() => {
    personalFlushTimer = undefined;
    flushPersonalAdaptationRequests(socket);
  }, Math.max(0, delay));
}

function queueAdaptationLookup(origin, tabId) {
  if (tabId) {
    recentMappingTabs.set(origin, tabId);
  }
  const item = adaptationLookupQueue.get(origin) || { origin, tabId, lastSentAt: 0 };
  if (tabId) {
    item.tabId = tabId;
  }
  adaptationLookupQueue.set(origin, item);
  if (hasConfirmedApiConnection()) {
    flushAdaptationLookups(apiSocket);
  } else {
    ensureApiConnection();
  }
}

function isOriginFromSender(origin, sender) {
  if (!sender?.tab?.id || typeof sender.url !== "string" || typeof origin !== "string") {
    return false;
  }

  try {
    return new URL(sender.url).origin === origin;
  } catch (error) {
    return false;
  }
}

async function queueAdaptationLookupRequest(origin, sender) {
  const saved = await chrome.storage.local.get([
    EasyWebSettingsHandler.EASYWEB_ENABLED_KEY,
    EasyWebSettingsHandler.OPERATION_MODE_KEY
  ]);
  if (saved[EasyWebSettingsHandler.EASYWEB_ENABLED_KEY] === false) {
    return { accepted: false, reason: "O EasyWeb esta desativado." };
  }
  if (EasyWebSettingsHandler.normalizeOperationMode(saved[EasyWebSettingsHandler.OPERATION_MODE_KEY]) !==
    EasyWebSettingsHandler.OPERATION_MODES.ENHANCED) {
    return { accepted: false, reason: "A Experiencia Adaptativa esta disponivel apenas no modo Aprimorado." };
  }
  if (!isOriginFromSender(origin, sender)) {
    return { accepted: false, reason: "A consulta nao corresponde a pagina atual." };
  }

  queueAdaptationLookup(origin, sender.tab.id);
  return {
    accepted: true,
    state: "checking-adaptation",
    message: "Consultando uma adaptacao compativel ja preparada para este site."
  };
}

function notifyMappingStatus(item, status) {
  chrome.tabs.sendMessage(item.tabId, {
    type: "easyweb:mapping-delivery-status",
    status: { ...status, captureId: status.captureId || item.captureId }
  }).catch(() => {
    // A aba pode ter navegado antes da confirmação; o cache confirmado ainda é atualizado.
  });
}

function ensureApiConnection() {
  if (apiSocket?.readyState === WebSocket.OPEN || apiSocket?.readyState === WebSocket.CONNECTING) {
    return;
  }
  startConnectionAttempt();
}

async function queueMappingSnapshot(snapshot, sender, force = false, captureId) {
  const saved = await chrome.storage.local.get([
    EasyWebSettingsHandler.EASYWEB_ENABLED_KEY,
    EasyWebSettingsHandler.OPERATION_MODE_KEY
  ]);
  if (saved[EasyWebSettingsHandler.EASYWEB_ENABLED_KEY] === false) {
    return { accepted: false, reason: "O EasyWeb está desativado." };
  }
  if (EasyWebSettingsHandler.normalizeOperationMode(saved[EasyWebSettingsHandler.OPERATION_MODE_KEY]) !==
    EasyWebSettingsHandler.OPERATION_MODES.ENHANCED) {
    return { accepted: false, reason: "Snapshots estão disponíveis apenas no modo Aprimorado." };
  }
  if (!isSnapshotFromSender(snapshot, sender)) {
    return { accepted: false, reason: "O snapshot não corresponde à página que o enviou." };
  }
  if (!/^[a-f\d]{64}$/i.test(snapshot.templateFingerprint || "")) {
    return { accepted: false, reason: "A assinatura dos ativos do site é inválida." };
  }
  const normalizedCaptureId = typeof captureId === "string" && /^[a-f\d-]{16,128}$/i.test(captureId)
    ? captureId
    : crypto.randomUUID();

  const envelope = { type: "easyweb:mapping:snapshot", snapshot };
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_MAPPING_SNAPSHOT_BYTES) {
    return { accepted: false, reason: "O snapshot excede o limite de transporte de 512 KB." };
  }

  const confirmedTemplate = force ? null : await getConfirmedTemplate(snapshot);
  const confirmationAge = confirmedTemplate ? Date.now() - confirmedTemplate.lastStoredAt : Infinity;
  if (confirmedTemplate && confirmationAge >= 0 && confirmationAge < CONFIRMED_TEMPLATE_REFRESH_MS) {
    queueAdaptationLookup(snapshot.page.origin, sender.tab.id);
    return {
      accepted: true,
      state: "checking-adaptation",
      confirmedAt: confirmedTemplate.lastStoredAt,
      message: "Template confirmado; verificando um plano de adaptacao na API."
    };
  }

  const key = `${snapshot.page.origin}:${snapshot.page.path}:${snapshot.templateFingerprint}`;
  const existing = mappingSnapshotQueue.get(key);
  if (existing?.lastSentAt) {
    existing.tabId = sender.tab.id;
    existing.pendingSnapshot = snapshot;
    existing.pendingCaptureId = normalizedCaptureId;
    recentMappingTabs.set(snapshot.page.origin, sender.tab.id);
    return {
      accepted: true,
      state: "sending",
      message: "Aguardando a confirmacao do snapshot anterior antes de atualizar esta estrutura."
    };
  }
  const item = existing || {
    key,
    tabId: sender.tab.id,
    origin: snapshot.page.origin,
    templateFingerprint: snapshot.templateFingerprint,
    captureId: normalizedCaptureId,
    envelope: { ...envelope, snapshotId: crypto.randomUUID() },
    lastSentAt: 0
  };
  item.tabId = sender.tab.id;
  item.captureId = normalizedCaptureId;
  item.envelope.snapshot = snapshot;
  mappingSnapshotQueue.set(key, item);
  recentMappingTabs.set(snapshot.page.origin, sender.tab.id);
  while (mappingSnapshotQueue.size > MAX_QUEUED_SNAPSHOTS) {
    const discardedKey = mappingSnapshotQueue.keys().next().value;
    const discarded = mappingSnapshotQueue.get(discardedKey);
    mappingSnapshotQueue.delete(discardedKey);
    if (discarded) {
      notifyMappingStatus(discarded, {
        state: "rejected",
        message: "A fila local de snapshots atingiu o limite; esta captura foi descartada."
      });
    }
  }

  if (hasConfirmedApiConnection()) {
    flushMappingSnapshots(apiSocket);
    return { accepted: true, state: "sending" };
  }

  ensureApiConnection();
  return {
    accepted: true,
    state: "queued",
    message: `Aguardando WebSocket: ${connectionStatus.reason}`
  };
}

function isPersonalRequestFromSender(snapshot, sender) {
  return isSnapshotFromSender(snapshot, sender) &&
    typeof snapshot?.page?.origin === "string" &&
    typeof snapshot?.page?.path === "string";
}

async function queuePersonalAdaptationRequest(payload, sender) {
  const saved = await chrome.storage.local.get([
    EasyWebSettingsHandler.EASYWEB_ENABLED_KEY,
    EasyWebSettingsHandler.OPERATION_MODE_KEY,
    EasyWebSettingsHandler.AI_RECOMMENDATIONS_ENABLED_KEY
  ]);
  if (saved[EasyWebSettingsHandler.EASYWEB_ENABLED_KEY] === false ||
    EasyWebSettingsHandler.normalizeOperationMode(saved[EasyWebSettingsHandler.OPERATION_MODE_KEY]) !==
      EasyWebSettingsHandler.OPERATION_MODES.ENHANCED ||
    !saved[EasyWebSettingsHandler.AI_RECOMMENDATIONS_ENABLED_KEY]) {
    return { accepted: false, reason: "A Experiência Adaptativa está desativada." };
  }
  if (!payload?.requestId || !isPersonalRequestFromSender(payload.snapshot, sender)) {
    return { accepted: false, reason: "O pedido não corresponde à página atual." };
  }
  if (typeof payload.userRequest?.text !== "string" || !payload.userRequest.text.trim()) {
    return { accepted: false, reason: "Informe o ajuste desejado antes de enviar." };
  }

  const envelope = {
    type: "easyweb:adaptation:personal-request",
    requestId: payload.requestId,
    origin: payload.snapshot.page.origin,
    snapshot: payload.snapshot,
    basePlanId: typeof payload.basePlanId === "string" && payload.basePlanId ? payload.basePlanId : null,
    profile: payload.profile,
    userRequest: payload.userRequest,
    previousPersonalPlan: payload.previousPersonalPlan
  };
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_MAPPING_SNAPSHOT_BYTES) {
    return { accepted: false, reason: "O snapshot excede o limite de transporte de 512 KB." };
  }

  personalAdaptationQueue.set(payload.requestId, {
    requestId: payload.requestId,
    tabId: sender.tab.id,
    origin: payload.snapshot.page.origin,
    profileId: typeof payload.profile === "string" && payload.profile ? payload.profile : "default",
    envelope,
    lastSentAt: 0,
    sent: false
  });
  recentMappingTabs.set(payload.snapshot.page.origin, sender.tab.id);
  if (hasConfirmedApiConnection()) {
    flushPersonalAdaptationRequests(apiSocket);
    return { accepted: true, state: "queued" };
  }

  ensureApiConnection();
  return { accepted: true, state: "queued", message: "Aguardando conexão com a API." };
}

function flushMappingSnapshots(socket) {
  if (!hasConfirmedApiConnection(socket)) {
    return;
  }

  const now = Date.now();
  if (now < nextMappingSendAt) {
    scheduleMappingSnapshotFlush(socket, nextMappingSendAt - now);
    return;
  }

  const item = [...mappingSnapshotQueue.values()].find((candidate) =>
    !candidate.lastSentAt || now - candidate.lastSentAt >= SNAPSHOT_ACK_TIMEOUT_MS
  );
  if (!item) {
    return;
  }

  try {
    socket.send(JSON.stringify(item.envelope));
    item.lastSentAt = now;
    nextMappingSendAt = now + MIN_MAPPING_SEND_INTERVAL_MS;
    notifyMappingStatus(item, { state: "sending", message: "Enviando estrutura protegida para a API." });
    if (mappingSnapshotQueue.size > 1) {
      scheduleMappingSnapshotFlush(socket);
    }
  } catch (error) {
    scheduleMappingSnapshotFlush(socket, MIN_MAPPING_SEND_INTERVAL_MS);
  }
}

function flushAdaptationLookups(socket) {
  if (!hasConfirmedApiConnection(socket)) {
    return;
  }

  const now = Date.now();
  for (const item of adaptationLookupQueue.values()) {
    if (item.lastSentAt && now - item.lastSentAt < MIN_ADAPTATION_LOOKUP_INTERVAL_MS) {
      continue;
    }
    try {
      socket.send(JSON.stringify({ type: "easyweb:adaptation:lookup", origin: item.origin }));
      item.lastSentAt = now;
    } catch (error) {
      break;
    }
  }
}

function flushPersonalAdaptationRequests(socket) {
  if (!hasConfirmedApiConnection(socket)) {
    return;
  }

  const now = Date.now();
  if (now < nextPersonalSendAt) {
    schedulePersonalAdaptationFlush(socket, nextPersonalSendAt - now);
    return;
  }

  const item = [...personalAdaptationQueue.values()].find((candidate) => !candidate.sent);
  if (!item) {
    return;
  }

  try {
      socket.send(JSON.stringify(item.envelope));
      item.lastSentAt = now;
      item.sent = true;
      nextPersonalSendAt = now + MIN_PERSONAL_SEND_INTERVAL_MS;
      deliverToTab(item.tabId, {
        type: "easyweb:ai-adaptation-status",
        status: { state: "analyzing-personal", message: "A IA está preparando seus ajustes adicionais." }
      }).catch(() => {});
      if ([...personalAdaptationQueue.values()].some((candidate) => !candidate.sent)) {
        schedulePersonalAdaptationFlush(socket);
      }
  } catch (error) {
    schedulePersonalAdaptationFlush(socket);
  }
}

async function handleMappingDelivery(message) {
  const item = [...mappingSnapshotQueue.values()].find((candidate) => candidate.envelope.snapshotId === message.snapshotId);
  if (!item) {
    return;
  }

  if (message.type === "easyweb:mapping:stored") {
    const storedSnapshot = item.envelope.snapshot;
    const storedCaptureId = item.captureId;
    await rememberConfirmedTemplate(storedSnapshot);
    notifyMappingStatus(item, {
      state: "stored",
      captureId: storedCaptureId,
      message: "Estrutura recebida e confirmada pela API."
    });
    if (item.pendingSnapshot) {
      item.envelope = {
        ...item.envelope,
        snapshot: item.pendingSnapshot,
        snapshotId: crypto.randomUUID()
      };
      item.captureId = item.pendingCaptureId;
      item.pendingSnapshot = undefined;
      item.pendingCaptureId = undefined;
      item.lastSentAt = 0;
      notifyMappingStatus(item, {
        state: "queued",
        message: "Snapshot confirmado; enviando a atualizacao mais recente."
      });
      scheduleMappingSnapshotFlush(apiSocket, Math.max(0, nextMappingSendAt - Date.now()));
      return;
    }
    mappingSnapshotQueue.delete(item.key);
    return;
  }

  if (message.retryable === false) {
    mappingSnapshotQueue.delete(item.key);
    notifyMappingStatus(item, {
      state: "rejected",
      message: message.reason || "A API recusou este snapshot."
    });
    return;
  }

  item.lastSentAt = 0;
  nextMappingSendAt = Math.max(nextMappingSendAt, Date.now() + MIN_MAPPING_SEND_INTERVAL_MS);
  notifyMappingStatus(item, {
    state: "queued",
    message: message.reason || "A API recusou este snapshot."
  });
  scheduleMappingSnapshotFlush(apiSocket, Math.max(0, nextMappingSendAt - Date.now()));
}

async function deliverToTab(tabId, message) {
  if (!tabId) return false;
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (error) {
    if (!EasyWebContentInjectionHandler.isRecoverableMessageError(error)) return false;
    try {
      await EasyWebContentInjectionHandler.inject(tabId);
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch (injectionError) {
      return false;
    }
  }
}

async function sendToOriginTabs(origin, message, preferredTabId) {
  const tabs = await chrome.tabs.query({});
  const matchingTabs = tabs.filter((tab) => {
    if (!tab.id || typeof tab.url !== "string") {
      return false;
    }
    try {
      return new URL(tab.url).origin === origin;
    } catch (error) {
      return false;
    }
  });
  if (!matchingTabs.length && preferredTabId) {
    matchingTabs.push({ id: preferredTabId });
  }
  await Promise.all(matchingTabs.map((tab) => deliverToTab(tab.id, message)));
}

async function handleAdaptationDelivery(message) {
  if (!message?.origin || typeof message.origin !== "string") {
    return;
  }
  const preferredTabId = recentMappingTabs.get(message.origin);
  if (message.type === "easyweb:adaptation:base-plan" && message.plan) {
    adaptationLookupQueue.delete(message.origin);
    const siteSettings = EasyWebSettingsHandler.create({
      origin: message.origin,
      href: `${message.origin}/`
    });
    try {
      await siteSettings.saveAiBasePlan(message.plan);
    } catch (error) {
      // A entrega direta ainda permite aplicar o plano nesta aba; o cache será
      // tentado novamente pelo content script quando o armazenamento voltar.
    }
    await sendToOriginTabs(message.origin, {
      type: "easyweb:apply-ai-base-plan",
      plan: message.plan
    }, preferredTabId);
    return;
  }

  if (message.type === "easyweb:adaptation:personal-plan" && message.plan) {
    const item = personalAdaptationQueue.get(message.requestId);
    personalAdaptationQueue.delete(message.requestId);
    await deliverToTab(item?.tabId || preferredTabId, {
      type: "easyweb:apply-ai-personal-plan",
      plan: message.plan,
      profileId: item?.profileId,
      requestId: message.requestId
    }).catch(() => {});
    return;
  }

  if (message.type === "easyweb:adaptation:personal-status" || message.type === "easyweb:adaptation:error") {
    const item = message.requestId ? personalAdaptationQueue.get(message.requestId) : null;
    if (message.requestId) {
      personalAdaptationQueue.delete(message.requestId);
    }
    if (message.type === "easyweb:adaptation:error" && message.origin) {
      // Clear failed lookups so a recovered API can be queried immediately.
      adaptationLookupQueue.delete(message.origin);
    }
    await deliverToTab(item?.tabId || preferredTabId, {
      type: "easyweb:ai-adaptation-status",
      status: {
        state: message.state || "error",
        message: message.reason || {
          "base-plan-unavailable": "O plano base não está mais disponível para este site.",
          "invalid-personal-request": "Não foi possível usar este pedido de adaptação.",
          "model-unavailable": "A API ainda não tem uma chave Gemini configurada.",
          "rate-limited": "Aguarde alguns segundos antes de solicitar outro ajuste pessoal."
        }[message.state] || "Não foi possível concluir a análise de IA agora."
      }
    }).catch(() => {});
    return;
  }

  if (message.type === "easyweb:adaptation:status") {
    // While an analysis is in progress, keep a low-frequency lookup alive. It
    // recovers delivery when either side reconnects before the worker finishes.
    if (message.state !== "analyzing-base") {
      adaptationLookupQueue.delete(message.origin);
    }
    await sendToOriginTabs(message.origin, {
      type: "easyweb:ai-adaptation-status",
      status: {
        state: message.state,
        similarity: message.similarity,
        trust: message.trust,
        confidence: message.confidence,
        message: message.state === "analyzing-base"
          ? "A IA esta preparando uma adaptacao para a estrutura confirmada deste site."
          : message.state === "awaiting-family-confidence"
            ? "A API esta reunindo evidencias suficientes antes de solicitar uma adaptacao."
            : message.state === "family-stable-no-opportunity"
              ? "A API confirmou a familia, mas nao encontrou uma melhoria automatica segura."
          : undefined
      }
    }, preferredTabId);
  }
}

async function connectToApi() {
  clearConnectionTimers();
  const saved = await chrome.storage.local.get([
    EasyWebSettingsHandler.DEVELOPER_MODE_KEY,
    EasyWebSettingsHandler.API_BASE_URL_KEY,
    EasyWebSettingsHandler.EASYWEB_ENABLED_KEY,
    EasyWebSettingsHandler.OPERATION_MODE_KEY
  ]);
  const operationMode = EasyWebSettingsHandler.normalizeOperationMode(saved[EasyWebSettingsHandler.OPERATION_MODE_KEY]);
  apiEnabled = saved[EasyWebSettingsHandler.EASYWEB_ENABLED_KEY] !== false &&
    operationMode === EasyWebSettingsHandler.OPERATION_MODES.ENHANCED;
  if (!apiEnabled) {
    closeApiSocket();
    mappingSnapshotQueue.clear();
    adaptationLookupQueue.clear();
    personalAdaptationQueue.clear();
    nextMappingSendAt = 0;
    nextPersonalSendAt = 0;
    setConnectionStatus(
      operationMode === EasyWebSettingsHandler.OPERATION_MODES.STANDARD ? "standby" : "disabled",
      null,
      operationMode === EasyWebSettingsHandler.OPERATION_MODES.STANDARD
        ? "Modo Padrão ativo; a API e os snapshots estão desativados."
        : "O EasyWeb está desativado."
    );
    return;
  }

  nextMappingSendAt = 0;
  nextPersonalSendAt = 0;
  for (const item of mappingSnapshotQueue.values()) {
    item.lastSentAt = 0;
  }
  for (const item of adaptationLookupQueue.values()) {
    item.lastSentAt = 0;
  }
  for (const item of personalAdaptationQueue.values()) {
    item.lastSentAt = 0;
    item.sent = false;
  }

  const previousSocket = apiSocket;
  apiSocket = undefined;
  previousSocket?.close(1000, "Reconfigurando conexão.");
  const configuration = EasyWebSettingsHandler.getApiConfiguration(saved);
  const socketUrl = getWebSocketUrl(configuration.baseUrl);
  let socket;
  try {
    socket = new WebSocket(socketUrl);
  } catch (error) {
    setConnectionStatus("disconnected", socketUrl, `Não foi possível abrir ${socketUrl}; nova tentativa agendada.`);
    scheduleReconnect();
    return;
  }
  apiSocket = socket;
  setConnectionStatus("connecting", socketUrl, `Conectando a ${socketUrl}`);

  socket.addEventListener("open", () => {
    (async () => {
      if (socket !== apiSocket) {
        socket.close(1000, "Conexão substituída.");
        return;
      }

      reconnectAttempt = 0;
      setConnectionStatus("handshaking", socketUrl, `Confirmando a conexao com ${socketUrl}`);
      const installationId = await getInstallationId();
      if (socket !== apiSocket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(JSON.stringify({
        type: "easyweb:hello",
        protocolVersion: 1,
        extensionVersion: chrome.runtime.getManifest().version_name,
        installationId
      }));
      startHandshakeTimeout(socket, socketUrl);
    })().catch(() => {
      if (socket === apiSocket) {
        setConnectionStatus("disconnected", socketUrl, "Não foi possível concluir o handshake com a API.");
        socket.close(1011, "Handshake indisponível.");
      }
    });
  });

  socket.addEventListener("message", (event) => {
    if (socket !== apiSocket) {
      return;
    }

    try {
      const message = JSON.parse(event.data);
      if (message?.type === "easyweb:hello") {
        if (message.protocolVersion !== 1) {
          setConnectionStatus("disconnected", socketUrl, "A API usa uma versao de protocolo incompativel.");
          socket.close(1008, "Protocolo incompativel.");
          return;
        }
        clearTimeout(handshakeTimer);
        handshakeTimer = undefined;
        setConnectionStatus("connected", socketUrl, `Conectado a ${socketUrl}`);
        startHeartbeat(socket);
        flushMappingSnapshots(socket);
        flushAdaptationLookups(socket);
        flushPersonalAdaptationRequests(socket);
      } else if (message?.type === "easyweb:pong") {
        if (connectionStatus.state !== "handshaking") {
          setConnectionStatus("connected", socketUrl, `Conectado a ${socketUrl}`);
        }
      } else if (message?.type === "easyweb:mapping:stored" || message?.type === "easyweb:mapping:rejected") {
        handleMappingDelivery(message).catch(() => {
          // O envio será repetido quando o próximo heartbeat ocorrer.
        });
      } else if (message?.type?.startsWith("easyweb:adaptation:")) {
        handleAdaptationDelivery(message).catch(() => {
          // A extensão mantém os planos já validados em cache local.
        });
      }
    } catch (error) {
      // Mensagens que não seguem o protocolo atual são ignoradas.
    }
  });

  socket.addEventListener("error", () => {
    if (socket === apiSocket) {
      setConnectionStatus("disconnected", socketUrl, `Não foi possível conectar a ${socketUrl}`);
    }
  });

  socket.addEventListener("close", () => {
    if (socket !== apiSocket) {
      return;
    }

    if (!apiEnabled) {
      return;
    }

    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    clearTimeout(handshakeTimer);
    handshakeTimer = undefined;
    nextMappingSendAt = 0;
    nextPersonalSendAt = 0;
    for (const item of mappingSnapshotQueue.values()) {
      item.lastSentAt = 0;
    }
    for (const item of adaptationLookupQueue.values()) {
      item.lastSentAt = 0;
    }
    for (const item of personalAdaptationQueue.values()) {
      item.lastSentAt = 0;
      item.sent = false;
    }
    setConnectionStatus("disconnected", socketUrl, `Conexão com ${socketUrl} interrompida; nova tentativa agendada.`);
    scheduleReconnect();
  });
}

async function refreshTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "easyweb:refresh-config" });
    if (response !== undefined) {
      return;
    }
    throw new Error("Message port closed before a response was received.");
  } catch (error) {
    if (!EasyWebContentInjectionHandler.isRecoverableMessageError(error)) {
      return;
    }
    try {
      await EasyWebContentInjectionHandler.inject(tabId);
      await chrome.tabs.sendMessage(tabId, { type: "easyweb:refresh-config" });
    } catch (injectionError) {
      // Páginas restritas do navegador não permitem injeção de scripts.
    }
  }
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((tab) => tab.id).map((tab) => refreshTab(tab.id)));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "easyweb:get-api-connection-status") {
    sendResponse({ ...connectionStatus });
    return;
  }

  if (message?.type === "easyweb:mapping:snapshot") {
    queueMappingSnapshot(message.snapshot, sender, message.force === true, message.captureId)
      .then(sendResponse)
      .catch(() => sendResponse({ accepted: false, reason: "Não foi possível preparar o snapshot." }));
    return true;
  }

  if (message?.type === "easyweb:adaptation:lookup") {
    queueAdaptationLookupRequest(message.origin, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ accepted: false, reason: "Nao foi possivel consultar a adaptacao deste site." }));
    return true;
  }

  if (message?.type === "easyweb:adaptation:personal-request") {
    queuePersonalAdaptationRequest(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ accepted: false, reason: "Não foi possível preparar sua solicitação." }));
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => {
  startConnectionAttempt();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[EasyWebSettingsHandler.DEVELOPER_MODE_KEY] ||
    changes[EasyWebSettingsHandler.API_BASE_URL_KEY] ||
    changes[EasyWebSettingsHandler.EASYWEB_ENABLED_KEY] ||
    changes[EasyWebSettingsHandler.OPERATION_MODE_KEY]) {
    startConnectionAttempt();
  }

  if (changes[EasyWebSettingsHandler.AI_RECOMMENDATIONS_ENABLED_KEY] &&
    changes[EasyWebSettingsHandler.AI_RECOMMENDATIONS_ENABLED_KEY].newValue !== true) {
    personalAdaptationQueue.clear();
    clearTimeout(personalFlushTimer);
    personalFlushTimer = undefined;
    nextPersonalSendAt = 0;
  }

  if (changes[EasyWebSettingsHandler.ACTIVE_PROFILE_KEY] ||
    changes[EasyWebSettingsHandler.DALTONIC_FILTER_KEY] ||
    changes[EasyWebSettingsHandler.EASYWEB_ENABLED_KEY] ||
    changes[EasyWebSettingsHandler.OPERATION_MODE_KEY] ||
    changes[EasyWebSettingsHandler.MAPPING_CONSENT_ENABLED_KEY] ||
    changes[EasyWebSettingsHandler.AI_RECOMMENDATIONS_ENABLED_KEY]) {
    refreshAllTabs().catch(() => {
      // A próxima navegação recarrega o content script quando uma aba não puder ser atualizada agora.
    });
  }
});

startConnectionAttempt();
