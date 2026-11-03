# Caja bloqueada (Windows)

Mientras FactPOS Caja está abierta en pantalla completa (modo kiosko), la propia aplicación deja el equipo bloqueado para
cualquier usuario de Windows, sin instalar nada más:

- Se cierra el Explorador de Windows: no hay barra de tareas ni menú Inicio, y la tecla Windows no hace nada.
- Se desactiva el Administrador de tareas de ese usuario.
- La caja no se minimiza, no sale de pantalla completa y no se cierra sin el permiso de un supervisor.

Se desactiva solo cuando:
- la caja se cierra (con permiso de supervisor), o
- se minimiza con permiso de supervisor (vuelve a bloquearse al restaurarla), o
- la caja se actualiza.

Si la caja se cerrara a la fuerza (corte de luz, cierre desde el sistema), la próxima vez que se abra recupera el escritorio
y el Administrador de tareas. Si alguna vez la pantalla quedara vacía: Ctrl+Alt+Supr › Administrador de tareas no estará
disponible; use Ctrl+Alt+Supr › Cerrar sesión y vuelva a entrar.

Para abrir la caja sin bloqueo (por ejemplo, para pruebas), agregue `--ventana` al acceso directo.

Limitación: Ctrl+Alt+Supr y Alt+Tab son del sistema operativo y no se pueden anular desde una aplicación; con el Explorador
cerrado y el Administrador de tareas desactivado, no dan acceso a otros programas.
