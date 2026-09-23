(() => {
  function create() {
    const highlightedElements = new Set();

    function isVisible(element) {
      const styles = getComputedStyle(element);
      return styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        Number.parseFloat(styles.opacity) !== 0;
    }

    function clear() {
      for (const element of highlightedElements) {
        if (element.isConnected) {
          element.removeAttribute("data-easyweb-link");
        }
      }
      highlightedElements.clear();
    }

    function apply(active) {
      clear();
      if (!active) {
        return;
      }

      for (const element of document.querySelectorAll("a[href]")) {
        if (element.textContent.trim() && isVisible(element)) {
          element.setAttribute("data-easyweb-link", "true");
          highlightedElements.add(element);
        }
      }
    }

    return { apply };
  }

  globalThis.EasyWebLinkHandler = { create };
})();
