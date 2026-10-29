# Dispatch TV: arma el paquete desde tu copia del juego y lo deja listo para copiarlo al televisor. En PowerShell:
#   irm https://raw.githubusercontent.com/Chebestia/dispatch-tv-port/main/instalar.ps1 | iex
# Qué hace:
#   1. Busca Dispatch en las bibliotecas de Steam y te pide la clave AES de los paks (una sola vez).
#   2. Baja lo necesario a %LOCALAPPDATA%\DispatchTV: este repositorio, sus herramientas (pakx, meshx), la app,
#      Node.js (si no lo tenés), ffmpeg y vgmstream. Nada del juego: todo sale de tu instalación.
#   3. Arma el paquete (1–2 horas la primera vez; si se corta, volvé a correrlo y sigue donde quedó).
#   4. Abre el servidor: desde el televisor bajás la app y la app se copia el juego por WiFi.
# Hace falta ~11 GB libres mientras trabaja; al final quedan ~4 GB. Otra carpeta: $env:DISPATCHTV_CARPETA = 'D:\algo'.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repo = 'Chebestia/dispatch-tv-port'
$Base = if ($env:DISPATCHTV_CARPETA) { $env:DISPATCHTV_CARPETA } else { Join-Path $env:LOCALAPPDATA 'DispatchTV' }
$Bin = Join-Path $Base 'herramientas'
New-Item -ItemType Directory -Force $Base, $Bin | Out-Null

function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Bajar($url, $dst) {
  Write-Host "   bajando $url"
  Invoke-WebRequest -UseBasicParsing $url -OutFile "$dst.part"
  Move-Item -Force "$dst.part" $dst
}
function Descomprimir($zip, $dst) {
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  Expand-Archive $zip $dst -Force
  Remove-Item $zip
}

