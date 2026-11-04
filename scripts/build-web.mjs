// Versión web del configurador, generada desde la MISMA carpeta src/ que la app de escritorio.
// Resultado: dist-web/ (subir tal cual a un servidor web o incrustar con <iframe>).
// Uso: npm run build:web   (descarga librerías, compila el CSS y copia los archivos)
import { cp, rm, mkdir, access } from 'node:fs/promises';

const OUT = 'dist-web';
await rm(OUT, { recursive: true, force: true });
await cp('src', OUT, { recursive: true, filter: src => !src.endsWith('tailwind.src.css') });
// En la web los precios se leen de data/precios.xlsx junto a la página.
await mkdir(`${OUT}/data`, { recursive: true });
await cp('data/precios.xlsx', `${OUT}/data/precios.xlsx`);
for (const required of ['css/tailwind.css', 'vendor/GLTFLoader.js', 'vendor/OBJExporter.js']) {
  try { await access(`${OUT}/${required}`); }
  catch { throw new Error(`Falta ${required}: ejecuta antes «npm run vendor» y «npm run css».`); }
}
console.log(`✔ Versión web generada en ${OUT}/`);
