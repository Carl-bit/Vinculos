# Requisitos de la BD para 02_apis

Lo que la API (prompts 02a-02h, ver `prompts/00_index.md`) debe respetar para
no romper lo que la BD ya garantiza. Consolidado hasta 01g (cierre de la fase
de BD: `docs/bd/estado_fase_bd.md`). Permisos por rol: `matriz_permisos.md`.
Cifrado: `cifrado.md`. Operacion de llaves: `runbooks_llaves.md`.
Consentimiento y supervision: `consentimiento.md`. Retencion: `retencion_datos.md`.

## 1. Contexto y transaccion (RlsInterceptor)

- Toda request autenticada corre en una transaccion Prisma interactiva que
  empieza con:
  `SELECT set_config('app.current_usuario_id', $1, true), set_config('app.current_rol', $2, true)`
  (parametrizado, nunca interpolado). `app.current_usuario_id` = `usuarios.id`
  del actor, para cualquier rol, incluido PACIENTE.
- Nunca Prisma fuera de esa transaccion para tablas de la app: sin contexto
  todo devuelve 0 filas (falla cerrado).
- El rol del JWT debe coincidir con `usuarios.rol`; si no, `acceso_vigente()`
  da false y todo devuelve 0 filas. Tras cambiar rol/activo/expiracion de un
  usuario, invalidar sus sesiones.
- Sin contexto solo se llaman: `credenciales_login(email)`, `perfiles_publicos()`,
  `disponibilidad_publica(...)` (portal publico), `feed_calendario(token_hash)`
  (feed iCal, 02h: el token de la URL autoriza), `consultar_recordatorio` y
  `responder_recordatorio` (02i: el token del recordatorio autoriza, un solo
  uso), `llaves_vigentes()` y `registrar_evento_llaves(...)` (CryptoModule) y
  los jobs (seccion 8). Las funciones de job de 02i rechazan una llamada con
  contexto de usuario (42501).
- Mensajes (02i): la API nunca inserta en `notificaciones`; llama a
  `notificar(tipo, paciente, usuario, referencia)` con el contexto del actor
  (despues del COMMIT de la accion). La BD crea una fila BANDEJA siempre y una
  CORREO si la plantilla esta activa y las preferencias del paciente lo
  permiten (los avisos legales no se desactivan).

## 2. Errores de Postgres -> HTTP (filtro global)

| SQLSTATE | Significado | HTTP |
|---|---|---|
| 23P01 | EXCLUDE (choque de cita o de supervision) | 409 |
| 23505 | unico (derivacion abierta, segunda baja, RUT duplicado via `rut_hmac`, solicitud de consentimiento abierta) | 409 |
| 55000 | el estado no permite la accion | 409 |
| 23001 | append-only / sin DELETE / cuenta cerrada (trigger) | 409 |
| 23514 | regla de negocio (CHECK / trigger con `CONSTRAINT`) | 422 |
| 42501 | sin privilegio o politica RLS | 403, o 404 si revelaria existencia |
| P0002 | no existe | 404 |

Usar el nombre de constraint para el mensaje (`citas_dentro_de_disponibilidad`,
`citas_fuera_de_bloqueos`, `profesionales_publicar_requiere_tarifa`,
`consentimientos_menor_requiere_adulto_responsable`, `usuarios_sin_reactivacion`,
02h: `pagos_sin_sobrepago`, `envios_documento_adjunto_solicitado`,
`resoluciones_cita_coherente`, `liquidaciones_sin_solape`, 02i:
`plantillas_mensaje_variables_permitidas`, `tipos_documento_clinico_plantilla_valida`, ...).

Fuera de la BD (02i): cuerpo JSON sobre 1 MB -> 413 (los archivos van por
multipart); adjunto sobre `ADJUNTO_MAX_MB` -> 413; tipo de archivo que no es
PDF, PNG ni JPEG por su contenido (magic bytes) -> 422 `adjuntos_ficha_tipo`;
token de recordatorio usado o vencido -> 409.

