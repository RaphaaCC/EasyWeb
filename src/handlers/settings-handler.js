(() => {
  const ACTIVE_PROFILE_KEY = "easyweb:active-profile";
  const DALTONIC_FILTER_KEY = "easyweb:daltonic-filter";
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
        contrast: true,
        highlightLinks: true,
        colorFilter: "deuteranopia",
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

  function normalize(settings = {}) {
    return {
      enabled: Boolean(settings.enabled),
      fontScale: clamp(Number(settings.fontScale) || 1, 0.8, 1.6),
      lineHeight: clamp(Number(settings.lineHeight) || 1.4, 1, 2.2),
      letterSpacing: clamp(Number(settings.letterSpacing) || 0, 0, 3),
      contrast: Boolean(settings.contrast),
      highlightLinks: Boolean(settings.highlightLinks),
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

    return {
      siteStorageKey,
      isSiteStorageKey(key) {
        return key === siteStorageKey;
      },
      async load() {
        const saved = await chrome.storage.local.get([
          ACTIVE_PROFILE_KEY,
          DALTONIC_FILTER_KEY,
          siteStorageKey
        ]);
        const profile = getProfile(saved[ACTIVE_PROFILE_KEY]);
        const siteOverride = saved[siteStorageKey];
        const universalFilter = getUniversalFilter(saved[DALTONIC_FILTER_KEY]);
        const settings = {
          ...profile.settings,
          ...siteOverride,
          colorFilter: universalFilter || siteOverride?.colorFilter || profile.settings.colorFilter
        };

        return {
          profileId: profile.id,
          profile,
          hasSiteOverride: Boolean(siteOverride),
          universalFilter,
          settings: normalize(settings)
        };
      },

      async saveSiteOverride(settings) {
        const normalized = normalize(settings);
        await chrome.storage.local.set({ [siteStorageKey]: normalized });
        return normalized;
      },

      async resetSiteOverride() {
        await chrome.storage.local.remove(siteStorageKey);
        return this.load();
      }
    };
  }

  globalThis.EasyWebSettingsHandler = {
    ACTIVE_PROFILE_KEY,
    COLOR_FILTERS,
    DALTONIC_FILTER_KEY,
    RESTORE_GLOBAL_PROFILE_KEY,
    DEFAULTS: PROFILES.default.settings,
    PROFILES,
    normalize,
    normalizeFilter,
    getUniversalFilter,
    getProfile,
    create
  };
})();
