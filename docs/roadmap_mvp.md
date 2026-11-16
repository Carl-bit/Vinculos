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
| 1, 5, 6, 8 | Dashboard | Hecho | Dos columnas desde arriba (pendientes a la altura de la sesion); bloques con arrastrar y soltar o flechas, por persona; informacion rapida de a 3 con flechas |
| 2 | Login paciente / profesional con boton alternable | Hecho | Solo el boton del header alterna "Ingresar como profesional" / "como paciente" (se quito el selector de la tarjeta); primer ingreso: pacientes |
| 3 | Panel de control de accesos en Vinculos Control (sin datos de pacientes) | Pendiente | Fuera del silo |
| 4 | Atras/adelante del navegador tras el login | Hecho | Cache-Control no-store en /admin, /portal e /ingreso; recarga al restaurar desde bfcache; la clave se borra al pedir el codigo |
| 7 | Cambio de rol cuenta madre -> profesional | Hecho (sin probar en navegador) | Cubierto por 19 |
| 9 | Ausencias del profesional | Hecho | Bloqueo con causa reprograma y avisa; "no atendera mas"; el paciente elige otra hora, cancelar o atencion temporal; en la siguiente asignacion se pregunta si el principal esta disponible (si lo esta se indica y se ofrece volver con una derivacion; si no, sigue con el actual) |
| 10 | Tiempo real (bajas y pausas en calendario, portal y pagina) | Hecho | Polling (2026-11-12, sin SSE ni websockets): toda consulta visible se repide cada 30 s (agenda, citas, horas libres, estado del tratante y chat cada 15 s; catalogos cada 2 min); al volver a la pestaña; y cualquier accion recarga en cadena todo lo que esta en pantalla. Sitio publico: router.refresh cada 60 s. Solo con la pestaña visible |
| 11, 12, 18, 19 | Eleccion de rol tras el login, roles como botones, siempre al dashboard | Hecho | |
| 13 | Baja inmediata y reubicacion | Hecho | Baja "ahora" o al final del dia; reubicacion en grupo desde Derivaciones y aviso en lote en Agenda |
| 14 | Enter envia, Shift+Enter salto de linea | Hecho | Chat del equipo y mensaje al profesional (`Textarea enterEnvia`) |
| 15 | Quitar "Agregar profesional" en Fichas y Pacientes | Hecho | |
| 16, 37 | RUT obligatorio, unico (indice ciego) y verificador de duplicados | Hecho | Indice ciego `pacientes.rut_hmac` UNIQUE (ya existia); RUT obligatorio en el alta del equipo y en la reserva publica; el alta avisa si el RUT ya existe. Los pacientes antiguos sin RUT siguen en el filtro "Sin RUT" |
| 17 | Salida de sesion y aviso de inactividad con cuenta regresiva | Hecho | Causa (red) arreglada; aviso 2 minutos antes con "Seguir conectado" / "Cerrar sesion" en panel y portal |
| 20 | La cuenta madre no ve pacientes | Hecho | Sin pestaña Pacientes ni perfil del paciente para ADMIN; solo nombres en Seguimiento y reasignacion de oficio sin abrir el perfil |
| 21 | Botones bloqueados mientras carga el login | Hecho | Una sola peticion en vuelo en ingreso y codigo; el codigo no se reactiva tras entrar |
| 22 | Aislamiento entre silos (red privada) | Hecho | |
| 23 | Indicador de boxes | Hecho | Horas libres (no porcentaje): en el dashboard las de hoy y en cada box las de la semana |
| 24 | Seleccion multiple y acciones rapidas | Hecho | Por reprogramar (avisar, cancelar) y pacientes por reasignar (derivar en grupo); componente `ui/Seleccion` |
| 25, 41 | Finanzas fuera del MVP | Hecho | Tablas dormidas para despues |
| 26, 29 | Match: "filtrar yo mismo" al inicio; metricas y filtro arriba | Hecho | |
| 27, 28 | Match: eliminar preguntas y opciones; crear con opciones | Hecho | Propias se eliminan (sistema se apaga). Editor visual por tipo (2026-11-12): alternativas con orden, prioridad y filtro; escala con plantillas; dias del centro; franjas editables dentro del horario; plantillas Si/No y Modalidad |
| 30 | Pagina del centro en pestaña nueva | Hecho | Menu "Pagina publica", perfil publico y equipo desde el panel |
| 31 | Solicitar modulos desactivados | Hecho (2026-11-13) | Configuracion > Modulos: el ADMIN solicita activar o desactivar; Vinculos Control lo recoge por `/api/internal/solicitudes` (R2), lo aplica con `/api/internal/config` (R4, job RECONFIGURAR) y responde (R3) |
| 32 | No repetir "activo" en los modulos | Hecho | Sale el panel de dependencias del match |
| 33 | Pacientes por reasignar solo en Fichas y Pacientes | Hecho | |
| 34 | Quitar "Hora liberada" de las notificaciones | Hecho | Sin COBROS no se muestran sus eventos en Plantillas |
| 35, 36 | Roles: quienes estan, asignacion rapida y perfiles | Hecho | Configuracion > Roles: cantidad, nombres, agregar/quitar roles y perfiles (crear, editar, eliminar, asignar) sobre un rol base que solo restringen secciones. Permisos a medida: post-MVP |
| 36 | Roles: fijos con asignacion flexible + maximo de cuentas madre | Hecho | |
| 38 | Contactos de emergencia | Hecho | Los agrega el paciente (varios, no obligatorio); el tratante ve existencia y parentesco, abre los datos solo en emergencia (auditado) y puede pedir que agregue uno |
| 39 | Textos poco practicos en el portal | Hecho | Mensaje al profesional en positivo; revisar de nuevo con el chat (40) |
| 40, 44 | Chat profesional <-> paciente y bandeja de avisos | Hecho | El tratante responde en la plataforma (conversaciones por paciente); el portal tiene "Mensajes" (chat + configuracion) y los ultimos avisos en el inicio (todos en un popup) |
| 42 | Datos en tarjeta junto a las secciones; cambios en Seguridad | Hecho | Header solo con la marca; "Mi profesional" junto al saludo; Salir terracota |
| 43 | Quitar "Equipo" del portal del paciente | Hecho | Header y primera hora; el cambio de profesional va por su tratante |
| 45 | Tablas de 10 con paginas numeradas | Parcial | `ui/Paginador` + `ListaPaginada` en seguimiento, reasignar, por reprogramar, mensajes, alertas, bajas, avisos del equipo y derivaciones; faltan listas menores |