**Trigger diferido**: `pacientes_practicante_requiere_consentimiento` se
evalua al COMMIT: el filtro debe capturar errores del `$transaction` completo.

## 3. CryptoModule (cifrado de aplicacion)

Base: `backend/src/common/crypto/cifrado.ts` (`Llavero`). Modulo Nest global
que se inicializa antes que cualquier otro que toque datos:

- **KEK desde archivo**: `KEK_PATH` (Docker secret `/run/secrets/vinculos_kek`;
  en desarrollo `../infra/secrets/dev/kek`). Nunca desde una variable con la
  llave. Si el archivo falta o no mide 32 bytes: la API no arranca.
- **Carga y verificacion**: `SELECT ... FROM llaves_vigentes()` (sin contexto)
  -> `Llavero.cargar(kek, filas)`. Lanza (y la API no arranca) si la huella de
  la KEK no coincide con `huella_kek`, si un canario no verifica o si falta
  una DEK activa por categoria. Registrar el resultado con
  `registrar_evento_llaves('VERIFICACION' | 'FALLO_CANARIO', detalle)`.
- **Falla cerrado**: sin llavero no hay API. Nunca un modo "sin cifrado".
- **Job diario de canarios**: recarga `llaves_vigentes()` y verifica todos los
  canarios con la KEK montada; registra VERIFICACION o FALLO_CANARIO y alerta
  si falla. No rota ni genera nada (las llaves solo las generan los scripts).
- `RECUPERACION_PUBLICA_PATH`: la publica de recuperacion queda en la config
  del servicio; la API solo verifica que exista (no genera DEKs).
- Reiniciar la API despues de `rotar.sh activar`, `rotar.sh kek` o `recuperar.sh`.

### Extension de Prisma y SQL crudo

- Una extension de Prisma (`$extends` sobre el cliente que usa el
  RlsInterceptor) cifra al escribir y descifra al leer **solo** los campos de
  `CAMPOS_CIFRADOS` (`registro.ts`), con AAD `aad(tabla, columna, id)`.
  Ningun otro lugar cifra a mano campos del registro.
- Funciones que devuelven columnas cifradas (`oferta_derivacion`,
  `derivaciones_pendientes`, `supervision_evoluciones`, `directorio_interno`,
  `datos_pago_profesional`, `notificaciones_por_enviar`, `feed_calendario`)
  pasan por `$queryRaw`: la extension no las ve. El
  service descifra a mano con el AAD de la fila de origen
  (`derivaciones:motivo:<derivacion_id>`, `evoluciones:notas:<evolucion_id>`,
  `usuarios:telefono:<id>`, `profesional_datos_privados:banco:<profesional_id>`).
- `crear_derivacion(p_id, ...)` recibe motivo/detalle ya cifrados con el
  `p_id` que genero la API.
- Busqueda por RUT: `where: { rutHmac: llavero.hmacRut(rut) }`; nunca por el
  cifrado. El HMAC se calcula sobre el RUT normalizado (`normalizarRut`).
- El runner de tests falla si `registro.ts` y las columnas bytea de la BD no
  coinciden: una columna cifrada nueva va en la migracion **y** en el registro.

### Ids generados en la API

Filas con columnas cifradas no tienen DEFAULT de id (el id es parte del AAD):
`usuarios`, `pacientes`, `adultos_responsables`, `evoluciones`,
`supervision_comentarios`, `derivaciones`, `boletas`, `documentos_clinicos`,
`envios_documento` (02h). La API genera
`randomUUID()` antes de cifrar y lo pasa en el `create`. Prisma lo exige por
tipo (el campo `id` no es opcional).

### Validaciones movidas a DTOs

La BD ya no puede validar formato de lo cifrado (solo largo minimo). En los
DTOs (`class-validator`), antes de cifrar:
- RUT: formato y digito verificador (modulo 11); se normaliza con
  `normalizarRut` para el HMAC.
- Telefono: formato chileno (+56).
- Datos bancarios: banco de una lista, tipo de cuenta enum, numero numerico.
- Texto clinico (notas, motivo, detalle, comentarios): no vacio, largo maximo.
- Motivo de derivacion: no vacio (antes era un CHECK de la BD).