# --- el juego ---
Paso 'Buscando Dispatch'
$juego = $env:DISPATCHTV_JUEGO
if (-not $juego) {
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  $libs = @()
  if ($steam) {
    $libs += $steam
    $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) { $libs += [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"') | ForEach-Object { $_.Groups[1].Value -replace '\\\\', '\' } }
  }
  foreach ($l in $libs) {
    $c = Join-Path $l 'steamapps\common\Dispatch'
    if (Test-Path (Join-Path $c 'Dispatch\Content\Paks')) { $juego = $c; break }
  }
}
while (-not $juego -or -not (Test-Path (Join-Path $juego 'Dispatch\Content\Paks'))) {
  $juego = (Read-Host 'No encontré Dispatch. Pegá la carpeta del juego (la que contiene Dispatch\Content\Paks)').Trim('"', ' ')
}
Write-Host "   $juego"

$claveTxt = Join-Path $Base 'clave.txt'
$clave = if (Test-Path $claveTxt) { (Get-Content $claveTxt -Raw).Trim() } else { '' }
while ($clave -notmatch '^(0x)?[0-9A-Fa-f]{64}$') {
  $clave = (Read-Host 'Clave AES de los paks de Dispatch (64 caracteres hexadecimales, con o sin 0x)').Trim()
}
Set-Content -Encoding ascii $claveTxt $clave

# ~11 GB entre lo extraído y el paquete; lo que ya ocupa una corrida anterior cuenta
$libre = (Get-PSDrive ((Resolve-Path $Base).Drive.Name)).Free / 1GB
$usado = (Get-ChildItem (Join-Path $Base 'trabajo') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1GB
if ($libre + $usado -lt 11) { Write-Host ("Hay {0:N1} GB libres en esa unidad y hacen falta ~{1:N0}. Liberá espacio o usá otra carpeta con `$env:DISPATCHTV_CARPETA." -f $libre, (11 - $usado)) -ForegroundColor Red; return }

# --- código y herramientas ---
Paso 'Bajando Dispatch TV y sus herramientas'
Bajar "https://github.com/$Repo/archive/refs/heads/main.zip" (Join-Path $Base 'codigo.zip')
Descomprimir (Join-Path $Base 'codigo.zip') (Join-Path $Base 'codigo-zip')
$codigo = Join-Path $Base 'codigo'
if (Test-Path $codigo) { Remove-Item $codigo -Recurse -Force }
Move-Item (Get-ChildItem (Join-Path $Base 'codigo-zip') -Directory | Select-Object -First 1).FullName $codigo
Remove-Item (Join-Path $Base 'codigo-zip') -Recurse -Force
Bajar "https://github.com/$Repo/releases/latest/download/herramientas.zip" (Join-Path $Base 'herramientas.zip')
Descomprimir (Join-Path $Base 'herramientas.zip') (Join-Path $Bin 'dispatch')
Bajar "https://github.com/$Repo/releases/latest/download/DispatchTV.apk" (Join-Path $Base 'DispatchTV.apk')

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($node -and [int]((& $node --version) -replace '^v(\d+).*', '$1') -lt 18) { $node = $null }
if (-not $node) {
  $node = Get-ChildItem (Join-Path $Bin 'node') -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
  if (-not $node) {
    $v = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1).version
    Bajar "https://nodejs.org/dist/$v/node-$v-win-x64.zip" (Join-Path $Bin 'node.zip')
    Descomprimir (Join-Path $Bin 'node.zip') (Join-Path $Bin 'node')
    $node = Get-ChildItem (Join-Path $Bin 'node') -Recurse -Filter node.exe | Select-Object -First 1 -ExpandProperty FullName
  }
}
$ffmpeg = Get-ChildItem (Join-Path $Bin 'ffmpeg') -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $ffmpeg) {
  Bajar 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' (Join-Path $Bin 'ffmpeg.zip')
  Descomprimir (Join-Path $Bin 'ffmpeg.zip') (Join-Path $Bin 'ffmpeg')
  $ffmpeg = Get-ChildItem (Join-Path $Bin 'ffmpeg') -Recurse -Filter ffmpeg.exe | Select-Object -First 1 -ExpandProperty FullName
}
$vgm = Join-Path $Bin 'vgmstream\vgmstream-cli.exe'
if (-not (Test-Path $vgm)) {
  Bajar 'https://github.com/vgmstream/vgmstream/releases/latest/download/vgmstream-win64.zip' (Join-Path $Bin 'vgmstream.zip')
  Descomprimir (Join-Path $Bin 'vgmstream.zip') (Join-Path $Bin 'vgmstream')
}

# --- paquete ---
Paso 'Armando el paquete desde tu copia del juego (la primera vez tarda 1–2 horas)'
$env:DTV_PAKX = Join-Path $Bin 'dispatch\pakx.exe'
$env:DTV_MESHX = Join-Path $Bin 'dispatch\meshx.exe'
$env:DTV_FFMPEG = $ffmpeg
$env:DTV_VGM = $vgm
$trabajo = Join-Path $Base 'trabajo'
& $node (Join-Path $codigo 'tools\build.js') $juego $clave $trabajo
if ($LASTEXITCODE) { Write-Host 'El armado no terminó. Volvé a correr el comando: sigue donde quedó.' -ForegroundColor Red; return }

# --- servidor para el televisor ---
Paso 'Listo. Ahora, en el televisor:'
Write-Host @'
   1. Instalá la app "Downloader" (de AFTVnews) desde Google Play y abrila.
   2. Escribí la dirección "App para el televisor" que aparece abajo e instalá Dispatch TV
      (la primera vez el televisor pide permitir instalar apps desde Downloader).
   3. Abrí Dispatch TV, escribí la "Dirección para la app" y elegí "Copiar el juego".
   Si Windows pregunta por el firewall, permití el acceso en redes privadas.
   Cuando el televisor termine de copiar, cerrá esta ventana.
'@
& $node (Join-Path $codigo 'tools\servidor.js') (Join-Path $trabajo 'web') (Join-Path $Base 'DispatchTV.apk')
