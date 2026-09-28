(() => {
  function create() {
    let host;
    let band;
    let frame = 0;
    let position = window.innerHeight / 2;

    function render() {
      frame = 0;
      if (!host) return;
      const height = Math.min(160, window.innerHeight);
      const top = Math.max(0, Math.min(window.innerHeight - height, position - height / 2));
      band.style.top = `${top}px`;
      band.style.height = `${height}px`;
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(render);
    }

    function followPointer(event) {
      if (event.pointerType === "touch") return;
      position = event.clientY;
      schedule();
    }

    function followFocus(event) {
      const bounds = event.target.getBoundingClientRect?.();
      if (!bounds) return;
      position = bounds.top + bounds.height / 2;
      schedule();
    }

    function apply(enabled) {
      if (!enabled) {
        window.cancelAnimationFrame(frame);
        frame = 0;
        document.removeEventListener("pointermove", followPointer);
        document.removeEventListener("focusin", followFocus);
        window.removeEventListener("resize", schedule);
        host?.remove();
        host = band = undefined;
        return;
      }
      if (host?.isConnected) return;
      host = document.createElement("div");
      host.id = "easyweb-reading-guide";
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;display:block!important;";
      const shadow = host.attachShadow({ mode: "closed" });
      band = document.createElement("div");
      // A transparent band preserves original colors; only its surroundings dim.
      band.style.cssText = "position:absolute;left:0;right:0;pointer-events:none;box-shadow:0 0 0 100vmax rgba(0,0,0,.22);";
      shadow.append(band);
      document.documentElement.append(host);
      position = window.innerHeight / 2;
      render();
      document.addEventListener("pointermove", followPointer, { passive: true });
      document.addEventListener("focusin", followFocus);
      window.addEventListener("resize", schedule, { passive: true });
    }

    return { apply };
  }

  globalThis.EasyWebReadingFocusHandler = { create };
})();
