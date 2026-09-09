const DEFAULTS = Object.freeze({
  enabled: false,
  fontScale: 1,
  lineHeight: 1.4,
  letterSpacing: 0,
  contrast: false,
  highlightLinks: false,
  colorFilter: "none",
  fastMode: false
});

const controls = {
  enabled: document.querySelector("#enabled"),
  fontScale: document.querySelector("#font-scale"),
  lineHeight: document.querySelector("#line-height"),
  letterSpacing: document.querySelector("#letter-spacing"),
  contrast: document.querySelector("#contrast"),
  highlightLinks: document.querySelector("#highlight-links"),
  colorFilterEnabled: document.querySelector("#color-filter-enabled"),
  colorFilterType: document.querySelector("#color-filter-type"),
  fastMode: document.querySelector("#fast-mode")
};

const outputs = {
  fontScale: document.querySelector("#font-scale-value"),
  lineHeight: document.querySelector("#line-height-value"),
  letterSpacing: document.querySelector("#letter-spacing-value")
};

let activeTab;
let settingsQueue = Promise.resolve();
let settingsTimer;
let lastFastModeStatus;
let activeProfileLabel = "Padrão";
let hasSiteOverride = false;
const restoreGlobalToggle = document.querySelector("#restore-global-profile");

function setStatus(message, isError = false) {
  document.querySelector("#status-text").textContent = message;
  document.querySelector("#status-dot").classList.toggle("error", isError);
}

function readSettings() {
  return {
    enabled: controls.enabled.checked,
    fontScale: Number(controls.fontScale.value) / 100,
    lineHeight: Number(controls.lineHeight.value) / 100,
    letterSpacing: Number(controls.letterSpacing.value),
    contrast: controls.contrast.checked,
    highlightLinks: controls.highlightLinks.checked,
    colorFilter: controls.colorFilterEnabled.checked ? controls.colorFilterType.value : "none",
    fastMode: controls.fastMode.checked && !controls.fastMode.disabled
  };
}

function renderSettings(settings) {
  const next = { ...DEFAULTS, ...settings };
  controls.enabled.checked = next.enabled;
  controls.fontScale.value = Math.round(next.fontScale * 100);
  controls.lineHeight.value = Math.round(next.lineHeight * 100);
  controls.letterSpacing.value = next.letterSpacing;
  controls.contrast.checked = next.contrast;
  controls.highlightLinks.checked = next.highlightLinks;
  controls.colorFilterEnabled.checked = next.colorFilter !== "none";
  controls.colorFilterType.value = next.colorFilter === "none" ? "deuteranopia" : next.colorFilter;
  controls.fastMode.checked = next.fastMode;
  updateColorFilterVisibility();
  updateOutputs();
}

function updateColorFilterVisibility() {
  document.querySelector("#color-filter-type-control").hidden = !controls.colorFilterEnabled.checked;
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
    filterScope.textContent = "Aplicar apenas neste site";
  }

  updateColorFilterVisibility();
}

function renderFastModeStatus(status) {
  lastFastModeStatus = status;
  const message = document.querySelector("#fast-mode-status");
  const isEligible = status?.eligible === true && controls.enabled.checked;

  controls.fastMode.disabled = !isEligible;
  if (!isEligible) {
    controls.fastMode.checked = false;
  }

  message.textContent = controls.enabled.checked
    ? status?.reason || "Indisponível nesta página."
    : "Ative os ajustes desta página para usar este modo.";
}

function renderProfile(profileLabel) {
  activeProfileLabel = profileLabel || "Padrão";
  document.querySelector("#profile-name").textContent = `Perfil global: ${activeProfileLabel}`;
  renderSiteScope();
}

function renderSiteScope() {
  const title = document.querySelector("#scope-title");
  const description = document.querySelector("#scope-description");
  if (hasSiteOverride) {
    title.textContent = "Este site tem personalização própria";
    description.textContent = "Os controles abaixo substituem o perfil global apenas neste site.";
  } else {
    title.textContent = "Este site usa o perfil global";
    description.textContent = `Perfil ativo: ${activeProfileLabel}. Os ajustes abaixo valerão apenas neste site.`;
  }
  renderRestoreAction();
}

