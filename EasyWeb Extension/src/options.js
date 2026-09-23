const settingsApi = EasyWebSettingsHandler;
const profileGrid = document.querySelector("#profile-grid");
const filterToggle = document.querySelector("#daltonic-filter-enabled");
const filterSelect = document.querySelector("#daltonic-filter");
const filterControl = document.querySelector("#daltonic-filter-control");
const developerModeToggle = document.querySelector("#developer-mode");
const apiBaseUrl = document.querySelector("#api-base-url");
const apiBaseUrlControl = document.querySelector("#api-base-url-control");
const apiStatus = document.querySelector("#api-status");
const apiConnectionStatus = document.querySelector("#api-connection-status");
const mappingConsentToggle = document.querySelector("#mapping-consent-enabled");
const aiRecommendationsToggle = document.querySelector("#ai-recommendations-enabled");
const operationModeInputs = [...document.querySelectorAll("input[name=operation-mode]")];
const operationModeStatus = document.querySelector("#operation-mode-status");
const apiSection = document.querySelector(".api-section");
const mappingSection = document.querySelector(".mapping-section");
const aiSection = document.querySelector(".ai-section");
const status = document.querySelector("#save-status");

function setStatus(message) {
  status.textContent = message;
  window.clearTimeout(setStatus.timer);
  setStatus.timer = window.setTimeout(() => {
    status.textContent = "";
  }, 2200);
}

function updateFilterVisibility() {
  filterControl.hidden = !filterToggle.checked;
}

function updateApiVisibility() {
  apiBaseUrlControl.hidden = !developerModeToggle.checked;
}

function renderApiConfiguration(configuration) {
  developerModeToggle.checked = configuration.developerMode;
  apiBaseUrl.value = configuration.baseUrl;
  apiStatus.textContent = configuration.developerMode
    ? `Modo Desenvolvedor ativo. API atual: ${configuration.baseUrl}`
    : `API de produção ativa: ${settingsApi.API_BASE_URL}`;
  updateApiVisibility();
}

async function refreshApiConnectionStatus() {
  try {
    const connection = await chrome.runtime.sendMessage({ type: "easyweb:get-api-connection-status" });
    apiConnectionStatus.textContent = connection?.reason || "Status da conexão indisponível.";
  } catch (error) {
    apiConnectionStatus.textContent = "Não foi possível consultar o status da conexão.";
  }
}

function renderMappingConsent(globalEnabled) {
  mappingConsentToggle.checked = globalEnabled;
}

function renderAiRecommendations(enabled) {
  aiRecommendationsToggle.checked = enabled === true;
}

function renderOperationMode(mode) {
  const normalizedMode = settingsApi.normalizeOperationMode(mode);
  const enhanced = normalizedMode === settingsApi.OPERATION_MODES.ENHANCED;
  operationModeInputs.forEach((input) => {
    input.checked = input.value === normalizedMode;
  });
  apiSection.hidden = !enhanced;
  mappingSection.hidden = !enhanced;
  aiSection.hidden = !enhanced;
  operationModeStatus.textContent = enhanced
    ? "Modo Aprimorado ativo: a API poderá receber snapshots após os consentimentos necessários."
    : "Modo Padrão ativo: a acessibilidade é aplicada somente pelo algoritmo local do EasyWeb.";
}

