package com.factpos.verificador;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Verificador FactPOS: abre la pantalla /verificador del servidor de la sucursal (red local) a pantalla
 * completa, como quiosco. La primera vez busca (o pide) la dirección del servidor.
 * - Pantalla siempre encendida, sin barras de Android, sin botón Atrás.
 * - Es también pantalla de inicio (HOME): el botón Inicio vuelve aquí; arranca al encender el equipo.
 * - Con Device Owner (adb shell dpm set-device-owner com.factpos.verificador/.AdminReceiver) bloquea el equipo (lock task).
 * - Sin Device Owner: si alguien sale, vuelve sola al frente (permiso "Mostrar sobre otras apps").
 * - Cambiar el servidor o salir de la app: solo con el PIN de un supervisor o administrador de FactPOS (✕ / ⓘ abajo).
 */
public class MainActivity extends Activity {

    static final String CONFIG = "file:///android_asset/config.html";
    
    private WebView web;
    private FrameLayout raiz;
    private final Handler hilo = new Handler(Looper.getMainLooper());
    private boolean saliendo = false;
    private final Runnable traerAlFrente = this::volverAlFrente;

    // ------------------------------------------------------------ copia local para consultar precios sin servidor
    private volatile boolean sinServidor = false;
    private final java.util.concurrent.atomic.AtomicBoolean vigilando = new java.util.concurrent.atomic.AtomicBoolean(false);

