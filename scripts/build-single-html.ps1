# Versión web en UN SOLO archivo HTML (copia de seguridad / envío): scripts, modelos 3D, fuentes, iconos y
# precios.xlsx van incrustados; fetch() y la carga de scripts de bootstrap.js se redirigen a lo incrustado.
# Uso (sin Node ni Python):
#   powershell -ExecutionPolicy Bypass -File scripts/build-single-html.ps1 -Out ECOWALL_APP.html
# Los scripts que carga bootstrap.js deben estar en la lista de abajo.
param([string]$Repo = '', [Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
$src = Join-Path $Repo 'src'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function ReadText($p) { [IO.File]::ReadAllText((Join-Path $src $p), $utf8) }
function B64($p) { [Convert]::ToBase64String([IO.File]::ReadAllBytes($p)) }
function SafeJs($t) { $t.Replace('</script', '<\/script').Replace('<!--', '<\!--') }
function Must($html, $old) { if (-not $html.Contains($old)) { throw "No encontrado: $old" } }

$html = ReadText 'index.html'

# Tailwind (compilador en el navegador), fuentes, iconos y three.js en línea
$old = '<link rel="stylesheet" href="css/tailwind.css" onerror="var s=document.createElement(''script'');s.src=''vendor/tailwind.js'';document.head.appendChild(s);">'
Must $html $old
$html = $html.Replace($old, "<script>" + (SafeJs (ReadText 'vendor/tailwind.js')) + "</script>")

$fonts = ReadText 'css/fonts.css'
foreach ($f in Get-ChildItem (Join-Path $src 'fonts') -Filter *.woff2) {
  $fonts = $fonts.Replace("url('../fonts/$($f.Name)')", "url('data:font/woff2;base64," + (B64 $f.FullName) + "')")
}
$old = '<link rel="stylesheet" href="css/fonts.css">'; Must $html $old
$html = $html.Replace($old, "<style>`n$fonts`n</style>")
$old = '<link rel="stylesheet" href="css/fontawesome.css">'; Must $html $old
$html = $html.Replace($old, "<style>`n" + (ReadText 'css/fontawesome.css') + "`n</style>")
foreach ($lib in 'vendor/three.min.js', 'vendor/OrbitControls.js') {
  $old = "<script src=""$lib""></script>"; Must $html $old
  $html = $html.Replace($old, "<script>" + (SafeJs (ReadText $lib)) + "</script>")
}

# Scripts que carga bootstrap.js y archivos binarios (modelos, manifiesto, precios)
$sb = New-Object System.Text.StringBuilder
foreach ($js in 'js/pricing.js', 'js/setup.js', 'js/app.js', 'js/plan2d.js', 'js/graficas.js', 'js/tauri-bridge.js', 'vendor/GLTFLoader.js', 'vendor/OBJExporter.js') {
  [void]$sb.Append("<script type=""text/plain"" data-emb-js=""$js"">" + (SafeJs (ReadText $js)) + "</script>`n")
}
$bins = @(Get-ChildItem (Join-Path $src 'models') | ForEach-Object { @{ p = "models/$($_.Name)"; f = $_.FullName } })
$bins += @{ p = 'data/precios.xlsx'; f = (Join-Path $Repo 'data/precios.xlsx') }
foreach ($b in $bins) {
  [void]$sb.Append("<script type=""application/octet-stream"" data-emb-bin=""$($b.p)"">" + (B64 $b.f) + "</script>`n")
}
$shim = @'
<script>
// Versión en un solo archivo: los scripts y los archivos van incrustados en esta página.
(function () {
  const rel = u => { try { const x = new URL(u, location.href); return x.href.startsWith(new URL('.', location.href).href) ? x.href.slice(new URL('.', location.href).href.length) : String(u); } catch (e) { return String(u); } };
  window.__ecowallEmbedJs = src => { const el = document.querySelector('script[data-emb-js="' + src + '"]'); return el ? el.textContent : null; };
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const path = rel(typeof input === 'string' ? input : input.url);
    const el = document.querySelector('script[data-emb-bin="' + path + '"]');
    if (!el) return origFetch(input, init);
    const bin = atob(el.textContent.trim()); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return Promise.resolve(new Response(bytes, { status: 200 }));
  };
})();
</script>
'@
$boot = ReadText 'js/bootstrap.js'
$old = 's.src = src; s.onload = resolve;'
if (-not $boot.Contains($old)) { throw 'bootstrap.js: no se encontró loadScript' }
$boot = $boot.Replace($old, 'const emb = window.__ecowallEmbedJs(src); if (emb !== null) { s.textContent = emb; document.head.appendChild(s); resolve(); return; } ' + $old)

$old = '<script src="js/bootstrap.js"></script>'; Must $html $old
$html = $html.Replace($old, $sb.ToString() + $shim + "<script>" + (SafeJs $boot) + "</script>")

[IO.File]::WriteAllText($Out, $html, $utf8)
"OK {0:N1} MB" -f ((Get-Item $Out).Length / 1MB)
