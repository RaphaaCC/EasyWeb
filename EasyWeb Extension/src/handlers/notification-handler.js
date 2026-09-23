(() => {
  const SESSION_KEY = "easyweb:activation-notice-shown";

  function wasShown() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === "shown";
    } catch (error) {
      return false;
    }
  }

  function markAsShown() {
    try {
      sessionStorage.setItem(SESSION_KEY, "shown");
    } catch (error) {
      // A indisponibilidade do sessionStorage não impede o uso da extensão.
    }
  }

  function show() {
    document.querySelector("#easyweb-activation-notice")?.remove();

    const notice = document.createElement("div");
    notice.id = "easyweb-activation-notice";
    notice.className = "easyweb-activation-notice";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.textContent = "EasyWeb entrou em ação e aplicou sua acessibilidade.";
    document.body.appendChild(notice);
    window.setTimeout(() => notice.remove(), 3000);
  }

  function showOnce() {
    if (!wasShown()) {
      show();
      markAsShown();
    }
  }

  globalThis.EasyWebNotificationHandler = { showOnce };
})();
