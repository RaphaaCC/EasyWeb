(() => {
  if (window.__easyWebController) {
    return;
  }

  const DEFAULTS = Object.freeze({
    enabled: true,
    fontScale: 1,
    lineHeight: 1.4,
    letterSpacing: 0,
    contrast: false,
    highlightLinks: false
  });

  const state = { ...DEFAULTS };
  const fontRecords = new Map();
  let observer;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeSettings(settings = {}) {
    return {
      enabled: Boolean(settings.enabled),
      fontScale: clamp(Number(settings.fontScale) || DEFAULTS.fontScale, 0.8, 1.6),
      lineHeight: clamp(Number(settings.lineHeight) || DEFAULTS.lineHeight, 1, 2.2),
      letterSpacing: clamp(Number(settings.letterSpacing) || 0, 0, 3),
      contrast: Boolean(settings.contrast),
      highlightLinks: Boolean(settings.highlightLinks)
    };
  }

  function hasDirectText(element) {
    return Array.from(element.childNodes).some((node) =>
      node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0
    );
  }

  function getTextElements() {
    if (!document.body) {
      return [];
    }

    return [document.body, ...document.body.querySelectorAll("*")].filter((element) => {
      const tag = element.tagName.toLowerCase();
      return hasDirectText(element) && !["script", "style", "noscript"].includes(tag);
    });
  }

  function rememberFontSizes(elements) {
    const newRecords = [];

    for (const element of elements) {
      if (fontRecords.has(element)) {
        continue;
      }

      const computedSize = Number.parseFloat(getComputedStyle(element).fontSize);
      if (!Number.isFinite(computedSize)) {
        continue;
      }

      const record = {
        originalInlineSize: element.style.fontSize,
        baseSize: computedSize / (state.fontScale || 1)
      };
      fontRecords.set(element, record);
      newRecords.push([element, record]);
    }

    return newRecords;
  }

  function applyFontScale() {
    const records = rememberFontSizes(getTextElements());

    for (const [element, record] of records) {
      element.style.fontSize = `${record.baseSize * state.fontScale}px`;
    }

    for (const [element, record] of fontRecords) {
      if (element.isConnected) {
        element.style.fontSize = `${record.baseSize * state.fontScale}px`;
      } else {
        fontRecords.delete(element);
      }
    }
  }

  function restoreFontSizes() {
    for (const [element, record] of fontRecords) {
      if (element.isConnected) {
        element.style.fontSize = record.originalInlineSize;
      }
    }
    fontRecords.clear();
  }

  function applyState(nextSettings) {
    Object.assign(state, normalizeSettings(nextSettings));
    const root = document.documentElement;

    root.classList.toggle("easyweb-enabled", state.enabled);
    root.classList.toggle("easyweb-contrast", state.enabled && state.contrast);
    root.classList.toggle("easyweb-links", state.enabled && state.highlightLinks);
    root.style.setProperty("--easyweb-line-height", state.lineHeight);
    root.style.setProperty("--easyweb-letter-spacing", `${state.letterSpacing}px`);

    if (state.enabled) {
      applyFontScale();
    } else {
      restoreFontSizes();
    }
  }

  function startObserver() {
    if (!document.body || observer) {
      return;
    }

    observer = new MutationObserver(() => {
      if (state.enabled && state.fontScale !== 1) {
        applyFontScale();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "easyweb:get-state") {
      sendResponse({ settings: { ...state } });
    }

    if (message.type === "easyweb:apply-state") {
      applyState(message.settings);
      sendResponse({ settings: { ...state } });
    }

    return false;
  });

  window.__easyWebController = { applyState };
  applyState(state);
  startObserver();
})();
