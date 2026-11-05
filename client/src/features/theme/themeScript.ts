// Corre antes del primer pintado para que la página nunca aparezca con el tema equivocado.
// Lee la misma clave y forma que guarda el persist de zustand en store.ts.
export const THEME_SCRIPT = `(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('date2gether:theme') || 'null');
    var theme = saved && saved.state && saved.state.theme;
    if (theme !== 'light' && theme !== 'dark') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();`;
