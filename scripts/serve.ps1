# Servidor local para probar la app en el navegador (sin Node, sin Rust).
# Uso:  powershell -ExecutionPolicy Bypass -File scripts/serve.ps1   ->  http://127.0.0.1:5173
# Sirve la carpeta src/ y, en /data/, la carpeta data/ (precios.xlsx), igual que la compilación web.
param([int]$Port = 5173)

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$src = Join-Path $root 'src'
$data = Join-Path $root 'data'
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.woff2' = 'font/woff2'; '.glb' = 'model/gltf-binary'; '.bin' = 'application/octet-stream'
  '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "ECOWALL en http://127.0.0.1:$Port  (Ctrl+C para parar)"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path -eq '/') { $path = '/index.html' }
    $base = $src
    if ($path.StartsWith('/data/')) { $base = $data; $path = $path.Substring(5) }
    $file = [IO.Path]::GetFullPath((Join-Path $base $path.TrimStart('/')))
    $res = $ctx.Response
    if ($file.StartsWith($base) -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
    $res.Close()
  }
} finally { $listener.Stop() }