### Redaccion de logs

- Nunca loguear valores de campos de `CAMPOS_CIFRADOS` (ni cifrados ni en
  claro), RUT, `rutHmac`, la KEK, DEKs, partes ni `password_hash`.
- Interceptor/serializador del logger de Nest que reemplaza esos campos por
  `[redactado]` en bodies, DTOs y errores de Prisma (que pueden incluir los
  valores del `create`).
- Errores de `ErrorCifrado` se loguean sin el dato y responden 500 generico.

## 4. Directorio y nombres de otros usuarios

- La API **nunca** usa `include`/`select` de Prisma sobre relaciones a
  `Usuario`/`Profesional` para mostrar nombres de otros usuarios (la RLS los
  oculta). Nombres ajenos salen solo de `directorio_interno()` (telefono
  cifrado, solo para ADMIN/GESTION), `mi_equipo_tratante()` y
  `perfiles_publicos()`.
- Una cuenta cerrada tiene `nombre` nulo: la UI muestra "Profesional (cuenta
  cerrada)"; el nombre historico esta en la copia de autoria de cada evolucion.

## 5. Ingreso y reingreso de equipo

- Alta de usuario: ADMIN, con id generado en la API.
- **Cierre de cuentas** (ADMIN, GESTION, PROFESIONAL, PRACTICANTE):
  - Desactivar (revocar, expirar o `activo = false`) abre una **gracia** de
    `dias_gracia_cierre` (30): dentro de ella ADMIN reactiva sin perder datos
    (`UPDATE activo = true`; practicantes con `otorgar_acceso_practicante`).
  - El vaciado (cierre) es irreversible y lo hace `procesar_bajas()`: con baja
    al llegar su fecha efectiva, o sin baja al vencer la gracia. Sobre una
    cuenta cerrada todo cambio -> 23001; quien vuelve recibe cuenta nueva (el
    email queda libre).
  - `iniciar_baja_profesional` acepta GESTION (mismo flujo que PROFESIONAL) y
    ADMIN (solo otro ADMIN; nunca la propia -> 42501; nunca el ultimo ADMIN
    activo -> 23514). Quien supervisa practicantes activos no se da de baja
    hasta `cambiar_supervisor` (55000).
  - La UI muestra la fecha de cierre (`desactivado_en` + gracia) y advierte
    antes de desactivar al ultimo ADMIN (la BD lo impide igual).
  - Un ADMIN nunca se desactiva a si mismo (23514
    `usuarios_admin_no_se_desactiva`): lo hace otro ADMIN o su baja.
  - Si `procesar_bajas()` deja una baja sin procesar porque el centro
    quedaria sin ADMIN, la API alerta a los ADMIN (la baja sigue pendiente y
    se reintenta en cada corrida).
  - Reactivar un practicante son dos pasos en BD (`cambiar_supervisor` si su
    supervision cerro, luego `otorgar_acceso_practicante`); la UI los une en
    una sola accion.
- Al escribir una evolucion, la API arma la **copia de autoria** con los
  datos actuales del autor (nombre de `usuarios`, RUT de
  `profesional_datos_privados`, registro de `profesional_trayectoria`) y la
  cifra (`autor_nombre`, `autor_rut`, `autor_registro`, NOT NULL; si un
  practicante no tiene registro, se cifra un valor explicito como
  "sin registro"). Igual con `emisor_nombre`/`emisor_rut` al emitir una boleta.
- Las intervenciones de una evolucion se insertan en la misma transaccion que
  la evolucion (despues no se puede).
- **Tipos de sesion** (`tipos_sesion`): la evolucion lleva `tipo_sesion_id`
  de un tipo APROBADO y activo (si no, 23514). PROFESIONAL/PRACTICANTE
  proponen (quedan PROPUESTO aunque envien otro estado); solo ADMIN aprueba,
  rechaza o desactiva (nunca DELETE); `revisado_por`/`revisado_en` registran
  quien y cuando aprobo o rechazo. La UI de evolucion solo lista los aprobados
  y activos; la de ADMIN muestra la cola de propuestos.
