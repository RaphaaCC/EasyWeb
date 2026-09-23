(() => {
  const FILTERS = Object.freeze({
    protanopia: "0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0",
    protanomaly: "0.817 0.183 0 0 0  0.333 0.667 0 0 0  0 0.125 0.875 0 0  0 0 0 1 0",
    deuteranopia: "0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0",
    deuteranomaly: "0.8 0.2 0 0 0  0.258 0.742 0 0 0  0 0.142 0.858 0 0  0 0 0 1 0",
    tritanopia: "0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0",
    tritanomaly: "0.967 0.033 0 0 0  0 0.733 0.267 0 0  0 0.183 0.817 0 0  0 0 0 1 0",
    achromatopsia: "0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0",
    achromatomaly: "0.618 0.32 0.062 0 0  0.163 0.775 0.062 0 0  0.163 0.32 0.516 0 0  0 0 0 1 0",
    "blue-cone-monochromacy": "0.01775 0.10945 0.8728 0 0  0.01775 0.10945 0.8728 0 0  0.01775 0.10945 0.8728 0 0  0 0 0 1 0"
  });

  function create() {
    let definitions;

    function ensureDefinitions() {
      if (definitions?.isConnected) {
        return;
      }

      definitions = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      definitions.id = "easyweb-color-filter-definitions";
      definitions.setAttribute("aria-hidden", "true");
      definitions.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";

      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      for (const [name, matrix] of Object.entries(FILTERS)) {
        const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
        filter.id = `easyweb-color-filter-${name}`;
        const colorMatrix = document.createElementNS("http://www.w3.org/2000/svg", "feColorMatrix");
        colorMatrix.setAttribute("type", "matrix");
        colorMatrix.setAttribute("values", matrix);
        filter.appendChild(colorMatrix);
        defs.appendChild(filter);
      }
      definitions.appendChild(defs);
      document.documentElement.appendChild(definitions);
    }

    function apply(filterName, enabled) {
      const root = document.documentElement;
      for (const name of Object.keys(FILTERS)) {
        root.classList.remove(`easyweb-color-filter-${name}`);
      }

      if (enabled && FILTERS[filterName]) {
        ensureDefinitions();
        root.classList.add(`easyweb-color-filter-${filterName}`);
      }
    }

    return { apply };
  }

  globalThis.EasyWebColorFilterHandler = { create };
})();
