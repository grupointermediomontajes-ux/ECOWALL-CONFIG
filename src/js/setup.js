/* ECOWALL · selección de la carpeta de proyectos (solo app de escritorio)
 * - La primera vez pide una carpeta (normalmente en el servidor). Esa carpeta contiene
 *   los proyectos (.json) y el archivo precios.xlsx.
 * - Se recuerda: no se vuelve a pedir salvo que no se encuentre la carpeta
 *   (p. ej. servidor desconectado) o falte precios.xlsx dentro. */
(function () {
  'use strict';
  const T = window.__TAURI__;
  const invoke = T && T.core ? T.core.invoke : null;

  const TEXTS = {
    no_folder: {
      title: 'Selecciona la carpeta de proyectos',
      body: 'Elige la carpeta donde se guardarán los proyectos. Debe contener el archivo precios.xlsx. Solo se te volverá a pedir si la carpeta deja de estar disponible.',
      retry: false
    },
    folder_unreachable: {
      title: 'No se encuentra la carpeta de proyectos',
      body: 'No se puede acceder a la carpeta guardada. Comprueba la conexión con el servidor y pulsa «Reintentar», o elige otra carpeta.',
      retry: true
    },
    no_prices: {
      title: 'Falta el archivo de precios',
      body: 'En la carpeta seleccionada no hay ningún archivo «precios.xlsx». Cópialo en esa carpeta y pulsa «Reintentar», o elige otra carpeta.',
      retry: true
    }
  };

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function ask(status, errorText) {
    return new Promise(resolve => {
      const t = TEXTS[status.state] || TEXTS.no_folder;
      const overlay = el('div', 'position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.88);display:flex;align-items:center;justify-content:center;font-family:Inter,Arial,sans-serif');
      const card = el('div', 'width:min(560px,92vw);background:#111827;border:1px solid #475569;border-radius:16px;padding:26px;color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,.6)');
      card.appendChild(el('h2', 'margin:0 0 10px;font-size:20px;font-weight:800;color:#fff', t.title));
      card.appendChild(el('p', 'margin:0 0 12px;font-size:14px;line-height:1.5;color:#cbd5e1', t.body));
      if (status.path) card.appendChild(el('p', 'margin:0 0 12px;font-size:12px;font-family:monospace;color:#fbbf24;word-break:break-all', status.path));
      if (errorText) card.appendChild(el('p', 'margin:0 0 12px;font-size:12px;color:#fca5a5', errorText));
      const row = el('div', 'display:flex;gap:10px;flex-wrap:wrap;margin-top:6px');
      const mk = (label, bg, action) => {
        const b = el('button', 'cursor:pointer;border:0;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:700;color:#fff;background:' + bg, label);
        b.type = 'button';
        b.dataset.action = action;
        b.onclick = () => { overlay.remove(); resolve(action); };
        row.appendChild(b);
      };
      if (t.retry) { mk('Reintentar', '#2f9e6a', 'retry'); mk('Elegir otra carpeta…', '#475569', 'choose'); }
      else mk('Elegir carpeta…', '#2f9e6a', 'choose');
      card.appendChild(row);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  }

  // Devuelve cuando hay una carpeta válida (accesible y con precios.xlsx dentro).
  async function run() {
    if (!invoke) return { skipped: true };       // navegador: sin carpeta
    let errorText = '';
    for (;;) {
      let st;
      try { st = await invoke('check_setup'); }
      catch (e) { st = { state: 'no_folder', path: null }; errorText = String(e && e.message ? e.message : e); }
      if (st.state === 'ok') return { path: st.path };
      const action = await ask(st, errorText);
      errorText = '';
      if (action === 'choose') {
        try { await invoke('choose_folder'); }
        catch (e) { errorText = 'No se pudo abrir el selector de carpetas: ' + (e && e.message ? e.message : e); }
      }
    }
  }

  window.ECOWALL_SETUP = { run };
})();