Rondas del 2026-11-11 ya hechas: propuestas de hora (PROPUESTA), plazo de
24 h desde la verificacion (configurable), datos bancarios ocultos, chat del
equipo con buscador y de a 10, seleccion que se abre y cierra, baja con nuevo
supervisor y la baja cancela las propuestas.

## Ruta recomendada

1. ~~Cambios chicos en un bloque~~ (hecho 2026-11-11). Queda probar el 7 en
   el navegador.
2. ~~Privacidad y datos: 20, 37 + 16, 38~~ (hecho 2026-11-11).
3. ~~Ausencias del profesional: 9 y 24~~ (hecho 2026-11-11).
4. ~~Comunicacion: 40 + 44 y 17~~ (hecho 2026-11-11).
5. ~~Dashboard y tablas: 1 + 5 + 6 + 8, 45, 35 y 23~~ (hecho 2026-11-11; quedan listas menores del 45 y la decision del 36).
6. ~~Match y login: 27 + 28, 2 y 4~~ (hecho 2026-11-12).
7. ~~Tiempo real (10)~~ (hecho 2026-11-12, polling).
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

## Front sin cobros ni finanzas (2026-11-14)

Pedido del usuario: el MVP no implementa cobros. Se quito del front toda
conexion con COBROS (las tablas y funciones del backend siguen dormidas,
decision 2026-11-11). Las tarifas de los profesionales se mantienen como dato
informativo (perfil, match, solicitud de hora), igual que la boleta reembolsable.

