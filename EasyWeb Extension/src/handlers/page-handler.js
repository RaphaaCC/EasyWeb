(() => {
  async function send(tabId, message) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response !== undefined) {
        return response;
      }
      throw new Error("Message port closed before a response was received.");
    } catch (error) {
      if (!EasyWebContentInjectionHandler.isRecoverableMessageError(error)) {
        throw error;
      }

      await EasyWebContentInjectionHandler.inject(tabId);
      return chrome.tabs.sendMessage(tabId, message);
    }
  }

  globalThis.EasyWebPageHandler = { send };
})();
