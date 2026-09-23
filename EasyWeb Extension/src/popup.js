const DEFAULTS = Object.freeze({
  enabled: false,
  fontScale: 1,
  lineHeight: 1.4,
  letterSpacing: 0,
  contrast: false,
  highlightLinks: false,
  reduceMotion: false,
  readingFocus: false,
  colorFilter: "none",
  fastMode: false
});

const controls = {
  fontScale: document.querySelector("#font-scale"),
  lineHeight: document.querySelector("#line-height"),
  letterSpacing: document.querySelector("#letter-spacing"),
  contrast: document.querySelector("#contrast"),
  highlightLinks: document.querySelector("#highlight-links"),
  reduceMotion: document.querySelector("#reduce-motion"),
  readingFocus: document.querySelector("#reading-focus"),
  colorFilterEnabled: document.querySelector("#color-filter-enabled"),
  colorFilterType: document.querySelector("#color-filter-type"),
  fastMode: document.querySelector("#fast-mode")
};

const outputs = {
  fontScale: document.querySelector("#font-scale-value"),
  lineHeight: document.querySelector("#line-height-value"),
  letterSpacing: document.querySelector("#letter-spacing-value")
};

const extensionToggle = document.querySelector("#easyweb-enabled");
const manualModeToggle = document.querySelector("#site-manual-mode");
const easyWebContent = document.querySelector("#easyweb-content");
const manualSettings = document.querySelector("#manual-settings");
const mappingSiteConsentToggle = document.querySelector("#mapping-site-consent");
const mappingCaptureButton = document.querySelector("#mapping-capture-now");
const mappingCard = document.querySelector(".mapping-card");
const aiSiteEnabledToggle = document.querySelector("#ai-site-enabled");
const aiRequestControls = document.querySelector("#ai-request-controls");
const aiRequestText = document.querySelector("#ai-request-text");
const aiRequestSubmit = document.querySelector("#ai-request-submit");
const aiAdaptationCard = document.querySelector(".ai-card");
const aiPlanControls = document.querySelector("#ai-plan-controls");
const aiPlanHistory = document.querySelector("#ai-plan-history");
const aiRestorePrevious = document.querySelector("#ai-restore-previous");
const aiConnectionStatus = document.querySelector("#ai-connection-status");
const operationModeSelect = document.querySelector("#operation-mode");
const restoreGlobalToggle = document.querySelector("#restore-global-profile");

let activeTab;
let settingsQueue = Promise.resolve();
let settingsTimer;
let lastFastModeStatus;
let activeProfileLabel = "Padrão";
let extensionEnabled = true;
let manualMode = false;
let operationMode = EasyWebSettingsHandler.OPERATION_MODES.STANDARD;
let lastAiPreferences = {};
let lastAiPlanState = {};
let lastApiConnection = {};

function setStatus(message, isError = false) {
  document.querySelector("#status-text").textContent = message;
  document.querySelector("#status-dot").classList.toggle("error", isError);
}

function readSettings() {
  return {
    enabled: true,
    fontScale: Number(controls.fontScale.value) / 100,
    lineHeight: Number(controls.lineHeight.value) / 100,
    letterSpacing: Number(controls.letterSpacing.value),
    contrast: controls.contrast.checked,
    highlightLinks: controls.highlightLinks.checked,
    reduceMotion: controls.reduceMotion.checked,
    readingFocus: controls.readingFocus.checked,
    colorFilter: controls.colorFilterEnabled.checked ? controls.colorFilterType.value : "none",
    fastMode: controls.fastMode.checked && !controls.fastMode.disabled
  };
}

function renderSettings(settings) {
  const next = { ...DEFAULTS, ...settings };
  controls.fontScale.value = Math.round(next.fontScale * 100);
  controls.lineHeight.value = Math.round(next.lineHeight * 100);
  controls.letterSpacing.value = next.letterSpacing;
  controls.contrast.checked = next.contrast;
  controls.highlightLinks.checked = next.highlightLinks;
  controls.reduceMotion.checked = next.reduceMotion;
  controls.readingFocus.checked = next.readingFocus;
  controls.colorFilterEnabled.checked = next.colorFilter !== "none";
  controls.colorFilterType.value = next.colorFilter === "none" ? "deuteranopia" : next.colorFilter;
  controls.fastMode.checked = next.fastMode;
  updateColorFilterVisibility();
  updateOutputs();
}