    private String leerCopia(String nombre) {
        try (FileInputStream in = new FileInputStream(new File(getFilesDir(), nombre))) {
            java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) o.write(b, 0, n);
            return new String(o.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) { return ""; }
    }
    private void escribirCopia(String nombre, String texto) {
        try {
            File tmp = new File(getFilesDir(), nombre + ".tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(texto.getBytes(StandardCharsets.UTF_8)); }
            if (!tmp.renameTo(new File(getFilesDir(), nombre))) tmp.delete();
        } catch (Exception e) { }
    }
    /** Mientras se muestra la copia, se prueba el servidor cada 10 s y se vuelve a la pantalla real apenas responda. */
    private void vigilarServidor() {
        if (!vigilando.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                while (sinServidor && !saliendo) {
                    try { Thread.sleep(10000); } catch (InterruptedException e) { return; }
                    try {
                        Uri u = Uri.parse(servidor());
                        HttpURLConnection c = (HttpURLConnection) new URL(u.getScheme() + "://" + u.getAuthority() + "/verificador/config").openConnection();
                        c.setConnectTimeout(3000); c.setReadTimeout(3000);
                        c.getResponseCode();      // cualquier respuesta: el servidor está vivo
                        sinServidor = false;
                        hilo.post(() -> { if (web != null) web.loadUrl(direccion()); });
                    } catch (Exception sigueCaido) { }
                }
            } finally { vigilando.set(false); }
        }, "vigilar-servidor").start();
    }

    // ------------------------------------------------------------ Administración ve este equipo y puede apuntarlo al servidor
    private static final int PUERTO_EQUIPOS = 41235;
    private java.net.DatagramSocket socketEquipos;
    private static boolean ipPrivada(String ip) {
        try {
            String[] a = ip.split("\\.");
            int p = Integer.parseInt(a[0]), q = Integer.parseInt(a[1]);
            return p == 10 || (p == 172 && q >= 16 && q <= 31) || (p == 192 && q == 168);
        } catch (Exception e) { return false; }
    }
    /** ¿Responde un servidor FactPOS en esta dirección? */
    private boolean esFactpos(String base) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(base + "/descubrir").openConnection();
            c.setConnectTimeout(2500); c.setReadTimeout(2500);
            if (c.getResponseCode() != 200) return false;
            java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[1024]; int n;
            try (InputStream in = c.getInputStream()) { while ((n = in.read(b)) > 0 && o.size() < 20000) o.write(b, 0, n); }
            return "FactPOS".equals(new JSONObject(o.toString("UTF-8")).optString("producto"));
        } catch (Exception e) { return false; }
    }
    private JSONObject apuntar(String url, String origen) throws Exception {
        Uri u = Uri.parse(url);
        if (u.getScheme() == null || u.getAuthority() == null || !(u.getScheme().equals("http") || u.getScheme().equals("https")) || !ipPrivada(origen))
            return new JSONObject().put("ok", false).put("error", "Orden no permitida");
        String nuevo = u.getScheme() + "://" + u.getAuthority();
        if (!esFactpos(nuevo)) return new JSONObject().put("ok", false).put("error", "En esa dirección no responde un servidor FactPOS");
        String actual = servidor();
        if (actual.equals(nuevo) || actual.startsWith(nuevo + "/")) return new JSONObject().put("ok", true);
        prefs().edit().putString("servidor", nuevo + "/verificador").remove("pines").apply();   // los PIN eran del servidor anterior
        new File(getFilesDir(), "copia_catalogo.json").delete(); new File(getFilesDir(), "copia_pagina.html").delete();
        sinServidor = false;
        hilo.post(() -> { if (web != null) web.loadUrl(direccion()); });
        return new JSONObject().put("ok", true);
    }
    /** Contesta a Administración (UDP 41235): quién es este equipo y a qué servidor apunta; y acepta «apuntar». */
    private void responderEquipos() {
        new Thread(() -> {
            try {
                socketEquipos = new java.net.DatagramSocket(null);
                socketEquipos.setReuseAddress(true);
                socketEquipos.bind(new java.net.InetSocketAddress(PUERTO_EQUIPOS));
                byte[] buf = new byte[4096];
                while (!saliendo) {
                    java.net.DatagramPacket in = new java.net.DatagramPacket(buf, buf.length);
                    socketEquipos.receive(in);
                    String origen = in.getAddress().getHostAddress();
                    if (!ipPrivada(origen)) continue;
                    String texto = new String(in.getData(), 0, in.getLength(), StandardCharsets.UTF_8).trim();
                    JSONObject r = null;
                    try {
                        if (texto.equals("FACTPOS-EQUIPOS?")) {
                            r = new JSONObject().put("producto", "FactPOS-equipo").put("tipo", "verificador").put("id", idEquipo())
                                    .put("nombre", android.os.Build.MODEL).put("version", versionApp()).put("plataforma", "Android").put("servidor", servidor());
                        } else if (texto.startsWith("FACTPOS-APUNTAR ")) {
                            r = apuntar(new JSONObject(texto.substring(16)).optString("url"), origen);
                        }
                    } catch (Exception e) {
                        try { r = new JSONObject().put("ok", false).put("error", "No se pudo aplicar"); } catch (Exception ignorada) { }
                    }
                    if (r != null) {
                        byte[] salida = r.toString().getBytes(StandardCharsets.UTF_8);
                        socketEquipos.send(new java.net.DatagramPacket(salida, salida.length, in.getAddress(), in.getPort()));
                    }
                }
            } catch (Exception e) { /* sin red o puerto ocupado: simplemente no aparece en la lista */ }
        }, "equipos-red").start();
    }

    private SharedPreferences prefs() { return getSharedPreferences("config", MODE_PRIVATE); }
    private String servidor() { return prefs().getString("servidor", ""); }
    private String direccion() { String s = servidor(); return s.isEmpty() ? CONFIG : s; }
    private boolean vigilar() { return !saliendo; }

    // ------------------------------------------------------------ clave de salida = PIN de un supervisor o administrador
    // Sin conexión con el servidor no se puede validar el PIN allá: vale uno que ESTE equipo ya validó antes con el servidor
    // (se guarda solo su huella con sal, nunca el PIN). Si el servidor lo rechaza después, se olvida.
    private static String hex(byte[] b) { StringBuilder x = new StringBuilder(); for (byte y : b) x.append(String.format("%02x", y)); return x.toString(); }
    private static String huella(String pin, byte[] sal) throws Exception {
        return hex(javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1")
                .generateSecret(new javax.crypto.spec.PBEKeySpec(pin.toCharArray(), sal, 20000, 256)).getEncoded());
    }
    private static byte[] deHex(String h) { byte[] r = new byte[h.length() / 2]; for (int i = 0; i < r.length; i++) r[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16); return r; }
    private org.json.JSONArray pinesGuardados() {
        try { return new org.json.JSONArray(prefs().getString("pines", "[]")); } catch (Exception e) { return new org.json.JSONArray(); }
    }
    private boolean pinRecordado(String pin) {
        try {
            org.json.JSONArray a = pinesGuardados();
            for (int i = 0; i < a.length(); i++) {
                org.json.JSONObject e = a.getJSONObject(i);
                if (java.security.MessageDigest.isEqual(huella(pin, deHex(e.getString("s"))).getBytes(StandardCharsets.UTF_8), e.getString("h").getBytes(StandardCharsets.UTF_8))) return true;
            }
        } catch (Exception e) { }
        return false;
    }
    private void recordarPin(String pin) {
        try {
            if (pinRecordado(pin)) return;
            byte[] sal = new byte[16]; new java.security.SecureRandom().nextBytes(sal);
            org.json.JSONArray a = pinesGuardados(), n = new org.json.JSONArray();
            for (int i = Math.max(0, a.length() - 4); i < a.length(); i++) n.put(a.get(i));
            n.put(new JSONObject().put("s", hex(sal)).put("h", huella(pin, sal)));
            prefs().edit().putString("pines", n.toString()).apply();
        } catch (Exception e) { }
    }
    private void olvidarPin(String pin) {
        try {
            org.json.JSONArray a = pinesGuardados(), n = new org.json.JSONArray();
            for (int i = 0; i < a.length(); i++) {
                org.json.JSONObject e = a.getJSONObject(i);
                if (!java.security.MessageDigest.isEqual(huella(pin, deHex(e.getString("s"))).getBytes(StandardCharsets.UTF_8), e.getString("h").getBytes(StandardCharsets.UTF_8))) n.put(e);
            }
            prefs().edit().putString("pines", n.toString()).apply();
        } catch (Exception e) { }
    }

    /** "ok" | "incorrecta" | "sin_conexion" | texto del servidor (p. ej. demasiados intentos). Se llama desde el hilo del puente, no de la pantalla.
     *  Sin conexión vale un PIN que este equipo ya validó antes con el servidor. */
    private String comprobarPin(String pin) {
        String sv = servidor();
        if (pin == null || !pin.matches("\\d{4,8}")) return "incorrecta";
        if (sv.isEmpty()) return pinRecordado(pin) ? "ok" : "incorrecta";
        try {
            Uri u = Uri.parse(sv);
            HttpURLConnection c = (HttpURLConnection) new URL(u.getScheme() + "://" + u.getAuthority() + "/verificador/autorizar-salida").openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(3000);
            c.setReadTimeout(3000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = c.getOutputStream()) { o.write(new JSONObject().put("pin", pin).toString().getBytes(StandardCharsets.UTF_8)); }
            int codigo = c.getResponseCode();
            if (codigo == 200) { recordarPin(pin); return "ok"; }
            if (codigo == 401 || codigo == 403) { olvidarPin(pin); return "incorrecta"; }
            if (codigo == 429) return "Demasiados intentos: espere unos minutos.";
            return pinRecordado(pin) ? "ok" : "sin_conexion";
        } catch (Exception e) { return pinRecordado(pin) ? "ok" : "sin_conexion"; }
    }
    private boolean claveOk(String pin) { return "ok".equals(comprobarPin(pin)); }

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        raiz = new FrameLayout(this);
        raiz.setBackgroundColor(Color.rgb(16, 32, 46));
        setContentView(raiz);
        crearWeb();
        web.loadUrl(direccion());
        responderEquipos();
        ocultarBarras();
        activarBloqueo();
        if (!actualizacionProgramada) { actualizacionProgramada = true; programarActualizacion(20 * 1000L); }
    }

    private void crearWeb() {
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);   // no afecta a file:///android_asset (la pantalla de configuración)
        s.setUserAgentString(s.getUserAgentString() + " FactPOSVerificador/" + versionApp() + " (Android)");
        web.setBackgroundColor(Color.rgb(16, 32, 46));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);
        web.addJavascriptInterface(new Puente(), "FactPOSApp");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView vista, WebResourceRequest pedido) {
                // Solo el servidor configurado y la pantalla de configuración; el cliente no puede navegar fuera.
                Uri u = pedido.getUrl();
                if (u == null) return true;
                if ("file".equals(u.getScheme())) return !CONFIG.equals(u.toString().split("[?#]")[0]);
                String sv = servidor();
                return sv.isEmpty() || !u.getHost().equalsIgnoreCase(Uri.parse(sv).getHost());
            }

            @Override
            public void onPageFinished(WebView vista, String url) {
                // Esquina ✕ / ⓘ (cerrar y opciones con la clave): en la pantalla del verificador, no en la de configuración
                if (url == null || !url.startsWith("http")) return;
                try (java.io.InputStream in = getAssets().open("boton-app.js")) {
                    byte[] b = new byte[in.available()];
                    int n = in.read(b);
                    vista.evaluateJavascript(new String(b, 0, Math.max(n, 0), StandardCharsets.UTF_8), null);
                } catch (Exception ignorado) { }
            }

            @Override
            public void onReceivedError(WebView vista, WebResourceRequest pedido, WebResourceError error) {
                // Servidor apagado o sin red: avisar y reintentar solo.
                if (pedido != null && pedido.isForMainFrame() && !servidor().isEmpty()) {
                    // Con una copia guardada de la pantalla y del catálogo se sigue consultando precios sin el servidor
                    String copia = leerCopia("copia_pagina.html");
                    if (!copia.isEmpty() && !leerCopia("copia_catalogo.json").isEmpty()) {
                        sinServidor = true;
                        String base = servidor();
                        vista.loadDataWithBaseURL(base, copia.replaceFirst("<head>", "<head><script>window.__factposSinConexion=true;</script>"),
                                "text/html", "utf-8", base);
                        vigilarServidor();
                        return;
                    }
                    vista.loadData("<html><body style='font-family:sans-serif;background:#10202e;color:#f0f4f8;"
                            + "display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"
                            + "text-align:center'><div><div style='font-size:52px'>📶</div><h2>Sin conexión con el servidor</h2>"
                            + "<p>Revise que el equipo esté en la red de la tienda y que el servidor esté encendido.<br>Se reintenta solo.</p></div></body></html>",
                            "text/html; charset=utf-8", "utf-8");
                    hilo.postDelayed(() -> { if (web != null) web.loadUrl(direccion()); }, 10000);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView vista, RenderProcessGoneDetail detalle) {
                raiz.removeView(vista);
                vista.destroy();
                crearWeb();
                web.loadUrl(direccion());
                return true;
            }
        });
        raiz.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.requestFocus();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (vigilar()) hilo.postDelayed(traerAlFrente, 400);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hilo.removeCallbacks(traerAlFrente);
        saliendo = false;
        ocultarBarras();
        activarBloqueo();
        if (web != null) web.onResume();
    }

    @Override
    public void onWindowFocusChanged(boolean conFoco) {
        super.onWindowFocusChanged(conFoco);
        if (conFoco) ocultarBarras();
    }

    private boolean puedeVolverAlFrente() {
        return Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(this);
    }

    private void volverAlFrente() {
        if (!vigilar() || isFinishing()) return;
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) am.moveTaskToFront(getTaskId(), 0);
        } catch (RuntimeException ignorado) { }
        try {
            startActivity(new Intent(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
        } catch (RuntimeException ignorado) { }
    }

    @Override
    public void onBackPressed() { /* sin botón Atrás: el cliente no puede salir */ }

    @Override
    public boolean dispatchKeyEvent(KeyEvent evento) {
        int k = evento.getKeyCode();
        if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_APP_SWITCH || k == KeyEvent.KEYCODE_MENU) return true;
        return super.dispatchKeyEvent(evento);
    }

    @SuppressWarnings("deprecation")
    private void ocultarBarras() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    private boolean esDeviceOwner() {
        DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
        return dpm != null && dpm.isDeviceOwnerApp(getPackageName());
    }

    private boolean enModoBloqueo() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return false;
        if (Build.VERSION.SDK_INT >= 23) return am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
        return am.isInLockTaskMode();
    }

    private void activarBloqueo() {
        if (saliendo || !esDeviceOwner()) return;
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(this, AdminReceiver.class);
            dpm.setLockTaskPackages(admin, new String[]{getPackageName(), "com.android.settings"});
            if (!enModoBloqueo()) startLockTask();
        } catch (RuntimeException e) {
            // Si falla, la app sigue funcionando como pantalla de inicio.
        }
    }

    // ------------------------------------------------------------ actualización automática
    // El servidor de la sucursal dice cuál es la versión vigente (/verificador/actualizacion/android); si es mayor que la de esta
    // app, la descarga de ese mismo servidor (/verificador/descarga/android) y la instala. Con Device Owner es silenciosa;
    // sin él Android pide confirmar una vez. El APK nuevo debe estar firmado con la misma llave (secretos ANDROID_KEYSTORE_*).
    private static volatile boolean enActualizacion = false;
    private static boolean actualizacionProgramada = false;   // un solo reloj aunque la actividad se vuelva a crear
    private static final long CADA_ACTUALIZACION = 60 * 1000L;   // consulta liviana al servidor de la sucursal; reacciona al botón «Actualizar ahora» en menos de un minuto

    private void programarActualizacion(long espera) {
        hilo.postDelayed(() -> {
            if (!saliendo && !enActualizacion) {   // una sola a la vez (una descarga puede tardar más de un minuto)
                enActualizacion = true;
                new Thread(() -> { try { actualizar(); } finally { enActualizacion = false; } }, "actualizar").start();
            }
            programarActualizacion(CADA_ACTUALIZACION);
        }, espera);
    }

    private long codigoVersion() {
        try {
            PackageInfo p = getPackageManager().getPackageInfo(getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (Exception e) { return 0; }
    }

    /** Abre la URL siguiendo redirecciones (incluso de http a https, que HttpURLConnection no hace solo). */
    private HttpURLConnection abrirUrl(String url) throws Exception {
        for (int i = 0; i < 6; i++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10000);
            c.setReadTimeout(60000);
            int codigo = c.getResponseCode();
            if (codigo == 301 || codigo == 302 || codigo == 303 || codigo == 307 || codigo == 308) {
                String destino = c.getHeaderField("Location");
                c.disconnect();
                if (destino == null) throw new Exception("redirección sin destino");
                url = new URL(new URL(url), destino).toString();
                continue;
            }
            if (codigo != 200) { c.disconnect(); throw new Exception("HTTP " + codigo); }
            return c;
        }
        throw new Exception("demasiadas redirecciones");
    }

    /** Identificador propio de este equipo (para que la administración vea su versión). */
    private String idEquipo() {
        SharedPreferences p = prefs();
        String id = p.getString("id_equipo", "");
        if (id.isEmpty()) { id = java.util.UUID.randomUUID().toString(); p.edit().putString("id_equipo", id).apply(); }
        return id;
    }

    private void actualizar() {
        try {
            String sv = servidor();
            if (sv.isEmpty()) return;
            Uri u = Uri.parse(sv);
            String base = u.getScheme() + "://" + u.getAuthority();
            JSONObject j;
            HttpURLConnection c = abrirUrl(base + "/verificador/actualizacion/android?build=" + codigoVersion() + "&id=" + idEquipo() + "&equipo=" + Uri.encode(android.os.Build.MODEL == null ? "" : android.os.Build.MODEL));
            try (InputStream in = c.getInputStream()) {
                java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
                byte[] t = new byte[4096]; int n;
                while ((n = in.read(t)) > 0) b.write(t, 0, n);
                j = new JSONObject(b.toString("UTF-8"));
            } finally { c.disconnect(); }
            long vigente = j.optLong("version", 0), orden = j.optLong("orden", 0);
            boolean auto = j.optBoolean("auto", true);
            SharedPreferences p = prefs();
            boolean porOrden = orden > p.getLong("act_orden", 0);   // botón «Actualizar verificadores ahora» de la administración
            if (porOrden) p.edit().putLong("act_orden", orden).apply();
            if (vigente <= codigoVersion()) return;
            if (!porOrden && !auto) return;   // actualización automática apagada: solo por orden
            if (!porOrden && p.getLong("act_intento", 0) == vigente && System.currentTimeMillis() - p.getLong("act_hora", 0) < 6 * 3600 * 1000L) return;   // no insistir en bucle
            p.edit().putLong("act_intento", vigente).putLong("act_hora", System.currentTimeMillis()).apply();
            File apk = new File(getCacheDir(), "actualizacion.apk");
            HttpURLConnection d = abrirUrl(base + "/verificador/descarga/android");
            try (InputStream in = d.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                byte[] t = new byte[65536]; int n;
                while ((n = in.read(t)) > 0) out.write(t, 0, n);
            } finally { d.disconnect(); }
            boolean zip = false;
            if (apk.length() > 1_000_000) {
                try (InputStream in = new FileInputStream(apk)) { zip = in.read() == 'P' && in.read() == 'K'; }
            }
            if (!zip) { apk.delete(); return; }   // no es un APK
            instalarApk(apk);
        } catch (Exception e) { /* sin red o sin servidor: se intenta más tarde */ }
    }

    private void instalarApk(File apk) throws Exception {
        PackageInstaller instalador = getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(getPackageName());
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = instalador.createSession(params);
        try (PackageInstaller.Session sesion = instalador.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = sesion.openWrite("verificador", 0, apk.length())) {
                byte[] t = new byte[65536]; int n;
                while ((n = in.read(t)) > 0) out.write(t, 0, n);
                sesion.fsync(out);
            }
            Intent resultado = new Intent(this, InstalacionReceiver.class);
            int banderas = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            sesion.commit(PendingIntent.getBroadcast(this, id, resultado, banderas).getIntentSender());
        }
    }

    private String versionApp() {
        try {
            PackageInfo p = getPackageManager().getPackageInfo(getPackageName(), 0);
            return p.versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    /** Lo que las páginas (configuración y /verificador) pueden pedir. Salir y cambiar de servidor exigen la clave. */
    private class Puente {
        @JavascriptInterface public boolean esApp() { return true; }
        /** La pantalla del verificador entrega una copia de sí misma y del catálogo de precios (solo los guarda si parecen completos). */
        @JavascriptInterface public void guardarCopia(String pagina, String catalogo) {
            if (pagina == null || catalogo == null || pagina.length() < 1000 || !catalogo.contains("\"items\"")) return;
            escribirCopia("copia_catalogo.json", catalogo);
            escribirCopia("copia_pagina.html", pagina);
        }
        @JavascriptInterface public String leerCopia() { return MainActivity.this.leerCopia("copia_catalogo.json"); }
        @JavascriptInterface public String plataforma() { return "android"; }
        @JavascriptInterface public String version() { return versionApp(); }

        /** {"servidor":"…","tieneClave":true,"bloqueoTotal":false,"botonesBloqueados":true} */
        @JavascriptInterface public String estado() {
            try {
                return new JSONObject().put("servidor", servidor())
                        .put("bloqueoTotal", esDeviceOwner()).put("botonesBloqueados", esDeviceOwner() || puedeVolverAlFrente()).toString();
            } catch (Exception e) { return "{}"; }
        }

        /** Redes /24 a las que está conectado este equipo (["192.168.1", …]), para buscar el servidor. */
        @JavascriptInterface public String redes() {
            org.json.JSONArray a = new org.json.JSONArray();
            try {
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (InetAddress d : Collections.list(ni.getInetAddresses())) {
                        if (d instanceof Inet4Address && d.isSiteLocalAddress()) {
                            String ip = d.getHostAddress();
                            a.put(ip.substring(0, ip.lastIndexOf('.')));
                        }
                    }
                }
            } catch (Exception ignorado) { }
            return a.toString();
        }

        @JavascriptInterface public String verificarClave(String pin) { return comprobarPin(pin); }

        /** Guarda la dirección del servidor. Solo se puede mientras no haya uno (para cambiarlo, antes «cambiarServidor» con el PIN). */
        @JavascriptInterface public String guardar(String url) {
            String v = url == null ? "" : url.trim();
            if (!v.matches("^https?://[^\\s/]+(/\\S*)?$")) return "Escriba una dirección válida, por ejemplo http://192.168.1.10:3000/verificador";
            if (!servidor().isEmpty()) return "Este equipo ya tiene un servidor: para cambiarlo use ⓘ › Cambiar de servidor.";
            prefs().edit().putString("servidor", v).apply();
            hilo.post(() -> { if (web != null) web.loadUrl(direccion()); });
            return "";
        }

        /** Con el PIN de un supervisor o administrador: olvida el servidor y vuelve a la pantalla de configuración. */
        @JavascriptInterface public boolean cambiarServidor(String clave) {
            if (!claveOk(clave)) return false;
            prefs().edit().remove("servidor").remove("pines").apply();
            new File(getFilesDir(), "copia_catalogo.json").delete(); new File(getFilesDir(), "copia_pagina.html").delete();
            hilo.post(() -> { if (web != null) web.loadUrl(CONFIG); });
            return true;
        }

        /** Con el PIN de un supervisor o administrador: quita el bloqueo y cierra la app. */
        @JavascriptInterface public boolean salir(String clave) {
            if (!claveOk(clave)) return false;
            hilo.post(() -> {
                saliendo = true;
                hilo.removeCallbacks(traerAlFrente);
                try { if (enModoBloqueo()) stopLockTask(); } catch (RuntimeException ignorado) { }
                finishAndRemoveTask();
            });
            return true;
        }

        /** Android 10+: abrir el permiso "Mostrar sobre otras apps" (una vez por equipo). */
        @JavascriptInterface public void bloquearBotones() {
            hilo.post(() -> {
                saliendo = true;
                Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { startActivity(i); } catch (RuntimeException ignorado) { }
            });
        }
    }
}
