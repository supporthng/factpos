package com.factpos.admin;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
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

/**
 * FactPOS Admin: la administración de FactPOS en una app, para usarla desde fuera de la oficina.
 * Abre https://factpos.app/<empresa>/ (el portal localiza el servidor de la empresa por su túnel) o la
 * dirección completa que se le indique. La sesión (usuario y clave) la guarda la propia web.
 */
public class MainActivity extends Activity {
    private static final String PORTAL = "https://factpos.app/";
    private WebView web;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> selector;
    private boolean fallo;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        prefs = getSharedPreferences("admin", MODE_PRIVATE);
        FrameLayout raiz = new FrameLayout(this);
        web = new WebView(this);
        raiz.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Botón pequeño de ajustes (recargar / cambiar de empresa), abajo a la izquierda
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
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String esq = u.getScheme() == null ? "" : u.getScheme();
                if (esq.equals("http") || esq.equals("https")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignorar) {}
                return true;
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame() && !fallo) { fallo = true; sinConexion(); }
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
        recibirEnlace(getIntent());
        abrir();
    }

    /** Enlace factpos-admin://conectar/<empresa>: deja la empresa configurada sin escribirla. */
    private void recibirEnlace(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u == null || !"factpos-admin".equals(u.getScheme())) return;
        String e = u.getLastPathSegment();
        if (e != null && (e.matches("[a-z0-9.-]{2,60}") || e.toUpperCase().matches("FP-?[2-9A-HJKMNP-Z]{6}"))) prefs.edit().putString("empresa", e).apply();
    }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        recibirEnlace(i);
        abrir();
    }

    /** Dirección guardada: nombre corto de la empresa o dirección completa. */
    private String direccion() {
        String e = prefs.getString("empresa", "").trim();
        if (e.isEmpty()) return null;
        // Código de conexión corto (FP-K7M4QX), con o sin guion y en mayúsculas o minúsculas
        String codigo = e.toUpperCase().replaceAll("\\s", "");
        if (codigo.matches("FP-?[2-9A-HJKMNP-Z]{6}")) return PORTAL + "c/FP-" + codigo.substring(codigo.length() - 6);
        if (e.startsWith("http://") || e.startsWith("https://")) return e;
        if (e.contains(".")) return "https://" + e;
        return PORTAL + e + "/";
    }

    private void abrir() {
        String u = direccion();
        if (u == null) { pedirEmpresa(false); return; }
        fallo = false;
        web.loadUrl(u);
    }

    private void pedirEmpresa(boolean cancelable) {
        EditText t = new EditText(this);
        t.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        t.setHint("FP-XXXXXX");
        t.setText(prefs.getString("empresa", ""));
        AlertDialog.Builder a = new AlertDialog.Builder(this)
            .setTitle("¿A qué empresa te conectas?")
            .setMessage("Escribe el código de conexión de tu empresa (por ejemplo FP-K7M4QX); lo encuentras en Sistema › Acceso remoto. También sirve el nombre corto (factpos.app/nombre) o la dirección completa.")
            .setView(t).setCancelable(cancelable)
            .setPositiveButton("Conectar", (x, y) -> {
                String v = t.getText().toString().trim().toLowerCase().replace(" ", "");
                if (v.isEmpty()) { pedirEmpresa(cancelable); return; }
                prefs.edit().putString("empresa", v).apply();
                abrir();
            });
        if (cancelable) a.setNegativeButton("Cancelar", null);
        a.show();
    }

    private void sinConexion() {
        new AlertDialog.Builder(this).setTitle("No se pudo conectar")
            .setMessage("Revisa tu internet. Si el servidor de la oficina está apagado o sin internet, la administración no responde.")
            .setPositiveButton("Reintentar", (x, y) -> abrir())
            .setNeutralButton("Cambiar empresa", (x, y) -> pedirEmpresa(true))
            .setNegativeButton("Cerrar", (x, y) -> fallo = false).show();
    }

    private void menu() {
        new AlertDialog.Builder(this).setItems(new String[] { "Recargar", "Cambiar de empresa" }, (x, i) -> {
            if (i == 0) web.reload(); else pedirEmpresa(true);
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