- **Tipos de atencion por profesional** (02h, mismo patron): el PROFESIONAL
  propone los suyos (`profesional_tipos_atencion`, quedan PROPUESTO); solo
  ADMIN aprueba o rechaza (o fija la lista aprobada). Solo los APROBADOS
  cuentan en el match y `perfiles_publicos()` y en `directorio_interno()`
  (de donde la UI filtra los candidatos de una derivacion).

## 6. Perfil profesional y cobro

- El propio profesional crea y edita su perfil (`profesionales`), su
  trayectoria (`profesional_trayectoria`), sus datos privados cifrados
  (`profesional_datos_privados`) y sus tarifas (`tarifas`, historial: una
  tarifa nueva es una fila nueva con `vigente_desde`; nunca UPDATE).
- Publicar el perfil (`perfil_publico = true`): solo el propio, con
  `nombre_publico` y tarifa general vigente (tipo y modalidad nulos).
- Verificar trayectoria: solo ADMIN (`UPDATE verificado = true`); cualquier
  edicion del profesional la des-verifica.
- `configuracion_centro.modelo_cobro`: CENTRO | DIRECTO | MIXTO (ADMIN). En
  MIXTO, el profesional decide `cobro_directo`. El portal del paciente pide
  `datos_pago_profesional(cita)` y descifra con AAD
  `profesional_datos_privados:<columna>:<profesional_id>`; 0 filas = no
  corresponde mostrar datos de pago.
- **Cobros (02h)**:
  - `citas.monto` lo fija la BD al confirmar con la tarifa mas especifica
    vigente (tipo de atencion del paciente + modalidad, tipo, modalidad,
    general; sin tarifa = 0). Inmutable: no hay ajustes; una tarifa nueva solo
    afecta citas confirmadas despues. Reprogramar (misma fila) lo conserva.
  - Pagos solo via `registrar_pago` (sobrepago = 23514) y `anular_pago`
    (motivo; nunca borrado). Saldo = vista `estado_pago_citas` (exigible -
    pagado no anulado + devolucion). Estados: SIN_COBRO (exigible 0),
    PENDIENTE, PARCIAL, PAGADO. "Pago pendiente" = saldo > 0, tambien en
    `datos_pago_profesional`.
  - Boleta: una por cita, emitida en la misma transaccion en que queda PAGADA
    (`emitir_boleta`), con copia cifrada del emisor (el profesional si cobro
    directo, si no el centro; sin RUT se cifra "sin RUT"). No se anula un pago
    de una cita con boleta.
  - Politica de cancelacion (`configuracion_centro`): `plazo_aviso_cancelacion_horas`
    (24; con recordatorio activo, menor que `recordatorio_horas_antes`, 02j), `penalizacion_cancelacion_porcentaje` y `cobro_inasistencia_porcentaje`
    (0, pendientes del caso de estudio). `resolver_cita` (ADMIN/GESTION)
    registra la decision: TRASLADO (credito de una cancelacion a tiempo o
    reprogramacion de una tardia: los pagos pasan a la cita nueva), DEVOLUCION
    (a tiempo: todo; tardia: menos la penalizacion) o INASISTENCIA (cobra el
    porcentaje). Una decision por cita, append-only.
  - Liquidacion por profesional y periodo (`generar_liquidacion`,
    `avanzar_liquidacion`): pagos cobrados por el centro - devoluciones -
    `comision_centro_porcentaje` - arriendos del periodo. BORRADOR, EMITIDA,
    PAGADA; solo ADMIN/GESTION; el profesional ve las suyas emitidas.
  - Fuera de alcance: pasarela de pago, medios reales, SII (numero de boleta
    simulado) y propuestas financieras.
- El orden del Match (necesidad > tiempos > precio) lo implementa el modulo
  Match con `perfiles_publicos()` (tarifas incluidas) y `disponibilidad_publica()`.

## 7. Agenda por modalidad

