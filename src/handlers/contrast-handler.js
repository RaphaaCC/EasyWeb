(() => {
  function create(getTextElements) {
    const adjustedElements = new Set();
    const adjustedControls = new Set();

    function isVisible(element) {
      const styles = getComputedStyle(element);
      return styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        Number.parseFloat(styles.opacity) !== 0;
    }

    function parseColor(value) {
      const match = value.match(/^rgba?\((.+)\)$/);
      if (!match) {
        return null;
      }

      const rawChannels = match[1].trim();
      const channels = rawChannels.includes(",")
        ? rawChannels.split(",").map((channel) => channel.trim())
        : rawChannels.replace("/", " / ").split(/\s+/);
      const separatorIndex = channels.indexOf("/");
      const alphaValue = separatorIndex === -1 ? channels[3] : channels[separatorIndex + 1];
      const colorChannels = separatorIndex === -1
        ? channels.slice(0, 3)
        : channels.slice(0, separatorIndex);

      function parseChannel(channel) {
        return channel.endsWith("%")
          ? Number(channel.slice(0, -1)) * 2.55
          : Number(channel);
      }

      function parseAlpha(alpha) {
        return alpha?.endsWith("%") ? Number(alpha.slice(0, -1)) / 100 : Number(alpha ?? 1);
      }

      if (colorChannels.length < 3) {
        return null;
      }

      const values = colorChannels.map(parseChannel);
      const alpha = parseAlpha(alphaValue);
      if (values.some((channel) => !Number.isFinite(channel)) || !Number.isFinite(alpha)) {
        return null;
      }

      return { r: values[0], g: values[1], b: values[2], a: alpha };
    }

    function getEffectiveBackground(element) {
      for (let current = element; current; current = current.parentElement) {
        const styles = getComputedStyle(current);
        if (styles.backgroundImage !== "none") {
          return null;
        }

        const color = parseColor(styles.backgroundColor);
        if (color?.a >= 0.99) {
          return color;
        }
        if (color && color.a > 0) {
          return null;
        }
      }

      return { r: 255, g: 255, b: 255, a: 1 };
    }

    function channelToLinear(channel) {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    }

    function luminance(color) {
      return 0.2126 * channelToLinear(color.r) +
        0.7152 * channelToLinear(color.g) +
        0.0722 * channelToLinear(color.b);
    }

    function contrastRatio(first, second) {
      const brightest = Math.max(luminance(first), luminance(second));
      const darkest = Math.min(luminance(first), luminance(second));
      return (brightest + 0.05) / (darkest + 0.05);
    }

    function blendWithBackground(foreground, background) {
      const alpha = foreground.a;
      return {
        r: foreground.r * alpha + background.r * (1 - alpha),
        g: foreground.g * alpha + background.g * (1 - alpha),
        b: foreground.b * alpha + background.b * (1 - alpha),
        a: 1
      };
    }

    function isLargeText(element, fontSize) {
      const rawWeight = getComputedStyle(element).fontWeight;
      const numericWeight = Number.parseInt(rawWeight, 10);
      const weight = Number.isFinite(numericWeight)
        ? numericWeight
        : ["bold", "bolder"].includes(rawWeight) ? 700 : 400;
      return fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    }

    function chooseColor(element, forceHighContrast) {
      const styles = getComputedStyle(element);
      const parsedForeground = parseColor(styles.color);
      const background = getEffectiveBackground(element);
      const fontSize = Number.parseFloat(styles.fontSize);

      if (!parsedForeground || !background || !Number.isFinite(fontSize)) {
        return null;
      }

      const elementOpacity = Number.parseFloat(styles.opacity);
      const foreground = blendWithBackground(
        { ...parsedForeground, a: parsedForeground.a * (Number.isFinite(elementOpacity) ? elementOpacity : 1) },
        background
      );
      const minimumRatio = isLargeText(element, fontSize) ? 3 : 4.5;
      const currentRatio = contrastRatio(foreground, background);
      if (!forceHighContrast && currentRatio >= minimumRatio) {
        return null;
      }

      const candidates = [
        { name: "dark", color: { r: 0, g: 0, b: 0, a: 1 } },
        { name: "light", color: { r: 255, g: 255, b: 255, a: 1 } }
      ];
      candidates.sort((first, second) =>
        contrastRatio(second.color, background) - contrastRatio(first.color, background)
      );

      const best = candidates[0];
      return contrastRatio(best.color, background) > currentRatio ? best.name : null;
    }

    function clear() {
      for (const element of adjustedElements) {
        if (element.isConnected) {
          element.removeAttribute("data-easyweb-contrast");
        }
      }
      adjustedElements.clear();

      for (const element of adjustedControls) {
        if (element.isConnected) {
          element.removeAttribute("data-easyweb-control-contrast");
          element.removeAttribute("data-easyweb-control-outline");
        }
      }
      adjustedControls.clear();
    }

    function apply(active) {
      clear();
      if (!active) {
        return;
      }

      for (const element of getTextElements()) {
        const adjustment = chooseColor(element, true);
        if (adjustment) {
          element.setAttribute("data-easyweb-contrast", adjustment);
          adjustedElements.add(element);
        }
      }

      for (const element of document.querySelectorAll(
        "button, input[type=button], input[type=submit], input[type=reset], select, textarea, [role=button]"
      )) {
        if (!isVisible(element)) {
          continue;
        }

        const background = getEffectiveBackground(element);
        if (!background) {
          continue;
        }

        const candidates = [
          { name: "dark", color: { r: 0, g: 0, b: 0, a: 1 } },
          { name: "light", color: { r: 255, g: 255, b: 255, a: 1 } }
        ];
        candidates.sort((first, second) =>
          contrastRatio(second.color, background) - contrastRatio(first.color, background)
        );

        const adjustment = candidates[0].name;
        const styles = getComputedStyle(element);
        const hasVisibleBorder = styles.borderStyle !== "none" &&
          Number.parseFloat(styles.borderTopWidth) > 0;

        element.setAttribute("data-easyweb-control-contrast", adjustment);
        if (!hasVisibleBorder) {
          element.setAttribute("data-easyweb-control-outline", adjustment);
        }
        adjustedControls.add(element);
      }
    }

    function getCachedCssRules() {
      const prefix = "html.easyweb-fast-cache";
      const rules = [];

      for (const element of adjustedElements) {
        const selector = EasyWebFastModeHandler.buildSelector(element);
        const contrast = element.getAttribute("data-easyweb-contrast");
        if (selector && contrast) {
          rules.push(`${prefix} ${selector}{color:${contrast === "dark" ? "#000" : "#fff"}!important;}`);
        }
      }

      for (const element of adjustedControls) {
        const selector = EasyWebFastModeHandler.buildSelector(element);
        const contrast = element.getAttribute("data-easyweb-control-contrast");
        const outline = element.getAttribute("data-easyweb-control-outline");
        if (!selector || !contrast) {
          continue;
        }

        const color = contrast === "dark" ? "#000" : "#fff";
        rules.push(`${prefix} ${selector}{border-color:${color}!important;color:${color}!important;}`);
        rules.push(`${prefix} ${selector}::placeholder{color:${color}!important;opacity:1!important;}`);
        if (outline) {
          rules.push(`${prefix} ${selector}{outline:2px solid ${color}!important;outline-offset:-2px!important;}`);
        }
      }

      return rules;
    }

    return { apply, getCachedCssRules };
  }

  globalThis.EasyWebContrastHandler = { create };
})();
