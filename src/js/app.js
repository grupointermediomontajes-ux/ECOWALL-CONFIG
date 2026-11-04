const MODEL_BIN = window.MODEL_BIN;
function blobUrl(d, type){ return URL.createObjectURL(new Blob([d], {type})); }
function toBytes(d){ return (typeof d === 'string') ? Uint8Array.from(atob(d), c => c.charCodeAt(0)) : d; }

// ---- recursos 3D compartidos ----
// Las geometrías de los modelos se crean una sola vez y se reutilizan en todas las piezas.
// Lo marcado con userData.keep no se libera al reconstruir la escena; el resto sí (evita fugas de memoria).
const SHARED_GEOMETRIES = new Map();
function sharedGeometry(key, create) {
    let geo = SHARED_GEOMETRIES.get(key);
    if (!geo) { geo = create(); geo.userData.keep = true; SHARED_GEOMETRIES.set(key, geo); }
    return geo;
}
// Calcular aristas de mallas de 50.000+ vértices es caro: se cachea por geometría.
function edgesFor(geo) {
    if (!geo.userData.keep) return new THREE.EdgesGeometry(geo, 22);
    return sharedGeometry('edges:' + geo.uuid, () => new THREE.EdgesGeometry(geo, 22));
}
function disposeObject3D(root) {
    if (!root) return;
    root.traverse(obj => {
        if (obj.geometry && !obj.geometry.userData.keep) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
        mats.forEach(m => { if (!m.userData.keep) m.dispose(); });
    });
}

        const ECOWALL_MESA_ALTA_GLB = MODEL_BIN["mesa_alta_glb"];

        const PIECE_SPECS = {
            muro: { name: 'PARED UNIVERSAL', width: 0.5, depth: 0.3, height: 2.4, dimsMm: '500 x 300 x 2400 mm' },
            muro1c: { name: 'PANEL UNIVERSAL 1C', width: 0.5, depth: 0.3, height: 2.4, dimsMm: '500 x 300 x 2400 mm' },
            esquina: { name: 'ESQUINA 90º', width: 0.3, depth: 0.3, height: 2.4, dimsMm: '300 x 300 x 2400 mm' },
            esquina45: { name: 'ESQUINA 45º', width: 0.65, depth: 0.65, height: 2.4, dimsMm: '650 x 650 x 2400 mm' },
            pico: { name: 'PANEL PICO', width: 0.35, depth: 0.48, height: 2.4, dimsMm: '350 x 480 x 2400 mm' },
            picodoble: { name: 'PANEL PICO DOBLE', width: 0.35, depth: 0.66, height: 2.4, dimsMm: '350 x 660 x 2400 mm' },
            mostrador: { name: 'MOSTRADOR 2M', width: 1.0, depth: 0.3, height: 1.0, dimsMm: '1000 x 300 x 1000h mm' },
            mostrador1m: { name: 'MOSTRADOR 1M', width: 0.5, depth: 0.3, height: 1.0, dimsMm: '500 x 300 x 1000h mm' },
            focoPala: { name: 'FOCO PALA', width: 0.2, depth: 0.3, height: 0.12, dimsMm: '200 x 300 x 120 mm (GLB)' },
            tvSoporte: { name: 'TV CON SOPORTE', width: 1.25, depth: 0.34, height: 2.06, dimsMm: '1250 x 340 mm' },
            mesaSillas: { name: 'MESA BAJA-4SILLAS', width: 1.3, depth: 1.3, height: 0.85, dimsMm: '1300 x 1300 mm' },
            mesaAlta: { name: 'MESA ALTA-2 tab.', width: 1.2, depth: 0.55, height: 1.1, dimsMm: '1200 x 550 mm' },
            portaCatalogos: { name: 'PORTACATALOGOS', width: 0.28, depth: 0.28, height: 1.58, dimsMm: '280 x 280 mm' },
            lateral: { name: 'PARED FINAL', width: 0.3, depth: 0.05, height: 2.4, dimsMm: '300 x 50 x 2400 mm' }
        };

        // Los precios ya NO están en el código: se leen de precios.xlsx (ver js/pricing.js).
        function getPieceUnitPrice(item) {
            return PRICING.unitPrice(item);
        }

        const WALL_COLORS = {
            unpainted: 0xfdfbf7,
            painted: 0x5c4033
        };

        let printedTextureCache = null;
        function createPrintedTexture() {
            // Una única textura para todas las piezas impresas (antes se creaba una de 1024 px por pieza).
            if (printedTextureCache) return printedTextureCache;
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 1024;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#5c4033';
            ctx.fillRect(0, 0, 1024, 1024);

            ctx.fillStyle = 'rgba(40, 25, 15, 0.25)';
            for (let i = 0; i < 40; i++) {
                ctx.fillRect(0, i * 26, 1024, 10);
            }

            ctx.save();
            ctx.translate(512, 512);
            ctx.rotate(-Math.PI / 6);
            ctx.translate(-512, -512);

            ctx.font = 'bold 42px Inter, sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (let y = -300; y < 1400; y += 120) {
                for (let x = -300; x < 1400; x += 280) {
                    ctx.fillText('ECOWALL', x, y);
                }
            }
            ctx.restore();

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            printedTextureCache = texture;
            return texture;
        }

        function getPrintedMaterialForMesh(geo, type) {
            const texture = createPrintedTexture();
            return new THREE.MeshStandardMaterial({
                map: texture,
                roughness: 0.4,
                metalness: 0.1
            });
        }

        // Separación por triángulos: SOLO una superficie exterior de 500 mm.
        // El eje Z es la profundidad local de PARED UNIVERSAL; la cara opuesta
        // permanece blanca. La elección de lado se captura al pulsar en 3D.
        // faceZ: plano de la cara impresa; por defecto, el extremo de la pieza en ese lado.
        // hideInner: las caras de ese plano que miran hacia dentro van al material 2 (oculto). El mostrador
        // se dibuja por las dos caras y tiene una capa interior pegada al frente que taparía la impresión.
        function buildMuroOneFaceGeometry(source, faceSign, faceZ, hideInner) {
            const geo = source.clone();
            const pos = geo.getAttribute('position');
            const idx = geo.getIndex();
            const count = idx ? idx.count : pos.count;
            const box = new THREE.Box3().setFromBufferAttribute(pos);
            const extreme = Number.isFinite(faceZ) ? faceZ : (faceSign < 0 ? box.min.z : box.max.z);
            const tolerance = Math.max(0.004, (box.max.z - box.min.z) * 0.045);
            geo.clearGroups();
            let last = -1, start = 0;
            for (let i = 0; i < count; i += 3) {
                const a = new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i);
                const b = new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i+1) : i+1);
                const c = new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i+2) : i+2);
                const normal = new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
                const centerZ = (a.z+b.z+c.z)/3;
                const inPlane = Math.abs(centerZ-extreme) < tolerance;
                const printed = normal.z * faceSign > 0.72 && inPlane;
                const mat = printed ? 0 : (hideInner && inPlane && normal.z * faceSign < -0.72 ? 2 : 1);
                if (last === -1) { last=mat; start=i; }
                else if (mat !== last) { geo.addGroup(start,i-start,last); start=i; last=mat; }
            }
            if (last !== -1) geo.addGroup(start,count-start,last);
            return geo;
        }

        // Panel pico impreso a 1 cara: material 0 en la cara elegida, 1 en el resto.
        //  faceSign 1: el frente en punta (las dos caras inclinadas); -1: la trasera plana.
        function buildPicoOneFaceGeometry(source, faceSign) {
            const geo = source.clone();
            const pos = geo.getAttribute('position');
            const idx = geo.getIndex();
            const count = idx ? idx.count : pos.count;
            const tri = new THREE.Triangle(), n = new THREE.Vector3();
            geo.clearGroups();
            let last = -1, start = 0;
            for (let i = 0; i < count; i += 3) {
                tri.a.fromBufferAttribute(pos, idx ? idx.getX(i) : i);
                tri.b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1);
                tri.c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2);
                tri.getNormal(n);
                const z = (tri.a.z + tri.b.z + tri.c.z) / 3;
                const printed = faceSign > 0 ? (n.z > 0.5 && z > 0.02) : (n.z < -0.72 && z < -0.2);
                const mat = printed ? 0 : 1;
                if (last === -1) { last = mat; start = i; }
                else if (mat !== last) { geo.addGroup(start, i - start, last); start = i; last = mat; }
            }
            if (last !== -1) geo.addGroup(start, count - start, last);
            return geo;
        }

        // Plano de la cara frontal del mostrador en un lado: el de mayor superficie mirando hacia ese lado
        // (la encimera sobresale, así que no es el extremo de la pieza).
        function dominantFaceZ(source, faceSign) {
            const pos = source.getAttribute('position');
            const idx = source.getIndex();
            const count = idx ? idx.count : pos.count;
            const areas = new Map();
            const tri = new THREE.Triangle(), n = new THREE.Vector3();
            for (let i = 0; i < count; i += 3) {
                tri.a.fromBufferAttribute(pos, idx ? idx.getX(i) : i);
                tri.b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1);
                tri.c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2);
                tri.getNormal(n);
                const z = (tri.a.z + tri.b.z + tri.c.z) / 3;
                if (n.z * faceSign < 0.72 || z * faceSign <= 0) continue;
                const key = Math.round(z * 100) / 100;
                areas.set(key, (areas.get(key) || 0) + tri.getArea());
            }
            let best = null, bestArea = 0;
            areas.forEach((a, z) => { if (a > bestArea) { best = z; bestArea = a; } });
            return best;
        }

        const FLOOR_COLOR_NAMES = {
            '#121212': 'Negro',
            '#64748b': 'Gris Antracita',
            '#f472b6': 'Rosa',
            '#1e3a8a': 'Azul Ducados',
            '#eab308': 'Amarillo',
            '#15803d': 'Verde',
            '#dc2626': 'Rojo'
        };

        let project = {
            name: 'CONFIGURADOR ECOWALL',
            widthMeters: 4.0,
            depthMeters: 3.0,
            floorColor: 0x121212,
            floorColorHex: '#121212',
            wallFinish: 'unpainted'
        };

        let currentMode = '2d';
        let pieces = [];
        let selectedPieceId = null;
        let multiSelectEnabled = false;
        let selectedPieceIds = new Set();
        let selected3dPieceId = null;
        let selected3dCapId = null;
        // Acabados de las tapas marcados a mano (id de tapa → acabado). Sin marcar, la tapa es blanca.
        let autoLateralFinishes = new Map();
        let nextPieceId = 1;

        let undoStack = [];
        let redoStack = [];
        const MAX_UNDO_HISTORY = 50;

        // El historial incluye también los acabados (piezas, tapas laterales y acabado general).
        function captureHistoryState() {
            return {
                pieces: JSON.parse(JSON.stringify(pieces)),
                nextPieceId: nextPieceId,
                selectedPieceId: selectedPieceId,
                selectedPieceIds: Array.from(selectedPieceIds),
                autoLateralFinishes: Array.from(autoLateralFinishes.entries()),
                wallFinish: project.wallFinish
            };
        }

        function saveState() {
            undoStack.push(captureHistoryState());
            if (undoStack.length > MAX_UNDO_HISTORY) {
                undoStack.shift();
            }
            redoStack = [];
            updateUndoButtonState();
        }


        function undo() {
            if (undoStack.length === 0) return;
            redoStack.push(captureHistoryState());
            applyHistoryState(undoStack.pop());
        }

        function redo() {
            if (redoStack.length === 0) return;
            undoStack.push(captureHistoryState());
            applyHistoryState(redoStack.pop());
        }

        function applyHistoryState(previousState) {
            pieces = JSON.parse(JSON.stringify(previousState.pieces));
            nextPieceId = previousState.nextPieceId;
            selectedPieceId = previousState.selectedPieceId;
            selectedPieceIds = new Set((previousState.selectedPieceIds || []).filter(id => pieces.some(p => p.id === id)));
            if (previousState.autoLateralFinishes) autoLateralFinishes = new Map(previousState.autoLateralFinishes);
            if (previousState.wallFinish) project.wallFinish = previousState.wallFinish;

            if (multiSelectEnabled) {
                if (selectedPieceId !== null && pieces.some(p => p.id === selectedPieceId)) selectedPieceIds.add(selectedPieceId);
                selectedPieceId = null;
            } else {
                selectedPieceIds.clear();
            }
            isDragging2D = false;
            dragPieceId = null;

            if (selectedPieceId !== null && !pieces.some(p => p.id === selectedPieceId)) {
                selectedPieceId = null;
            }

            rebuildAllPieceMeshes();
            refresh2DSelection();
            updatePiecesListUI();
            if (currentMode === '3d') {
                const still3d = selected3dPieceId !== null && pieces.some(p => p.id === selected3dPieceId);
                select3dPiece(still3d ? selected3dPieceId : null);
                if (!still3d) updateFinishButtonsUI(project.wallFinish);
            }
            updateUndoButtonState();
        }

        function updateUndoButtonState() {
            const btnUndo = document.getElementById('btn-undo');
            if (btnUndo) btnUndo.disabled = undoStack.length === 0;
            const btnRedo = document.getElementById('btn-redo');
            if (btnRedo) btnRedo.disabled = redoStack.length === 0;
        }

        let scene, camera, renderer, controls;
        let roomMesh, floorMesh;
        let pieceMeshes = new Map();
        let autoLateralMeshes = new Map();
        let outlineMeshes = new Map();
        let raycaster = new THREE.Raycaster();
        let mouse = new THREE.Vector2();

        let isDragging2D = false;
        let dragPieceId = null;
        let dragOffsetX = 0;
        let dragoffsetY = 0;

        window.onload = function () {
            setupModalEvents();
            openNewProjectSetup();
            initThree();
            setupUIEvents();
            setup2DDragging();
            setup2DNavigation();
            setup3DClickSelecting();
            setupKeyboardEvents();
            updateRoomGeometry();
            animate();
        };

        function toggleMobileSidebar() {
            const sidebar = document.getElementById('sidebar-panel');
            const overlay = document.getElementById('sidebar-overlay');
            sidebar.classList.toggle('-translate-x-full');
            overlay.classList.toggle('hidden');
        }

        const SAVED_PROJECTS_STORAGE_KEY = 'ecowall_saved_projects_v1';
        let setupModalPurpose = 'new';

        function normalizeProjectName(name) {
            return String(name || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-ES');
        }

        function getSavedProjects() {
            try {
                const raw = window.localStorage.getItem(SAVED_PROJECTS_STORAGE_KEY);
                if (!raw) return {};
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
            } catch (error) {
                return null;
            }
        }

        function writeSavedProjects(savedProjects) {
            window.localStorage.setItem(SAVED_PROJECTS_STORAGE_KEY, JSON.stringify(savedProjects));
        }

        function setSetupFeedback(message, type = 'error') {
            const feedback = document.getElementById('setup-feedback');
            if (!feedback) return;
            if (!message) {
                feedback.textContent = '';
                feedback.className = 'hidden text-xs mt-2';
                return;
            }
            feedback.textContent = message;
            feedback.className = `text-xs mt-2 ${type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`;
        }

        function updateProjectHeader() {
            const title = document.getElementById('project-title-display');
            if (title) {
                const safeName = String(project.name || 'Proyecto sin nombre').replace(/[&<>"']/g, ch => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
                }[ch]));
                title.innerHTML = `${safeName}<span class="hidden sm:inline-block text-[10px] md:text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Pro</span>`;
            }
            const dims = document.getElementById('project-dims-display');
            if (dims) dims.textContent = `Espacio: ${project.widthMeters}m × ${project.depthMeters}m`;
        }

        function openProjectSettings() {
            setupModalPurpose = 'settings';
            document.getElementById('setup-name').value = project.name || '';
            document.getElementById('setup-width').value = project.widthMeters;
            document.getElementById('setup-depth').value = project.depthMeters;
            document.getElementById('btn-load-project').classList.add('hidden');
            document.getElementById('setup-submit-button').innerHTML = '<i class="fa-solid fa-check"></i> Aplicar cambios';
            document.getElementById('modal-setup').classList.remove('hidden');
            setSetupFeedback('');
            updateWorkspaceOccupancyWarning();
        }

        function startNewProjectFromToolbar() {
            const hasWork = pieces.length > 0;
            const proceed = () => {
                project = { name: 'NUEVO PROYECTO', widthMeters: 4.0, depthMeters: 3.0, floorColor: 0x121212, floorColorHex: '#121212', wallFinish: 'unpainted' };
                pieces = [];
                nextPieceId = 1;
                selectedPieceId = null;
                selectedPieceIds = new Set();
                selected3dPieceId = null;
                selected3dCapId = null;
                multiSelectEnabled = false;
                autoLateralFinishes = new Map();
                undoStack = []; redoStack = [];
                isDragging2D = false;
                dragPieceId = null;
                // Un proyecto nuevo empieza en el plano 2D (así no queda a la vista nada de la vista 3D,
                // como el botón de descargar el modelo).
                if (currentMode !== '2d') switchMode('2d');
                setupModalPurpose = 'new';
                document.getElementById('setup-name').value = project.name;
                document.getElementById('setup-width').value = project.widthMeters;
                document.getElementById('setup-depth').value = project.depthMeters;
                document.getElementById('btn-load-project').classList.remove('hidden');
                document.getElementById('setup-submit-button').innerHTML = '<i class="fa-solid fa-play"></i> Iniciar Espacio de Trabajo';
                document.getElementById('modal-setup').classList.remove('hidden');
                setSetupFeedback('Configura el nuevo proyecto. Los cambios no guardados del proyecto anterior se perderán.');
                updateProjectHeader();
                updateRoomGeometry();
                updatePiecesListUI();
                updateFinishButtonsUI(project.wallFinish);
                resetCamera();
                updateUndoButtonState();
            };
            // window.confirm no funciona dentro de la app de escritorio (Tauri): diálogo propio.
            if (!hasWork) { proceed(); return; }
            ecowallConfirm({
                title: 'Crear un nuevo proyecto',
                message: 'Se perderán los cambios no guardados del proyecto actual. Los proyectos guardados no se eliminarán.',
                confirmText: 'Sí, nuevo proyecto',
                cancelText: 'Seguir editando'
            }).then(ok => { if (ok) proceed(); });
        }

        // Diálogos propios (window.confirm no aparece dentro de la app de escritorio).
        // ecowallChoose: botones [{ id, label, primary }]; devuelve el id pulsado, o null si se cancela
        // (Escape o clic fuera).
        function ecowallChoose({ title, message, buttons }) {
            return new Promise(resolve => {
                const overlay = document.createElement('div');
                overlay.className = 'fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4';
                overlay.setAttribute('role', 'dialog');
                overlay.setAttribute('aria-modal', 'true');
                overlay.innerHTML = `
                  <div class="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
                    <div class="px-5 pt-5">
                      <h3 class="text-base font-bold text-white"></h3>
                      <p class="mt-2 text-sm text-slate-300 leading-relaxed"></p>
                    </div>
                    <div data-buttons class="flex flex-wrap justify-end gap-2 px-5 py-4"></div>
                  </div>`;
                overlay.querySelector('h3').textContent = title;
                overlay.querySelector('p').textContent = message;
                const row = overlay.querySelector('[data-buttons]');
                buttons.forEach(b => {
                    const el = document.createElement('button');
                    el.type = 'button';
                    el.dataset.answer = b.id;
                    el.textContent = b.label;
                    el.className = (b.primary ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200') +
                        ' px-4 py-2 rounded-lg text-xs font-semibold transition';
                    row.appendChild(el);
                });
                const close = answer => { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve(answer); };
                const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
                overlay.addEventListener('click', e => {
                    if (e.target === overlay) close(null);
                    const b = e.target.closest('[data-answer]');
                    if (b) close(b.dataset.answer);
                });
                document.addEventListener('keydown', onKey, true);
                document.body.appendChild(overlay);
                (row.querySelector('.bg-indigo-600') || row.lastChild).focus();
            });
        }

        // Confirmación sí/no: true si se confirma, false si se cancela.
        function ecowallConfirm({ title, message, confirmText = 'Aceptar', cancelText = 'Cancelar' }) {
            return ecowallChoose({ title, message, buttons: [{ id: 'no', label: cancelText }, { id: 'yes', label: confirmText, primary: true }] })
                .then(answer => answer === 'yes');
        }

        function openNewProjectSetup() {
            setupModalPurpose = 'new';
            document.getElementById('btn-load-project').classList.remove('hidden');
            document.getElementById('setup-submit-button').innerHTML = '<i class="fa-solid fa-play"></i> Iniciar Espacio de Trabajo';
            document.getElementById('modal-setup').classList.remove('hidden');
            setSetupFeedback('');
            updateWorkspaceOccupancyWarning();
        }

        function showProjectToast(message, type = 'success') {
            let toast = document.getElementById('project-save-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'project-save-toast';
                toast.className = 'fixed bottom-4 right-4 z-[100] max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-2xl';
                toast.setAttribute('role', 'status');
                toast.setAttribute('aria-live', 'polite');
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.className = `fixed bottom-4 right-4 z-[100] max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-2xl ${type === 'success' ? 'bg-emerald-950 border-emerald-700 text-emerald-200' : 'bg-rose-950 border-rose-700 text-rose-200'}`;
            if (toast._hideTimer) window.clearTimeout(toast._hideTimer);
            toast._hideTimer = window.setTimeout(() => toast.classList.add('hidden'), 3500);
        }

        function getCurrentProjectSnapshot() {
            return {
                version: 1,
                savedAt: new Date().toISOString(),
                project: {
                    name: project.name,
                    widthMeters: project.widthMeters,
                    depthMeters: project.depthMeters,
                    floorColor: project.floorColor,
                    floorColorHex: project.floorColorHex,
                    wallFinish: project.wallFinish
                },
                pieces: JSON.parse(JSON.stringify(pieces)),
                nextPieceId: nextPieceId,
                autoLateralFinishes: Array.from(autoLateralFinishes.entries())
            };
        }

        // Si ya hay un proyecto guardado con ese nombre, pregunta: sobrescribir o guardar una versión nueva
        // («NOMBRE v-1», «v-2»…). Devuelve el nombre con el que se ha guardado, o null si se cancela o falla.
        async function saveCurrentProject() {
            let name = String(project.name || '').trim();
            let key = normalizeProjectName(name);
            if (!key) {
                showProjectToast('No se puede guardar: el proyecto no tiene nombre.', 'error');
                return null;
            }
            try {
                const savedProjects = getSavedProjects();
                if (savedProjects === null) throw new Error('No se puede acceder al almacenamiento del navegador.');
                if (savedProjects[key]) {
                    const choice = await ecowallChoose({
                        title: 'El proyecto ya existe',
                        message: `Ya hay un proyecto guardado con el nombre «${name}». ¿Quieres sobrescribirlo o guardarlo como una versión nueva?`,
                        buttons: [
                            { id: 'cancel', label: 'Cancelar' },
                            { id: 'version', label: 'Nueva versión' },
                            { id: 'overwrite', label: 'Sobrescribir', primary: true }
                        ]
                    });
                    if (!choice || choice === 'cancel') return null;
                    if (choice === 'version') {
                        name = nextProjectVersionName(name, savedProjects);
                        key = normalizeProjectName(name);
                        project.name = name;
                        updateProjectHeader();
                    }
                }
                savedProjects[key] = getCurrentProjectSnapshot();
                setProjectHidden(key, false);   // guardar un proyecto oculto lo vuelve a mostrar en la lista
                writeSavedProjects(savedProjects);
                showProjectToast(`Proyecto «${name}» guardado correctamente.`);
                return name;
            } catch (error) {
                showProjectToast(`No se pudo guardar el proyecto. ${error && error.message ? error.message : 'Comprueba el almacenamiento del navegador.'}`, 'error');
                return null;
            }
        }

        // «STAND MADRID» → «STAND MADRID v-1»; si ya hay v-1 y v-2 (o se guarda desde una versión), → v-3.
        function nextProjectVersionName(name, savedProjects) {
            const base = String(name).replace(/\s+v-\d+$/i, '').trim();
            const baseKey = normalizeProjectName(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp('^' + baseKey + ' v-(\\d+)$');
            let max = 0;
            Object.keys(savedProjects).forEach(k => { const m = k.match(re); if (m) max = Math.max(max, Number(m[1])); });
            return `${base} v-${max + 1}`;
        }

        function loadSavedProject() {
            const input = document.getElementById('setup-name');
            const name = String(input.value || '').trim();
            const key = normalizeProjectName(name);
            if (!key) {
                setSetupFeedback('Introduce el nombre del proyecto que quieres cargar.');
                input.focus();
                return;
            }

            const savedProjects = getSavedProjects();
            if (savedProjects === null) {
                setSetupFeedback('No se puede acceder al almacenamiento del navegador.');
                return;
            }
            const saved = savedProjects[key];
            if (!saved || !saved.project || !Array.isArray(saved.pieces)) {
                setSetupFeedback('Proyecto no existente. Comprueba el nombre o crea un proyecto nuevo.');
                return;
            }

            try {
                project = {
                    name: String(saved.project.name || name),
                    widthMeters: Number(saved.project.widthMeters) || 4.0,
                    depthMeters: Number(saved.project.depthMeters) || 3.0,
                    floorColor: Number(saved.project.floorColor) || 0x121212,
                    floorColorHex: saved.project.floorColorHex || '#121212',
                    wallFinish: saved.project.wallFinish || 'unpainted'
                };
                pieces = JSON.parse(JSON.stringify(saved.pieces));
                nextPieceId = Number(saved.nextPieceId) || (pieces.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1);
                autoLateralFinishes = new Map(Array.isArray(saved.autoLateralFinishes) ? saved.autoLateralFinishes : []);
                selectedPieceId = null;
                selectedPieceIds = new Set();
                selected3dPieceId = null;
                selected3dCapId = null;
                multiSelectEnabled = false;
                undoStack = []; redoStack = [];
                isDragging2D = false;
                dragPieceId = null;

                updateProjectHeader();
                document.getElementById('modal-setup').classList.add('hidden');
                document.getElementById('setup-width').value = project.widthMeters;
                document.getElementById('setup-depth').value = project.depthMeters;
                switchMode('2d');
                updateRoomGeometry();
                updatePiecesListUI();
                updateFinishButtonsUI(project.wallFinish);
                resetCamera();
                updateUndoButtonState();
                showProjectToast(`Proyecto «${project.name}» cargado correctamente.`);
            } catch (error) {
                setSetupFeedback('No se ha podido cargar el proyecto guardado. Puede que sus datos estén dañados.');
            }
        }

        // ---- gestor de proyectos ----
        // Lista de proyectos guardados (en la app de escritorio: los de la carpeta del servidor),
        // con búsqueda, e importación de archivos .ecowall. Antes había que escribir el nombre exacto.
        function isValidProjectSnapshot(saved) {
            return !!(saved && saved.project && Array.isArray(saved.pieces));
        }

        async function openProjectsBrowser() {
            if (typeof window.ecowallSyncProjects === 'function') {
                try { await window.ecowallSyncProjects(); } catch (e) { console.warn(e); }
            }
            let modal = document.getElementById('modal-projects');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'modal-projects';
                modal.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4';
                modal.setAttribute('role', 'dialog');
                modal.setAttribute('aria-modal', 'true');
                modal.innerHTML = `
                  <div class="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
                    <div class="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
                      <div>
                        <h3 class="text-base font-bold text-white">Proyectos guardados</h3>
                        <p data-subtitle class="text-xs text-slate-400">Pulsa un proyecto para abrirlo.</p>
                      </div>
                      <button type="button" data-close class="text-slate-400 hover:text-white p-1" aria-label="Cerrar"><i class="fa-solid fa-xmark text-lg"></i></button>
                    </div>
                    <div class="px-5 pt-4">
                      <input type="search" data-search placeholder="Buscar por nombre…" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500" autocomplete="off">
                    </div>
                    <div data-list class="flex-1 overflow-y-auto px-5 py-4 space-y-2"></div>
                    <div class="flex items-center justify-between gap-3 border-t border-slate-800 px-5 py-3">
                      <label class="cursor-pointer bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition">
                        <i class="fa-solid fa-file-import"></i> Importar archivo .ecowall
                        <input type="file" data-import accept=".ecowall,.json,application/json" class="hidden">
                      </label>
                      <div class="flex items-center gap-3">
                        <button type="button" data-toggle-hidden class="hidden text-xs font-medium text-indigo-300 hover:text-white transition"></button>
                        <button type="button" data-close class="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold transition">Cerrar</button>
                      </div>
                    </div>
                  </div>`;
                document.body.appendChild(modal);
                modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => modal.classList.add('hidden')));
                modal.addEventListener('keydown', e => { if (e.key === 'Escape') modal.classList.add('hidden'); });
                modal.querySelector('[data-search]').addEventListener('input', () => renderProjectsList(modal));
                modal.querySelector('[data-toggle-hidden]').addEventListener('click', () => {
                    modal.dataset.showHidden = modal.dataset.showHidden === '1' ? '0' : '1';
                    renderProjectsList(modal);
                });
                modal.querySelector('[data-import]').addEventListener('change', async e => {
                    const file = e.target.files && e.target.files[0];
                    e.target.value = '';
                    if (file) await importProjectFile(file);
                });
            }
            modal.querySelector('[data-search]').value = '';
            modal.dataset.showHidden = '0';
            renderProjectsList(modal);
            modal.classList.remove('hidden');
            modal.querySelector('[data-search]').focus();
        }

        // Proyectos ocultos de la lista. Ocultar no borra nada: el archivo sigue en la carpeta de proyectos
        // (en la app de escritorio la lista se vuelve a leer de la carpeta, por eso se guarda aparte qué se oculta).
        // Al volver a guardar o importar un proyecto, deja de estar oculto. Desde la lista de ocultos también se
        // puede eliminar definitivamente (en la app de escritorio, con su archivo de la carpeta).
        const HIDDEN_PROJECTS_STORAGE_KEY = 'ecowall_hidden_projects_v1';
        function getHiddenProjectKeys() {
            try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_PROJECTS_STORAGE_KEY) || '[]')); }
            catch (e) { return new Set(); }
        }
        function setProjectHidden(key, hidden) {
            const keys = getHiddenProjectKeys();
            if (hidden) keys.add(key); else keys.delete(key);
            try { localStorage.setItem(HIDDEN_PROJECTS_STORAGE_KEY, JSON.stringify(Array.from(keys))); } catch (e) { /* sin almacenamiento */ }
        }

        function renderProjectsList(modal) {
            const list = modal.querySelector('[data-list]');
            const filter = normalizeProjectName(modal.querySelector('[data-search]').value);
            const showHidden = modal.dataset.showHidden === '1';
            const hiddenKeys = getHiddenProjectKeys();
            const saved = getSavedProjects() || {};
            const valid = Object.entries(saved).filter(([, p]) => isValidProjectSnapshot(p));
            const hiddenCount = valid.filter(([key]) => hiddenKeys.has(key)).length;
            const entries = valid
                .filter(([key]) => hiddenKeys.has(key) === showHidden && (!filter || key.includes(filter)))
                .sort((a, b) => String(b[1].savedAt || '').localeCompare(String(a[1].savedAt || '')));

            const toggle = modal.querySelector('[data-toggle-hidden]');
            if (toggle) {
                toggle.classList.toggle('hidden', !hiddenCount && !showHidden);
                toggle.textContent = showHidden ? 'Volver a la lista' : `Mostrar ocultos (${hiddenCount})`;
            }
            modal.querySelector('[data-subtitle]').textContent = showHidden
                ? 'Proyectos quitados de la lista. Sus archivos siguen guardados.'
                : 'Pulsa un proyecto para abrirlo.';

            list.innerHTML = '';
            if (!entries.length) {
                const empty = showHidden ? 'No hay proyectos ocultos.' : (filter ? 'Ningún proyecto coincide con la búsqueda.' : 'Todavía no hay proyectos guardados.');
                list.innerHTML = `<p class="text-sm text-slate-400 text-center py-8">${empty}</p>`;
                return;
            }
            entries.forEach(([key, p]) => {
                const date = p.savedAt ? new Date(p.savedAt) : null;
                const dateText = date && !isNaN(date) ? date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
                const row = document.createElement('div');
                row.className = 'group w-full rounded-xl border border-slate-800 bg-slate-950/60 hover:border-indigo-500 hover:bg-slate-800/60 transition flex items-center gap-1 pr-2';
                row.innerHTML = `
                  <button type="button" data-open class="flex-1 min-w-0 text-left px-4 py-3 flex items-center gap-3">
                    <span class="shrink-0 w-9 h-9 rounded-lg bg-indigo-600/20 text-indigo-300 flex items-center justify-center"><i class="fa-solid fa-cubes"></i></span>
                    <span class="flex-1 min-w-0">
                      <span class="block text-sm font-semibold text-white truncate">${escapeHtml(p.project.name)}</span>
                      <span class="block text-xs text-slate-400">${escapeHtml(p.project.widthMeters)} × ${escapeHtml(p.project.depthMeters)} m · ${p.pieces.length} piezas</span>
                    </span>
                    <span class="shrink-0 text-[11px] text-slate-500 text-right">${escapeHtml(dateText)}</span>
                  </button>
                  ${showHidden
                    ? `<button type="button" data-restore title="Volver a mostrar en la lista" class="shrink-0 text-xs font-semibold text-indigo-300 hover:text-white hover:bg-slate-700 rounded-lg px-2.5 py-2 transition"><i class="fa-solid fa-rotate-left"></i> Restaurar</button>` +
                      `<button type="button" data-delete-forever title="Eliminar definitivamente (también el archivo de la carpeta de proyectos)" class="shrink-0 text-xs font-semibold text-rose-300 hover:text-white hover:bg-rose-700 rounded-lg px-2.5 py-2 transition"><i class="fa-solid fa-trash-can"></i> Eliminar</button>`
                    : `<button type="button" data-hide title="Quitar de la lista (el archivo no se borra de la carpeta)" aria-label="Quitar de la lista" class="shrink-0 w-8 h-8 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-950/60 transition flex items-center justify-center"><i class="fa-solid fa-trash-can"></i></button>`}`;
                row.querySelector('[data-open]').addEventListener('click', () => {
                    document.getElementById('setup-name').value = p.project.name;
                    modal.classList.add('hidden');
                    window.loadSavedProject();
                });
                const hideBtn = row.querySelector('[data-hide]');
                if (hideBtn) hideBtn.addEventListener('click', async () => {
                    const ok = await ecowallConfirm({
                        title: 'Quitar de la lista',
                        message: `«${p.project.name}» dejará de aparecer en la lista. El archivo del proyecto NO se borra de la carpeta de proyectos y puedes recuperarlo con «Mostrar ocultos».`,
                        confirmText: 'Quitar de la lista',
                        cancelText: 'Cancelar'
                    });
                    if (!ok) return;
                    setProjectHidden(key, true);
                    renderProjectsList(modal);
                    showProjectToast(`«${p.project.name}» quitado de la lista (el archivo sigue guardado).`);
                });
                const restoreBtn = row.querySelector('[data-restore]');
                if (restoreBtn) restoreBtn.addEventListener('click', () => {
                    setProjectHidden(key, false);
                    renderProjectsList(modal);
                    showProjectToast(`«${p.project.name}» vuelve a estar en la lista.`);
                });
                const deleteBtn = row.querySelector('[data-delete-forever]');
                if (deleteBtn) deleteBtn.addEventListener('click', async () => {
                    const desktop = !!(window.__TAURI__ && window.__TAURI__.core);
                    const ok = await ecowallConfirm({
                        title: 'Eliminar definitivamente',
                        message: `«${p.project.name}» se eliminará para siempre${desktop ? ', también su archivo de la carpeta de proyectos (y desaparecerá en todos los equipos)' : ''}. No se puede deshacer.`,
                        confirmText: 'Eliminar',
                        cancelText: 'Cancelar'
                    });
                    if (!ok) return;
                    if (desktop) {
                        try { await window.__TAURI__.core.invoke('delete_project', { name: p.project.name }); }
                        catch (e) { showProjectToast('No se pudo borrar el archivo de la carpeta de proyectos (¿servidor desconectado?): ' + (e && e.message ? e.message : e), 'error'); return; }
                    }
                    const all = getSavedProjects() || {};
                    delete all[key];
                    writeSavedProjects(all);
                    setProjectHidden(key, false);
                    renderProjectsList(modal);
                    showProjectToast(`«${p.project.name}» eliminado definitivamente.`);
                });
                list.appendChild(row);
            });
        }

        async function importProjectFile(file) {
            let saved;
            try { saved = JSON.parse(await file.text()); }
            catch (e) { showProjectToast('El archivo no es un proyecto ECOWALL válido.', 'error'); return; }
            if (!isValidProjectSnapshot(saved)) { showProjectToast('El archivo no es un proyecto ECOWALL válido.', 'error'); return; }
            const name = String(saved.project.name || file.name.replace(/\.[^.]+$/, '')).trim();
            const key = normalizeProjectName(name);
            if (!key) { showProjectToast('El proyecto importado no tiene nombre.', 'error'); return; }
            saved.project.name = name;
            const all = getSavedProjects();
            if (all === null) { showProjectToast('No se puede acceder al almacenamiento del navegador.', 'error'); return; }
            if (all[key] && !(await ecowallConfirm({ title: 'Sustituir proyecto', message: `Ya existe un proyecto llamado «${name}». ¿Sustituirlo por el archivo importado?`, confirmText: 'Sustituir', cancelText: 'Cancelar' }))) return;
            all[key] = saved;
            setProjectHidden(key, false);   // si estaba oculto en la lista, vuelve a aparecer
            writeSavedProjects(all);
            // En la app de escritorio, el proyecto importado también se guarda en la carpeta de proyectos.
            if (window.__TAURI__ && window.__TAURI__.core) {
                try { await window.__TAURI__.core.invoke('save_project', { name, json: JSON.stringify(saved) }); }
                catch (e) { showProjectToast('Importado solo en este equipo: no se pudo guardar en la carpeta de proyectos. ' + (e && e.message ? e.message : e), 'error'); }
            }
            document.getElementById('setup-name').value = name;
            const modal = document.getElementById('modal-projects');
            if (modal) modal.classList.add('hidden');
            window.loadSavedProject();
        }

        async function exportProjectFile() {
            const name = String(project.name || 'proyecto').trim() || 'proyecto';
            const json = JSON.stringify(getCurrentProjectSnapshot(), null, 2);
            const fileName = name.replace(/[\\/:*?"<>|]+/g, '_') + '.ecowall';
            try {
                if (window.__TAURI__ && window.__TAURI__.core) {
                    const saved = await window.__TAURI__.core.invoke('save_text_file', {
                        defaultName: fileName, content: json, filterName: 'Proyecto ECOWALL', extension: 'ecowall'
                    });
                    if (saved) showProjectToast('Proyecto exportado en ' + saved);
                    return;
                }
                const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url; a.download = fileName;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 30000);
            } catch (e) {
                showProjectToast('No se pudo exportar el proyecto: ' + (e && e.message ? e.message : e), 'error');
            }
        }

        function openDeleteSavedProjectConfirm() {
            const modal = document.getElementById('modal-delete-saved-project');
            const message = document.getElementById('delete-saved-project-message');
            const name = String(project && project.name || '').trim();
            const safeName = name || 'este proyecto';
            message.textContent = `¿Deseas eliminar el proyecto guardado «${safeName}»?`;
            modal.classList.remove('hidden');
            document.getElementById('btn-cancel-delete-saved-project').focus();
        }

        function closeDeleteSavedProjectConfirm() {
            const modal = document.getElementById('modal-delete-saved-project');
            if (modal) modal.classList.add('hidden');
            const trigger = document.getElementById('btn-delete-saved-project');
            if (trigger) trigger.focus();
        }

        function confirmDeleteSavedProject() {
            const name = String(project && project.name || '').trim();
            const key = normalizeProjectName(name);
            if (!key) {
                closeDeleteSavedProjectConfirm();
                showProjectToast('El proyecto actual no tiene un nombre válido.', 'error');
                return;
            }

            try {
                const savedProjects = getSavedProjects();
                if (savedProjects === null) throw new Error('No se puede acceder al almacenamiento del navegador.');
                if (!Object.prototype.hasOwnProperty.call(savedProjects, key)) {
                    closeDeleteSavedProjectConfirm();
                    showProjectToast(`No existe un proyecto guardado llamado «${name}». El proyecto actual sigue abierto.`, 'error');
                    return;
                }

                delete savedProjects[key];
                writeSavedProjects(savedProjects);
                closeDeleteSavedProjectConfirm();
                showProjectToast(`Proyecto «${name}» eliminado. Volviendo al menú inicial…`);
                // Recargar la aplicación limpia toda la sesión actual (piezas, selecciones,
                // historial, acabados temporales y geometría) y vuelve al menú inicial.
                // Solo se elimina el proyecto solicitado; los demás guardados permanecen.
                window.setTimeout(() => window.location.reload(), 450);
            } catch (error) {
                closeDeleteSavedProjectConfirm();
                showProjectToast(`No se pudo eliminar el proyecto guardado. ${error && error.message ? error.message : 'Comprueba el almacenamiento del navegador.'}`, 'error');
            }
        }

        function setupModalEvents() {
            document.addEventListener('keydown', (event) => {
                const deleteModal = document.getElementById('modal-delete-saved-project');
                if (event.key === 'Escape' && deleteModal && !deleteModal.classList.contains('hidden')) {
                    closeDeleteSavedProjectConfirm();
                }
            });
            ['setup-width','setup-depth'].forEach(id=>document.getElementById(id).addEventListener('input',updateWorkspaceOccupancyWarning));
            const form = document.getElementById('form-setup');
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const name = String(document.getElementById('setup-name').value || '').trim();
                if (!name) {
                    setSetupFeedback('Introduce un nombre para el proyecto.');
                    return;
                }

                const savedProjects = getSavedProjects();
                if (savedProjects === null) {
                    setSetupFeedback('No se puede acceder al almacenamiento del navegador.');
                    return;
                }
                const key = normalizeProjectName(name);
                const currentKey = normalizeProjectName(project.name);
                if (setupModalPurpose === 'settings') {
                    if (savedProjects[key] && key !== currentKey) {
                        setSetupFeedback('Nombre no válido: ya existe un proyecto guardado con ese nombre.');
                        return;
                    }
                    const previousWidth = project.widthMeters;
                    const previousDepth = project.depthMeters;
                    const nextWidth = parseFloat(document.getElementById('setup-width').value) || 4.0;
                    const nextDepth = parseFloat(document.getElementById('setup-depth').value) || 3.0;
                    const reflow=calculateWorkspaceReflow(nextWidth,nextDepth);
                    if (!reflow.ok) {
                        updateWorkspaceOccupancyWarning();
                        setSetupFeedback('objeto ocupando espacio');
                        return;
                    }
                    project.name=name;
                    project.widthMeters=nextWidth;
                    project.depthMeters=nextDepth;
                    if (Math.abs(previousWidth-nextWidth)>0.0001 || Math.abs(previousDepth-nextDepth)>0.0001) {
                        pieces.forEach(p=>{p.x+=reflow.dx;p.y+=reflow.dy;});
                        undoStack=[]; redoStack=[];
                        updateUndoButtonState();
                    }
                    updateProjectHeader();
                    document.getElementById('modal-setup').classList.add('hidden');
                    updateRoomGeometry();
                    refresh2DSelection();
                    resetCamera();
                    return;
                }

                if (savedProjects[key]) {
                    setSetupFeedback('Nombre no válido: ese nombre ya está en uso por un proyecto guardado. Elige otro nombre o pulsa «Cargar proyecto guardado».');
                    return;
                }

                project = {
                    name,
                    widthMeters: parseFloat(document.getElementById('setup-width').value) || 4.0,
                    depthMeters: parseFloat(document.getElementById('setup-depth').value) || 3.0,
                    floorColor: 0x121212,
                    floorColorHex: '#121212',
                    wallFinish: 'unpainted'
                };
                pieces = [];
                nextPieceId = 1;
                selectedPieceId = null;
                selectedPieceIds = new Set();
                selected3dPieceId = null;
                selected3dCapId = null;
                multiSelectEnabled = false;
                autoLateralFinishes = new Map();
                undoStack = []; redoStack = [];
                updateProjectHeader();
                document.getElementById('modal-setup').classList.add('hidden');
                updateRoomGeometry();
                updatePiecesListUI();
                updateFinishButtonsUI(project.wallFinish);
                resetCamera();
                updateUndoButtonState();
            });
        }

        function initThree() {
            const container = document.getElementById('canvas-container');
            
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x020617);

            camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight || 1, 0.1, 1000);
            camera.position.set(5, 5, 7);

            renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.shadowMap.enabled = true;
            container.appendChild(renderer.domElement);

            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.maxPolarAngle = Math.PI / 2 - 0.05;

            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);

            const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
            dirLight.position.set(10, 20, 15);
            dirLight.castShadow = true;
            scene.add(dirLight);

            const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
            hemiLight.position.set(0, 20, 0);
            scene.add(hemiLight);

            window.addEventListener('resize', onWindowResize);
        }

        function onWindowResize() {
            const container = document.getElementById('canvas-container');
            if (container && container.clientWidth > 0 && container.clientHeight > 0) {
                camera.aspect = container.clientWidth / container.clientHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(container.clientWidth, container.clientHeight);
            }
            drawBlueprint2D();
        }

        function updateRoomGeometry() {
            if (floorMesh) scene.remove(floorMesh);
            if (roomMesh) scene.remove(roomMesh);

            const floorGeo = new THREE.PlaneGeometry(project.widthMeters, project.depthMeters);
            const floorMat = new THREE.MeshStandardMaterial({ color: project.floorColor, roughness: 0.8 });
            floorMesh = new THREE.Mesh(floorGeo, floorMat);
            floorMesh.rotation.x = -Math.PI / 2;
            floorMesh.position.set(project.widthMeters / 2, 0, project.depthMeters / 2);
            floorMesh.receiveShadow = true;
            scene.add(floorMesh);

            const edgesGeo = new THREE.EdgesGeometry(floorGeo);
            const edgesMat = new THREE.LineBasicMaterial({ color: 0x4f46e5, linewidth: 2 });
            roomMesh = new THREE.LineSegments(edgesGeo, edgesMat);
            roomMesh.rotation.x = -Math.PI / 2;
            roomMesh.position.set(project.widthMeters / 2, 0.01, project.depthMeters / 2);
            scene.add(roomMesh);

            if (controls) {
                controls.target.set(project.widthMeters / 2, 0, project.depthMeters / 2);
            }

            pieces.forEach(p => clampPieceToBounds(p));
            rebuildAllPieceMeshes();
            drawBlueprint2D();
        }

        function getPiecePorts(piece) {
            const spec = PIECE_SPECS[piece.type];
            const rad = THREE.MathUtils.degToRad(piece.rotation);
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);

            let localPorts = [];
            if (piece.type === 'muro' || piece.type === 'muro1c') {
                [-0.15, 0, 0.15].forEach(ly => {
                    localPorts.push({ x: -spec.width/2, y: ly, dirX: -1, dirY: 0 });
                    localPorts.push({ x: spec.width/2, y: ly, dirX: 1, dirY: 0 });
                });
            } else if (piece.type === 'esquina') {
                [-0.15, 0, 0.15].forEach(l => {
                    localPorts.push({ x: -0.15, y: l, dirX: -1, dirY: 0 });
                    localPorts.push({ x: 0.15, y: l, dirX: 1, dirY: 0 });
                    localPorts.push({ x: l, y: -0.15, dirX: 0, dirY: -1 });
                    localPorts.push({ x: l, y: 0.15, dirX: 0, dirY: 1 });
                });
            } else if (piece.type === 'esquina45') {
                localPorts = [
                    { x: -0.325, y: 0.1625, dirX: -1, dirY: 0 },
                    { x: 0.1625, y: -0.325, dirX: 0, dirY: -1 }
                ];
            } else if (piece.type === 'pico') {
                [-0.24, -0.09, 0.06].forEach(ly => {
                    localPorts.push({ x: -0.175, y: ly, dirX: -1, dirY: 0 });
                    localPorts.push({ x: 0.175, y: ly, dirX: 1, dirY: 0 });
                });
            } else if (piece.type === 'picodoble') {
                [-0.15, 0, 0.15].forEach(ly => {
                    localPorts.push({ x: -0.175, y: ly, dirX: -1, dirY: 0 });
                    localPorts.push({ x: 0.175, y: ly, dirX: 1, dirY: 0 });
                });
            }

            return localPorts.map(p => ({
                worldX: piece.x + p.x * cos - p.y * sin,
                worldY: piece.y + p.x * sin + p.y * cos,
                localX: p.x,
                localY: p.y
            }));
        }

        function resolveSnappingAndCollision(draggedPiece) {
            const dragPorts = getPiecePorts(draggedPiece);
            let snapped = false;

            for (let other of pieces) {
                if (other.id === draggedPiece.id) continue;
                const otherPorts = getPiecePorts(other);

                for (let dp of dragPorts) {
                    for (let op of otherPorts) {
                        let dist = Math.hypot(dp.worldX - op.worldX, dp.worldY - op.worldY);
                        if (dist < 0.25) {
                            const rad = THREE.MathUtils.degToRad(draggedPiece.rotation);
                            const cos = Math.cos(rad);
                            const sin = Math.sin(rad);

                            let worldOffsetX = dp.localX * cos - dp.localY * sin;
                            let worldOffsetY = dp.localX * sin + dp.localY * cos;

                            draggedPiece.x = op.worldX - worldOffsetX;
                            draggedPiece.y = op.worldY - worldOffsetY;
                            snapped = true;
                            break;
                        }
                    }
                    if (snapped) break;
                }
                if (snapped) break;
            }

            if (snapped) makeRoomForCaps(draggedPiece);
            clampPieceToBounds(draggedPiece);
            return snapped;
        }

        // Si un extremo libre del panel lleva tapa y esa tapa se montaría sobre otra pieza (p. ej. un tramo
        // nuevo que arranca contra el lado de otra pared), el panel se separa lo justo (el grosor de la tapa)
        // para que la tapa empiece en el panel y no pise la otra pieza.
        function makeRoomForCaps(p) {
            if (!CAP_ALLOWANCE_TYPES.includes(p.type)) return;
            const push = capOverlapPush([p], pieces.filter(o => o.id !== p.id));
            if (push) { p.x += push.dx; p.y += push.dy; }
        }

        function getRotatedBoundingBox(piece) {
            const spec = PIECE_SPECS[piece.type];
            const rad = THREE.MathUtils.degToRad(piece.rotation);
            const cos = Math.abs(Math.cos(rad));
            const sin = Math.abs(Math.sin(rad));
            
            return {
                w: spec.width * cos + spec.depth * sin,
                h: spec.width * sin + spec.depth * cos
            };
        }

        // Caja para mantener la pieza dentro del espacio: en los paneles lineales incluye los 50 mm de la
        // tapa que llevan en cada extremo libre, así la tapa de un muro exento nunca queda fuera.
        const CAP_ALLOWANCE_TYPES = ['muro', 'muro1c', 'pico', 'picodoble'];
        function getPlacementBox(piece) {
            if (!CAP_ALLOWANCE_TYPES.includes(piece.type)) return getRotatedBoundingBox(piece);
            const spec = PIECE_SPECS[piece.type];
            const capDepth = PIECE_SPECS.lateral.depth;
            const rad = THREE.MathUtils.degToRad(piece.rotation);
            const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
            const width = spec.width + 2 * capDepth;
            return { w: width * cos + spec.depth * sin, h: width * sin + spec.depth * cos };
        }

        function clampPieceToBounds(p) {
            const bbox = getPlacementBox(p);
            let halfW = bbox.w / 2;
            let halfH = bbox.h / 2;

            if (p.x < halfW) p.x = halfW;
            if (p.x > project.widthMeters - halfW) p.x = project.widthMeters - halfW;
            if (p.y < halfH) p.y = halfH;
            if (p.y > project.depthMeters - halfH) p.y = project.depthMeters - halfH;
            p.x = Number(p.x.toFixed(2));
            p.y = Number(p.y.toFixed(2));
        }

        // Mantener intacta la disposición relativa de todas las piezas.
        // El anclaje se elige por proximidad del conjunto a los bordes existentes.
        function calculateWorkspaceReflow(nextWidth, nextDepth) {
            if (!pieces.length) return {ok:true, dx:0, dy:0};
            const bounds = pieces.map(p => {
                const b = getPlacementBox(p);
                return {left:p.x-b.w/2, right:p.x+b.w/2, top:p.y-b.h/2, bottom:p.y+b.h/2};
            });
            const minX=Math.min(...bounds.map(b=>b.left)), maxX=Math.max(...bounds.map(b=>b.right));
            const minY=Math.min(...bounds.map(b=>b.top)), maxY=Math.max(...bounds.map(b=>b.bottom));
            if (maxX-minX>nextWidth+0.0001 || maxY-minY>nextDepth+0.0001) return {ok:false};
            const anchorRight = project.widthMeters-maxX < minX;
            const anchorBottom = project.depthMeters-maxY < minY;
            // Conservar la distancia al borde de referencia si es posible; si no,
            // desplazar solo lo imprescindible para mantener todo dentro.
            const desiredX = anchorRight ? nextWidth-project.widthMeters : 0;
            const desiredY = anchorBottom ? nextDepth-project.depthMeters : 0;
            const dx=Math.max(-minX,Math.min(nextWidth-maxX,desiredX));
            const dy=Math.max(-minY,Math.min(nextDepth-maxY,desiredY));
            return {ok:true,dx,dy};
        }
        function autoFitWorkspaceDimensions() {
            if (!pieces.length) {
                setSetupFeedback('No hay piezas colocadas para calcular las dimensiones automáticas.');
                return;
            }
            const bounds = pieces.map(p => {
                const b = getPlacementBox(p);
                return { left: p.x - b.w / 2, right: p.x + b.w / 2, top: p.y - b.h / 2, bottom: p.y + b.h / 2 };
            });
            const minX = Math.min(...bounds.map(b => b.left));
            const maxX = Math.max(...bounds.map(b => b.right));
            const minY = Math.min(...bounds.map(b => b.top));
            const maxY = Math.max(...bounds.map(b => b.bottom));
            // Redondeo hacia arriba a centímetros para que ninguna pieza quede fuera por precisión decimal.
            const width = Math.max(0.1, Math.ceil(((maxX - minX) - 0.0001) * 100) / 100);
            const depth = Math.max(0.1, Math.ceil(((maxY - minY) - 0.0001) * 100) / 100);
            document.getElementById('setup-width').value = width.toFixed(2);
            document.getElementById('setup-depth').value = depth.toFixed(2);
            // Aplicar inmediatamente y llevar el conjunto al origen del espacio nuevo,
            // conservando la posición relativa de todas las piezas entre sí.
            pieces.forEach(p => {
                p.x = Number((p.x - minX).toFixed(4));
                p.y = Number((p.y - minY).toFixed(4));
            });
            project.widthMeters = width;
            project.depthMeters = depth;
            undoStack = []; redoStack = [];
            updateUndoButtonState();
            updateProjectHeader();
            document.getElementById('modal-setup').classList.add('hidden');
            updateRoomGeometry();
            refresh2DSelection();
            resetCamera();
            showProjectToast(`Espacio ajustado automáticamente a ${width.toFixed(2)} × ${depth.toFixed(2)} m.`);
        }

        function updateWorkspaceOccupancyWarning() {
            const warning=document.getElementById('setup-occupancy-error');
            if (!warning) return;
            if (setupModalPurpose !== 'settings') { warning.classList.add('hidden'); return; }
            const w=Number(document.getElementById('setup-width').value);
            const d=Number(document.getElementById('setup-depth').value);
            const invalid=Number.isFinite(w)&&w>0&&Number.isFinite(d)&&d>0&&!calculateWorkspaceReflow(w,d).ok;
            warning.classList.toggle('hidden',!invalid);
        }
        function removePiecesOutsideWorkspace() {
            const tolerance = 0.001;
            const removed = [];
            pieces.forEach(p => {
                const bbox = getPlacementBox(p);
                const halfW = bbox.w / 2;
                const halfH = bbox.h / 2;
                const inside =
                    p.x - halfW >= -tolerance &&
                    p.x + halfW <= project.widthMeters + tolerance &&
                    p.y - halfH >= -tolerance &&
                    p.y + halfH <= project.depthMeters + tolerance;
                if (!inside) removed.push(p);
            });

            if (removed.length === 0) return 0;

            const removedIds = new Set(removed.map(p => p.id));
            pieces = pieces.filter(p => !removedIds.has(p.id));
            removedIds.forEach(id => {
                autoLateralFinishes.delete(`auto_cap_${id}_0`);
                autoLateralFinishes.delete(`auto_cap_${id}_1`);
            });

            if (selectedPieceId !== null && removedIds.has(selectedPieceId)) selectedPieceId = null;
            selectedPieceIds = new Set(Array.from(selectedPieceIds).filter(id => !removedIds.has(id)));
            if (selected3dPieceId !== null && removedIds.has(selected3dPieceId)) selected3dPieceId = null;
            if (selected3dCapId && Array.from(removedIds).some(id => String(selected3dCapId).startsWith(`auto_cap_${id}_`))) {
                selected3dCapId = null;
            }
            if (dragPieceId !== null && removedIds.has(dragPieceId)) {
                dragPieceId = null;
                isDragging2D = false;
            }
            if (removed.length > 0) clearOutlines();
            return removed.length;
        }

        // Geometría de reemplazo integrada a partir de los GLB originales.
        const ECOWALL_PICO_VERTEX_COUNT = 4696;
        const ECOWALL_PICO_INDEX_COUNT = 12036;
        const ECOWALL_PICO_GEOMETRY_DATA =
                MODEL_BIN["pico"];
        const ECOWALL_ESQUINA90_VERTEX_COUNT = 2641;
        const ECOWALL_ESQUINA90_INDEX_COUNT = 7002;
        const ECOWALL_ESQUINA90_GEOMETRY_DATA =
                MODEL_BIN["esquina90"];
        const ECOWALL_IMPORTED_NORMAL_JPEG =
                MODEL_BIN["imported_normal_jpeg"];
        const ECOWALL_IMPORTED_ROUGHNESS_JPEG =
                MODEL_BIN["imported_roughness_jpeg"];
        let ecowallPicoReplacementGeometry = null;
        let ecowallEsquina90ReplacementGeometry = null;
        let ecowallImportedSurfaceMaterial = null;
        let ecowallImportedNormalTexture = null;
        let ecowallImportedRoughnessTexture = null;

        function createGeometryFromEmbeddedModel(data, vertexCount, indexCount) {
            const bytes = toBytes(data);
            const floatCount = vertexCount * 8;
            const interleaved = new Float32Array(bytes.buffer, 0, floatCount);
            const indices = new Uint16Array(bytes.buffer, floatCount * 4, indexCount);
            const positions = new Float32Array(vertexCount * 3);
            const normals = new Float32Array(vertexCount * 3);
            const uvs = new Float32Array(vertexCount * 2);
            for (let i = 0; i < vertexCount; i++) {
                const src = i * 8, p = i * 3, uv = i * 2;
                positions[p] = interleaved[src];
                positions[p + 1] = interleaved[src + 1];
                positions[p + 2] = interleaved[src + 2];
                normals[p] = interleaved[src + 3];
                normals[p + 1] = interleaved[src + 4];
                normals[p + 2] = interleaved[src + 5];
                uvs[uv] = interleaved[src + 6];
                uvs[uv + 1] = interleaved[src + 7];
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            return geometry;
        }

        // Proyección UV planar por cara en unidades métricas. Las coordenadas
        // se repiten uniformemente y no dependen de las UV originales del exportado.
        function computeUniformTileableUVs(sourceGeometry) {
            const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry;
            const pos = geometry.getAttribute('position');
            const uv = new Float32Array(pos.count * 2);
            for (let i = 0; i + 2 < pos.count; i += 3) {
                const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
                const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
                const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
                const abx = bx - ax, aby = by - ay, abz = bz - az;
                const acx = cx - ax, acy = cy - ay, acz = cz - az;
                let nx = aby * acz - abz * acy;
                let ny = abz * acx - abx * acz;
                let nz = abx * acy - aby * acx;
                const len = Math.hypot(nx, ny, nz) || 1;
                nx /= len; ny /= len; nz /= len;
                const axis = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? 0
                           : Math.abs(ny) >= Math.abs(nz) ? 1 : 2;
                for (let j = 0; j < 3; j++) {
                    const k = i + j;
                    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
                    if (axis === 0) { uv[k * 2] = z; uv[k * 2 + 1] = y; }
                    else if (axis === 1) { uv[k * 2] = x; uv[k * 2 + 1] = z; }
                    else { uv[k * 2] = x; uv[k * 2 + 1] = y; }
                }
            }
            geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            return geometry;
        }

        function getEcowallReplacementGeometry(type) {
            if (type === 'pico') {
                if (!ecowallPicoReplacementGeometry) {
                    ecowallPicoReplacementGeometry = createGeometryFromEmbeddedModel(
                        ECOWALL_PICO_GEOMETRY_DATA, ECOWALL_PICO_VERTEX_COUNT, ECOWALL_PICO_INDEX_COUNT
                    );
                    // El GLB de PANEL PICO tiene las caras orientadas hacia dentro.
                    // Invertimos el winding y las normales conservando posiciones y UV.
                    const picoIndex = ecowallPicoReplacementGeometry.getIndex();
                    if (picoIndex) {
                        for (let i = 0; i + 2 < picoIndex.count; i += 3) {
                            const second = picoIndex.getX(i + 1);
                            picoIndex.setX(i + 1, picoIndex.getX(i + 2));
                            picoIndex.setX(i + 2, second);
                        }
                        picoIndex.needsUpdate = true;
                    }
                    const picoNormals = ecowallPicoReplacementGeometry.getAttribute('normal');
                    if (picoNormals) {
                        for (let i = 0; i < picoNormals.count; i++) {
                            picoNormals.setXYZ(i, -picoNormals.getX(i), -picoNormals.getY(i), -picoNormals.getZ(i));
                        }
                        picoNormals.needsUpdate = true;
                    }
                    ecowallPicoReplacementGeometry.computeBoundingBox();
                    ecowallPicoReplacementGeometry.computeBoundingSphere();
                }
                return ecowallPicoReplacementGeometry;
            }
            if (type === 'esquina') {
                if (!ecowallEsquina90ReplacementGeometry) {
                    ecowallEsquina90ReplacementGeometry = computeUniformTileableUVs(createGeometryFromEmbeddedModel(
                        ECOWALL_ESQUINA90_GEOMETRY_DATA, ECOWALL_ESQUINA90_VERTEX_COUNT, ECOWALL_ESQUINA90_INDEX_COUNT
                    ));
                }
                return ecowallEsquina90ReplacementGeometry;
            }
            return null;
        }

        function getEcowallImportedSurfaceMaterial() {
            if (ecowallImportedSurfaceMaterial) return ecowallImportedSurfaceMaterial;
            const loader = new THREE.TextureLoader();
            ecowallImportedNormalTexture = loader.load(blobUrl(ECOWALL_IMPORTED_NORMAL_JPEG, 'image/jpeg'));
            ecowallImportedRoughnessTexture = loader.load(blobUrl(ECOWALL_IMPORTED_ROUGHNESS_JPEG, 'image/jpeg'));
            [ecowallImportedNormalTexture, ecowallImportedRoughnessTexture].forEach(texture => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.repeat.set(-1.8, -1.8);
                texture.offset.set(0, 2.8);
                texture.flipY = false;
                texture.needsUpdate = true;
            });
            ecowallImportedSurfaceMaterial = new THREE.MeshStandardMaterial({
                color: WALL_COLORS['unpainted'],
                normalMap: ecowallImportedNormalTexture,
                normalScale: new THREE.Vector2(0.9, 0.9),
                roughnessMap: ecowallImportedRoughnessTexture,
                roughness: 1,
                metalness: 0,
                side: THREE.DoubleSide
            });
            return ecowallImportedSurfaceMaterial;
        }

        function computeUniformBoxUVs(geometry, width, height, depth) {
            const posAttr = geometry.attributes.position;
            const normalAttr = geometry.attributes.normal;
            const uvAttr = geometry.attributes.uv;
            
            if (!posAttr || !normalAttr || !uvAttr) return;

            for (let i = 0; i < posAttr.count; i++) {
                const x = posAttr.getX(i);
                const y = posAttr.getY(i);
                const z = posAttr.getZ(i);
                
                const nx = normalAttr.getX(i);
                const ny = normalAttr.getY(i);
                const nz = normalAttr.getZ(i);

                let u = 0, v = 0;

                if (Math.abs(nx) > 0.9) {
                    u = z + depth / 2;
                    v = y + height / 2;
                } else if (Math.abs(ny) > 0.9) {
                    u = x + width / 2;
                    v = z + depth / 2;
                } else if (Math.abs(nz) > 0.9) {
                    u = x + width / 2;
                    v = y + height / 2;
                }

                uvAttr.setXY(i, u, v);
            }
            uvAttr.needsUpdate = true;
        }

        function createPicoGeometry() {
            const shape = new THREE.Shape();
            shape.moveTo(-0.175, -0.24);
            shape.lineTo(0.175, -0.24);
            shape.lineTo(0.175, 0.06);
            shape.lineTo(0, 0.24);
            shape.lineTo(-0.175, 0.06);
            shape.closePath();

            const extrudeSettings = { steps: 1, depth: 2.4, bevelEnabled: false };
            const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            
            const posAttr = geom.attributes.position;
            const uvAttr = geom.attributes.uv;
            
            if (posAttr && uvAttr) {
                for (let i = 0; i < posAttr.count; i++) {
                    const x = posAttr.getX(i);
                    const z = posAttr.getZ(i);
                    let u = x + 0.175;
                    let v = z + 1.2;
                    uvAttr.setXY(i, u, v);
                }
                uvAttr.needsUpdate = true;
            }

            geom.rotateX(Math.PI / 2);
            geom.computeBoundingBox();
            const yMin = geom.boundingBox.min.y;
            const yMax = geom.boundingBox.max.y;
            geom.translate(0, -(yMin + yMax) / 2, 0);
            return geom;
        }

        function createPicoDobleGeometry() {
            const shape = new THREE.Shape();
            shape.moveTo(0, -0.33);
            shape.lineTo(0.175, -0.15);
            shape.lineTo(0.175, 0.15);
            shape.lineTo(0, 0.33);
            shape.lineTo(-0.175, 0.15);
            shape.lineTo(-0.175, -0.15);
            shape.closePath();

            const extrudeSettings = { steps: 1, depth: 2.4, bevelEnabled: false };
            const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            
            const posAttr = geom.attributes.position;
            const uvAttr = geom.attributes.uv;
            
            if (posAttr && uvAttr) {
                for (let i = 0; i < posAttr.count; i++) {
                    const x = posAttr.getX(i);
                    const z = posAttr.getZ(i);
                    let u = x + 0.175;
                    let v = z + 1.2;
                    uvAttr.setXY(i, u, v);
                }
                uvAttr.needsUpdate = true;
            }

            geom.rotateX(Math.PI / 2);
            geom.computeBoundingBox();
            const yMin = geom.boundingBox.min.y;
            const yMax = geom.boundingBox.max.y;
            geom.translate(0, -(yMin + yMax) / 2, 0);
            return geom;
        }

        function createEsquina45Geometry() {
            if (!ecowallEsquina45Geometry) {
                ecowallEsquina45Geometry = createGeometryFromPackedVertexData(ECOWALL_ESQUINA45_VERTEX_DATA);
                ecowallEsquina45Geometry.computeBoundingBox();
                ecowallEsquina45Geometry.computeBoundingSphere();
            }
            return ecowallEsquina45Geometry;
        }

        // Se llama varias veces por cada repintado: se recalcula solo si cambian las piezas o los acabados.
        let lateralCapsCache = { key: null, caps: [] };
        function computeAutomaticLateralCaps() {
            const key = JSON.stringify(pieces.map(p => [p.id, p.type, p.x, p.y, p.rotation, p.finish])) +
                JSON.stringify(Array.from(autoLateralFinishes.entries()));
            if (key !== lateralCapsCache.key) {
                const caps = computeAutomaticLateralCapsUncached();
                // computeAutomaticLateralCapsUncached puede registrar acabados nuevos: clave tras el cálculo.
                lateralCapsCache = {
                    key: JSON.stringify(pieces.map(p => [p.id, p.type, p.x, p.y, p.rotation, p.finish])) +
                        JSON.stringify(Array.from(autoLateralFinishes.entries())),
                    caps
                };
            }
            return lateralCapsCache.caps.map(c => ({ ...c }));
        }

        const CAP_JOIN_TYPES = ['muro', 'muro1c', 'pico', 'picodoble', 'esquina', 'esquina45'];
        function computeAutomaticLateralCapsUncached() {
            let autoCaps = [];
            let tolerance = 0.05;

            pieces.forEach(p => {
                if (p.type !== 'muro' && p.type !== 'muro1c' && p.type !== 'pico' && p.type !== 'picodoble') return;
                const spec = PIECE_SPECS[p.type];
                const rad = THREE.MathUtils.degToRad(p.rotation);
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);

                let halfW = spec.width / 2;
                let lateralSpec = PIECE_SPECS['lateral'];
                let outwardOffset = halfW + (lateralSpec.depth / 2);

                let centerLocalY = p.type === 'pico' ? -0.09 : 0;
                let rawEnds = [
                    { localX: -outwardOffset, localY: centerLocalY, idx: 0 },
                    { localX: outwardOffset, localY: centerLocalY, idx: 1 }
                ];

                // Caras de unión de cada extremo (plan2d.js): el extremo solo queda cerrado si se une por su
                // cara de unión con otra pieza de construcción (pared en línea o cara turquesa de una esquina).
                // Una pared que empieza contra el lado de otra (un tramo nuevo) lleva tapa en ese extremo.
                const endFaces = typeof getJoinFacesWorld === 'function' ? getJoinFacesWorld(p) : null;

                rawEnds.forEach(end => {
                    let worldX = p.x + (end.localX * cos - end.localY * sin);
                    let worldY = p.y + (end.localX * sin + end.localY * cos);

                    let isExposed = true;
                    if (endFaces) {
                        isExposed = !pieces.some(other => other.id !== p.id && CAP_JOIN_TYPES.includes(other.type) &&
                            getJoinFacesWorld(other).some(face => joinFacesMeet(endFaces[end.idx], face)));
                    } else pieces.forEach(other => {
                        if (other.id === p.id || ['focoPala', 'tvSoporte', 'mesaSillas', 'mesaAlta', 'portaCatalogos'].includes(other.type)) return;
                        const otherSpec = PIECE_SPECS[other.type];
                        if (otherSpec.height < spec.height) return;
                        const oRad = THREE.MathUtils.degToRad(other.rotation);
                        const oCos = Math.cos(oRad);
                        const oSin = Math.sin(oRad);

                        let dx = worldX - other.x;
                        let dy = worldY - other.y;
                        let localOtherX = dx * oCos + dy * oSin;
                        let localOtherY = -dx * oSin + dy * oCos;

                        if (Math.abs(localOtherX) <= otherSpec.width / 2 + tolerance &&
                            Math.abs(localOtherY) <= otherSpec.depth / 2 + tolerance) {
                            isExposed = false;
                        }
                    });

                    if (isExposed) {
                        let capId = `auto_cap_${p.id}_${end.idx}`;
                        let capWorldX = worldX;
                        let capWorldZ = worldY;

                        let capRotation = p.rotation + 90;

                        autoCaps.push({
                            id: capId,
                            parentId: p.id,
                            type: 'lateral',
                            x: capWorldX,
                            y: capWorldZ,
                            x3d: capWorldX,
                            z3d: capWorldZ,
                            rotation: capRotation,
                            // La tapa es blanca salvo que se marque como impresa (seleccionándola en 3D):
                            // imprimir la pared no imprime sus tapas.
                            finish: autoLateralFinishes.get(capId) || 'unpainted',
                            isAuto: true
                        });
                    }
                });
            });

            return autoCaps;
        }

        function switchMode(mode) {
            currentMode = mode;
            const downloadGlbButton = document.getElementById('btn-download-obj');
            if (downloadGlbButton) {
                downloadGlbButton.style.display = mode === '3d' ? 'flex' : 'none';
                downloadGlbButton.classList.toggle('hidden', mode !== '3d');
            }
            const container3d = document.getElementById('canvas-container');
            const container2d = document.getElementById('canvas-2d-container');
            const camHud = document.getElementById('cam-hud');
            const catalogDesc = document.getElementById('catalog-desc');
            const finishes3dExclusive = document.getElementById('finishes-3d-exclusive');
            const catalogItemsContainer = document.getElementById('catalog-items-container');
            const sidebarBottomActions = document.getElementById('sidebar-bottom-actions');

            const btn2d = document.getElementById('mode-btn-2d');
            const btn3d = document.getElementById('mode-btn-3d');

            if (mode === '2d') {
                container3d.classList.add('hidden');
                camHud.classList.add('hidden');
                container2d.classList.remove('hidden');
                sidebarBottomActions.classList.remove('hidden');
                document.getElementById('sidebar-3d-actions').classList.add('hidden');
                btn2d.className = 'px-2.5 md:px-4 py-1.5 rounded-lg text-[11px] md:text-xs font-semibold bg-indigo-600 text-white shadow transition flex items-center gap-1';
                btn3d.className = 'px-2.5 md:px-4 py-1.5 rounded-lg text-[11px] md:text-xs font-semibold text-slate-300 hover:text-white transition flex items-center gap-1';
                
                catalogDesc.textContent = "Haz clic en cualquier elemento para agregarlo al plano 2D.";
                catalogItemsContainer.classList.remove('hidden');
                finishes3dExclusive.classList.add('hidden');
                selected3dPieceId = null;
                selected3dCapId = null;
                clearOutlines();

                drawBlueprint2D();
            } else {
                closeInspector();
                container2d.classList.add('hidden');
                container3d.classList.remove('hidden');
                camHud.classList.remove('hidden');
                sidebarBottomActions.classList.add('hidden');
                document.getElementById('sidebar-3d-actions').classList.remove('hidden');
                btn3d.className = 'px-2.5 md:px-4 py-1.5 rounded-lg text-[11px] md:text-xs font-semibold bg-indigo-600 text-white shadow transition flex items-center gap-1';
                btn2d.className = 'px-2.5 md:px-4 py-1.5 rounded-lg text-[11px] md:text-xs font-semibold text-slate-300 hover:text-white transition flex items-center gap-1';
                
                switchTab('catalog');
                catalogDesc.textContent = "Selecciona un elemento en la vista 3D para cambiar su acabado de forma independiente.";
                catalogItemsContainer.classList.add('hidden');
                finishes3dExclusive.classList.remove('hidden');
                
                setTimeout(() => {
                    onWindowResize();
                    resetCamera();
                }, 50);
            }
        }

        function resetCamera() {
            if (controls && camera) {
                camera.position.set(project.widthMeters + 2, 5, project.depthMeters + 4);
                controls.target.set(project.widthMeters / 2, 1.2, project.depthMeters / 2);
                controls.update();
            }
        }

        // Navegación del plano 2D: zoom con rueda/pellizco y desplazamiento con botón derecho.
        let blueprintZoom = 1;
        let blueprintPanX = 0;
        let blueprintPanY = 0;
        let blueprintNavigationInitialized = false;

        // ECOWALL_APP_v4_OPT: agrupa los repintados provocados por eventos de movimiento.
        let blueprintSelectionOverlay = null;
        let blueprintFramePending = false;
        function requestBlueprintFrame(afterDraw) {
            if (blueprintFramePending) return;
            blueprintFramePending = true;
            requestAnimationFrame(() => {
                blueprintFramePending = false;
                drawBlueprint2D();
                if (afterDraw) afterDraw();
            });
        }

        // Encaje del grupo: si una pieza del grupo queda a menos de 25 cm del conector de una pieza de
        // fuera, todo el grupo se desplaza para unirse (igual que al mover una sola pieza).
        function snapPieceBlock(startPieces) {
            const ids = new Set(startPieces.map(s => s.id));
            const moving = pieces.filter(p => ids.has(p.id) && !p.locked);
            const others = pieces.filter(p => !ids.has(p.id));
            if (!moving.length || !others.length) return false;
            const otherPorts = others.flatMap(o => getPiecePorts(o));
            if (!otherPorts.length) return false;
            let best = null;
            moving.forEach(m => getPiecePorts(m).forEach(dp => otherPorts.forEach(op => {
                const d = Math.hypot(dp.worldX - op.worldX, dp.worldY - op.worldY);
                if (d < 0.25 && (!best || d < best.d)) best = { d, dx: op.worldX - dp.worldX, dy: op.worldY - dp.worldY };
            })));
            if (!best) return false;
            // Solo si el grupo sigue cabiendo dentro del espacio.
            const fits = moving.every(p => {
                const b = getPlacementBox(p), x = p.x + best.dx, y = p.y + best.dy;
                return x - b.w / 2 >= -0.001 && x + b.w / 2 <= project.widthMeters + 0.001 && y - b.h / 2 >= -0.001 && y + b.h / 2 <= project.depthMeters + 0.001;
            });
            if (!fits) return false;
            moving.forEach(p => { p.x = Number((p.x + best.dx).toFixed(3)); p.y = Number((p.y + best.dy).toFixed(3)); });
            // Como con una sola pieza: si una tapa del grupo pisa una pieza de fuera, el grupo se separa lo justo.
            const push = capOverlapPush(moving, others);
            if (push) moving.forEach(p => { p.x = Number((p.x + push.dx).toFixed(3)); p.y = Number((p.y + push.dy).toFixed(3)); });
            return true;
        }

        // Desplazamiento necesario para que ninguna tapa de «moving» pise una pieza de «others» (null si no hace falta).
        function capOverlapPush(moving, others) {
            if (typeof polygonPenetration !== 'function') return null;
            const ids = new Set(moving.map(p => p.id));
            const targets = others.filter(o => !EXTRA_PLAN_TYPES.includes(o.type)).map(o => getFootprintWorld(o));
            let best = null;
            computeAutomaticLateralCaps().filter(cap => ids.has(cap.parentId)).forEach(cap => {
                const capPoly = getFootprintWorld({ ...cap, type: 'lateral' });
                const overlap = Math.max(0, ...targets.map(t => polygonPenetration(capPoly, t)));
                if (overlap < 0.003 || (best && overlap <= best.overlap)) return;
                const parent = pieces.find(p => p.id === cap.parentId);
                const dx = parent.x - cap.x, dy = parent.y - cap.y, len = Math.hypot(dx, dy) || 1;
                best = { overlap, dx: dx / len * overlap, dy: dy / len * overlap };
            });
            return best;
        }

        function movePieceBlock(startPieces, deltaX, deltaY) {
            // Las piezas bloqueadas no se mueven con el grupo.
            const block = startPieces.filter(start => pieces.some(p => p.id === start.id && !p.locked));
            if (block.length === 0) return;

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            block.forEach(start => {
                const bbox = getPlacementBox(start);
                minX = Math.min(minX, start.x - bbox.w / 2);
                maxX = Math.max(maxX, start.x + bbox.w / 2);
                minY = Math.min(minY, start.y - bbox.h / 2);
                maxY = Math.max(maxY, start.y + bbox.h / 2);
            });

            const dx = Math.max(-minX, Math.min(project.widthMeters - maxX, Math.round(deltaX * 100) / 100));
            const dy = Math.max(-minY, Math.min(project.depthMeters - maxY, Math.round(deltaY * 100) / 100));
            block.forEach(start => {
                const piece = pieces.find(p => p.id === start.id);
                piece.x = Number((start.x + dx).toFixed(3));
                piece.y = Number((start.y + dy).toFixed(3));
            });
        }

        function setup2DNavigation() {
            const canvas = document.getElementById('blueprint-canvas');
            if (!canvas || blueprintNavigationInitialized) return;
            blueprintNavigationInitialized = true;
            canvas.style.touchAction = 'none';
            canvas.style.cursor = 'crosshair';

            // Rueda: zoom centrado en el plano. Se limita para evitar perder el espacio.
            canvas.addEventListener('wheel', (e) => {
                if (currentMode !== '2d') return;
                e.preventDefault();
                const oldZoom = blueprintZoom;
                const factor = Math.exp(-e.deltaY * 0.0012);
                blueprintZoom = Math.max(1, Math.min(8, blueprintZoom * factor));
                if (Math.abs(blueprintZoom - oldZoom) < 0.0001) return;
                // Ajuste de pan para mantener aproximadamente fijo el centro visual del zoom.
                const rect = canvas.getBoundingClientRect();
                const cx = e.clientX - rect.left - canvas.clientWidth / 2;
                const cy = e.clientY - rect.top - canvas.clientHeight / 2;
                const ratio = blueprintZoom / oldZoom;
                blueprintPanX = cx - (cx - blueprintPanX) * ratio;
                blueprintPanY = cy - (cy - blueprintPanY) * ratio;
                requestBlueprintFrame();
            }, { passive: false });

            // Botón derecho: desplazar el plano cuando el zoom está ampliado.
            let panning = false, lastX = 0, lastY = 0;
            canvas.addEventListener('contextmenu', e => e.preventDefault());
            canvas.addEventListener('mousedown', e => {
                if (currentMode !== '2d' || e.button !== 2) return;
                e.preventDefault();
                panning = true;
                lastX = e.clientX; lastY = e.clientY;
                canvas.style.cursor = 'grabbing';
            });
            window.addEventListener('mousemove', e => {
                if (!panning) return;
                blueprintPanX += e.clientX - lastX;
                blueprintPanY += e.clientY - lastY;
                lastX = e.clientX; lastY = e.clientY;
                requestBlueprintFrame();
            });
            window.addEventListener('mouseup', e => {
                if (e.button === 2 && panning) {
                    panning = false;
                    canvas.style.cursor = 'crosshair';
                }
            });
            window.addEventListener('blur', () => { panning = false; canvas.style.cursor = 'crosshair'; });

            // Pellizco de dos dedos para hacer zoom en pantallas táctiles.
            let pinchDistance = 0, pinchMidX = 0, pinchMidY = 0;
            const touchDistance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
            canvas.addEventListener('touchstart', e => {
                if (currentMode !== '2d' || e.touches.length !== 2) return;
                e.preventDefault();
                pinchDistance = touchDistance(e.touches);
                const rect = canvas.getBoundingClientRect();
                pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - canvas.clientWidth / 2;
                pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top - canvas.clientHeight / 2;
            }, { passive: false });
            canvas.addEventListener('touchmove', e => {
                if (currentMode !== '2d' || e.touches.length !== 2 || !pinchDistance) return;
                e.preventDefault();
                const distance = touchDistance(e.touches);
                const oldZoom = blueprintZoom;
                blueprintZoom = Math.max(1, Math.min(8, blueprintZoom * (distance / pinchDistance)));
                const ratio = blueprintZoom / oldZoom;
                blueprintPanX = pinchMidX - (pinchMidX - blueprintPanX) * ratio;
                blueprintPanY = pinchMidY - (pinchMidY - blueprintPanY) * ratio;
                pinchDistance = distance;
                const rect = canvas.getBoundingClientRect();
                pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left - canvas.clientWidth / 2;
                pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top - canvas.clientHeight / 2;
                requestBlueprintFrame();
            }, { passive: false });
            canvas.addEventListener('touchend', e => { if (e.touches.length < 2) pinchDistance = 0; });
            canvas.addEventListener('touchcancel', () => { pinchDistance = 0; });
        }

        function setup2DDragging() {
            const canvas = document.getElementById('blueprint-canvas');
            if (!canvas) return;

            const getEventPos = (e) => {
                const rect = canvas.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return { x: clientX - rect.left, y: clientY - rect.top };
            };

            let dragStarted = false;
            let pointerStart = null;
            let blockStartPieces = [];
            let deselectOnClick = null;
            let hasMoved = false;
            let boxSelecting = false;
            let boxStart = null;
            let boxCurrent = null;
            let selectionBeforeBox = new Set();

            const handleStart = (e) => {
                if (currentMode !== '2d') return;
                if (e.type === 'mousedown' && e.button !== 0) return;
                if (e.touches && e.touches.length !== 1) return;
                const pos = getEventPos(e);
                const clickX = pos.x;
                const clickY = pos.y;

                let scale = parseFloat(canvas.dataset.scale);
                let originX = parseFloat(canvas.dataset.originX);
                let originY = parseFloat(canvas.dataset.originY);
                if (!Number.isFinite(scale) || scale <= 0) return;

                deselectOnClick = null;
                hasMoved = false;
                pointerStart = pos;
                blockStartPieces = [];

                let foundId = null;
                for (let i = pieces.length - 1; i >= 0; i--) {
                    let p = pieces[i];
                    let px = originX + p.x * scale;
                    let py = originY + p.y * scale;
                    const bbox = getRotatedBoundingBox(p);
                    let pw = bbox.w * scale;
                    let ph = bbox.h * scale;

                    if (clickX >= px - pw / 2 && clickX <= px + pw / 2 && clickY >= py - ph / 2 && clickY <= py + ph / 2) {
                        foundId = p.id;
                        break;
                    }
                }

                if (foundId !== null) {
                    // En multiselección, un clic alterna la pertenencia del objeto:
                    // los seleccionados se quitan y los no seleccionados se añaden.
                    // Si se arrastra una pieza ya seleccionada, se sigue moviendo el grupo.
                    const inMultiSelection = multiSelectEnabled && selectedPieceIds.size > 1;
                    isDragging2D = true;
                    dragPieceId = foundId;
                    dragStarted = true;
                    if (inMultiSelection) {
                        if (selectedPieceIds.has(foundId)) {
                            deselectOnClick = foundId;
                            blockStartPieces = pieces.filter(p => selectedPieceIds.has(p.id)).map(p => ({ ...p }));
                        } else {
                            deselectOnClick = foundId;
                            // Evita mover el grupo al pulsar una pieza que aún no pertenece
                            // a la selección; se añadirá al soltar sin arrastrar.
                            dragStarted = false;
                            blockStartPieces = [];
                        }
                    } else {
                        selectedPieceIds.clear();
                        selectedPieceId = foundId;
                        multiSelectEnabled = false;
                        blockStartPieces = [];
                    }
                    let p = pieces.find(x => x.id === foundId);
                    let px = originX + p.x * scale;
                    let py = originY + p.y * scale;
                    dragOffsetX = clickX - px;
                    dragoffsetY = clickY - py;
                    if (e.type === 'touchstart') e.preventDefault();
                } else {
                    if (e.type === 'mousedown' && e.button === 0) {
                        boxSelecting = true;
                        boxStart = pos;
                        boxCurrent = pos;
                        blueprintSelectionOverlay = {start:boxStart,end:boxCurrent};
                        selectionBeforeBox = new Set();
                        selectedPieceId = null;
                        selectedPieceIds.clear();
                        multiSelectEnabled = false;
                        isDragging2D = false;
                        dragPieceId = null;
                        drawBlueprint2D();
                        return;
                    }
                    closeInspector();
                }
            };

            const handleMove = (e) => {
                const pos = getEventPos(e);
                if (boxSelecting && currentMode === '2d') {
                    boxCurrent = pos;
                    blueprintSelectionOverlay = {start:boxStart,end:boxCurrent};
                    requestBlueprintFrame();
                    return;
                }
                if (!isDragging2D || dragPieceId === null || currentMode !== '2d') return;
                // Pieza bloqueada: se puede seleccionar, pero no arrastrar.
                if (!multiSelectEnabled && (pieces.find(x => x.id === dragPieceId) || {}).locked) return;
                if (multiSelectEnabled && !hasMoved && Math.hypot(pos.x - pointerStart.x, pos.y - pointerStart.y) < 4) {
                    if (e.type === 'touchmove') e.preventDefault();
                    return;
                }

                if (dragStarted) {
                    saveState();
                    dragStarted = false;
                }
                hasMoved = true;

                let scale = parseFloat(canvas.dataset.scale);
                let originX = parseFloat(canvas.dataset.originX);
                let originY = parseFloat(canvas.dataset.originY);

                let targetX = (pos.x - dragOffsetX - originX) / scale;
                let targetY = (pos.y - dragoffsetY - originY) / scale;

                let p = pieces.find(x => x.id === dragPieceId);
                if (p) {
                    if (multiSelectEnabled) {
                        movePieceBlock(blockStartPieces, (pos.x - pointerStart.x) / scale, (pos.y - pointerStart.y) / scale);
                        snapPieceBlock(blockStartPieces);
                    } else {
                        p.x = targetX;
                        p.y = targetY;
                        // Unión por conectores; si no hay, alineación con bordes/centros de otras piezas.
                        if (!resolveSnappingAndCollision(p)) applyAlignmentGuides(p); else clearAlignmentGuides();
                    }
                    // La vista 3D está oculta durante la edición 2D: actualizar sus
                    // mallas y la lista en cada pixel de movimiento es innecesario.
                    requestBlueprintFrame();
                    if (e.type === 'touchmove') e.preventDefault();
                }
            };

            const handleEnd = (e) => {
                if (boxSelecting) {
                    boxSelecting = false;
                    blueprintSelectionOverlay = null;
                    const a=boxStart, b=boxCurrent || boxStart;
                    const left=Math.min(a.x,b.x), right=Math.max(a.x,b.x), top=Math.min(a.y,b.y), bottom=Math.max(a.y,b.y);
                    const scale=parseFloat(canvas.dataset.scale), ox=parseFloat(canvas.dataset.originX), oy=parseFloat(canvas.dataset.originY);
                    selectedPieceIds = new Set();
                    if (right-left>3 || bottom-top>3) {
                        pieces.forEach(p=>{
                            const bb=getRotatedBoundingBox(p), px=ox+p.x*scale, py=oy+p.y*scale;
                            const pw=bb.w*scale, ph=bb.h*scale;
                            if (px+pw/2>=left && px-pw/2<=right && py+ph/2>=top && py-ph/2<=bottom) selectedPieceIds.add(p.id);
                        });
                    }
                    if (selectedPieceIds.size === 1) {
                        selectedPieceId = Array.from(selectedPieceIds)[0];
                        selectedPieceIds.clear();
                        multiSelectEnabled = false;
                    } else {
                        selectedPieceId = null;
                        multiSelectEnabled = selectedPieceIds.size > 1;
                    }
                    boxStart=null; boxCurrent=null; selectionBeforeBox=new Set();
                    refresh2DSelection();
                    return;
                }
                const clickedPieceWithoutDragging = isDragging2D && !hasMoved;
                if (isDragging2D && multiSelectEnabled && !hasMoved && deselectOnClick !== null && e.type !== 'touchcancel') {
                    const clickedId = deselectOnClick;
                    if (selectedPieceIds.has(clickedId)) {
                        selectedPieceIds.delete(clickedId);
                        if (selectedPieceIds.size === 1) {
                            selectedPieceId = Array.from(selectedPieceIds)[0];
                            selectedPieceIds.clear();
                            multiSelectEnabled = false;
                        } else if (selectedPieceIds.size === 0) {
                            selectedPieceId = null;
                            multiSelectEnabled = false;
                        } else {
                            selectedPieceId = null;
                            multiSelectEnabled = true;
                        }
                    } else {
                        selectedPieceIds.add(clickedId);
                        selectedPieceId = null;
                        multiSelectEnabled = true;
                    }
                    refresh2DSelection();
                }
                const finishedDrag = isDragging2D && hasMoved;
                isDragging2D = false;
                dragPieceId = null;
                clearAlignmentGuides();
                if (finishedDrag) {
                    rebuildAllPieceMeshes();
                    updatePiecesListUI();
                    drawBlueprint2D();
                }
                dragStarted = false;
                blockStartPieces = [];
                deselectOnClick = null;
                pointerStart = null;
                // Al terminar un clic normal sobre una pieza, refresca el inspector individual.
                // La selección se establece en handleStart, pero sin este refresco el panel no aparece.
                if (clickedPieceWithoutDragging && !multiSelectEnabled) refresh2DSelection();
            };

            canvas.addEventListener('mousedown', handleStart);
            window.addEventListener('mousemove', handleMove);
            canvas.addEventListener('touchstart', handleStart, { passive: false });
            canvas.addEventListener('touchmove', handleMove, { passive: false });
            canvas.addEventListener('touchend', handleEnd);
            canvas.addEventListener('touchcancel', handleEnd);
            window.addEventListener('mouseup', handleEnd);
            window.addEventListener('blur', () => {
                boxSelecting = false; boxStart = null; boxCurrent = null;
                blueprintSelectionOverlay = null;
                isDragging2D = false;
                dragPieceId = null;
            });
        }

        function setupKeyboardEvents() {
            window.addEventListener('keydown', (e) => {
                const key = e.key.toLowerCase();
                if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
                    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                        return;
                    }
                    e.preventDefault();
                    // Ctrl+Z deshace; Ctrl+Y o Ctrl+Mayús+Z rehace.
                    if (key === 'y' || e.shiftKey) redo(); else undo();
                    return;
                }

                // Flechas: mover la pieza o el grupo seleccionado 1 cm (10 cm con Mayús).
                if (currentMode === '2d' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                    const tag = document.activeElement && document.activeElement.tagName;
                    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
                    const ids = selectedPieceIds.size > 1 ? Array.from(selectedPieceIds) : (selectedPieceId !== null ? [selectedPieceId] : []);
                    const targets = pieces.filter(p => ids.includes(p.id) && !p.locked);
                    if (!targets.length) return;
                    e.preventDefault();
                    const step = e.shiftKey ? 0.1 : 0.01;
                    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
                    if (!e.repeat) saveState();
                    movePieceBlock(targets.map(p => ({ ...p })), dx, dy);
                    rebuildAllPieceMeshes();
                    drawBlueprint2D();
                    return;
                }

                if (e.key === 'Delete' || e.key === 'Backspace') {
                    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                        return;
                    }
                    if (currentMode === '2d' && selectedPieceIds.size > 1) {
                        e.preventDefault();
                        deleteSelectionGroup();
                    } else if (currentMode === '2d' && selectedPieceId !== null) {
                        e.preventDefault();
                        deleteSelectedPiece();
                    } else if (currentMode === '3d' && selected3dPieceId !== null) {
                        e.preventDefault();
                        deletePieceById(selected3dPieceId);
                        select3dPiece(null);
                    }
                }
            });
        }

        function setup3DClickSelecting() {
            const container = document.getElementById('canvas-container');
            container.addEventListener('click', (e) => {
                if (currentMode !== '3d') return;
                const rect = container.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / container.clientWidth) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / container.clientHeight) * 2 + 1;

                raycaster.setFromCamera(mouse, camera);
                let allMeshes = [...pieces.filter(p => p.type !== 'focoPala' && p.type !== 'tvSoporte' && p.type !== 'mesaSillas' && p.type !== 'portaCatalogos' && p.type !== 'mesaAlta').map(p => pieceMeshes.get(p.id)).filter(Boolean), ...Array.from(autoLateralMeshes.values())];
                let intersects = raycaster.intersectObjects(allMeshes, false);

                if (intersects.length > 0) {
                    let hitMesh = intersects[0].object;
                    if (hitMesh.userData.isCap) {
                        select3dCap(hitMesh.userData.id);
                    } else {
                        const clickedPiece = pieces.find(p => p.id === hitMesh.userData.id);
                        if (clickedPiece && clickedPiece.type === 'muro' && intersects[0].face) {
                            const n = intersects[0].face.normal;
                            if (Math.abs(n.z) > 0.55) clickedPiece.printSide = n.z < 0 ? -1 : 1;
                        } else if (clickedPiece && (clickedPiece.type === 'mostrador' || clickedPiece.type === 'mostrador1m')) {
                            // El mostrador se dibuja por las dos caras: el lado se toma del punto pulsado.
                            const local = hitMesh.worldToLocal(intersects[0].point.clone());
                            if (Math.abs(local.z) > 0.08) clickedPiece.printSide = local.z < 0 ? -1 : 1;
                        } else if (clickedPiece && clickedPiece.type === 'pico') {
                            // Pico: frente en punta (delante) o trasera plana (detrás).
                            const local = hitMesh.worldToLocal(intersects[0].point.clone());
                            if (Math.abs(local.z) > 0.03) clickedPiece.printSide = local.z < 0 ? -1 : 1;
                        }
                        select3dPiece(hitMesh.userData.id);
                    }
                } else {
                    select3dPiece(null);
                    select3dCap(null);
                }
            });
        }

        function select3dPiece(id) {
            selected3dPieceId = id;
            selected3dCapId = null;
            clearOutlines();

            if (id !== null) {
                let piece = pieces.find(p => p.id === id);
                let mesh = pieceMeshes.get(id);
                if (piece && mesh) {
                    const spec = PIECE_SPECS[piece.type];
                    let outlineGeo;
                    let outlineCenterOffset = null;
                    if (piece.type === 'muro1c') {
                        // La geometría 1C conserva el origen local del GLB, que no
                        // coincide con el centro de su volumen visible. Centrar la
                        // caja en sus bounds evita que aparezca debajo del suelo.
                        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
                        const bounds = mesh.geometry.boundingBox;
                        const boundsSize = bounds.getSize(new THREE.Vector3());
                        outlineCenterOffset = bounds.getCenter(new THREE.Vector3());
                        outlineGeo = new THREE.BoxGeometry(
                            Math.max(boundsSize.x * 1.05, 0.01),
                            Math.max(boundsSize.y * 1.02, 0.01),
                            Math.max(boundsSize.z * 1.05, 0.01)
                        );
                    } else if (piece.type === 'esquina45') {
                        outlineGeo = createEsquina45Geometry();
                    } else if (piece.type === 'pico') {
                        outlineGeo = createPicoGeometry();
                    } else if (piece.type === 'picodoble') {
                        outlineGeo = createPicoDobleGeometry();
                    } else {
                        outlineGeo = new THREE.BoxGeometry(spec.width * 1.05, spec.height * 1.02, spec.depth * 1.05);
                    }
                    const outlineMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true });
                    const outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
                    outlineMesh.position.copy(mesh.position);
                    outlineMesh.rotation.copy(mesh.rotation);
                    if (outlineCenterOffset) outlineMesh.position.add(outlineCenterOffset.applyEuler(mesh.rotation));
                    scene.add(outlineMesh);
                    outlineMeshes.set(id, outlineMesh);

                    updateFinishButtonsUI(piece.finish);
                }
            }
        }

        function select3dCap(capId) {
            selected3dCapId = capId;
            selected3dPieceId = null;
            clearOutlines();

            if (capId !== null) {
                let mesh = autoLateralMeshes.get(capId);
                let autoCaps = computeAutomaticLateralCaps();
                let cap = autoCaps.find(c => c.id === capId);
                if (cap && mesh) {
                    const spec = PIECE_SPECS['lateral'];
                    const outlineGeo = new THREE.BoxGeometry(spec.width * 1.1, spec.height * 1.02, spec.depth * 1.1);
                    const outlineMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true });
                    const outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
                    outlineMesh.position.copy(mesh.position);
                    outlineMesh.rotation.copy(mesh.rotation);
                    scene.add(outlineMesh);
                    outlineMeshes.set(capId, outlineMesh);

                    updateFinishButtonsUI(cap.finish);
                }
            }
        }

        function updateFinishButtonsUI(activeFinish) {
            const btnUnpainted = document.getElementById('wall-btn-unpainted');
            const btnPainted = document.getElementById('wall-btn-painted');

            if (activeFinish === 'unpainted') {
                btnUnpainted.className = 'py-2 px-3 rounded-lg text-xs font-semibold bg-slate-800 border-2 border-indigo-500 text-white transition flex items-center justify-center gap-2';
                btnPainted.className = 'py-2 px-3 rounded-lg text-xs font-semibold bg-slate-800 border-2 border-transparent hover:border-slate-500 text-slate-300 transition flex items-center justify-center gap-2';
            } else {
                btnPainted.className = 'py-2 px-3 rounded-lg text-xs font-semibold bg-slate-800 border-2 border-indigo-500 text-white transition flex items-center justify-center gap-2';
                btnUnpainted.className = 'py-2 px-3 rounded-lg text-xs font-semibold bg-slate-800 border-2 border-transparent hover:border-slate-500 text-slate-300 transition flex items-center justify-center gap-2';
            }
        }

        function clearOutlines() {
            outlineMeshes.forEach(mesh => { scene.remove(mesh); disposeObject3D(mesh); });
            outlineMeshes.clear();
        }

        function addPieceToScene(type) {
            if (currentMode !== '2d') return;
            saveState();

            const newPiece = {
                id: nextPieceId++,
                type: type,
                x: Number((project.widthMeters / 2).toFixed(2)),
                y: Number((project.depthMeters / 2).toFixed(2)),
                rotation: 0,
                finish: 'unpainted'   // las piezas nuevas salen siempre en blanco; se imprimen después en 3D
            };

            clampPieceToBounds(newPiece);
            pieces.push(newPiece);
            rebuildAllPieceMeshes();
            updatePiecesListUI();
            selectPiece(newPiece.id);
            drawBlueprint2D();
        }


        // ECOWALL v19: geometría real del MURO ESTÁNDAR integrada en el HTML.
        // La geometría mantiene la escala real, el material del configurador y
        // proyección UV planar en metros, equivalente a computeUniformBoxUVs.
        const ECOWALL_MURO_VERTEX_DATA = MODEL_BIN["muro"];
        let ecowallMuroGeometry = null;
        function getEcowallMuroGeometry() {
            if (ecowallMuroGeometry) return ecowallMuroGeometry;
            const binary = toBytes(ECOWALL_MURO_VERTEX_DATA);
            const floats = new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4);
            const count = floats.length / 8;
            const pos = new Float32Array(count*3), normals = new Float32Array(count*3), uv = new Float32Array(count*2);
            for (let i=0; i<count; i++) {
                pos.set(floats.subarray(i*8,i*8+3),i*3);
                normals.set(floats.subarray(i*8+3,i*8+6),i*3);
                uv.set(floats.subarray(i*8+6,i*8+8),i*2);
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(pos,3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals,3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uv,2));
            geometry.computeBoundingSphere();
            ecowallMuroGeometry = geometry;
            return geometry;
        }

        // ECOWALL: geometría real de PANEL UNIVERSAL 1C integrada desde su GLB.
        // Se conservan las coordenadas locales y el origen/pivote originales del GLB.
        const ECOWALL_MURO1C_VERTEX_DATA = MODEL_BIN["muro1c"];
        let ecowallMuro1CGeometry = null;
        function getEcowallMuro1CGeometry() {
            if (ecowallMuro1CGeometry) return ecowallMuro1CGeometry;
            const binary = toBytes(ECOWALL_MURO1C_VERTEX_DATA);
            const floats = new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4);
            const count = floats.length / 8;
            const pos = new Float32Array(count * 3);
            const normals = new Float32Array(count * 3);
            const uv = new Float32Array(count * 2);
            for (let i = 0; i < count; i++) {
                const src = i * 8, p = i * 3, t = i * 2;
                pos.set(floats.subarray(src, src + 3), p);
                normals.set(floats.subarray(src + 3, src + 6), p);
                uv.set(floats.subarray(src + 6, src + 8), t);
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            ecowallMuro1CGeometry = geometry;
            return geometry;
        }

        // Modelos 3D incorporados desde los GLB adjuntos; no requieren archivos externos.
        const ECOWALL_PICODOBLE_VERTEX_DATA = MODEL_BIN["picodoble"];
        const ECOWALL_MOSTRADOR_VERTEX_DATA = MODEL_BIN["mostrador"];
        // ESQUINA 45º: geometría del GLB adjunto, centrada en altura y alineada por su diagonal larga.
        const ECOWALL_ESQUINA45_VERTEX_DATA =
            MODEL_BIN["esquina45"];
        let ecowallEsquina45Geometry = null;

        let ecowallPicoDobleGeometry = null;
        let ecowallMostradorGeometry = null;

        function createGeometryFromPackedVertexData(data) {
            const bytes = toBytes(data);
            if (bytes.byteLength % 32 !== 0) throw new Error('Datos de geometría 3D incompletos.');
            const packed = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
            const count = packed.length / 8;
            const positions = new Float32Array(count * 3);
            const normals = new Float32Array(count * 3);
            const uvs = new Float32Array(count * 2);
            for (let i = 0; i < count; i++) {
                const src = i * 8, p = i * 3, uv = i * 2;
                positions[p] = packed[src];
                positions[p + 1] = packed[src + 1];
                positions[p + 2] = packed[src + 2];
                normals[p] = packed[src + 3];
                normals[p + 1] = packed[src + 4];
                normals[p + 2] = packed[src + 5];
                uvs[uv] = packed[src + 6];
                uvs[uv + 1] = packed[src + 7];
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            return geometry;
        }

        function getEcowallPicoDobleGeometry() {
            if (!ecowallPicoDobleGeometry) ecowallPicoDobleGeometry = createGeometryFromPackedVertexData(ECOWALL_PICODOBLE_VERTEX_DATA);
            return ecowallPicoDobleGeometry;
        }
        function repairMostradorGeometryNormals(geometry) {
            // El mostrador se exportó como triángulos independientes. Recalcular las
            // normales desde su geometría evita conservar normales de vértice
            // inconsistentes heredadas del GLB; el orden de la malla y las UV no cambian.
            const position = geometry && geometry.getAttribute('position');
            if (position && position.count % 3 === 0) {
                geometry.computeVertexNormals();
                geometry.computeBoundingBox();
                geometry.computeBoundingSphere();
            }
            return geometry;
        }

        // MOSTRADOR 1M: malla REAL del archivo MOSTRADOR 1M.glb (66006 vertices),
        // independiente de la malla del MOSTRADOR 2M (52020 vertices).
        const ECOWALL_MOSTRADOR_1M_VERTEX_DATA = MODEL_BIN["mostrador_1m"];
        let ecowallMostrador1mGeometry = null;
        function getEcowallMostrador1mGeometry() {
            if (!ecowallMostrador1mGeometry) ecowallMostrador1mGeometry = repairMostradorGeometryNormals(createGeometryFromPackedVertexData(ECOWALL_MOSTRADOR_1M_VERTEX_DATA));
            return ecowallMostrador1mGeometry;
        }
        function getEcowallMostradorGeometry() {
            if (!ecowallMostradorGeometry) {
                ecowallMostradorGeometry = repairMostradorGeometryNormals(
                    createGeometryFromPackedVertexData(ECOWALL_MOSTRADOR_VERTEX_DATA)
                );
            }
            return ecowallMostradorGeometry;
        }


        // Foco pala: geometría embebida del GLB. Se conserva su altura/orientación original;
        // solo se compensa la traslación X/Z del nodo para que el centro caiga en la posición 2D.
        const ECOWALL_FOCO_PALA_PARTS = [
            { data: MODEL_BIN["foco_pala_parts"], vertices: 251, indices: 858, material: 0 },
            { data: 'wPqmvbasHUAwHvw9agt5O8sYaD8BBdi+AAAAAAAAgD9A5KU9RaYdQGhl/T1qC3k7yxhoPwEF2L4AAAAAAACAP0D3pj0B5hdAkAmOvWoLeTvLGGg/AQXYvgAAAAAAAIA/wOelvXLsF0DYUI+9agt5O8sYaD8BBdi+AAAAAAAAgD8DAAAAAQADAAEAAgA=', vertices: 4, indices: 6, material: 1 }
        ];

        const ECOWALL_TV_SOPORTE_PARTS = [{"data": "kE4hvyT7AUAM27e9YP8Tvxe+Ez8qqhO/AAAAAAAAAACQTiG/h1mnPxrbt71h/xO/FL4TvyyqE78AAAAAAAAAAMAkIj8k+wFAUhO1vQabEz9r3BM/MfATvwAAAAAAAAAAwCQiP4VZpz9gE7W9BZsTP2vcE78y8BO/AAAAAAAAAABAAh0/iNkAQESyX72IK7G6VIu7ufD/fz8AAAAAAAAAAGAdHL+I2QBA3PtkvaZ/srqxUbM57/9/PwAAAAAAAAAAYB0cv7qcqT/8+2S9miGxulJUu7nw/38/AAAAAAAAAABAAh0/upypP2CyX72qcbK6KBizOe//fz8AAAAAAAAAACAsIj8k+wFADI9fvaZFNT/nwzQ/p1YauwAAAAAAAAAAICwiPyT7AUAMj1+9Fqi1us6soLnv/38/AAAAAAAAAAAwRyG/JPsBQBQfZb3TwzS/u0U1P8LoGTsAAAAAAAAAADBHIb8k+wFAFB9lvV7TtrqwwqE57/9/PwAAAAAAAAAAMEchv4dZpz8wH2W9gJy1ugF+oLnv/38/AAAAAAAAAAAwRyG/h1mnPzAfZb3VwzS/uUU1v8ToGTsAAAAAAAAAACAsIj+FWac/LI9fvUzFtrqAjKE57/9/PwAAAAAAAAAAICwiP4VZpz8sj1+9p0U1P+fDNL+rVhq7AAAAAAAAAAAAAAIAAwAAAAMAAQABAAMADwABAA8ADQACAAAACgACAAoACAADAAIACAADAAgADwAAAAEADQAAAA0ACgAFAAQACQAFAAkACwAGAAUACwAGAAsADAAHAAYADAAHAAwADgAEAAcADgAEAA4ACQA=", "vertices": 16, "indices": 54}, {"data": "QAIdP4jZAEBEsl+9PlWKuklVKrT3/38/AAAAAAAAAABgHRy/iNkAQNz7ZL34VIq6T/85tPf/fz8AAAAAAAAAAGAdHL+6nKk//PtkvRpVirpsaTK09/9/PwAAAAAAAAAAQAIdP7qcqT9gsl+9YVWKumW/IrT3/38/AAAAAAAAAAAAAAEAAgAAAAIAAwA=", "vertices": 4, "indices": 6}, {"data": "AKDmu4jZAEAIsl+9AAAAAAAAAAAAAIA/AAAAAAAAAABQAh0/iNkAQAiyX70AAAAAAAAAAAAAgD8AAAAAAAAAAGAdHL+I2QBACLJfvQAAAAAAAAAAAACAPwAAAAAAAAAAAKDmu7mcqT8Isl+9AAAAAAAAAAAAAIA/AAAAAAAAAABQAh0/uZypPwiyX70AAAAAAAAAAAAAgD8AAAAAAAAAAGAdHL+5nKk/CLJfvQAAAAAAAAAAAACAPwAAAAAAAAAABQADAAAABQAAAAIAAwAEAAEAAwABAAAA", "vertices": 6, "indices": 12}, {"data": MODEL_BIN["tv_soporte_parts"], "vertices": 560, "indices": 1548}];
        function createTVSoporteGroup(piece) {
            const group = new THREE.Group(); group.name = 'TV con soporte';
            const mats = [
                new THREE.MeshStandardMaterial({color:0x222222, roughness:0.55, metalness:0.25, side:THREE.DoubleSide}),
                // La superficie frontal de la pantalla puede coincidir con la cara del marco y producir z-fighting.
                // Pantalla negra metalizada, con brillo moderado y sin competir en profundidad con el marco.
                new THREE.MeshStandardMaterial({color:0x080a0e, roughness:0.22, metalness:0.82, side:THREE.DoubleSide, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}),
                new THREE.MeshStandardMaterial({color:0x111111, roughness:0.35, metalness:0.1, side:THREE.DoubleSide}),
                new THREE.MeshStandardMaterial({color:0x202020, roughness:0.55, metalness:0.2, side:THREE.DoubleSide})
            ];
            ECOWALL_TV_SOPORTE_PARTS.forEach((part,i)=>{
                const geo=sharedGeometry('tv:'+i, ()=>createGeometryFromEmbeddedModel(part.data,part.vertices,part.indices));
                const mesh=new THREE.Mesh(geo,mats[i] || mats[0]);
                mesh.name='TV soporte parte '+i;
                mesh.position.set(piece.x,0,piece.y); mesh.rotation.y=-THREE.MathUtils.degToRad(piece.rotation);
                // Evita parpadeos por sombras propias en las superficies finas y en la pantalla.
                mesh.castShadow = (i !== 1);
                mesh.receiveShadow = false;
                // Mantiene la pantalla ligeramente por delante del marco para evitar z-fighting.
                if (i === 1) { mesh.renderOrder = 2; }
                group.add(mesh);
            });
            return group;
        }

        // Modelo MESA Y SILLAS embebido desde el GLB. La geometría se centra en X/Z conservando su altura desde el suelo.
        const ECOWALL_MESA_SILLAS_PART = { data: MODEL_BIN["mesa_sillas_part"], vertices: 4167, indices: 15450 };
const ECOWALL_PORTACATALOGOS_PARTS = [
            { data: MODEL_BIN["portacatalogos_parts"], vertices: 12055, indices: 71688, rgba: [107,104,109,255], roughness: 0.203, metalness: 0.920 },
            { data: MODEL_BIN["portacatalogos_parts_2"], vertices: 6288, indices: 37680, rgba: [67,67,67,127], roughness: 0.500, metalness: 0.000 }
        ];

        function createMesaSillasGroup(piece) {
            const group = new THREE.Group(); group.name = 'Mesa y sillas';
            const cachedGeometry = SHARED_GEOMETRIES.get('mesaSillas');
            const geometry = cachedGeometry || createGeometryFromEmbeddedModel(ECOWALL_MESA_SILLAS_PART.data, ECOWALL_MESA_SILLAS_PART.vertices, ECOWALL_MESA_SILLAS_PART.indices);
            // Suavizado real de normales: el GLB contiene vértices duplicados en las uniones,
            // así que computeVertexNormals() por sí solo deja facetas y bandas visibles.
            // Acumulamos normales de triángulos por posición coincidente sin mover la malla.
            const smoothNormalsByPosition = (geo) => {
                const pos = geo.getAttribute('position');
                if (!pos) return;
                const idx = geo.getIndex();
                const sums = new Map();
                const keyAt = (i) => `${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`;
                const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
                const ab = new THREE.Vector3(), ac = new THREE.Vector3(), face = new THREE.Vector3();
                const count = idx ? idx.count : pos.count;
                for (let k=0; k+2<count; k+=3) {
                    const ia = idx ? idx.getX(k) : k;
                    const ib = idx ? idx.getX(k+1) : k+1;
                    const ic = idx ? idx.getX(k+2) : k+2;
                    a.fromBufferAttribute(pos,ia); b.fromBufferAttribute(pos,ib); c.fromBufferAttribute(pos,ic);
                    ab.subVectors(b,a); ac.subVectors(c,a); face.crossVectors(ab,ac);
                    if (face.lengthSq() < 1e-18) continue;
                    for (const vi of [ia,ib,ic]) {
                        const key = keyAt(vi);
                        let n = sums.get(key);
                        if (!n) { n = new THREE.Vector3(); sums.set(key,n); }
                        n.add(face);
                    }
                }
                const normals = new Float32Array(pos.count*3);
                for (let i=0; i<pos.count; i++) {
                    const n = sums.get(keyAt(i));
                    if (n && n.lengthSq()>1e-18) n.normalize();
                    const j=i*3; normals[j]=n?n.x:0; normals[j+1]=n?n.y:1; normals[j+2]=n?n.z:0;
                }
                geo.setAttribute('normal', new THREE.BufferAttribute(normals,3));
            };
            if (!cachedGeometry) {
                // El suavizado es costoso: se hace una sola vez y la geometría se comparte.
                smoothNormalsByPosition(geometry);
                sharedGeometry('mesaSillas', () => geometry);
            }
            const material = new THREE.MeshStandardMaterial({color:0xe0e0e0, roughness:0.42, metalness:0.02, side:THREE.DoubleSide});
            const mesh = new THREE.Mesh(geometry, material); mesh.name = 'Mesa y sillas GLB';
            mesh.position.set(piece.x, 0, piece.y); mesh.rotation.y = -THREE.MathUtils.degToRad(piece.rotation);
            mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return group;
        }


        function createPortaCatalogosGroup(piece) {
            const group = new THREE.Group();
            group.name = 'Portacatalogos';
            ECOWALL_PORTACATALOGOS_PARTS.forEach((part, index) => {
                const geometry = sharedGeometry('porta:' + index, () => createGeometryFromEmbeddedModel(part.data, part.vertices, part.indices));
                const alpha = (part.rgba[3] ?? 255) / 255;
                const material = new THREE.MeshStandardMaterial({
                    color: (part.rgba[0] << 16) | (part.rgba[1] << 8) | part.rgba[2],
                    roughness: part.roughness,
                    metalness: part.metalness,
                    transparent: alpha < 0.999,
                    opacity: alpha,
                    depthWrite: alpha >= 0.999,
                    side: THREE.DoubleSide
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.name = 'Portacatalogos parte ' + index;
                // El GLB se ha convertido respecto al origen del objeto; este punto queda en el centro de colocación.
                mesh.position.set(piece.x, 0, piece.y);
                mesh.rotation.y = -THREE.MathUtils.degToRad(piece.rotation);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                group.add(mesh);
            });
            return group;
        }

        function createFocoPalaGroup(piece) {
            const group = new THREE.Group();
            group.name = 'Foco pala';
            const materials = [
                new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.5, metalness: 0.66, side: THREE.DoubleSide }),
                new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1.8, side: THREE.DoubleSide })
            ];
            ECOWALL_FOCO_PALA_PARTS.forEach((part, index) => {
                const geometry = sharedGeometry('foco:' + index, () => createGeometryFromEmbeddedModel(part.data, part.vertices, part.indices));
                const mesh = new THREE.Mesh(geometry, materials[part.material]);
                mesh.name = index === 0 ? 'Cuerpo foco pala' : 'Bombilla foco pala';
                mesh.position.set(piece.x, 0, piece.y);
                mesh.rotation.y = -THREE.MathUtils.degToRad(piece.rotation);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                // No se añade contorno ni se incluye en el raycaster: no es seleccionable en 3D.
                group.add(mesh);
            });
            return group;
        }

        function createMesaAltaGroup(piece) {
            const group = new THREE.Group();
            group.name = 'Mesa alta';
            group.position.set(piece.x, 0, piece.y);
            group.rotation.y = -THREE.MathUtils.degToRad(piece.rotation);
            // El GLB ya contiene escalas internas en metros. No aplicar otra escala
            // externa, porque haría que el modelo quedase prácticamente invisible.
            // Se compensa únicamente la traslación global de exportación del GLB para
            // colocar su origen visual en el punto de inserción, sin recentrar sus mallas.
            // El GLB (6 MB) se procesa una sola vez; cada mesa es un clon que comparte geometría y material.
            loadMesaAltaTemplate().then(template => {
                if (template) group.add(template.clone());
            });
            return group;
        }

        let mesaAltaTemplatePromise = null;
        function loadMesaAltaTemplate() {
            if (mesaAltaTemplatePromise) return mesaAltaTemplatePromise;
            mesaAltaTemplatePromise = new Promise(resolve => {
                const loader = new THREE.GLTFLoader();
                const glbBytes = toBytes(ECOWALL_MESA_ALTA_GLB);
                const buffer = glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength);
                loader.parse(buffer, '', gltf => {
                    const model = gltf.scene;
                    model.position.x -= 12.821928977966309;
                    model.position.z -= 0.20510773360729218;
                    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
                    material.userData.keep = true;
                    model.traverse(obj => {
                        if (obj.isMesh) {
                            obj.material = material;
                            obj.geometry.userData.keep = true;
                            obj.castShadow = true;
                            obj.receiveShadow = true;
                        }
                    });
                    resolve(model);
                }, error => { console.error('No se pudo cargar el modelo MESA ALTA-2 tab.:', error); resolve(null); });
            });
            return mesaAltaTemplatePromise;
        }

        function renderPieceMesh(p) {
            const object = createPieceObject(p);
            scene.add(object);
            pieceMeshes.set(p.id, object);
        }

        // Crea la malla o grupo 3D de una pieza (sin añadirlo a la escena). También lo usan los
        // bloques de planta del plano 2D, que se generan a partir de estos mismos modelos.
        function createPieceObject(p) {
            if (p.type === 'mesaAlta') {
                const mesaAltaGroup = createMesaAltaGroup(p);
                return mesaAltaGroup;
            }
            const spec = PIECE_SPECS[p.type];
            if (p.type === 'mesaSillas') {
                return createMesaSillasGroup(p);
            }
            if (p.type === 'tvSoporte') {
                return createTVSoporteGroup(p);
            }
            if (p.type === 'focoPala') {
                // Es un elemento auxiliar: no participa en la selección/collider 3D,
                // no tiene acabado impreso y se coloca usando el centro horizontal del GLB.
                const focusGroup = createFocoPalaGroup(p);
                return focusGroup;
            }
            if (p.type === 'portaCatalogos') {
                // Extra decorativo: sin colisionador ni selección 3D y sin acabado imprimible.
                const catalogGroup = createPortaCatalogosGroup(p);
                return catalogGroup;
            }
            let geo;
            if (p.type === 'muro') {
                geo = getEcowallMuroGeometry();
            } else if (p.type === 'muro1c') {
                geo = getEcowallMuro1CGeometry();
            } else if (p.type === 'esquina') {
                geo = getEcowallReplacementGeometry('esquina');
            } else if (p.type === 'esquina45') {
                geo = createEsquina45Geometry();
            } else if (p.type === 'pico') {
                geo = getEcowallReplacementGeometry('pico');
            } else if (p.type === 'picodoble') {
                geo = getEcowallPicoDobleGeometry();
            } else if (p.type === 'mostrador') {
                geo = getEcowallMostradorGeometry();
            } else if (p.type === 'mostrador1m') {
                geo = getEcowallMostrador1mGeometry();
            } else {
                geo = sharedGeometry('box:' + p.type, () => {
                    const g = new THREE.BoxGeometry(spec.width, spec.height, spec.depth);
                    computeUniformBoxUVs(g, spec.width, spec.height, spec.depth);
                    return g;
                });
            }
            // Las geometrías de los modelos están cacheadas: no se liberan al reconstruir.
            geo.userData.keep = true;

            let mat;
            const isGlbBasedPiece = ['muro', 'muro1c', 'esquina', 'esquina45', 'pico', 'picodoble', 'mostrador', 'mostrador1m'].includes(p.type);
            if (p.type === 'muro' && p.finish === 'painted' && p.printFaces === 1) {
                const side = p.printSide === -1 ? -1 : 1;
                const source = geo;
                geo = sharedGeometry('muro1face:' + side, () => buildMuroOneFaceGeometry(source, side));
                mat = [getPrintedMaterialForMesh(geo, p.type), new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.72,side:THREE.DoubleSide})];
            } else if (p.type === 'pico' && p.finish === 'painted' && Number(p.printFaces) === 1) {
                // Pico a 1 cara: el frente en punta o la trasera, según el lado seleccionado.
                const side = p.printSide === -1 ? -1 : 1;
                const source = geo;
                geo = sharedGeometry('pico1face:' + side, () => buildPicoOneFaceGeometry(source, side));
                mat = [getPrintedMaterialForMesh(geo, p.type), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, side: THREE.FrontSide })];
            } else if ((p.type === 'mostrador' || p.type === 'mostrador1m') && p.finish === 'painted') {
                // Mostrador impreso: solo el frente, en el lado en que se seleccionó.
                const side = p.printSide === -1 ? -1 : 1;
                const source = geo;
                geo = sharedGeometry(p.type + '1face:' + side, () => buildMuroOneFaceGeometry(source, side, dominantFaceZ(source, side), true));
                mat = [getPrintedMaterialForMesh(geo, p.type), new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.72,side:THREE.DoubleSide}), new THREE.MeshBasicMaterial({ visible: false })];
            } else if (p.finish === 'painted') {
                mat = getPrintedMaterialForMesh(geo, p.type);
            } else if (isGlbBasedPiece) {
                // Los GLB se muestran en blanco limpio de forma predeterminada; sin
                // mapas de superficie tintados. El acabado impreso se aplica aparte.
                mat = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 0.72,
                    metalness: 0,
                    side: THREE.FrontSide
                });
            } else {
                mat = new THREE.MeshStandardMaterial({ color: WALL_COLORS['unpainted'], roughness: 0.3, metalness: 0.2 });
            }

            // El mostrador contiene superficies abiertas y caras con orientación mixta
            // en el GLB. DoubleSide evita transparencias desde el exterior tanto en
            // acabado blanco como impreso, sin modificar su huella ni su colocación.
            if (p.type === 'mostrador' || p.type === 'mostrador1m') {
                const ensureDoubleSide = material => {
                    if (material && material.isMaterial) {
                        material.side = THREE.DoubleSide;
                        material.needsUpdate = true;
                    }
                };
                if (Array.isArray(mat)) mat.forEach(ensureDoubleSide);
                else ensureDoubleSide(mat);
            }

            const mesh = new THREE.Mesh(geo, mat);
            // Ajustar las mallas originales al ancho de la huella 2D (1 m y 0,5 m).
            if (p.type === 'mostrador') mesh.scale.x = 1;
            if (p.type === 'mostrador1m') mesh.scale.x = 0.5;
            if (p.type === 'muro1c') {
                // El GLB ya lleva su pivote/origen y su altura desde Y=0: no recentrar.
                mesh.position.set(p.x, 0, p.y);
            } else {
                mesh.position.set(p.x, spec.height / 2, p.y);
            }
            
            // La escena Three.js usa Y como eje vertical de giro (equivalente
            // al eje vertical Z del modelo de origen). Ajuste solo visual 3D.
            let baseRotationOffset = p.type === 'esquina' ? 270 : 0;
            mesh.rotation.y = -THREE.MathUtils.degToRad(p.rotation + baseRotationOffset);
            
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { id: p.id, isCap: false };

            {
                // Contorno negro más fino y discreto: solo aristas con un cambio
                // angular significativo, evitando dibujar todas las triangulaciones.
                const edgesMat = new THREE.LineBasicMaterial({ color: 0x101010, linewidth: 1, transparent: true, opacity: 0.48 });
                mesh.add(new THREE.LineSegments(edgesFor(geo), edgesMat));
            }
            return mesh;
        }

        function renderAutoLateralCapMesh(cap) {
            const spec = PIECE_SPECS['lateral'];
            // Se recupera la tapa original del configurador base; no se utiliza el GLB PARED FINAL.
            const geo = sharedGeometry('box:lateral', () => {
                const g = new THREE.BoxGeometry(spec.width, spec.height, spec.depth);
                computeUniformBoxUVs(g, spec.width, spec.height, spec.depth);
                return g;
            });

            let mat = cap.finish === 'painted' ? getPrintedMaterialForMesh(geo, 'lateral') : new THREE.MeshStandardMaterial({ color: WALL_COLORS['unpainted'], roughness: 0.4, metalness: 0.3 });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(cap.x3d, spec.height / 2, cap.z3d);
            mesh.rotation.y = -THREE.MathUtils.degToRad(cap.rotation);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { id: cap.id, isCap: true };

            scene.add(mesh);
            autoLateralMeshes.set(cap.id, mesh);

            // Se conserva el contorno global más fino aplicado al resto de módulos.
            const edgesMat = new THREE.LineBasicMaterial({ color: 0x101010, linewidth: 1, transparent: true, opacity: 0.48 });
            mesh.add(new THREE.LineSegments(edgesFor(geo), edgesMat));
        }

        function rebuildAllPieceMeshes() {
            pieceMeshes.forEach(mesh => { scene.remove(mesh); disposeObject3D(mesh); });
            pieceMeshes.clear();
            autoLateralMeshes.forEach(mesh => { scene.remove(mesh); disposeObject3D(mesh); });
            autoLateralMeshes.clear();
            clearOutlines();

            pieces.forEach(p => renderPieceMesh(p));
            computeAutomaticLateralCaps().forEach(cap => renderAutoLateralCapMesh(cap));
        }

        function isPieceSelected2D(id) {
            return multiSelectEnabled ? selectedPieceIds.has(id) : id === selectedPieceId;
        }

        function updateMultiSelectUI() {
            document.getElementById('selection-2d-title').textContent = (multiSelectEnabled && selectedPieceIds.size > 1) ? 'Multiselección' : (selectedPieceId !== null ? 'Selección de pieza' : 'Selección');
            document.getElementById('selection-2d-hint').textContent = multiSelectEnabled
                ? 'Arrastra cualquier pieza seleccionada para mover el conjunto.'
                : 'Arrastra en una zona vacía para seleccionar por caja. Clica fuera de la selección para deseleccionar.';
            document.getElementById('group-selection-controls').classList.toggle('hidden', !multiSelectEnabled || selectedPieceIds.size < 2);
            document.getElementById('group-transform-actions').classList.toggle('hidden', !multiSelectEnabled || selectedPieceIds.size < 2);
            const count = selectedPieceIds.size;
            // Los controles de multiselección se muestran en el mismo inspector que la pieza individual.
            document.getElementById('selection-2d-hud').classList.add('hidden');
            const multiInspectorCount = document.getElementById('inspector-multi-count');
            if (multiInspectorCount) multiInspectorCount.textContent = `${count} ${count === 1 ? 'pieza seleccionada' : 'piezas seleccionadas'}`;
            document.getElementById('group-selection-count').textContent = `${count} ${count === 1 ? 'pieza seleccionada' : 'piezas seleccionadas'}`;
            document.getElementById('clear-group-selection').disabled = count === 0;
        }

        function setMultiSelectEnabled(enabled) {
            if (currentMode !== '2d') return;
            isDragging2D = false;
            dragPieceId = null;
            if (enabled) {
                if (selectedPieceId !== null) selectedPieceIds.add(selectedPieceId);
                selectedPieceId = null;
            } else {
                const lastSelectedId = Array.from(selectedPieceIds).pop();
                selectedPieceId = pieces.some(p => p.id === lastSelectedId) ? lastSelectedId : null;
                selectedPieceIds.clear();
            }
            multiSelectEnabled = enabled;
            refresh2DSelection();
        }

        function clearGroupSelection() {
            selectedPieceIds.clear();
            isDragging2D = false;
            dragPieceId = null;
            refresh2DSelection();
        }

        function refresh2DSelection() {
            pieceMeshes.forEach((mesh, pid) => {
                const piece = pieces.find(x => x.id === pid);
                if (piece && piece.type !== 'focoPala' && piece.type !== 'tvSoporte' && piece.type !== 'mesaSillas' && piece.type !== 'mesaAlta' && mesh.material && !Array.isArray(mesh.material)) {
                    if (currentMode === '2d' && isPieceSelected2D(pid)) mesh.material.color.setHex(0xf59e0b);
                    else mesh.material.color.setHex(piece.finish === 'painted' ? 0xffffff : WALL_COLORS['unpainted']);
                }
            });

            const p = !multiSelectEnabled && currentMode === '2d' ? pieces.find(x => x.id === selectedPieceId) : null;
            const hasMultiSelection = currentMode === '2d' && multiSelectEnabled && selectedPieceIds.size > 1;
            const panel = document.getElementById('inspector-panel');
            const singleControls = document.getElementById('inspector-single-controls');
            const multiControls = document.getElementById('inspector-multi-controls');
            const inspectorTitle = document.getElementById('inspector-title');
            if (!panel || !singleControls || !multiControls || !inspectorTitle) {
                console.error('No se ha encontrado un elemento del inspector ECOWALL.');
                return;
            }
            if (p) {
                // Conserva el nodo original del identificador y evita reconstruir el HTML
                // del título cada vez que cambia la selección.
                inspectorTitle.innerHTML = '<i class="fa-solid fa-sliders text-indigo-400"></i> INSPECTOR DE PIEZA #<span id="insp-id">' + p.id + '</span>';
                singleControls.classList.remove('hidden');
                multiControls.classList.add('hidden');
                panel.classList.remove('hidden');
            } else if (hasMultiSelection) {
                inspectorTitle.innerHTML = '<i class="fa-solid fa-sliders text-indigo-400"></i> INSPECTOR DE MULTISELECCIÓN';
                singleControls.classList.add('hidden');
                multiControls.classList.remove('hidden');
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
                singleControls.classList.remove('hidden');
                multiControls.classList.add('hidden');
            }
            updateMultiSelectUI();
            updatePiecesListUI();
            drawBlueprint2D();
        }

        function selectPiece(id) {
            if (currentMode !== '2d') return;
            if (multiSelectEnabled) {
                if (selectedPieceIds.has(id)) selectedPieceIds.delete(id);
                else if (pieces.some(p => p.id === id)) selectedPieceIds.add(id);
            } else {
                selectedPieceId = id;
            }
            refresh2DSelection();
        }

        function closeInspector() {
            selectedPieceId = null;
            selectedPieceIds.clear();
            isDragging2D = false;
            dragPieceId = null;
            document.getElementById('inspector-panel').classList.add('hidden');
            rebuildAllPieceMeshes();
            updateMultiSelectUI();
            updatePiecesListUI();
            drawBlueprint2D();
        }

        function centerBlueprintView() {
            blueprintZoom = 1;
            blueprintPanX = 0;
            blueprintPanY = 0;
            drawBlueprint2D();
        }

        function rotateSelectionGroup(degrees) {
            if (currentMode !== '2d' || !multiSelectEnabled) return;
            const group = pieces.filter(p => selectedPieceIds.has(p.id));
            if (!group.length) return;
            saveState();
            // Rotación rígida alrededor del centro del conjunto, conservando las distancias.
            const cx = (Math.min(...group.map(p => p.x)) + Math.max(...group.map(p => p.x))) / 2;
            const cy = (Math.min(...group.map(p => p.y)) + Math.max(...group.map(p => p.y))) / 2;
            const angle = degrees * Math.PI / 180;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            for (const p of group) {
                const dx = p.x - cx, dy = p.y - cy;
                p.x = cx + dx * cos - dy * sin;
                p.y = cy + dx * sin + dy * cos;
                p.rotation = ((p.rotation || 0) + degrees) % 360;
            }
            // Trasladar el bloque entero para mantenerlo dentro del espacio si es posible.
            const bounds = group.map(p => ({p, box: getRotatedBoundingBox(p)}));
            const minX = Math.min(...bounds.map(v => v.p.x - v.box.w / 2));
            const maxX = Math.max(...bounds.map(v => v.p.x + v.box.w / 2));
            const minY = Math.min(...bounds.map(v => v.p.y - v.box.h / 2));
            const maxY = Math.max(...bounds.map(v => v.p.y + v.box.h / 2));
            const shiftX = minX < 0 ? -minX : maxX > project.widthMeters ? project.widthMeters - maxX : 0;
            const shiftY = minY < 0 ? -minY : maxY > project.depthMeters ? project.depthMeters - maxY : 0;
            group.forEach(p => { p.x += shiftX; p.y += shiftY; });
            rebuildAllPieceMeshes();
            refresh2DSelection();
        }

        function deleteSelectionGroup() {
            if (currentMode !== '2d' || !multiSelectEnabled || !selectedPieceIds.size) return;
            const ids = new Set(selectedPieceIds);
            saveState();
            pieces = pieces.filter(p => !ids.has(p.id));
            selectedPieceIds.clear();
            selectedPieceId = null;
            rebuildAllPieceMeshes();
            refresh2DSelection();
        }

        // Copia de una pieza con todas sus características (acabado, impresión a 1 o 2 caras, lado impreso…)
        // y el acabado de sus tapas, para que la copia se vea y salga en el listado, el informe de gráficas y
        // Illustrator igual que la original. La copia nunca sale bloqueada.
        function duplicatePieceData(p, x, y) {
            const copy = JSON.parse(JSON.stringify(p));
            copy.id = nextPieceId++;
            copy.x = x;
            copy.y = y;
            delete copy.locked;
            [0, 1].forEach(end => {
                const finish = autoLateralFinishes.get(`auto_cap_${p.id}_${end}`);
                if (finish) autoLateralFinishes.set(`auto_cap_${copy.id}_${end}`, finish);
            });
            return copy;
        }

        function duplicateSelectionGroup() {
            if (currentMode !== '2d' || !multiSelectEnabled) return;
            const originals = pieces.filter(p => selectedPieceIds.has(p.id));
            if (!originals.length) return;
            saveState();
            const duplicates = originals.map(p => duplicatePieceData(p, Number((p.x + 0.3).toFixed(3)), Number((p.y + 0.3).toFixed(3))));
            // Desplazamiento idéntico para conservar la geometría relativa del grupo.
            const dx = Math.min(0, ...duplicates.map(p => project.widthMeters - (p.x + getPlacementBox(p).w / 2)));
            const dy = Math.min(0, ...duplicates.map(p => project.depthMeters - (p.y + getPlacementBox(p).h / 2)));
            duplicates.forEach(p => { p.x += dx; p.y += dy; });
            pieces.push(...duplicates);
            selectedPieceId = null;
            selectedPieceIds = new Set(duplicates.map(p => p.id));
            rebuildAllPieceMeshes();
            refresh2DSelection();
        }

        function rotateSelectedPiece45() {
            if (selectedPieceId === null || currentMode !== '2d') return;
            const p = pieces.find(x => x.id === selectedPieceId);
            if (p) {
                saveState();
                p.rotation = (p.rotation + 45) % 360;
                clampPieceToBounds(p);
                rebuildAllPieceMeshes();
                drawBlueprint2D();
            }
        }

        function rotateSelectedPiece90() {
            if (selectedPieceId === null || currentMode !== '2d') return;
            const p = pieces.find(x => x.id === selectedPieceId);
            if (p) {
                saveState();
                p.rotation = (p.rotation + 90) % 360;
                clampPieceToBounds(p);
                rebuildAllPieceMeshes();
                drawBlueprint2D();
            }
        }

        function deleteSelectedPiece() {
            if (selectedPieceId === null) return;
            saveState();
            pieces = pieces.filter(x => x.id !== selectedPieceId);
            closeInspector();
            rebuildAllPieceMeshes();
            updatePiecesListUI();
            drawBlueprint2D();
        }

        function duplicateSelectedPiece() {
            if (selectedPieceId === null || currentMode !== '2d') return;
            const p = pieces.find(x => x.id === selectedPieceId);
            if (!p) return;
            saveState();
            const newP = duplicatePieceData(p, Number((p.x + 0.3).toFixed(2)), Number((p.y + 0.3).toFixed(2)));
            clampPieceToBounds(newP);
            pieces.push(newP);
            rebuildAllPieceMeshes();
            updatePiecesListUI();
            selectPiece(newP.id);
            drawBlueprint2D();
        }

        function clearAllPieces() {
            if (pieces.length > 0) {
                saveState();
            }
            pieces = [];
            autoLateralFinishes.clear();
            closeInspector();
            select3dPiece(null);
            select3dCap(null);
            rebuildAllPieceMeshes();
            updatePiecesListUI();
            drawBlueprint2D();
        }

        function updatePiecesListUI() {
            document.getElementById('piece-counter').textContent = pieces.length;
            const container = document.getElementById('scene-pieces-list');
            container.innerHTML = '';

            if (pieces.length === 0) {
                container.innerHTML = `<p class="text-xs text-slate-500 text-center py-4">No hay elementos en la escena.</p>`;
                return;
            }

            pieces.forEach(p => {
                const spec = PIECE_SPECS[p.type];
                const isSelected = isPieceSelected2D(p.id);
                const div = document.createElement('div');
                div.className = `p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition ${isSelected ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-800/50'}`;
                div.onclick = () => {
                    selectPiece(p.id);
                    if (window.innerWidth < 768) toggleMobileSidebar();
                };
                div.innerHTML = `
                    <div class="flex items-center space-x-2.5 truncate">
                        <span class="text-xs font-mono text-indigo-400">#${p.id}</span>
                        <div class="truncate">
                            <h5 class="text-xs font-medium truncate">${spec.name}</h5>
                            <span class="text-[10px] text-slate-400">X: ${Number(p.x.toFixed(2))}m, Z: ${Number(p.y.toFixed(2))}m (${p.rotation}º)</span>
                        </div>
                    </div>
                    <button onclick="event.stopPropagation(); deletePieceById(${p.id})" class="text-slate-500 hover:text-rose-400 p-1 text-xs"><i class="fa-solid fa-trash"></i></button>
                `;
                container.appendChild(div);
            });
        }

        function deletePieceById(id) {
            saveState();
            pieces = pieces.filter(x => x.id !== id);
            selectedPieceIds.delete(id);
            updateMultiSelectUI();
            if (selectedPieceId === id) closeInspector();
            rebuildAllPieceMeshes();
            updatePiecesListUI();
            drawBlueprint2D();
        }

        function switchTab(tabName) {
            ['catalog', 'pieces'].forEach(t => {
                document.getElementById(`tab-${t}`).className = t === tabName 
                    ? 'flex-1 py-3 text-xs font-semibold text-indigo-400 border-b-2 border-indigo-500 transition flex items-center justify-center gap-1.5'
                    : 'flex-1 py-3 text-xs font-semibold text-slate-400 border-b-2 border-transparent hover:text-slate-200 transition flex items-center justify-center gap-1.5';
                document.getElementById(`panel-${t}`).classList.toggle('hidden', t !== tabName);
            });
        }

        function setFloorColor(hexString) {
            project.floorColorHex = hexString;
            project.floorColor = parseInt(hexString.replace('#', ''), 16);
            updateRoomGeometry();
            const buttons = document.querySelectorAll('#floor-colors button');
            buttons.forEach(b => {
                b.classList.remove('border-indigo-500', 'border-2');
                b.classList.add('border-transparent');
            });
            if (event && event.currentTarget) {
                event.currentTarget.classList.remove('border-transparent');
                event.currentTarget.classList.add('border-indigo-500', 'border-2');
            }
        }

        function promptMuroPrintFaces(piece, onSelect) {
            let modal = document.getElementById('muro-print-dialog');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'muro-print-dialog';
                modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4';
                modal.innerHTML = `<div class="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
                  <h3 data-title class="text-lg font-bold text-white">Impresión PARED UNIVERSAL</h3>
                  <p class="mt-2 text-sm text-slate-300">¿Quieres imprimir una cara o dos?</p>
                  <div class="grid grid-cols-2 gap-3 mt-4">
                    <button type="button" data-faces="1" class="rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white p-4 font-bold">1 cara<br><small>Exterior seleccionado</small></button>
                    <button type="button" data-faces="2" class="rounded-xl bg-slate-700 hover:bg-slate-600 text-white p-4 font-bold">2 caras<br><small>Impresión completa</small></button>
                  </div><button type="button" data-cancel class="mt-3 w-full rounded-lg bg-slate-800 p-2 text-slate-300">Cancelar</button></div>`;
                document.body.appendChild(modal);
            }
            modal.querySelector('[data-title]').textContent = 'Impresión ' + PIECE_SPECS[piece.type].name;
            modal.classList.remove('hidden');
            modal.querySelectorAll('[data-faces]').forEach(btn => btn.onclick = () => {
                modal.classList.add('hidden'); onSelect(Number(btn.dataset.faces));
            });
            modal.querySelector('[data-cancel]').onclick = () => modal.classList.add('hidden');
        }

        function setWallFinish(finishType) {
            const chosenId = currentMode === '3d' ? selected3dPieceId : selectedPieceId;
            const chosen = pieces.find(p => p.id === chosenId);
            if (finishType === 'painted' && chosen && (chosen.type === 'muro' || chosen.type === 'pico')) {
                promptMuroPrintFaces(chosen, faces => {
                    saveState();
                    chosen.finish = 'painted';
                    chosen.printFaces = faces;
                    rebuildAllPieceMeshes();
                    if (currentMode === '3d') select3dPiece(chosen.id);
                    else selectPiece(chosen.id);
                    updateFinishButtonsUI('painted');
                });
                return;
            }
            saveState();
            if (currentMode === '3d') {
                if (selected3dPieceId !== null) {
                    let piece = pieces.find(p => p.id === selected3dPieceId);
                    if (piece) {
                        piece.finish = finishType;
                        rebuildAllPieceMeshes();
                        select3dPiece(selected3dPieceId);
                    }
                } else if (selected3dCapId !== null) {
                    autoLateralFinishes.set(selected3dCapId, finishType);
                    rebuildAllPieceMeshes();
                    select3dCap(selected3dCapId);
                } else {
                    setFinishForAll(finishType);
                }
            } else {
                setFinishForAll(finishType);
            }
        }

        // Sin nada seleccionado, el acabado se aplica a todo: piezas y también tapas (elegido expresamente).
        function setFinishForAll(finishType) {
            project.wallFinish = finishType;
            pieces.forEach(p => { if (p.type !== 'focoPala' && p.type !== 'tvSoporte' && p.type !== 'mesaSillas' && p.type !== 'portaCatalogos' && p.type !== 'mesaAlta') p.finish = finishType; });
            autoLateralFinishes.clear();
            if (finishType === 'painted') computeAutomaticLateralCaps().forEach(cap => autoLateralFinishes.set(cap.id, 'painted'));
            rebuildAllPieceMeshes();
            updateFinishButtonsUI(finishType);
        }

        // ---- presupuesto ----
        // Un único cálculo para la ventana «Listado» y para el informe impreso (antes estaba duplicado).
        // Solo se muestra el precio estimado total; los importes por línea se calculan para el total.
        // El % de beneficio se reparte en los precios unitarios, así la suma de las líneas coincide con el total.
        const EXTRA_TYPES = ['focoPala', 'tvSoporte', 'mesaSillas', 'mesaAlta', 'portaCatalogos'];
        const euroFormat = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
        const formatEuro = n => euroFormat.format(Number.isFinite(n) ? n : 0);
        const formatNumber = (n, decimals = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
        const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

        function finishLabel(group) {
            if (EXTRA_TYPES.includes(group.type)) return '';
            if (group.finish !== 'painted') return 'Blanco';
            if (group.type === 'muro' || group.type === 'pico') return `Impreso ${Number(group.printFaces) === 1 ? '1 cara' : '2 caras'}`;
            return 'Impreso';
        }

        function computeBudget() {
            const factor = 1 + PRICING.totals(0).profitPct / 100;
            const areaM2 = project.widthMeters * project.depthMeters;
            const lines = [{
                kind: 'floor',
                name: 'MOQUETA FERIAL',
                finish: FLOOR_COLOR_NAMES[project.floorColorHex] || 'Personalizado',
                colorHex: project.floorColorHex,
                dims: `${Math.round(project.widthMeters * 1000)} x ${Math.round(project.depthMeters * 1000)} mm`,
                qtyText: `${formatNumber(areaM2)} m²`,
                unit: PRICING.floorPerM2 * factor,
                subtotal: areaM2 * PRICING.floorPerM2 * factor
            }];
            let base = areaM2 * PRICING.floorPerM2;

            const groups = {};
            [...pieces, ...computeAutomaticLateralCaps()].forEach(item => {
                const finish = item.finish || 'unpainted';
                const faces = (item.type === 'muro' || item.type === 'pico') && finish === 'painted' ? (Number(item.printFaces) === 1 ? 1 : 2) : undefined;
                const key = `${item.type}_${finish}${faces ? `_faces${faces}` : ''}`;
                if (!groups[key]) groups[key] = { type: item.type, finish, printFaces: faces, count: 0 };
                groups[key].count++;
            });
            Object.values(groups).forEach(group => {
                const spec = PIECE_SPECS[group.type];
                const unitCost = getPieceUnitPrice(group);
                base += unitCost * group.count;
                lines.push({
                    kind: 'piece',
                    name: spec.name,
                    finish: finishLabel(group),
                    dims: spec.dimsMm,
                    qtyText: String(group.count),
                    unit: unitCost * factor,
                    subtotal: unitCost * group.count * factor
                });
            });
            return { lines, groups: Object.values(groups), totals: PRICING.totals(base) };
        }

        // Espera a que una imagen termine de cargar (o falle), como mucho 5 s.
        function waitForImage(img) {
            if (img.complete && img.naturalWidth) return Promise.resolve();
            return new Promise(resolve => {
                const done = () => { clearTimeout(timer); img.removeEventListener('load', done); img.removeEventListener('error', done); resolve(); };
                const timer = setTimeout(done, 5000);
                img.addEventListener('load', done);
                img.addEventListener('error', done);
            });
        }

        // Render 3D del informe: cámara propia en vista 3/4 desde el frente del stand que encuadra todo,
        // a resolución fija y con fondo claro. side = 1 mira desde la derecha y -1 desde la izquierda
        // (el informe lleva las dos). Funciona aunque no se haya abierto nunca la vista 3D.
        async function renderReport3DImage(width = 1600, height = 1000, side = 1) {
            if (pieces.some(p => p.type === 'mesaAlta')) await loadMesaAltaTemplate();
            const offscreen = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
            offscreen.setPixelRatio(1);
            offscreen.setSize(width, height, false);
            offscreen.shadowMap.enabled = true;

            scene.updateMatrixWorld(true);
            const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(project.widthMeters, 0, project.depthMeters));
            pieceMeshes.forEach(mesh => box.expandByObject(mesh));
            autoLateralMeshes.forEach(mesh => box.expandByObject(mesh));
            const center = box.getCenter(new THREE.Vector3());
            const radius = box.getBoundingSphere(new THREE.Sphere()).radius;

            const cam = new THREE.PerspectiveCamera(35, width / height, 0.1, 1000);
            const viewDir = new THREE.Vector3(0.62 * side, 0.55, 1).normalize();
            const corners = [];
            for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
            // Acercar la cámara hasta que el stand ocupe el encuadre (con un margen del 8 %).
            const fits = distance => {
                cam.position.copy(center).addScaledVector(viewDir, distance);
                cam.lookAt(center);
                cam.updateMatrixWorld(true);
                return corners.every(c => { const p = c.clone().project(cam); return Math.abs(p.x) <= 0.92 && Math.abs(p.y) <= 0.92 && p.z < 1; });
            };
            let near = 0.1, far = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.5;
            for (let i = 0; i < 30; i++) { const mid = (near + far) / 2; if (fits(mid)) far = mid; else near = mid; }
            fits(far);

            const previousBackground = scene.background;
            const hidden = [];
            outlineMeshes.forEach(mesh => { if (mesh.visible) { mesh.visible = false; hidden.push(mesh); } });
            scene.background = new THREE.Color(0xf1f5f9);
            try {
                offscreen.render(scene, cam);
                return offscreen.domElement.toDataURL('image/png');
            } finally {
                scene.background = previousBackground;
                hidden.forEach(mesh => { mesh.visible = true; });
                offscreen.dispose();
                if (offscreen.forceContextLoss) offscreen.forceContextLoss();
            }
        }

        function fillBudgetTable(tbody, budget, variant) {
            tbody.innerHTML = '';
            budget.lines.forEach(line => {
                const tr = document.createElement('tr');
                const swatch = line.kind === 'floor'
                    ? `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;border:1px solid #94a3b8;background:${escapeHtml(line.colorHex)};margin-right:6px;vertical-align:-1px"></span>` : '';
                const cells = [
                    escapeHtml(line.name), swatch + escapeHtml(line.finish), escapeHtml(line.dims),
                    escapeHtml(line.qtyText)
                ];
                if (variant === 'print') {
                    if (line.kind === 'floor') tr.style.background = '#eef2ff';
                    const align = ['left', 'left', 'left', 'center'];
                    tr.innerHTML = cells.map((c, i) => `<td style="padding:7px 8px;border:1px solid #cbd5e1;text-align:${align[i]};${i === 2 ? 'font-family:monospace;' : ''}${line.kind === 'floor' && i === 0 ? 'font-weight:bold;' : ''}">${c}</td>`).join('');
                } else {
                    tr.className = 'hover:bg-slate-800/40 transition' + (line.kind === 'floor' ? ' bg-indigo-950/20' : '');
                    const cls = [
                        'px-3 md:px-4 py-3 font-medium text-white', 'px-3 md:px-4 py-3 text-indigo-300 font-semibold whitespace-nowrap',
                        'px-3 md:px-4 py-3 font-mono text-slate-400', 'px-3 md:px-4 py-3 text-center font-semibold text-white whitespace-nowrap'
                    ];
                    tr.innerHTML = cells.map((c, i) => `<td class="${cls[i]}">${c}</td>`).join('');
                }
                tbody.appendChild(tr);
            });
        }

        function setupUIEvents() {
            window.openInventoryModal = function() {
                const modalHeaderTitle = document.getElementById('modal-project-title-header');
                if (modalHeaderTitle) {
                    modalHeaderTitle.textContent = `${project.name} (${project.widthMeters}m × ${project.depthMeters}m)`;
                }
                const budget = computeBudget();
                fillBudgetTable(document.getElementById('inventory-table-body'), budget, 'screen');
                document.getElementById('estimated-total-price').textContent = formatEuro(budget.totals.total);
                PRICING.renderZeroNote(document.getElementById('estimated-price-note'), budget.groups, { internal: true });
                document.getElementById('modal-inventory').classList.remove('hidden');
            };

            document.getElementById('modal-close').addEventListener('click', () => {
                document.getElementById('modal-inventory').classList.add('hidden');
            });

            document.getElementById('modal-print').addEventListener('click', async () => {
                const printButton = document.getElementById('modal-print');
                const originalLabel = printButton.innerHTML;
                printButton.disabled = true;
                printButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparando…';
                try {
                    const budget = computeBudget();
                    document.getElementById('report-title').textContent = project.name;
                    document.getElementById('report-subtitle').textContent = `Espacio: ${project.widthMeters}m × ${project.depthMeters}m (Altura de paredes: 2.4m)`;
                    document.getElementById('report-date').textContent = new Date().toLocaleDateString('es-ES');

                    const img2d = document.getElementById('report-img-2d');
                    const img3d = document.getElementById('report-img-3d');
                    const img3dB = document.getElementById('report-img-3d-b');
                    // La planta ocupa todo el ancho útil del A3 (273 mm), sin pasar de 330 mm de alto.
                    const probePlan = createDimensionedReportPlan();
                    const fillWidthMm = Math.min(273, 330 * probePlan.sheetWm / probePlan.sheetHm);
                    const plan = createDimensionedReportPlan({ fillWidthMm });
                    img2d.src = plan.dataUrl;
                    img2d.style.width = fillWidthMm.toFixed(1) + 'mm';
                    document.getElementById('report-plan-scale').textContent = `Escala 1:${plan.scaleDenominator} impreso en A3 al 100 %`;
                    document.getElementById('report-legend').innerHTML = buildPlanLegendHtml();
                    // Dos vistas 3D desde el frente, con ángulos opuestos (izquierda y derecha).
                    img3d.src = await renderReport3DImage(1600, 1000, -1);
                    img3dB.src = await renderReport3DImage(1600, 1000, 1);

                    fillBudgetTable(document.getElementById('report-table-body'), budget, 'print');
                    document.getElementById('report-estimated-total').textContent = formatEuro(budget.totals.total);
                    PRICING.renderZeroNote(document.getElementById('report-price-note'), budget.groups);

                    // Esperar a que las imágenes hayan cargado para que no salgan en blanco al imprimir.
                    // (img.decode() puede quedarse esperando con el informe oculto: se usa el evento load, máx. 5 s.)
                    await Promise.all([img2d, img3d, img3dB].map(waitForImage));
                    document.getElementById('modal-inventory').classList.add('hidden');
                    window.ecowallPrint();
                } catch (error) {
                    console.error('Error preparando el informe:', error);
                    showProjectToast('No se pudo preparar el informe: ' + (error && error.message ? error.message : error), 'error');
                } finally {
                    printButton.disabled = false;
                    printButton.innerHTML = originalLabel;
                }
            });
        }

        async function exportConfiguredSceneOBJ() {
            const btn = document.getElementById('btn-download-obj');
            const originalHtml = btn ? btn.innerHTML : '';
            try {
                if (!window.THREE || !THREE.OBJExporter) {
                    throw new Error('No se ha podido cargar el exportador OBJ. Comprueba la conexión a Internet y vuelve a intentarlo.');
                }
                if (!scene || !pieceMeshes || !autoLateralMeshes) {
                    throw new Error('La escena 3D todavía no está preparada. Abre el proyecto y vuelve a intentarlo.');
                }
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
                    btn.title = 'Preparando módulos 3D…';
                }

                // Crear un único grupo exportable con los módulos realmente colocados.
                // Se incluyen los módulos colocados y el suelo como objetos separados; se excluyen cámaras, luces, guías, selección y contornos.
                const exportGroup = new THREE.Group();
                exportGroup.name = ((project && project.name) ? project.name : 'ECOWALL') + '_Modulos';
                let meshCount = 0;
                const makeNormalsOutward = (geometry) => {
                    // Trabajar sobre una copia para no alterar la escena original.
                    let g = geometry.clone();
                    if (!g.attributes.position) return g;
                    // Evaluar la orientación de cada triángulo respecto al centro de su geometría.
                    // Si su normal apunta claramente hacia el centro, invertir el winding.
                    g.computeBoundingBox();
                    const center = g.boundingBox ? g.boundingBox.getCenter(new THREE.Vector3()) : new THREE.Vector3();
                    const pos = g.attributes.position;
                    const idx = g.index;
                    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
                    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), triCenter = new THREE.Vector3();
                    if (idx) {
                        const arr = idx.array;
                        for (let i = 0; i + 2 < arr.length; i += 3) {
                            const ia = arr[i], ib = arr[i + 1], ic = arr[i + 2];
                            a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
                            ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
                            triCenter.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(center);
                            if (n.dot(triCenter) < -1e-8) { arr[i + 1] = ic; arr[i + 2] = ib; }
                        }
                        idx.needsUpdate = true;
                    } else {
                        // En geometría sin índices, intercambiar todos los atributos del segundo y tercer vértice.
                        for (let i = 0; i + 2 < pos.count; i += 3) {
                            a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
                            ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
                            triCenter.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(center);
                            if (n.dot(triCenter) < -1e-8) {
                                for (const key of Object.keys(g.attributes)) {
                                    const attr = g.attributes[key];
                                    for (let k = 0; k < attr.itemSize; k++) {
                                        const temp = attr.array[(i + 1) * attr.itemSize + k];
                                        attr.array[(i + 1) * attr.itemSize + k] = attr.array[(i + 2) * attr.itemSize + k];
                                        attr.array[(i + 2) * attr.itemSize + k] = temp;
                                    }
                                    attr.needsUpdate = true;
                                }
                            }
                        }
                    }
                    // Recalcular normales suaves a partir de la orientación de las caras.
                    if (g.attributes.normal) g.deleteAttribute('normal');
                    g.computeVertexNormals();
                    return g;
                };
                const addModule = (sourceMesh, moduleName) => {
                    if (!sourceMesh || !sourceMesh.isMesh || !sourceMesh.geometry) return;
                    const cleanGeometry = makeNormalsOutward(sourceMesh.geometry);
                    const mesh = new THREE.Mesh(cleanGeometry, sourceMesh.material);
                    mesh.name = String(moduleName || 'Modulo').replace(/[^a-z0-9_-]+/gi, '_');
                    // Posición en el mundo: incluye modelos anidados (p. ej. la MESA ALTA, que antes no se exportaba).
                    sourceMesh.updateWorldMatrix(true, false);
                    sourceMesh.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
                    mesh.visible = sourceMesh.visible;
                    mesh.updateMatrix();
                    exportGroup.add(mesh);
                    meshCount++;
                };
                pieceMeshes.forEach((mesh, id) => {
                    if (mesh && mesh.isGroup) { let index = 0; mesh.traverse(child => { if (child.isMesh) addModule(child, 'Modulo_' + id + '_' + (++index)); }); }
                    else addModule(mesh, 'Modulo_' + id);
                });
                autoLateralMeshes.forEach((mesh, id) => addModule(mesh, 'Tapa_lateral_' + id));
                // Crear un plano limpio con las dimensiones actuales del proyecto, no reutilizar la geometría visual del suelo.
                if (project && Number.isFinite(project.widthMeters) && Number.isFinite(project.depthMeters) && project.widthMeters > 0 && project.depthMeters > 0) {
                    const floorGeometry = new THREE.PlaneGeometry(project.widthMeters, project.depthMeters, 1, 1);
                    floorGeometry.rotateX(-Math.PI / 2);
                    const floorMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
                    const exportFloor = new THREE.Mesh(floorGeometry, floorMaterial);
                    exportFloor.name = 'Suelo';
                    exportFloor.position.set(project.widthMeters / 2, 0, project.depthMeters / 2);
                    exportFloor.updateMatrix();
                    exportGroup.add(exportFloor);
                    meshCount++;
                }
                if (!meshCount) throw new Error('No hay módulos 3D colocados para exportar.');
                exportGroup.updateMatrixWorld(true);

                const exporter = new THREE.OBJExporter();
                const result = exporter.parse(exportGroup);
                if (typeof result !== 'string' || !result.includes('v ') || !result.includes('f ')) {
                    throw new Error('El exportador no ha generado una geometría OBJ válida.');
                }
                const safeName = String((project && project.name) ? project.name : 'ECOWALL')
                    .trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'ECOWALL';
                if (window.__TAURI__ && window.__TAURI__.core) {
                    // App de escritorio: abre el explorador del sistema para elegir dónde guardar.
                    // (Se recortan decimales sobrantes: el archivo pesa bastante menos y no se pierde precisión útil.)
                    const compact = result.replace(/(\d+\.\d{6})\d+/g, '$1');
                    const savedPath = await window.__TAURI__.core.invoke('save_export_file', { defaultName: safeName + '.obj', content: compact });
                    if (savedPath && typeof window.showProjectToast === 'function') window.showProjectToast('Modelo 3D guardado en ' + savedPath, 'success');
                } else {
                    const blob = new Blob([result], { type: 'application/octet-stream' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = safeName + '.obj';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 30000);
                }
            } catch (err) {
                console.error('Error exportando módulos 3D a OBJ:', err);
                const exportMsg = 'No se ha podido exportar los módulos 3D a OBJ. Detalle: ' + (err && err.message ? err.message : err);
                if (typeof window.showProjectToast === 'function') window.showProjectToast(exportMsg, 'error'); else alert(exportMsg);
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalHtml || '<i class="fa-solid fa-download" aria-hidden="true"></i>';
                    btn.title = 'Descargar módulos 3D en OBJ';
                }
            }
        }

        function animate() {
            requestAnimationFrame(animate);
            if (currentMode === '3d') {
                if (controls) controls.update();
                if (renderer && scene && camera) renderer.render(scene, camera);
            }
        }
    