function updateOutputs() {
  outputs.fontScale.value = `${controls.fontScale.value}%`;
  outputs.lineHeight.value = `${(Number(controls.lineHeight.value) / 100).toFixed(1).replace(".", ",")}x`;
  outputs.letterSpacing.value = `${controls.letterSpacing.value}px`;
}

function updateColorFilterVisibility() {
  document.querySelector("#color-filter-type-control").hidden = !controls.colorFilterEnabled.checked;
}

function renderExtensionState(enabled) {
  extensionEnabled = Boolean(enabled);
  extensionToggle.checked = extensionEnabled;
  easyWebContent.hidden = !extensionEnabled;
  document.querySelector("#profile-name").hidden = !extensionEnabled;
  if (!extensionEnabled) {
    setStatus("EasyWeb desativado");
  }
}

function renderManualMode(enabled) {
  manualMode = Boolean(enabled);
  manualModeToggle.checked = manualMode;
  manualSettings.hidden = !manualMode;
  renderSiteScope();
}

function renderRestoreAction() {
  document.querySelector("#restore-global-label").textContent =
    `Restaurar usando o perfil global (${activeProfileLabel})`;
  document.querySelector("#reset").textContent = restoreGlobalToggle.checked
    ? "Voltar ao perfil global neste site"
    : "Desativar ajustes neste site";
}

function renderOperationMode(mode) {
  operationMode = EasyWebSettingsHandler.normalizeOperationMode(mode);
  const enhanced = operationMode === EasyWebSettingsHandler.OPERATION_MODES.ENHANCED;
  operationModeSelect.value = operationMode;
  mappingCard.hidden = !extensionEnabled || !enhanced;
  aiAdaptationCard.hidden = !extensionEnabled || !enhanced;
  document.querySelector("#operation-mode-label").textContent = enhanced
    ? "Modo Aprimorado: API e snapshots disponíveis."
    : "Modo Padrão: algoritmo local do EasyWeb.";
  document.querySelector("#operation-mode-description").textContent = enhanced
    ? "Usa a API e permite snapshots protegidos após os consentimentos necessários."
    : "Usa apenas o algoritmo de manipulação local do EasyWeb.";
}

function renderProfile(profileLabel) {
  activeProfileLabel = profileLabel || "Padrão";
  document.querySelector("#profile-name").textContent = `Perfil global: ${activeProfileLabel}`;
  renderSiteScope();
  renderRestoreAction();
}

function renderSiteScope() {
  const title = document.querySelector("#scope-title");
  const description = document.querySelector("#scope-description");
  if (manualMode) {
    title.textContent = "Este site usa configurações manuais";
    description.textContent = "Os ajustes abaixo substituem o perfil global somente neste site.";
    return;
  }

  title.textContent = "Este site usa o perfil global";
  description.textContent = `Perfil ativo: ${activeProfileLabel}. Ele é aplicado automaticamente em todos os sites.`;
}

function renderUniversalFilter(filter) {
  const filterScope = document.querySelector("#color-filter-scope");
  const isUniversal = Boolean(filter);
  controls.colorFilterEnabled.disabled = isUniversal;
  controls.colorFilterType.disabled = isUniversal;
  if (isUniversal) {
    controls.colorFilterEnabled.checked = true;
    controls.colorFilterType.value = filter;
    const label = controls.colorFilterType.selectedOptions[0]?.textContent || "selecionado";
    filterScope.textContent = `Filtro universal ativo: ${label}. Altere em Mais configurações.`;
  } else {
    filterScope.textContent = "Aplicar somente neste site";
  }
  updateColorFilterVisibility();
}

