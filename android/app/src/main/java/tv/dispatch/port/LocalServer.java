package tv.dispatch.port;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONObject;

// Servidor HTTP mínimo dentro de la app (sólo 127.0.0.1): sirve el paquete del port (tools/build.js, copiado al
// televisor) con soporte de Range para los videos, y guarda las partidas como tools/servidor.js en la PC:
//   GET /__saves, PUT / DELETE /__saves/<clave>   → <saves>/<clave>.json
final class LocalServer {
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");
    private static final Pattern SAVE_KEY = Pattern.compile("dispatch-web[\\w-]*");
    private static final Map<String, String> TYPES = new HashMap<>();
    static {
        TYPES.put("html", "text/html; charset=utf-8");
        TYPES.put("js", "text/javascript");
        TYPES.put("json", "application/json");
        TYPES.put("css", "text/css");
        TYPES.put("png", "image/png");
        TYPES.put("ogg", "audio/ogg");
        TYPES.put("mp4", "video/mp4");
        TYPES.put("webm", "video/webm");
        TYPES.put("woff2", "font/woff2");
        TYPES.put("ttf", "font/ttf");
        TYPES.put("glb", "model/gltf-binary");
    }

    private final File root, saves;
    private final ServerSocket socket;
    private final ExecutorService pool = Executors.newFixedThreadPool(8);

    LocalServer(File root, File saves, int port) throws IOException {
        this.root = root.getCanonicalFile();
        this.saves = saves;
        ServerSocket s;
        try { s = new ServerSocket(port, 50, InetAddress.getByName("127.0.0.1")); }
        catch (IOException e) { s = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1")); }
        socket = s;
        Thread t = new Thread(() -> {
            while (!socket.isClosed()) {
                try { Socket c = socket.accept(); pool.execute(() -> handle(c)); } catch (IOException ignored) { }
            }
        }, "dispatch-server");
        t.setDaemon(true);
        t.start();
    }

    int port() { return socket.getLocalPort(); }

    void stop() {
        try { socket.close(); } catch (IOException ignored) { }
        pool.shutdownNow();
    }

    private void handle(Socket c) {
        try (Socket s = c) {
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            String request = line(in);
            if (request == null) return;
            Map<String, String> headers = new HashMap<>();
            for (String h; (h = line(in)) != null && !h.isEmpty(); ) {
                int i = h.indexOf(':');
                if (i > 0) headers.put(h.substring(0, i).trim().toLowerCase(Locale.ROOT), h.substring(i + 1).trim());
            }
            String[] parts = request.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            // URLDecoder es de formularios: "+" sería un espacio, pero en una ruta es literal (T_UI_Comics_0001_PasDeDeux+ShellShock)
            String path = URLDecoder.decode(parts[1].split("\\?")[0].replace("+", "%2B"), "UTF-8");

            if (path.equals("/__saves") || path.startsWith("/__saves/")) { saves(method, path, headers, in, out); return; }
            if (path.equals("/")) path = "/index.html";
            File f = new File(root, path).getCanonicalFile();
            if (!f.getPath().startsWith(root.getPath()) || !f.isFile()) { send(out, 404, "text/plain", "no existe".getBytes(StandardCharsets.UTF_8)); return; }
            file(f, headers.get("range"), method.equals("HEAD"), out);
        } catch (IOException ignored) {
            // el WebView corta conexiones de video a cada rato (saltos, cambio de escena)
        }
    }

    private void file(File f, String range, boolean head, OutputStream out) throws IOException {
        String name = f.getName();
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String type = TYPES.containsKey(ext) ? TYPES.get(ext) : "application/octet-stream";
        long size = f.length(), start = 0, end = size - 1;
        boolean partial = false;
        Matcher m = range == null ? null : RANGE.matcher(range);
        if (m != null && m.find()) {
            partial = true;
            if (!m.group(1).isEmpty()) start = Long.parseLong(m.group(1));
            if (!m.group(2).isEmpty()) end = Math.min(size - 1, Long.parseLong(m.group(2)));
            if (m.group(1).isEmpty() && !m.group(2).isEmpty()) { start = Math.max(0, size - Long.parseLong(m.group(2))); end = size - 1; }
        }
        long len = Math.max(0, end - start + 1);
        StringBuilder h = new StringBuilder();
        h.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        h.append("Content-Type: ").append(type).append("\r\n");
        h.append("Content-Length: ").append(len).append("\r\n");
        h.append("Accept-Ranges: bytes\r\n");
        if (partial) h.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(size).append("\r\n");
        h.append("Cache-Control: no-cache\r\nConnection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.UTF_8));
        if (head) return;
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            r.seek(start);
            byte[] buf = new byte[64 * 1024];
            long left = len;
            while (left > 0) {
                int n = r.read(buf, 0, (int) Math.min(buf.length, left));
                if (n < 0) break;
                out.write(buf, 0, n);
                left -= n;
            }
        }
        out.flush();
    }

    private void saves(String method, String path, Map<String, String> headers, InputStream in, OutputStream out) throws IOException {
        if (method.equals("GET") && path.equals("/__saves")) {
            JSONObject all = new JSONObject();
            File[] files = saves.listFiles();
            if (files != null) for (File f : files) {
                if (!f.getName().endsWith(".json")) continue;
                try (InputStream i = new FileInputStream(f)) { all.put(f.getName().substring(0, f.getName().length() - 5), new String(read(i, (int) f.length()), StandardCharsets.UTF_8)); }
                catch (Exception ignored) { }
            }
            send(out, 200, "application/json", all.toString().getBytes(StandardCharsets.UTF_8));
            return;
        }
        String key = path.substring("/__saves/".length());
        if (!SAVE_KEY.matcher(key).matches()) { send(out, 400, "text/plain", "clave".getBytes(StandardCharsets.UTF_8)); return; }
        File f = new File(saves, key + ".json");
        if (method.equals("DELETE")) { f.delete(); send(out, 200, "text/plain", "ok".getBytes(StandardCharsets.UTF_8)); return; }
        if (!method.equals("PUT")) { send(out, 405, "text/plain", new byte[0]); return; }
        int len = Integer.parseInt(headers.containsKey("content-length") ? headers.get("content-length") : "0");
        byte[] body = read(in, len);
        saves.mkdirs();
        // escritura atómica: un corte a mitad de camino no deja la partida a medias
        File tmp = new File(saves, key + ".json.tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(body); o.getFD().sync(); }
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f); }
        send(out, 200, "text/plain", "ok".getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] read(InputStream in, int len) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream(Math.max(len, 16));
        byte[] buf = new byte[16 * 1024];
        int left = len;
        while (left > 0) {
            int n = in.read(buf, 0, Math.min(buf.length, left));
            if (n < 0) break;
            b.write(buf, 0, n);
            left -= n;
        }
        return b.toByteArray();
    }

    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int ch;
        while ((ch = in.read()) >= 0) {
            if (ch == '\n') break;
            if (ch != '\r') b.write(ch);
        }
        return ch < 0 && b.size() == 0 ? null : b.toString("UTF-8");
    }

    private static void send(OutputStream out, int code, String type, byte[] body) throws IOException {
        String status = code == 200 ? "OK" : code == 404 ? "Not Found" : code == 400 ? "Bad Request" : "Method Not Allowed";
        out.write(("HTTP/1.1 " + code + " " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length
            + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }
}
