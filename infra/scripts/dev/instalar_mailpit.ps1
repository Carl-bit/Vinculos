# SOLO DESARROLLO. Instala Mailpit (SMTP falso con bandeja web) en tools\mailpit\
# (ignorado por git). Version fija y SHA-256 verificado contra el digest que
# publica GitHub para el asset del release. Para subir de version: cambiar
# $Version y $Sha256 (gh release view vX.Y.Z -R axllent/mailpit --json assets).
#
# Uso (desde la raiz del repo):
#   powershell -ExecutionPolicy Bypass -File infra\scripts\dev\instalar_mailpit.ps1
# Despues: npm run dev (raiz) lo levanta en smtp://localhost:1025, bandeja en http://localhost:8025.
$ErrorActionPreference = 'Stop'

$Version = 'v1.31.3'
$Sha256 = '863e9502d4e0f14a78c0f91c5091797b1c7b7b7e3fc7e5eab62e5770ce44b76e'
$Url = "https://github.com/axllent/mailpit/releases/download/$Version/mailpit-windows-amd64.zip"

$Raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$Destino = Join-Path $Raiz 'tools\mailpit'
$Exe = Join-Path $Destino 'mailpit.exe'
$Marca = Join-Path $Destino 'VERSION'

if ((Test-Path $Exe) -and (Test-Path $Marca) -and ((Get-Content $Marca -Raw).Trim() -eq $Version)) {
  Write-Output "Mailpit $Version ya instalado en $Destino"
  exit 0
}

$Zip = Join-Path ([System.IO.Path]::GetTempPath()) "mailpit-$Version.zip"
Write-Output "Descargando Mailpit $Version..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

$Hash = (Get-FileHash -Algorithm SHA256 $Zip).Hash.ToLower()
if ($Hash -ne $Sha256) {
  Remove-Item $Zip -Force
  throw "Checksum distinto: esperado $Sha256, obtenido $Hash. No se instala."
}

if (Test-Path $Destino) { Remove-Item $Destino -Recurse -Force }
New-Item -ItemType Directory -Force $Destino | Out-Null
Expand-Archive -Path $Zip -DestinationPath $Destino -Force
Remove-Item $Zip -Force
Set-Content -Path $Marca -Value $Version -Encoding ascii
Write-Output "Mailpit $Version instalado en $Destino (checksum OK)."