function renderFastModeStatus(status) {
  lastFastModeStatus = status;
  const message = document.querySelector("#fast-mode-status");
  const isEligible = manualMode && extensionEnabled && status?.eligible === true;
  controls.fastMode.disabled = !isEligible;
  if (!isEligible) {
    controls.fastMode.checked = false;
  }
  message.textContent = !manualMode
    ? "Ative as configurações manuais para usar este modo neste site."
    : status?.reason || "Indisponível nesta página.";
}

function renderMappingDelivery(delivery = {}) {
  const status = document.querySelector("#mapping-delivery");
  const state = delivery.state || "idle";
  const labels = {
    "checking-adaptation": "Consultando um plano de adaptacao na API.",
    "already-stored": "Template já sincronizado com a API.",
    "awaiting-consent": "Aguardando autorização.",
    blocked: "Captura bloqueada pelas regras de segurança.",
    error: "Não foi possível preparar o snapshot.",
    idle: "Pronto para enviar quando autorizado.",
    preparing: "Preparando estrutura protegida.",
    queued: "Aguardando conexão com a API.",
    rejected: "A API recusou o snapshot.",
    sending: "Enviando para a API.",
    skipped: "Nenhuma alteração desde a última confirmação.",
    stored: "Recebido e confirmado pela API."
  };
  status.dataset.state = state;
  status.textContent = delivery.message || labels[state] || labels.idle;
}

function renderMappingConsent(consent, delivery = {}) {
  const description = document.querySelector("#mapping-site-description");
  const safeToMap = consent?.safeToMap === true;
  const globalEnabled = consent?.globalEnabled === true;
  const siteAllowed = consent?.siteAllowed === true;
  const enhanced = operationMode === EasyWebSettingsHandler.OPERATION_MODES.ENHANCED;
  const mappingAllowed = extensionEnabled && enhanced && safeToMap && globalEnabled;

  mappingCard.hidden = !extensionEnabled || !enhanced;
  mappingSiteConsentToggle.checked = siteAllowed;
  mappingSiteConsentToggle.disabled = !mappingAllowed;
  mappingCaptureButton.disabled = !mappingAllowed || !siteAllowed;

  if (!enhanced || consent?.operationMode !== EasyWebSettingsHandler.OPERATION_MODES.ENHANCED) {
    description.textContent = "O modo Padrão não usa API nem snapshots.";
    renderMappingDelivery({ state: "awaiting-consent", message: "Altere para o modo Aprimorado em Mais configurações." });
    return;
  }
  if (!extensionEnabled || consent?.extensionEnabled === false) {
    description.textContent = "Ative o EasyWeb antes de autorizar snapshots.";
    renderMappingDelivery({ state: "awaiting-consent", message: "O EasyWeb está desativado." });
    return;
  }
  if (!safeToMap) {
    description.textContent = consent?.reason || "Este contexto não pode ser mapeado.";
    renderMappingDelivery({ state: "blocked", message: "Nenhum dado será enviado." });
    return;
  }
  if (!globalEnabled) {
    description.textContent = "Ative os snapshots em Mais configurações para autorizar este site.";
    renderMappingDelivery({ state: "awaiting-consent", message: "A autorização global está desativada." });
    return;
  }

  description.textContent = siteAllowed
    ? "O snapshot protegido será usado pela análise de IA para melhorar a acessibilidade deste site."
    : "Autorize este site para enviar um snapshot protegido para análise de IA.";
  renderMappingDelivery(siteAllowed
    ? delivery
    : { state: "awaiting-consent", message: "Aguardando autorização deste site." });
}

