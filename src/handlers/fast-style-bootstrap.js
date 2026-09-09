(() => {
  const CACHE_VERSION = 2;
  const STYLE_ID = "easyweb-fast-style-cache";
  const cacheKey = `easyweb:fast-style:${location.pathname}${location.search}`;

  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey));
    if (cached?.version !== CACHE_VERSION || !cached?.settings?.fastMode || !cached?.css?.base) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = cached.css.base;
    (document.head || document.documentElement).appendChild(style);
    document.documentElement.classList.add("easyweb-fast-cache");
  } catch (error) {
    // Sem cache de sessao, a extensao segue pelo caminho normal.
  }
})();
