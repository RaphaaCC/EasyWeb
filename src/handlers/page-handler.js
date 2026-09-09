(() => {
  async function send(tabId, message) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["styles/content.css"]
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: [
          "src/handlers/settings-handler.js",
          "src/handlers/color-filter-handler.js",
          "src/handlers/fast-mode-handler.js",
          "src/handlers/contrast-handler.js",
          "src/handlers/link-handler.js",
          "src/handlers/accessibility-handler.js",
          "src/handlers/notification-handler.js",
          "src/content.js"
        ]
      });
      return chrome.tabs.sendMessage(tabId, message);
    }
  }

  globalThis.EasyWebPageHandler = { send };
})();