function renderAiAdaptation(preferences, adaptation = {}, planState, apiConnection) {
  if (preferences && typeof preferences === "object") {
    lastAiPreferences = preferences;
  }
  if (planState && typeof planState === "object") {
    lastAiPlanState = planState;
  }
  if (apiConnection && typeof apiConnection === "object") {
    lastApiConnection = apiConnection;
  }
  const resolvedPreferences = lastAiPreferences;
  const enhanced = operationMode === EasyWebSettingsHandler.OPERATION_MODES.ENHANCED;
  const globallyEnabled = resolvedPreferences.globalEnabled === true;
  const siteEnabled = resolvedPreferences.siteEnabled === true;
  const canRequest = resolvedPreferences.canRequest === true;
  const status = document.querySelector("#ai-adaptation-status");
  const description = document.querySelector("#ai-adaptation-description");
  const state = adaptation.state || "disabled";
  const personalRequestPending = state === "queued" || state === "analyzing-personal";
  const labels = {
    "awaiting-second-snapshot": "Aguardando snapshots: a API precisa de mais uma estrutura compatível deste site.",
    "awaiting-compatible-snapshot": "Aguardando snapshots: a API está identificando uma família de páginas compatível.",
    "awaiting-trusted-snapshots": "Aguardando snapshots: falta confirmar a estabilidade da estrutura deste site.",
    "awaiting-family-confidence": "Aguardando evidências: a API ainda está confirmando a estabilidade desta família de páginas.",
    "family-stable-no-opportunity": "Família estável: a API não identificou uma melhoria automática segura neste momento.",
    "analyzing-base": "Analisando: a IA está preparando os ajustes comuns deste site.",
    "analyzing-personal": "Analisando: a IA está preparando seu ajuste pessoal.",
    "checking-adaptation": "Consultando: verificando uma adaptação já preparada para este site.",
    "rate-limited": "Falhou: aguarde alguns segundos antes de solicitar outro ajuste pessoal.",
    "model-unavailable": "Falhou: a API ainda não tem uma chave Gemini configurada.",
    "model-temporarily-unavailable": "Falhou: a IA está temporariamente indisponível. Tente novamente em alguns instantes.",
    "storage-unavailable": "Falhou: a API está sem armazenamento para analisar este site.",
    "awaiting-plan": "Aguardando snapshots: ainda não há um plano compatível para este site.",
    "automatic-disabled": "Adaptação disponível sob pedido: as adaptações automáticas estão desativadas neste site.",
    active: "Adaptação disponível e aplicada nesta aba.",
    "active-from-cache": "Aplicada do cache local nesta aba.",
    "restored-previous": "Adaptação disponível: a versão anterior foi restaurada nesta aba.",
    "standard-mode": "A IA está disponível apenas no modo Aprimorado.",
    disabled: "Adaptação disponível no modo Aprimorado quando a Experiência Adaptativa estiver ativa."
  };

  aiAdaptationCard.hidden = !extensionEnabled || !enhanced;
  aiSiteEnabledToggle.checked = siteEnabled;
  aiSiteEnabledToggle.disabled = !extensionEnabled || !enhanced || !globallyEnabled;
  aiRequestControls.hidden = !canRequest;
  aiRequestText.disabled = !canRequest;
  aiRequestSubmit.disabled = !canRequest || personalRequestPending;

  if (!enhanced) {
    description.textContent = "O modo Padrão usa apenas o algoritmo local do EasyWeb.";
  } else if (!globallyEnabled) {
    description.textContent = "Ative a Experiência Adaptativa em Mais configurações antes de habilitar este site.";
  } else if (!siteEnabled) {
    description.textContent = "A chave controla somente adaptações automáticas. Você pode pedir um ajuste pessoal abaixo, mesmo sem plano automático.";
  } else {
    description.textContent = "A extensão aplica somente CSS compilado a partir de planos de IA validados.";
  }
  status.textContent = labels[state] || adaptation.message || labels.disabled;

  const previous = lastAiPlanState?.previous;
  const currentPlan = lastAiPlanState?.personalPlan || lastAiPlanState?.basePlan;
  aiPlanControls.hidden = !enhanced || !globallyEnabled;
  aiRestorePrevious.disabled = !previous?.scope;
  aiRestorePrevious.dataset.scope = previous?.scope || "";
  aiPlanHistory.textContent = previous?.entry?.plan?.planId
    ? `Versão anterior disponível: ${previous.scope === "personal" ? "ajuste pessoal" : "adaptação automática"}.`
    : currentPlan?.planId
      ? "Esta adaptação fica armazenada localmente para os próximos acessos."
      : "Nenhuma adaptação disponível para restaurar.";

  const connectionLabels = {
    connected: "API conectada.",
    handshaking: "Confirmando a conexão com a API.",
    connecting: "Conectando à API.",
    disconnected: "API desconectada; o algoritmo Padrão continua ativo.",
    standby: "Modo Padrão: API desativada.",
    disabled: "API desativada enquanto o EasyWeb estiver desligado.",
    unavailable: "Não foi possível consultar a conexão com a API."
  };
  aiConnectionStatus.dataset.state = lastApiConnection?.state || "unavailable";
  aiConnectionStatus.textContent = lastApiConnection?.reason ||
    connectionLabels[lastApiConnection?.state] || connectionLabels.unavailable;
}

