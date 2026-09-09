const settingsApi = EasyWebSettingsHandler;
const profileGrid = document.querySelector("#profile-grid");
const filterToggle = document.querySelector("#daltonic-filter-enabled");
const filterSelect = document.querySelector("#daltonic-filter");
const filterControl = document.querySelector("#daltonic-filter-control");
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
      settingsApi.DALTONIC_FILTER_KEY
    ]);
    const activeProfile = settingsApi.getProfile(saved[settingsApi.ACTIVE_PROFILE_KEY]);
    renderProfiles(activeProfile.id);
    const universalFilter = settingsApi.getUniversalFilter(saved[settingsApi.DALTONIC_FILTER_KEY]);
    filterToggle.checked = Boolean(universalFilter);
    filterSelect.value = universalFilter || "deuteranopia";
    updateFilterVisibility();
  } catch (error) {
    setStatus("Não foi possível carregar as configurações.");
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

filterToggle.addEventListener("change", () => {
  updateFilterVisibility();
  saveUniversalFilter();
});

filterSelect.addEventListener("change", saveUniversalFilter);

loadSettings();