- Borrados: paginas `/admin/cobros`, `/portal/pagos`, `/pagar`;
  `components/cobros/*`, `MediosPagoCentro`, `CobrosPaciente`, `PasoPago`,
  `PagoCitaPortal`, `lib/cobros.ts`, `lib/pagos.ts`, `lib/tributario.ts`.
- `lib/reserva.ts` reemplaza a `lib/pagos.ts` para el sondeo del estado de la
  reserva; pedir hora queda en 3 pasos (horario, datos, solicitud) sin paso de pago.
- Fuera: menu Cobros y Pagos, seccion Finanzas de Configuracion (cobros,
  acuerdos, medios de pago, comisiones, cargos, morosidad, parametros
  tributarios), "Dinero" de Mi cuenta (queda solo el RUT), datos bancarios,
  "Cobro directo", "Origen del paciente" (comision), bloqueo por deuda al
  agendar, cobrar en caja, pestaña "Pago pendiente", "No asistio" (venia de
  Cobros), pendientes de pagos/transferencias/deudas del inicio, plantillas de
  pago, avisos de pago del portal, cargos en las condiciones de agendamiento.
- El aviso minimo para cancelar pasa a "Reservas y recordatorios" (lo exige el
  CHECK con el recordatorio).
- Calendario: las horas SOLICITADA/PROPUESTA se mostraban como "Pendiente de
  pago" / "PAGO"; ahora "Por confirmar" / "POR CONF.". "Liberada (pago
  vencido)" pasa a "Liberada (plazo vencido)".
- Pruebas: vitest 142/142, typecheck y lint limpios. E2E: se quitaron los
  casos de cobros y las rutas borradas.

**Hecho 2026-11-16:** los e2e de pedir hora (`publico.spec.ts`, `portal.spec.ts`,
`apoyo.ts`) siguen el flujo sin cobros: verificar correo -> SOLICITADA ->
aprueba el profesional (`aprobarHora`) -> CONFIRMADA. Pasan los 6 de pedir hora
sin cuenta y el del portal. `E2E_NAVEGADOR=chrome` usa el navegador del equipo.

## MVP sin pagos ni finanzas: eliminacion completa (2026-11-16)

Decision del usuario: nada de pagos ni finanzas en el MVP (reemplaza la de
2026-11-11, que dejaba el backend dormido). Se quedan como dato informativo
las tarifas, FONASA y la boleta reembolsable.

- BD: migracion `20261116000000_mvp_sin_cobros`. Fuera las tablas pagos,
  transferencias, cobros_pasarela, comprobantes_pago, documentos_tributarios,
  liquidaciones, acuerdos_profesional, cuenta_bancaria_centro,
  excepciones_morosidad, arriendos y resoluciones_cita; la vista
  estado_pago_citas; 85 funciones; 14 tipos; las columnas de cobros de
  configuracion_centro, citas (monto, medios, avisos de pago,
  agendada_por_equipo), profesionales (cobro_directo), profesional_datos_privados
  (cuenta bancaria), pacientes (traido_por_centro) y preferencias_aviso_equipo;
  los valores PENDIENTE_PAGO, COBROS, PAGO_CITA y los avisos de pago (los enums
  se recrean con funciones y permisos). `pago_vence_en` pasa a
  `retencion_vence_en`. Lo que no era de cobros en los triggers que salieron
  queda en `fijar_cancelada_en` y `proteger_estado_cita`. Las funciones
  compartidas se reescriben (reserva sin cuenta siempre con correo, portal
  SOLICITADA, recordatorio sin penalizacion, exportacion, tablero, R4 sin
  reglas de cobros). Verificado: `seguridad_bd.sql` TODOS LOS CASOS OK,
  `migrate diff` vacio, registro de cifrado = columnas bytea (49).
- Backend: sin modulo cobros, pasarela, endpoints de pago, jobs de avisos de
  pago y deudas, comision ni origen del paciente. El estado de la reserva
  (`POST /publico/reservas/estado`) pasa a match. 88 unitarios; e2e 225 de 226
  (`roles-flexibles` falla solo en la corrida completa: cuenta las cuentas
  ADMIN que dejan las otras suites y pasa de 10; pasa sola, no es de cobros).