function getPersonalIntentTags(text) {
  const normalized = text.toLowerCase();
  const tags = [];
  if (/ler|texto|leitura/.test(normalized)) tags.push("reading-difficulty");
  if (/navega|menu|confus/.test(normalized)) tags.push("navigation-confusion");
  if (/pequen|bot[aã]o|controle|clic/.test(normalized)) tags.push("small-controls");
  if (/contraste|cor|escuro|claro/.test(normalized)) tags.push("low-contrast");
  return tags;
}

async function sendToPage(message) {
  if (!activeTab?.id) {
    throw new Error("No active tab");
  }
  const response = await EasyWebPageHandler.send(activeTab.id, message);
  if (response?.error) {
    throw new Error(response.error);
  }
  return response;
}

async function sendSettings(settings) {
  if (!manualMode || !extensionEnabled) {
    return;
  }
  try {
    const response = await sendToPage({ type: "easyweb:apply-state", settings });
    renderFastModeStatus(response.fastModeStatus);
    renderUniversalFilter(response.universalFilter);
    setStatus("Ajustes manuais salvos neste site");
  } catch (error) {
    setStatus("Esta página não permite ajustes", true);
  }
}

function queueSettings(settings) {
  settingsQueue = settingsQueue.catch(() => {}).then(() => sendSettings(settings));
  return settingsQueue;
}

function scheduleSettings() {
  window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => queueSettings(readSettings()), 90);
}

function renderPageState(response) {
  renderExtensionState(response.extensionEnabled !== false);
  renderOperationMode(response.operationMode);
  renderSettings(response.settings);
  renderProfile(response.profileLabel);
  renderManualMode(response.manualMode);
  renderUniversalFilter(response.universalFilter);
  renderMappingConsent(response.mappingConsent, response.mappingDelivery);
  renderAiAdaptation(response.aiPreferences, response.aiAdaptation, response.aiPlanState, response.apiConnection);
  renderFastModeStatus(response.fastModeStatus);
}

async function loadCurrentTab() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    setStatus("Nenhuma página ativa encontrada", true);
    return;
  }
  try {
    const response = await sendToPage({ type: "easyweb:get-state" });
    renderPageState(response);
    if (response.fastModeStatus?.state === "checking") {
      window.setTimeout(refreshFastModeStatus, 1700);
    }
  } catch (error) {
    const saved = await chrome.storage.local.get(EasyWebSettingsHandler.EASYWEB_ENABLED_KEY);
    renderExtensionState(saved[EasyWebSettingsHandler.EASYWEB_ENABLED_KEY] !== false);
    renderOperationMode(EasyWebSettingsHandler.OPERATION_MODES.STANDARD);
    renderSettings(DEFAULTS);
    renderProfile("Padrão");
    renderManualMode(false);
    renderUniversalFilter(null);
    renderMappingConsent(null, null);
    renderAiAdaptation(null, null, null, { state: "unavailable" });
    renderFastModeStatus({ eligible: false, reason: "Indisponível nesta página." });
    setStatus("Esta página não permite ajustes", true);
  }
}

async function refreshFastModeStatus() {
  try {
    const response = await sendToPage({ type: "easyweb:get-state" });
    renderFastModeStatus(response.fastModeStatus);
  } catch (error) {
    renderFastModeStatus({ eligible: false, reason: "Indisponível nesta página." });
  }
}

