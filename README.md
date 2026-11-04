# ECOWALL Configurador – app de escritorio (Windows + Mac)

Versión de escritorio del configurador HTML, hecha con **Tauri 2**.

## Carpeta de proyectos y precios

* **Al abrir la app por primera vez** pide seleccionar una carpeta (normalmente en el servidor).
  En esa carpeta se guardan los proyectos (`NOMBRE.ecowall`) y **debe estar el archivo `precios.xlsx`**.
* La carpeta **se recuerda** en cada equipo. No se vuelve a pedir salvo que no se encuentre
  (servidor desconectado, carpeta movida) o que falte `precios.xlsx` dentro: entonces aparece un aviso con
  «Reintentar» y «Elegir otra carpeta».
* La app **no crea carpetas** por su cuenta.
* En la **primera pantalla** (la de «Iniciar espacio de trabajo»), arriba a la derecha, el botón de **carpeta** muestra
  la carpeta actual (y si está conectada), las **carpetas usadas recientemente** en ese equipo (un clic para volver,
  p. ej., a la del servidor al recuperar la conexión) y «Elegir otra carpeta…». Solo aparece en esa pantalla.
* Los proyectos guardados en la carpeta aparecen en **todos los equipos** que usen la misma carpeta.
* Si al guardar el servidor no responde, el proyecto queda guardado solo en ese equipo y la app lo avisa.

### precios.xlsx
* Se lee de la carpeta de proyectos al arrancar y **cada vez que se abre el «Listado»**, así que un cambio de
  precios se aplica sin reiniciar y sin recompilar. La app no puede abrir ni modificar el Excel.
* La plantilla está en `data/precios.xlsx` de este repositorio: cópiala a la carpeta del servidor.
* Edita solo las celdas **amarillas** (columna «Precio (€)»). Un precio vacío o a 0 = **0 €**.
* Al final del Excel: **Moqueta ferial (€/m²)** y **BENEFICIO**. Escribe `15` para sumar un 15 %:
  `Total = (moqueta + piezas) × (1 + % / 100)`
* **Modelo 3D:** el icono de descarga de la vista 3D (abajo a la derecha) genera un archivo **OBJ** y abre el
  explorador del sistema para elegir dónde guardarlo.
* Los objetos extras (foco pala, TV, mesas, portacatálogos) no llevan acabado: un único precio.
* La hoja está protegida **sin contraseña** (Revisar → Desproteger hoja).
* Si no se puede leer el Excel, el Listado lo indica (solo en pantalla, no en el informe) y usa unos precios de respaldo.
* Las piezas sin precio (vacío o 0) aparecen en el Listado y en el informe como
  «Elementos «…» no contemplados en el precio actual».
* El Listado y el informe muestran las piezas y cantidades y **solo el precio estimado total** (sin precios unitarios).
* Numeración del plano: solo paneles de construcción y tapas, empezando por el extremo más a la izquierda (la tapa
  inicial, si la hay, es la 1) y siguiendo el montaje; se renumera sola al mover o borrar piezas.

### Proyectos
* **Guardar**: en la carpeta de proyectos. La escritura es segura (archivo temporal + renombrado) y la versión
  anterior queda como `NOMBRE.ecowall.bak`. Si ya existe un proyecto con ese nombre, la app pregunta:
  **Sobrescribir** o **Nueva versión** (`NOMBRE v-1`, `v-2`…).
* **Cargar proyecto guardado** abre la lista de proyectos con buscador. Desde ahí también se **importa** un `.ecowall`.
  La papelera de cada proyecto lo **quita de la lista** sin borrar su archivo; en «Mostrar ocultos» se puede
  **Restaurar** o **Eliminar** definitivamente (en la app de escritorio, también su archivo de la carpeta).
* El botón de exportar (junto a «Guardar proyecto») genera un archivo `.ecowall` para enviarlo o archivarlo.

### Plano 2D (motor en `src/js/plan2d.js`)
* Cada pieza se dibuja con una **vista cenital de su propio modelo 3D** (se genera una vez y se guarda en memoria),
  así el plano y el 3D siempre coinciden. Las caras impresas se marcan con una banda morada (a una cara, solo en
  ese lado) y las tapas impresas, en morado.
* Barra superior del plano: **Etiquetas** (nº de pieza o ninguna) y **exportar plano** en **DXF** (mm, capas
  ESPACIO / PIEZAS / TAPAS / IMPRESO / TEXTO / COTAS) o **PDF** A3: página 1, planta con leyenda y cajetín ocupando
  la hoja; página 2, alzado frontal acotado (ancho, tramos, altura 2.400 y mostrador).