- `citas.modalidad`: PRESENCIAL exige `espacio_id`; ONLINE lo prohibe (23514).
- Choques: por profesional en ambas modalidades, por box solo presencial
  (23P01 -> 409).
- Una cita CONFIRMADA debe caer dentro de la disponibilidad semanal de su
  modalidad (hora de Chile, sin cruzar de dia) y fuera de bloqueos de agenda
  (23514). Reprogramar una POR_REPROGRAMAR pasa por las mismas reglas.
- **Disponibilidad en minutos**: `inicio_min`/`fin_min` son minutos desde la
  medianoche de Chile (0-1440; 1440 = fin del dia). La API los
  expone y recibe como enteros (DTO: 0 <= inicio < fin <= 1440) y la UI los
  muestra como HH:MM; el minuto 1440 se presenta como "24:00" (confirmado en
  02h: solo presentacion, nunca se guarda ni se recibe asi). Para convertir a instantes, usar la misma regla que la
  BD (`minuto_local(fecha, minuto)`, zona America/Santiago): en los dias de
  cambio de horario el dia dura 23 o 25 h. Mejor pedir los huecos ya
  convertidos a `disponibilidad_publica()` que recalcularlos en TS.
- **Margen de traslado** (opcion A en BD + C en la API):
  - BD (fuente de verdad): dos citas CONFIRMADA del mismo profesional en
    distinta modalidad necesitan su margen entre si (EXCLUDE
    `citas_margen_traslado`, 23P01 -> 409). El margen se fija al confirmar
    (`profesionales.margen_traslado_min` o, si es nulo, el del centro).
  - API/UI (opcion C): antes de confirmar, verificar con
    `disponibilidad_publica()` (ya descuenta el margen) y, si la hora pedida no
    esta libre, advertir con alternativas (los huecos mas cercanos de la misma
    modalidad) en vez de esperar el 409.
  - Cambiar el margen (centro o profesional) no mueve citas: la API lista
    `citas_en_conflicto_margen(profesional)` para reprogramar y avisar al
    paciente.
  - Editan el margen: el propio profesional y ADMIN/GESTION.
- **Enlace online**: `citas.enlace_online` solo en citas ONLINE (CHECK) y
  **cifrado** (bytea, CLINICO, en `registro.ts`; AAD `citas:enlace_online:<id>`).
  La API lo genera con la cita ya creada (id conocido), con expiracion, segun
  el modo del profesional (`salas_videollamada`: ENLACE_PROPIO o JITSI, ver
  `docs/api/integraciones.md`), y lo envia al paciente; nunca en presenciales
  ni en logs.
- El margen requerido entre dos citas con margenes distintos es el promedio
  de ambos (cada cita guarda el vigente al confirmarse).
- Disponibilidad y bloqueos: los edita el propio y ADMIN/GESTION. El bloqueo
  BAJA lo crea `iniciar_baja_profesional` y la API no lo toca.
- Huecos libres para agendar o para el portal: `disponibilidad_publica(id,
  desde, hasta)` (max. 62 dias; sin motivos). Ocupacion de boxes:
  `ocupacion_espacios()`.
- Soft-lock (`bloqueos_temporales`): siempre con `profesional_id`; con
  `espacio_id` solo si es presencial.

## 8. Jobs (sin contexto, cron de la API)

| Funcion | Frecuencia sugerida | Devuelve |
|---|---|---|
| `expirar_ofertas_derivacion()` | cada 5-15 min | ofertas expiradas + solicitudes de consentimiento vencidas |
| `procesar_bajas()` | cada hora (y al arrancar) | usuarios desactivados (ademas cierra bajas cumplidas y cuentas fuera de gracia) |
| `cerrar_avisos_vencidos()` | cada 5-15 min | avisos de cambio de supervisor sin respuesta -> CONFORME tacito |
| verificacion de canarios (CryptoModule) | diaria | registra VERIFICACION / FALLO_CANARIO |
| `notificaciones_por_enviar` + `guardar_contenido_notificacion` + `marcar_notificacion` (02i) | cada minuto | mensajes armados y cerrados; correo con backoff 1, 2, 4, 8 min, FALLIDO al quinto intento |
| `avisar_consentimientos_por_vencer()` (02i) | cada 10 min | avisos legales (una vez por solicitud) |
| `citas_por_recordar` + `registrar_recordatorio` (02i, Agenda) | cada 10 min | recordatorios registrados (uno por cita y horario) |

