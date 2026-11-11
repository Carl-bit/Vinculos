# Roadmap del MVP (actualizado 2026-11-11)

Fuente unica de lo que falta. Reune la lista de 45 correcciones (2026-11-10),
la lista de 7 y las rondas siguientes (2026-11-11). El orden es la ruta
recomendada, no solo el esfuerzo. Lo que queda despues del MVP vive en
`docs/backlog_post_mvp.md`.

Estados: **Hecho**, **Parcial** (que falta), **Pendiente**, **Bloqueado**
(que lo destraba).

## Estado de los 45 puntos

| # | Tema | Estado | Nota |
|---|---|---|---|
| 1, 5, 6, 8 | Dashboard: bloques movibles, informacion rapida, proporciones | Parcial | "Esta semana" ya muestra las horas por aprobar; falta el rediseño |
| 2 | Login paciente / profesional con boton alternable | Pendiente | |
| 3 | Panel de control de accesos en Vinculos Control (sin datos de pacientes) | Pendiente | Fuera del silo |
| 4 | Atras/adelante del navegador tras el login | Pendiente | `no-store`, `history.replace`, limpiar formulario |
| 7 | Cambio de rol cuenta madre -> profesional | Hecho (sin probar en navegador) | Cubierto por 19 |
| 9 | Bloqueo por licencia (causa sin diagnostico) | Pendiente | Paciente elige cancelar, reprogramar o derivacion temporal |
| 10 | Tiempo real (bajas y pausas en calendario, portal y pagina) | Pendiente, decision | CLAUDE.md solo permite polling: decidir SSE sin Redis |
| 11, 12, 18, 19 | Eleccion de rol tras el login, roles como botones, siempre al dashboard | Hecho | |
| 13 | Baja inmediata y reubicacion | Parcial | Boton "Dar de baja ahora" hecho; la reubicacion en grupo es el 24 |
| 14 | Enter envia, Shift+Enter salto de linea | Hecho | Chat del equipo y mensaje al profesional (`Textarea enterEnvia`) |
| 15 | Quitar "Agregar profesional" en Fichas y Pacientes | Hecho | |
| 16, 37 | RUT obligatorio, unico (indice ciego) y verificador de duplicados | Pendiente | El RUT esta cifrado: no puede ser PK |
| 17 | Salida de sesion y aviso de inactividad con cuenta regresiva | Parcial | Causa (red) arreglada; falta el aviso |
| 20 | Fichas y Pacientes: la cuenta madre ve lo que debe | Pendiente | Revisar RLS y filtro |
| 21 | Botones bloqueados mientras carga el login | Hecho | Una sola peticion en vuelo en ingreso y codigo; el codigo no se reactiva tras entrar |
| 22 | Aislamiento entre silos (red privada) | Hecho | |
| 23 | Indicador de ocupacion de box | Pendiente, decision | Elegir la metrica |
| 24 | Reprogramados seleccionables en grupo y acciones rapidas | Pendiente | Completa el 13 |
| 25, 41 | Finanzas fuera del MVP | Hecho | Tablas dormidas para despues |
| 26, 29 | Match: "filtrar yo mismo" al inicio; metricas y filtro arriba | Hecho | |
| 27, 28 | Match: eliminar preguntas/opciones y generarlas solas | Pendiente | |
| 30 | Pagina del centro en pestaña nueva | Hecho | Menu "Pagina publica", perfil publico y equipo desde el panel |
| 31 | Solicitar modulos desactivados | Pendiente (en espera) | El usuario revisa antes Vinculos Control; va con el 3 |
| 32 | No repetir "activo" en los modulos | Hecho | Sale el panel de dependencias del match |
| 33 | Pacientes por reasignar solo en Fichas y Pacientes | Hecho | |
| 34 | Quitar "Hora liberada" de las notificaciones | Hecho | Sin COBROS no se muestran sus eventos en Plantillas |
| 35 | Cuantas personas por rol y sus nombres | Pendiente | |
| 36 | Roles: fijos con asignacion flexible + maximo de cuentas madre | Hecho | |
| 38 | Contactos de emergencia | Pendiente | Tabla nueva cifrada |
| 39 | Textos poco practicos en el portal | Hecho | Mensaje al profesional en positivo; revisar de nuevo con el chat (40) |
| 40, 44 | Chat profesional <-> paciente y bandeja de avisos | Pendiente (aprobado) | Dato clinico cifrado, append-only; actualizar CLAUDE.md |
| 42 | Datos en tarjeta junto a las secciones; cambios en Seguridad | Hecho | Header solo con la marca; "Mi profesional" junto al saludo; Salir terracota |
| 43 | Quitar "Equipo" del portal del paciente | Hecho | Header y primera hora; el cambio de profesional va por su tratante |
| 45 | Tablas de 10 con paginas numeradas | Parcial | Paginador compartido (`ui/Paginador`) en Fichas; falta el barrido |

Rondas del 2026-11-11 ya hechas: propuestas de hora (PROPUESTA), plazo de
24 h desde la verificacion (configurable), datos bancarios ocultos, chat del
equipo con buscador y de a 10, seleccion que se abre y cierra, baja con nuevo
supervisor y la baja cancela las propuestas.

## Ruta recomendada

1. ~~Cambios chicos en un bloque~~ (hecho 2026-11-11). Queda probar el 7 en
   el navegador.
2. **Privacidad y datos:** 20, 37 + 16, 38.
3. **Ausencias del profesional:** 9 (licencia y derivacion temporal) y 24
   (reprogramados en grupo; cierra el 13).
4. **Comunicacion:** 40 + 44 (chat con el paciente) y 17 (aviso de
   inactividad).
5. **Dashboard y tablas:** 1 + 5 + 6 + 8, barrido del 45, 35 y 23.
6. **Match y login:** 27 + 28, 2 y 4.
7. **Tiempo real (10)**, una vez decidido el mecanismo.
8. **Plataforma:** 3 + 31 en Vinculos Control.

## Despues de la lista (orden acordado)

1. Capturas contra el diseño de cada vista tocada (regla de fase).
2. `prompts/04_pruebas.md` (Docker, k6, limites del plan) antes de
   cualquier VPS.
3. SMTP real junto con el despliegue.
4. AUD-02 pendiente: rate limit y `pg_stat_statements`.
5. `docs/backlog_post_mvp.md` (finanzas, pasarela, RNPI, etc.).

## Decisiones abiertas

- **10:** SSE desde la API (un contenedor, sin Redis) o polling mas corto.
- **23:** que metrica representa la ocupacion de un box.
- **37:** RUT unico con indice ciego (HMAC) en vez de PK.
