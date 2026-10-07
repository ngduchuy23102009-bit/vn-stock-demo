$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Admin\.zcode\workspace\default\vn-stock-demo'
$html = Get-Content "$root\index.html" -Raw -Encoding UTF8
$css  = Get-Content "$root\style.css" -Raw -Encoding UTF8
$js   = Get-Content "$root\app.js" -Raw -Encoding UTF8
$html = $html.Replace('<link rel="stylesheet" href="style.css">', "<style>`n$css</style>")
$html = $html.Replace('<script src="app.js"></script>', "<script>`n$js</script>")
Set-Content -Path "$root\vn-stock-demo.html" -Value $html -Encoding UTF8
Write-Output ("OK " + (Get-Item "$root\vn-stock-demo.html").Length + " bytes")
