(() => {
  const MAPPING_CAPTURE_POLICY = Object.freeze({
    version: 3,
    allowedData: Object.freeze([
      "sanitized-structural-html",
      "sanitized-accessible-css",
      "script-and-stylesheet-metadata"
    ]),
    blockedData: Object.freeze([
      "cookies",
      "request-and-response-bodies",
      "form-values",
      "passwords",
      "text-content",
      "html-attributes",
      "full-asset-urls",
      "script-bodies",
      "local-storage",
      "session-storage",
      "authorization-headers"
    ])
  });
  const MAX_TREE_NODES = 1_500;
  const MAX_HTML_CHARACTERS = 180_000;
  const MAX_CSS_CHARACTERS = 160_000;
  const MAX_TREE_DEPTH = 12;
  const MAX_CHILDREN_PER_NODE = 40;
  const MAX_EXTERNAL_ORIGINS = 20;
  const ALLOWED_ROLES = new Set([
    "alert", "button", "checkbox", "complementary", "contentinfo", "dialog", "form", "heading",
    "link", "main", "menu", "menuitem", "navigation", "region", "search", "status", "tab", "tabpanel"
  ]);
  const INTERACTIVE_TAGS = new Set(["a", "button", "details", "input", "select", "summary", "textarea"]);
  const LANDMARK_TAGS = new Set(["aside", "footer", "form", "header", "main", "nav", "search"]);
  const REMOVED_HTML_TAGS = new Set(["embed", "iframe", "noscript", "object", "script", "style", "template"]);
  const ALLOWED_HTML_ATTRIBUTES = new Set([
    "autoplay", "checked", "colspan", "controls", "defer", "disabled", "hidden", "loop", "multiple",
    "muted", "open", "playsinline", "required", "role", "rowspan", "scope", "selected", "type"
  ]);
  const SENSITIVE_INPUT_SELECTOR = [
    "input[type=password]",
    "input[autocomplete=current-password]",
    "input[autocomplete=new-password]",
    "input[name*=card i]",
    "input[name*=cvv i]",
    "input[name*=cvc i]",
    "input[autocomplete*=cc-]"
  ].join(", ");
  const SENSITIVE_FORM_SELECTOR = [
    "form[action*=login i]",
    "form[action*=signin i]",
    "form[action*=checkout i]",
    "form[action*=payment i]"
  ].join(", ");
  const SENSITIVE_ELEMENT_SELECTOR = `${SENSITIVE_INPUT_SELECTOR}, ${SENSITIVE_FORM_SELECTOR}`;

  function hasSensitiveForm(documentLike) {
    return Boolean(documentLike.querySelector(SENSITIVE_ELEMENT_SELECTOR));
  }

  function isSensitiveElement(element) {
    return element.matches(SENSITIVE_INPUT_SELECTOR) || Boolean(element.closest(SENSITIVE_FORM_SELECTOR));
  }

  function assess(documentLike, locationLike) {
    if (!/^https?:$/.test(locationLike.protocol)) {
      return {
        safeToMap: false,
        reason: "O mapeamento só pode ser usado em páginas HTTP ou HTTPS."
      };
    }

    if (hasSensitiveForm(documentLike)) {
      return {
        safeToMap: true,
        reason: "Campos de acesso ou pagamento serão removidos antes do snapshot."
      };
    }

    return {
      safeToMap: true,
      reason: "O site pode ser autorizado para o mapeamento estrutural protegido."
    };
  }

  function safeOrigin(value, baseUrl) {
    try {
      const url = new URL(value, baseUrl);
      return /^https?:$/.test(url.protocol) ? url.origin : null;
    } catch (error) {
      return null;
    }
  }

  function collectOrigins(elements, propertyName, baseUrl) {
    const origins = new Set();
    let externalCount = 0;
    for (const element of elements) {
      const source = element[propertyName];
      if (!source) {
        continue;
      }
      externalCount += 1;
      const origin = safeOrigin(source, baseUrl);
      if (origin && origins.size < MAX_EXTERNAL_ORIGINS) {
        origins.add(origin);
      }
    }
    return { externalCount, origins: [...origins] };
  }

  function buildStructureTree(element, state, depth = 0) {
    if (!element || isSensitiveElement(element) || state.nodeCount >= MAX_TREE_NODES || depth > MAX_TREE_DEPTH) {
      state.truncated = true;
      return null;
    }

    state.nodeCount += 1;
    const tag = element.localName?.toLowerCase() || "unknown";
    const role = element.getAttribute("role")?.toLowerCase();
    const node = { tag };
    if (ALLOWED_ROLES.has(role)) {
      node.role = role;
    }
    if (LANDMARK_TAGS.has(tag) || node.role === "main" || node.role === "navigation") {
      node.landmark = true;
    }
    if (INTERACTIVE_TAGS.has(tag) || node.role === "button" || node.role === "link") {
      node.interactive = true;
    }
    if (/^h[1-6]$/.test(tag)) {
      node.headingLevel = Number(tag[1]);
    }

    const children = [];
    for (const child of [...element.children].slice(0, MAX_CHILDREN_PER_NODE)) {
      const childNode = buildStructureTree(child, state, depth + 1);
      if (childNode) {
        children.push(childNode);
      }
    }
    if (element.children.length > MAX_CHILDREN_PER_NODE) {
      state.truncated = true;
    }
    if (children.length > 0) {
      node.children = children;
    }
    return node;
  }

  function collectStyleTokens(documentLike, locationLike) {
    const roots = [documentLike.documentElement, documentLike.body].filter(Boolean);
    const computed = roots.map((element) => getComputedStyle(element));
    const styleOrigins = collectOrigins(documentLike.querySelectorAll("link[rel~=stylesheet]"), "href", locationLike.href);
    return {
      styleSheetCount: documentLike.styleSheets.length,
      inlineStyleCount: documentLike.querySelectorAll("style").length,
      externalStyleSheetCount: styleOrigins.externalCount,
      externalOrigins: styleOrigins.origins,
      colors: [...new Set(computed.flatMap((style) => [style.color, style.backgroundColor]))].filter(Boolean).slice(0, 8),
      fontFamilies: [...new Set(computed.map((style) => style.fontFamily).filter(Boolean))].slice(0, 4),
      fontSizes: [...new Set(computed.map((style) => style.fontSize).filter(Boolean))].slice(0, 4),
      lineHeights: [...new Set(computed.map((style) => style.lineHeight).filter(Boolean))].slice(0, 4)
    };
  }

  function collectScriptMetadata(documentLike, locationLike) {
    const scripts = [...documentLike.scripts];
    const externalScripts = scripts.filter((script) => Boolean(script.src));
    const origins = collectOrigins(externalScripts, "src", locationLike.href);
    return {
      total: scripts.length,
      inlineCount: scripts.length - externalScripts.length,
      externalCount: origins.externalCount,
      moduleCount: scripts.filter((script) => script.type === "module").length,
      asyncCount: scripts.filter((script) => script.async).length,
      deferCount: scripts.filter((script) => script.defer).length,
      externalOrigins: origins.origins
    };
  }

  function createStructuralHtml(documentLike) {
    const clone = documentLike.documentElement.cloneNode(true);
    for (const element of clone.querySelectorAll(SENSITIVE_ELEMENT_SELECTOR)) {
      element.remove();
    }
    const elements = [clone, ...clone.querySelectorAll("*")];
    for (const element of elements) {
      if (REMOVED_HTML_TAGS.has(element.localName)) {
        element.remove();
        continue;
      }
      for (const attribute of [...element.attributes]) {
        if (!ALLOWED_HTML_ATTRIBUTES.has(attribute.name.toLowerCase())) {
          element.removeAttribute(attribute.name);
        }
      }
    }

    const walker = documentLike.createTreeWalker(clone, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
    const nodesToRemove = [];
    while (walker.nextNode()) {
      nodesToRemove.push(walker.currentNode);
    }
    for (const node of nodesToRemove) {
      node.remove();
    }

    return clone.outerHTML.slice(0, MAX_HTML_CHARACTERS);
  }

  function sanitizeCss(cssText) {
    return cssText
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@import[^;]*;/gi, "")
      .replace(/@font-face\s*\{[^}]*\}/gi, "")
      .replace(/url\(\s*[^)]*\)/gi, "url()")
      .replace(/\bcontent\s*:\s*[^;}]+[;}]/gi, "")
      .replace(/\b(?:behavior|expression)\s*:[^;}]+[;}]/gi, "")
      .replace(/javascript\s*:/gi, "")
      .trim();
  }

  function createSanitizedCss(documentLike) {
    const rules = [];
    let characterCount = 0;
    for (const styleSheet of documentLike.styleSheets) {
      try {
        for (const rule of styleSheet.cssRules) {
          const sanitizedRule = sanitizeCss(rule.cssText);
          if (!sanitizedRule || characterCount + sanitizedRule.length > MAX_CSS_CHARACTERS) {
            continue;
          }
          rules.push(sanitizedRule);
          characterCount += sanitizedRule.length;
        }
      } catch (error) {
        // Folhas sem acesso via CSSOM (normalmente de outra origem) não são lidas.
      }
    }
    return rules.join("\n");
  }

  function createSnapshot(documentLike, locationLike) {
    const safety = assess(documentLike, locationLike);
    if (!safety.safeToMap) {
      return null;
    }

    const state = { nodeCount: 0, truncated: false };
    const tree = buildStructureTree(documentLike.documentElement, state);
    return {
      captureVersion: 1,
      page: {
        origin: locationLike.origin,
        path: locationLike.pathname
      },
      structure: {
        nodeCount: state.nodeCount,
        truncated: state.truncated,
        tree
      },
      html: createStructuralHtml(documentLike),
      css: createSanitizedCss(documentLike),
      styles: collectStyleTokens(documentLike, locationLike),
      scripts: collectScriptMetadata(documentLike, locationLike)
    };
  }

  globalThis.EasyWebMappingSecurityHandler = { MAPPING_CAPTURE_POLICY, assess, createSnapshot };
})();
