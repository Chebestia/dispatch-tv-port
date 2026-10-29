# Dispatch TV: builds the package from your copy of the game and gets it ready to copy to the TV. In PowerShell:
#   irm https://raw.githubusercontent.com/Chebestia/dispatch-tv-port/main/instalar.ps1 | iex
# What it does:
#   1. Finds Dispatch in your Steam libraries and asks for the paks' AES key (only once).
#   2. Downloads what it needs to %LOCALAPPDATA%\DispatchTV: this repository, its tools (pakx, meshx), the app,
#      Node.js (if missing), ffmpeg and vgmstream. Nothing from the game: everything comes from your installation.
#   3. Builds the package (1-2 hours the first time; if it stops, run it again and it resumes).
#   4. Starts the server: the TV downloads the app from it and the app copies the game over Wi-Fi.
# Needs ~11 GB free while working; ~4 GB remain at the end. Another folder: $env:DISPATCHTV_CARPETA = 'D:\something'.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repo = 'Chebestia/dispatch-tv-port'
$Base = if ($env:DISPATCHTV_CARPETA) { $env:DISPATCHTV_CARPETA } else { Join-Path $env:LOCALAPPDATA 'DispatchTV' }
$Bin = Join-Path $Base 'herramientas'
New-Item -ItemType Directory -Force $Base, $Bin | Out-Null

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Fetch($url, $dst) {
  Write-Host "   downloading $url"
  Invoke-WebRequest -UseBasicParsing $url -OutFile "$dst.part"
  Move-Item -Force "$dst.part" $dst
}
function Unzip($zip, $dst) {
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  Expand-Archive $zip $dst -Force
  Remove-Item $zip
}

# --- the game ---
Step 'Looking for Dispatch'
$game = $env:DISPATCHTV_JUEGO
if (-not $game) {
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  $libs = @()
  if ($steam) {
    $libs += $steam
    $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
    if (Test-Path $vdf) { $libs += [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"') | ForEach-Object { $_.Groups[1].Value -replace '\\\\', '\' } }
  }
  foreach ($l in $libs) {
    $c = Join-Path $l 'steamapps\common\Dispatch'
    if (Test-Path (Join-Path $c 'Dispatch\Content\Paks')) { $game = $c; break }
  }
}
while (-not $game -or -not (Test-Path (Join-Path $game 'Dispatch\Content\Paks'))) {
  $game = (Read-Host 'Dispatch not found. Paste the game folder (the one containing Dispatch\Content\Paks)').Trim('"', ' ')
}
Write-Host "   $game"

$keyTxt = Join-Path $Base 'clave.txt'
$key = if (Test-Path $keyTxt) { (Get-Content $keyTxt -Raw).Trim() } else { '' }
while ($key -notmatch '^(0x)?[0-9A-Fa-f]{64}$') {
  $key = (Read-Host 'AES key of the Dispatch paks (64 hex characters, with or without 0x)').Trim()
}
Set-Content -Encoding ascii $keyTxt $key

# ~11 GB between the extracted files and the package; space already used by a previous run counts
$free = (Get-PSDrive ((Resolve-Path $Base).Drive.Name)).Free / 1GB
$used = (Get-ChildItem (Join-Path $Base 'trabajo') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1GB
if ($free + $used -lt 11) { Write-Host ("There are {0:N1} GB free on that drive and ~{1:N0} GB are needed. Free some space or use another folder with `$env:DISPATCHTV_CARPETA." -f $free, (11 - $used)) -ForegroundColor Red; return }

# --- code and tools ---
Step 'Downloading Dispatch TV and its tools'
Fetch "https://github.com/$Repo/archive/refs/heads/main.zip" (Join-Path $Base 'codigo.zip')
Unzip (Join-Path $Base 'codigo.zip') (Join-Path $Base 'codigo-zip')
$code = Join-Path $Base 'codigo'
if (Test-Path $code) { Remove-Item $code -Recurse -Force }
Move-Item (Get-ChildItem (Join-Path $Base 'codigo-zip') -Directory | Select-Object -First 1).FullName $code
Remove-Item (Join-Path $Base 'codigo-zip') -Recurse -Force
Fetch "https://github.com/$Repo/releases/latest/download/herramientas.zip" (Join-Path $Base 'herramientas.zip')
Unzip (Join-Path $Base 'herramientas.zip') (Join-Path $Bin 'dispatch')
Fetch "https://github.com/$Repo/releases/latest/download/DispatchTV.apk" (Join-Path $Base 'DispatchTV.apk')

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($node -and [int]((& $node --version) -replace '^v(\d+).*', '$1') -lt 18) { $node = $null }
if (-not $node) {
  $node = Get-ChildItem (Join-Path $Bin 'node') -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
  if (-not $node) {
    $v = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1).version
    Fetch "https://nodejs.org/dist/$v/node-$v-win-x64.zip" (Join-Path $Bin 'node.zip')
    Unzip (Join-Path $Bin 'node.zip') (Join-Path $Bin 'node')
    $node = Get-ChildItem (Join-Path $Bin 'node') -Recurse -Filter node.exe | Select-Object -First 1 -ExpandProperty FullName
  }
}
$ffmpeg = Get-ChildItem (Join-Path $Bin 'ffmpeg') -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $ffmpeg) {
  Fetch 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' (Join-Path $Bin 'ffmpeg.zip')
  Unzip (Join-Path $Bin 'ffmpeg.zip') (Join-Path $Bin 'ffmpeg')
  $ffmpeg = Get-ChildItem (Join-Path $Bin 'ffmpeg') -Recurse -Filter ffmpeg.exe | Select-Object -First 1 -ExpandProperty FullName
}
$vgm = Join-Path $Bin 'vgmstream\vgmstream-cli.exe'
if (-not (Test-Path $vgm)) {
  Fetch 'https://github.com/vgmstream/vgmstream/releases/latest/download/vgmstream-win64.zip' (Join-Path $Bin 'vgmstream.zip')
  Unzip (Join-Path $Bin 'vgmstream.zip') (Join-Path $Bin 'vgmstream')
}

# --- package ---
Step 'Building the package from your copy of the game (1-2 hours the first time)'
$env:DTV_PAKX = Join-Path $Bin 'dispatch\pakx.exe'
$env:DTV_MESHX = Join-Path $Bin 'dispatch\meshx.exe'
$env:DTV_FFMPEG = $ffmpeg
$env:DTV_VGM = $vgm
$work = Join-Path $Base 'trabajo'
& $node (Join-Path $code 'tools\build.js') $game $key $work
if ($LASTEXITCODE) { Write-Host 'The build did not finish. Run the command again: it resumes where it left off.' -ForegroundColor Red; return }

# --- server for the TV ---
Step 'Done. Now, on the TV:'
Write-Host @'
   1. Install the "Downloader" app (by AFTVnews) from Google Play and open it.
   2. Type the "App for the TV" address shown below and install Dispatch TV
      (the first time, the TV asks you to allow installing apps from Downloader).
   3. Open Dispatch TV, type the "Address for the app" and choose "Copy the game".
   If Windows asks about the firewall, allow access on private networks.
   When the TV finishes copying, close this window.
'@
& $node (Join-Path $code 'tools\servidor.js') (Join-Path $work 'web') (Join-Path $Base 'DispatchTV.apk')
