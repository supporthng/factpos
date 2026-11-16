package com.factpos.vendedor;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.DhcpInfo;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * FactPOS Vendedor: la terminal de ventas (pantalla «Vender») del servidor de la tienda, en una app.
 * Busca sola el servidor en la red Wi-Fi (aviso por UDP, «factpos.local» y un barrido de la red) y abre
 * http://&lt;servidor&gt;:3000/admin/#vender. La dirección se recuerda; si cambia, se vuelve a buscar.
 */
public class MainActivity extends Activity {
    private static final int PUERTO = 3000;
    private static final int PUERTO_AVISO = 41234;
    private WebView web;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> selector;
    private boolean fallo, buscando;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("vendedor", MODE_PRIVATE);
        FrameLayout raiz = new FrameLayout(this);
        web = new WebView(this);
        raiz.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        TextView aj = new TextView(this);
        aj.setText("⚙"); aj.setTextSize(18); aj.setTextColor(Color.WHITE); aj.setGravity(Gravity.CENTER);
        aj.setBackgroundColor(0x88000000);
        int d = (int) (36 * getResources().getDisplayMetrics().density);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(d, d, Gravity.BOTTOM | Gravity.START);
        lp.setMargins(8, 0, 0, 8);
        raiz.addView(aj, lp);
        aj.setOnClickListener(v -> menu());
        setContentView(raiz);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setBuiltInZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String esq = u.getScheme() == null ? "" : u.getScheme();
                if (esq.equals("http") || esq.equals("https")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignorar) {}
                return true;
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame() && !fallo && !buscando) { fallo = true; sinConexion(); }
            }
            @Override public void onPageFinished(WebView v, String url) { fallo = false; }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (selector != null) selector.onReceiveValue(null);
                selector = cb;
                try { startActivityForResult(p.createIntent(), 7); }
                catch (Exception e) { selector = null; return false; }
                return true;
            }
        });
        web.setDownloadListener((url, ua, cd, mime, len) -> {
            try {
                DownloadManager.Request q = new DownloadManager.Request(Uri.parse(url));
                q.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                q.setMimeType(mime);
                q.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                q.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, cd, mime));
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(q);
                Toast.makeText(this, "Descargando…", Toast.LENGTH_SHORT).show();
            } catch (Exception e) { Toast.makeText(this, "No se pudo descargar", Toast.LENGTH_LONG).show(); }
        });
        conectar();
    }

    // ---------- Búsqueda del servidor ----------

    private static String normalizar(String t) {
        t = t == null ? "" : t.trim();
        if (t.isEmpty()) return null;
        if (!t.startsWith("http://") && !t.startsWith("https://")) t = "http://" + t;
        try {
            URL u = new URL(t);
            if (u.getHost() == null || u.getHost().isEmpty()) return null;
            return u.getProtocol() + "://" + u.getHost() + ":" + (u.getPort() > 0 ? u.getPort() : PUERTO);
        } catch (Exception e) { return null; }
    }

    private static String leer(String direccion, int espera) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(direccion).openConnection();
            c.setConnectTimeout(espera); c.setReadTimeout(espera);
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] buf = new byte[2048]; int n;
            while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
            return o.toString("UTF-8");
        } catch (Exception e) { return null; }
    }

    private static boolean esFactpos(String base, int espera) {
        String r = leer(base + "/descubrir", espera);
        try { return r != null && "FactPOS".equals(new JSONObject(r).optString("producto")); } catch (Exception e) { return false; }
    }

    /** Pregunta por UDP («FACTPOS?») a toda la red; el servidor contesta con sus direcciones. */
    private List<String> porAviso() {
        List<String> res = new ArrayList<>();
        try (DatagramSocket s = new DatagramSocket()) {
            s.setBroadcast(true);
            s.setSoTimeout(400);
            byte[] msg = "FACTPOS?".getBytes("UTF-8");
            List<InetAddress> destinos = new ArrayList<>();
            destinos.add(InetAddress.getByName("255.255.255.255"));
            try {
                WifiManager w = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                DhcpInfo di = w.getDhcpInfo();
                int bc = (di.ipAddress & di.netmask) | ~di.netmask;
                destinos.add(InetAddress.getByAddress(new byte[] { (byte) bc, (byte) (bc >> 8), (byte) (bc >> 16), (byte) (bc >> 24) }));
            } catch (Exception ignorar) {}
            for (InetAddress a : destinos) { try { s.send(new DatagramPacket(msg, msg.length, a, PUERTO_AVISO)); } catch (Exception ignorar) {} }
            long fin = System.currentTimeMillis() + 2000;
            byte[] buf = new byte[8192];
            while (System.currentTimeMillis() < fin) {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try { s.receive(p); } catch (SocketTimeoutException t) { continue; }
                try {
                    JSONObject j = new JSONObject(new String(p.getData(), 0, p.getLength(), "UTF-8"));
                    if (!"FactPOS".equals(j.optString("producto"))) continue;
                    JSONArray ds = j.optJSONArray("direcciones");
                    if (ds != null) for (int i = 0; i < ds.length(); i++) res.add(ds.getString(i));
                    else res.add("http://" + p.getAddress().getHostAddress() + ":" + j.optInt("puerto", PUERTO));
                } catch (Exception ignorar) {}
            }
        } catch (Exception ignorar) {}
        return res;
    }

    /** Último recurso: prueba el puerto 3000 de las 254 direcciones de la red Wi-Fi. */
    private String barrido() {
        try {
            WifiManager w = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            int ip = w.getDhcpInfo().ipAddress;
            if (ip == 0) return null;
            String prefijo = (ip & 0xff) + "." + ((ip >> 8) & 0xff) + "." + ((ip >> 16) & 0xff);
            ExecutorService ex = Executors.newFixedThreadPool(48);
            List<Future<String>> fs = new ArrayList<>();
            for (int n = 1; n < 255; n++) {
                final String base = "http://" + prefijo + "." + n + ":" + PUERTO;
                fs.add(ex.submit((Callable<String>) () -> esFactpos(base, 800) ? base : null));
            }
            String hallado = null;
            for (Future<String> f : fs) { String r = f.get(); if (r != null && hallado == null) hallado = r; }
            ex.shutdownNow();
            return hallado;
        } catch (Exception e) { return null; }
    }

    private String encontrarServidor() {
        String guardada = prefs.getString("servidor", null);
        if (guardada != null && esFactpos(guardada, 1500)) return guardada;
        for (String d : porAviso()) { String b = normalizar(d); if (b != null && esFactpos(b, 1500)) return b; }
        String local = "http://factpos.local:" + PUERTO;
        if (esFactpos(local, 2500)) return local;
        return barrido();
    }

    private void conectar() {
        buscando = true;
        web.loadData("<body style='margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0E1B26;color:#fff;font:600 22px sans-serif'>FactPOS Vendedor<div style='font:400 14px sans-serif;opacity:.75;margin-top:8px'>Buscando el servidor de la tienda…</div></body>", "text/html; charset=utf-8", "UTF-8");
        new Thread(() -> {
            String base = encontrarServidor();
            runOnUiThread(() -> {
                buscando = false;
                if (base != null) {
                    prefs.edit().putString("servidor", base).apply();
                    fallo = false;
                    web.loadUrl(base + "/admin/#vender");
                } else pedirDireccion("No encontramos el servidor de la tienda en esta red. Revisa que el celular o la tableta estén en el mismo Wi-Fi que el servidor y que este esté encendido. Si conoces su dirección, escríbela (por ejemplo 192.168.1.10).");
            });
        }).start();
    }

    private void pedirDireccion(String mensaje) {
        EditText t = new EditText(this);
        t.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        t.setHint("192.168.1.10");
        String g = prefs.getString("servidor", "");
        t.setText(g.replace("http://", ""));
        new AlertDialog.Builder(this).setTitle("Servidor de la tienda").setMessage(mensaje).setView(t).setCancelable(false)
            .setPositiveButton("Conectar", (x, y) -> {
                String b = normalizar(t.getText().toString());
                if (b == null) { pedirDireccion("Escribe la dirección del servidor."); return; }
                buscando = true;
                new Thread(() -> {
                    boolean ok = esFactpos(b, 3000);
                    runOnUiThread(() -> {
                        buscando = false;
                        if (ok) { prefs.edit().putString("servidor", b).apply(); web.loadUrl(b + "/admin/#vender"); }
                        else pedirDireccion("No hay un servidor FactPOS en esa dirección.");
                    });
                }).start();
            })
            .setNeutralButton("Buscar otra vez", (x, y) -> conectar()).show();
    }

    private void sinConexion() {
        new AlertDialog.Builder(this).setTitle("No se pudo conectar")
            .setMessage("El servidor de la tienda no responde. Revisa el Wi-Fi y que el servidor esté encendido.")
            .setPositiveButton("Buscar otra vez", (x, y) -> conectar())
            .setNeutralButton("Escribir dirección", (x, y) -> pedirDireccion("Escribe la dirección del servidor (por ejemplo 192.168.1.10)."))
            .setNegativeButton("Cerrar", (x, y) -> fallo = false).show();
    }

    private void menu() {
        new AlertDialog.Builder(this).setItems(new String[] { "Recargar", "Buscar el servidor otra vez", "Escribir dirección del servidor" }, (x, i) -> {
            if (i == 0) web.reload(); else if (i == 1) conectar(); else pedirDireccion("Escribe la dirección del servidor (por ejemplo 192.168.1.10).");
        }).show();
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == 7 && selector != null) {
            selector.onReceiveValue(res == RESULT_OK && data != null ? new Uri[] { data.getData() } : null);
            selector = null;
        } else super.onActivityResult(req, res, data);
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