- Front: sin estado PENDIENTE_PAGO, cobro directo, origen del paciente ni
  penalizacion en el recordatorio. Vitest 142/142, lint limpio.
- Seed demo: sin pagos, acuerdos, comisiones ni moroso (Rodrigo queda como
  paciente online, `rodrigo@`).
- Llave FINANCIERO retirada (decision del usuario, mismo dia): migraciones
  `20261116000100_evento_retiro_categoria` (evento RETIRO_CATEGORIA en la
  bitacora de llaves) y `20261116000200_sin_llave_financiero`. La migracion
  comprueba en la BD que ninguna columna bytea tenga datos con la cabecera de
  una DEK FINANCIERO (si hay, falla sin cambios), borra sus DEK, deja el evento
  y recrea `categoria_llave` (IDENTIFICACION, CLINICO, HMAC). KEK y partes
  Shamir sin cambios. Codigo y scripts (`cifrado.ts`, `cli-llaves.ts`,
  `rotar.sh`) con 3 categorias. Verificado: suite de BD OK, copia de la BD de
  desarrollo migrada y llavero cargado con su KEK, aprovisionar, rotar en dos
  fases y recuperar con 2 de 3 partes.
- Playwright al dia con la UI: el ingreso elige el rol en cuentas con mas de
  uno ("¿Con qué rol entras?"), los datos del paciente estan en Mis datos y
  seguridad, el selector de cuenta es el propio y el contacto de emergencia es
  su seccion; el match se omite si el centro lo tiene apagado.
- R14 hecho: `respaldar.sh` no respalda con la db detenida (sale con 3, sin
  archivo ni rotacion), falla si pg_dump falla o el cifrado pesa menos de
  `RESPALDO_MINIMO` (1024) y rota solo tras un respaldo bueno. Probado con un
  docker simulado (detenida, pg_dump con error, volcado de 32 bytes, bueno).

## Recuperacion de contraseña y enlace de acceso sin revelar cuentas (2026-11-15)

Problema reportado: al pedir recuperar la contraseña con un correo que no
tiene cuenta, la pantalla decia que se envio el enlace pero no llegaba nada.
Se decidio **no** mostrar "el correo no existe" (revelaria que una persona es
paciente o equipo del centro: dato sensible, Ley 21.719, y permitiria
enumerar cuentas). En su lugar:

- **Siempre sale un correo.** Con cuenta: el enlace de siempre. Sin cuenta:
  un aviso sin enlace ("no hay ninguna cuenta del centro asociada a esta
  direccion; si fuiste tu, prueba con otro correo o consulta con el centro").
  Solo lo lee quien controla la casilla. En el enlace de acceso, el aviso
  dice que no hay una cuenta de paciente (el equipo entra con contraseña).
  Textos en `AVISO_SIN_CUENTA` (`core/auth/auth.service.ts`).
- **Mismo tiempo de respuesta.** `POST /auth/recuperacion` y
  `/auth/enlace-acceso` tardan siempre `CUENTA_RESPUESTA_MS` (1200 por
  defecto); la consulta y el correo corren en segundo plano. Antes, con
  cuenta la respuesta esperaba el envio del correo y tardaba mas: el tiempo
  revelaba si el correo existia.
- **Tope por direccion:** 3 correos por hora por direccion, exista o no la
  cuenta (`LimitePorCorreo`, en memoria, solo el sha256 de la direccion),
  ademas del limite por IP del throttler `login`. La respuesta no cambia al
  pasar el tope.
- **Front** (`PedirEnlaceCorreo`): el boton sigue bloqueado mientras la API
  responde (ahora ~1,2 s); el resultado dice que se envio un correo, que trae
  el enlace si la direccion tiene cuenta o explica que hacer si no, y ofrece
  "Probar con otro correo".
- Pruebas: unitarias de `LimitePorCorreo`; e2e en `03a-alineacion` (tiempo
  parejo, aviso sin enlace, tope de 3 por hora) y ajuste de `03a2` (el
  correo sale en segundo plano).
