/* ECOWALL · plano 2D
 * - Plano de trabajo en pantalla y plano técnico del informe (mismo motor, dos temas).
 * - Bloques de planta: cada pieza se dibuja con una vista cenital de SU modelo 3D real,
 *   generada una vez y cacheada (el 2D y el 3D siempre coinciden).
 * - Cotas, numeración, alzados de cada pared, solapes y exportación a DXF / PNG.
 * Usa el estado global de app.js (project, pieces, PIECE_SPECS, scene…). */

        // ---------------------------------------------------------------- temas
        const BLUEPRINT_THEMES = {
            screen: {
                roomFill: '#0b1220', gridMinor: '#131c2e', grid: '#1e2a44', roomStroke: '#6366f1', roomStrokeWidth: 2.5,
                roomText: '#94a3b8', piece: '#3b82f6', extra: '#e5e7eb', selected: '#f59e0b', stroke: '#1e293b',
                label: '#0f172a', labelHalo: 'rgba(255,255,255,0.85)', guide: '#6600CC', printed: '#7c3aed',
                cap: '#818cf8', overlap: '#f43f5e', dim: '#38bdf8', alignGuide: '#22d3ee', lock: '#fbbf24', extraOutline: '#94a3b8'
            },
            print: {
                roomFill: '#ffffff', gridMinor: '#f1f5f9', grid: '#e2e8f0', roomStroke: '#0f172a', roomStrokeWidth: 2,
                roomText: '#475569', piece: '#d5dce6', extra: '#f1f5f9', selected: '#d5dce6', stroke: '#0f172a',
                label: '#0f172a', labelHalo: 'rgba(255,255,255,0.9)', guide: '#6600CC', printed: '#6d28d9',
                cap: '#94a3b8', overlap: '#e11d48', dim: '#0f766e', alignGuide: '#0891b2', lock: '#b45309', tagScale: 1.3, extraOutline: '#334155'
            }
        };

        // Etiquetas de las piezas en el plano de trabajo: 'number' (nº de pieza) o 'none'.
        let planLabelMode = 'number';
        try { planLabelMode = localStorage.getItem('ecowall_plan_labels') === 'none' ? 'none' : 'number'; } catch (e) { /* sin almacenamiento */ }
        function setPlanLabelMode(mode) {
            planLabelMode = mode;
            try { localStorage.setItem('ecowall_plan_labels', mode); } catch (e) { /* sin almacenamiento */ }
            highlightPlanLabelButtons();
            drawBlueprint2D();
        }
        function highlightPlanLabelButtons() {
            document.querySelectorAll('[data-plan-labels]').forEach(b => b.classList.toggle('bg-indigo-600', b.dataset.planLabels === planLabelMode));
        }
        highlightPlanLabelButtons();

        // ---------------------------------------------------------------- numeración
        // Solo se numeran los paneles de construcción y las tapas laterales (no mostradores ni extras).
        // Orden: cada tramo montado se recorre desde su extremo más a la izquierda (si hay tapa, la tapa
        // es la primera) siguiendo las uniones, y al llegar a un cruce se sigue la dirección más recta.
        // Cada conjunto de piezas unidas es un tramo con letra (A, B, C… de izquierda a derecha) y sus
        // piezas se numeran A1, A2… Se recalcula al mover o borrar piezas.
        const NUMBERED_TYPES = ['muro', 'muro1c', 'esquina', 'esquina45', 'pico', 'picodoble', 'lateral'];
        const JOIN_TOLERANCE = 0.03;
        let numberingCache = { key: null, map: new Map(), order: [] };

        // Caras de unión de cada pieza (coordenadas locales, metros): segmentos del ancho de la pared (300 mm).
        //  - Pared, panel 1C, pico y pico doble: solo sus dos lados cortos (los extremos).
        //  - Esquina 90º: lado izquierdo y lado inferior; esquina 45º: lado izquierdo (mitad inferior) y
        //    lado superior (mitad derecha). Son los que se marcan en turquesa al seleccionarlas.
        const JOIN_FACES = {
            esquina: [[[-0.15, -0.15], [-0.15, 0.15]], [[-0.15, 0.15], [0.15, 0.15]]],
            esquina45: [[[-0.325, 0.0125], [-0.325, 0.3125]], [[0.0125, -0.325], [0.3125, -0.325]]],
            pico: [[[-0.175, -0.24], [-0.175, 0.06]], [[0.175, -0.24], [0.175, 0.06]]],
            picodoble: [[[-0.175, -0.15], [-0.175, 0.15]], [[0.175, -0.15], [0.175, 0.15]]]
        };
        function getJoinFacesLocal(p) {
            if (JOIN_FACES[p.type]) return JOIN_FACES[p.type];
            const w = PIECE_SPECS[p.type].width / 2;
            return [[[-w, -0.15], [-w, 0.15]], [[w, -0.15], [w, 0.15]]];
        }
        function getJoinFacesWorld(p) {
            const rad = THREE.MathUtils.degToRad(p.rotation);
            const cos = Math.cos(rad), sin = Math.sin(rad);
            return getJoinFacesLocal(p).map(face => face.map(([x, y]) => [p.x + x * cos - y * sin, p.y + x * sin + y * cos]));
        }

        // Unión de montaje: una cara de unión de una pieza coincide con una cara de unión de la otra
        // (paralelas, a menos de 3 cm y solapadas al menos 20 cm). Así dos paredes solo continúan si se
        // tocan por sus extremos (en línea); una pared que toca otra por el lado largo, o una esquina por
        // un lado que no es de unión, empieza otro tramo.
        function piecesJoinedByPorts(a, b) {
            return getJoinFacesWorld(a).some(fa => getJoinFacesWorld(b).some(fb => joinFacesMeet(fa, fb)));
        }
        function joinFacesMeet([[ax1, ay1], [ax2, ay2]], [[bx1, by1], [bx2, by2]]) {
            const len = Math.hypot(ax2 - ax1, ay2 - ay1) || 1;
            const ux = (ax2 - ax1) / len, uy = (ay2 - ay1) / len;
            // Paralelas: los extremos de b a la misma distancia (±3 cm) de la recta de a.
            const dist = (x, y) => Math.abs((x - ax1) * uy - (y - ay1) * ux);
            if (dist(bx1, by1) > JOIN_TOLERANCE || dist(bx2, by2) > JOIN_TOLERANCE) return false;
            const t1 = (bx1 - ax1) * ux + (by1 - ay1) * uy, t2 = (bx2 - ax1) * ux + (by2 - ay1) * uy;
            return Math.min(len, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) >= 0.2;
        }

        // Dos polígonos convexos están unidos si no hay hueco mayor que la tolerancia en ningún eje.
        function polygonsJoined(a, b, tol) {
            for (const poly of [a, b]) {
                for (let i = 0; i < poly.length; i++) {
                    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
                    let nx = y1 - y2, ny = x2 - x1;
                    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
                    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
                    a.forEach(([x, y]) => { const d = x * nx + y * ny; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); });
                    b.forEach(([x, y]) => { const d = x * nx + y * ny; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); });
                    if (Math.min(aMax, bMax) - Math.max(aMin, bMin) < -tol) return false;
                }
            }
            return true;
        }

        function computeConstructionNumbering() {
            const caps = computeAutomaticLateralCaps();
            const items = pieces.filter(p => NUMBERED_TYPES.includes(p.type)).concat(caps);
            // El acabado va en la clave: el orden guarda las piezas y tapas, y el informe de gráficas lee su acabado.
            const key = JSON.stringify(items.map(p => [p.id, p.type, p.x, p.y, p.rotation, p.finish, p.printFaces, p.printSide]));
            if (key === numberingCache.key) return numberingCache;

            const nodes = items.map(p => {
                const poly = getFootprintWorld(p);
                return { p, poly, cx: p.x, cy: p.y, minX: Math.min(...poly.map(v => v[0])), minY: Math.min(...poly.map(v => v[1])), links: [] };
            });
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i], b = nodes[j];
                    // Una tapa solo se une a su propia pieza.
                    if (a.p.isAuto && a.p.parentId !== b.p.id) continue;
                    if (b.p.isAuto && b.p.parentId !== a.p.id) continue;
                    // Dos piezas solo forman tramo si están unidas por sus conectores
                    // (una pared apoyada contra la cara de otra no es una unión de montaje).
                    const joined = (a.p.isAuto || b.p.isAuto) ? polygonsJoined(a.poly, b.poly, JOIN_TOLERANCE) : piecesJoinedByPorts(a.p, b.p);
                    if (joined) { a.links.push(b); b.links.push(a); }
                }
            }
            // De izquierda a derecha; con la misma posición (±5 cm), primero la de más arriba.
            const byLeft = (a, b) => (Math.abs(a.minX - b.minX) > 0.05 ? a.minX - b.minX : a.minY - b.minY);

            // Grupos de piezas unidas, ordenados por su pieza más a la izquierda.
            const seen = new Set();
            const groups = [];
            nodes.slice().sort(byLeft).forEach(start => {
                if (seen.has(start)) return;
                const group = [];
                const stack = [start];
                seen.add(start);
                while (stack.length) {
                    const n = stack.pop();
                    group.push(n);
                    n.links.forEach(m => { if (!seen.has(m)) { seen.add(m); stack.push(m); } });
                }
                groups.push(group);
            });

            const order = [];
            const groupOf = new Map();   // id -> letra del tramo
            const labels = new Map();    // id -> «A1», «A2», «B1»…
            groups.forEach((group, groupIndex) => {
                const letter = groupLetter(groupIndex);
                const firstInGroup = order.length;
                // Inicio: el extremo (una sola unión) más a la izquierda; si no hay extremos (anillo), la pieza más a la izquierda.
                const ends = group.filter(n => n.links.length <= 1);
                let current = (ends.length ? ends : group).slice().sort(byLeft)[0];
                const visited = new Set([current]);
                const trail = [current];
                order.push(current.p);
                let dir = null;
                while (visited.size < group.length) {
                    const options = current.links.filter(m => !visited.has(m));
                    if (!options.length) {
                        // Sin salida: retomar desde la última pieza recorrida que aún tenga uniones libres.
                        trail.pop();
                        current = trail[trail.length - 1];
                        dir = null;
                        continue;
                    }
                    // Mayor continuidad: la unión que menos gira respecto a la dirección que se llevaba.
                    const score = m => {
                        const vx = m.cx - current.cx, vy = m.cy - current.cy;
                        const len = Math.hypot(vx, vy) || 1;
                        if (!dir) return -(vx / len) + (m.p.isAuto ? -10 : 0); // al empezar: hacia la derecha
                        return -((vx * dir[0] + vy * dir[1]) / len);
                    };
                    const next = options.sort((a, b) => score(a) - score(b) || byLeft(a, b))[0];
                    const len = Math.hypot(next.cx - current.cx, next.cy - current.cy) || 1;
                    dir = [(next.cx - current.cx) / len, (next.cy - current.cy) / len];
                    current = next;
                    visited.add(current);
                    trail.push(current);
                    order.push(current.p);
                }
                order.slice(firstInGroup).forEach((p, i) => { labels.set(p.id, letter + (i + 1)); groupOf.set(p.id, letter); });
            });

            numberingCache = { key, map: labels, groupOf, order };
            return numberingCache;
        }

        // A, B … Z, AA, AB …
        function groupLetter(i) {
            let s = '';
            for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
            return s;
        }

        // Referencia de una pieza o tapa: letra del tramo + posición («A1»); null si no se numera
        // (mostradores y extras).
        function pieceRefNumber(p) { return computeConstructionNumbering().map.get(p.id) ?? null; }
        function pieceRefLabel(p) { return pieceRefNumber(p) || ''; }
        function pieceGroupLetter(p) { return computeConstructionNumbering().groupOf.get(p.id) || null; }

        // ---------------------------------------------------------------- bloques de planta
        // Vista cenital ortográfica del modelo 3D de la pieza, con fondo transparente.
        const PLAN_SYMBOL_PX_PER_M = 600;
        const planSymbolCache = new Map();
        let planSymbolRenderer = null;
        let planSymbolScene = null;

        function planSymbolKey(p) {
            const painted = p.finish === 'painted';
            return [p.type, painted ? 'p' : 'u', p.type === 'muro' && painted ? (Number(p.printFaces) === 1 ? 1 : 2) : '',
                p.type === 'muro' && painted && Number(p.printFaces) === 1 ? (p.printSide === -1 ? -1 : 1) : ''].join('|');
        }

        function getPlanSymbol(p) {
            const key = planSymbolKey(p);
            if (planSymbolCache.has(key)) return planSymbolCache.get(key);
            if (p.type === 'mesaAlta' && !mesaAltaTemplateForPlan) {
                // El modelo se procesa en segundo plano: mientras tanto se usa el dibujo vectorial.
                loadMesaAltaTemplate().then(t => { if (t) { mesaAltaTemplateForPlan = t; requestBlueprintFrame(); } });
                return null;
            }
            let symbol = null;
            try { symbol = createPlanSymbol(p); }
            catch (e) { console.warn('No se pudo generar el bloque de planta de', p.type, e); }
            planSymbolCache.set(key, symbol);
            return symbol;
        }
        let mesaAltaTemplateForPlan = null;

        function createPlanSymbol(p) {
            if (!planSymbolRenderer) {
                planSymbolRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
                planSymbolRenderer.setPixelRatio(1);
                planSymbolRenderer.setClearColor(0x000000, 0);
                planSymbolScene = new THREE.Scene();
                planSymbolScene.add(new THREE.AmbientLight(0xffffff, 0.62));
                const key = new THREE.DirectionalLight(0xffffff, 0.55);
                key.position.set(0.35, 1, 0.25);
                planSymbolScene.add(key);
                planSymbolScene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.25));
            }
            const object = createPieceObject({ ...p, id: -1, x: 0, y: 0, rotation: 0 });
            // createMesaAltaGroup añade el modelo de forma asíncrona; para el bloque se añade ya.
            if (p.type === 'mesaAlta') object.add(mesaAltaTemplateForPlan.clone());
            // Aristas más marcadas que en 3D: el bloque se lee como dibujo técnico.
            object.traverse(o => {
                if (o.isLineSegments && o.material) { o.material.color.set(0x0b1220); o.material.opacity = 0.85; }
            });
            planSymbolScene.add(object);
            object.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(object);
            if (box.isEmpty()) { planSymbolScene.remove(object); disposeObject3D(object); return null; }

            const pad = 0.004;
            const minX = box.min.x - pad, maxX = box.max.x + pad, minZ = box.min.z - pad, maxZ = box.max.z + pad;
            const w = Math.min(2048, Math.max(8, Math.ceil((maxX - minX) * PLAN_SYMBOL_PX_PER_M)));
            const h = Math.min(2048, Math.max(8, Math.ceil((maxZ - minZ) * PLAN_SYMBOL_PX_PER_M)));
            // Cámara cenital: derecha de la imagen = +X, arriba = -Z (igual que el plano 2D, Y hacia abajo).
            const cam = new THREE.OrthographicCamera(minX, maxX, -minZ, -maxZ, 0.01, 100);
            cam.position.set(0, box.max.y + 10, 0);
            cam.up.set(0, 0, -1);
            cam.lookAt(0, 0, 0);
            planSymbolRenderer.setSize(w, h, false);
            planSymbolRenderer.render(planSymbolScene, cam);

            // Contorno: la silueta se repite desplazada en 8 direcciones y se tiñe de oscuro por debajo
            // del render, así todos los bloques (también mesas y TV, sin aristas) tienen borde de plano.
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const c2d = canvas.getContext('2d');
            const outline = Math.max(2, Math.round(PLAN_SYMBOL_PX_PER_M * 0.004));
            for (let a = 0; a < 8; a++) {
                const ang = a * Math.PI / 4;
                c2d.drawImage(planSymbolRenderer.domElement, Math.cos(ang) * outline, Math.sin(ang) * outline, w, h);
            }
            c2d.globalCompositeOperation = 'source-in';
            c2d.fillStyle = '#475569';  // visible sobre el plano oscuro y sobre el blanco
            c2d.fillRect(0, 0, w, h);
            c2d.globalCompositeOperation = 'source-over';
            c2d.drawImage(planSymbolRenderer.domElement, 0, 0, w, h);
            planSymbolScene.remove(object);
            disposeObject3D(object);
            return { canvas, minX, maxX, minZ, maxZ };
        }

        // Extras (mesas, TV, portacatálogos…): el bloque se dibuja con un contorno fino de color propio,
        // generado a la resolución final (mismo grosor con cualquier zoom, en pantalla y en la hoja impresa).
        const outlinedSymbolCache = new Map();
        function drawSymbolOutlined(ctx, sym, symKey, scale, color) {
            const t = ctx.getTransform();
            const density = Math.hypot(t.a, t.b) || 1;
            const wPx = Math.max(1, Math.round((sym.maxX - sym.minX) * scale * density));
            const hPx = Math.max(1, Math.round((sym.maxZ - sym.minZ) * scale * density));
            const ring = 1.3 * density, pad = Math.ceil(ring) + 1;
            const key = `${symKey}|${wPx}x${hPx}|${color}`;
            let canvas = outlinedSymbolCache.get(key);
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.width = wPx + 2 * pad; canvas.height = hPx + 2 * pad;
                const g = canvas.getContext('2d');
                for (let a = 0; a < 8; a++) {
                    const ang = a * Math.PI / 4;
                    g.drawImage(sym.canvas, pad + Math.cos(ang) * ring, pad + Math.sin(ang) * ring, wPx, hPx);
                }
                g.globalCompositeOperation = 'source-in';
                g.fillStyle = color;
                g.fillRect(0, 0, canvas.width, canvas.height);
                g.globalCompositeOperation = 'source-over';
                g.drawImage(sym.canvas, pad, pad, wPx, hPx);
                if (outlinedSymbolCache.size > 80) outlinedSymbolCache.clear();
                outlinedSymbolCache.set(key, canvas);
            }
            ctx.drawImage(canvas, sym.minX * scale - pad / density, sym.minZ * scale - pad / density, canvas.width / density, canvas.height / density);
        }

        // Dibujo vectorial de respaldo (mientras se genera el bloque o si WebGL no está disponible).
        function drawPieceVector(ctx, p, spec, scale, C, pieceFill) {
                if (p.type === 'esquina45') {
                    let s = 0.65 * scale;
                    let half = s / 2;
                    ctx.beginPath();
                    ctx.moveTo(-half, half);
                    ctx.lineTo(half, half);
                    ctx.lineTo(half, -half);
                    ctx.lineTo(0.025 * scale, -half);
                    ctx.lineTo(-half, 0.025 * scale);
                    ctx.closePath();

                    ctx.fillStyle = pieceFill(p, C.piece);
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = C.stroke;
                    ctx.stroke();
                } else if (p.type === 'focoPala') {
                    const size = 0.29 * scale;
                    ctx.beginPath();
                    ctx.moveTo(0, -size * 0.48);
                    ctx.lineTo(size * 0.48, size * 0.42);
                    ctx.lineTo(-size * 0.48, size * 0.42);
                    ctx.closePath();
                    ctx.fillStyle = pieceFill(p, C.extra);
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = C.stroke;
                    ctx.stroke();
                    // Bombilla blanca dentro del triángulo, con base y pequeños rayos.
                    ctx.save();
                    ctx.strokeStyle = '#fff7cc';
                    ctx.fillStyle = '#fff7cc';
                    ctx.lineWidth = Math.max(1.4, scale * 0.012);
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.arc(0, -size * 0.015, size * 0.13, Math.PI * 0.12, Math.PI * 0.88, true);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(-size * 0.085, size * 0.045);
                    ctx.lineTo(size * 0.085, size * 0.045);
                    ctx.moveTo(-size * 0.065, size * 0.085);
                    ctx.lineTo(size * 0.065, size * 0.085);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(0, -size * 0.26); ctx.lineTo(0, -size * 0.20);
                    ctx.moveTo(-size * 0.23, -size * 0.08); ctx.lineTo(-size * 0.18, -size * 0.045);
                    ctx.moveTo(size * 0.23, -size * 0.08); ctx.lineTo(size * 0.18, -size * 0.045);
                    ctx.stroke();
                    ctx.restore();
                } else if (p.type === 'tvSoporte') {
                    // Símbolo 2D compacto: soporte/pantalla central y barra fina, sin el óvalo ni el texto grandes.
                    const w = 1.25 * scale, h = 0.34 * scale;
                    const activeColor = pieceFill(p, C.extra);
                    ctx.save();
                    ctx.fillStyle = activeColor;
                    ctx.strokeStyle = C.stroke;
                    ctx.lineWidth = 1.2;
                    // Placa posterior, centrada y discreta.
                    ctx.fillRect(-w * 0.39, -h * 0.48, w * 0.78, h * 0.96);
                    ctx.strokeRect(-w * 0.39, -h * 0.48, w * 0.78, h * 0.96);
                    // Barra frontal fina que cruza el centro, como en la referencia.
                    ctx.fillRect(-w * 0.5, -h * 0.12, w, h * 0.24);
                    ctx.strokeRect(-w * 0.5, -h * 0.12, w, h * 0.24);
                    // Pequeño indicador central.
                    ctx.beginPath();
                    ctx.arc(0, 0, Math.max(1.8, h * 0.055), 0, Math.PI * 2);
                    ctx.fillStyle = '#f59e0b';
                    ctx.fill();
                    ctx.strokeStyle = C.stroke;
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                    ctx.restore();
                } else if (p.type === 'mesaSillas') {
                    const side = 1.3 * scale;
                    const seat = side * 0.29;
                    ctx.fillStyle = pieceFill(p, C.extra);
                    ctx.strokeStyle = C.stroke; ctx.lineWidth = 1.5;
                    // Mesa central y cuatro sillas giradas 45 grados, siguiendo la referencia.
                    ctx.beginPath(); ctx.arc(0, 0, side * 0.245, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sy]) => {
                        ctx.save(); ctx.translate(sx * side * 0.315, sy * side * 0.315); ctx.rotate(Math.PI / 4);
                        ctx.beginPath(); ctx.roundRect(-seat/2, -seat/2, seat, seat, Math.max(2, seat*0.08)); ctx.fill(); ctx.stroke(); ctx.restore();
                    });
                } else if (p.type === 'mesaAlta') {
                    // Planta 2D según la referencia: tres círculos alineados,
                    // con el central mayor y dos taburetes laterales más pequeños.
                    const w = 1.2 * scale;
                    const centralR = 0.275 * scale;
                    const sideR = 0.16 * scale;
                    const sideOffset = 0.44 * scale;
                    ctx.fillStyle = pieceFill(p, C.extra);
                    ctx.strokeStyle = C.stroke;
                    ctx.lineWidth = 1.5;
                    [[0, 0, centralR], [-sideOffset, 0, sideR], [sideOffset, 0, sideR]].forEach(([x, y, r]) => {
                        ctx.beginPath();
                        ctx.arc(x, y, r, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                    });
                } else if (p.type === 'portaCatalogos') {
                    const side = 0.28 * scale;
                    const x = -side / 2, y = -side / 2;
                    ctx.fillStyle = pieceFill(p, C.extra);
                    ctx.strokeStyle = C.stroke;
                    ctx.lineWidth = 1.5;
                    ctx.fillRect(x, y, side, side);
                    ctx.strokeRect(x, y, side, side);
                    // Dos huecos/bolsillos horizontales como en la referencia aportada.
                    ctx.fillStyle = 'rgba(226,232,240,0.16)';
                    ctx.strokeStyle = C.stroke;
                    ctx.lineWidth = 0.8;
                    ctx.strokeRect(x + side * 0.09, y + side * 0.12, side * 0.82, side * 0.20);
                    ctx.strokeRect(x + side * 0.13, y + side * 0.38, side * 0.74, side * 0.20);
                } else if (p.type === 'pico') {
                    let bw = 0.35 * scale;
                    let backY = -0.24 * scale;
                    let shoulderY = 0.06 * scale;
                    let tipY = 0.24 * scale;

                    ctx.beginPath();
                    ctx.moveTo(-bw / 2, backY);
                    ctx.lineTo(bw / 2, backY);
                    ctx.lineTo(bw / 2, shoulderY);
                    ctx.lineTo(0, tipY);
                    ctx.lineTo(-bw / 2, shoulderY);
                    ctx.closePath();

                    ctx.fillStyle = pieceFill(p, C.piece);
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = C.stroke;
                    ctx.stroke();
                } else if (p.type === 'picodoble') {
                    let bw = 0.35 * scale;
                    let halfW = bw / 2;
                    let halfSide = 0.15 * scale;
                    let tipOffset = 0.33 * scale;

                    ctx.beginPath();
                    ctx.moveTo(0, -tipOffset);
                    ctx.lineTo(halfW, -halfSide);
                    ctx.lineTo(halfW, halfSide);
                    ctx.lineTo(0, tipOffset);
                    ctx.lineTo(-halfW, halfSide);
                    ctx.lineTo(-halfW, -halfSide);
                    ctx.closePath();

                    ctx.fillStyle = pieceFill(p, C.piece);
                    ctx.fill();
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = C.stroke;
                    ctx.stroke();
                } else {
                    let pw = spec.width * scale;
                    let ph = spec.depth * scale;
                    ctx.fillStyle = pieceFill(p, C.piece);
                    ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = C.stroke;
                    ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
                }

        }

        const EXTRA_PLAN_TYPES = ['focoPala', 'tvSoporte', 'mesaSillas', 'mesaAlta', 'portaCatalogos'];

        // Marca de impresión: banda de color en cada cara impresa (a una cara, solo en ese lado). En esquinas y
        // picos, la banda sigue la cara impresa (graficas.js): exterior de la esquina 90º, diagonal de la 45º,
        // punta o trasera del pico y las dos puntas del pico doble. Lo demás impreso lleva la etiqueta «IMP».
        function drawPrintedFaces(ctx, faces, scale, t) {
            faces.forEach(face => {
                for (let i = 0; i < face.path.length - 1; i++) {
                    const [ax, ay] = face.path[i], [bx, by] = face.path[i + 1];
                    let nx = ay - by, ny = bx - ax;
                    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
                    if (nx * (ax + bx) + ny * (ay + by) < 0) { nx = -nx; ny = -ny; }   // normal hacia fuera
                    const k = t / scale;                                               // banda hacia dentro
                    ctx.beginPath();
                    ctx.moveTo(ax * scale, ay * scale);
                    ctx.lineTo(bx * scale, by * scale);
                    ctx.lineTo((bx - nx * k) * scale, (by - ny * k) * scale);
                    ctx.lineTo((ax - nx * k) * scale, (ay - ny * k) * scale);
                    ctx.closePath();
                    ctx.fill();
                }
            });
        }
        function drawPrintedMarker(ctx, p, spec, scale, C, sym) {
            if (p.finish !== 'painted' || EXTRA_PLAN_TYPES.includes(p.type)) return;
            ctx.save();
            ctx.fillStyle = C.printed;
            // Extensión real del bloque (el panel 1C es más estrecho que su ficha).
            const x0 = (sym ? sym.minX + 0.006 : -spec.width / 2) * scale, x1 = (sym ? sym.maxX - 0.006 : spec.width / 2) * scale;
            const z0 = (sym ? sym.minZ + 0.004 : -spec.depth / 2) * scale, z1 = (sym ? sym.maxZ - 0.004 : spec.depth / 2) * scale;
            const t = Math.max(3, 0.035 * scale);
            const face = side => ctx.fillRect(x0, side > 0 ? z1 - t : z0, x1 - x0, t);
            if (p.type === 'muro') {
                if (Number(p.printFaces) === 1) face(p.printSide === -1 ? -1 : 1);
                else { face(-1); face(1); }
            } else if (p.type === 'muro1c') {
                face(1);
            } else if (p.type === 'mostrador' || p.type === 'mostrador1m') {
                face(p.printSide === -1 ? -1 : 1);   // solo el frente impreso
            } else if (['esquina', 'esquina45', 'pico', 'picodoble'].includes(p.type) && typeof window.ecowallPieceFaces === 'function') {
                drawPrintedFaces(ctx, window.ecowallPieceFaces(p).filter(f => f.printed), scale, t);
            } else {
                const r = Math.max(5, 0.05 * scale);
                ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${Math.max(6, r * 0.9)}px Inter, sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('IMP', 0, 0.5);
            }
            ctx.restore();
        }

        function fitTextLines(ctx, text, maxWidth, maxLines, startSize, minSize, weight = 'bold') {
            const words = String(text || '').split(/\s+/).filter(Boolean);
            for (let size = startSize; size >= minSize; size--) {
                ctx.font = `${weight} ${size}px Inter, sans-serif`;
                const lines = [];
                let line = '';
                words.forEach(word => {
                    const candidate = line ? `${line} ${word}` : word;
                    if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
                    else line = candidate;
                });
                if (line) lines.push(line);
                if (lines.length <= maxLines || size === minSize) return { lines, size };
            }
            return { lines: [], size: minSize };
        }

        function drawHaloText(ctx, text, x, y, C, maxWidth) {
            ctx.lineJoin = 'round';
            ctx.lineWidth = 3;
            ctx.strokeStyle = C.labelHalo;
            ctx.strokeText(text, x, y, maxWidth);
            ctx.fillStyle = C.label;
            ctx.fillText(text, x, y, maxWidth);
        }

        // Etiqueta de pieza: nombre a lo largo de la pieza (nunca boca abajo) o nº de referencia.
        function drawPieceLabel(ctx, p, spec, scale, C, mode) {
            if (mode === 'none') return;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Las piezas sin número (mostradores, extras) muestran su nombre también en modo «Nº».
            if (mode === 'number' && pieceRefNumber(p) === null) mode = 'name';
            if (mode === 'number') {
                const label = pieceRefLabel(p);
                const k = C.tagScale || 1;   // en el plano impreso los números van algo mayores
                ctx.font = `bold ${Math.round(10 * k)}px Inter, sans-serif`;
                const r = Math.max(8 * k, ctx.measureText(label).width / 2 + 4 * k);
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = C.stroke;
                ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#0f172a';
                ctx.fillText(label, 0, 0.5);
            } else {
                const rot = ((p.rotation % 360) + 360) % 360;
                let angle = THREE.MathUtils.degToRad(p.rotation);
                if (rot > 90 && rot <= 270) angle += Math.PI;
                ctx.rotate(angle);
                const along = (p.type === 'esquina45' ? 0.65 : spec.width) * scale * 0.9;
                const fit = fitTextLines(ctx, p.type === 'focoPala' ? '' : spec.name, Math.max(18, along), 2, 9, 5);
                const lh = fit.size + 1;
                fit.lines.forEach((line, i) => drawHaloText(ctx, line, 0, (i - (fit.lines.length - 1) / 2) * lh, C, Math.max(18, along)));
            }
            ctx.restore();
        }

        // Al seleccionar una esquina se marcan sus lados de unión (JOIN_FACES) con una barra turquesa (color de las guías).
        function drawJoinIndicators(ctx, p, scale, C) {
            const faces = JOIN_FACES[p.type];
            if (!faces) return;
            ctx.save();
            ctx.strokeStyle = C.alignGuide;
            ctx.lineCap = 'round';
            ctx.lineWidth = Math.max(4, 0.025 * scale);
            ctx.shadowColor = 'rgba(34, 211, 238, 0.6)';
            ctx.shadowBlur = 6;
            faces.forEach(([[x1, y1], [x2, y2]]) => {
                ctx.beginPath();
                ctx.moveTo(x1 * scale, y1 * scale);
                ctx.lineTo(x2 * scale, y2 * scale);
                ctx.stroke();
            });
            ctx.restore();
        }

        function drawLockBadge(ctx, C) {
            ctx.save();
            ctx.fillStyle = C.lock;
            ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#1f2937';
            ctx.fillRect(-3, -1, 6, 4.5);
            ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1.3;
            ctx.beginPath(); ctx.arc(0, -1.5, 2.3, Math.PI, 0); ctx.stroke();
            ctx.restore();
        }

        // ---------------------------------------------------------------- dibujo del plano
        // Plano de trabajo en pantalla, a la densidad real de la pantalla (nítido en Retina /
        // escalado de Windows); las coordenadas de ratón y canvas.dataset siguen en píxeles CSS.
        function drawBlueprint2D() {
            if (currentMode !== '2d') return;
            const canvas = document.getElementById('blueprint-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const cssW = canvas.parentElement.clientWidth;
            const cssH = canvas.parentElement.clientHeight;
            const dpr = Math.min(window.devicePixelRatio || 1, 3);
            // Redimensionar un canvas reinicia su contexto y fuerza trabajo extra: solo si cambia.
            const desiredWidth = Math.round(cssW * dpr);
            const desiredHeight = Math.round(cssH * dpr);
            if (canvas.width !== desiredWidth) canvas.width = desiredWidth;
            if (canvas.height !== desiredHeight) canvas.height = desiredHeight;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);

            const frame = renderBlueprint(ctx, cssW, cssH, { theme: 'screen', zoom: blueprintZoom, panX: blueprintPanX, panY: blueprintPanY, interactive: true, labels: planLabelMode });
            canvas.dataset.scale = frame.scale;
            canvas.dataset.originX = frame.originX;
            canvas.dataset.originY = frame.originY;
            updateOverlapHud();
            updateInspectorFields();
        }

        // Dibuja el plano en cualquier contexto (pantalla o informe). Devuelve el encuadre usado.
        // opts: theme, zoom, panX, panY, interactive (selección, avisos y ayudas de edición),
        // labels ('name' | 'number' | 'none'), o un encuadre fijo (scale, originX, originY).
        function renderBlueprint(ctx, viewW, viewH, opts = {}) {
            const C = BLUEPRINT_THEMES[opts.theme] || BLUEPRINT_THEMES.screen;
            const interactive = !!opts.interactive;
            const labels = opts.labels || 'name';
            const overlapping = interactive ? getOverlappingPieceIds() : new Set();

            let scale, originX, originY;
            if (Number.isFinite(opts.scale)) {
                scale = opts.scale; originX = opts.originX; originY = opts.originY;
            } else {
                const padding = 50;
                const availW = viewW - padding * 2;
                const availH = Math.max(1, viewH - padding * 2);
                scale = Math.min(availW / project.widthMeters, availH / project.depthMeters) * (opts.zoom || 1);
                originX = (viewW - project.widthMeters * scale) / 2 + (opts.panX || 0);
                originY = padding + (availH - project.depthMeters * scale) / 2 + (opts.panY || 0);
            }
            const roomW = project.widthMeters * scale, roomH = project.depthMeters * scale;

            ctx.fillStyle = C.roomFill;
            ctx.fillRect(originX, originY, roomW, roomH);

            // Rejilla: 1 m y, si hay espacio, subdivisión de 0,5 m.
            const gridLine = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
            ctx.lineWidth = 1;
            if (scale * 0.5 > 22) {
                ctx.strokeStyle = C.gridMinor;
                for (let x = 0.5; x < project.widthMeters; x += 1) gridLine(originX + x * scale, originY, originX + x * scale, originY + roomH);
                for (let y = 0.5; y < project.depthMeters; y += 1) gridLine(originX, originY + y * scale, originX + roomW, originY + y * scale);
            }
            ctx.strokeStyle = C.grid;
            for (let x = 1; x < project.widthMeters; x += 1) gridLine(originX + x * scale, originY, originX + x * scale, originY + roomH);
            for (let y = 1; y < project.depthMeters; y += 1) gridLine(originX, originY + y * scale, originX + roomW, originY + y * scale);

            ctx.strokeStyle = C.roomStroke;
            ctx.lineWidth = C.roomStrokeWidth;
            ctx.strokeRect(originX, originY, roomW, roomH);

            if (interactive) {
                ctx.fillStyle = C.roomText;
                ctx.font = '600 11px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(`${formatMeters(project.widthMeters)} m`, originX + roomW / 2, originY - 10);
                ctx.save();
                ctx.translate(originX - 10, originY + roomH / 2);
                ctx.rotate(-Math.PI / 2);
                ctx.fillText(`${formatMeters(project.depthMeters)} m`, 0, 0);
                ctx.restore();
            }

            const place = p => {
                ctx.translate(originX + p.x * scale, originY + p.y * scale);
                ctx.rotate(THREE.MathUtils.degToRad(p.rotation));
            };

            // 1) piezas (bloques de planta)
            pieces.forEach(p => {
                const spec = PIECE_SPECS[p.type];
                ctx.save();
                place(p);
                const sym = getPlanSymbol(p);
                if (sym && EXTRA_PLAN_TYPES.includes(p.type)) drawSymbolOutlined(ctx, sym, planSymbolKey(p), scale, C.extraOutline);
                else if (sym) ctx.drawImage(sym.canvas, sym.minX * scale, sym.minZ * scale, (sym.maxX - sym.minX) * scale, (sym.maxZ - sym.minZ) * scale);
                else drawPieceVector(ctx, p, spec, scale, C, (piece, base) => base);
                drawPrintedMarker(ctx, p, spec, scale, C, sym);

                if (interactive && isPieceSelected2D(p.id)) {
                    ctx.save();
                    ctx.beginPath();
                    getFootprintLocal(p).forEach(([x, y], i) => i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale));
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';
                    ctx.fill();
                    ctx.strokeStyle = C.selected;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.restore();
                    drawJoinIndicators(ctx, p, scale, C);
                }
                if (overlapping.has(p.id)) {
                    // Aviso de solape: contorno rojo discontinuo sobre la huella de la pieza.
                    ctx.save();
                    ctx.strokeStyle = C.overlap;
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 3]);
                    ctx.beginPath();
                    getFootprintLocal(p).forEach(([x, y], i) => i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale));
                    ctx.closePath();
                    ctx.stroke();
                    ctx.restore();
                }
                ctx.restore();
            });

            // 2) tapas laterales automáticas
            computeAutomaticLateralCaps().forEach(cap => {
                const spec = PIECE_SPECS['lateral'];
                const cw = spec.width * scale, ch = spec.depth * scale;
                ctx.save();
                place(cap);
                ctx.fillStyle = cap.finish === 'painted' ? C.printed : C.cap;
                ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
                ctx.lineWidth = 0.8;
                ctx.strokeStyle = C.stroke;
                ctx.strokeRect(-cw / 2, -ch / 2, cw, ch);
                ctx.restore();
            });

            // 3) etiquetas y candados (encima de todo para que se lean)
            pieces.forEach(p => {
                ctx.save();
                ctx.translate(originX + p.x * scale, originY + p.y * scale);
                drawPieceLabel(ctx, p, PIECE_SPECS[p.type], scale, C, labels);
                if (interactive && p.locked) { ctx.translate(-getRotatedBoundingBox(p).w / 2 * scale + 7, -getRotatedBoundingBox(p).h / 2 * scale + 7); drawLockBadge(ctx, C); }
                ctx.restore();
            });
            // Las tapas laterales también llevan número.
            if (labels === 'number') {
                computeAutomaticLateralCaps().forEach(cap => {
                    ctx.save();
                    ctx.translate(originX + cap.x * scale, originY + cap.y * scale);
                    drawPieceLabel(ctx, cap, PIECE_SPECS.lateral, scale, C, 'number');
                    ctx.restore();
                });
            }

            if (interactive) {
                drawAlignmentGuides(ctx, C, scale, originX, originY);
                drawLiveDimensions(ctx, C, scale, originX, originY);
                drawScaleBar(ctx, C, scale, 16, viewH - 18);
            }

            if (interactive && blueprintSelectionOverlay) {
                const a = blueprintSelectionOverlay.start, b = blueprintSelectionOverlay.end;
                const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
                const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
                ctx.save(); ctx.fillStyle = 'rgba(99,102,241,0.16)'; ctx.strokeStyle = '#818cf8';
                ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
                ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); ctx.restore();
            }
            return { scale, originX, originY };
        }

        const formatMeters = m => (Math.round(m * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formatMm = m => Math.round(m * 1000).toLocaleString('es-ES');

        // Escala gráfica (1 m, o 0,5 m si 1 m no cabe).
        function drawScaleBar(ctx, C, scale, x, y) {
            let meters = 1;
            if (scale > 260) meters = 0.5;
            if (scale < 40) meters = 2;
            const len = meters * scale;
            ctx.save();
            ctx.strokeStyle = C.roomText; ctx.fillStyle = C.roomText; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 4); ctx.stroke();
            ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillText(`${formatMeters(meters)} m`, x + len + 6, y + 1);
            ctx.restore();
        }

        // Cotas en vivo mientras se arrastra una pieza: distancia (mm) a las paredes del espacio más cercanas.
        function drawLiveDimensions(ctx, C, scale, ox, oy) {
            if (!isDragging2D || dragPieceId === null || multiSelectEnabled) return;
            const p = pieces.find(x => x.id === dragPieceId);
            if (!p) return;
            const bb = getRotatedBoundingBox(p);
            const left = p.x - bb.w / 2, right = project.widthMeters - (p.x + bb.w / 2);
            const top = p.y - bb.h / 2, bottom = project.depthMeters - (p.y + bb.h / 2);
            ctx.save();
            ctx.strokeStyle = C.dim; ctx.fillStyle = C.dim; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
            ctx.font = 'bold 11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const label = (text, x, y) => {
                const w = ctx.measureText(text).width + 10;
                ctx.save(); ctx.setLineDash([]); ctx.fillStyle = '#0b1220'; ctx.fillRect(x - w / 2, y - 9, w, 18);
                ctx.strokeRect(x - w / 2, y - 9, w, 18); ctx.fillStyle = C.dim; ctx.fillText(text, x, y); ctx.restore();
            };
            const cy = oy + p.y * scale, cx = ox + p.x * scale;
            if (left <= right) {
                ctx.beginPath(); ctx.moveTo(ox, cy); ctx.lineTo(ox + left * scale, cy); ctx.stroke();
                label(formatMm(left), ox + left * scale / 2, cy);
            } else {
                const x0 = ox + (p.x + bb.w / 2) * scale;
                ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(ox + project.widthMeters * scale, cy); ctx.stroke();
                label(formatMm(right), x0 + right * scale / 2, cy);
            }
            if (top <= bottom) {
                ctx.beginPath(); ctx.moveTo(cx, oy); ctx.lineTo(cx, oy + top * scale); ctx.stroke();
                label(formatMm(top), cx, oy + top * scale / 2);
            } else {
                const y0 = oy + (p.y + bb.h / 2) * scale;
                ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, oy + project.depthMeters * scale); ctx.stroke();
                label(formatMm(bottom), cx, y0 + bottom * scale / 2);
            }
            ctx.restore();
        }

        // ---------------------------------------------------------------- guías de alineación
        // Si la pieza arrastrada no se ha unido por conector, se alinea (±4 cm) con bordes o
        // centros de las demás piezas y se dibuja la guía.
        const ALIGN_TOLERANCE = 0.04;
        let planAlignGuides = [];
        function applyAlignmentGuides(p) {
            planAlignGuides = [];
            const bb = getRotatedBoundingBox(p);
            const mine = { x: [p.x - bb.w / 2, p.x, p.x + bb.w / 2], y: [p.y - bb.h / 2, p.y, p.y + bb.h / 2] };
            for (const axis of ['x', 'y']) {
                let best = null;
                pieces.forEach(o => {
                    if (o.id === p.id) return;
                    const ob = getRotatedBoundingBox(o);
                    const targets = axis === 'x' ? [o.x - ob.w / 2, o.x, o.x + ob.w / 2] : [o.y - ob.h / 2, o.y, o.y + ob.h / 2];
                    mine[axis].forEach(m => targets.forEach(t => {
                        const d = t - m;
                        if (Math.abs(d) <= ALIGN_TOLERANCE && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
                    }));
                });
                if (best) {
                    p[axis] = Number((p[axis] + best.d).toFixed(3));
                    best.at = Number(best.at.toFixed(3));
                    planAlignGuides.push({ axis, at: best.at });
                }
            }
            clampPieceToBounds(p);
        }
        function clearAlignmentGuides() { planAlignGuides = []; }
        function drawAlignmentGuides(ctx, C, scale, ox, oy) {
            if (!isDragging2D || !planAlignGuides.length) return;
            ctx.save();
            ctx.strokeStyle = C.alignGuide; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
            planAlignGuides.forEach(g => {
                ctx.beginPath();
                if (g.axis === 'x') { ctx.moveTo(ox + g.at * scale, oy); ctx.lineTo(ox + g.at * scale, oy + project.depthMeters * scale); }
                else { ctx.moveTo(ox, oy + g.at * scale); ctx.lineTo(ox + project.widthMeters * scale, oy + g.at * scale); }
                ctx.stroke();
            });
            ctx.restore();
        }

        // ---------------------------------------------------------------- solapes entre piezas
        // Huella en planta de cada pieza (coordenadas locales, metros), igual que su dibujo 2D.
        function getFootprintLocal(p) {
            const spec = PIECE_SPECS[p.type];
            if (p.type === 'esquina45') {
                const h = 0.325;
                return [[-h, h], [h, h], [h, -h], [0.025, -h], [-h, 0.025]];
            }
            if (p.type === 'pico') return [[-0.175, -0.24], [0.175, -0.24], [0.175, 0.06], [0, 0.24], [-0.175, 0.06]];
            if (p.type === 'picodoble') return [[0, -0.33], [0.175, -0.15], [0.175, 0.15], [0, 0.33], [-0.175, 0.15], [-0.175, -0.15]];
            const w = spec.width / 2, d = spec.depth / 2;
            return [[-w, -d], [w, -d], [w, d], [-w, d]];
        }
        function getFootprintWorld(p) {
            const rad = THREE.MathUtils.degToRad(p.rotation);
            const cos = Math.cos(rad), sin = Math.sin(rad);
            return getFootprintLocal(p).map(([x, y]) => [p.x + x * cos - y * sin, p.y + x * sin + y * cos]);
        }
        // Penetración mínima entre dos polígonos convexos (teorema del eje separador); 0 si no se tocan.
        function polygonPenetration(a, b) {
            let min = Infinity;
            for (const poly of [a, b]) {
                for (let i = 0; i < poly.length; i++) {
                    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
                    let nx = y1 - y2, ny = x2 - x1;
                    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
                    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
                    a.forEach(([x, y]) => { const d = x * nx + y * ny; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); });
                    b.forEach(([x, y]) => { const d = x * nx + y * ny; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); });
                    const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
                    if (overlap <= 0) return 0;
                    min = Math.min(min, overlap);
                }
            }
            return min;
        }
        // Piezas que se pisan más de 1,5 cm. Las piezas unidas por sus conectores solo se tocan.
        // El foco pala se monta sobre los paneles y no cuenta.
        const OVERLAP_TOLERANCE = 0.015;
        let overlapCache = { key: null, ids: new Set() };
        function getOverlappingPieceIds() {
            const key = JSON.stringify(pieces.map(p => [p.id, p.type, p.x, p.y, p.rotation]));
            if (key === overlapCache.key) return overlapCache.ids;
            const list = pieces.filter(p => p.type !== 'focoPala').map(p => ({ p, poly: getFootprintWorld(p), bb: getRotatedBoundingBox(p) }));
            const ids = new Set();
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const A = list[i], B = list[j];
                    if (Math.abs(A.p.x - B.p.x) * 2 > A.bb.w + B.bb.w || Math.abs(A.p.y - B.p.y) * 2 > A.bb.h + B.bb.h) continue;
                    if (polygonPenetration(A.poly, B.poly) > OVERLAP_TOLERANCE) { ids.add(A.p.id); ids.add(B.p.id); }
                }
            }
            // Las tapas también cuentan: si la tapa de un panel pisa otra pieza, se marcan el panel y esa pieza.
            computeAutomaticLateralCaps().forEach(cap => {
                const capPoly = getFootprintWorld({ ...cap, type: 'lateral' });
                list.forEach(B => {
                    if (B.p.id === cap.parentId || EXTRA_PLAN_TYPES.includes(B.p.type)) return;
                    if (polygonPenetration(capPoly, B.poly) > OVERLAP_TOLERANCE) { ids.add(cap.parentId); ids.add(B.p.id); }
                });
            });
            overlapCache = { key, ids };
            return ids;
        }
        function updateOverlapHud() {
            const hud = document.getElementById('overlap-hud');
            if (!hud) return;
            const count = getOverlappingPieceIds().size;
            hud.classList.toggle('hidden', count === 0);
            const text = document.getElementById('overlap-hud-text');
            if (text) text.textContent = `${count} piezas se solapan (marcadas en rojo)`;
        }

        // ---------------------------------------------------------------- inspector: nº y bloqueo
        function updateInspectorFields() {
            updateGroupLockButton();
            const box = document.getElementById('inspector-position');
            if (!box) return;
            const p = selectedPieceId !== null && !multiSelectEnabled ? pieces.find(x => x.id === selectedPieceId) : null;
            box.classList.toggle('hidden', !p);
            if (!p) return;
            const ref = document.getElementById('insp-ref');
            const number = pieceRefLabel(p);
            if (ref) ref.textContent = (number ? `Nº ${number} · ` : '') + PIECE_SPECS[p.type].name;
            const lock = document.getElementById('insp-lock');
            if (lock) {
                lock.innerHTML = p.locked ? '<i class="fa-solid fa-lock"></i> Bloqueada' : '<i class="fa-solid fa-lock-open"></i> Bloquear';
                lock.classList.toggle('bg-amber-600', !!p.locked);
                lock.classList.toggle('bg-slate-800', !p.locked);
            }
        }
        function toggleSelectedPieceLock() {
            const p = pieces.find(x => x.id === selectedPieceId);
            if (!p) return;
            saveState();
            p.locked = !p.locked;
            drawBlueprint2D();
        }

        // Multiselección: si todas están bloqueadas se desbloquean; si no, se bloquean todas.
        function getSelectionGroupPieces() {
            return multiSelectEnabled ? pieces.filter(p => selectedPieceIds.has(p.id)) : [];
        }
        function toggleSelectionGroupLock() {
            const group = getSelectionGroupPieces();
            if (!group.length) return;
            const lock = !group.every(p => p.locked);
            saveState();
            group.forEach(p => { p.locked = lock; });
            drawBlueprint2D();
        }
        function updateGroupLockButton() {
            const btn = document.getElementById('insp-multi-lock');
            if (!btn) return;
            const group = getSelectionGroupPieces();
            const locked = group.filter(p => p.locked).length;
            const allLocked = group.length > 0 && locked === group.length;
            btn.innerHTML = allLocked ? '<i class="fa-solid fa-lock-open"></i> Desbloquear conjunto' : '<i class="fa-solid fa-lock"></i> Bloquear conjunto';
            btn.classList.toggle('bg-amber-600', allLocked);
            btn.classList.toggle('bg-slate-800', !allLocked);
            const state = document.getElementById('insp-multi-lock-state');
            if (state) state.textContent = locked ? `${locked} de ${group.length} bloqueadas` : 'Ninguna bloqueada';
        }

        // ---------------------------------------------------------------- tramos de pared
        // Tramos rectos y continuos de paneles (también los usan las cotas y los alzados).
        function computeWallRuns() {
            const eligible = pieces.filter(p => !['mostrador', 'mostrador1m', 'lateral', ...EXTRA_PLAN_TYPES].includes(p.type));
            const all = eligible.concat(computeAutomaticLateralCaps());
            const runs = [];
            const EPS = 0.035;
            for (const axis of ['x', 'y']) {
                const candidates = all.filter(p => {
                    if (p.type === 'esquina' || p.type === 'esquina45') return true;
                    // Las tapas están giradas 90º respecto a su pared: cuentan en la dirección de la pared.
                    const rot = p.isAuto ? p.rotation - 90 : p.rotation;
                    const r = ((rot % 180) + 180) % 180;
                    return axis === 'x' ? Math.abs(r) < 1 : Math.abs(r - 90) < 1;
                }).map(p => {
                    const bb = getRotatedBoundingBox(p);
                    const lane = wallLaneOf(p, axis);
                    return { p, lo: (axis === 'x' ? p.x - bb.w / 2 : p.y - bb.h / 2),
                        hi: (axis === 'x' ? p.x + bb.w / 2 : p.y + bb.h / 2),
                        lane: lane ? lane.lane : (axis === 'x' ? p.y : p.x),
                        thickness: lane ? lane.thickness : (axis === 'x' ? bb.h : bb.w) };
                }).sort((a, b) => a.lane - b.lane || a.lo - b.lo);
                // Primero las filas de paredes; después cada esquina se suma a la fila más cercana si está a
                // menos de media pared (puede unirse por cualquiera de sus conectores), o forma la suya.
                const lanes = [];
                const isCorner = c => c.p.type === 'esquina' || c.p.type === 'esquina45';
                for (const c of candidates.filter(c => !isCorner(c))) {
                    let lane = lanes.find(l => Math.abs(l.center - c.lane) <= 0.06);
                    if (!lane) { lane = { center: c.lane, members: [] }; lanes.push(lane); }
                    lane.members.push(c);
                }
                for (const c of candidates.filter(isCorner)) {
                    const near = lanes.filter(l => Math.abs(l.center - c.lane) <= 0.17)
                        .sort((a, b) => Math.abs(a.center - c.lane) - Math.abs(b.center - c.lane))[0];
                    if (near) near.members.push(c);
                    else lanes.push({ center: c.lane, members: [c] });
                }
                for (const lane of lanes) {
                    lane.members.sort((a, b) => a.lo - b.lo);
                    let run = null;
                    const flush = () => {
                        if (run && run.members.some(m => m.p.type !== 'esquina' && m.p.type !== 'esquina45' && m.p.type !== 'lateral') && run.hi - run.lo > 0.09)
                            runs.push({ ...run, axis, lane: lane.center });
                    };
                    for (const c of lane.members) {
                        if (!run || c.lo > run.hi + EPS) {
                            flush(); run = { lo: c.lo, hi: c.hi, members: [c], thickness: c.thickness };
                        } else {
                            run.hi = Math.max(run.hi, c.hi);
                            run.members.push(c);
                            run.thickness = Math.max(run.thickness, c.thickness);
                        }
                    }
                    flush();
                }
            }
            // Esquinas sueltas (sin pared en su tramo): cota propia de ancho (debajo) y fondo (a la derecha).
            const inRuns = new Set(runs.flatMap(r => r.members.map(m => m.p.id)));
            pieces.filter(p => (p.type === 'esquina' || p.type === 'esquina45') && !inRuns.has(p.id)).forEach(p => {
                const bb = getRotatedBoundingBox(p);
                runs.push({ axis: 'x', lo: p.x - bb.w / 2, hi: p.x + bb.w / 2, lane: p.y, thickness: bb.h, members: [{ p }], placement: 'after' });
                runs.push({ axis: 'y', lo: p.y - bb.h / 2, hi: p.y + bb.h / 2, lane: p.x, thickness: bb.w, members: [{ p }], placement: 'after' });
            });
            return runs;
        }

        // Línea de pared de una pieza en un eje: el pico y la esquina 45º no tienen su centro en la línea
        // de las paredes a las que se unen; se usa la línea de sus conectores para que el tramo sea continuo.
        // Devuelve { lane, thickness } o null (se usa el centro de la pieza).
        function wallLaneOf(p, axis) {
            const rad = THREE.MathUtils.degToRad(p.rotation);
            const c = Math.cos(rad), s = Math.sin(rad);
            const toWorld = (lx, ly) => [p.x + lx * c - ly * s, p.y + lx * s + ly * c];
            const along = axis === 'x' ? 1 : 0;
            if (p.type === 'pico') {
                const pt = toWorld(0, -0.09);
                return { lane: axis === 'x' ? pt[1] : pt[0], thickness: 0.3 };
            }
            if (p.type === 'esquina45') {
                // Dos uniones: una a lo largo del eje local X (en y = 0,1625) y otra del eje local Y (en x = 0,1625).
                const lines = [
                    { pt: toWorld(-0.325, 0.1625), dir: [c, s] },
                    { pt: toWorld(0.1625, -0.325), dir: [-s, c] }
                ];
                const line = lines.find(l => Math.abs(l.dir[along ? 0 : 1]) > 0.9);
                if (line) return { lane: axis === 'x' ? line.pt[1] : line.pt[0], thickness: 0.3 };
            }
            return null;
        }

        // ---------------------------------------------------------------- hoja técnica (informe)
        // Escalas normalizadas. La hoja se imprime a escala real en A3 (área útil del informe 273 × 396 mm).
        const SHEET_SCALES = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500];
        function pickSheetScale(widthM, heightM, maxWmm, maxHmm) {
            return SHEET_SCALES.find(s => widthM * 1000 / s <= maxWmm && heightM * 1000 / s <= maxHmm) || SHEET_SCALES[SHEET_SCALES.length - 1];
        }

        function dimensionHelpers(ctx) {
            const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
            const tick = (x, y) => line(x - 5, y + 5, x + 5, y - 5);
            const boxedText = (text, x, y, color, rotate = false) => {
                ctx.save(); ctx.translate(x, y); if (rotate) ctx.rotate(-Math.PI / 2);
                const w = ctx.measureText(text).width + 10;
                ctx.fillStyle = '#ffffff'; ctx.fillRect(-w / 2, -9, w, 18);
                ctx.fillStyle = color; ctx.fillText(text, 0, 0); ctx.restore();
            };
            return { line, tick, boxedText };
        }

        // Plano de planta del informe: fondo blanco, bloques de planta, cotas totales y por tramo,
        // nº de pieza y cajetín. Devuelve { dataUrl, canvas, widthMm, scaleDenominator… }.
        // opts: legend (dibuja la leyenda en la hoja), maxWidthMm / maxHeightMm (área útil del papel), paperLabel.
        function createDimensionedReportPlan(opts = {}) {
            const SUPERSAMPLE = opts.supersample || 2;
            const marginL = 95, marginT = 95, marginR = 115, marginB = 95, titleH = 150;
            const legendRows = opts.legend ? getLegendRows() : [];
            let scale, W, H, legendH;
            if (opts.paperMm) {
                // La hoja toma las proporciones del papel y el plano crece hasta llenar el espacio que dejan
                // la leyenda y el cajetín (la escala resultante se indica en el cajetín).
                const aspect = opts.paperMm[0] / opts.paperMm[1];
                W = 2200;
                H = Math.round(W / aspect);
                legendH = legendRows.length ? legendHeight(W - 40, legendRows) : 0;
                const availW = W - marginL - marginR, availH = H - marginT - marginB - legendH - titleH;
                scale = Math.min(availW / project.widthMeters, Math.max(40, availH) / project.depthMeters);
            } else {
                scale = Math.min(1100 / project.widthMeters, 760 / project.depthMeters);
                W = Math.ceil(marginL + project.widthMeters * scale + marginR);
                legendH = legendRows.length ? legendHeight(W - 40, legendRows) : 0;
                H = Math.ceil(marginT + project.depthMeters * scale + marginB + legendH + titleH);
            }
            const W0 = Math.ceil(marginL + project.widthMeters * scale + marginR);
            const planH = marginT + project.depthMeters * scale + marginB;
            H = Math.max(H, Math.ceil(planH + legendH + titleH));
            const ox = (W - W0) / 2, oy = Math.max(0, (H - planH - legendH - titleH) / 2);
            const output = document.createElement('canvas');
            output.width = W * SUPERSAMPLE;
            output.height = H * SUPERSAMPLE;
            const ctx = output.getContext('2d');
            ctx.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, 0, 0);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, W, H);
            renderBlueprint(ctx, W, H, { theme: 'print', scale, originX: marginL + ox, originY: marginT + oy, labels: 'number' });

            const left = marginL + ox, top = marginT + oy;
            const right = left + project.widthMeters * scale;
            const bottom = top + project.depthMeters * scale;
            const { line, tick, boxedText } = dimensionHelpers(ctx);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Cotas totales: ancho debajo y fondo a la derecha (en mm, como en los planos de montaje).
            const dimY = bottom + 50, dimX = right + 55;
            ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.2; ctx.font = 'bold 14px Inter, Arial, sans-serif';
            line(left, bottom + 4, left, dimY + 10); line(right, bottom + 4, right, dimY + 10);
            line(left, dimY, right, dimY); tick(left, dimY); tick(right, dimY);
            boxedText(formatMm(project.widthMeters), (left + right) / 2, dimY, '#0f172a');
            line(right + 4, top, dimX + 10, top); line(right + 4, bottom, dimX + 10, bottom);
            line(dimX, top, dimX, bottom); tick(dimX, top); tick(dimX, bottom);
            boxedText(formatMm(project.depthMeters), dimX, (top + bottom) / 2, '#0f172a', true);

            // Cotas parciales por tramo de pared.
            const C = BLUEPRINT_THEMES.print;
            ctx.font = 'bold 12px Inter, Arial, sans-serif'; ctx.lineWidth = 1; ctx.strokeStyle = C.dim;
            computeWallRuns().forEach(seg => {
                const label = formatMm(seg.hi - seg.lo);
                // Normalmente la cota va por fuera de la pared (arriba / izquierda); las esquinas sueltas
                // se acotan por debajo y por la derecha (placement 'after').
                const after = seg.placement === 'after';
                const sign = after ? 1 : -1;
                if (seg.axis === 'x') {
                    const x1 = left + seg.lo * scale, x2 = left + seg.hi * scale;
                    const edge = top + (seg.lane + sign * seg.thickness / 2) * scale, y = edge + sign * 20;
                    line(x1, edge + sign * 2, x1, y + sign * 6); line(x2, edge + sign * 2, x2, y + sign * 6);
                    line(x1, y, x2, y); tick(x1, y); tick(x2, y);
                    boxedText(label, (x1 + x2) / 2, y, C.dim);
                } else {
                    const y1 = top + seg.lo * scale, y2 = top + seg.hi * scale;
                    const edge = left + (seg.lane + sign * seg.thickness / 2) * scale, x = edge + sign * 20;
                    line(edge + sign * 2, y1, x + sign * 6, y1); line(edge + sign * 2, y2, x + sign * 6, y2);
                    line(x, y1, x, y2); tick(x, y1); tick(x, y2);
                    boxedText(label, x, (y1 + y2) / 2, C.dim, true);
                }
            });

            // Leyenda dentro de la hoja (para el PDF del plano; en el informe va aparte, en HTML).
            if (legendRows.length) drawCanvasLegend(ctx, 20, H - titleH - legendH, W - 40, legendRows);

            // Escala de impresión: la hoja se imprime ocupando el ancho disponible (opts.fillWidthMm o el
            // del papel), así que la escala es la que resulta de ese ajuste (exacta, p. ej. 1:23).
            const sheetWm = W / scale, sheetHm = H / scale;
            const printWidthMm = opts.fillWidthMm || (opts.paperMm ? opts.paperMm[0] : null);
            const denominator = printWidthMm
                ? Math.max(1, Math.round(sheetWm * 1000 / printWidthMm))
                : pickSheetScale(sheetWm, sheetHm, opts.maxWidthMm || 273, opts.maxHeightMm || 330);
            drawTitleBlock(ctx, 20, H - titleH + 10, W - 40, titleH - 30, scale, denominator, 'PLANTA GENERAL', opts.paperLabel || 'A3');
            return { dataUrl: output.toDataURL('image/png'), canvas: output, sheetWm, sheetHm, widthMm: sheetWm * 1000 / denominator, scaleDenominator: denominator };
        }

        // Filas de la leyenda: paneles y tapas por tramo; después mostradores y extras agrupados.
        function getLegendRows() {
            const finishOf = p => EXTRA_PLAN_TYPES.includes(p.type) ? '' : (p.finish === 'painted'
                ? (p.type === 'muro' || p.type === 'pico' ? `Impreso ${Number(p.printFaces) === 1 ? '1 cara' : '2 caras'}` : 'Impreso') : 'Blanco');
            const rows = computeConstructionNumbering().order
                .map(p => ({ ref: pieceRefLabel(p), name: PIECE_SPECS[p.type].name + (p.isAuto ? ' (tapa)' : ''), finish: finishOf(p) }));
            const others = {};
            pieces.filter(p => pieceRefNumber(p) === null).forEach(p => {
                const k = p.type + '|' + finishOf(p);
                others[k] = others[k] || { p, count: 0 };
                others[k].count++;
            });
            Object.values(others).forEach(({ p, count }) => rows.push({ ref: '', name: `${PIECE_SPECS[p.type].name} ×${count}`, finish: finishOf(p) }));
            return rows;
        }

        const LEGEND_COL_W = 300, LEGEND_ROW_H = 19;
        function legendHeight(width, rows) {
            const cols = Math.max(1, Math.floor(width / LEGEND_COL_W));
            return 34 + Math.ceil(rows.length / cols) * LEGEND_ROW_H;
        }
        function drawCanvasLegend(ctx, x, y, w, rows) {
            const cols = Math.max(1, Math.floor(w / LEGEND_COL_W));
            const perCol = Math.ceil(rows.length / cols);
            ctx.save();
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#334155'; ctx.font = 'bold 13px Inter, Arial, sans-serif';
            ctx.fillText('LEYENDA', x, y + 10);
            rows.forEach((row, i) => {
                const cx = x + Math.floor(i / perCol) * (w / cols), cy = y + 34 + (i % perCol) * LEGEND_ROW_H;
                ctx.font = 'bold 12px Inter, Arial, sans-serif'; ctx.fillStyle = '#0f172a';
                let tx = cx;
                if (row.ref) { ctx.fillText(row.ref, tx, cy); tx += 38; }
                ctx.font = '500 12px Inter, Arial, sans-serif';
                const text = row.name + (row.finish ? ' · ' + row.finish : '');
                ctx.fillText(text, tx, cy, w / cols - (tx - cx) - 8);
            });
            ctx.restore();
        }

        // Cajetín: logotipo, proyecto, plano, espacio, escala, fecha y escala gráfica.
        function drawTitleBlock(ctx, x, y, w, h, pxPerMeter, denominator, planTitle, paperLabel = 'A3') {
            ctx.save();
            ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1.5;
            ctx.strokeRect(x, y, w, h);
            const logo = document.querySelector('#modal-setup img');
            const logoW = Math.min(170, w * 0.22);
            if (logo && logo.complete && logo.naturalWidth) {
                const lh = Math.min(h - 24, logoW * logo.naturalHeight / logo.naturalWidth);
                ctx.drawImage(logo, x + 12, y + (h - lh) / 2, logoW - 12, lh * (logoW - 12) / logoW);
            }
            const colX = x + logoW + 10;
            ctx.beginPath(); ctx.moveTo(colX, y); ctx.lineTo(colX, y + h); ctx.stroke();
            const cells = [
                ['PROYECTO', project.name],
                ['PLANO', planTitle],
                ['ESPACIO', `${formatMeters(project.widthMeters)} × ${formatMeters(project.depthMeters)} m (${formatMeters(project.widthMeters * project.depthMeters)} m²)`],
                ['ESCALA', `1:${denominator} (${paperLabel})`],
                ['FECHA', new Date().toLocaleDateString('es-ES')],
                ['PIEZAS', String(pieces.length)]
            ];
            const cols = 3, rows = 2;
            const cw = (x + w - colX) / cols, rh = h / rows;
            ctx.lineWidth = 0.8; ctx.strokeStyle = '#94a3b8';
            for (let c = 1; c < cols; c++) { ctx.beginPath(); ctx.moveTo(colX + c * cw, y); ctx.lineTo(colX + c * cw, y + h); ctx.stroke(); }
            ctx.beginPath(); ctx.moveTo(colX, y + rh); ctx.lineTo(x + w, y + rh); ctx.stroke();
            cells.forEach(([k, v], i) => {
                const cx = colX + (i % cols) * cw + 10, cy = y + Math.floor(i / cols) * rh;
                ctx.textAlign = 'left'; ctx.textBaseline = 'top';
                ctx.fillStyle = '#64748b'; ctx.font = 'bold 11px Inter, Arial, sans-serif';
                ctx.fillText(k, cx, cy + 9);
                ctx.fillStyle = '#0f172a';
                const fit = fitTextLines(ctx, v, cw - 20, 2, 17, 10, 'bold');
                fit.lines.forEach((l, j) => ctx.fillText(l, cx, cy + 27 + j * (fit.size + 2), cw - 20));
            });
            // Escala gráfica de 0 a 2 m, debajo del logotipo.
            const barY = y + h - 14, barX = x + 14, unit = pxPerMeter;
            if (unit * 2 < logoW - 20) {
                for (let i = 0; i < 2; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#0f172a'; ctx.fillRect(barX + i * unit, barY - 5, unit, 5); }
                ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1; ctx.strokeRect(barX, barY - 5, unit * 2, 5);
                ctx.fillStyle = '#0f172a'; ctx.font = '600 10px Inter, Arial, sans-serif'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
                ['0', '1', '2 m'].forEach((t, i) => ctx.fillText(t, barX + i * unit, barY - 7));
            }
            ctx.restore();
        }

        // Leyenda del plano: paneles y tapas numerados en orden de montaje; después, sin número,
        // mostradores y extras agrupados.
        function buildPlanLegendHtml() {
            const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
            return getLegendRows().map(r => `<div style="break-inside:avoid;padding:2px 0;border-bottom:1px solid #e2e8f0">${r.ref ? `<strong>${r.ref}</strong> · ` : ''}${esc(r.name)}${r.finish ? ' · <span style="color:#475569">' + r.finish + '</span>' : ''}</div>`).join('');
        }

        // ---------------------------------------------------------------- exportación
        function planFileBaseName() {
            return String(project.name || 'ECOWALL').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'ECOWALL';
        }

        async function saveExportedFile(fileName, content, mime, filterName, extension) {
            if (window.__TAURI__ && window.__TAURI__.core) {
                const saved = typeof content === 'string'
                    ? await window.__TAURI__.core.invoke('save_text_file', { defaultName: fileName, content, filterName, extension })
                    : await window.__TAURI__.core.invoke('save_bytes_file', { defaultName: fileName, content: Array.from(content), filterName, extension });
                if (saved) showProjectToast('Archivo guardado en ' + saved);
                return;
            }
            const url = URL.createObjectURL(new Blob([content], { type: mime }));
            const a = document.createElement('a');
            a.href = url; a.download = fileName;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
        }

        // Proyecto en PDF A3: página 1, planta general (vertical u horizontal según la forma del stand,
        // ocupando la página entera, con leyenda y cajetín); página 2, alzado frontal acotado.
        // El PDF se escribe a mano: cada página lleva la imagen de su hoja.
        async function exportPlanPDF() {
            try {
                const A3 = [420, 297];
                const margin = 8;
                const probe = createDimensionedReportPlan({ legend: true });
                const planPage = probe.sheetWm >= probe.sheetHm ? A3 : [A3[1], A3[0]];
                const planArea = [planPage[0] - 2 * margin, planPage[1] - 2 * margin];
                const plan = createDimensionedReportPlan({ legend: true, paperMm: planArea, paperLabel: 'A3', supersample: 2 });
                const frontArea = [A3[0] - 2 * margin, A3[1] - 2 * margin];
                const front = await createFrontElevationSheet({ paperMm: frontArea });
                const bytes = await buildImagePdf([
                    { canvas: plan.canvas, pageMm: planPage, rectMm: [margin, margin, planArea[0], planArea[1]] },
                    { canvas: front, pageMm: A3, rectMm: [margin, margin, frontArea[0], frontArea[1]] }
                ], `${project.name} - Planta y alzado frontal`);
                await saveExportedFile(planFileBaseName() + '_planos.pdf', bytes, 'application/pdf', 'Documento PDF', 'pdf');
            } catch (e) { showProjectToast('No se pudo exportar el plano: ' + (e && e.message ? e.message : e), 'error'); }
        }

        // Alzado frontal de todo el stand, visto desde el pasillo (el lado abierto, abajo en la planta),
        // con cotas: ancho total, altura de paneles, cada tramo de pared y altura del mostrador.
        async function createFrontElevationSheet(opts = {}) {
            if (pieces.some(p => p.type === 'mesaAlta')) await loadMesaAltaTemplate();
            const SUPERSAMPLE = 2, HEIGHT = 2.55, BASE = -0.02;
            const paper = opts.paperMm || [404, 281];
            const W = 2200, H = Math.round(W * paper[1] / paper[0]);
            const titleH = 150, mL = 150, mR = 150, mT = 160, mB = 210;   // abajo caben las filas de cotas de mostradores y extras
            const span = project.widthMeters;
            const availW = W - mL - mR, availH = H - titleH - mT - mB;
            const px = Math.min(availW / span, availH / (HEIGHT - BASE));
            const imgW = Math.round(span * px), imgH = Math.round((HEIGHT - BASE) * px);
            const ox = mL + (availW - imgW) / 2, oy = mT + (availH - imgH) / 2;

            // Render ortográfico frontal de la escena.
            const renderer3d = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
            renderer3d.setPixelRatio(1);
            const rw = imgW * SUPERSAMPLE, rh = imgH * SUPERSAMPLE;
            renderer3d.setSize(rw, rh, false);
            const cx = span / 2, cy = (HEIGHT + BASE) / 2;
            const cam = new THREE.OrthographicCamera(-span / 2, span / 2, HEIGHT - cy, BASE - cy, 0.1, 200);
            cam.position.set(cx, cy, project.depthMeters + 50);
            cam.lookAt(cx, cy, 0);
            const snapshotCanvas = () => {
                const c = document.createElement('canvas');
                c.width = rw; c.height = rh;
                c.getContext('2d').drawImage(renderer3d.domElement, 0, 0);
                return c;
            };
            const previousBackground = scene.background;
            const hidden = [];
            outlineMeshes.forEach(m => { if (m.visible) { m.visible = false; hidden.push(m); } });
            if (roomMesh && roomMesh.visible) { roomMesh.visible = false; hidden.push(roomMesh); }
            let mainImage, extrasImage = null;
            try {
                scene.background = new THREE.Color(0xffffff);
                scene.updateMatrixWorld(true);
                renderer3d.render(scene, cam);
                mainImage = snapshotCanvas();

                // 2ª pasada, solo para el contorno de los extras (mesas, TV…): el resto de la escena se
                // dibuja sin color (solo profundidad), así solo se contornea la parte visible de cada extra.
                const extraObjects = new Set();
                pieces.filter(p => EXTRA_PLAN_TYPES.includes(p.type)).forEach(p => {
                    const o = pieceMeshes.get(p.id);
                    if (o) o.traverse(c => extraObjects.add(c));
                });
                if (extraObjects.size) {
                    const restored = [];
                    scene.traverse(o => {
                        if (extraObjects.has(o) || !o.material) return;
                        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { restored.push([m, m.colorWrite]); m.colorWrite = false; });
                    });
                    scene.background = null;
                    renderer3d.setClearColor(0x000000, 0);
                    try { renderer3d.render(scene, cam); extrasImage = snapshotCanvas(); }
                    finally { restored.forEach(([m, v]) => { m.colorWrite = v; }); }
                }
            } finally {
                scene.background = previousBackground;
                hidden.forEach(m => { m.visible = true; });
                renderer3d.dispose();
                if (renderer3d.forceContextLoss) renderer3d.forceContextLoss();
            }

            const out = document.createElement('canvas');
            out.width = W * SUPERSAMPLE; out.height = H * SUPERSAMPLE;
            const ctx = out.getContext('2d');
            ctx.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, 0, 0);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
            ctx.drawImage(mainImage, ox, oy, imgW, imgH);
            if (extrasImage) {
                // Anillo fino alrededor de la silueta visible: silueta dilatada menos la silueta.
                const ringCanvas = document.createElement('canvas');
                ringCanvas.width = rw; ringCanvas.height = rh;
                const g = ringCanvas.getContext('2d');
                const r = 1.6 * SUPERSAMPLE;
                for (let a = 0; a < 8; a++) g.drawImage(extrasImage, Math.cos(a * Math.PI / 4) * r, Math.sin(a * Math.PI / 4) * r);
                g.globalCompositeOperation = 'source-in';
                g.fillStyle = '#334155';
                g.fillRect(0, 0, rw, rh);
                g.globalCompositeOperation = 'destination-out';
                g.drawImage(extrasImage, 0, 0);
                ctx.drawImage(ringCanvas, ox, oy, imgW, imgH);
            }

            const X = m => ox + m * px;
            const Y = m => oy + (HEIGHT - m) * px;
            const { line, tick, boxedText } = dimensionHelpers(ctx);
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            // Línea de suelo.
            ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2;
            line(X(0) - 30, Y(0), X(span) + 30, Y(0));
            ctx.font = 'bold 15px Inter, Arial, sans-serif'; ctx.lineWidth = 1.2; ctx.strokeStyle = '#334155';
            const C = BLUEPRINT_THEMES.print;
            const xExtent = polys => {
                const xs = polys.flat().map(v => v[0]);
                return [Math.min(...xs), Math.max(...xs)];
            };
            // Cota horizontal en la fila «y», con líneas de referencia hasta «fromY».
            const hDim = (lo, hi, y, fromY, color) => {
                const dir = Math.sign(y - fromY) || 1;
                line(X(lo), fromY + dir * 6, X(lo), y + dir * 8); line(X(hi), fromY + dir * 6, X(hi), y + dir * 8);
                line(X(lo), y, X(hi), y); tick(X(lo), y); tick(X(hi), y);
                boxedText(formatMm(hi - lo), (X(lo) + X(hi)) / 2, y, color);
            };
            // Reparte cotas en filas para que no se pisen.
            const stack = items => {
                const ends = [];
                return items.sort((a, b) => a.lo - b.lo).map(it => {
                    let level = ends.findIndex(end => it.lo >= end + 0.02);
                    if (level < 0) { level = ends.length; ends.push(it.hi); } else ends[level] = it.hi;
                    return { ...it, level };
                });
            };

            // 1) Encima de los paneles: ancho de cada tramo (A, B, C…), con tapas y esquinas, incluidos
            //    los tramos laterales vistos de canto.
            const numbering = computeConstructionNumbering();
            const groupPolys = {};
            numbering.order.forEach(p => {
                const g = numbering.groupOf.get(p.id);
                (groupPolys[g] = groupPolys[g] || []).push(getFootprintWorld({ ...p, type: p.isAuto ? 'lateral' : p.type }));
            });
            const element = (polys, height) => {
                const [lo, hi] = xExtent(polys);
                return { lo, hi, height, front: Math.max(...polys.flat().map(v => v[1])) };
            };
            const groupItems = Object.values(groupPolys).map(polys => element(polys, 2.4));
            const looseItems = pieces.filter(p => pieceRefNumber(p) === null)
                .map(p => element([getFootprintWorld(p)], PIECE_SPECS[p.type].height));
            // Solo se acotan los elementos que se ven desde el frente: si otros más cercanos al pasillo
            // (e igual de altos o más) tapan más de la mitad de su ancho, no se acotan.
            const all = groupItems.concat(looseItems);
            const visible = it => {
                const covers = all.filter(o => o !== it && o.front > it.front + 0.01 && o.height >= it.height - 0.01)
                    .map(o => [Math.max(o.lo, it.lo), Math.min(o.hi, it.hi)]).filter(([a, b]) => b > a)
                    .sort((a, b) => a[0] - b[0]);
                let covered = 0, end = -Infinity;
                covers.forEach(([a, b]) => { if (b > end) { covered += b - Math.max(a, end); end = b; } });
                return covered < (it.hi - it.lo) * 0.5;
            };
            ctx.font = 'bold 13px Inter, Arial, sans-serif'; ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
            stack(groupItems.filter(visible))
                .forEach(d => hDim(d.lo, d.hi, Y(2.4) - 28 - d.level * 34, Y(2.4), C.dim));

            // 2) Bajo el suelo: ancho de mostradores y extras.
            const loose = stack(looseItems.filter(visible));
            loose.forEach(d => hDim(d.lo, d.hi, Y(0) + 30 + d.level * 32, Y(0), C.dim));
            const looseRows = loose.length ? Math.max(...loose.map(d => d.level)) + 1 : 0;

            // 3) Ancho total, por debajo de todo.
            ctx.font = 'bold 15px Inter, Arial, sans-serif'; ctx.lineWidth = 1.2; ctx.strokeStyle = '#334155';
            hDim(0, span, Y(0) + 60 + looseRows * 32, Y(0), '#0f172a');

            // Altura de los paneles.
            const dx = X(0) - 60;
            line(dx - 10, Y(2.4), X(0) - 6, Y(2.4)); line(dx - 10, Y(0), X(0) - 6, Y(0));
            line(dx, Y(2.4), dx, Y(0)); tick(dx, Y(2.4)); tick(dx, Y(0));
            boxedText('2.400', dx, (Y(2.4) + Y(0)) / 2, '#0f172a', true);
            // Altura del mostrador, si hay.
            if (pieces.some(p => p.type === 'mostrador' || p.type === 'mostrador1m')) {
                const rx = X(span) + 60;
                line(X(span) + 6, Y(1.0), rx + 10, Y(1.0)); line(X(span) + 6, Y(0), rx + 10, Y(0));
                line(rx, Y(1.0), rx, Y(0)); tick(rx, Y(1.0)); tick(rx, Y(0));
                boxedText('1.000', rx, (Y(1.0) + Y(0)) / 2, '#0f172a', true);
                ctx.save(); ctx.font = '600 11px Inter, Arial, sans-serif'; ctx.fillStyle = '#475569';
                ctx.fillText('mostrador', rx, Y(1.0) - 14); ctx.restore();
            }

            const denominator = Math.max(1, Math.round((W / px) * 1000 / paper[0]));
            drawTitleBlock(ctx, 20, H - titleH + 10, W - 40, titleH - 30, px, denominator, 'ALZADO FRONTAL', 'A3');
            return out;
        }

        // PDF con una imagen por página. Sin pérdida (Flate) si el sistema permite comprimir; si no, JPEG.
        async function buildImagePdf(pages, title) {
            const pt = mm => mm * 72 / 25.4;
            const encodeImage = async canvas => {
                const W = canvas.width, H = canvas.height;
                if (typeof CompressionStream !== 'undefined') {
                    const rgba = canvas.getContext('2d').getImageData(0, 0, W, H).data;
                    const rgb = new Uint8Array(W * H * 3);
                    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
                    const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
                    return { W, H, bytes: new Uint8Array(await new Response(stream).arrayBuffer()), filter: '/FlateDecode' };
                }
                const jpeg = canvas.toDataURL('image/jpeg', 0.95);
                return { W, H, bytes: Uint8Array.from(atob(jpeg.split(',')[1]), c => c.charCodeAt(0)), filter: '/DCTDecode' };
            };
            const images = [];
            for (const page of pages) images.push(await encodeImage(page.canvas));

            const enc = new TextEncoder();
            const parts = [];
            const offsets = [];
            let length = 0;
            const push = chunk => { const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk; parts.push(b); length += b.length; };
            const obj = (n, body) => { offsets[n] = length; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
            // Texto PDF: se escapan \ ( ) y los caracteres no ASCII se sustituyen.
            const pdfText = s => '(' + String(s).replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '?') + ')';
            // Objetos: 1 catálogo, 2 páginas, 3 por página (página, contenido, imagen) y la info al final.
            const pageObj = i => 3 + i * 3;
            const infoObj = 3 + pages.length * 3;
            push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
            obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
            obj(2, () => push(`<< /Type /Pages /Kids [${pages.map((p, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`));
            pages.forEach((page, i) => {
                const img = images[i];
                const [pw, ph] = [pt(page.pageMm[0]), pt(page.pageMm[1])];
                const [x, y, w, h] = [pt(page.rectMm[0]), pt(page.pageMm[1] - page.rectMm[1] - page.rectMm[3]), pt(page.rectMm[2]), pt(page.rectMm[3])];
                const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q`;
                obj(pageObj(i), () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im${i} ${pageObj(i) + 2} 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`));
                obj(pageObj(i) + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
                obj(pageObj(i) + 2, () => { push(`<< /Type /XObject /Subtype /Image /Width ${img.W} /Height ${img.H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${img.filter} /Length ${img.bytes.length} >>\nstream\n`); push(img.bytes); push('\nendstream'); });
            });
            obj(infoObj, () => push(`<< /Title ${pdfText(title)} /Producer (Configurador ECOWALL) >>`));
            const xref = length;
            push(`xref\n0 ${infoObj + 1}\n0000000000 65535 f \n${offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`);
            push(`trailer\n<< /Size ${infoObj + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
            const out = new Uint8Array(length);
            let at = 0;
            parts.forEach(b => { out.set(b, at); at += b.length; });
            return out;
        }

        // Contornos de cada pieza para DXF (metros, coordenadas locales): polígonos y círculos.
        function getPlanOutlineLocal(p) {
            if (p.type === 'mesaSillas') {
                const side = 1.3, seat = side * 0.29, o = side * 0.315;
                const shapes = [{ circle: [0, 0, side * 0.245] }];
                [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
                    const c = seat * Math.SQRT1_2;  // medio diagonal del asiento girado 45º
                    shapes.push({ poly: [[sx * o, sy * o - c], [sx * o + c, sy * o], [sx * o, sy * o + c], [sx * o - c, sy * o]] });
                });
                return shapes;
            }
            if (p.type === 'mesaAlta') return [{ circle: [0, 0, 0.275] }, { circle: [-0.44, 0, 0.16] }, { circle: [0.44, 0, 0.16] }];
            return [{ poly: getFootprintLocal(p) }];
        }

        function exportPlanDXF() {
            const D = project.depthMeters;
            const X = m => (m * 1000).toFixed(1), Y = m => ((D - m) * 1000).toFixed(1);
            const out = [];
            const g = (code, value) => out.push(String(code), String(value));
            const layers = [['ESPACIO', 5], ['PIEZAS', 7], ['TAPAS', 8], ['IMPRESO', 6], ['TEXTO', 7], ['COTAS', 3]];
            g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
            g(0, 'SECTION'); g(2, 'TABLES');
            g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
            g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0.0);
            g(0, 'ENDTAB');
            g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
            layers.forEach(([name, color]) => { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS'); });
            g(0, 'ENDTAB'); g(0, 'ENDSEC');
            g(0, 'SECTION'); g(2, 'ENTITIES');
            const lineE = (layer, x1, y1, x2, y2) => { g(0, 'LINE'); g(8, layer); g(10, X(x1)); g(20, Y(y1)); g(30, 0); g(11, X(x2)); g(21, Y(y2)); g(31, 0); };
            const polyE = (layer, pts) => pts.forEach((pt, i) => { const nx = pts[(i + 1) % pts.length]; lineE(layer, pt[0], pt[1], nx[0], nx[1]); });
            const circleE = (layer, x, y, r) => { g(0, 'CIRCLE'); g(8, layer); g(10, X(x)); g(20, Y(y)); g(30, 0); g(40, (r * 1000).toFixed(1)); };
            const textE = (layer, text, x, y, h, rot = 0) => {
                g(0, 'TEXT'); g(8, layer); g(10, X(x)); g(20, Y(y)); g(30, 0); g(40, h); g(1, text);
                if (rot) g(50, rot);
                g(72, 1); g(73, 2); g(11, X(x)); g(21, Y(y)); g(31, 0);
            };
            const toWorld = (p, [x, y]) => {
                const r = THREE.MathUtils.degToRad(p.rotation), c = Math.cos(r), s = Math.sin(r);
                return [p.x + x * c - y * s, p.y + x * s + y * c];
            };

            polyE('ESPACIO', [[0, 0], [project.widthMeters, 0], [project.widthMeters, D], [0, D]]);
            pieces.forEach(p => {
                getPlanOutlineLocal(p).forEach(shape => {
                    if (shape.poly) polyE('PIEZAS', shape.poly.map(pt => toWorld(p, pt)));
                    else { const [cx, cy] = toWorld(p, shape.circle); circleE('PIEZAS', cx, cy, shape.circle[2]); }
                });
                if (p.finish === 'painted' && !EXTRA_PLAN_TYPES.includes(p.type)) {
                    const spec = PIECE_SPECS[p.type];
                    const faces = p.type === 'muro' ? (Number(p.printFaces) === 1 ? [p.printSide === -1 ? -1 : 1] : [-1, 1]) : p.type === 'muro1c' ? [1] : [];
                    faces.forEach(f => {
                        const yy = f * (spec.depth / 2 - 0.01);
                        const a = toWorld(p, [-spec.width / 2 + 0.01, yy]), b = toWorld(p, [spec.width / 2 - 0.01, yy]);
                        lineE('IMPRESO', a[0], a[1], b[0], b[1]);
                    });
                }
                if (pieceRefNumber(p) !== null) textE('TEXTO', pieceRefLabel(p), p.x, p.y, 45);
                else textE('TEXTO', PIECE_SPECS[p.type].name, p.x, p.y, 35, ((-p.rotation % 360) + 360) % 360);
            });
            computeAutomaticLateralCaps().forEach(cap => {
                polyE('TAPAS', getFootprintLocal({ ...cap, type: 'lateral' }).map(pt => toWorld(cap, pt)));
                if (pieceRefNumber(cap) !== null) textE('TEXTO', pieceRefLabel(cap), cap.x, cap.y, 30);
            });

            // Cotas totales (líneas y texto, compatibles con cualquier programa).
            const off = 0.35;
            lineE('COTAS', 0, D + off, project.widthMeters, D + off);
            lineE('COTAS', 0, D, 0, D + off + 0.08); lineE('COTAS', project.widthMeters, D, project.widthMeters, D + off + 0.08);
            textE('COTAS', formatMm(project.widthMeters).replace(/\./g, ''), project.widthMeters / 2, D + off + 0.1, 80);
            lineE('COTAS', project.widthMeters + off, 0, project.widthMeters + off, D);
            lineE('COTAS', project.widthMeters, 0, project.widthMeters + off + 0.08, 0); lineE('COTAS', project.widthMeters, D, project.widthMeters + off + 0.08, D);
            textE('COTAS', formatMm(D).replace(/\./g, ''), project.widthMeters + off + 0.12, D / 2, 80, 90);
            textE('TEXTO', `${project.name} - PLANTA GENERAL (mm)`, project.widthMeters / 2, -0.35, 100);
            g(0, 'ENDSEC'); g(0, 'EOF');
            return saveExportedFile(planFileBaseName() + '_planta.dxf', out.join('\r\n') + '\r\n', 'application/dxf', 'Plano DXF', 'dxf')
                .catch(e => showProjectToast('No se pudo exportar el DXF: ' + (e && e.message ? e.message : e), 'error'));
        }