function renderProfiles(activeProfileId) {
  profileGrid.replaceChildren();

  for (const profile of Object.values(settingsApi.PROFILES)) {
    const label = document.createElement("label");
    label.className = `profile-card${profile.id === activeProfileId ? " selected" : ""}`;

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "active-profile";
    input.value = profile.id;
    input.checked = profile.id === activeProfileId;
    input.addEventListener("change", () => selectProfile(profile.id));

    const title = document.createElement("strong");
    title.textContent = profile.label;
    const description = document.createElement("small");
    description.textContent = profile.description;

    const meta = document.createElement("div");
    meta.className = "profile-meta";

    const scale = document.createElement("span");
    scale.className = "meta-pill";
    scale.textContent = `Texto ${Math.round(profile.settings.fontScale * 100)}%`;
    meta.appendChild(scale);

    const spacing = document.createElement("span");
    spacing.className = "meta-pill";
    spacing.textContent = `Linhas ${profile.settings.lineHeight.toFixed(1).replace(".", ",")}x`;
    meta.appendChild(spacing);

    if (profile.settings.contrast) {
      const contrast = document.createElement("span");
      contrast.className = "meta-pill";
      contrast.textContent = "Contraste";
      meta.appendChild(contrast);
    }

    if (profile.settings.reduceMotion) {
      const motion = document.createElement("span");
      motion.className = "meta-pill";
      motion.textContent = "Menos movimento";
      meta.appendChild(motion);
    }

    if (profile.settings.readingFocus) {
      const reading = document.createElement("span");
      reading.className = "meta-pill";
      reading.textContent = "Leitura focada";
      meta.appendChild(reading);
    }

    label.append(input, title, description, meta);
    profileGrid.appendChild(label);
  }
}

async function selectProfile(profileId) {
  try {
    await chrome.storage.local.set({ [settingsApi.ACTIVE_PROFILE_KEY]: profileId });
    renderProfiles(profileId);
    setStatus(`Perfil ${settingsApi.getProfile(profileId).label} aplicado`);
  } catch (error) {
    setStatus("Não foi possível salvar o perfil.");
  }
}

async function loadSettings() {
  try {
    const saved = await chrome.storage.local.get([
      settingsApi.ACTIVE_PROFILE_KEY,
      settingsApi.DALTONIC_FILTER_KEY,
      settingsApi.DEVELOPER_MODE_KEY,
      settingsApi.API_BASE_URL_KEY,
      settingsApi.MAPPING_CONSENT_ENABLED_KEY,
      settingsApi.AI_RECOMMENDATIONS_ENABLED_KEY,
      settingsApi.OPERATION_MODE_KEY
    ]);
    const activeProfile = settingsApi.getProfile(saved[settingsApi.ACTIVE_PROFILE_KEY]);
    renderProfiles(activeProfile.id);
    const universalFilter = settingsApi.getUniversalFilter(saved[settingsApi.DALTONIC_FILTER_KEY]);
    filterToggle.checked = Boolean(universalFilter);
    filterSelect.value = universalFilter || "deuteranopia";
    updateFilterVisibility();
    renderApiConfiguration(settingsApi.getApiConfiguration(saved));
    renderMappingConsent(Boolean(saved[settingsApi.MAPPING_CONSENT_ENABLED_KEY]));
    renderAiRecommendations(Boolean(saved[settingsApi.AI_RECOMMENDATIONS_ENABLED_KEY]));
    renderOperationMode(saved[settingsApi.OPERATION_MODE_KEY]);
  } catch (error) {
    setStatus("Não foi possível carregar as configurações.");
  }
}

async function saveMappingConsent() {
  try {
    if (mappingConsentToggle.checked) {
      await chrome.storage.local.set({ [settingsApi.MAPPING_CONSENT_ENABLED_KEY]: true });
      setStatus("Consentimento para snapshots liberado");
      return;
    }

    const saved = await chrome.storage.local.get(null);
    const mappingKeys = Object.keys(saved).filter((key) =>
      key.startsWith(settingsApi.MAPPING_SITE_CONSENT_PREFIX) ||
      key.startsWith(settingsApi.MAPPING_TEMPLATE_CACHE_PREFIX) ||
      key.startsWith(settingsApi.MAPPING_CONFIRMED_TEMPLATE_PREFIX)
    );
    await chrome.storage.local.remove([
      settingsApi.MAPPING_CONSENT_ENABLED_KEY,
      ...mappingKeys
    ]);
    setStatus("Snapshots desativados e consentimentos por site removidos");
  } catch (error) {
    setStatus("Não foi possível salvar o consentimento para snapshots.");
  }
}

