// Descarga las dos librerías de three.js que la app antes cargaba desde internet,
// para que funcione sin conexión. Se ejecuta solo (GitHub Actions) o con: npm run vendor
import { mkdir, writeFile } from 'node:fs/promises';
const BASE = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/';
const FILES = { 'GLTFLoader.js': 'loaders/GLTFLoader.js', 'OBJExporter.js': 'exporters/OBJExporter.js' };
await mkdir('src/vendor', { recursive: true });
for (const [name, rel] of Object.entries(FILES)) {
  const r = await fetch(BASE + rel);
  if (!r.ok) throw new Error(`No se pudo descargar ${rel}: HTTP ${r.status}`);
  const txt = await r.text();
  if (txt.length < 1000) throw new Error(`${name} descargado parece incompleto`);
  await writeFile(`src/vendor/${name}`, txt);
  console.log(`✔ src/vendor/${name} (${txt.length} bytes)`);
}
