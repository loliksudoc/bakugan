'use strict';

/* Точка входа: справочник → сессия → лобби или экран входа */
(async function boot() {
  try {
    await loadCatalog();
  } catch (e) {
    document.body.insertAdjacentHTML('afterbegin',
      `<div class="fatal"><b>Нет связи с сервером.</b><br>
       Запустите <code>python server.py</code> в папке игры и откройте
       <code>http://localhost:8123</code><br><small>${e.message}</small></div>`);
    return;
  }
  bindAccountUI();
  renderLegends();
  try {
    applyProfile(await API.get('/api/me'));
    openLobby();
  } catch (e) {
    showAuth();
  }
})();
