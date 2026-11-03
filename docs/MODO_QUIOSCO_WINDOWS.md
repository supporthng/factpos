# Modo quiosco de la caja (Windows)

La aplicación de la caja ya bloquea lo que puede por sí sola (pantalla completa, no minimiza ni cierra sin permiso de
un supervisor, pide PIN al reabrir y por inactividad). Lo que **no** puede bloquear una aplicación normal es la tecla
Windows, Alt+Tab y Ctrl+Alt+Supr: son del sistema operativo. Para bloquearlas hay que dejar la cuenta de Windows del
cajero sin escritorio.

## Opción recomendada: cuenta de cajero sin escritorio (cualquier edición de Windows 10/11)

1. Cree una cuenta de Windows **estándar** (no administradora) para la caja, por ejemplo `cajero`. Inicie sesión con
   ella una vez y cierre la sesión (así Windows crea su perfil).
2. Con su cuenta de **administrador**, abra PowerShell como administrador y ejecute (el script está en la carpeta
   `instalador` de FactPOS, junto a los demás):

       powershell -ExecutionPolicy Bypass -File modo-quiosco.ps1 -Accion Activar -Usuario cajero

3. Al iniciar sesión `cajero`, Windows abre **solo FactPOS Caja**: sin barra de tareas, sin menú Inicio, la tecla
   Windows y Alt+Tab no llevan a ningún lado, y el Administrador de tareas está desactivado.
4. Para quien administra: cierre sesión y entre con su cuenta de administrador. Para deshacerlo:

       powershell -ExecutionPolicy Bypass -File modo-quiosco.ps1 -Accion Desactivar -Usuario cajero

Notas:
- Salir de la caja con permiso de supervisor deja la pantalla vacía; luego Ctrl+Alt+Supr › Cerrar sesión.
- No lo active en la cuenta de administrador: no podría volver a ver el escritorio.
- Si la caja se instaló solo para un usuario, el script busca el programa en su perfil; si no lo encuentra, indique
  la ruta con `-Exe "C:\ruta\FactPOS-Escritorio.exe"`.
- Probado solo por revisión del código; pruébelo primero en un equipo cualquiera con una cuenta de prueba.

## Alternativa: Acceso asignado de Windows (Pro/Enterprise/Education)

Configuración › Cuentas › Otros usuarios › «Configurar un quiosco»: crea una cuenta y la limita a una aplicación.
En Windows 11 permite elegir una aplicación de escritorio; en Windows 10 solo aplicaciones de la Tienda, por lo que la
opción de arriba es la que sirve en todas las versiones.
