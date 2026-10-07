$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Admin\.zcode\workspace\default\vn-stock-demo'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://127.0.0.1:8437/')
$listener.Start()
$types = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.png'='image/png'; '.ico'='image/x-icon'; '.svg'='image/svg+xml' }
while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
        $path = $ctx.Request.Url.AbsolutePath
        if ($path -eq '/') { $path = '/index.html' }
        $file = Join-Path $root ($path -replace '/', '\')
        if (Test-Path $file -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($file).ToLower()
            $mime = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $ctx.Response.ContentType = $mime
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
        }
    } catch { $ctx.Response.StatusCode = 500 }
    $ctx.Response.Close()
}
