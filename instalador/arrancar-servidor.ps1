param([string]$Carpeta = "C:\FactPOS", [string]$Node = "", [int]$Puerto = 3000)
# Arranca el servidor de FactPOS y lo vuelve a levantar si se cae. Todo queda en logs\arranque.log
$ErrorActionPreference = "Continue"
Set-Location $Carpeta
New-Item -ItemType Directory -Force -Path "$Carpeta\logs" | Out-Null
function Anotar($t) { Add-Content -Path "$Carpeta\logs\arranque.log" -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $t) -Encoding UTF8 }
Anotar "Arranque iniciado (usuario $env:USERNAME)"
if (-not $Node -or -not (Test-Path $Node)) {
  $c = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($c) { $Node = $c.Source }
  else { $Node = @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$Carpeta\node\node.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1 }
}
if (-not $Node) { Anotar "ERROR: no se encontró node.exe"; exit 1 }
Anotar "Node: $Node"
while ($true) {
  # Si ya hay un servidor escuchando el puerto 3000 no se levanta otro
  $ya = Get-NetTCPConnection -State Listen -LocalPort $Puerto -ErrorAction SilentlyContinue
  if ($ya) { Start-Sleep -Seconds 30; continue }
  Anotar "Iniciando el servidor"
  $p = Start-Process -FilePath $Node -ArgumentList "apps\servidor\dist\index.js" -WorkingDirectory $Carpeta -NoNewWindow -PassThru `
        -RedirectStandardOutput "$Carpeta\logs\servidor.out.log" -RedirectStandardError "$Carpeta\logs\servidor.err.log"
  $p.WaitForExit()
  Anotar "El servidor se detuvo (código $($p.ExitCode)); se reintenta en 5 s"
  foreach ($f in "servidor.out.log", "servidor.err.log") {
    $a = "$Carpeta\logs\$f"
    if (Test-Path $a) { Get-Content $a -Tail 200 | Add-Content "$Carpeta\logs\servidor.log"; Remove-Item $a -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Seconds 5
}
