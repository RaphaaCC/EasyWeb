(() => {
  const ACTIVE_PROFILE_KEY = "easyweb:active-profile";
  const API_BASE_URL = "https://easyweb.api.raemi.xyz";
  const API_BASE_URL_KEY = "easyweb:api-base-url";
  const DALTONIC_FILTER_KEY = "easyweb:daltonic-filter";
  const DEVELOPER_MODE_KEY = "easyweb:developer-mode";
  const EASYWEB_ENABLED_KEY = "easyweb:enabled";
  const AI_RECOMMENDATIONS_ENABLED_KEY = "easyweb:ai-recommendations-enabled";
  const AI_SITE_ENABLED_PREFIX = "easyweb:ai-site:";
  const AI_BASE_PLAN_PREFIX = "easyweb:ai:base-plan:";
  const AI_PERSONAL_PLAN_PREFIX = "easyweb:ai:personal-plan:";
  const AI_COMPILED_PLAN_PREFIX = "easyweb:ai:compiled:";
  const AI_PLAN_HISTORY_PREFIX = "easyweb:ai:plan-history:";
  const AI_APPLIED_PLAN_PREFIX = "easyweb:ai:applied-plan:";
  const MAX_AI_PLAN_HISTORY = 3;
  const OPERATION_MODE_KEY = "easyweb:operation-mode";
  const OPERATION_MODES = Object.freeze({
    STANDARD: "standard",
    ENHANCED: "enhanced"
  });
  const MAPPING_CONSENT_ENABLED_KEY = "easyweb:mapping-consent-enabled";
  const MAPPING_SITE_CONSENT_PREFIX = "easyweb:mapping-site:";
  const MAPPING_TEMPLATE_CACHE_PREFIX = "easyweb:mapping-template:";
  const MAPPING_CONFIRMED_TEMPLATE_PREFIX = "easyweb:mapping-confirmed-template:";
  const RESTORE_GLOBAL_PROFILE_KEY = "easyweb:restore-global-profile";
  const COLOR_FILTERS = Object.freeze([
    "protanopia",
    "protanomaly",
    "deuteranopia",
    "deuteranomaly",
    "tritanopia",
    "tritanomaly",
    "achromatopsia",
    "achromatomaly",
    "blue-cone-monochromacy"
  ]);

  const PROFILES = Object.freeze({
    default: Object.freeze({
      id: "default",
      label: "Padrão",
      description: "Ajustes manuais e individuais para cada site.",
      settings: Object.freeze({
        enabled: false,
        fontScale: 1,
        lineHeight: 1.4,
        letterSpacing: 0,
        contrast: false,
        highlightLinks: false,
        reduceMotion: false,
        readingFocus: false,
        colorFilter: "none",
        fastMode: false
      })
    }),
    elderly: Object.freeze({
      id: "elderly",
      label: "Idoso",
      description: "Mais conforto para leitura, separação visual e navegação.",
      settings: Object.freeze({
        enabled: true,
        fontScale: 1.25,
        lineHeight: 1.7,
        letterSpacing: 0.5,
        contrast: true,
        highlightLinks: true,
        reduceMotion: false,
        readingFocus: false,
        colorFilter: "none",
        fastMode: false
      })
    }),
    children: Object.freeze({
      id: "children",
      label: "Crianças",
      description: "Leitura mais clara e elementos interativos fáceis de identificar.",
      settings: Object.freeze({
        enabled: true,
        fontScale: 1.15,
        lineHeight: 1.6,
        letterSpacing: 0.3,
        contrast: true,
        highlightLinks: true,
        reduceMotion: false,
        readingFocus: false,
        colorFilter: "none",
        fastMode: false
      })
    }),
    pcd: Object.freeze({
      id: "pcd",
      label: "PCD",
      description: "Um ponto de partida com mais contraste, tamanho e espaçamento.",
      settings: Object.freeze({
        enabled: true,
        fontScale: 1.15,
        lineHeight: 1.7,
        letterSpacing: 0.5,
        contrast: true,
        highlightLinks: true,
        reduceMotion: false,
        readingFocus: false,
        colorFilter: "none",
        fastMode: false
      })
    }),
    colorblind: Object.freeze({
      id: "colorblind",
      label: "Daltônico",
      description: "Filtro de cores para facilitar a diferenciação visual.",
      settings: Object.freeze({
        enabled: true,
        fontScale: 1.1,
        lineHeight: 1.6,
        letterSpacing: 0.3,
        contrast: false,
        highlightLinks: true,
        reduceMotion: false,
        readingFocus: false,
        colorFilter: "deuteranopia",
        fastMode: false
      })
    }),
    dyslexia: Object.freeze({
      id: "dyslexia",
      label: "Dislexia",
      description: "Mais espaço e ritmo de leitura para reduzir a aglomeração visual.",
      settings: Object.freeze({
        enabled: true,
        fontScale: 1.2,
        lineHeight: 1.9,
        letterSpacing: 0.8,
        contrast: false,
        highlightLinks: true,
        reduceMotion: false,
        readingFocus: false,
        colorFilter: "none",
        fastMode: false
      })
    }),
    lowVision: Object.freeze({
      id: "lowVision",
      label: "Baixa visão",
      description: "Texto ampliado, contraste forte e elementos interativos destacados.",
      settings: Object.freeze({
        enabled: true,
        fontScale: 1.4,
        lineHeight: 1.9,
        letterSpacing: 0.8,
        contrast: true,
        highlightLinks: true,
        reduceMotion: false,
        readingFocus: false,
        colorFilter: "none",
        fastMode: false
      })
    }),
    sensory: Object.freeze({
      id: "sensory",
      label: "Sensibilidade visual",
      description: "Reduz movimentos e transições para uma navegação mais estável.",
      settings: Object.freeze({
        enabled: true,
        fontScale: 1.1,
        lineHeight: 1.6,
        letterSpacing: 0.3,
        contrast: false,
        highlightLinks: true,
        reduceMotion: true,
        readingFocus: false,
        colorFilter: "none",
        fastMode: false
      })
    }),
    reading: Object.freeze({
      id: "reading",
      label: "Leitura focada",
      description: "Aumenta a legibilidade e organiza regiões de conteúdo para leitura prolongada.",
      settings: Object.freeze({
        enabled: true,
        fontScale: 1.2,
        lineHeight: 1.8,
        letterSpacing: 0.5,
        contrast: false,
        highlightLinks: false,
        reduceMotion: true,
        readingFocus: true,
        colorFilter: "none",
        fastMode: false
      })
    })
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeFilter(filter) {
    return COLOR_FILTERS.includes(filter) ? filter : "none";
  }

  function getUniversalFilter(value) {
    if (typeof value === "string") {
      const filter = normalizeFilter(value);
      return filter === "none" ? null : filter;
    }

    if (value?.enabled) {
      const filter = normalizeFilter(value.type);
      return filter === "none" ? null : filter;
    }

    return null;
  }

  function normalizeOperationMode(value) {
    return value === OPERATION_MODES.ENHANCED
      ? OPERATION_MODES.ENHANCED
      : OPERATION_MODES.STANDARD;
  }

  function normalizeApiBaseUrl(value) {
    try {
      const rawValue = String(value).trim();
      if (!rawValue) {
        return null;
      }

      const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(rawValue);
      const url = new URL(hasProtocol ? rawValue : `http://${rawValue}`);
      const isLocalHttp = url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
      if ((url.protocol !== "https:" && !isLocalHttp) || url.username || url.password || url.search || url.hash) {
        return null;
      }

      if (isLocalHttp && !url.port) {
        url.port = "3001";
      }

      return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
    } catch (error) {
      return null;
    }
  }

  function getApiConfiguration(saved = {}) {
    const developerMode = Boolean(saved[DEVELOPER_MODE_KEY]);
    const customUrl = developerMode ? normalizeApiBaseUrl(saved[API_BASE_URL_KEY]) : null;
    return {
      developerMode,
      baseUrl: customUrl || API_BASE_URL
    };
  }

  function normalize(settings = {}) {
    return {
      enabled: Boolean(settings.enabled),
      fontScale: clamp(Number(settings.fontScale) || 1, 0.8, 1.6),
      lineHeight: clamp(Number(settings.lineHeight) || 1.4, 1, 2.2),
      letterSpacing: clamp(Number(settings.letterSpacing) || 0, 0, 3),
      contrast: Boolean(settings.contrast),
      highlightLinks: Boolean(settings.highlightLinks),
      reduceMotion: Boolean(settings.reduceMotion),
      readingFocus: Boolean(settings.readingFocus),
      colorFilter: normalizeFilter(settings.colorFilter),
      fastMode: Boolean(settings.fastMode)
    };
  }

  function getProfile(profileId) {
    return PROFILES[profileId] || PROFILES.default;
  }

  function create(locationLike) {
    const siteIdentifier = locationLike.origin === "null" ? locationLike.href : locationLike.origin;
    const siteStorageKey = `easyweb:site:${siteIdentifier}`;
    const siteManualModeStorageKey = `easyweb:site-manual:${siteIdentifier}`;
    const mappingSiteStorageKey = `${MAPPING_SITE_CONSENT_PREFIX}${siteIdentifier}`;
    const aiSiteStorageKey = `${AI_SITE_ENABLED_PREFIX}${siteIdentifier}`;
    const aiBasePlanStorageKey = `${AI_BASE_PLAN_PREFIX}${siteIdentifier}`;

    function aiPersonalPlanStorageKey(profileId) {
      return `${AI_PERSONAL_PLAN_PREFIX}${siteIdentifier}:${profileId}`;
    }

    function aiPlanHistoryStorageKey(scope, profileId) {
      const suffix = scope === "personal" ? `personal:${profileId}` : "base";
      return `${AI_PLAN_HISTORY_PREFIX}${siteIdentifier}:${suffix}`;
    }

    function aiAppliedPlanStorageKey(profileId) {
      return `${AI_APPLIED_PLAN_PREFIX}${siteIdentifier}:${profileId}`;
    }

    function isPlanEntry(value) {
      return Boolean(value?.plan && typeof value.plan === "object" &&
        typeof value.plan.planId === "string" && value.plan.planId);
    }

    async function saveAiPlan(scope, plan, profileId) {
      if (!plan || typeof plan !== "object" || typeof plan.planId !== "string" || !plan.planId) {
        return false;
      }

      const currentKey = scope === "personal"
        ? aiPersonalPlanStorageKey(profileId)
        : aiBasePlanStorageKey;
      const historyKey = aiPlanHistoryStorageKey(scope, profileId);
      const saved = await chrome.storage.local.get([currentKey, historyKey]);
      const previous = saved[currentKey];
      const history = Array.isArray(saved[historyKey]) ? saved[historyKey].filter(isPlanEntry) : [];
      const current = { plan, receivedAt: new Date().toISOString() };
      const changed = previous?.plan?.planId !== plan.planId;
      const nextHistory = changed && isPlanEntry(previous)
        ? [{ ...previous, replacedAt: current.receivedAt }, ...history]
          .filter((entry, index, entries) => entries.findIndex((candidate) =>
            candidate.plan.planId === entry.plan.planId) === index)
          .slice(0, MAX_AI_PLAN_HISTORY)
        : history;

      await chrome.storage.local.set({
        [currentKey]: current,
        [historyKey]: nextHistory
      });
      return true;
    }

    return {
      siteStorageKey,
      siteManualModeStorageKey,
      mappingSiteStorageKey,
      aiSiteStorageKey,
      aiBasePlanStorageKey,
      aiPersonalPlanStorageKey,
      aiPlanHistoryStorageKey,
      aiAppliedPlanStorageKey,
      isSiteStorageKey(key) {
        return key === siteStorageKey || key === siteManualModeStorageKey || key === aiSiteStorageKey;
      },
      async load() {
        const saved = await chrome.storage.local.get([
          ACTIVE_PROFILE_KEY,
          DALTONIC_FILTER_KEY,
          siteStorageKey,
          siteManualModeStorageKey,
          EASYWEB_ENABLED_KEY,
          OPERATION_MODE_KEY
        ]);
        const profile = getProfile(saved[ACTIVE_PROFILE_KEY]);
        const siteOverride = saved[siteStorageKey];
        const manualMode = Boolean(saved[siteManualModeStorageKey]);
        const extensionEnabled = saved[EASYWEB_ENABLED_KEY] !== false;
        const operationMode = normalizeOperationMode(saved[OPERATION_MODE_KEY]);
        const universalFilter = getUniversalFilter(saved[DALTONIC_FILTER_KEY]);
        const baseSettings = manualMode && siteOverride ? siteOverride : profile.settings;
        const settings = {
          ...baseSettings,
          enabled: extensionEnabled && baseSettings.enabled,
          fastMode: extensionEnabled && baseSettings.fastMode,
          colorFilter: universalFilter || baseSettings.colorFilter
        };

        return {
          profileId: profile.id,
          profile,
          extensionEnabled,
          operationMode,
          manualMode,
          hasSiteOverride: manualMode && Boolean(siteOverride),
          universalFilter,
          settings: normalize(settings)
        };
      },

      async saveSiteOverride(settings) {
        const normalized = normalize(settings);
        await chrome.storage.local.set({ [siteStorageKey]: normalized });
        return normalized;
      },

      async setManualMode(enabled) {
        const saved = await chrome.storage.local.get([ACTIVE_PROFILE_KEY, siteStorageKey]);
        if (enabled && !saved[siteStorageKey]) {
          // The default profile intentionally makes no changes. Enabling a manual
          // override must still give the person a usable starting point.
          await chrome.storage.local.set({
            [siteStorageKey]: normalize({
              ...getProfile(saved[ACTIVE_PROFILE_KEY]).settings,
              enabled: true
            })
          });
        }
        await chrome.storage.local.set({ [siteManualModeStorageKey]: Boolean(enabled) });
        return this.load();
      },

      async setExtensionEnabled(enabled) {
        await chrome.storage.local.set({ [EASYWEB_ENABLED_KEY]: Boolean(enabled) });
        return this.load();
      },

       async resetSiteOverride() {
          await chrome.storage.local.remove([siteStorageKey, siteManualModeStorageKey]);
          return this.load();
        },

      async loadMappingConsent() {
        const saved = await chrome.storage.local.get([
          MAPPING_CONSENT_ENABLED_KEY,
          mappingSiteStorageKey,
          EASYWEB_ENABLED_KEY,
          OPERATION_MODE_KEY
        ]);
        return {
          globalEnabled: Boolean(saved[MAPPING_CONSENT_ENABLED_KEY]),
          siteAllowed: Boolean(saved[mappingSiteStorageKey]),
          extensionEnabled: saved[EASYWEB_ENABLED_KEY] !== false,
          operationMode: normalizeOperationMode(saved[OPERATION_MODE_KEY])
        };
      },

      async saveMappingConsent(allowed) {
        if (allowed) {
          await chrome.storage.local.set({ [mappingSiteStorageKey]: true });
          return true;
        }

        await chrome.storage.local.remove(mappingSiteStorageKey);
        return false;
      },

      async loadAiPreferences(profileId) {
        const saved = await chrome.storage.local.get([
          AI_RECOMMENDATIONS_ENABLED_KEY,
          aiSiteStorageKey,
          EASYWEB_ENABLED_KEY,
          OPERATION_MODE_KEY
        ]);
        const operationMode = normalizeOperationMode(saved[OPERATION_MODE_KEY]);
        const canRequest = Boolean(saved[AI_RECOMMENDATIONS_ENABLED_KEY]) &&
          saved[EASYWEB_ENABLED_KEY] !== false &&
          operationMode === OPERATION_MODES.ENHANCED;
        return {
          globalEnabled: Boolean(saved[AI_RECOMMENDATIONS_ENABLED_KEY]),
          siteEnabled: Boolean(saved[aiSiteStorageKey]),
          extensionEnabled: saved[EASYWEB_ENABLED_KEY] !== false,
          operationMode,
          canRequest,
          canApplyAutomatic: canRequest && Boolean(saved[aiSiteStorageKey]),
          profileId: typeof profileId === "string" ? profileId : "default"
        };
      },

      async saveAiSiteEnabled(enabled) {
        if (enabled) {
          await chrome.storage.local.set({ [aiSiteStorageKey]: true });
          return true;
        }
        await chrome.storage.local.remove(aiSiteStorageKey);
        return false;
      },

      async loadAiPlans(profileId) {
        const personalStorageKey = aiPersonalPlanStorageKey(profileId);
        const saved = await chrome.storage.local.get([aiBasePlanStorageKey, personalStorageKey]);
        return {
          base: saved[aiBasePlanStorageKey] || null,
          personal: saved[personalStorageKey] || null
        };
      },

      async saveAiBasePlan(plan) {
        return saveAiPlan("base", plan, undefined);
      },

      async saveAiPersonalPlan(plan, profileId) {
        return saveAiPlan("personal", plan, profileId);
      },

      async loadAiPlanHistory(profileId) {
        const saved = await chrome.storage.local.get([
          aiPlanHistoryStorageKey("base", profileId),
          aiPlanHistoryStorageKey("personal", profileId)
        ]);
        return {
          base: (Array.isArray(saved[aiPlanHistoryStorageKey("base", profileId)])
            ? saved[aiPlanHistoryStorageKey("base", profileId)]
            : []).filter(isPlanEntry),
          personal: (Array.isArray(saved[aiPlanHistoryStorageKey("personal", profileId)])
            ? saved[aiPlanHistoryStorageKey("personal", profileId)]
            : []).filter(isPlanEntry)
        };
      },

      async loadAiPlanState(profileId) {
        const [plans, history] = await Promise.all([
          this.loadAiPlans(profileId),
          this.loadAiPlanHistory(profileId)
        ]);
        const appliedKey = aiAppliedPlanStorageKey(profileId);
        const saved = await chrome.storage.local.get(appliedKey);
        const applied = saved[appliedKey] || null;
        const candidates = [
          ...history.base.map((entry) => ({ scope: "base", entry })),
          ...history.personal.map((entry) => ({ scope: "personal", entry }))
        ].filter((candidate) => !applied?.planScope || candidate.scope === applied.planScope)
          .sort((left, right) => Date.parse(right.entry.replacedAt || right.entry.receivedAt || 0) -
          Date.parse(left.entry.replacedAt || left.entry.receivedAt || 0));
        return {
          basePlan: plans.base?.plan || null,
          personalPlan: plans.personal?.plan || null,
          previous: candidates[0] || null,
          historyCount: history.base.length + history.personal.length,
          applied
        };
      },

      async recordAiPlanApplication(plan, { source = "live" } = {}, profileId) {
        if (!plan || typeof plan.planId !== "string" || !plan.planId) {
          return false;
        }
        await chrome.storage.local.set({
          [aiAppliedPlanStorageKey(profileId)]: {
            planId: plan.planId,
            planScope: plan.planScope,
            planVersion: plan.planVersion || null,
            adaptationFingerprint: plan.adaptationFingerprint || null,
            sourceContentHashes: Array.isArray(plan.sourceContentHashes) ? plan.sourceContentHashes.slice(0, 2) : [],
            source,
            appliedAt: new Date().toISOString()
          }
        });
        return true;
      },

      async restorePreviousAiPlan(scope, profileId) {
        if (scope !== "base" && scope !== "personal") {
          return { restored: false, reason: "invalid-scope" };
        }
        const currentKey = scope === "personal"
          ? aiPersonalPlanStorageKey(profileId)
          : aiBasePlanStorageKey;
        const historyKey = aiPlanHistoryStorageKey(scope, profileId);
        const saved = await chrome.storage.local.get([currentKey, historyKey]);
        const history = Array.isArray(saved[historyKey]) ? saved[historyKey].filter(isPlanEntry) : [];
        const previous = history[0];
        if (!previous) {
          return { restored: false, reason: "no-previous-plan" };
        }
        const current = saved[currentKey];
        const restoredAt = new Date().toISOString();
        const nextHistory = [
          ...(isPlanEntry(current) ? [{ ...current, replacedAt: restoredAt }] : []),
          ...history.slice(1)
        ].filter((entry, index, entries) => entries.findIndex((candidate) =>
          candidate.plan.planId === entry.plan.planId) === index).slice(0, MAX_AI_PLAN_HISTORY);
        await chrome.storage.local.set({
          [currentKey]: { ...previous, restoredAt },
          [historyKey]: nextHistory
        });
        return { restored: true, plan: previous.plan, scope, historyCount: nextHistory.length };
      },

      async saveAiCompiledPlan(planId, compiled) {
        if (!planId || !compiled || typeof compiled.css !== "string") {
          return;
        }
        await chrome.storage.local.set({
          [`${AI_COMPILED_PLAN_PREFIX}${planId}`]: {
            css: compiled.css,
            handlerVersion: compiled.handlerVersion,
            siteScriptVersion: compiled.siteScriptVersion,
            savedAt: new Date().toISOString()
          }
        });
      },

      async loadAiCompiledPlan(planId) {
        if (typeof planId !== "string" || !planId) {
          return null;
        }
        const storageKey = `${AI_COMPILED_PLAN_PREFIX}${planId}`;
        const saved = await chrome.storage.local.get(storageKey);
        return saved[storageKey] || null;
      }
    };
  }

  globalThis.EasyWebSettingsHandler = {
    ACTIVE_PROFILE_KEY,
    AI_RECOMMENDATIONS_ENABLED_KEY,
    AI_SITE_ENABLED_PREFIX,
    AI_BASE_PLAN_PREFIX,
    AI_PERSONAL_PLAN_PREFIX,
    AI_COMPILED_PLAN_PREFIX,
    AI_PLAN_HISTORY_PREFIX,
    AI_APPLIED_PLAN_PREFIX,
    API_BASE_URL,
    API_BASE_URL_KEY,
    COLOR_FILTERS,
    DALTONIC_FILTER_KEY,
    DEVELOPER_MODE_KEY,
    EASYWEB_ENABLED_KEY,
    OPERATION_MODE_KEY,
    OPERATION_MODES,
    MAPPING_CONSENT_ENABLED_KEY,
    MAPPING_SITE_CONSENT_PREFIX,
    MAPPING_TEMPLATE_CACHE_PREFIX,
    MAPPING_CONFIRMED_TEMPLATE_PREFIX,
    RESTORE_GLOBAL_PROFILE_KEY,
    DEFAULTS: PROFILES.default.settings,
    PROFILES,
    normalize,
    normalizeApiBaseUrl,
    normalizeFilter,
    normalizeOperationMode,
    getApiConfiguration,
    getUniversalFilter,
    getProfile,
    create
  };
})();
