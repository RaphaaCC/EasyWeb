(() => {
  const CONTENT_VERSION = 5;
  const hasExtensionContext = globalThis.chrome?.runtime?.onMessage &&
    globalThis.chrome?.storage?.local;
  const hasHandlers = globalThis.EasyWebSettingsHandler &&
    globalThis.EasyWebAccessibilityHandler &&
    globalThis.EasyWebFastModeHandler &&
    globalThis.EasyWebMappingSecurityHandler &&
    globalThis.EasyWebAiAdaptationHandler &&
    globalThis.EasyWebNotificationHandler;

  if (window.__easyWebController?.version === CONTENT_VERSION || window.__easyWebInitializing || !hasExtensionContext || !hasHandlers) {
    return;
  }

  window.__easyWebInitializing = true;

  const settingsApi = EasyWebSettingsHandler;
  const settings = settingsApi.create(window.location);
  const accessibility = EasyWebAccessibilityHandler.create(settingsApi);
  const fastMode = EasyWebFastModeHandler.create(window.location);
  const aiAdaptation = EasyWebAiAdaptationHandler;
  const notification = EasyWebNotificationHandler;
  const MAPPING_CAPTURE_DEBOUNCE_MS = 3_000;
  const MAPPING_RECHECK_INTERVAL_MS = 60_000;
  const MAPPING_CONFIRMATION_REFRESH_MS = 10 * 60_000;
  const AI_LOOKUP_COOLDOWN_MS = 20_000;
  let currentConfig;
  let mappingObserver;
  let mappingCaptureTimer;
  let mappingRecheckTimer;
  let lastMappingPayload;
  let lastMappingConfirmedAt = 0;
  const pendingMappingPayloads = new Map();
  let mappingCaptureInFlight = false;
  let mappingDeliveryStatus = {
    state: "idle",
    message: "Aguardando autorização para o mapeamento."
  };
  let aiAdaptationStatus = {
    state: "disabled",
    message: "A Experiência Adaptativa está desativada para este site."
  };
  let activeAiPreferences = {
    canRequest: false,
    canApplyAutomatic: false
  };
  let lastAiLookupOrigin;
  let lastAiLookupAt = 0;
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

  async function getMappingConsent() {
    const consent = await settings.loadMappingConsent();
    const safety = EasyWebMappingSecurityHandler.assess(document, window.location);
    return {
      ...consent,
      ...safety,
      canMap: consent.extensionEnabled &&
        consent.operationMode === settingsApi.OPERATION_MODES.ENHANCED &&
        consent.globalEnabled && consent.siteAllowed && safety.safeToMap,
      policyVersion: EasyWebMappingSecurityHandler.MAPPING_CAPTURE_POLICY.version
    };
  }

  function stopProtectedMapping() {
    mappingObserver?.disconnect();
    mappingObserver = undefined;
    clearTimeout(mappingCaptureTimer);
    clearInterval(mappingRecheckTimer);
    window.removeEventListener("popstate", scheduleProtectedSnapshot);
    window.removeEventListener("hashchange", scheduleProtectedSnapshot);
    mappingCaptureTimer = undefined;
    mappingRecheckTimer = undefined;
    lastMappingPayload = undefined;
    lastMappingConfirmedAt = 0;
    pendingMappingPayloads.clear();
  }

  function setMappingDeliveryStatus(status) {
    mappingDeliveryStatus = { ...mappingDeliveryStatus, ...status };
  }

  async function captureProtectedSnapshot(force = false) {
    if (mappingCaptureInFlight) {
      return;
    }

    mappingCaptureInFlight = true;
    try {
      const consent = await getMappingConsent();
      if (!consent.canMap) {
        stopProtectedMapping();
        return;
      }

      setMappingDeliveryStatus({ state: "preparing", message: "Preparando a estrutura protegida desta página." });
      const snapshot = EasyWebMappingSecurityHandler.createSnapshot(document, window.location);
      if (!snapshot) {
        setMappingDeliveryStatus({ state: "blocked", message: "A página foi bloqueada pelas regras de segurança." });
        return;
      }
      snapshot.templateFingerprint = await createTemplateFingerprint(snapshot);
      const serializedSnapshot = JSON.stringify(snapshot);
      const isRecentConfirmation = Date.now() - lastMappingConfirmedAt < MAPPING_CONFIRMATION_REFRESH_MS;
      const isAlreadyPending = [...pendingMappingPayloads.values()].includes(serializedSnapshot);
      if ((!force && ((serializedSnapshot === lastMappingPayload && isRecentConfirmation) || isAlreadyPending)) ||
        new TextEncoder().encode(serializedSnapshot).byteLength > 512 * 1024) {
        setMappingDeliveryStatus({ state: "skipped", message: "A estrutura não mudou desde a última confirmação." });
        return;
      }
      const captureId = crypto.randomUUID();

      const result = await chrome.runtime.sendMessage({
        type: "easyweb:mapping:snapshot",
        snapshot,
        force,
        captureId
      });
      if (!result?.accepted) {
        setMappingDeliveryStatus({ state: "rejected", message: result?.reason || "O snapshot foi recusado antes do envio." });
        return;
      }
      if (result.state === "checking-adaptation") {
        lastMappingPayload = serializedSnapshot;
        const confirmedAt = Number(result.confirmedAt);
        lastMappingConfirmedAt = Number.isFinite(confirmedAt) && confirmedAt > 0 && confirmedAt <= Date.now()
          ? confirmedAt
          : Date.now();
      } else {
        pendingMappingPayloads.set(captureId, serializedSnapshot);
      }
      setMappingDeliveryStatus({ state: result.state || "queued", message: result.message || "Snapshot na fila de envio." });
    } catch (error) {
      setMappingDeliveryStatus({ state: "error", message: "Não foi possível preparar ou enviar o snapshot." });
    } finally {
      mappingCaptureInFlight = false;
    }
  }

  function createAssetDescriptor(snapshot) {
    const styles = snapshot.styles;
    const scripts = snapshot.scripts;
    return {
      styles: {
        styleSheetCount: styles.styleSheetCount,
        inlineStyleCount: styles.inlineStyleCount,
        externalStyleSheetCount: styles.externalStyleSheetCount,
        externalOrigins: [...styles.externalOrigins].sort(),
        colors: [...styles.colors].sort(),
        fontFamilies: [...styles.fontFamilies].sort(),
        fontSizes: [...styles.fontSizes].sort(),
        lineHeights: [...styles.lineHeights].sort()
      },
      scripts: {
        total: scripts.total,
        inlineCount: scripts.inlineCount,
        externalCount: scripts.externalCount,
        moduleCount: scripts.moduleCount,
        asyncCount: scripts.asyncCount,
        deferCount: scripts.deferCount,
        externalOrigins: [...scripts.externalOrigins].sort()
      }
    };
  }

  async function createTemplateFingerprint(snapshot) {
    const descriptor = JSON.stringify({
      css: snapshot.css,
      assets: createAssetDescriptor(snapshot)
    });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(descriptor));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function scheduleProtectedSnapshot() {
    clearTimeout(mappingCaptureTimer);
    mappingCaptureTimer = setTimeout(captureProtectedSnapshot, MAPPING_CAPTURE_DEBOUNCE_MS);
  }

  async function updateProtectedMapping() {
    const consent = await getMappingConsent();
    if (!consent.canMap) {
      setMappingDeliveryStatus({
        state: "awaiting-consent",
        message: consent.extensionEnabled === false
          ? "O EasyWeb está desativado."
          : consent.operationMode !== settingsApi.OPERATION_MODES.ENHANCED
            ? "O modo Padrão está ativo; snapshots não são usados."
          : consent.reason || "Aguardando autorização para este site."
      });
      stopProtectedMapping();
      return;
    }

    if (!mappingObserver) {
      mappingObserver = new MutationObserver(scheduleProtectedSnapshot);
      mappingObserver.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener("popstate", scheduleProtectedSnapshot);
      window.addEventListener("hashchange", scheduleProtectedSnapshot);
      mappingRecheckTimer = setInterval(scheduleProtectedSnapshot, MAPPING_RECHECK_INTERVAL_MS);
    }
    scheduleProtectedSnapshot();
  }

  function setAiAdaptationStatus(status) {
    const currentPersonalRequestId = aiAdaptationStatus.personalRequestId;
    const currentPersonalRequestPending = aiAdaptationStatus.scope === "personal" &&
      ["queued", "analyzing-personal", "processing"].includes(aiAdaptationStatus.state);
    if (status?.scope === "base" && currentPersonalRequestPending) {
      return false;
    }
    if (status?.scope === "personal" && currentPersonalRequestId &&
      status.requestId && status.requestId !== currentPersonalRequestId) {
      return false;
    }
    aiAdaptationStatus = { ...aiAdaptationStatus, ...status };
    return true;
  }

  async function getApiConnectionStatus() {
    try {
      return await chrome.runtime.sendMessage({ type: "easyweb:get-api-connection-status" });
    } catch (error) {
      return {
        state: "unavailable",
        reason: "Não foi possível consultar a conexão com a API."
      };
    }
  }

  async function requestAvailableAiPlan(preferences) {
    if (!preferences?.canApplyAutomatic) {
      return null;
    }

    const origin = window.location.origin;
    const now = Date.now();
    if (lastAiLookupOrigin === origin && now - lastAiLookupAt < AI_LOOKUP_COOLDOWN_MS) {
      return null;
    }

    lastAiLookupOrigin = origin;
    lastAiLookupAt = now;
    try {
      return await chrome.runtime.sendMessage({ type: "easyweb:adaptation:lookup", origin });
    } catch (error) {
      return null;
    }
  }

  async function applyAiAdaptation(config = currentConfig) {
    if (!config) {
      return aiAdaptationStatus;
    }
    const preferences = await settings.loadAiPreferences(config.profileId);
    activeAiPreferences = preferences;
    if (!preferences.canRequest) {
      aiAdaptation.clear();
      setAiAdaptationStatus({
        state: preferences.operationMode !== settingsApi.OPERATION_MODES.ENHANCED ? "standard-mode" : "disabled",
        message: preferences.operationMode !== settingsApi.OPERATION_MODES.ENHANCED
          ? "A IA está disponível apenas no modo Aprimorado."
          : !preferences.globalEnabled
            ? "Ative a Experiência Adaptativa em Mais configurações."
            : !preferences.siteEnabled
              ? "Ative a Experiência Adaptativa para este site."
              : "Ative o EasyWeb para usar a Experiência Adaptativa."
      });
      return aiAdaptationStatus;
    }

    const plans = await settings.loadAiPlans(config.profileId);
    const appliedScopes = [];
    const cachedScopes = [];
    aiAdaptation.clear();
    for (const entry of [preferences.canApplyAutomatic ? plans.base : null, plans.personal]) {
      const plan = entry?.plan;
      if (!plan) {
        continue;
      }
      const cached = await settings.loadAiCompiledPlan(plan.planId);
      const result = cached ? aiAdaptation.applyCached(plan, cached) : aiAdaptation.apply(plan);
      const applied = result.applied ? result : aiAdaptation.apply(plan);
      if (applied.applied) {
        appliedScopes.push(plan.planScope);
        if (cached && result.applied) {
          cachedScopes.push(plan.planScope);
        }
        if (!cached || !result.applied) {
          await settings.saveAiCompiledPlan(plan.planId, applied.compiled);
        }
        await settings.recordAiPlanApplication(plan, {
          source: cached && result.applied ? "cache" : "compiled"
        }, config.profileId);
      }
    }

    const hasValidBasePlan = Boolean(plans.base?.plan && aiAdaptation.hasActionablePlan(plans.base.plan));
    const lookup = !hasValidBasePlan ? await requestAvailableAiPlan(preferences) : null;

    if (appliedScopes.length) {
      setAiAdaptationStatus({
        state: cachedScopes.length === appliedScopes.length ? "active-from-cache" : "active",
        message: cachedScopes.length === appliedScopes.length
          ? "Adaptação de IA reaplicada do cache local nesta aba."
          : appliedScopes.includes("personal")
            ? "Adaptação de IA e seus ajustes pessoais estão ativos nesta aba."
            : "Adaptação de IA ativa para esta estrutura de página."
      });
    } else if (lookup?.accepted) {
      setAiAdaptationStatus({
        state: lookup.state || "checking-adaptation",
        message: lookup.message || "Consultando uma adaptacao compativel para este site."
      });
    } else {
      setAiAdaptationStatus({
        state: preferences.canApplyAutomatic ? "awaiting-plan" : "automatic-disabled",
        message: preferences.canApplyAutomatic
          ? "Aguardando um plano de adaptação compatível para este site."
          : "Nenhuma adaptação automática será aplicada. Você pode pedir um ajuste pessoal abaixo."
      });
    }
    return aiAdaptationStatus;
  }

  async function safelyApplyAiAdaptation(config = currentConfig) {
    try {
      return await applyAiAdaptation(config);
    } catch (error) {
      try {
        aiAdaptation.clear();
      } catch (clearError) {
        // A camada local de acessibilidade permanece independente da IA.
      }
      setAiAdaptationStatus({
        state: "model-temporarily-unavailable",
        message: "A Experiência Adaptativa falhou nesta página. Os ajustes padrão do EasyWeb continuam ativos."
      });
      return aiAdaptationStatus;
    }
  }

  async function safelyUpdateProtectedMapping() {
    try {
      return await updateProtectedMapping();
    } catch (error) {
      setMappingDeliveryStatus({
        state: "error",
        message: "Não foi possível atualizar o snapshot. Os ajustes padrão do EasyWeb continuam ativos."
      });
      return mappingDeliveryStatus;
    }
  }

  async function applyIncomingAiPlan(plan, { profileId, requestId } = {}) {
    if (!currentConfig) {
      return { applied: false, reason: "not-active-for-current-tab" };
    }
    const preferences = await settings.loadAiPreferences(currentConfig.profileId);
    activeAiPreferences = preferences;
    if (!preferences.canRequest ||
      (plan?.planScope === "base" && !preferences.canApplyAutomatic) ||
      (plan?.planScope === "personal" && (
        (profileId && profileId !== currentConfig.profileId) ||
        (plan.profile && plan.profile !== currentConfig.profileId)
      ))) {
      return { applied: false, reason: "not-active-for-current-tab" };
    }
    let result;
    try {
      result = aiAdaptation.apply(plan);
    } catch (error) {
      setAiAdaptationStatus({
        state: "model-temporarily-unavailable",
        message: "A adaptação recebida não pôde ser aplicada. Os ajustes padrão continuam ativos."
      });
      return { applied: false, reason: "plan-application-failed" };
    }
    if (!result.applied) {
      if (result.reason === "empty-plan") {
        setAiAdaptationStatus({
          state: "no-compatible-adjustment",
          message: "A IA não encontrou um ajuste seguro e perceptível para aplicar nesta página."
        });
      }
      return result;
    }
    setAiAdaptationStatus({
      state: "active",
      scope: plan.planScope === "personal" ? "personal" : "base",
      requestId: plan.planScope === "personal" ? requestId || null : undefined,
      personalRequestId: plan.planScope === "personal" ? null : undefined,
      message: plan.planScope === "personal"
        ? "Seu ajuste pessoal de IA foi aplicado nesta página."
        : "A adaptação de IA foi aplicada nesta estrutura de página."
    });
    settings.saveAiCompiledPlan(plan.planId, result.compiled).catch(() => {
      // The active stylesheet remains valid even if its cache cannot be persisted.
    });
    return result;
  }

  async function restorePreviousAiPlan(scope) {
    const history = await settings.loadAiPlanHistory(currentConfig.profileId);
    const candidate = history[scope]?.[0]?.plan;
    if (!candidate || !aiAdaptation.validatePlan(candidate)) {
      return { restored: false, reason: "invalid-previous-plan" };
    }
    const restored = await settings.restorePreviousAiPlan(scope, currentConfig.profileId);
    if (!restored.restored || !restored.plan) {
      return restored;
    }
    let result;
    try {
      result = aiAdaptation.apply(restored.plan);
    } catch (error) {
      return { restored: false, reason: "invalid-previous-plan" };
    }
    if (!result.applied) {
      return { restored: false, reason: "invalid-previous-plan" };
    }
    await settings.saveAiCompiledPlan(restored.plan.planId, result.compiled);
    await settings.recordAiPlanApplication(restored.plan, { source: "rollback" }, currentConfig.profileId);
    setAiAdaptationStatus({
      state: "restored-previous",
      message: "A adaptação anterior foi restaurada nesta aba."
    });
    return { ...restored, applied: true };
  }

  async function requestPersonalAiAdaptation(userRequest) {
    const preferences = await settings.loadAiPreferences(currentConfig.profileId);
    if (!preferences.canRequest) {
      return { accepted: false, reason: "Ative a Experiência Adaptativa em Mais configurações e use o modo Aprimorado." };
    }
    const consent = await getMappingConsent();
    if (!consent.canMap) {
      return {
        accepted: false,
        reason: consent.globalEnabled
          ? "Autorize o snapshot deste site antes de pedir um ajuste pessoal."
          : "Ative a autorização global de snapshots em Mais configurações."
      };
    }
    const plans = await settings.loadAiPlans(currentConfig.profileId);
    const basePlan = plans.base?.plan;
    const snapshot = EasyWebMappingSecurityHandler.createSnapshot(document, window.location);
    if (!snapshot) {
      return { accepted: false, reason: "Não foi possível preparar a estrutura desta página." };
    }
    snapshot.templateFingerprint = await createTemplateFingerprint(snapshot);
    const requestId = crypto.randomUUID();
    const response = await chrome.runtime.sendMessage({
      type: "easyweb:adaptation:personal-request",
      requestId,
      snapshot,
      basePlanId: basePlan?.planId || null,
      profile: currentConfig.profileId,
      previousPersonalPlan: plans.personal?.plan || null,
      userRequest
    });
    if (response?.accepted) {
      setAiAdaptationStatus({
        state: response.state || "analyzing-personal",
        scope: "personal",
        requestId,
        personalRequestId: requestId,
        message: response.message || "A IA está preparando seus ajustes adicionais."
      });
    }
    return response || { accepted: false, reason: "Não foi possível enviar sua solicitação." };
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
    await safelyApplyAiAdaptation(config);
    return config;
  }

  async function initialize() {
    try {
      const config = await loadConfig();
      accessibility.startObserver();
      await safelyUpdateProtectedMapping();

      if (config.settings.enabled && (config.profileId !== "default" || config.hasSiteOverride)) {
        notification.showOnce();
      }
    } catch (error) {
      const fallback = {
        profileId: "default",
        profile: settingsApi.getProfile("default"),
        extensionEnabled: true,
        operationMode: settingsApi.OPERATION_MODES.STANDARD,
        manualMode: false,
        hasSiteOverride: false,
        universalFilter: null,
        settings: settingsApi.DEFAULTS
      };
      applyConfig(fallback);
      aiAdaptation.clear();
      accessibility.startObserver();
    } finally {
      resolveReady();
    }
  }

  chrome.storage.onChanged?.addListener(async (changes, areaName) => {
    const siteSettingsChanged = Object.keys(changes).some((key) =>
      settings.isSiteStorageKey(key) ||
      key === settingsApi.ACTIVE_PROFILE_KEY ||
      key === settingsApi.DALTONIC_FILTER_KEY ||
      key === settingsApi.EASYWEB_ENABLED_KEY ||
      key === settingsApi.OPERATION_MODE_KEY
    );
    const mappingConsentChanged = Boolean(
      changes[settingsApi.MAPPING_CONSENT_ENABLED_KEY] ||
      changes[settings.mappingSiteStorageKey] ||
      changes[settingsApi.EASYWEB_ENABLED_KEY] ||
      changes[settingsApi.OPERATION_MODE_KEY]
    );
    const aiPlanChanged = Boolean(
      changes[settings.aiBasePlanStorageKey] ||
      (currentConfig && changes[settings.aiPersonalPlanStorageKey(currentConfig.profileId)])
    );
    const aiSettingsChanged = Boolean(
      changes[settingsApi.AI_RECOMMENDATIONS_ENABLED_KEY] ||
      changes[settings.aiSiteStorageKey] ||
      changes[settingsApi.EASYWEB_ENABLED_KEY] ||
      changes[settingsApi.OPERATION_MODE_KEY] ||
      aiPlanChanged
    );

    if (areaName !== "local") {
      return;
    }

    try {
      if (siteSettingsChanged) {
        const config = await settings.load();
        applyConfig(config);
        await safelyApplyAiAdaptation(config);
      }
      if (mappingConsentChanged) {
        await safelyUpdateProtectedMapping();
      }
      if (aiSettingsChanged && !siteSettingsChanged) {
        await safelyApplyAiAdaptation(await settings.load());
      }
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
            extensionEnabled: currentConfig.extensionEnabled,
            operationMode: currentConfig.operationMode,
            manualMode: currentConfig.manualMode,
            hasSiteOverride: currentConfig.hasSiteOverride,
            universalFilter: currentConfig.universalFilter,
            mappingConsent: await getMappingConsent(),
            mappingDelivery: mappingDeliveryStatus,
            aiPreferences: await settings.loadAiPreferences(currentConfig.profileId),
            aiAdaptation: aiAdaptationStatus,
            aiPlanState: await settings.loadAiPlanState(currentConfig.profileId),
            apiConnection: await getApiConnectionStatus(),
            fastModeStatus: fastMode.getStatus()
          });
          return;
        }

        if (message.type === "easyweb:set-mapping-consent") {
          const safety = EasyWebMappingSecurityHandler.assess(document, window.location);
          const consent = await settings.loadMappingConsent();
          if (message.allowed && consent.operationMode !== settingsApi.OPERATION_MODES.ENHANCED) {
            sendResponse({
              mappingConsent: {
                ...consent,
                ...safety,
                canMap: false,
                policyVersion: EasyWebMappingSecurityHandler.MAPPING_CAPTURE_POLICY.version
              }
            });
            return;
          }
          if (message.allowed && !consent.globalEnabled) {
            sendResponse({
              mappingConsent: {
                ...consent,
                ...safety,
                canMap: false,
                policyVersion: EasyWebMappingSecurityHandler.MAPPING_CAPTURE_POLICY.version
              }
            });
            return;
          }

          if (message.allowed && !safety.safeToMap) {
            sendResponse({
              mappingConsent: {
                ...consent,
                ...safety,
                canMap: false,
                policyVersion: EasyWebMappingSecurityHandler.MAPPING_CAPTURE_POLICY.version
              }
            });
            return;
          }

          await settings.saveMappingConsent(Boolean(message.allowed));
          await safelyUpdateProtectedMapping();
          sendResponse({ mappingConsent: await getMappingConsent() });
          return;
        }

        if (message.type === "easyweb:set-ai-site-enabled") {
          const preferences = await settings.loadAiPreferences(currentConfig.profileId);
          if (message.enabled && (!preferences.globalEnabled ||
            preferences.operationMode !== settingsApi.OPERATION_MODES.ENHANCED ||
            !preferences.extensionEnabled)) {
            sendResponse({
              aiPreferences: preferences,
          aiAdaptation: await safelyApplyAiAdaptation(currentConfig)
            });
            return;
          }
          await settings.saveAiSiteEnabled(Boolean(message.enabled));
          sendResponse({
            aiPreferences: await settings.loadAiPreferences(currentConfig.profileId),
            aiAdaptation: await safelyApplyAiAdaptation(currentConfig)
          });
          return;
        }

        if (message.type === "easyweb:request-personal-ai-adaptation") {
          const response = await requestPersonalAiAdaptation(message.userRequest);
          sendResponse({ ...response, aiAdaptation: aiAdaptationStatus });
          return;
        }

        if (message.type === "easyweb:apply-ai-base-plan" && message.plan) {
          const immediate = await applyIncomingAiPlan(message.plan);
          if (immediate.applied) {
            try {
              await settings.saveAiBasePlan(message.plan);
              await settings.recordAiPlanApplication(message.plan, { source: "websocket" }, currentConfig.profileId);
            } catch (error) {
              // A folha já está ativa; a próxima aplicação poderá reconstruir o cache.
            }
          }
          sendResponse({
            aiAdaptation: immediate.applied ? aiAdaptationStatus : await safelyApplyAiAdaptation(currentConfig),
            appliedImmediately: immediate.applied
          });
          return;
        }

        if (message.type === "easyweb:apply-ai-personal-plan" && message.plan) {
          const profileId = typeof message.profileId === "string" && message.profileId
            ? message.profileId
            : currentConfig.profileId;
          const immediate = await applyIncomingAiPlan(message.plan, { profileId, requestId: message.requestId });
          if (immediate.applied) {
            try {
              await settings.saveAiPersonalPlan(message.plan, profileId);
              await settings.recordAiPlanApplication(message.plan, { source: "websocket" }, profileId);
            } catch (error) {
              // A folha já está ativa; a próxima aplicação poderá reconstruir o cache.
            }
          }
          sendResponse({
            aiAdaptation: immediate.applied ? aiAdaptationStatus : await safelyApplyAiAdaptation(currentConfig),
            appliedImmediately: immediate.applied
          });
          return;
        }

        if (message.type === "easyweb:restore-previous-ai-plan") {
          const result = await restorePreviousAiPlan(message.scope);
          sendResponse({
            ...result,
            aiAdaptation: aiAdaptationStatus,
            aiPlanState: await settings.loadAiPlanState(currentConfig.profileId)
          });
          return;
        }

        if (message.type === "easyweb:ai-adaptation-status") {
          setAiAdaptationStatus(message.status || {});
          sendResponse({ received: true });
          return;
        }

        if (message.type === "easyweb:mapping-delivery-status") {
          setMappingDeliveryStatus(message.status || {});
          const captureId = message.status?.captureId;
          if (message.status?.state === "stored" && captureId && pendingMappingPayloads.has(captureId)) {
            lastMappingPayload = pendingMappingPayloads.get(captureId);
            lastMappingConfirmedAt = Date.now();
            pendingMappingPayloads.delete(captureId);
          }
          if (message.status?.state === "rejected" && captureId) {
            pendingMappingPayloads.delete(captureId);
          }
          sendResponse({ received: true });
          return;
        }

        if (message.type === "easyweb:set-extension-enabled") {
          const config = await settings.setExtensionEnabled(Boolean(message.enabled));
          const appliedSettings = applyConfig(config);
          await safelyApplyAiAdaptation(config);
          await safelyUpdateProtectedMapping();
          sendResponse({
            settings: appliedSettings,
            extensionEnabled: config.extensionEnabled,
            operationMode: config.operationMode,
            manualMode: config.manualMode,
            profileId: config.profileId,
            profileLabel: config.profile.label
          });
          return;
        }

        if (message.type === "easyweb:set-site-manual-mode") {
          const config = await settings.setManualMode(Boolean(message.enabled));
          const appliedSettings = applyConfig(config);
          await safelyApplyAiAdaptation(config);
          sendResponse({
            settings: appliedSettings,
            extensionEnabled: config.extensionEnabled,
            operationMode: config.operationMode,
            manualMode: config.manualMode,
            profileId: config.profileId,
            profileLabel: config.profile.label,
            hasSiteOverride: config.hasSiteOverride,
            universalFilter: config.universalFilter,
            fastModeStatus: fastMode.getStatus()
          });
          return;
        }

        if (message.type === "easyweb:request-mapping-capture") {
          lastMappingPayload = undefined;
          await captureProtectedSnapshot(true);
          sendResponse({ mappingDelivery: mappingDeliveryStatus });
          return;
        }

        if (message.type === "easyweb:refresh-config") {
          const config = await settings.load();
          const appliedSettings = applyConfig(config);
          await safelyApplyAiAdaptation(config);
          sendResponse({
            settings: appliedSettings,
            profileId: currentConfig.profileId,
            profileLabel: currentConfig.profile.label,
            extensionEnabled: currentConfig.extensionEnabled,
            operationMode: currentConfig.operationMode,
            manualMode: currentConfig.manualMode,
            hasSiteOverride: currentConfig.hasSiteOverride,
            universalFilter: currentConfig.universalFilter,
            aiPreferences: await settings.loadAiPreferences(currentConfig.profileId),
            aiAdaptation: aiAdaptationStatus,
            aiPlanState: await settings.loadAiPlanState(currentConfig.profileId),
            apiConnection: await getApiConnectionStatus(),
            fastModeStatus: fastMode.getStatus()
          });
          return;
        }

        if (message.type === "easyweb:apply-state") {
          if (!currentConfig.manualMode) {
            sendResponse({ error: "Ative as configurações manuais para este site antes de alterá-lo." });
            return;
          }
          const appliedSettings = applyConfig({
            ...currentConfig,
            settings: message.settings
          });
          const savedSettings = await settings.saveSiteOverride(appliedSettings);
          currentConfig = {
            ...currentConfig,
            hasSiteOverride: true,
            manualMode: true,
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
            await safelyApplyAiAdaptation(config);
            sendResponse({
              settings: appliedSettings,
              extensionEnabled: config.extensionEnabled,
              operationMode: config.operationMode,
              manualMode: config.manualMode,
              profileId: config.profileId,
              profileLabel: config.profile.label,
              hasSiteOverride: currentConfig.hasSiteOverride,
              universalFilter: currentConfig.universalFilter,
              aiPreferences: await settings.loadAiPreferences(config.profileId),
              aiAdaptation: aiAdaptationStatus,
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
          await settings.saveAiSiteEnabled(false);
          await safelyApplyAiAdaptation(currentConfig);
          sendResponse({
            settings: appliedSettings,
            extensionEnabled: currentConfig.extensionEnabled,
            operationMode: currentConfig.operationMode,
            manualMode: currentConfig.manualMode,
            profileId: currentConfig.profileId,
            profileLabel: currentConfig.profile.label,
            hasSiteOverride: true,
            universalFilter: currentConfig.universalFilter,
            aiPreferences: await settings.loadAiPreferences(currentConfig.profileId),
            aiAdaptation: aiAdaptationStatus,
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
    version: CONTENT_VERSION,
    applyState: accessibility.apply,
    getState: accessibility.getState
  };

  initialize();
})();
