# Dispatch TV

Port no oficial de las escenas de **Dispatch** (AdHoc Studio) para televisores con Android TV / Google TV. Se juega la historia con el control remoto, en 720p:

- Las decisiones de diálogo se juegan como en el original.
- Los QTE se dan por acertados.
- Los minijuegos (hackeo, turnos de despacho y la base de datos de héroes) se saltean.

**Este repositorio no trae nada del juego.** No incluye videos, audio, textos, imágenes ni datos. El paquete para el televisor lo arma tu PC a partir de **tu copia de Dispatch instalada desde Steam**. Hace falta tener el juego.

## Instalación

### 1. En la PC (Windows)

Abrí PowerShell y corré:

```powershell
irm https://raw.githubusercontent.com/Chebestia/dispatch-tv-port/main/instalar.ps1 | iex
```

El script:

1. Busca Dispatch en tus bibliotecas de Steam.
2. Te pide la **clave AES** de los paks del juego. Este repositorio no la incluye: la tenés que conseguir vos.
3. Baja las herramientas que necesita: Node.js si no lo tenés, ffmpeg, vgmstream y las de este repositorio.
4. Arma el paquete: entre 1 y 2 horas la primera vez. Si se corta, volvé a correr el mismo comando y sigue donde quedó.
5. Deja abierto un servidor en tu red local y muestra dos direcciones: la de la app y la que hay que escribir en la app.

Mientras trabaja necesita unos 11 GB libres. Al terminar ocupa unos 4 GB en `%LOCALAPPDATA%\DispatchTV`. Para usar otra carpeta, antes del comando corré `$env:DISPATCHTV_CARPETA = 'D:\DispatchTV'`.

### 2. En el televisor

1. Instalá **Downloader** (de AFTVnews) desde Google Play.
2. En Downloader, escribí la dirección "App para el televisor" que muestra la PC (`http://<ip>:8093/app.apk`) e instalá Dispatch TV. La primera vez, el televisor pide permitir instalar apps desde Downloader.
3. Abrí **Dispatch TV**, escribí la "Dirección para la app" y elegí **Copiar el juego**. Son unos 4 GB por WiFi y, si se corta, sigue donde quedó.
4. Listo: desde ahí juega sin la PC. Con el botón **Menú** del control podés volver a copiar el juego (por ejemplo, después de una actualización) o jugar directo desde la PC.

## Control remoto

| Tecla | Qué hace |
| --- | --- |
| D-pad | Mueve el foco en los menús. En una fila de ajustes, Izquierda/Derecha cambian el valor. |
| ◀ ▲ ▶ en una decisión | Marcan la opción de ese lado. |
| OK | Elige. |
| Atrás | Pausa durante las escenas; en los menús, vuelve. |
| Menú | Copiar el juego de nuevo o jugar desde la PC. |

## Partidas

Las partidas se guardan solas en los puntos de guardado de cada escena, como en el original:

- en el televisor, en el almacenamiento de la app (desinstalarla las borra);
- si jugás desde la PC, en `%LOCALAPPDATA%\DispatchTV\trabajo\saves`.

## Cómo está hecho

- **`web/`:** el reproductor (HTML/JS). Recorre el grafo de la historia, sincroniza los videos con el audio de los bancos FMOD y muestra subtítulos, decisiones y censura. También arma los menús originales: episodios, escenas, ajustes, extras y fin de episodio.
- **`tools/`:** las herramientas que arman el paquete desde los archivos del juego.
  - `build.js` coordina todo.
  - `pakinv.js` y `pakx` (Rust) leen los paks cifrados de UE 4.27.
  - `uasset.js` y `uprops.js` leen los assets.
  - `compile.js` pasa la historia a un grafo.
  - Los `*gen.js` generan los datos de menús, textos, censura, extras, etc.
  - `meshx` (C#, CUE4Parse) exporta texturas y datos que sólo CUE4Parse entiende.
  - `fmodx.js` y `fmodmap.js` convierten el audio FMOD.
  - `servidor.js` sirve el paquete en la red local.
- **`android/`:** la app. Es un WebView a pantalla completa con un servidor HTTP local (`LocalServer`) que sirve el paquete copiado al televisor.

### Compilar desde el código

- **App:** con Android SDK 34 y Gradle 8.7, `gradle -p android assembleDebug`.
- **`pakx`:** con Rust, `cargo build --release` en `tools/pakx`.
- **`meshx`:** con .NET 10, `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true` en `tools/meshx`.

El release `herramientas.zip` trae `pakx.exe` y `meshx.exe` ya compilados.

## Licencias

- **Código de este repositorio:** MIT (ver `LICENSE`).
- **Código de terceros:**
  - `tools/oozextract`: decompresor Oodle de lvlvllvlvllvlvl, MIT, con un cambio en `Cargo.toml` para compilar sin `test-log`.
  - `meshx` usa CUE4Parse (Apache 2.0).
- **El juego:** Dispatch y todo su contenido son de AdHoc Studio. Este proyecto no está afiliado a AdHoc Studio.
