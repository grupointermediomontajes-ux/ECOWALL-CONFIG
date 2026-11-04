/* ECOWALL · puente con la app de escritorio (Tauri)
 *  - proyectos guardados como archivos .ecowall en la carpeta elegida (servidor)
 *  - los proyectos de la carpeta aparecen en todos los equipos
 *  - precios.xlsx se relee de esa carpeta al abrir el Listado
 *  - impresión del informe (en macOS window.print() no funciona dentro de Tauri)
 * En el navegador normal todo esto se degrada a lo que hacía la versión HTML. */
(function () {
  'use strict';
  const T = window.__TAURI__;
  const invoke = T && T.core ? T.core.invoke : null;
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  const toast = (m, t) => (typeof window.showProjectToast === 'function' ? window.showProjectToast(m, t) : console.log(m));
  const errText = e => (e && e.message) ? e.message : String(e);

  // ---------- impresión ----------
  window.ecowallPrint = function () {
    if (invoke && isMac) invoke('print_page').catch(e => { console.warn(e); window.print(); });
    else window.print();
  };

  // ---------- Listado: relee precios.xlsx para que los cambios se apliquen sin reiniciar ----------
  window.ecowallOpenInventory = async function () {
    if (invoke) {
      const r = await window.PRICING.load();
      if (!r.ok) toast('No se pudo releer precios.xlsx de la carpeta de proyectos; se usan los últimos precios cargados.', 'error');
    }
    window.openInventoryModal();
  };

  // ---------- carpeta de proyectos ----------
  // Botón de carpeta arriba a la derecha de la primera pantalla (antes de empezar un proyecto). Las carpetas
  // usadas se recuerdan en este equipo, para volver con un clic (p. ej. a la del servidor al recuperar la
  // conexión) sin buscarla otra vez en el selector.
  const folderWrap = document.getElementById('folder-menu-wrap');
  if (!invoke) {                                      // en el navegador no hay carpeta que elegir
    if (folderWrap) folderWrap.remove();
    window.ecowallSyncProjects = async function () {};
    return;
  }

  const RECENT_KEY = 'ecowall_recent_folders_v1';
  const readRecent = () => { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const rememberFolder = path => {
    if (!path) return;
    const list = [path].concat(readRecent().filter(p => p !== path)).slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* sin almacenamiento */ }
  };
  let currentFolder = null;

  // Tras cambiar de carpeta: comprueba que tenga precios.xlsx (si no, pide reintentar u otra), relee precios y proyectos.
  async function afterFolderChange() {
    await window.ECOWALL_SETUP.run();
    try { const st = await invoke('check_setup'); if (st && st.path) currentFolder = st.path; } catch (e) { /* se queda la anterior */ }
    rememberFolder(currentFolder);
    const b = document.getElementById('btn-folder-menu');
    if (b) b.title = 'Carpeta de proyectos: ' + (currentFolder || 'sin elegir');
    const r = await window.PRICING.load();
    await window.ecowallSyncProjects();
    toast('Carpeta de proyectos: ' + currentFolder + (r.ok ? '' : ' (no se pudieron leer los precios)'), r.ok ? 'success' : 'error');
  }
  async function chooseFolder() {
    try {
      const chosen = await invoke('choose_folder');   // selector del sistema; null = cancelado
      if (chosen) await afterFolderChange();
    } catch (e) { toast('No se pudo cambiar la carpeta: ' + errText(e), 'error'); }
  }
  async function useFolder(path) {
    try {
      await invoke('use_folder', { path });
      await afterFolderChange();
    } catch (e) { toast('No se puede usar esa carpeta (¿sin conexión con el servidor?): ' + errText(e), 'error'); }
  }
  // Menú: carpeta actual, recientes y «Elegir otra carpeta…».
  if (folderWrap) {
    const btn = document.getElementById('btn-folder-menu');
    const menu = document.getElementById('folder-menu');
    const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const close = () => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
    const render = async () => {
      let state = null;
      try { state = await invoke('check_setup'); } catch (e) { /* se muestra sin estado */ }
      if (state && state.path) currentFolder = state.path;
      const ok = state && state.state === 'ok';
      const status = !state || !state.path ? 'Sin carpeta' : ok ? 'Conectada' : state.state === 'no_prices' ? 'Falta precios.xlsx' : 'No disponible';
      const recent = readRecent().filter(p => p !== currentFolder);
      menu.innerHTML =
        `<div class="flex items-center justify-between mb-1"><span class="font-bold uppercase tracking-wider text-[10px] text-slate-400">Carpeta de proyectos</span>` +
        `<span class="text-[10px] font-semibold ${ok ? 'text-emerald-400' : 'text-rose-400'}">${status}</span></div>` +
        `<div class="font-mono text-[11px] text-amber-300 break-all mb-3">${esc(currentFolder || '—')}</div>` +
        (recent.length ? `<div class="font-bold uppercase tracking-wider text-[10px] text-slate-400 mb-1">Usadas recientemente</div>` +
          recent.map((p, i) => `<button type="button" data-recent="${i}" title="Usar esta carpeta" class="w-full text-left font-mono text-[11px] text-slate-200 hover:bg-slate-800 rounded-lg px-2 py-1.5 break-all flex gap-2 items-start"><i class="fa-solid fa-folder mt-0.5 text-slate-500"></i><span>${esc(p)}</span></button>`).join('') : '') +
        `<button type="button" data-choose class="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg py-2 flex items-center justify-center gap-2"><i class="fa-solid fa-folder-tree"></i> Elegir otra carpeta…</button>`;
      menu.querySelectorAll('[data-recent]').forEach(b => b.addEventListener('click', () => { close(); useFolder(recent[Number(b.dataset.recent)]); }));
      menu.querySelector('[data-choose]').addEventListener('click', () => { close(); chooseFolder(); });
      btn.title = 'Carpeta de proyectos: ' + (currentFolder || 'sin elegir');
    };
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!menu.classList.contains('hidden')) { close(); return; }
      await render();
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('click', e => { if (!folderWrap.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }
  // La carpeta con la que arranca la app también cuenta como reciente.
  invoke('check_setup').then(st => {
    if (st && st.path) { currentFolder = st.path; if (st.state === 'ok') rememberFolder(st.path); }
    const b = document.getElementById('btn-folder-menu');
    if (b) b.title = 'Carpeta de proyectos: ' + (currentFolder || 'sin elegir');
  }).catch(() => {});

  // ---------- proyectos de la carpeta -> lista de proyectos de este equipo ----------
  window.ecowallSyncProjects = async function () {
    try {
      const files = await invoke('list_projects');
      const all = getSavedProjects() || {};
      for (const f of files) {
        try {
          const saved = JSON.parse(f.json);
          if (!saved || !saved.project || !Array.isArray(saved.pieces)) continue;
          const key = normalizeProjectName(saved.project.name || f.name);
          if (!key) continue;
          const cur = all[key];
          if (!cur || String(saved.savedAt || '') >= String(cur.savedAt || '')) all[key] = saved;
        } catch (e) { /* archivo .json que no es un proyecto */ }
      }
      writeSavedProjects(all);
    } catch (e) { console.warn('No se pudieron leer los proyectos de la carpeta:', e); }
  };

  const origSave = window.saveCurrentProject;
  const origLoad = window.loadSavedProject;
  const origDelete = window.confirmDeleteSavedProject;

  window.saveCurrentProject = async function () {
    // Primero se traen los proyectos de la carpeta, para saber si el nombre ya existe (en cualquier equipo).
    try { await window.ecowallSyncProjects(); } catch (e) { /* sin carpeta: se guarda en local */ }
    const name = await origSave();               // pregunta sobrescribir / nueva versión; copia local
    if (!name) return;                           // cancelado
    try {
      await invoke('save_project', { name, json: JSON.stringify(getCurrentProjectSnapshot()) });
    } catch (e) {
      toast('No se pudo guardar en la carpeta de proyectos (¿servidor desconectado?). Solo queda guardado en este equipo. ' + errText(e), 'error');
    }
  };

  window.loadSavedProject = async function () {
    const input = document.getElementById('setup-name');
    const name = String(input && input.value || '').trim();
    if (name) {
      try {                                       // versión más reciente de la carpeta
        const json = await invoke('load_project', { name });
        if (json) {
          const saved = JSON.parse(json);
          const all = getSavedProjects() || {};
          all[normalizeProjectName(name)] = saved;
          writeSavedProjects(all);
        }
      } catch (e) { console.warn('No se pudo leer el proyecto de la carpeta:', e); }
    }
    origLoad();
  };

  window.confirmDeleteSavedProject = async function () {
    try { await invoke('delete_project', { name: String(project.name || '').trim() }); }
    catch (e) { toast('No se pudo borrar el archivo del proyecto en la carpeta: ' + errText(e), 'error'); }
    origDelete();
  };
})();