Idempotentes y con `SKIP LOCKED`: correr dos instancias a la vez no duplica
efectos. Loguear el numero devuelto con el logger de Nest. Ademas el envio de
correos (`enviar_notificaciones`, cada minuto). La programacion de cada job
se prueba con reloj simulado (`core/jobs/jobs.spec.ts`).

## 9. Practicantes, supervision y consentimiento

- **Principio**: el paciente primero; se consiente quien atiende, se informa
  quien supervisa.
- Supervisiones: solo `cambiar_supervisor(practicante, nuevo)` (ADMIN; sin
  INSERT/UPDATE directos). Cierra y abre en la misma transaccion: nunca hay
  un practicante sin supervisor. **No invalida consentimientos**: devuelve
  cuantos avisos creo (uno por paciente con consentimiento vigente).
- **Avisos** (`avisos_consentimiento`): la API los notifica al paciente
  (portal y email) con el plazo `plazo_oposicion_horas` (48). Responde el
  PACIENTE (si es menor, por su adulto responsable) o ADMIN/GESTION con
  respaldo: `responder_aviso_consentimiento(aviso, CONFORME|OPOSICION, ...)`.
  OPOSICION = revocacion (corte inmediato, citas POR_REPROGRAMAR, bandeja).
  Sin respuesta al vencer = CONFORME tacito (job `cerrar_avisos_vencidos`).
  Durante el plazo el practicante sigue atendiendo y el nuevo supervisor ya
  accede a los casos seudonimizados.
- `solicitar_consentimiento(paciente)` queda para pedir un consentimiento
  nuevo al practicante tratante (p. ej. despues de una oposicion o revocacion
  si el paciente reconsidera).
- Un paciente llega a un practicante **solo** via derivacion: el supervisor
  vigente (o ADMIN) ve `derivaciones_pendientes()`, propone con
  `proponer_practicante(derivacion, practicante)`; si el practicante acepta,
  la derivacion queda ESPERANDO_CONSENTIMIENTO y se crea la solicitud (vence
  a las `plazo_consentimiento_horas`, default 48).
- Responden: el PACIENTE desde el portal (si es menor, en nombre de un adulto
  responsable suyo), o ADMIN/GESTION con `respaldo_documento_ref` (documento
  firmado escaneado). El supervisor solicita pero nunca registra (42501).
  ACEPTADO concreta el traspaso; RECHAZADO o vencido pasan la oferta al
  siguiente candidato (el practicante queda RECHAZADO_POR_PACIENTE).
- Revocar: `revocar_consentimiento` (mismos actores). Efecto inmediato: el
  practicante pierde acceso, sus citas futuras con el paciente quedan
  POR_REPROGRAMAR y el paciente entra a la bandeja. Derivacion de oficio:
  ADMIN o el supervisor vigente.
- Supervisor: `supervision_casos()` y `supervision_evoluciones(codigo)`
  (campos estructurados + notas cifradas); comentarios solo mientras
  supervisa. La UI advierte no escribir datos identificatorios en texto libre.

## 10. Bajas y reasignacion

- `iniciar_baja_profesional(usuario, fecha_efectiva)`: ADMIN, para cualquier
  cuenta de equipo (reglas en la seccion 5). Bloquea la agenda desde la fecha
  y devuelve cuantas citas quedaron POR_REPROGRAMAR.
- Retencion: `fichas_sobre_retencion()` y `revisiones_retencion` solo para
  ADMIN (pantalla de revision anual). PURGAR solo registra la decision; la
  API no borra fichas.
- `pacientes_por_reasignar()`: bandeja de ADMIN/GESTION (con nombre) y del
  supervisor (solo sus practicantes, con codigo seudonimo y `ficha_id`).
