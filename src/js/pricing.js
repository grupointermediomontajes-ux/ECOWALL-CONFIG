/* ECOWALL · precios desde Excel
 * Lee data/precios.xlsx (sin librerías externas: un .xlsx es un ZIP con XML dentro)
 * y calcula el precio de cada pieza y el total con el % de beneficio.
 *
 * Reglas:
 *  - Toda pieza/opción sin precio en el Excel (vacía, texto, no encontrada) vale 0 €.
 *  - El beneficio (BENEFICIO_PCT) se suma sobre el total: moqueta + piezas.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;

  // Piezas que no tienen versión impresa: siempre un único precio.
  const NO_FINISH = ['focoPala', 'tvSoporte', 'mesaSillas', 'mesaAlta', 'portaCatalogos'];

  // Valores de respaldo si no se puede leer el Excel (los de la versión anterior; null -> 0).
  const DEFAULT_PRICES = {
    'muro:unpainted': 35, 'muro:painted_1': 55, 'muro:painted_2': 80,
    'muro1c:unpainted': 20, 'muro1c:painted': 40,
    'esquina:unpainted': 20, 'esquina:painted': 40,
    'esquina45:unpainted': 20, 'esquina45:painted': 40,
    'pico:unpainted': 20, 'pico:painted_1': 40, 'pico:painted_2': 80,
    'picodoble:unpainted': 40, 'picodoble:painted': 80,
    'mostrador:unpainted': 0, 'mostrador:painted': 0,
    'mostrador1m:unpainted': 0, 'mostrador1m:painted': 0,
    'focoPala:unpainted': 0, 'tvSoporte:unpainted': 0, 'mesaSillas:unpainted': 0,
    'mesaAlta:unpainted': 0, 'portaCatalogos:unpainted': 0,
    'lateral:unpainted': 20, 'lateral:painted': 35
  };

  // Claves añadidas después de repartir el Excel: si un Excel antiguo no las tiene, se usa este precio
  // (y se avisa para añadir la fila) en lugar de 0 €.
  const ADDED_KEYS = ['pico:painted_1', 'pico:painted_2'];

  // ------------------------------------------------------------------ ZIP / XML
  const utf8 = new TextDecoder('utf-8');

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este sistema es demasiado antiguo para leer el Excel (falta DecompressionStream).');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function openZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let e = bytes.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('El archivo no es un .xlsx válido.');
    const total = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const entries = {};
    for (let i = 0; i < total; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Directorio ZIP dañado.');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nlen));
      entries[name] = { method, csize, lho };
      p += 46 + nlen + elen + clen;
    }
    return {
      has: n => n in entries,
      async text(name) {
        const en = entries[name];
        if (!en) return null;
        const ln = dv.getUint16(en.lho + 26, true), le = dv.getUint16(en.lho + 28, true);
        const start = en.lho + 30 + ln + le;
        const raw = bytes.subarray(start, start + en.csize);
        const out = en.method === 0 ? raw : en.method === 8 ? await inflateRaw(raw) : null;
        if (!out) throw new Error('Compresión ZIP no soportada.');
        return utf8.decode(out);
      }
    };
  }

  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => {
      g = g.toLowerCase();
      if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>';
      if (g === 'quot') return '"'; if (g === 'apos') return "'";
      return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    });
  }
  function attrs(str) {
    const o = {}; const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let m;
    while ((m = re.exec(str))) o[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
    return o;
  }
  function textOf(xml) {
    xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let out = '', m; const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    while ((m = re.exec(xml))) out += decodeEntities(m[1]);
    return out;
  }

  // ------------------------------------------------------------------ lector del libro
  async function parseXlsx(bytes) {
    const zip = openZip(bytes);

    // hoja "Precios" (o la primera)
    const wbXml = await zip.text('xl/workbook.xml');
    if (!wbXml) throw new Error('El archivo no es un libro de Excel válido.');
    const relXml = (await zip.text('xl/_rels/workbook.xml.rels')) || '';
    const rels = {};
    for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) { const a = attrs(m[0]); rels[a.Id] = a.Target; }
    const sheets = [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map(m => attrs(m[0]));
    if (!sheets.length) throw new Error('El libro no tiene hojas.');
    const sheet = sheets.find(s => /^precios$/i.test(s.name || '')) || sheets[0];
    let target = rels[sheet['r:id']];
    if (!target) throw new Error('No se encuentra la hoja de precios.');
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    const sheetXml = await zip.text(target);
    if (!sheetXml) throw new Error('No se pudo leer la hoja de precios.');

    // cadenas compartidas
    const sst = [];
    const sstXml = await zip.text('xl/sharedStrings.xml');
    if (sstXml) for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sst.push(textOf(m[1]));

    // estilos: qué celdas tienen formato de porcentaje
    const pctStyle = new Set();
    const stXml = await zip.text('xl/styles.xml');
    if (stXml) {
      const custom = {};
      for (const m of stXml.matchAll(/<numFmt\b[^>]*>/g)) { const a = attrs(m[0]); custom[a.numFmtId] = a.formatCode || ''; }
      const cx = stXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
      if (cx) {
        let i = 0;
        for (const m of cx[1].matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
          const id = attrs(m[1]).numFmtId;
          if (id === '9' || id === '10' || (custom[id] && custom[id].includes('%'))) pctStyle.add(String(i));
          i++;
        }
      }
    }

    // celdas
    const cells = {}; // 'E12' -> {v, pct}
    for (const m of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(m[1]); const inner = m[2] || '';
      if (!a.r) continue;
      let v = null;
      const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (a.t === 's') v = vm ? sst[parseInt(vm[1], 10)] ?? null : null;
      else if (a.t === 'inlineStr') v = textOf(inner);
      else if (a.t === 'str') v = vm ? decodeEntities(vm[1]) : null;
      else if (a.t === 'b') v = vm ? vm[1] === '1' : null;
      else if (a.t === 'e') v = null;
      else if (vm) { const n = parseFloat(vm[1]); v = Number.isFinite(n) ? n : null; }
      cells[a.r] = { v, pct: pctStyle.has(a.s) };
    }

    // filas con clave en la columna F y valor en la columna E
    const result = { prices: {}, floorPerM2: null, profitPct: null, warnings: [], keysFound: 0 };
    const toNumber = (cell, label) => {
      if (!cell || cell.v === null || cell.v === '' || cell.v === undefined) return 0;
      let n = cell.v;
      if (typeof n === 'string') n = parseFloat(n.replace(/\s/g, '').replace('€', '').replace('%', '').replace(',', '.'));
      if (typeof n !== 'number' || !Number.isFinite(n)) { result.warnings.push(`«${label}» no es un número: se usa 0.`); return 0; }
      if (n < 0) { result.warnings.push(`«${label}» es negativo: se usa 0.`); return 0; }
      return n;
    };
    for (const ref of Object.keys(cells)) {
      const mm = ref.match(/^F(\d+)$/);
      if (!mm || typeof cells[ref].v !== 'string') continue;
      const key = cells[ref].v.trim();
      const valCell = cells['E' + mm[1]];
      if (key === 'SUELO_M2') { result.floorPerM2 = toNumber(valCell, key); result.keysFound++; }
      else if (key === 'BENEFICIO_PCT') {
        let n = toNumber(valCell, key);
        if (valCell && valCell.pct) n *= 100;        // celda con formato % -> 0,15 = 15 %
        result.profitPct = n; result.keysFound++;
      } else if (key in DEFAULT_PRICES) { result.prices[key] = toNumber(valCell, key); result.keysFound++; }
    }
    if (!result.keysFound) throw new Error('No se encontraron precios en el Excel (¿se ha modificado la columna «Clave interna»?).');
    const added = ADDED_KEYS.filter(k => !(k in result.prices));
    added.forEach(k => { result.prices[k] = DEFAULT_PRICES[k]; });
    if (added.length) result.warnings.push('Faltan en el Excel las filas nuevas ' + added.map(k => `${k} (${DEFAULT_PRICES[k]} €)`).join(', ') +
      ': se usan esos precios. Copia la plantilla nueva de precios.xlsx para poder cambiarlos.');
    const missing = Object.keys(DEFAULT_PRICES).filter(k => !(k in result.prices));
    if (missing.length) result.warnings.push('Faltan en el Excel (se cuentan como 0 €): ' + missing.join(', '));
    if (result.floorPerM2 === null) result.warnings.push('Falta SUELO_M2 en el Excel (moqueta a 0 €/m²).');
    if (result.profitPct === null) result.warnings.push('Falta BENEFICIO_PCT en el Excel (beneficio 0 %).');
    return result;
  }

  // ------------------------------------------------------------------ objeto global PRICING
  const PRICING = {
    floorPerM2: 4.5,
    profitPct: 0,
    prices: Object.assign({}, DEFAULT_PRICES),
    source: 'valores por defecto',
    warnings: [],
    parseXlsx,

    key(item) {
      const type = item.type;
      if (NO_FINISH.includes(type)) return type + ':unpainted';
      const painted = item.finish === 'painted';
      if (type === 'muro' || type === 'pico') return painted ? (Number(item.printFaces) === 1 ? type + ':painted_1' : type + ':painted_2') : type + ':unpainted';
      return type + ':' + (painted ? 'painted' : 'unpainted');
    },
    unitPrice(item) {
      const v = this.prices[this.key(item)];
      return Number.isFinite(v) ? v : 0;      // sin precio => 0 €
    },
    totals(base) {
      const pct = Number.isFinite(this.profitPct) && this.profitPct > 0 ? this.profitPct : 0;
      const profit = base * pct / 100;
      return { base, profitPct: pct, profit, total: base + profit };
    },

    // Aviso de elementos sin precio (precio vacío o 0). Va también en el informe del cliente, así que
    // no menciona el Excel. El aviso de precios de respaldo solo sale en pantalla (opts.internal).
    renderZeroNote(el, groups, opts = {}) {
      if (!el) return;
      const names = [];
      (groups || []).forEach(g => {
        if (this.unitPrice({ type: g.type, finish: g.finish, printFaces: g.printFaces }) === 0) {
          const spec = (typeof PIECE_SPECS !== 'undefined' && PIECE_SPECS[g.type]) ? PIECE_SPECS[g.type].name : g.type;
          if (!names.includes(spec)) names.push(spec);
        }
      });
      const fallback = opts.internal && this.source !== 'precios.xlsx'
        ? 'ATENCIÓN: no se ha podido leer precios.xlsx; se usan precios de respaldo. ' : '';
      el.hidden = names.length === 0 && !fallback;
      el.textContent = fallback + (names.length ? `Elementos «${names.join(', ')}» no contemplados en el precio actual.` : '');
    },

    apply(parsed, sourceLabel) {
      this.prices = Object.assign({}, DEFAULT_PRICES);
      Object.keys(this.prices).forEach(k => { this.prices[k] = 0; });   // lo que no esté en el Excel = 0
      Object.assign(this.prices, parsed.prices);
      this.floorPerM2 = parsed.floorPerM2 ?? 0;
      this.profitPct = parsed.profitPct ?? 0;
      this.warnings = parsed.warnings;
      this.source = sourceLabel;
    },

    // Carga el Excel: en la app de escritorio vía Tauri (Documentos/ECOWALL/precios.xlsx)
    async load() {
      try {
        let bytes;
        if (root.__TAURI__ && root.__TAURI__.core) {
          // precios.xlsx de la carpeta de proyectos elegida por el usuario
          bytes = new Uint8Array(await root.__TAURI__.core.invoke('load_prices'));
        } else {
          const r = await fetch('data/precios.xlsx');          // modo navegador (desarrollo)
          if (!r.ok) throw new Error('sin Excel en modo navegador');
          bytes = new Uint8Array(await r.arrayBuffer());
        }
        this.apply(await parseXlsx(bytes), 'precios.xlsx');
        return { ok: true };
      } catch (err) {
        this.warnings = ['No se pudo leer el Excel de precios: ' + (err && err.message ? err.message : err) +
                         '. Se usan los últimos precios cargados (o los de respaldo).'];
        return { ok: false, error: err };
      }
    }
  };

  root.PRICING = PRICING;
  if (typeof module !== 'undefined' && module.exports) module.exports = { PRICING, parseXlsx, DEFAULT_PRICES };
})();
