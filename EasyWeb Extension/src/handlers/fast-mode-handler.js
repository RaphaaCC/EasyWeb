(() => {
  const ASSESSMENT_DURATION = 1500;
  const CACHE_VERSION = 3;
  const MAX_ELEMENTS = 5000;
  const MAX_STRUCTURAL_MUTATIONS = 70;
  const CACHE_KEY_PREFIX = "easyweb:fast-style:";
  const BOOTSTRAP_STYLE_ID = "easyweb-fast-style-cache";

  function create(locationLike) {
    const listeners = new Set();
    const cacheKey = `${CACHE_KEY_PREFIX}${locationLike.pathname}${locationLike.search}`;
    let assessmentObserver;
    let safetyObserver;
    let status = {
      state: "checking",
      eligible: false,
      reason: "Verificando a estabilidade desta página."
    };

    function notify() {
      for (const listener of listeners) {
        listener({ ...status });
      }
    }

    function isEasyWebNode(node) {
      return node.nodeType === Node.ELEMENT_NODE &&
        (node.id?.startsWith("easyweb-") || node.closest?.("[id^=easyweb-]"));
    }

    function isIgnorableMutationNode(node) {
      if (node.nodeType === Node.TEXT_NODE || isEasyWebNode(node)) {
        return true;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      return ["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT"].includes(node.tagName);
    }

    function getMutationWeight(records) {
      return records.reduce((total, record) => {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        return total + nodes.filter((node) => !isIgnorableMutationNode(node)).length;
      }, 0);
    }

    function hash(value) {
      let result = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
      }
      return (result >>> 0).toString(36);
    }

    function getPageFingerprint() {
      if (!document.body) {
        return null;
      }

      const signature = [];
      let count = 0;
      for (const element of document.body.querySelectorAll("*")) {
        if (isEasyWebNode(element)) {
          continue;
        }

        count += 1;
        const className = typeof element.className === "string" ? element.className.slice(0, 80) : "";
        signature.push(
          `${element.tagName}:${element.childElementCount}:${element.getAttribute("role") || ""}:${element.id || ""}:${className}`
        );
      }

      return `${count}:${hash(signature.join("|"))}`;
    }

    function setStatus(nextStatus) {
      status = nextStatus;
      notify();
    }

    function assess() {
      if (!document.body) {
        setStatus({
          state: "blocked",
          eligible: false,
          reason: "Esta página ainda não terminou de carregar."
        });
        return;
      }

      if (document.body.querySelectorAll("*").length > MAX_ELEMENTS) {
        setStatus({
          state: "blocked",
          eligible: false,
          reason: "Página muito grande para o modo experimental."
        });
        return;
      }

      let mutations = 0;
      assessmentObserver = new MutationObserver((records) => {
        mutations += getMutationWeight(records);
      });
      assessmentObserver.observe(document.body, { childList: true, subtree: true });

      window.setTimeout(() => {
        assessmentObserver?.disconnect();
        assessmentObserver = undefined;

        if (mutations > MAX_STRUCTURAL_MUTATIONS) {
          setStatus({
            state: "blocked",
            eligible: false,
            reason: "Página dinâmica detectada; o modo experimental foi bloqueado."
          });
          return;
        }

        setStatus({
          state: "eligible",
          eligible: true,
          reason: "Disponível; a estrutura da página parece estável."
        });
      }, ASSESSMENT_DURATION);
    }

    function startSafetyWatch(onRiskDetected = () => {}) {
      safetyObserver?.disconnect();
      let mutations = 0;

      safetyObserver = new MutationObserver((records) => {
        mutations += getMutationWeight(records);
        if (mutations <= MAX_STRUCTURAL_MUTATIONS) {
          return;
        }

        safetyObserver.disconnect();
        safetyObserver = undefined;
        setStatus({
          state: "blocked",
          eligible: false,
          reason: "A página ficou dinâmica; o modo experimental foi desativado."
        });
        onRiskDetected();
      });
      safetyObserver.observe(document.body, { childList: true, subtree: true });
    }

    function stopSafetyWatch() {
      safetyObserver?.disconnect();
      safetyObserver = undefined;
    }

    function readCachedPayload() {
      try {
        const cached = JSON.parse(sessionStorage.getItem(cacheKey));
        return cached?.version === CACHE_VERSION && cached?.settings?.fastMode && cached?.css?.base
          ? cached
          : null;
      } catch (error) {
        return null;
      }
    }

    function hasMatchingFingerprint(payload) {
      return payload?.fingerprint === getPageFingerprint();
    }

    function cacheCompiledCss(settings, css) {
      try {
        if (!settings.fastMode || !css?.base) {
          sessionStorage.removeItem(cacheKey);
          return;
        }

        sessionStorage.setItem(cacheKey, JSON.stringify({
          version: CACHE_VERSION,
          fingerprint: getPageFingerprint(),
          settings,
          css
        }));
      } catch (error) {
        // O cache da sessao e uma otimizacao; a extensao continua funcionando sem ele.
      }
    }

    function clearCache() {
      try {
        sessionStorage.removeItem(cacheKey);
      } catch (error) {
        // A remocao do cache nao impede o funcionamento da extensao.
      }
    }

    function removeBootstrapStyles() {
      document.querySelector(`#${BOOTSTRAP_STYLE_ID}`)?.remove();
      document.documentElement.classList.remove("easyweb-fast-cache");
    }

    function applyCachedElementCss(payload) {
      const style = document.querySelector(`#${BOOTSTRAP_STYLE_ID}`);
      if (!style) {
        return false;
      }

      if (payload?.css?.elements && style.dataset.easywebElementsApplied !== "true") {
        style.textContent += `\n${payload.css.elements}`;
        style.dataset.easywebElementsApplied = "true";
      }

      return true;
    }

    function onStatusChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    assess();

    return {
      cacheCompiledCss,
      clearCache,
      getStatus: () => ({ ...status }),
      hasMatchingFingerprint,
      applyCachedElementCss,
      onStatusChange,
      readCachedPayload,
      removeBootstrapStyles,
      startSafetyWatch,
      stopSafetyWatch
    };
  }

  function buildSelector(element) {
    if (!element?.isConnected || element === document.documentElement) {
      return null;
    }

    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1) {
      return `#${CSS.escape(element.id)}`;
    }

    const parts = [];
    for (let current = element; current && current !== document.body; current = current.parentElement) {
      const siblings = [...current.parentElement.children].filter((sibling) => sibling.tagName === current.tagName);
      const position = siblings.indexOf(current) + 1;
      parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${position})`);

      if (parts.length >= 7) {
        return null;
      }
    }

    return parts.length ? `body > ${parts.join(" > ")}` : "body";
  }

  function buildCss(settings, rules) {
    if (!settings.enabled) {
      return { base: "", elements: "" };
    }

    const prefix = "html.easyweb-fast-cache";
    const css = [
      `${prefix}{--easyweb-line-height:${settings.lineHeight};--easyweb-letter-spacing:${settings.letterSpacing}px;}`,
      `${prefix} body,${prefix} body :where(p,li,blockquote,label,button,input,textarea,select,option,a,h1,h2,h3,h4,h5,h6,td,th,figcaption,summary){line-height:var(--easyweb-line-height)!important;letter-spacing:var(--easyweb-letter-spacing)!important;}`
    ];

    if (settings.highlightLinks) {
      css.push(
        `${prefix} body a[href]{text-decoration:underline!important;text-decoration-thickness:2px!important;text-underline-offset:.15em!important;}`,
        `${prefix} body a[href]:hover,${prefix} body a[href]:focus-visible{outline:3px solid #ffbf47!important;outline-offset:2px!important;background-color:#ffbf47!important;color:#123c35!important;border-radius:3px!important;}`
      );
    }

    if (settings.reduceMotion) {
      css.push(
        `${prefix} *,${prefix} *::before,${prefix} *::after{animation-delay:0ms!important;animation-duration:0.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-delay:0ms!important;transition-duration:0.01ms!important;}`
      );
    }

    if (settings.readingFocus) {
      css.push(
        `${prefix} :is(article,[role=main]){max-width:76ch!important;margin-inline:auto!important;}`
      );
    }

    return {
      base: css.join("\n"),
      elements: rules.slice(0, 1200).join("\n")
    };
  }

  globalThis.EasyWebFastModeHandler = { buildCss, buildSelector, create };
})();
