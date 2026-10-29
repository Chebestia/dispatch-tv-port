package tv.dispatch.port;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

// Dispatch TV: un WebView a pantalla completa con el port.
//   Sola: si el paquete está en <almacenamiento de la app>/pack, lo sirve LocalServer dentro del televisor y las
//   partidas quedan en <almacenamiento de la app>/saves. No hace falta la PC.
//   La primera vez (o con el botón Menú) pide la dirección de la PC donde corre tools/servidor.js y ofrece copiar el
//   paquete desde ahí (retoma si se corta) o jugar directo desde la PC.
// El control remoto llega a la página como teclado: D-pad = flechas, OK = Enter, Atrás = Escape (pausa / volver).
// "Salir del juego" (about:blank) cierra la app.
public class MainActivity extends Activity {
    private static final int LOCAL_PORT = 38093; // fijo: el origen de la página (y su localStorage) no cambia
    private WebView web;
    private SharedPreferences prefs;
    private LocalServer local;
    private File base, pack;
    private volatile boolean copying;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("dispatch", MODE_PRIVATE);
        base = getExternalFilesDir(null);
        pack = new File(base, "pack");

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // partidas y ajustes (localStorage)
        s.setMediaPlaybackRequiresUserGesture(false); // los videos y el audio arrancan solos
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if ("about:blank".equals(req.getUrl().toString())) { finish(); return true; }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame() && local == null) askServer();
            }
        });
        setContentView(web);
        hideBars();

        if (!startLocal()) askServer();
    }

    // paquete completo: index.html y sin la marca de copia a medias
    private boolean startLocal() {
        if (!new File(pack, "index.html").isFile() || new File(base, "copiando").exists()) return false;
        try {
            if (local == null) local = new LocalServer(pack, new File(base, "saves"), LOCAL_PORT);
            web.loadUrl("http://127.0.0.1:" + local.port() + "/");
            return true;
        } catch (IOException e) {
            local = null;
            return false;
        }
    }

    private String server(EditText input) {
        String url = input.getText().toString().trim();
        if (!url.startsWith("http")) url = "http://" + url;
        if (!url.endsWith("/")) url += "/";
        prefs.edit().putString("url", url).apply();
        return url;
    }

    private void askServer() {
        if (copying) return;
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("192.168.1.10:8093");
        input.setText(prefs.getString("url", ""));
        new AlertDialog.Builder(this)
            .setTitle("Dispatch TV")
            .setMessage("Dirección que muestra instalar.ps1 en la PC (\"Dirección para la app\").\n\n"
                + "Copiar el juego lo guarda en el televisor (unos 4 GB) y después ya no hace falta la PC.")
            .setView(input)
            .setCancelable(local != null) // con el juego ya copiado, Atrás cierra el diálogo y sigue jugando
            .setPositiveButton("Copiar el juego", (d, w) -> copyPack(server(input)))
            .setNeutralButton("Jugar desde la PC", (d, w) -> { if (local != null) { local.stop(); local = null; } web.loadUrl(server(input)); })
            .setNegativeButton("Salir", (d, w) -> finish())
            .show();
    }

    // --- copia del paquete desde la PC ---

    private TextView status;
    private ProgressBar bar;

    private void showProgress() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.BLACK);
        box.setPadding(160, 0, 160, 0);
        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(22);
        status.setGravity(Gravity.CENTER);
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(1000);
        box.addView(status);
        box.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 40));
        setContentView(box);
    }

    private void progress(String text, long done, long total) {
        runOnUiThread(() -> {
            status.setText(text);
            bar.setProgress(total > 0 ? (int) (done * 1000 / total) : 0);
        });
    }

    private void copyPack(String url) {
        if (local != null) { local.stop(); local = null; }
        copying = true;
        showProgress();
        progress("Conectando con la PC…", 0, 0);
        new Thread(() -> {
            try {
                File mark = new File(base, "copiando");
                JSONArray list = new JSONArray(read(url + "__pack"));
                long total = 0, have = 0;
                for (int i = 0; i < list.length(); i++) {
                    JSONArray f = list.getJSONArray(i);
                    long size = f.getLong(1);
                    total += size;
                    File dst = new File(pack, f.getString(0));
                    if (dst.length() == size) have += size;
                }
                long free = base.getUsableSpace();
                if (total - have > free) throw new IOException(String.format("Falta espacio en el televisor: hacen falta %.1f GB y hay %.1f GB libres.", (total - have) / 1e9, free / 1e9));
                mark.createNewFile();
                long done = have;
                long t0 = System.currentTimeMillis();
                for (int i = 0; i < list.length(); i++) {
                    JSONArray f = list.getJSONArray(i);
                    String rel = f.getString(0);
                    long size = f.getLong(1);
                    File dst = new File(pack, rel);
                    if (!dst.getCanonicalPath().startsWith(pack.getCanonicalPath() + File.separator)) continue;
                    if (dst.length() == size) continue;
                    dst.getParentFile().mkdirs();
                    File part = new File(dst.getPath() + ".part");
                    StringBuilder path = new StringBuilder();
                    for (String seg : rel.split("/")) path.append(path.length() > 0 ? "/" : "").append(URLEncoder.encode(seg, "UTF-8").replace("+", "%20"));
                    HttpURLConnection c = (HttpURLConnection) new URL(url + path).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(60000);
                    if (c.getResponseCode() != 200) throw new IOException("La PC respondió " + c.getResponseCode() + " para " + rel);
                    try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                        byte[] buf = new byte[1 << 16];
                        int n;
                        long last = 0;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            done += n;
                            long now = System.currentTimeMillis();
                            if (now - last > 500) {
                                last = now;
                                double mbs = (done - have) / 1e6 / Math.max(1, (now - t0) / 1000.0);
                                long left = (long) ((total - done) / 1e6 / Math.max(0.1, mbs) / 60);
                                progress(String.format("Copiando el juego desde la PC\n%.2f de %.2f GB · %.1f MB/s · faltan ~%d min", done / 1e9, total / 1e9, mbs, left), done, total);
                            }
                        }
                    } finally {
                        c.disconnect();
                    }
                    if (!part.renameTo(dst)) throw new IOException("No se pudo guardar " + rel);
                }
                mark.delete();
                runOnUiThread(() -> {
                    copying = false;
                    setContentView(web);
                    hideBars();
                    if (!startLocal()) askServer();
                });
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : e.toString();
                runOnUiThread(() -> {
                    copying = false;
                    setContentView(web);
                    new AlertDialog.Builder(this)
                        .setTitle("No se pudo copiar")
                        .setMessage(msg + "\n\nRevisá que instalar.ps1 siga abierto en la PC. Al reintentar sigue donde quedó.")
                        .setCancelable(false)
                        .setPositiveButton("Reintentar", (d, w) -> copyPack(url))
                        .setNegativeButton("Volver", (d, w) -> askServer())
                        .show();
                });
            }
        }).start();
    }

    private static String read(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(30000);
        try (InputStream in = c.getInputStream()) {
            java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return b.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }

    // D-pad central y Atrás no tienen equivalente directo en la página: OK pasa como Enter, Atrás y Play/Pausa como
    // Escape (el menú de pausa del port; en los menús, volver). Menú del control: copiar de nuevo o jugar desde la PC.
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (copying) return super.dispatchKeyEvent(e);
        int code = e.getKeyCode();
        int to = -1;
        if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER) to = KeyEvent.KEYCODE_ENTER;
        else if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) to = KeyEvent.KEYCODE_ESCAPE;
        else if (code == KeyEvent.KEYCODE_MENU) {
            if (e.getAction() == KeyEvent.ACTION_UP) askServer();
            return true;
        }
        if (to >= 0) return web.dispatchKeyEvent(new KeyEvent(e.getDownTime(), e.getEventTime(), e.getAction(), to, e.getRepeatCount(), e.getMetaState()));
        return super.dispatchKeyEvent(e);
    }

    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) hideBars();
    }

    // al salir de la app, la página pausa la escena (PauseOnLostFocus) y el WebView deja de reproducir
    @Override
    protected void onPause() { web.onPause(); super.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onDestroy() { web.destroy(); if (local != null) local.stop(); super.onDestroy(); }
}
