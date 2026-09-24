(() => {
  const CONTENT_VERSION = 6;
  const CONTENT_FILES = Object.freeze([
    "src/handlers/settings-handler.js",
    "src/handlers/color-filter-handler.js",
    "src/handlers/fast-mode-handler.js",
    "src/handlers/contrast-handler.js",
    "src/handlers/link-handler.js",
    "src/handlers/mapping-security-handler.js",
    "src/handlers/ai-adaptation-handler.js",
    "src/handlers/accessibility-handler.js",
    "src/handlers/notification-handler.js",
    "src/content.js"
  ]);

  function isRecoverableMessageError(error) {
    return /receiving end does not exist|could not establish connection|message port closed before a response|extension context invalidated/i
      .test(error?.message || "");
  }

  async function inject(tabId) {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["styles/content.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (version) => {
        if (globalThis.__easyWebController?.version !== version) {
          delete globalThis.__easyWebController;
        }
        delete globalThis.__easyWebInitializing;
      },
      args: [CONTENT_VERSION]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_FILES
    });
  }

  globalThis.EasyWebContentInjectionHandler = Object.freeze({
    CONTENT_VERSION,
    inject,
    isRecoverableMessageError
  });
})();