- Derivacion de oficio: `crear_derivacion` con la ficha del paciente de la
  bandeja; la BD pone como origen al tratante saliente y `creada_por` = actor.

## 11. Derivaciones (firmas vigentes)

- `crear_derivacion(id, ficha, motivo_cifrado, tipo_atencion_id, detalle_cifrado, candidatos[])`.
- `cancelar_derivacion(id, motivo)`: ADMIN en PENDIENTE o SIN_ASIGNAR; el
  origen solo en SIN_ASIGNAR.
- `reintegrar_candidato(id, profesional)`, `definir_candidatos_derivacion(id, candidatos[])`: ADMIN.
- `oferta_derivacion(id)`: motivo/detalle cifrados + `citas_en_conflicto`.

## 12. Auditoria

- Lecturas de datos clinicos hechas por la API (fichas, evoluciones):
  `INSERT accesos_ficha` con el usuario y rol del contexto en la misma
  transaccion. Las funciones de derivacion, supervision y datos de pago ya
  auditan solas.
- Documentos clinicos (02h): emision (ESCRITURA) y cada envio (ENVIO) los
  registra la API; cada descarga, `registrar_descarga_documento` (DESCARGA y
  `descargas_documento`). El unico contenido clinico que sale por correo son
  documentos emitidos: por defecto un enlace que expira y exige sesion;
  adjunto solo si el paciente lo pidio. Los mensajes del paciente no cambian
  (el correo solo avisa y remite al portal).
- Decisiones de cobro (`resoluciones_cita`), anulaciones (`pagos`) y
  liquidaciones guardan quien y cuando; son append-only.
- Adjuntos de la ficha (02i): subida (ESCRITURA) y descarga (LECTURA) en
  `accesos_ficha`, recurso `adjuntos_ficha`. Documentos emitidos: el PDF se
  genera al entregarlo (no se guarda); la descarga se audita como en 02h.

## 13. Como quedo implementado (02a-02i)

Estado y decisiones de la fase de API: `docs/api/estado_fase_api.md`.

- Contexto RLS: `ContextoBd.enTransaccion` (core/bd). Ademas de los dos
  `set_config`, verifica `acceso_vigente()` al inicio (falso -> 401) y antes
  de confirmar ejecuta `SET CONSTRAINTS ALL IMMEDIATE`: Prisma entrega los
  errores del COMMIT sin SQLSTATE; asi un trigger diferido falla como
  consulta y llega al filtro con su codigo (23514 -> 422).
- Errores: `core/errores/sqlstate.ts`. Prisma no expone el campo constraint
  de un RAISE: la restriccion se reconoce por el nombre del constraint en el
  texto de Postgres o por el texto propio del RAISE (tabla
  `RESTRICCION_POR_TEXTO`); al cliente solo va un mensaje propio. Un 23505
  bajo RLS puede llegar sin indice (P2002 sin target): el servicio que sabe
  cual es lo traduce (`conflicto(...)`).
- Cifrado: `claro()` al escribir y `texto()` al leer (core/bd/claro.ts). Prisma
  clona los args antes de la extension: la marca de "valor a cifrar" es un
  objeto plano, no un `Uint8Array`.
- `evoluciones.created_at` usa default de la BD (`transaction_timestamp()`):
  con `@default(now())` Prisma enviaba la hora del cliente y la politica de
  `evolucion_intervenciones` (created_at = now()) rechazaba las
  intervenciones.
- Eventos de dominio: se emiten despues del COMMIT (`alConfirmar`), nunca
  dentro de la transaccion.
- 02h: los avisos de derivacion los registra la BD (triggers sobre
  `derivacion_candidatos` y `derivaciones`), asi tambien salen cuando un job
  o un rechazo pasa la oferta al siguiente; la fila no lleva autor y
  `GET /notificaciones` no expone `creadaPorId`.
- 02h: integraciones por interfaz (`ProveedorCorreo`, `ProveedorVideollamada`,
  `ProveedorCalendario`) elegidas en `CoreModule` por configuracion
  (`docs/api/integraciones.md`).