async function saveAiRecommendations() {
  try {
    if (aiRecommendationsToggle.checked) {
      await chrome.storage.local.set({ [settingsApi.AI_RECOMMENDATIONS_ENABLED_KEY]: true });
      setStatus("Recomendações de IA ativadas");
      return;
    }
    await chrome.storage.local.remove(settingsApi.AI_RECOMMENDATIONS_ENABLED_KEY);
    setStatus("Recomendações de IA desativadas");
  } catch (error) {
    setStatus("Não foi possível atualizar as recomendações de IA.");
  }
}

async function saveApiConfiguration() {
  const developerMode = developerModeToggle.checked;
  const baseUrl = settingsApi.normalizeApiBaseUrl(apiBaseUrl.value);

  if (developerMode && !baseUrl) {
    apiStatus.textContent = "Informe uma URL HTTPS válida ou um endereço local como localhost:3001.";
    apiBaseUrl.focus();
    return;
  }

  try {
    if (developerMode) {
      await chrome.storage.local.set({
        [settingsApi.DEVELOPER_MODE_KEY]: true,
        [settingsApi.API_BASE_URL_KEY]: baseUrl
      });
      renderApiConfiguration({ developerMode: true, baseUrl });
      setStatus("URL de desenvolvimento atualizada");
      window.setTimeout(refreshApiConnectionStatus, 300);
      return;
    }

    await chrome.storage.local.remove([
      settingsApi.DEVELOPER_MODE_KEY,
      settingsApi.API_BASE_URL_KEY
    ]);
    renderApiConfiguration({ developerMode: false, baseUrl: settingsApi.API_BASE_URL });
    setStatus("API de produção restaurada");
    window.setTimeout(refreshApiConnectionStatus, 300);
  } catch (error) {
    apiStatus.textContent = "Não foi possível salvar a configuração da API.";
  }
}

async function saveUniversalFilter() {
  try {
    if (filterToggle.checked) {
      await chrome.storage.local.set({
        [settingsApi.DALTONIC_FILTER_KEY]: { enabled: true, type: filterSelect.value }
      });
    } else {
      await chrome.storage.local.remove(settingsApi.DALTONIC_FILTER_KEY);
    }
    setStatus("Filtro universal atualizado");
  } catch (error) {
    setStatus("Não foi possível salvar o filtro.");
  }
}

async function saveOperationMode(mode) {
  const normalizedMode = settingsApi.normalizeOperationMode(mode);
  try {
    await chrome.storage.local.set({ [settingsApi.OPERATION_MODE_KEY]: normalizedMode });
    renderOperationMode(normalizedMode);
    setStatus(normalizedMode === settingsApi.OPERATION_MODES.ENHANCED
      ? "Modo Aprimorado ativado"
      : "Modo Padrão ativado");
    window.setTimeout(refreshApiConnectionStatus, 300);
  } catch (error) {
    setStatus("Não foi possível salvar o modo de funcionamento.");
  }
}

filterToggle.addEventListener("change", () => {
  updateFilterVisibility();
  saveUniversalFilter();
});

filterSelect.addEventListener("change", saveUniversalFilter);

developerModeToggle.addEventListener("change", () => {
  updateApiVisibility();
  saveApiConfiguration();
});

apiBaseUrl.addEventListener("change", saveApiConfiguration);

mappingConsentToggle.addEventListener("change", saveMappingConsent);
aiRecommendationsToggle.addEventListener("change", saveAiRecommendations);

operationModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) {
      saveOperationMode(input.value);
    }
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[settingsApi.OPERATION_MODE_KEY]) {
    renderOperationMode(changes[settingsApi.OPERATION_MODE_KEY].newValue);
  }
});

loadSettings();
refreshApiConnectionStatus();
const apiConnectionRefresh = window.setInterval(refreshApiConnectionStatus, 2_000);
window.addEventListener("unload", () => window.clearInterval(apiConnectionRefresh));