* Al arrastrar: **cotas en vivo** a las paredes del espacio y **guías de alineación** con otras piezas (±4 cm).
* Inspector: nº de la pieza y **bloquear** (una pieza bloqueada no se arrastra). Flechas del teclado: mover 1 cm (Mayús: 10 cm).
* **Informe de gráficas** (botón en la vista 3D, `src/js/graficas.js`): PDF A3 para diseño con el alzado desplegado de
  las caras impresas de cada tramo. Cara 1 (A1, A2…) y cara 2 (A2″, A3″…); una pieza blanca corta el alzado. Cada tapa
  impresa va al principio o al final del alzado de la cara donde está impresa su pared. Las tapas son blancas salvo que
  se marquen como impresas seleccionándolas en 3D (imprimir la pared no imprime sus tapas).
  Medidas de gráfica: tapa 50 + 300 + 50, pared y panel 1C 500, pico 500 (frente en punta) o 350 (trasera), pico doble
  500 por lado, esquina 90º 500 doblado (250 + 250, siempre la cara exterior) y esquina 45º 500 (solo la diagonal).
  El pico, como la pared universal, se imprime a 1 cara (la que se pulsa en 3D) o a 2 caras. Lleva el ancho de cada pieza, la cota
  total de cada alzado, la altura y una planta de situación con las caras marcadas. Los mostradores impresos, en una
  hoja aparte (solo el frente: se imprime el lado en que se pulsa el mostrador en 3D).
* **Plantilla Illustrator** (botón bajo «Informe de gráficas»): descarga una secuencia de comandos `.jsx`; en Illustrator,
  *Archivo › Secuencias de comandos › Otra secuencia de comandos* crea el documento y lo guarda como **.ai** junto al
  `.jsx`: en milímetros, CMYK (el **sangrado** se añade a mano en *Ajustar documento*: 15 mm a izquierda y derecha), una
  mesa de trabajo por panel **a tamaño real** con su nombre (`A1_500x2400H mm`) y, dentro de cada alzado, pegadas unas a
  otras para que la gráfica sea continua. Capa **AAFF** (arte final) y capa **referencias** debajo (no imprimible: corte,
  pliegues y nombres; tipografía Arial). Si Illustrator no admite un lienzo tan grande (más de 5.779 mm), los alzados
  largos continúan en la fila siguiente y se reparten en varios .ai, siempre a tamaño real.
* Informe (A3): planta ocupando el ancho de la hoja con cajetín, nº de pieza, leyenda y cotas por tramo (con tapas),
  y **dos vistas 3D** desde el frente con ángulos opuestos (izquierda y derecha).

## Versión web
La versión web sale de **la misma carpeta `src/`** que la app de escritorio (ya no hace falta mantener un HTML aparte).
* No se compila en GitHub (las releases solo llevan los instaladores).
* En local: `npm run build:web` → carpeta `dist-web/` (su contenido se sube tal cual a un servidor web o se incrusta
  con `<iframe>`).
* App en **un solo archivo HTML** (copia de seguridad): `powershell -ExecutionPolicy Bypass -File scripts/build-single-html.ps1 -Out ECOWALL_APP.html`.
* En la web los proyectos se guardan en el navegador; para no perderlos, usar Exportar / Importar `.ecowall`.
  Los precios se leen de `data/precios.xlsx` junto a la página.

## Compilar con GitHub
1. Sube los cambios al repositorio.
2. **Actions → «Compilar ECOWALL (Windows + Mac)» → Run workflow**.
3. En **`https://github.com/USUARIO/REPOSITORIO/releases`** aparece el borrador `v<versión>` solo con los instaladores:
   * **Windows:** `.exe`.
   * **Mac:** `ECOWALL-Configurador_<versión>_mac-universal.dmg`, **universal**: vale para Mac con chip Apple
     (M1/M2/M3…) e Intel.
   Revisa el borrador y pulsa **Publish release** cuando estén los dos.
4. Cada versión nueva: sube el número `version` en `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` y `package.json`.
   Con el mismo número, volver a compilar actualiza los archivos del **borrador**; si esa versión ya está **publicada**,
   la compilación se para y avisa (las releases publicadas no se tocan). La compilación solo se lanza a mano.

### Avisos del sistema al instalar (sin firma de pago)
* **Windows**: SmartScreen → «Más información» → «Ejecutar de todas formas».
* **Mac**: la primera vez, clic derecho sobre la app → «Abrir». Requiere macOS 13 o superior.
  Al elegir una carpeta de red, macOS puede pedir permiso de acceso a volúmenes de red: acéptalo.

## Si falla la compilación de Mac
* La app de Mac se pide a la vez a una máquina **Intel** (`macos-15-intel`) y a una de **chip Apple** (`macos-latest`),
  porque GitHub a veces no tiene Mac libres («The job was not acquired by Runner…»). **Basta con que una termine bien**:
  si la otra sale cancelada sin pasos, la ejecución se marca en rojo pero el `.dmg` ya está en la release.
  Si salen canceladas las dos, en la ejecución pulsa **Re-run failed jobs** más tarde.
* Si falla un paso, entra en **Actions → la ejecución → `mac` → el paso con la cruz roja** y copia las últimas ~30
  líneas del registro: el nombre del paso indica la fase («1) Compilar la app», «2) .dmg» o «3) Subir»).

## Probar en local (opcional)
**Solo la interfaz, sin instalar nada (Windows):** `powershell -ExecutionPolicy Bypass -File scripts/serve.ps1`
y abrir http://127.0.0.1:5173. Sin CSS compilado se usa el compilador de Tailwind en el navegador (más lento).

**App completa:** Node 20+ y Rust (https://tauri.app/start/prerequisites/):
```
npm install
npm run vendor     # descarga GLTFLoader / OBJExporter
npm run icons      # genera los iconos desde app-icon.png
npm run dev
```