async function resetCurrentSite() {
  try {
    await sendToPage({
      type: "easyweb:reset-state",
      mode: restoreGlobalToggle.checked ? "global" : "original"
    });
    await loadCurrentTab();
    setStatus(restoreGlobalToggle.checked
      ? "Perfil global restaurado neste site"
      : "Aparência original restaurada neste site");
  } catch (error) {
    setStatus("Esta página não permite ajustes", true);
  }
}

async function refreshMappingStatus() {
  if (!extensionEnabled || operationMode !== EasyWebSettingsHandler.OPERATION_MODES.ENHANCED) {
    return;
  }
  try {
    const response = await sendToPage({ type: "easyweb:get-state" });
    renderOperationMode(response.operationMode);
    renderMappingConsent(response.mappingConsent, response.mappingDelivery);
    renderAiAdaptation(response.aiPreferences, response.aiAdaptation, response.aiPlanState, response.apiConnection);
  } catch (error) {
    // A aba pode navegar enquanto o popup permanece aberto.
  }
}

extensionToggle.addEventListener("change", async () => {
  const requestedState = extensionToggle.checked;
  try {
    await chrome.storage.local.set({
      [EasyWebSettingsHandler.EASYWEB_ENABLED_KEY]: requestedState
    });
    renderExtensionState(requestedState);
    setStatus(requestedState ? "EasyWeb ativado" : "EasyWeb desativado");
  } catch (error) {
    extensionToggle.checked = !requestedState;
    setStatus("Não foi possível alterar o estado do EasyWeb", true);
  }
});

manualModeToggle.addEventListener("change", async () => {
  const requestedState = manualModeToggle.checked;
  try {
    const response = await sendToPage({ type: "easyweb:set-site-manual-mode", enabled: requestedState });
    renderSettings(response.settings);
    renderProfile(response.profileLabel);
    renderManualMode(response.manualMode);
    renderUniversalFilter(response.universalFilter);
    renderFastModeStatus(response.fastModeStatus);
    setStatus(response.manualMode ? "Configurações manuais ativadas neste site" : "Perfil global restaurado neste site");
  } catch (error) {
    manualModeToggle.checked = !requestedState;
    setStatus("Não foi possível alterar a configuração deste site", true);
  }
});

operationModeSelect.addEventListener("change", async () => {
  const nextMode = EasyWebSettingsHandler.normalizeOperationMode(operationModeSelect.value);
  try {
    await chrome.storage.local.set({ [EasyWebSettingsHandler.OPERATION_MODE_KEY]: nextMode });
    renderOperationMode(nextMode);
    setStatus(nextMode === EasyWebSettingsHandler.OPERATION_MODES.ENHANCED
      ? "Modo Aprimorado ativado"
      : "Modo Padrão ativado");
  } catch (error) {
    operationModeSelect.value = operationMode;
    setStatus("Não foi possível alterar o modo de funcionamento", true);
  }
});

for (const control of Object.values(controls)) {
  control.addEventListener("input", () => {
    updateOutputs();
    scheduleSettings();
  });
  control.addEventListener("change", () => {
    window.clearTimeout(settingsTimer);
    queueSettings(readSettings());
  });
}

controls.colorFilterEnabled.addEventListener("input", updateColorFilterVisibility);

mappingSiteConsentToggle.addEventListener("change", async () => {
  try {
    const response = await sendToPage({
      type: "easyweb:set-mapping-consent",
      allowed: mappingSiteConsentToggle.checked
    });
    renderMappingConsent(response.mappingConsent);
    setStatus(response.mappingConsent.siteAllowed
      ? "Site autorizado para snapshots"
      : "Autorização de snapshots removida");
  } catch (error) {
    mappingSiteConsentToggle.checked = false;
    setStatus("Não foi possível atualizar a autorização deste site", true);
  }
});

