# Estandar de actualizacion (polling)

Regla del proyecto (CLAUDE.md): sin websockets ni Redis. Lo "en vivo" se
resuelve con polling y, en la agenda, con soft-lock con TTL. SSE queda como
mejora futura y no cambia este estandar (la UI solo cambiaria la fuente).

## Intervalos

| Pantalla | Endpoint | Intervalo | Notas |
|---|---|---|---|
| Hilo interno abierto | `GET /hilos/:id/mensajes` | 10 s | Cada lectura registra la lectura propia y, en hilos CASO, se audita: no bajar de 10 s. |
| Lista de hilos (no leidos) | `GET /hilos` | 30 s | El contador `noLeidos` viene en cada hilo. |
| Bandeja de avisos (campana) | `GET /notificaciones/bandeja` | 60 s | Equipo y portal del paciente. |
| Reserva de hora (agenda abierta) | `GET /profesionales/:id/huecos` (y `GET /espacios/ocupacion` si es presencial) | 15 s | Solo mientras el selector de horario esta visible. |
| Soft-lock de un horario elegido | `POST /agenda/horarios-tomados` | una vez al elegir | Dura `BLOQUEO_TEMPORAL_TTL_SEGUNDOS` (300 s). Mostrar cuenta regresiva; al vencer, volver a elegir. |
| Portal: mis citas | `GET /portal/citas` | al abrir + 120 s | |
| Dashboard | `GET /reportes/dashboard` | 5 min | Agregados; no necesita mas. |
| Resto de pantallas | — | sin polling | Recargar al entrar o tras una accion propia. |

## Reglas comunes

1. **Pestaña oculta = sin polling** (`document.visibilityState === 'hidden'`);
   al volver, una consulta inmediata y se retoma el intervalo.
2. **Un solo temporizador por recurso y pestaña**; se cancela al salir de la
   pantalla.
3. **Errores**: 429 o 5xx duplican el intervalo (tope 5 min) hasta la
   siguiente respuesta correcta; 401 detiene el polling y pasa por el refresh
   del token (si falla, al login); 403/404 detienen el polling de ese recurso
   (por ejemplo, se perdio el acceso a un hilo CASO).
4. **La fuente de verdad es la BD**: al confirmar una reserva, un 409 (EXCLUDE)
   significa que el horario se tomo; refrescar los horarios y avisar. El
   soft-lock solo evita choques en pantalla.
5. **Nunca polling en rutas publicas sin sesion** (portal publico y match):
   comparten el rate limit `PUBLICO_LIMITE_POR_MINUTO` por IP.

## Mejoras posibles (no implementadas)

- Consulta incremental (`?desde=<fecha>`) en hilos y bandeja para bajar el
  volumen de cada consulta.
- SSE para hilos y bandeja, con el polling como respaldo.
