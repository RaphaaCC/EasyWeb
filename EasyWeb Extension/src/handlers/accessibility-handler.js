(() => {
  function create(settingsApi) {
    const state = { ...settingsApi.DEFAULTS };
    const fontRecords = new Map();
    const colorFilter = EasyWebColorFilterHandler.create();
    const contrast = EasyWebContrastHandler.create(getTextElements);
    const links = EasyWebLinkHandler.create();
    let observer;
    let mutationTimer;
    let appliedFontScale = 1;
    let fastModeActive = false;
    let cachedStylesInUse = false;

    function hasDirectText(element) {
      return Array.from(element.childNodes).some((node) =>
        node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0
      );
    }

    function isVisible(element) {
      const styles = getComputedStyle(element);
      return styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        Number.parseFloat(styles.opacity) !== 0;
    }

    function getTextElements() {
      if (!document.body) {
        return [];
      }

      return [document.body, ...document.body.querySelectorAll("*")].filter((element) => {
        const tag = element.tagName.toLowerCase();
        return hasDirectText(element) &&
          isVisible(element) &&
          !["script", "style", "noscript"].includes(tag) &&
          !element.closest(".easyweb-activation-notice");
      });
    }

    function rememberFontSizes(elements) {
      for (const element of elements) {
        if (fontRecords.has(element)) {
          continue;
        }

        const computedSize = Number.parseFloat(getComputedStyle(element).fontSize);
        if (Number.isFinite(computedSize)) {
          fontRecords.set(element, {
            originalInlineSize: element.style.fontSize,
            baseSize: computedSize / appliedFontScale
          });
        }
      }
    }

    function applyFontScale() {
      rememberFontSizes(getTextElements());

      for (const [element, record] of fontRecords) {
        if (element.isConnected) {
          element.style.fontSize = `${record.baseSize * state.fontScale}px`;
        } else {
          fontRecords.delete(element);
        }
      }

      appliedFontScale = state.fontScale;
    }

    function restoreFontSizes() {
      for (const [element, record] of fontRecords) {
        if (element.isConnected) {
          element.style.fontSize = record.originalInlineSize;
        }
      }
      fontRecords.clear();
      appliedFontScale = 1;
    }

    function refreshDynamicContent() {
      if (fastModeActive || !state.enabled ||
        (state.fontScale === 1 && !state.contrast && !state.highlightLinks)) {
        return;
      }

      if (state.fontScale !== 1) {
        applyFontScale();
      }
      if (state.contrast) {
        contrast.apply(true);
      }
      if (state.highlightLinks) {
        links.apply(true);
      }
    }

    function scheduleRefresh() {
      window.clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(refreshDynamicContent, 120);
    }

    function startObserver() {
      if (!document.body || observer || fastModeActive) {
        return;
      }

      observer = new MutationObserver(scheduleRefresh);
      observer.observe(document.body, { childList: true, subtree: true });
    }

    function stopObserver() {
      observer?.disconnect();
      observer = undefined;
      window.clearTimeout(mutationTimer);
    }

    function setFastMode(active) {
      fastModeActive = Boolean(active);
      if (fastModeActive) {
        stopObserver();
      } else {
        startObserver();
      }
    }

    function applyCachedStyles(settings) {
      const cached = settingsApi.normalize(settings);
      const root = document.documentElement;

      Object.assign(state, cached);
      root.classList.toggle("easyweb-enabled", cached.enabled);
      root.classList.toggle("easyweb-contrast", cached.enabled && cached.contrast);
      root.classList.toggle("easyweb-links", cached.enabled && cached.highlightLinks);
      root.classList.toggle("easyweb-reduce-motion", cached.enabled && cached.reduceMotion);
      root.classList.toggle("easyweb-reading-focus", cached.enabled && cached.readingFocus);
      root.style.setProperty("--easyweb-line-height", cached.lineHeight);
      root.style.setProperty("--easyweb-letter-spacing", `${cached.letterSpacing}px`);
      colorFilter.apply(cached.colorFilter, cached.enabled);
      cachedStylesInUse = true;
    }

    function clearCachedStyles() {
      cachedStylesInUse = false;
      Object.assign(state, settingsApi.DEFAULTS);
      colorFilter.apply("none", false);
      const root = document.documentElement;
      root.classList.remove(
        "easyweb-enabled",
        "easyweb-contrast",
        "easyweb-links",
        "easyweb-reduce-motion",
        "easyweb-reading-focus"
      );
      root.style.removeProperty("--easyweb-line-height");
      root.style.removeProperty("--easyweb-letter-spacing");
    }

    function getCachedCss() {
      const rules = [];
      for (const [element, record] of fontRecords) {
        const selector = EasyWebFastModeHandler.buildSelector(element);
        if (selector?.length) {
          rules.push(`html.easyweb-fast-cache ${selector}{font-size:${record.baseSize * state.fontScale}px!important;}`);
        }
      }

      return EasyWebFastModeHandler.buildCss(state, rules.concat(contrast.getCachedCssRules()));
    }

    function apply(nextSettings) {
      const previous = { ...state };
      Object.assign(state, settingsApi.normalize(nextSettings));
      const root = document.documentElement;

      root.classList.toggle("easyweb-enabled", state.enabled);
      root.classList.toggle("easyweb-contrast", state.enabled && state.contrast);
      root.classList.toggle("easyweb-links", state.enabled && state.highlightLinks);
      root.classList.toggle("easyweb-reduce-motion", state.enabled && state.reduceMotion);
      root.classList.toggle("easyweb-reading-focus", state.enabled && state.readingFocus);
      root.style.setProperty("--easyweb-line-height", state.lineHeight);
      root.style.setProperty("--easyweb-letter-spacing", `${state.letterSpacing}px`);

      const fontChanged = previous.fontScale !== state.fontScale || previous.enabled !== state.enabled;
      if (state.enabled && state.fontScale !== 1 && fontChanged) {
        applyFontScale();
      } else if ((!state.enabled || state.fontScale === 1) && (previous.enabled || previous.fontScale !== 1)) {
        restoreFontSizes();
      }

      if (previous.contrast !== state.contrast || fontChanged) {
        contrast.apply(state.enabled && state.contrast);
      }

      if (previous.highlightLinks !== state.highlightLinks || previous.enabled !== state.enabled) {
        links.apply(state.enabled && state.highlightLinks);
      }

      if (previous.colorFilter !== state.colorFilter || previous.enabled !== state.enabled) {
        colorFilter.apply(state.colorFilter, state.enabled);
      }

      return { ...state };
    }

    return {
      apply,
      applyCachedStyles,
      clearCachedStyles,
      getState: () => ({ ...state }),
      getCachedCss,
      isUsingCachedStyles: () => cachedStylesInUse,
      setFastMode,
      startObserver
    };
  }

  globalThis.EasyWebAccessibilityHandler = { create };
})();
