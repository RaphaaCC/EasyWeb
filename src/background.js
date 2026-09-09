async function refreshTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "easyweb:refresh-config" });
  } catch (error) {
    // A pagina ainda nao tem o content script; ele sera carregado na proxima navegacao.
  }
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((tab) => tab.id).map((tab) => refreshTab(tab.id)));
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" ||
    (!changes["easyweb:active-profile"] && !changes["easyweb:daltonic-filter"])) {
    return;
  }

  refreshAllTabs().catch(() => {
    // A proxima navegacao recarrega o content script quando uma aba nao puder ser atualizada agora.
  });
});