mappingCaptureButton.addEventListener("click", async () => {
  try {
    mappingCaptureButton.disabled = true;
    const response = await sendToPage({ type: "easyweb:request-mapping-capture" });
    renderMappingDelivery(response.mappingDelivery);
  } catch (error) {
    renderMappingDelivery({ state: "error", message: "Não foi possível solicitar uma nova captura." });
  } finally {
    await refreshMappingStatus();
  }
});

aiSiteEnabledToggle.addEventListener("change", async () => {
  try {
    const response = await sendToPage({
      type: "easyweb:set-ai-site-enabled",
      enabled: aiSiteEnabledToggle.checked
    });
    renderAiAdaptation(response.aiPreferences, response.aiAdaptation, response.aiPlanState, response.apiConnection);
    setStatus(response.aiPreferences?.siteEnabled
      ? "Experiência Adaptativa ativada neste site"
      : "Experiência Adaptativa desativada neste site");
  } catch (error) {
    aiSiteEnabledToggle.checked = !aiSiteEnabledToggle.checked;
    setStatus("Não foi possível atualizar a Experiência Adaptativa", true);
  }
});

document.querySelectorAll("[data-ai-request]").forEach((button) => {
  button.addEventListener("click", () => {
    aiRequestText.value = button.dataset.aiRequest || "";
    aiRequestText.focus();
  });
});

aiRequestSubmit.addEventListener("click", async () => {
  const text = aiRequestText.value.replace(/\s+/g, " ").trim();
  if (!text) {
    aiRequestText.focus();
    setStatus("Descreva o ajuste que você precisa", true);
    return;
  }
  try {
    aiRequestSubmit.disabled = true;
    const response = await sendToPage({
      type: "easyweb:request-personal-ai-adaptation",
      userRequest: { text, intentTags: getPersonalIntentTags(text) }
    });
    renderAiAdaptation(undefined, response.aiAdaptation, response.aiPlanState, response.apiConnection);
    if (!response.accepted) {
      setStatus(response.reason || "Não foi possível enviar seu pedido", true);
      return;
    }
    setStatus("Pedido pessoal enviado para análise");
  } catch (error) {
    setStatus("Não foi possível enviar seu pedido", true);
  } finally {
    refreshMappingStatus();
  }
});

aiRestorePrevious.addEventListener("click", async () => {
  const scope = aiRestorePrevious.dataset.scope;
  if (scope !== "base" && scope !== "personal") {
    return;
  }
  try {
    aiRestorePrevious.disabled = true;
    const response = await sendToPage({
      type: "easyweb:restore-previous-ai-plan",
      scope
    });
    renderAiAdaptation(undefined, response.aiAdaptation, response.aiPlanState);
    setStatus(response.restored
      ? "Adaptação anterior restaurada"
      : "Não existe uma adaptação anterior para restaurar", !response.restored);
  } catch (error) {
    setStatus("Não foi possível restaurar a adaptação anterior", true);
  }
});

document.querySelector("#reset").addEventListener("click", () => {
  window.clearTimeout(settingsTimer);
  settingsQueue = settingsQueue.catch(() => {}).then(resetCurrentSite);
});

restoreGlobalToggle.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({
      [EasyWebSettingsHandler.RESTORE_GLOBAL_PROFILE_KEY]: restoreGlobalToggle.checked
    });
    renderRestoreAction();
  } catch (error) {
    setStatus("Não foi possível salvar a ação de restauração", true);
  }
});

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[EasyWebSettingsHandler.OPERATION_MODE_KEY]) {
    renderOperationMode(changes[EasyWebSettingsHandler.OPERATION_MODE_KEY].newValue);
  }
});

updateOutputs();
Promise.all([
  loadCurrentTab(),
  chrome.storage.local.get(EasyWebSettingsHandler.RESTORE_GLOBAL_PROFILE_KEY)
]).then(([, saved]) => {
  restoreGlobalToggle.checked = saved[EasyWebSettingsHandler.RESTORE_GLOBAL_PROFILE_KEY] !== false;
  renderRestoreAction();
});
const mappingStatusRefresh = window.setInterval(refreshMappingStatus, 1_000);
window.addEventListener("unload", () => window.clearInterval(mappingStatusRefresh));
