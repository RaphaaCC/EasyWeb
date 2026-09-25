(() => {
  const MAPPING_CAPTURE_POLICY = Object.freeze({
    version: 5,
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

  function sanitizePath(pathname) {
    if (typeof pathname !== "string" || !pathname.startsWith("/")) {
      return "/";
    }
    const segments = pathname.split("/").map((segment) => {
      if (!segment || segment === ":id" || segment === ":private") return segment;
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch (error) {
        // Segmentos malformados permanecem codificados e são tratados pelas regras abaixo.
      }
      if (/^\d{4,}$/.test(decoded)) return ":id";
      if (/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(decoded)) return ":id";
      if (decoded.includes("@") || /^[a-f\d]{16,}$/i.test(decoded) || /^[a-z\d_-]{24,}$/i.test(decoded)) {
        return ":private";
      }
      return segment.slice(0, 120);
    });
    return segments.join("/").slice(0, 2048) || "/";
  }

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


  const SAFE_CSS_PROPERTIES = new Set([
    "color", "background-color",
    "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "outline-color", "text-decoration-color", "fill", "stroke",
    "font-size", "font-weight", "line-height", "letter-spacing", "word-spacing",
    "text-align", "text-decoration-line", "text-decoration-style", "text-decoration-thickness",
    "display", "visibility", "opacity", "position", "box-sizing", "white-space",
    "overflow", "overflow-x", "overflow-y", "object-fit",
    "width", "min-width", "max-width", "height", "min-height", "max-height",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "gap", "row-gap", "column-gap",
    "border-width", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "outline-width", "border-radius", "border-top-left-radius", "border-top-right-radius",
    "border-bottom-left-radius", "border-bottom-right-radius",
    "flex-direction", "flex-wrap", "align-items", "justify-content"
  ]);
  const COLOR_CSS_PROPERTIES = new Set([
    "color", "background-color",
    "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "outline-color", "text-decoration-color", "fill", "stroke"
  ]);
  const LENGTH_CSS_PROPERTIES = new Set([
    "font-size", "letter-spacing", "word-spacing", "text-decoration-thickness",
    "width", "min-width", "max-width", "height", "min-height", "max-height",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "gap", "row-gap", "column-gap",
    "border-width", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "outline-width", "border-radius", "border-top-left-radius", "border-top-right-radius",
    "border-bottom-left-radius", "border-bottom-right-radius"
  ]);
  const SAFE_CSS_ENUMS = Object.freeze({
    "text-align": new Set(["left", "right", "center", "justify", "start", "end"]),
    "text-decoration-line": new Set(["none", "underline", "overline", "line-through"]),
    "text-decoration-style": new Set(["solid", "double", "dotted", "dashed", "wavy"]),
    "display": new Set(["none", "block", "inline", "inline-block", "flex", "inline-flex", "grid", "inline-grid", "table", "contents"]),
    "visibility": new Set(["visible", "hidden", "collapse"]),
    "position": new Set(["static", "relative", "absolute", "fixed", "sticky"]),
    "box-sizing": new Set(["content-box", "border-box"]),
    "white-space": new Set(["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"]),
    "overflow": new Set(["visible", "hidden", "clip", "scroll", "auto"]),
    "overflow-x": new Set(["visible", "hidden", "clip", "scroll", "auto"]),
    "overflow-y": new Set(["visible", "hidden", "clip", "scroll", "auto"]),
    "object-fit": new Set(["fill", "contain", "cover", "none", "scale-down"]),
    "flex-direction": new Set(["row", "row-reverse", "column", "column-reverse"]),
    "flex-wrap": new Set(["nowrap", "wrap", "wrap-reverse"]),
    "align-items": new Set(["stretch", "flex-start", "flex-end", "center", "baseline", "start", "end"]),
    "justify-content": new Set(["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly", "start", "end"])
  });

  function normalizeCssScalar(value) {
    const token = value.trim().toLowerCase();
    return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|ch|ex|vw|vh|vmin|vmax|pt)?$/.test(token)
      ? token
      : null;
  }

  function normalizeCssLengthList(value) {
    const parts = value.trim().split(/\s+/);
    if (parts.length < 1 || parts.length > 4) return null;
    const normalized = parts.map((part) => normalizeCssScalar(part));
    return normalized.every(Boolean) ? normalized.join(" ") : null;
  }

  function normalizeCssColor(value) {
    const token = value.trim().toLowerCase();
    if (/^#[a-f\d]{3,8}$/i.test(token)) return token;
    if (/^rgba?\(\s*[-\d.%\s,\/]+\)$/i.test(token)) return token.replace(/\s+/g, " ");
    if (/^hsla?\(\s*[-\d.%\s,\/]+\)$/i.test(token)) return token.replace(/\s+/g, " ");
    return new Set(["transparent", "currentcolor", "black", "white", "gray", "grey", "red", "green", "blue"]).has(token)
      ? token
      : null;
  }

  function normalizeCssDeclaration(property, rawValue) {
    const name = property.trim().toLowerCase();
    if (!SAFE_CSS_PROPERTIES.has(name)) return null;
    const value = rawValue.replace(/\s*!important\s*$/i, "").trim();
    if (!value || value.length > 160 ||
      /["'\\]/.test(value) || /\b(?:url|var|attr|env|expression)\s*\(/i.test(value) ||
      /javascript\s*:|@/i.test(value)) {
      return null;
    }

    if (COLOR_CSS_PROPERTIES.has(name)) {
      const normalized = normalizeCssColor(value);
      return normalized ? [name, normalized] : null;
    }
    if (LENGTH_CSS_PROPERTIES.has(name)) {
      const normalized = normalizeCssLengthList(value);
      return normalized ? [name, normalized] : null;
    }
    if (name === "line-height") {
      const normalized = normalizeCssScalar(value);
      return normalized ? [name, normalized] : null;
    }
    if (name === "font-weight") {
      const token = value.toLowerCase();
      return /^(?:normal|bold|bolder|lighter|[1-9]00)$/.test(token) ? [name, token] : null;
    }
    if (name === "opacity") {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1 ? [name, String(numeric)] : null;
    }
    const allowed = SAFE_CSS_ENUMS[name];
    const token = value.toLowerCase();
    return allowed?.has(token) ? [name, token] : null;
  }

  function extractCssLeafBlocks(source) {
    const blocks = [];
    const stack = [];
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (character === "{") {
        if (stack.length) stack[stack.length - 1].nested = true;
        stack.push({ start: index + 1, nested: false });
      } else if (character === "}" && stack.length) {
        const block = stack.pop();
        if (!block.nested) blocks.push(source.slice(block.start, index));
      }
    }
    return blocks;
  }

  function structuralizeCss(cssText) {
    const source = typeof cssText === "string" ? cssText : "";
    const blocks = extractCssLeafBlocks(source.replace(/\/\*[\s\S]*?\*\//g, ""));
    const result = [];
    for (const block of blocks) {
      const declarations = [];
      for (const part of block.split(";")) {
        const separator = part.indexOf(":");
        if (separator <= 0) continue;
        const normalized = normalizeCssDeclaration(part.slice(0, separator), part.slice(separator + 1));
        if (normalized) declarations.push(normalized[0] + ":" + normalized[1]);
      }
      if (declarations.length) result.push("style{" + declarations.join(";") + "}");
    }
    return result.join("\n").slice(0, MAX_CSS_CHARACTERS);
  }

  function sanitizeCss(cssText) {
    return structuralizeCss(cssText);
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
        path: sanitizePath(locationLike.pathname)
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

  globalThis.EasyWebMappingSecurityHandler = { MAPPING_CAPTURE_POLICY, assess, createSnapshot, sanitizePath, sanitizeCss };
})();
