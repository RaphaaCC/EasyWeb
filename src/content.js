(() => {
  const hasExtensionContext = globalThis.chrome?.runtime?.onMessage &&
    globalThis.chrome?.storage?.local;
  const hasHandlers = globalThis.EasyWebSettingsHandler &&
    globalThis.EasyWebAccessibilityHandler &&
    globalThis.EasyWebFastModeHandler &&
    globalThis.EasyWebNotificationHandler;

  if (window.__easyWebController || window.__easyWebInitializing || !hasExtensionContext || !hasHandlers) {
    return;
  }

  window.__easyWebInitializing = true;

  const settingsApi = EasyWebSettingsHandler;
  const settings = settingsApi.create(window.location);
  const accessibility = EasyWebAccessibilityHandler.create(settingsApi);
  const fastMode = EasyWebFastModeHandler.create(window.location);
  const notification = EasyWebNotificationHandler;
  let currentConfig;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const cachedPayload = fastMode.readCachedPayload();
  let cacheInUse = Boolean(cachedPayload && fastMode.hasMatchingFingerprint(cachedPayload));
  if (cacheInUse) {
    cacheInUse = fastMode.applyCachedElementCss(cachedPayload);
    if (cacheInUse) {
      accessibility.applyCachedStyles(cachedPayload.settings);
    } else {
      fastMode.clearCache();
    }
  } else {
    fastMode.removeBootstrapStyles();
    if (cachedPayload) {
      fastMode.clearCache();
    }
  }

  function matchesCachedSettings(settings) {
    return cacheInUse && settings.fastMode &&
      JSON.stringify(settingsApi.normalize(settings)) ===
      JSON.stringify(settingsApi.normalize(cachedPayload.settings));
  }

  function applyConfig(config) {
    currentConfig = config;
    const fastModeStatus = fastMode.getStatus();
    const canReuseCache = matchesCachedSettings(config.settings) && fastModeStatus.state !== "blocked";

    if (cacheInUse && !canReuseCache) {
      fastMode.removeBootstrapStyles();
      accessibility.clearCachedStyles();
      fastMode.clearCache();
      cacheInUse = false;
    }

    const effectiveSettings = {
      ...config.settings,
      fastMode: config.settings.fastMode && (fastModeStatus.eligible || canReuseCache)
    };
    const appliedSettings = accessibility.apply(effectiveSettings);
    accessibility.setFastMode(appliedSettings.fastMode);

    if (appliedSettings.fastMode) {
      fastMode.startSafetyWatch();
    } else {
      fastMode.stopSafetyWatch();
    }

    if (fastModeStatus.state === "eligible" && appliedSettings.fastMode && !cacheInUse) {
      fastMode.cacheCompiledCss(appliedSettings, accessibility.getCachedCss());
    }

    if (fastModeStatus.state === "blocked") {
      fastMode.clearCache();
    }

    return appliedSettings;
  }

  fastMode.onStatusChange((status) => {
    if (!currentConfig) {
      return;
    }

    if (status.eligible && currentConfig.settings.fastMode) {
      applyConfig(currentConfig);
      return;
    }

    if (status.state === "blocked") {
      const needsFallback = cacheInUse || accessibility.getState().fastMode;
      fastMode.clearCache();
      if (cacheInUse) {
        fastMode.removeBootstrapStyles();
        accessibility.clearCachedStyles();
        cacheInUse = false;
      }
      if (needsFallback) {
        applyConfig({
          ...currentConfig,
          settings: { ...currentConfig.settings, fastMode: false }
        });
      }
    }
  });

  async function loadConfig() {
    const config = await settings.load();
    applyConfig(config);
    return config;
  }

  async function initialize() {
    try {
      const config = await loadConfig();
      accessibility.startObserver();

      if (config.settings.enabled && (config.profileId !== "default" || config.hasSiteOverride)) {
        notification.showOnce();
      }
    } catch (error) {
      const fallback = {
        profileId: "default",
        profile: settingsApi.getProfile("default"),
        hasSiteOverride: false,
        settings: settingsApi.DEFAULTS
      };
      applyConfig(fallback);
      accessibility.startObserver();
    } finally {
      resolveReady();
    }
  }

  chrome.storage.onChanged?.addListener(async (changes, areaName) => {
    const siteSettingsChanged = Object.keys(changes).some((key) => settings.isSiteStorageKey(key));

    if (areaName !== "local" || !siteSettingsChanged) {
      return;
    }

    try {
      applyConfig(await settings.load());
    } catch (error) {
      // The current page keeps its last valid configuration if storage is unavailable.
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        await ready;
        if (!message?.type) {
          return;
        }

        if (message.type === "easyweb:get-state") {
          sendResponse({
            settings: accessibility.getState(),
            profileId: currentConfig.profileId,
            profileLabel: currentConfig.profile.label,
            hasSiteOverride: currentConfig.hasSiteOverride,
            universalFilter: currentConfig.universalFilter,
            fastModeStatus: fastMode.getStatus()
          });
          return;
        }

        if (message.type === "easyweb:refresh-config") {
          const config = await settings.load();
          const appliedSettings = applyConfig(config);
          sendResponse({ settings: appliedSettings, fastModeStatus: fastMode.getStatus() });
          return;
        }

        if (message.type === "easyweb:apply-state") {
          const appliedSettings = applyConfig({
            ...currentConfig,
            settings: message.settings
          });
          const savedSettings = await settings.saveSiteOverride(appliedSettings);
          currentConfig = {
            ...currentConfig,
            hasSiteOverride: true,
            settings: savedSettings
          };
          sendResponse({
            settings: savedSettings,
            hasSiteOverride: true,
            universalFilter: currentConfig.universalFilter,
            fastModeStatus: fastMode.getStatus()
          });
          return;
        }

        if (message.type === "easyweb:reset-state") {
          if (message.mode === "global") {
            const config = await settings.resetSiteOverride();
            const appliedSettings = applyConfig(config);
            sendResponse({
              settings: appliedSettings,
              hasSiteOverride: currentConfig.hasSiteOverride,
              universalFilter: currentConfig.universalFilter,
              fastModeStatus: fastMode.getStatus()
            });
            return;
          }

          const originalSettings = await settings.saveSiteOverride({
            ...settingsApi.DEFAULTS,
            enabled: false
          });
          currentConfig = {
            ...currentConfig,
            hasSiteOverride: true,
            settings: originalSettings
          };
          const appliedSettings = applyConfig(currentConfig);
          sendResponse({
            settings: appliedSettings,
            hasSiteOverride: true,
            universalFilter: currentConfig.universalFilter,
            fastModeStatus: fastMode.getStatus()
          });
        }
      } catch (error) {
        sendResponse({ error: "Não foi possível aplicar os ajustes nesta página." });
      }
    })();

    return true;
  });

  window.__easyWebController = {
    applyState: accessibility.apply,
    getState: accessibility.getState
  };

  initialize();
})();
