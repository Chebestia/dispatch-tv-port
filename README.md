# Dispatch TV

An unofficial port of the story scenes of **Dispatch** (AdHoc Studio) to Android TV / Google TV. You play the story with the remote, in 720p:

- Dialogue choices play just like in the original.
- QTEs count as passed.
- The minigames (hacking, dispatch shifts and the hero database) are skipped.

**This repository contains nothing from the game.** It has no videos, audio, text, images or data. Your PC builds the TV package from **your own copy of Dispatch installed through Steam**, so you need to own the game.

## Installation

### 1. On the PC (Windows)

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/Chebestia/dispatch-tv-port/main/instalar.ps1 | iex
```

The script:

1. Finds Dispatch in your Steam libraries.
2. Asks for the **AES key** of the game's paks. It is not included here: you have to find it yourself.
3. Downloads the tools it needs: Node.js if you don't have it, ffmpeg, vgmstream and this repository's own tools.
4. Builds the package: 1–2 hours the first time. If it stops, run the same command again and it picks up where it left off.
5. Starts a server on your local network and shows two addresses: one for the app and one to type into the app.

It needs about 11 GB free while it works and leaves about 4 GB in `%LOCALAPPDATA%\DispatchTV`. To use another folder, run `$env:DISPATCHTV_CARPETA = 'D:\DispatchTV'` before the command.

### 2. On the TV

1. Install **Downloader** (by AFTVnews) from Google Play.
2. In Downloader, type the "App for the TV" address shown on the PC (`http://<ip>:8093/app.apk`) and install Dispatch TV. The first time, the TV asks you to allow installing apps from Downloader.
3. Open **Dispatch TV**, type the "Address for the app" and choose **Copy the game**. It's about 4 GB over Wi-Fi, and it resumes if interrupted.
4. Done: from then on it plays without the PC. The remote's **Menu** button lets you copy the game again (for example after an update) or play straight from the PC.

## Remote

| Button | What it does |
| --- | --- |
| D-pad | Moves the focus in menus. On a settings row, Left/Right change the value. |
| ◀ ▲ ▶ during a choice | Highlight the option on that side. |
| OK | Selects. |
| Back | Pauses during scenes; goes back in menus. |
| Menu | Copy the game again or play from the PC. |

## Saves

The game saves automatically at each scene's save points, like the original:

- on the TV, in the app's storage (uninstalling the app deletes them);
- when playing from the PC, in `%LOCALAPPDATA%\DispatchTV\trabajo\saves`.

The game's menus and subtitles are available in all the languages of the original. Code comments are in Spanish.

## How it's built

- **`web/`:** the player (HTML/JS). It walks the story graph, syncs the videos with the audio from the FMOD banks, and shows subtitles, choices and censorship. It also rebuilds the original menus: episodes, scenes, settings, extras and the end-of-episode screen.
- **`tools/`:** the tools that build the package from the game files.
  - `build.js` runs everything.
  - `pakinv.js` and `pakx` (Rust) read the encrypted UE 4.27 paks.
  - `uasset.js` and `uprops.js` read the assets.
  - `compile.js` turns the story into a graph.
  - The `*gen.js` scripts generate the data for menus, text, censorship, extras, etc.
  - `meshx` (C#, CUE4Parse) exports textures and data that only CUE4Parse understands.
  - `fmodx.js` and `fmodmap.js` convert the FMOD audio.
  - `servidor.js` serves the package on the local network.
- **`android/`:** the app. It's a fullscreen WebView with a local HTTP server (`LocalServer`) that serves the package copied to the TV.

### Building from source

- **App:** with Android SDK 34 and Gradle 8.7, `gradle -p android assembleDebug`.
- **`pakx`:** with Rust, `cargo build --release` in `tools/pakx`.
- **`meshx`:** with .NET 10, `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true` in `tools/meshx`.

The `herramientas.zip` release asset contains `pakx.exe` and `meshx.exe` already built.

## Licenses

- **This repository's code:** MIT (see `LICENSE`).
- **Third-party code:**
  - `tools/oozextract`: Oodle decompressor by lvlvllvlvllvlvl, MIT, with a `Cargo.toml` change so it builds without `test-log`.
  - `meshx` uses CUE4Parse (Apache 2.0).
- **The game:** Dispatch and all of its content belong to AdHoc Studio. This project is not affiliated with AdHoc Studio.
