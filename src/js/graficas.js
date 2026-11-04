/* ECOWALL · informe de gráficas (guía para los artes finales del departamento de diseño)
 * Por cada tramo, alzado desplegado de las caras impresas: cara 1 (A1, A2…) y, si hay piezas impresas
 * por el otro lado, cara 2 (A2″, A3″…). Una pieza blanca corta el alzado. Cada gráfica lleva su
 * referencia y su ancho desplegado, más la cota total de cada alzado y una planta de situación con las
 * caras marcadas. Los mostradores impresos (solo el frente) van en una hoja aparte. */
(function () {
  'use strict';

  const WALL_MM = 2400;
  const PRIME = '″';
  const HIGHLIGHT = '#facc15';
  const mm = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // ---------------------------------------------------------------- caras de cada pieza
  // En coordenadas locales de la planta (metros): normal hacia fuera, recorrido de la cara en planta
  // (para marcarla en la planta de situación), ancho de la gráfica desplegada (mm) y pliegues (mm).
  //  - Pared universal y panel 1C: el frente (500 mm), por cada lado impreso.
  //  - Pico: el frente en punta (500 mm, pliegue en el centro) y/o la trasera plana (350 mm), según
  //    se imprima a 1 cara (la elegida) o a 2.
  //  - Pico doble: las dos puntas (500 mm cada una).
  //  - Esquina 90º: siempre la cara exterior, un panel de 500 mm doblado (250 + 250); por dentro no tiene cara.
  //  - Esquina 45º: solo la diagonal (500 mm); la cara exterior no se imprime.
  function pieceFaces(p) {
    const painted = p.finish === 'painted';
    const spec = PIECE_SPECS[p.type];
    const s2 = Math.SQRT1_2;
    switch (p.type) {
      case 'muro': {
        const w = spec.width / 2, both = Number(p.printFaces) !== 1, side = p.printSide === -1 ? -1 : 1;
        return [1, -1].map(k => ({ n: [0, k], path: [[-w, 0.15 * k], [w, 0.15 * k]], mm: spec.width * 1000, folds: [], printed: painted && (both || side === k) }));
      }
      case 'muro1c': {
        const w = spec.width / 2;
        return [1, -1].map(k => ({ n: [0, k], path: [[-w, 0.15 * k], [w, 0.15 * k]], mm: spec.width * 1000, folds: [], printed: painted && k === 1 }));
      }
      case 'pico': {
        const both = Number(p.printFaces) !== 1, side = p.printSide === -1 ? -1 : 1;
        return [
          { n: [0, 1], path: [[-0.175, 0.06], [0, 0.24], [0.175, 0.06]], mm: 500, folds: [250], printed: painted && (both || side === 1) },
          { n: [0, -1], path: [[-0.175, -0.24], [0.175, -0.24]], mm: 350, folds: [], printed: painted && (both || side === -1) }
        ];
      }
      case 'picodoble':
        return [1, -1].map(k => ({ n: [0, k], path: [[-0.175, 0.15 * k], [0, 0.33 * k], [0.175, 0.15 * k]], mm: 500, folds: [250], printed: painted }));
      case 'esquina':
        return [{ n: [s2, -s2], path: [[-0.15, -0.15], [0.15, -0.15], [0.15, 0.15]], mm: 500, folds: [250], printed: painted }];
      case 'esquina45':
        return [
          { n: [-s2, -s2], path: [[-0.325, 0.025], [0.025, -0.325]], mm: 500, folds: [], printed: painted },
          { n: [s2, s2], path: [[0.025, -0.325], [0.325, -0.325], [0.325, 0.325], [-0.325, 0.325], [-0.325, 0.025]], mm: 1300, folds: [], printed: false }
        ];
      default:
        return [];
    }
  }
  // Tapa (pared final): desplegada 50 + 300 + 50 mm; va en el alzado de la cara donde está impresa su pared.
  function capFace(cap) {
    return { n: [0, 0], cap: true, mm: 400, folds: [50, 350], printed: cap.finish === 'painted' };
  }

  const toWorld = (p, [x, y]) => {
    const r = THREE.MathUtils.degToRad(p.rotation), c = Math.cos(r), s = Math.sin(r);
    return [p.x + x * c - y * s, p.y + x * s + y * c];
  };
  const dirWorld = (p, [x, y]) => {
    const r = THREE.MathUtils.degToRad(p.rotation), c = Math.cos(r), s = Math.sin(r);
    return [x * c - y * s, x * s + y * c];
  };
  const LINEAR = ['muro', 'muro1c', 'pico', 'picodoble'];

  function linked(a, b) {
    if (a.isAuto) return a.parentId === b.id;
    if (b.isAuto) return b.parentId === a.id;
    return piecesJoinedByPorts(a, b);
  }

  // ---------------------------------------------------------------- alzados por tramo
  // Devuelve [{ letter, side: 1|2, segments: [[{ p, face, label }]] }] y los mostradores impresos.
  function computeGraphicRuns() {
    const numbering = computeConstructionNumbering();
    const byGroup = new Map();
    numbering.order.forEach(p => {
      const g = numbering.groupOf.get(p.id);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(p);
    });

    const runs = [];
    byGroup.forEach((order, letter) => {
      // Lado de cada cara respecto al sentido de recorrido del tramo (izquierda / derecha).
      const sideOf = order.map((p, i) => {
        if (p.isAuto) return null;
        const prev = i > 0 && linked(order[i - 1], p) && !order[i - 1].isAuto ? order[i - 1] : null;
        const next = i < order.length - 1 && linked(p, order[i + 1]) && !order[i + 1].isAuto ? order[i + 1] : null;
        let t = [(next || p).x - (prev || p).x, (next || p).y - (prev || p).y];
        if (LINEAR.includes(p.type) || (!prev && !next)) {
          const axis = dirWorld(p, [1, 0]);
          t = (axis[0] * t[0] + axis[1] * t[1]) < 0 ? [-axis[0], -axis[1]] : axis;
        }
        return face => {
          const n = dirWorld(p, face.n);
          return t[0] * n[1] - t[1] * n[0] >= 0 ? 1 : -1;
        };
      });
      const facesOn = (p, i, s) => (p.isAuto ? [] : pieceFaces(p).filter(f => sideOf[i](f) === s));

      // Cara 1: el lado con más gráfica impresa.
      const printedMm = s => order.reduce((sum, p, i) => sum + facesOn(p, i, s).filter(f => f.printed).reduce((a, f) => a + f.mm, 0), 0);
      const first = printedMm(-1) > printedMm(1) ? -1 : 1;

      // 1) Paneles de cada cara, en alzados continuos (una pieza blanca corta el alzado).
      const bySide = [first, -first].map((s, k) => {
        const segments = [];
        let cur = [], prev = null;
        const flush = () => { if (cur.length) segments.push(cur); cur = []; };
        order.forEach((p, i) => {
          if (p.isAuto) return;                        // las tapas se colocan después
          if (prev && !linked(prev, p)) flush();
          prev = p;
          const faces = facesOn(p, i, s);
          if (!faces.length) return;                   // sin cara en este lado (dentro de una esquina 90º)
          if (!faces[0].printed) { flush(); return; }
          cur.push({ p, face: faces[0], label: pieceRefLabel(p) + (k ? PRIME : '') });
        });
        flush();
        return segments;
      });
      // 2) Tapas impresas: en el alzado de la cara donde está impresa su pared (si lo está por las dos, en
      //    la cara 1), al principio o al final según el extremo. Si su pared no va impresa, la tapa sola.
      order.forEach((cap, ci) => {
        if (!cap.isAuto) return;
        const face = capFace(cap);
        if (!face.printed) return;
        const item = { p: cap, face, label: pieceRefLabel(cap) };
        const parentIndex = order.findIndex(p => p.id === cap.parentId);
        for (const segments of bySide) {
          const seg = segments.find(sg => sg.some(it => it.p.id === cap.parentId));
          if (!seg) continue;
          if (ci < parentIndex) seg.unshift(item); else seg.push(item);
          return;
        }
        bySide[0].push([item]);
      });
      bySide.forEach((segments, k) => { if (segments.length) runs.push({ letter, side: k + 1, segments }); });
    });

    const counters = pieces.filter(p => (p.type === 'mostrador' || p.type === 'mostrador1m') && p.finish === 'painted');
    return { runs, counters };
  }

  // ---------------------------------------------------------------- hojas
  const PAPER = [404, 281];          // A3 apaisado menos márgenes (mm)
  const W = 2200, H = Math.round(W * PAPER[1] / PAPER[0]);
  const SS = 2;
  const TITLE_H = 150;

  function newSheet() {
    const canvas = document.createElement('canvas');
    canvas.width = W * SS; canvas.height = H * SS;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(SS, 0, 0, SS, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    return { canvas, ctx };
  }

  // Planta de situación pequeña con las caras de la hoja marcadas en amarillo.
  function drawKeyPlan(ctx, x, y, w, h, marks) {
    const scale = Math.min((w - 20) / project.widthMeters, (h - 20) / project.depthMeters);
    const ox = x + (w - project.widthMeters * scale) / 2, oy = y + (h - project.depthMeters * scale) / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    renderBlueprint(ctx, w, h, { theme: 'print', scale, originX: ox, originY: oy, labels: 'none' });
    ctx.strokeStyle = HIGHLIGHT; ctx.fillStyle = HIGHLIGHT;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, 0.07 * scale);
    marks.forEach(({ p, face }) => {
      if (face.cap) {
        ctx.save();
        ctx.translate(ox + p.x * scale, oy + p.y * scale);
        ctx.rotate(THREE.MathUtils.degToRad(p.rotation));
        const s = PIECE_SPECS.lateral;
        const pad = 0.025 * scale;
        ctx.fillRect(-s.width / 2 * scale - pad, -s.depth / 2 * scale - pad, s.width * scale + 2 * pad, s.depth * scale + 2 * pad);
        ctx.restore();
        return;
      }
      ctx.beginPath();
      face.path.map(v => toWorld(p, v)).forEach(([wx, wy], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ox + wx * scale, oy + wy * scale));
      ctx.stroke();
    });
    // Nº de cada panel y tapa (encima de la marca amarilla), para ubicar las gráficas en la planta.
    const C = { ...BLUEPRINT_THEMES.print, tagScale: 1.0 };
    computeConstructionNumbering().order.forEach(p => {
      ctx.save();
      ctx.translate(ox + p.x * scale, oy + p.y * scale);
      drawPieceLabel(ctx, p, PIECE_SPECS[p.isAuto ? 'lateral' : p.type], scale, C, 'number');
      ctx.restore();
    });
    ctx.restore();
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#334155'; ctx.font = 'bold 12px Inter, Arial, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('SITUACIÓN EN PLANTA', x, y - 6);
  }

  // Alzados desplegados de una hoja: grupos separados, cada uno con su referencia, ancho de cada
  // gráfica, cota total y altura.
  function drawElevations(ctx, groups, area, heightMm) {
    const GAP = 110;
    const totalMm = groups.reduce((s, g) => s + g.reduce((a, it) => a + it.face.mm, 0), 0);
    const px = Math.min((area.w - GAP * (groups.length - 1)) / totalMm, area.h / heightMm);
    const used = totalMm * px + GAP * (groups.length - 1);
    let cx = area.x + (area.w - used) / 2;
    const top = area.y + (area.h - heightMm * px) / 2, bottom = top + heightMm * px;
    const { line, tick, boxedText } = dimensionHelpers(ctx);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    groups.forEach(group => {
      const x0 = cx;
      group.forEach(it => {
        const w = it.face.mm * px;
        ctx.fillStyle = 'rgba(124, 58, 237, 0.06)';
        ctx.fillRect(cx, top, w, bottom - top);
        // Pliegues: discontinua.
        ctx.save();
        ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1; ctx.setLineDash([8, 6]);
        it.face.folds.forEach(f => line(cx + f * px, top, cx + f * px, bottom));
        ctx.restore();
        ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1.6;
        ctx.strokeRect(cx, top, w, bottom - top);
        // Referencia encima.
        ctx.fillStyle = '#0f172a'; ctx.font = `bold ${Math.min(22, Math.max(13, w / 4))}px Inter, Arial, sans-serif`;
        ctx.fillText(it.label, cx + w / 2, top - 22);
        // Ancho de la gráfica debajo.
        ctx.strokeStyle = '#0f766e'; ctx.lineWidth = 1;
        ctx.font = `bold ${Math.min(14, Math.max(10, w / 5))}px Inter, Arial, sans-serif`;
        const y = bottom + 34;
        line(cx, bottom + 6, cx, y + 8); line(cx + w, bottom + 6, cx + w, y + 8);
        line(cx, y, cx + w, y); tick(cx, y); tick(cx + w, y);
        boxedText(mm(it.face.mm), cx + w / 2, y, '#0f766e');
        cx += w;
      });
      // Cota total del alzado.
      const total = group.reduce((a, it) => a + it.face.mm, 0);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.2; ctx.font = 'bold 16px Inter, Arial, sans-serif';
      const ty = bottom + 78;
      line(x0, bottom + 6, x0, ty + 8); line(cx, bottom + 6, cx, ty + 8);
      line(x0, ty, cx, ty); tick(x0, ty); tick(cx, ty);
      boxedText(`${mm(total)} mm`, (x0 + cx) / 2, ty, '#0f172a');
      // Altura, a la izquierda de cada alzado.
      const hx = x0 - 34;
      ctx.font = 'bold 13px Inter, Arial, sans-serif'; ctx.lineWidth = 1;
      line(hx - 8, top, x0 - 6, top); line(hx - 8, bottom, x0 - 6, bottom);
      line(hx, top, hx, bottom); tick(hx, top); tick(hx, bottom);
      boxedText(mm(heightMm), hx, (top + bottom) / 2, '#0f172a', true);
      cx += GAP;
    });
    return px;
  }

  function drawSheet(title, subtitle, groups, heightMm, marks) {
    const { canvas, ctx } = newSheet();
    // Encabezado.
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 30px Inter, Arial, sans-serif';
    ctx.fillText(title, 40, 34);
    ctx.fillStyle = '#475569'; ctx.font = '500 16px Inter, Arial, sans-serif';
    ctx.fillText(subtitle, 40, 74);

    // Abajo: planta de situación (izquierda) y resumen de medidas (derecha), sobre el cajetín.
    const keyH = 360, keyW = Math.min(900, keyH * project.widthMeters / project.depthMeters + 20);
    const keyY = H - TITLE_H - keyH - 20;
    drawKeyPlan(ctx, 40, keyY, keyW, keyH, marks);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#334155'; ctx.font = 'bold 12px Inter, Arial, sans-serif';
    const sx = 40 + keyW + 50;
    ctx.fillText('MEDIDAS DE GRÁFICA (desplegadas, mm)', sx, keyY - 18);
    ctx.font = '500 15px Inter, Arial, sans-serif'; ctx.fillStyle = '#0f172a';
    groups.forEach((g, i) => {
      const total = g.reduce((a, it) => a + it.face.mm, 0);
      const refs = g.length > 1 ? `${g[0].label} – ${g[g.length - 1].label}` : g[0].label;
      ctx.fillText(`${refs}:  ${mm(total)} × ${mm(heightMm)} mm  (${g.length} ${g.length === 1 ? 'pieza' : 'piezas'})`, sx, keyY + 6 + i * 24, W - sx - 40);
    });
    ctx.fillStyle = '#64748b'; ctx.font = '500 13px Inter, Arial, sans-serif';
    ctx.fillText('Línea discontinua: pliegue de la gráfica. Tapa: 50 + 300 + 50 · Esquina 90º: 250 + 250 · Pico (frente): 250 + 250 · Pico (trasera): 350.', sx, keyY + keyH - 20, W - sx - 40);

    // Alzados en el espacio central.
    const area = { x: 110, y: 170, w: W - 220, h: keyY - 170 - 150 };
    const px = drawElevations(ctx, groups, area, heightMm);
    const pxPerMeter = px * 1000;
    const denominator = Math.max(1, Math.round((W / pxPerMeter) * 1000 / PAPER[0]));
    drawTitleBlock(ctx, 20, H - TITLE_H + 10, W - 40, TITLE_H - 30, pxPerMeter, denominator, title, 'A3');
    return canvas;
  }

  function buildGraphicsSheets() {
    const { runs, counters } = computeGraphicRuns();
    const sheets = [];
    runs.forEach(run => {
      const all = run.segments.flat();
      const title = `GRÁFICAS · TRAMO ${run.letter} · CARA ${run.side}`;
      const subtitle = run.side === 1
        ? 'Caras impresas del lado principal del tramo, con sus tapas. Cada alzado es una gráfica continua.'
        : `Caras impresas del otro lado del tramo (referencias con ${PRIME}), con sus tapas si no van ya en la cara 1.`;
      sheets.push(drawSheet(title, subtitle, run.segments, WALL_MM, all));
    });
    if (counters.length) {
      const groups = counters.map(p => [{
        p,
        face: { mm: PIECE_SPECS[p.type].width * 1000, folds: [], printed: true, n: [0, p.printSide === -1 ? -1 : 1] },
        label: PIECE_SPECS[p.type].name
      }]);
      const marks = groups.map(([it]) => {
        const w = PIECE_SPECS[it.p.type].width / 2, k = it.face.n[1];
        return { p: it.p, face: { path: [[-w, 0.15 * k], [w, 0.15 * k]] } };
      });
      sheets.push(drawSheet('GRÁFICAS · MOSTRADORES', 'Solo el frente impreso de cada mostrador.', groups, PIECE_SPECS[counters[0].type].height * 1000, marks));
    }
    return sheets;
  }

  // ---------------------------------------------------------------- plantilla de Illustrator
  // Un navegador no puede escribir un .ai con mesas de trabajo y capas, así que se descarga una secuencia de
  // comandos (.jsx) que crea el documento en Illustrator y lo guarda como .ai junto al .jsx
  // (Archivo › Secuencias de comandos › Otra secuencia de comandos). Documento en milímetros, CMYK, con el
  // sangrado del propio documento (15 mm a izquierda y derecha); una mesa de trabajo por panel a tamaño real
  // y, dentro de cada alzado, pegadas unas a otras para que la gráfica sea continua.
  // Capas: «AAFF» (arte final) y debajo «referencias» (no imprimible: corte, pliegues y nombres).
  const BLEED_MM = 15;

  function illustratorTemplateData() {
    const { runs, counters } = computeGraphicRuns();
    const item = (label, mm, folds, height) => ({ label, mm: Math.round(mm), folds, name: `${label}_${Math.round(mm)}x${height}H mm` });
    const rows = runs.map(run => ({
      title: `TRAMO ${run.letter} - CARA ${run.side}`,
      height: WALL_MM,
      groups: run.segments.map(g => g.map(it => item(it.label, it.face.mm, it.face.folds, WALL_MM)))
    }));
    if (counters.length) {
      const height = Math.round(PIECE_SPECS[counters[0].type].height * 1000);
      const names = counters.map(p => PIECE_SPECS[p.type].name);
      rows.push({
        title: 'MOSTRADORES (solo el frente)',
        height,
        groups: counters.map((p, i) => {
          const same = names.filter(n => n === names[i]).length;
          const label = same > 1 ? `${names[i]} (${names.slice(0, i + 1).filter(n => n === names[i]).length})` : names[i];
          return [item(label, PIECE_SPECS[p.type].width * 1000, [], height)];
        })
      });
    }
    return { project: project.name, file: planFileBaseName() + '_graficas', bleed: BLEED_MM, rows };
  }

  function buildIllustratorScript(data) {
    // ExtendScript (ES3): sin JSON, let ni funciones flecha. Los datos van como literal ASCII.
    const literal = JSON.stringify(data).replace(/[\u0080-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    return `#target illustrator
// ECOWALL - plantilla de graficas para Illustrator.
// Uso: Illustrator > Archivo > Secuencias de comandos > Otra secuencia de comandos... y elegir este archivo.
// Crea el documento (milimetros, CMYK, sangrado de documento ${BLEED_MM} mm a izquierda y derecha) con una mesa
// de trabajo por panel a tamano real (nombre: referencia_anchoxaltoH mm) y lo guarda como .ai junto a este archivo.
// Capas: "AAFF" (arte final) y "referencias" (no imprimible).
(function () {
var D = ${literal};
var PT = 72 / 25.4;                 // puntos por mm
var CANVAS = 5700;                  // mm: lienzo normal de Illustrator (5.779 mm) con margen
var MARGIN = 100, TITLE = 380, GAP = 300, ROW_GAP = 350;

// Disposicion en mm. maxW = 0: cada alzado en una sola fila (grafica continua). Si no, filas de hasta maxW.
function layout(maxW) {
  var lines = [], x, line;
  for (var r = 0; r < D.rows.length; r++) {
    var row = D.rows[r];
    line = { title: row.title, height: row.height, items: [] };
    x = MARGIN;
    for (var g = 0; g < row.groups.length; g++) {
      var group = row.groups[g];
      for (var i = 0; i < group.length; i++) {
        var it = group[i];
        if (maxW && line.items.length && x + it.mm > maxW - MARGIN) {
          lines.push(line);
          line = { title: row.title + " (continua)", height: row.height, items: [] };
          x = MARGIN;
        }
        line.items.push({ x: x, mm: it.mm, folds: it.folds, label: it.label, name: it.name });
        x += it.mm;
      }
      x += GAP;
    }
    lines.push(line);
  }
  return lines;
}
function lineWidth(line) { var last = line.items[line.items.length - 1]; return last.x + last.mm + MARGIN; }
// Reparte las filas en documentos que quepan en el lienzo (alto maximo maxH; 0 = sin limite).
function pack(lines, maxH) {
  var docs = [], cur = null, y = 0;
  for (var i = 0; i < lines.length; i++) {
    var h = TITLE + lines[i].height + ROW_GAP;
    if (!cur || (maxH && y + h + MARGIN > maxH)) { cur = { lines: [], width: 0, height: 0 }; docs.push(cur); y = MARGIN; }
    lines[i].y = y + TITLE;
    cur.lines.push(lines[i]);
    cur.width = Math.max(cur.width, lineWidth(lines[i]));
    y += h;
    cur.height = y - ROW_GAP + MARGIN;
  }
  return docs;
}

function newDocument(widthMm, heightMm) {
  var p = new DocumentPreset();
  p.units = RulerUnits.Millimeters;
  p.colorMode = DocumentColorSpace.CMYK;
  p.width = widthMm * PT;
  p.height = heightMm * PT;
  p.documentBleedLink = false;
  p.documentBleedOffsetRect = [D.bleed * PT, 0, D.bleed * PT, 0];   // izquierda, superior, derecha, inferior
  var names = ["Print", "Imprimir"];
  try { if (app.startupPresetsList && app.startupPresetsList.length) names.push(app.startupPresetsList[0]); } catch (e0) {}
  for (var i = 0; i < names.length; i++) {
    try { return app.documents.addDocument(names[i], p); } catch (e) {}
  }
  try { return app.documents.add(DocumentColorSpace.CMYK, widthMm * PT, heightMm * PT); } catch (e1) { return null; }
}
// Escala interna del documento (lienzo grande de Illustrator = 10) y comprobacion de que el tamano es real.
function realScale(doc, widthMm) {
  var k = 1;
  try { if (doc.scaleFactor) k = doc.scaleFactor; } catch (e) {}
  var r = doc.artboards[0].artboardRect;
  return Math.abs((r[2] - r[0]) * k / PT - widthMm) < 1 ? k : 0;
}

function cmyk(c, m, y, k) { var col = new CMYKColor(); col.cyan = c; col.magenta = m; col.yellow = y; col.black = k; return col; }
var BLACK = cmyk(0, 0, 0, 100), FOLD = cmyk(100, 0, 0, 0), GREY = cmyk(0, 0, 0, 55);
var FONT = null;
var fontNames = ["ArialMT", "Arial-BoldMT", "Helvetica", "MyriadPro-Regular"];
for (var fi = 0; fi < fontNames.length && !FONT; fi++) { try { FONT = app.textFonts.getByName(fontNames[fi]); } catch (ef) {} }

function build(doc, k, part) {
  var MM = PT / k;
  var base = doc.artboards[0].artboardRect;
  var X0 = base[0], Y0 = base[1];
  function X(mm) { return X0 + mm * MM; }
  function Y(mm) { return Y0 - mm * MM; }

  var refs = doc.layers[0];
  refs.name = "referencias";
  var aaff = doc.layers.add();
  aaff.name = "AAFF";
  function line(x1, y1, x2, y2, color, width, dashes) {
    var p = refs.pathItems.add();
    p.setEntirePath([[X(x1), Y(y1)], [X(x2), Y(y2)]]);
    p.filled = false; p.stroked = true; p.strokeColor = color; p.strokeWidth = width;
    if (dashes) p.strokeDashes = dashes;
    return p;
  }
  function rect(x, y, w, h) {
    var r = refs.pathItems.rectangle(Y(y), X(x), w * MM, h * MM);
    r.filled = false; r.stroked = true; r.strokeColor = BLACK; r.strokeWidth = 0.75;
    return r;
  }
  function label(s, x, y, sizeMm, color) {
    var t = refs.textFrames.add();
    t.contents = s;
    var a = t.textRange.characterAttributes;
    if (FONT) a.textFont = FONT;
    a.size = Math.min(1296, Math.max(4, sizeMm * MM));
    a.fillColor = color;
    t.position = [X(x), Y(y)];
    return t;
  }
  var count = 0;
  for (var l = 0; l < part.lines.length; l++) {
    var ln = part.lines[l];
    label(ln.title, ln.items[0].x, ln.y - 360, 110, BLACK);
    for (var i = 0; i < ln.items.length; i++) {
      var it = ln.items[i];
      var ab = doc.artboards.add([X(it.x), Y(ln.y), X(it.x + it.mm), Y(ln.y + ln.height)]);
      ab.name = it.name;
      count++;
      rect(it.x, ln.y, it.mm, ln.height);
      for (var f = 0; f < it.folds.length; f++) line(it.x + it.folds[f], ln.y, it.x + it.folds[f], ln.y + ln.height, FOLD, 1, [12, 8]);
      label(it.label, it.x + 15, ln.y - 210, 110, BLACK);
      label(it.mm + " x " + ln.height + " mm", it.x + 15, ln.y - 80, 50, GREY);
    }
  }
  doc.artboards.remove(0);
  refs.printable = false;
  refs.locked = true;
  doc.activeLayer = aaff;
  try { app.executeMenuCommand("fitall"); } catch (e2) {}
  return count;
}

function save(doc, name) {
  try {
    var folder = new File($.fileName).parent;
    var file = new File(folder.fsName + "/" + name + ".ai");
    doc.saveAs(file, new IllustratorSaveOptions());
    return file.fsName;
  } catch (e) { return null; }
}

// 1) Todo en un documento, cada alzado en una fila continua (si el ancho supera el lienzo normal,
//    Illustrator puede crearlo como lienzo grande, a tamano real).
var parts = pack(layout(0), 0), part = parts[0], notes = [];
var doc = newDocument(part.width, part.height);
var k = doc ? realScale(doc, part.width) : 0;
if (!k) {
  // 2) Esta version de Illustrator no admite ese tamano: se cierran y se reparten las filas en
  //    documentos que quepan en el lienzo, siempre a tamano real.
  if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
  parts = pack(layout(CANVAS), CANVAS);
  notes.push("El stand no cabe en un solo lienzo de Illustrator: los alzados largos siguen en la fila siguiente (\\"continua\\") y se han creado " + parts.length + " documentos, todos a tamano real.");
  doc = null;
}
var total = 0, files = [];
for (var d = 0; d < parts.length; d++) {
  if (!doc) {
    doc = newDocument(parts[d].width, parts[d].height);
    if (!doc) { alert("ECOWALL: Illustrator no ha podido crear el documento."); return; }
    k = realScale(doc, parts[d].width) || 1;
  }
  total += build(doc, k, parts[d]);
  var saved = save(doc, D.file + (parts.length > 1 ? "_" + (d + 1) : ""));
  if (saved) files.push(saved);
  doc = null;
}
alert("ECOWALL - " + D.project + "\\n" + total + " mesas de trabajo a tamano real (mm).\\n" +
  "Falta el sangrado: anadelo en Archivo > Ajustar documento (" + D.bleed + " mm a izquierda y derecha, 0 arriba y abajo).\\n" +
  "Capas: \\"AAFF\\" para el arte final y \\"referencias\\" (no imprimible)." +
  (notes.length ? "\\n\\n" + notes.join("\\n") : "") +
  (files.length ? "\\n\\nGuardado en:\\n" + files.join("\\n") : "\\n\\nNo se pudo guardar automaticamente: usa Archivo > Guardar como (.ai)."));
})();
`;
  }

  window.exportIllustratorTemplate = async function () {
    try {
      const data = illustratorTemplateData();
      if (!data.rows.length) {
        showProjectToast('No hay paredes ni mostradores impresos: no hay gráficas que preparar.', 'error');
        return;
      }
      await saveExportedFile(planFileBaseName() + '_plantilla_illustrator.jsx', '﻿' + buildIllustratorScript(data),
        'application/javascript', 'Secuencia de comandos de Illustrator', 'jsx');
      showProjectToast('Plantilla descargada. En Illustrator: Archivo › Secuencias de comandos › Otra secuencia de comandos; crea y guarda el .ai junto al archivo.');
    } catch (e) {
      console.error(e);
      showProjectToast('No se pudo generar la plantilla de Illustrator: ' + (e && e.message ? e.message : e), 'error');
    }
  };

  window.exportGraphicsReport = async function () {
    const button = document.getElementById('btn-graphics-report');
    const label = button ? button.innerHTML : '';
    try {
      if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando…'; }
      await new Promise(r => setTimeout(r, 30));     // deja pintar el botón
      const sheets = buildGraphicsSheets();
      if (!sheets.length) {
        showProjectToast('No hay paredes ni mostradores impresos: no hay gráficas que preparar.', 'error');
        return;
      }
      const bytes = await buildImagePdf(sheets.map(canvas => ({ canvas, pageMm: [420, 297], rectMm: [8, 8, PAPER[0], PAPER[1]] })),
        `${project.name} - Graficas`);
      await saveExportedFile(planFileBaseName() + '_graficas.pdf', bytes, 'application/pdf', 'Documento PDF', 'pdf');
    } catch (e) {
      console.error(e);
      showProjectToast('No se pudo generar el informe de gráficas: ' + (e && e.message ? e.message : e), 'error');
    } finally {
      if (button) { button.disabled = false; button.innerHTML = label; }
    }
  };
  window.__ecowallGraphics = { computeGraphicRuns, buildGraphicsSheets, illustratorTemplateData, buildIllustratorScript };
})();