- 02h: Prisma envia los enteros de `$queryRaw` como `bigint`: castear
  (`::int`) al llamar funciones con parametros `int` (si no, 42883 -> 500).
- 02i: mensajeria en `core/notificaciones` (eventos, plantillas, canales;
  `docs/api/integraciones.md`). El job arma cada mensaje una vez con la
  plantilla vigente y lo guarda cifrado; las variables salen de
  `notificaciones_por_enviar` (nunca motivo, diagnostico ni notas).
- 02i: el body JSON vuelve a 1 MB; los adjuntos de la ficha van por multipart
  (multer, limite `ADJUNTO_MAX_MB`) y los documentos emitidos se redactan
  como texto (PDF con pdfkit al entregarlo).
- 02i: errores de body-parser (413, JSON invalido) los traduce el filtro
  global (antes salian como 500).
- 02i: una politica que lee otra tabla con RLS cuya politica lee la primera
  es recursiva (42P17 -> 500): se resuelve con una funcion SECURITY DEFINER
  (`tipo_documento_del_paciente`).

## 14. Alineacion con el diseño (03a-1)

Decisiones: `docs/front/brechas.md` (seccion 6). Migraciones
`20261018000000_03a_enums` y `20261018000100_03a_cuentas_portal_agenda`.

- **Varios roles por cuenta** (C-1): `usuarios.rol` es el rol principal y
  `roles_adicionales` los otros (solo ADMIN+PROFESIONAL y
  GESTION+PROFESIONAL). La sesion lleva un solo rol activo; la BD sigue
  recibiendo un unico `app.current_rol` y `acceso_vigente()` exige que el
  usuario tenga ese rol (`tiene_rol`). `auth/cambio-rol` emite un token
  nuevo; la auditoria guarda el rol de la sesion.
- **Login en dos pasos**: contraseña -> desafio; TOTP obligatorio para
  cuentas con acceso clinico (PROFESIONAL, PRACTICANTE, o PROFESIONAL como rol
  adicional; secreto cifrado en `usuarios.totp_secreto`), opcional para el
  resto. Solo ADMIN reinicia un TOTP.
- **Tokens por correo** (`tokens_correo`): invitacion, verificacion,
  recuperacion, acceso del paciente (C-6), cambio de correo (C-9) y
  consentimiento; solo el SHA-256, un solo uso, vencimiento. Solo funciones
  SECURITY DEFINER los emiten y consumen; la respuesta de recuperacion y de
  enlace de acceso es identica exista o no la cuenta. Los correos de cuenta
  salen directo por el `ProveedorCorreo` (no por la cola de notificaciones).
- **Rutas publicas** (`@Publico`, rate limit): solicitudes de hora, match,
  equipo, reseñas (lectura y reporte), politicas, consentimiento por enlace,
  imagenes. Sin contexto de usuario: todo pasa por funciones SECURITY DEFINER
  que devuelven solo columnas publicas.
- **RESPONSABLE** (D-4): rol nuevo del adulto responsable con cuenta. Ve
  citas, pagos y documentos emitidos de los menores a su cargo
  (`pacientes_a_cargo()`), nunca la ficha ni los mensajes del adolescente.
  `app_pacientes_plenos()` separa al paciente adulto del adolescente con
  cuenta restringida.
- **Modulos activables**: `ModulosGuard` global + `@Modulo(...)`; un modulo
  apagado en `configuracion_centro` responde 403 (`modulo_inactivo`).
- **Imagenes publicas**: multipart, tipo validado por contenido, re-codificadas
  a WebP sin metadatos (sharp), servidas sin autenticacion. Unica columna
  bytea sin cifrar (`BYTEA_PUBLICOS`).
- **Errores nuevos**: un cambio de profesional de una cita hacia quien no es
  tratante ni tiene acceso temporal de escritura -> 422; citas fuera del
  horario del centro o del box -> 422; hora retenida por otra solicitud -> 409.
- **Funciones void**: se llaman con `$executeRaw` (Prisma no deserializa
  `void` en `$queryRaw` -> 500).