function renderRestoreAction() {
  document.querySelector("#restore-global-label").textContent =
    `Restaurar usando o perfil global (${activeProfileLabel})`;
  document.querySelector("#reset").textContent = restoreGlobalToggle.checked
    ? "Voltar ao perfil global neste site"
    : "Desativar ajustes neste site";
}

function updateOutputs() {
  outputs.fontScale.value = `${controls.fontScale.value}%`;
  outputs.lineHeight.value = `${(Number(controls.lineHeight.value) / 100).toFixed(1).replace(".", ",")}x`;
  outputs.letterSpacing.value = `${controls.letterSpacing.value}px`;
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
  try {
    const response = await sendToPage({
      type: "easyweb:apply-state",
      settings
    });
    renderFastModeStatus(response.fastModeStatus);
    renderUniversalFilter(response.universalFilter);
    hasSiteOverride = true;
    renderSiteScope();
    setStatus("Ajustes salvos neste site");
  } catch (error) {
    setStatus("Esta página não permite ajustes", true);
  }
}

function queueSettings(settings) {
  settingsQueue = settingsQueue
    .catch(() => {})
    .then(() => sendSettings(settings));
  return settingsQueue;
}

function scheduleSettings() {
  window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => queueSettings(readSettings()), 90);
}

async function resetCurrentSite() {
  try {
    const response = await sendToPage({
      type: "easyweb:reset-state",
      mode: restoreGlobalToggle.checked ? "global" : "original"
    });
    renderSettings(response.settings);
    renderFastModeStatus(response.fastModeStatus);
    hasSiteOverride = Boolean(response.hasSiteOverride);
    renderSiteScope();
    renderUniversalFilter(response.universalFilter);
    setStatus(restoreGlobalToggle.checked
      ? "Perfil global restaurado neste site"
      : "Aparência original restaurada neste site");
  } catch (error) {
    setStatus("Esta página não permite ajustes", true);
  }
}

async function loadCurrentTab() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    setStatus("Nenhuma página ativa encontrada", true);
    return;
  }

  try {
    const response = await sendToPage({ type: "easyweb:get-state" });
    renderSettings(response.settings);
    renderProfile(response.profileLabel);
    hasSiteOverride = Boolean(response.hasSiteOverride);
    renderSiteScope();
    renderUniversalFilter(response.universalFilter);
    renderFastModeStatus(response.fastModeStatus);

    if (response.fastModeStatus?.state === "checking") {
      window.setTimeout(refreshFastModeStatus, 1700);
    }
  } catch (error) {
    renderSettings(DEFAULTS);
    renderProfile("Padrão");
    hasSiteOverride = false;
    renderSiteScope();
    renderUniversalFilter(null);
    renderFastModeStatus({
      eligible: false,
      reason: "Indisponível nesta página."
    });
  }
}

async function refreshFastModeStatus() {
  try {
    const response = await sendToPage({ type: "easyweb:get-state" });
    renderFastModeStatus(response.fastModeStatus);
  } catch (error) {
    renderFastModeStatus({
      eligible: false,
      reason: "Indisponível nesta página."
    });
  }
}

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
controls.enabled.addEventListener("input", () => renderFastModeStatus(lastFastModeStatus));

document.querySelector("#reset").addEventListener("click", () => {
  window.clearTimeout(settingsTimer);
  settingsQueue = settingsQueue
    .catch(() => {})
    .then(resetCurrentSite);
});

restoreGlobalToggle.addEventListener("change", () => {
  chrome.storage.local.set({
    [EasyWebSettingsHandler.RESTORE_GLOBAL_PROFILE_KEY]: restoreGlobalToggle.checked
  });
  renderRestoreAction();
});

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

updateOutputs();
Promise.all([
  loadCurrentTab(),
  chrome.storage.local.get(EasyWebSettingsHandler.RESTORE_GLOBAL_PROFILE_KEY)
]).then(([, saved]) => {
  restoreGlobalToggle.checked = saved[EasyWebSettingsHandler.RESTORE_GLOBAL_PROFILE_KEY] !== false;
  renderRestoreAction();
});
