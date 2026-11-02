package com.factpos.verificador;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

/**
 * Resultado de la instalación de una actualización descargada por la propia app.
 * Si Android pide confirmación (equipo sin Device Owner), abre la pantalla de confirmación del sistema.
 * Al terminar, BootReceiver (MY_PACKAGE_REPLACED) vuelve a abrir el verificador.
 */
public class InstalacionReceiver extends BroadcastReceiver {
    @SuppressWarnings("deprecation")
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        int estado = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1);
        if (estado == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmar = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmar != null) {
                confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { context.startActivity(confirmar); } catch (RuntimeException e) { /* sin pantalla disponible */ }
            }
        }
    }
}
