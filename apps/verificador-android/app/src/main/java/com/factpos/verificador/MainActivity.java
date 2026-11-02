package com.factpos.verificador;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
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
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * Verificador FactPOS: abre la pantalla /verificador del servidor de la sucursal (red local) a pantalla
 * completa, como quiosco. La primera vez pide la dirección del servidor y una clave de salida.
 * - Pantalla siempre encendida, sin barras de Android, sin botón Atrás.
 * - Es también pantalla de inicio (HOME): el botón Inicio vuelve aquí; arranca al encender el equipo.
 * - Con Device Owner (adb shell dpm set-device-owner com.factpos.verificador/.AdminReceiver) bloquea el equipo (lock task).
 * - Sin Device Owner: si alguien sale, vuelve sola al frente (permiso "Mostrar sobre otras apps").
 * - Cambiar el servidor o salir de la app: solo con la clave de salida (esquina de la pantalla › ⓘ).
 */
public class MainActivity extends Activity {

    static final String CONFIG = "file:///android_asset/config.html";
    private static final int VUELTAS = 20000;

    private WebView web;
    private FrameLayout raiz;
    private final Handler hilo = new Handler(Looper.getMainLooper());
    private boolean saliendo = false;
    private final Runnable traerAlFrente = this::volverAlFrente;

    private SharedPreferences prefs() { return getSharedPreferences("config", MODE_PRIVATE); }
    private String servidor() { return prefs().getString("servidor", ""); }
    private String direccion() { String s = servidor(); return s.isEmpty() ? CONFIG : s; }
    private boolean vigilar() { return !saliendo; }

    // ------------------------------------------------------------ clave de salida (SHA-256 con sal)
    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }
    private static String huella(String sal, String clave) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] h = (sal + ":" + clave).getBytes(StandardCharsets.UTF_8);
        for (int i = 0; i < VUELTAS; i++) h = md.digest(h);
        return hex(h);
    }
    private boolean claveOk(String clave) {
        try {
            String sal = prefs().getString("sal", ""), hash = prefs().getString("hash", "");
            return !hash.isEmpty() && clave != null && huella(sal, clave).equals(hash);
        } catch (Exception e) { return false; }
    }
    private boolean hayClave() { return !prefs().getString("hash", "").isEmpty(); }

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
        ocultarBarras();
        activarBloqueo();
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
        @JavascriptInterface public String plataforma() { return "android"; }
        @JavascriptInterface public String version() { return versionApp(); }

        /** {"servidor":"…","tieneClave":true,"bloqueoTotal":false,"botonesBloqueados":true} */
        @JavascriptInterface public String estado() {
            try {
                return new JSONObject().put("servidor", servidor()).put("tieneClave", hayClave())
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

        @JavascriptInterface public boolean verificarClave(String clave) { return claveOk(clave); }

        /** Guarda servidor y clave de salida; si ya había clave, hace falta la actual. Devuelve "" si salió bien o el motivo. */
        @JavascriptInterface public String guardar(String url, String clave, String claveActual) {
            String v = url == null ? "" : url.trim();
            if (!v.matches("^https?://[^\\s/]+(/\\S*)?$")) return "Escriba una dirección válida, por ejemplo http://192.168.1.10:3000/verificador";
            if (hayClave() && !claveOk(claveActual)) return "La clave de salida actual no es correcta.";
            if (clave == null || clave.length() < 4) return "La clave de salida debe tener al menos 4 caracteres.";
            try {
                byte[] r = new byte[12];
                new SecureRandom().nextBytes(r);
                String sal = hex(r);
                prefs().edit().putString("servidor", v).putString("sal", sal).putString("hash", huella(sal, clave)).apply();
            } catch (Exception e) { return "No se pudo guardar."; }
            hilo.post(() -> { if (web != null) web.loadUrl(direccion()); });
            return "";
        }

        /** Con la clave: olvida el servidor y vuelve a la pantalla de configuración. */
        @JavascriptInterface public boolean cambiarServidor(String clave) {
            if (!claveOk(clave)) return false;
            prefs().edit().remove("servidor").apply();
            hilo.post(() -> { if (web != null) web.loadUrl(CONFIG); });
            return true;
        }

        /** Con la clave: quita el bloqueo y cierra la app. */
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
