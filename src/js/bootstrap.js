/* ECOWALL · arranque
 * 1) carga los modelos 3D como binarios (en vez de decodificar 19 MB de base64 en el HTML)
 * 2) carga librerías 3D auxiliares, 3) lee el Excel de precios, 4) arranca la app. */
(async function () {
  'use strict';
  const overlay = document.createElement('div');
  overlay.id = 'ecowall-loading';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#020617;color:#e2e8f0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font:600 14px Inter,Arial,sans-serif';
  overlay.innerHTML = '<div style="font-size:18px;font-weight:800;letter-spacing:.5px">CONFIGURADOR ECOWALL</div>' +
    '<div id="ecowall-loading-msg">Cargando…</div>' +
    '<div style="width:260px;height:6px;background:#1e293b;border-radius:3px;overflow:hidden"><div id="ecowall-loading-bar" style="height:100%;width:0;background:#6366f1;transition:width .15s"></div></div>';
  document.body.appendChild(overlay);
  const msg = t => { const e = document.getElementById('ecowall-loading-msg'); if (e) e.textContent = t; };
  const bar = p => { const e = document.getElementById('ecowall-loading-bar'); if (e) e.style.width = Math.round(p * 100) + '%'; };

  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
  // primero la copia local (offline); si no existe, la CDN
  const loadLib = async (local, cdn) => { try { await loadScript(local); } catch (e) { await loadScript(cdn); } };

  try {
    // ---- carpeta de proyectos (donde está también precios.xlsx) ----
    msg('Comprobando la carpeta de proyectos…');
    await loadScript('js/pricing.js');
    await loadScript('js/setup.js');
    await window.ECOWALL_SETUP.run();

    // ---- modelos 3D ----
    msg('Cargando modelos 3D…');
    const manifest = await (await fetch('models/manifest.json')).json();
    const names = Object.keys(manifest);
    window.MODEL_BIN = {};
    let done = 0;
    await Promise.all(names.map(async n => {
      const r = await fetch('models/' + manifest[n]);
      if (!r.ok) throw new Error('Falta el modelo models/' + manifest[n]);
      window.MODEL_BIN[n] = new Uint8Array(await r.arrayBuffer());
      bar(++done / names.length * 0.8);
    }));

    // ---- librerías three.js complementarias ----
    msg('Cargando librerías 3D…');
    const T = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/';
    await loadLib('vendor/GLTFLoader.js', T + 'loaders/GLTFLoader.js');
    await loadLib('vendor/OBJExporter.js', T + 'exporters/OBJExporter.js');
    bar(0.9);

    // ---- precios (Excel) ----
    msg('Leyendo precios…');
    const priceResult = await window.PRICING.load();
    bar(0.95);

    // ---- aplicación ----
    if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
    msg('Iniciando…');
    await loadScript('js/app.js');
    await loadScript('js/plan2d.js');
    await loadScript('js/graficas.js');
    await loadScript('js/tauri-bridge.js');
    await window.ecowallSyncProjects();           // proyectos de la carpeta
    bar(1);
    overlay.remove();
    if (typeof window.onload === 'function') window.onload();   // arranque original de la app

    if (!priceResult.ok || window.PRICING.warnings.length) {
      const t = window.PRICING.warnings.join(' ');
      if (typeof window.showProjectToast === 'function') window.showProjectToast(t, 'error');
      console.warn('[ECOWALL precios]', t);
    }
  } catch (err) {
    console.error(err);
    overlay.innerHTML = '<div style="max-width:520px;text-align:center;line-height:1.5"><div style="font-size:18px;font-weight:800;color:#fca5a5">No se pudo iniciar la aplicación</div><div style="margin-top:10px;color:#cbd5e1;font-weight:500">' +
      String(err && err.message ? err.message : err).replace(/</g, '&lt;') + '</div></div>';
  }
})();
