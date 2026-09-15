(() => {
  const storageKey = "volta-info-theme";
  const allowed = new Set(["system", "light", "dark"]);
  const readTheme = () => {
    try {
      const value = localStorage.getItem(storageKey);
      return allowed.has(value) ? value : "system";
    } catch {
      return "system";
    }
  };
  const applyTheme = (theme) => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta instanceof HTMLMetaElement) {
      const dark = theme === "dark" ||
        (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      meta.content = dark ? "#000000" : "#ffffff";
    }
  };
  let focusTimer;
  const highlightHashTarget = () => {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    if (!id) return;
    const target = document.getElementById(id);
    if (!(target instanceof HTMLElement) || !target.hasAttribute("data-highlight")) return;
    target.classList.remove("info-focus-target");
    void target.offsetWidth;
    target.classList.add("info-focus-target");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => target.classList.remove("info-focus-target"), 5000);
  };
  const theme = readTheme();
  applyTheme(theme);
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  colorScheme.addEventListener?.("change", () => {
    if (readTheme() === "system") applyTheme("system");
  });
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.querySelector("[data-theme-select]");
    if (!(select instanceof HTMLSelectElement)) return;
    select.value = theme;
    select.addEventListener("change", () => {
      const next = allowed.has(select.value) ? select.value : "system";
      applyTheme(next);
      try { localStorage.setItem(storageKey, next); } catch { /* Storage may be disabled. */ }
    });
    highlightHashTarget();
  });
  window.addEventListener("hashchange", highlightHashTarget);
})();
