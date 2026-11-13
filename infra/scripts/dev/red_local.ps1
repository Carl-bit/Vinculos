# SOLO DESARROLLO. Sesion de pruebas en la red local: levanta Mailpit + API +
# front para que otros dispositivos de la misma red entren por la IP de este
# equipo (http://<ip>:3000). Usar solo con datos demo: viaja por HTTP sin cifrar.
#
# No edita ningun archivo: todo se pasa como variables de entorno de este
# proceso (las heredan la API y el front y desaparecen al cerrar), asi que al
# terminar no hay nada que restaurar en .env ni en next.config.
#   FRONTEND_URL      links de correos (pago, documentos, cuenta) y CORS -> IP.
#   SMTP_URL          correos a Mailpit (el codigo del segundo paso).
#   DEV_ORIGENES_RED  allowedDevOrigins de next.config (hot reload desde la IP).
#   NEXT_PUBLIC_SITE_URL  URL publica del front -> IP.
# Lo unico que se toca fuera del proceso es el firewall de Windows: abre 3000
# (front) y 8025 (bandeja de Mailpit) solo en perfil Privado y borra las reglas
# al cerrar (pide permiso de administrador una vez al abrir y otra al cerrar).
# La API (3001), Postgres y el SMTP de Mailpit siguen solo en este equipo: el
# front reenvia /api/* a la API (rewrite de next.config).
#
# Uso (desde la raiz del repo, con Postgres en Docker corriendo):
#   npm run dev:red
#   npm run dev:red -- -Ip 192.168.1.100   (si detecta mal la IP)
# Ctrl+C cierra todo y quita las reglas del firewall.
param(
  [string]$Ip
)
$ErrorActionPreference = 'Stop'

$Raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$PuertoFront = 3000
$PuertoBandeja = 8025
$NombreRegla = 'Vinculos dev red local'

# IP de la interfaz con la ruta por defecto de menor metrica (Wi-Fi o cable),
# no las virtuales de WSL/Hyper-V.
if (-not $Ip) {
  $Ruta = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
  if (-not $Ruta) { throw 'Sin ruta por defecto: conectar a la red o pasar -Ip' }
  $Ip = (Get-NetIPAddress -InterfaceIndex $Ruta.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1).IPAddress
}
$Perfil = Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object -First 1
if ($Perfil -and $Perfil.NetworkCategory -ne 'Private') {
  Write-Warning "La red '$($Perfil.Name)' es $($Perfil.NetworkCategory): las reglas solo abren el perfil Privado. Cambiarla a Privada en Configuracion > Red e Internet."
}

$Front = "http://${Ip}:$PuertoFront"
$env:FRONTEND_URL = $Front
$env:NEXT_PUBLIC_SITE_URL = $Front
$env:SMTP_URL = 'smtp://127.0.0.1:1025'
$env:DEV_ORIGENES_RED = $Ip

function Invoke-Admin([string]$Comando) {
  $EsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($EsAdmin) {
    Invoke-Expression $Comando
  } else {
    Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command', $Comando
  }
}

$QuitarRegla = "Get-NetFirewallRule -DisplayName '$NombreRegla' -ErrorAction SilentlyContinue | Remove-NetFirewallRule"

# Mailpit: si ya hay uno en el 1025 (solo escucha en 127.0.0.1) se reutiliza y
# la bandeja queda solo en este equipo; si no, se levanta uno con la bandeja
# visible en la red para que cada tester vea su codigo.
$SmtpOcupado = (Get-NetTCPConnection -LocalPort 1025 -State Listen -ErrorAction SilentlyContinue) -ne $null
$Mailpit = Join-Path $Raiz 'tools\mailpit\mailpit.exe'
if ($SmtpOcupado) {
  $ComandoMailpit = 'node infra/scripts/dev/mailpit.mjs'
  $Bandeja = "http://localhost:$PuertoBandeja (solo este equipo: cerrar el Mailpit abierto y volver a correr para compartirla)"
} elseif (Test-Path $Mailpit) {
  $ComandoMailpit = "tools\mailpit\mailpit.exe --smtp 127.0.0.1:1025 --listen 0.0.0.0:$PuertoBandeja"
  $Bandeja = "http://${Ip}:$PuertoBandeja"
} else {
  throw 'Falta Mailpit. Instalar con: powershell -ExecutionPolicy Bypass -File infra\scripts\dev\instalar_mailpit.ps1'
}

Write-Output "Abriendo los puertos $PuertoFront y $PuertoBandeja en el firewall (perfil Privado)..."
Invoke-Admin "$QuitarRegla; New-NetFirewallRule -DisplayName '$NombreRegla' -Direction Inbound -Protocol TCP -LocalPort $PuertoFront,$PuertoBandeja -Action Allow -Profile Private | Out-Null"

Write-Output ''
Write-Output "  App:     $Front"
Write-Output "  Bandeja: $Bandeja"
Write-Output '  Usuarios demo: docs/pruebas/usuarios_demo.md (contrasena dev-password)'
Write-Output '  Ctrl+C cierra todo y restaura el firewall.'
Write-Output ''

Push-Location $Raiz
try {
  npx concurrently -k -n mailpit,api,front -c yellow,cyan,magenta `
    $ComandoMailpit `
    'npm --prefix backend run start:dev' `
    "npm --prefix frontend run dev -- -H 0.0.0.0 -p $PuertoFront"
} finally {
  Pop-Location
  Write-Output 'Cerrando: quitando las reglas del firewall...'
  Invoke-Admin $QuitarRegla
  Write-Output 'Listo. .env y next.config no se tocaron; npm run dev vuelve a quedar como siempre.'
}
