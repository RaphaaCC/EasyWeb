const DEFAULTS = Object.freeze({
  enabled: true,
  fontScale: 1,
  lineHeight: 1.4,
  letterSpacing: 0,
  contrast: false,
  highlightLinks: false
});

const controls = {
  enabled: document.querySelector("#enabled"),
  fontScale: document.querySelector("#font-scale"),
  lineHeight: document.querySelector("#line-height"),
  letterSpacing: document.querySelector("#letter-spacing"),
  contrast: document.querySelector("#contrast"),
  highlightLinks: document.querySelector("#highlight-links")
};

const outputs = {
  fontScale: document.querySelector("#font-scale-value"),
  lineHeight: document.querySelector("#line-height-value"),
  letterSpacing: document.querySelector("#letter-spacing-value")
};

let activeTab;

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
    highlightLinks: controls.highlightLinks.checked
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
  updateOutputs();
}

function updateOutputs() {
  outputs.fontScale.value = `${controls.fontScale.value}%`;
  outputs.lineHeight.value = `${(Number(controls.lineHeight.value) / 100).toFixed(1).replace(".", ",")}x`;
  outputs.letterSpacing.value = `${controls.letterSpacing.value}px`;
}

async function sendSettings(settings) {
  if (!activeTab?.id) {
    setStatus("Não foi possível acessar esta página", true);
    return;
  }

  try {
    await chrome.tabs.sendMessage(activeTab.id, {
      type: "easyweb:apply-state",
      settings
    });
    setStatus("Ajustes aplicados nesta página");
  } catch (error) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: activeTab.id },
        files: ["styles/content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ["src/content.js"]
      });
      await chrome.tabs.sendMessage(activeTab.id, {
        type: "easyweb:apply-state",
        settings
      });
      setStatus("Ajustes aplicados nesta página");
    } catch (injectionError) {
      setStatus("Esta página não permite ajustes", true);
    }
  }
}

async function loadCurrentTab() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    setStatus("Nenhuma página ativa encontrada", true);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "easyweb:get-state"
    });
    renderSettings(response.settings);
  } catch (error) {
    renderSettings(DEFAULTS);
  }
}

for (const control of Object.values(controls)) {
  control.addEventListener("input", () => {
    updateOutputs();
    sendSettings(readSettings());
  });
  control.addEventListener("change", () => sendSettings(readSettings()));
}

document.querySelector("#reset").addEventListener("click", () => {
  renderSettings(DEFAULTS);
  sendSettings(DEFAULTS);
});

updateOutputs();
loadCurrentTab();
