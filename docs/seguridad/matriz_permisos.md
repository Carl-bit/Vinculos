# Matriz de permisos de la BD

Generada a partir del catalogo real (`has_table_privilege`,
`information_schema.column_privileges`, `pg_policies`,
`information_schema.triggers`, `pg_proc`) despues de aplicar las migraciones
hasta `20261011000000_cierre_fase_bd` (cierre de la fase de BD), mas las de la fase de API:
`20261012000000_api_sesiones_alertas` (02a), `20261013000000_notificaciones` (02f),
`20261014000000_portal_mensajes_epicrisis` (02g), `20261015000000_ajustes_y_cobros` (02h) y
`20261016000000_mensajeria_enums` + `20261016000100_mensajeria_recordatorios_documentos` (02i), `20261017000000_recordatorio_antes_de_cancelacion` (02j)
y `20261018000000_03a_enums` + `20261018000100_03a_cuentas_portal_agenda` (03a-1). Fuente para los guards
del prompt 02 y para la tesis. Si una migracion cambia GRANTs, politicas,
triggers o funciones, esta matriz se actualiza en el mismo cambio. Cada fila
tiene al menos un caso en `backend/prisma/tests/seguridad_bd.sql`.

Categoria (A/B/C): ver `criterio_clasificacion.md`. Columnas cifradas (bytea
opaco para la BD; cifra y descifra la API): ver `cifrado.md`. Retencion y
cierre de cuentas: `retencion_datos.md`.

## Roles de base de datos

| Rol | LOGIN | Superusuario | BYPASSRLS | Uso |
|---|---|---|---|---|
| `POSTGRES_USER` (`postgres`) | si | si | si | Solo dentro del contenedor `db`: crea `vinculos_owner` en el init. Ningun servicio de la app lo usa. |
| `vinculos_owner` | si | no | si | Dueño de BD, tablas y funciones. Solo el servicio `migrate` y el seed (`MIGRATION_DATABASE_URL`). Tiene CREATEROLE (crea `app_user`/`app_reportes`) y CREATEDB (shadow DB de `migrate dev`). |
| `app_user` | si | no | no | Unica conexion de la API (`DATABASE_URL`). Sujeto a RLS siempre. |
| `app_reportes` | no | no | si | Solo dueño de funciones de reporte `SECURITY DEFINER`. Solo `vinculos_owner` es miembro. |

`app_user` no puede `SET ROLE` a `vinculos_owner`, `app_reportes` ni `postgres`.

## Contexto por transaccion y catalogo de roles

Los roles de aplicacion (`usuarios.rol`) no son roles de Postgres: son
`app.current_rol` + `app.current_usuario_id` (identidad del actor, cualquier
rol: `usuarios.id`), seteados con `set_config(..., true)` al inicio de cada
transaccion.

| Rol | Alcance |
|---|---|
| ADMIN | Configuracion, usuarios, reportes, derivaciones (redefine candidatos, reintegra, cancela; crea solo de oficio), supervisiones, accesos de practicantes, bajas y todo lo de GESTION. Clinico: solo metadata de fichas. |
| GESTION | Agenda, datos administrativos de pacientes, pagos, boletas, arriendos, adultos responsables, consentimientos. Nunca clinico. Solo existe si `configuracion_centro.rol_gestion_habilitado`. |
| PROFESIONAL | Sus pacientes (tratante = `pacientes.profesional_id`), fichas y evoluciones; crea derivaciones. Como supervisor: casos seudonimizados de sus practicantes. |
| PRACTICANTE | Solo pacientes recibidos por derivacion con consentimiento vigente (que lo nombra a el y a su supervisor vigente); acceso con expiracion y supervision vigente. |
| PACIENTE | Su registro (`usuarios.paciente_id`), sus citas, pagos, boletas, adultos responsables y consentimientos; su equipo tratante. Nunca fichas ni evoluciones. 03a: de 14 a 17 años, cuenta restringida (sus citas, recordatorios y mensajes). |
| RESPONSABLE (03a) | Adulto responsable con cuenta (exclusiva): citas, pagos, documentos emitidos y consentimientos de sus pacientes menores (`adultos_responsables.usuario_id`); escribe mensajes por ellos y ve solo los suyos. Nunca fichas, evoluciones ni los mensajes del adolescente. |

**Varios roles por cuenta (03a, C-1)**: una cuenta ADMIN o GESTION puede sumar PROFESIONAL (`roles_adicionales`). La sesion trabaja con un rol (`app.current_rol`); la matriz por rol no cambia. Cambio de rol sin cerrar sesion: `cambiar_rol_sesion` (token nuevo). Baja por rol: `iniciar_baja_rol` + `procesar_bajas`. TOTP obligatorio para cuentas con rol clinico (PROFESIONAL o PRACTICANTE).

**Acceso vigente** (`acceso_vigente()`, politica `RESTRICTIVE` `<tabla>_acceso_vigente`
en toda tabla): el usuario del contexto existe, `activo = true`, su `rol` en BD
es igual a `app.current_rol` y, si es PRACTICANTE, `fecha_expiracion_acceso > now()`
y tiene supervision vigente (con supervisor activo). Si no se cumple: 0 filas y
ninguna escritura. "Sin contexto" = variables ausentes: 0 filas en toda tabla.

**Principio de supervision: el paciente primero.** Se consiente quien
atiende (el practicante); se informa quien supervisa. El supervisor siempre
existe (`cambiar_supervisor` cierra y abre en la misma transaccion) y
cambiarlo no afecta las sesiones: el consentimiento sigue vigente y el
paciente recibe un aviso con plazo de oposicion (`avisos_consentimiento`).
Ver `consentimiento.md`.

**Consentimiento de practicante** (RESTRICTIVE `<tabla>_consentimiento_practicante`
en `pacientes`, `fichas_clinicas`, `evoluciones`, `adultos_responsables`): con
contexto PRACTICANTE, solo filas de pacientes con consentimiento ACEPTADO que
nombra a ese practicante. Revocar (o la oposicion a un aviso) corta el acceso
al instante; cambiar de supervisor no.

**Cuentas**: una cuenta = un periodo de trabajo. Desactivada (`desactivado_en`)
se puede reactivar sin perder datos dentro de `dias_gracia_cierre` (30 por
defecto). `procesar_bajas()` la cierra (`cerrada_en`, datos personales
vaciados, irreversible) al llegar la fecha efectiva de una baja o al vencer
la gracia sin baja. Una cuenta cerrada no se modifica (23001). Nunca se
desactiva al ultimo ADMIN activo (23514).

**Decisiones aceptadas al cierre de la fase (01g)**: la baja de un supervisor
con practicantes activos se bloquea hasta `cambiar_supervisor` (55000); la
conformidad tacita a las 48 h es configurable (`plazo_oposicion_horas`) y
queda pendiente de validacion legal (`consentimiento.md`); el margen entre dos
citas con margenes distintos es el promedio; una baja que dejaria al centro
sin ADMIN queda pendiente y la API alerta; el recalculo de `rut_hmac` ante
compromiso es un comando de mantencion del operador en un contenedor puntual,
nunca en el de la API (runbook 5.5); reactivar un practicante son dos pasos
que la UI une.

**Bandeja del supervisor (minimo necesario)**: `derivaciones_pendientes()`
entrega motivo, edad y tipo de atencion de todas las derivaciones pendientes
del centro (no solo de sus practicantes): es lo minimo para decidir si
proponer a un practicante; nunca nombre, RUT ni ficha.

"Tratante" = PROFESIONAL o PRACTICANTE con `pacientes.profesional_id` = yo
(`es_profesional_de_paciente` / `es_profesional_de_ficha`). "Supervisor vigente"
= `es_supervisor_vigente_de(practicante)`.

## Tablas (todas con ENABLE + FORCE RLS + acceso vigente)

Sin politica = sin acceso. DELETE solo tiene politica en `bloqueos_temporales`
y `profesional_tipos_atencion`. `_prisma_migrations` no tiene GRANT para `app_user`.

| Cat. | Rol | Tabla | Operacion | Alcance de filas | Mecanismo |
|---|---|---|---|---|---|
| A+C | ADMIN | `usuarios` | SELECT, INSERT | todas | GRANT + `usuarios_select` / `usuarios_insert` |
| A+C | ADMIN | `usuarios` | UPDATE | todas; no su propio rol | GRANT por columna + `usuarios_update` + trigger `usuarios_campos_protegidos` |
| A+C | GESTION / PROFESIONAL / PRACTICANTE / PACIENTE | `usuarios` | SELECT | su fila | `usuarios_select` |
| A+C | GESTION / PROFESIONAL / PRACTICANTE / PACIENTE | `usuarios` | UPDATE | su fila; solo `email`, `nombre`, `telefono` (cifrado), `password_hash` | GRANT por columna + `usuarios_update` + trigger `usuarios_campos_protegidos` (42501) |
| A+C | ADMIN | `usuarios` | UPDATE `activo` false -> true | dentro de la gracia (cuenta no cerrada) | trigger `usuarios_ciclo_cuenta` (fija `desactivado_en`) |
| A+C | todos (incluso dueño) | `usuarios` | UPDATE de cuenta cerrada / desactivar al ultimo ADMIN | ninguna | trigger `usuarios_ciclo_cuenta` (23001 / 23514) + CHECK `usuarios_cuenta_cerrada_vacia` |
| A+C | ADMIN | `usuarios` | UPDATE `activo` -> false de si mismo | ninguna (lo desactiva otro ADMIN o su baja) | trigger `usuarios_ciclo_cuenta` (23514 `usuarios_admin_no_se_desactiva`) |
| A+C | no ADMIN | `usuarios` | INSERT | ninguna | `usuarios_insert` |
| A+C | todos | `usuarios` | INSERT/UPDATE con rol GESTION | solo si `rol_gestion_habilitado` | trigger `usuarios_gestion_requiere_habilitacion` (23514) |
| A+C | todos | `usuarios` | INSERT/UPDATE | PACIENTE <-> `paciente_id` (1:1) | CHECK `usuarios_paciente_solo_rol_paciente` + UNIQUE |
| A+C | todos | `usuarios` | DELETE | ninguna (revocar = `activo=false`) | sin GRANT |
| A+C | sin contexto | `usuarios` | login | fila del email | funcion `credenciales_login(email)` |
| A+C | equipo / PACIENTE | `usuarios` (nombres ajenos) | lectura | ver funciones de directorio | `directorio_interno()`, `mi_equipo_tratante()` |
| B | todos (autenticados) | `configuracion_centro` | SELECT | la fila unica | GRANT + `configuracion_centro_select` |
| B | ADMIN | `configuracion_centro` | UPDATE | la fila unica; no apagar GESTION con GESTION activos; recordatorio activo mayor que el plazo de aviso de cancelacion (02j) | GRANT por columna + `configuracion_centro_update` + trigger `configuracion_centro_gestion_activos` (23514) + CHECK `configuracion_centro_recordatorio_antes_de_cancelacion` (23514) |
| B | todos | `configuracion_centro` | INSERT, DELETE | ninguna | sin GRANT (la fila la crea la migracion) |
| A | todos | `historial_accesos_practicante` | INSERT, UPDATE, DELETE | ninguna directa; solo `otorgar_acceso_practicante` / `revocar_acceso_practicante` / `procesar_bajas` | sin GRANT + trigger `historial_accesos_practicante_append_only` (23001, incluso dueño) |
| A | ADMIN / GESTION | `historial_accesos_practicante` | SELECT | todas | GRANT + `historial_accesos_practicante_select` |
| A | PRACTICANTE | `historial_accesos_practicante` | SELECT | su historial | idem |
| A | supervisor vigente | `historial_accesos_practicante` | SELECT | el de sus practicantes | idem |
| A | ADMIN / GESTION | `bajas` | SELECT | todas | GRANT + `bajas_select`; escritura solo via `iniciar_baja_profesional` / `procesar_bajas` |
| A | ADMIN / GESTION | `pacientes` | SELECT, INSERT, UPDATE | todos | GRANT (UPDATE por columna) + `pacientes_*` |
| A | PROFESIONAL | `pacientes` | SELECT, UPDATE / INSERT | tratante / `profesional_id` = yo | GRANT + `pacientes_*` |
| A | PRACTICANTE | `pacientes` | SELECT, UPDATE | tratante con consentimiento vigente (no crea) | GRANT + `pacientes_select` / `_update` + `pacientes_consentimiento_practicante` |
| A | PACIENTE | `pacientes` | SELECT | su registro | `pacientes_select` |
| A | todos (app_user) | `pacientes` | INSERT con tratante PRACTICANTE | ninguna: llega solo via derivacion con consentimiento | trigger `pacientes_asignacion_practicante` (42501) |
| A | todos | `pacientes` | INSERT/UPDATE `rut` | cifrado; `rut_hmac` unico (indice ciego) | CHECK `pacientes_cifrado` (23514) + UNIQUE (23505) |
| A | todos | `pacientes` | INSERT/UPDATE con tratante PRACTICANTE | exige consentimiento vigente al COMMIT | constraint trigger diferido `pacientes_practicante_requiere_consentimiento` (23514) |
| A | todos | `pacientes` | UPDATE de `profesional_id` | ninguna (solo via `responder_derivacion`) | trigger `pacientes_tratante_via_derivacion` (42501) |
| A | todos | `pacientes` | UPDATE de `id`, `codigo_seudonimo`, `created_at` | ninguna | sin GRANT de columna |
| A | todos | `pacientes`, `adultos_responsables`, `evoluciones`, `derivaciones`, `supervision_comentarios`, `boletas`, `usuarios` | INSERT | `id` lo da la API (AAD del cifrado) | sin DEFAULT de id |
| A | todos | `pacientes` | DELETE | ninguna | sin GRANT + trigger `pacientes_sin_delete` |
| A | ADMIN | `fichas_clinicas` | SELECT, INSERT, UPDATE | todas (solo metadata) | GRANT + `fichas_clinicas_*` |
| A | PROFESIONAL / PRACTICANTE | `fichas_clinicas` | SELECT, INSERT, UPDATE | tratante (PRACTICANTE: con consentimiento) | GRANT + `fichas_clinicas_*` + `_consentimiento_practicante` |
| A | GESTION / PACIENTE / supervisor | `fichas_clinicas` | todas | ninguna | politicas sin rama |
| A | todos | `fichas_clinicas` | DELETE | ninguna | sin GRANT + trigger `fichas_clinicas_sin_delete` |
| A | PROFESIONAL / PRACTICANTE | `evoluciones` | SELECT | tratante actual (PRACTICANTE: con consentimiento) | GRANT + `evoluciones_select` + `_consentimiento_practicante` |
| A | PROFESIONAL / PRACTICANTE | `evoluciones` | INSERT | tratante y `autor_id` = yo; notas y copia de autoria cifradas (NOT NULL) | GRANT + `evoluciones_insert` + CHECK `evoluciones_cifrado` |
| A | tratante | `evolucion_intervenciones` | SELECT / INSERT | de evoluciones que ve / solo en la transaccion que crea la evolucion propia | GRANT + `evolucion_intervenciones_*`; trigger append-only (incluso dueño) |
| A | ADMIN / GESTION / PACIENTE / supervisor | `evoluciones` | todas | ninguna directa (supervisor: `supervision_evoluciones`) | politicas sin rama |
| A | todos | `evoluciones` | UPDATE, DELETE | ninguna | sin GRANT + triggers `evoluciones_append_only` / `_sin_delete` |
| A | ADMIN / GESTION | `adultos_responsables` | SELECT, INSERT, UPDATE | todos | GRANT + `adultos_responsables_*` |
| A | PROFESIONAL / PRACTICANTE | `adultos_responsables` | SELECT, INSERT, UPDATE | de pacientes donde es tratante (PRACTICANTE: con consentimiento) | GRANT + `adultos_responsables_*` + `_consentimiento_practicante` |
| A | PACIENTE | `adultos_responsables` | SELECT | los propios | `adultos_responsables_select` |
| A | todos | `adultos_responsables` | DELETE | ninguna | sin GRANT + trigger `adultos_responsables_sin_delete` |
| A | ADMIN / GESTION | `consentimientos` | SELECT | todos | GRANT + `consentimientos_select` |
| A | PACIENTE / practicante / supervisor / tratante | `consentimientos` | SELECT | los propios / los que lo nombran / de sus pacientes | `consentimientos_select` |
| A | todos | `consentimientos` | INSERT, UPDATE | ninguna directa: solicitud al aceptar la derivacion (o `solicitar_consentimiento`), `responder_consentimiento`, `revocar_consentimiento`; vencidas via job | sin GRANT |
| A | todos (incluso dueño) | `consentimientos` | DELETE | ninguna | sin GRANT + trigger `consentimientos_sin_delete` |
| A | ADMIN / GESTION | `supervisiones` | SELECT | todas | GRANT + `supervisiones_select` |
| A | PRACTICANTE / supervisor | `supervisiones` | SELECT | las propias | idem |
| A | todos | `supervisiones` | INSERT, UPDATE | ninguna directa: solo `cambiar_supervisor()` (nunca un practicante sin supervisor) | sin GRANT |
| A | todos | `supervisiones` | INSERT/UPDATE | una vigente por practicante; supervisor PROFESIONAL activo | EXCLUDE `supervisiones_una_vigente` (23P01) + trigger `supervisiones_roles_validos` (23514) |
| A | supervisor vigente | `supervision_comentarios` | INSERT | sobre evoluciones de su practicante (caso vigente) | GRANT + `supervision_comentarios_insert` (`evolucion_supervisable`) |
| A | tratante actual / supervisor vigente | `supervision_comentarios` | SELECT | registro del paciente: tratante actual (incluye al practicante autor mientras sea tratante) y el supervisor mientras supervise; ADMIN nunca | `supervision_comentarios_select` |
| A | todos (incluso dueño) | `supervision_comentarios` | UPDATE, DELETE | ninguna | sin GRANT + trigger `supervision_comentarios_append_only` |
| A+C | ADMIN / GESTION | `profesionales` | SELECT, INSERT, UPDATE | todas | GRANT + `profesionales_*` |
| A+C | PROFESIONAL | `profesionales` | SELECT, INSERT, UPDATE | su fila (perfil autogestionado, `cobro_directo`) | `profesionales_*` |
| A+C | todos | `profesionales` | UPDATE `perfil_publico` -> true | solo el propio (consentimiento, fija la fecha) y con tarifa general vigente | trigger `profesionales_perfil_protegido` (42501 / 23514) + CHECK `profesionales_perfil_publico_completo` (23514) |
| A | PROFESIONAL / PRACTICANTE | `profesional_trayectoria` | SELECT, INSERT, UPDATE, DELETE | la propia; editar quita la verificacion | GRANT + `profesional_trayectoria_*` + trigger `profesional_trayectoria_protegida` |
| A | ADMIN | `profesional_trayectoria` | SELECT, UPDATE (solo verificar) | todas | idem (otro campo -> 42501) |
| A | GESTION | `profesional_trayectoria` | SELECT | todas | `profesional_trayectoria_select` |
| A | PROFESIONAL / PRACTICANTE | `profesional_datos_privados` | SELECT, INSERT, UPDATE | los propios (cifrados; `rut_hmac` unico) | GRANT + `profesional_datos_privados_*` + CHECK `profesional_datos_privados_cifrado` |
| A | ADMIN / GESTION | `profesional_datos_privados` | SELECT | todos | `profesional_datos_privados_select` |
| A | PACIENTE | `profesional_datos_privados` | lectura | solo via `datos_pago_profesional(cita)` | funcion |
| A | PROFESIONAL | `tarifas` | SELECT, INSERT | las propias; historial (sin UPDATE ni DELETE) | GRANT + `tarifas_*` |
| A | ADMIN / GESTION | `tarifas` | SELECT | todas | `tarifas_select` |
| A+C | propio / ADMIN / GESTION | `disponibilidad_profesional`, `bloqueos_agenda` | SELECT, INSERT, UPDATE, DELETE | del profesional; disponibilidad en minutos locales 0-1440; bloqueo BAJA solo via `iniciar_baja_profesional` | GRANT + `*_gestion` + CHECK `disponibilidad_profesional_valida` + trigger `bloqueos_agenda_baja_protegida` (42501) |
| A | ver consentimiento | `avisos_consentimiento` | SELECT | los de consentimientos que ve | GRANT + `avisos_consentimiento_select` |
| A | todos (incluso dueño) | `avisos_consentimiento` | INSERT, UPDATE, DELETE | solo via `cambiar_supervisor`, `responder_aviso_consentimiento`, `cerrar_avisos_vencidos`; se responde una vez | sin GRANT + trigger `avisos_consentimiento_append_only` (23001) |
| B | todos (autenticados) | `tipos_sesion` | SELECT | todos | GRANT + `tipos_sesion_select` |
| B | PROFESIONAL / PRACTICANTE / ADMIN | `tipos_sesion` | INSERT | propuestas propias (no ADMIN: siempre PROPUESTO) | GRANT + `tipos_sesion_insert` + trigger `tipos_sesion_protegidos` |
| B | ADMIN | `tipos_sesion` | UPDATE | aprobar, rechazar, desactivar; nunca DELETE | GRANT + `tipos_sesion_update` + trigger (`revisado_por`/`revisado_en` = quien y cuando decide) |
| A | todos | `evoluciones` | INSERT | solo con tipo de sesion APROBADO y activo | trigger `evoluciones_tipo_sesion_aprobado` (23514) |
| A | ADMIN | `revisiones_retencion` | SELECT, INSERT | propias (`revisado_por` = yo); motivo obligatorio; PURGAR solo pasados 15 años; append-only | GRANT + `revisiones_retencion_*` + triggers (23514 / 23001) |
| A | ADMIN | `consultas_retencion` | SELECT | todas; las escribe `fichas_sobre_retencion()`; append-only | GRANT + `consultas_retencion_select` |
| A+C | resto | `disponibilidad_profesional`, `bloqueos_agenda` | lectura | huecos libres sin motivos | `disponibilidad_publica()` |
| A+C | resto | `profesionales` | todas | ninguna directa (ver `directorio_interno`, `perfiles_publicos`) | politicas sin rama |
| A | ADMIN / GESTION | `practicantes` | SELECT, INSERT, UPDATE | todas | GRANT + `practicantes_*` |
| A | PRACTICANTE / supervisor vigente | `practicantes` | SELECT | la propia / las de sus practicantes | `practicantes_select` |
| B | todos (autenticados) | `tipos_atencion`, `profesional_tipos_atencion` | SELECT | todas | GRANT + `*_select` (`USING true`) |
| B | ADMIN | `tipos_atencion` | INSERT, UPDATE | todas; nunca DELETE (se desactiva) | GRANT + `tipos_atencion_insert` / `_update` |
| B | ADMIN | `profesional_tipos_atencion` | INSERT, DELETE | todas (ADMIN fija la lista aprobada) | GRANT + `profesional_tipos_atencion_insert` / `_delete` |
| B | PROFESIONAL | `profesional_tipos_atencion` | INSERT | propias; siempre PROPUESTO (02h) | GRANT + `profesional_tipos_atencion_insert` + trigger `profesional_tipos_atencion_protegidos` |
| B | ADMIN | `profesional_tipos_atencion` | UPDATE (`estado`) | aprobar o rechazar; registra `revisado_por`/`revisado_en`; otro rol: 0 filas | GRANT por columna + `profesional_tipos_atencion_update` + trigger |
| B | todos | `profesional_tipos_atencion` | lectura publica | solo APROBADOS cuentan en `perfiles_publicos()` (match) y `directorio_interno()` (candidatos de derivacion) | funciones |
| B | todos (autenticados) | `espacios` | SELECT | todos | GRANT + `espacios_select` |
| B | ADMIN / GESTION | `espacios` | INSERT, UPDATE | todos; nunca DELETE (se desactiva) | GRANT + `espacios_insert` / `_update` |
| B | todos (autenticados) / ADMIN | `intervenciones`, `estados_avance` | SELECT / INSERT, UPDATE | todas; nunca DELETE (se desactiva) | GRANT + `*_select` / `*_insert` / `*_update` |
| A+C | todos (autenticados) | `bloqueos_temporales` | SELECT, INSERT, UPDATE, DELETE | `usuario_id` = yo; retiene al profesional siempre y el box solo si es presencial | GRANT + `bloqueos_temporales_propios` + CHECK `bloqueos_temporales_espacio_segun_modalidad` |
| A+C | todos (autenticados) | `bloqueos_temporales` (ajenos) | lectura | espacio, inicio, fin de bloqueos activos | `ocupacion_espacios(desde, hasta)` |
| A+C | ADMIN / GESTION | `citas` | SELECT, INSERT, UPDATE | todas | GRANT + `citas_*` |
| A+C | PROFESIONAL / PRACTICANTE | `citas` | SELECT, UPDATE | `profesional_id` = yo | GRANT + `citas_select` / `_update` |
| A+C | PROFESIONAL / PRACTICANTE | `citas` | INSERT (y resultado de UPDATE) | `profesional_id` = yo y paciente propio | GRANT + `citas_insert` / `_update` |
| A+C | PACIENTE | `citas` | SELECT | sus citas | `citas_select` |
| A+C | todos | `citas` | INSERT, UPDATE | box solo si PRESENCIAL; sin solapamiento CONFIRMADA por profesional (ambas modalidades) ni por box (solo presencial), incluso con citas que el contexto no ve | CHECK `citas_espacio_segun_modalidad` (23514) + `EXCLUDE` `citas_no_solapamiento_*` (23P01) |
| A+C | todos | `citas` | INSERT, UPDATE a CONFIRMADA | margen de traslado entre distinta modalidad del mismo profesional (margen fijado al confirmar; ambos sentidos) | trigger `citas_margen_fijado` + `EXCLUDE` `citas_margen_traslado` (23P01) |
| A+C | todos | `citas` | INSERT, UPDATE | `enlace_online` solo en ONLINE y cifrado (CLINICO) | CHECK `citas_enlace_solo_online` + `citas_cifrado` (23514) |
| A+C | todos | `citas` | INSERT, UPDATE a CONFIRMADA | dentro de la disponibilidad de su modalidad y fuera de bloqueos de agenda | trigger `citas_agenda_valida` (23514) |
| A+C | todos | `citas` | INSERT, UPDATE | paciente menor exige adulto responsable | trigger `citas_menor_requiere_adulto_responsable` (23514) |
| A+C | todos | `citas` | DELETE | ninguna (cancelar = `estado`) | sin GRANT |
| A+C | todos (autenticados) | `citas` (ocupacion) | lectura | espacio, inicio, fin de toda cita CONFIRMADA + bloqueos activos | `ocupacion_espacios(desde, hasta)` |
| A | ADMIN / GESTION | `pagos`, `boletas` | SELECT | todos | GRANT + `pagos_select` / `boletas_select` |
| A | todos | `pagos`, `boletas` | INSERT, UPDATE | ninguna directa (02h): `registrar_pago`, `anular_pago`, `resolver_cita`, `emitir_boleta` | sin GRANT de escritura |
| A | todos (incluso dueño) | `pagos` | UPDATE, DELETE | solo anular una vez (REGISTRADO -> ANULADO con motivo); nunca DELETE | trigger `pagos_append_only` (23001) + CHECK `pagos_anulacion_coherente` |
| A | todos (incluso dueño) | `boletas` | UPDATE, DELETE | solo `pdf_url` de nulo a generado; una por cita | trigger `boletas_append_only` (23001) + UNIQUE `cita_id` |
| A | PROFESIONAL / PACIENTE | `pagos`, `boletas` | SELECT | de sus citas | `pagos_select` / `boletas_select` (subconsulta bajo su RLS) |
| A | PRACTICANTE | `pagos`, `boletas` | todas | ninguna | politicas sin rama |
| A | todos | `pagos`, `boletas` | DELETE | ninguna | sin GRANT |
| A | ADMIN / GESTION / PROFESIONAL / PACIENTE | `estado_pago_citas` (vista, `security_invoker`) | SELECT | monto, exigible, pagado, devolucion, saldo y estado (SIN_COBRO, PENDIENTE, PARCIAL, PAGADO) de las citas que su RLS deja ver; PRACTICANTE 0 filas | GRANT + RLS de `citas`, `pagos` y `resoluciones_cita` |
| A | todos (incluso dueño) | `citas` | INSERT, UPDATE | `monto` lo fija la BD al confirmar con la tarifa mas especifica vigente (sin tarifa = 0) y es inmutable; `cancelada_en` lo fija la BD | trigger `citas_monto_fijado` (23001) |
| A | ADMIN / GESTION | `resoluciones_cita` | SELECT | todas; escritura solo `resolver_cita` | GRANT + `resoluciones_cita_select` |
| A | PROFESIONAL / PACIENTE | `resoluciones_cita` | SELECT | de sus citas | `resoluciones_cita_select` |
| A | todos (incluso dueño) | `resoluciones_cita` | UPDATE, DELETE | ninguna (una decision por cita) | trigger `resoluciones_cita_append_only` (23001) + UNIQUE `cita_id` |
| A | ADMIN / GESTION | `liquidaciones` | SELECT | todas; escritura solo `generar_liquidacion` / `avanzar_liquidacion` | GRANT + `liquidaciones_select` |
| A | PROFESIONAL | `liquidaciones` | SELECT | las suyas EMITIDA o PAGADA (nunca BORRADOR) | `liquidaciones_select` |
| A | todos (incluso dueño) | `liquidaciones` | INSERT, UPDATE, DELETE | sin solape por profesional; solo BORRADOR se recalcula; EMITIDA -> PAGADA | EXCLUDE `liquidaciones_sin_solape` (23P01) + trigger `liquidaciones_protegidas` (23001) |
| A | ADMIN / GESTION | `arriendos` | SELECT, INSERT, UPDATE | todos; por periodo `[periodo_desde, periodo_hasta)` (02h) | GRANT + `arriendos_*` + CHECK `arriendos_validos` |
| A | PROFESIONAL | `arriendos` | SELECT | los suyos | `arriendos_select` |
| A | todos | `arriendos` | DELETE | ninguna | sin GRANT |
| A | ADMIN | `derivaciones` | SELECT | todas | GRANT + `derivaciones_select` |
| A | PROFESIONAL | `derivaciones` | SELECT | origen = yo, o tratante actual de la ficha | `derivaciones_select` |
| A | candidato | `derivaciones` | SELECT | ninguna (solo `oferta_derivacion`) | `derivaciones_select` |
| A | todos | `derivaciones` | INSERT, UPDATE | ninguna directa; solo via funciones; motivo no vacio | sin GRANT + CHECK `derivaciones_motivo_no_vacio` |
| A | todos | `derivaciones` | DELETE | ninguna | sin GRANT + trigger `derivaciones_sin_delete` |
| A | ADMIN / origen / tratante | `derivacion_candidatos` | SELECT | candidatos de derivaciones que ve | GRANT + `derivacion_candidatos_select` |
| A | candidato | `derivacion_candidatos` | SELECT | su propia fila | `derivacion_candidatos_select` |
| A | todos (incluso dueño) | `derivacion_candidatos` | INSERT, UPDATE | max. una OFRECIDA y una ACEPTADA por derivacion; una fila activa por profesional | indices unicos parciales (23505) |
| A | todos | `derivacion_candidatos` | INSERT, UPDATE, DELETE | ninguna directa; solo via funciones | sin GRANT |
| A | todos | `accesos_ficha` | INSERT | `usuario_id` = yo y `rol` = mi rol de contexto | GRANT + `accesos_ficha_insert` |
| A | ADMIN | `accesos_ficha` | SELECT | todas | GRANT + `accesos_ficha_select` |
| A | todos (incluso dueño) | `accesos_ficha` | UPDATE, DELETE | ninguna | sin GRANT + trigger `accesos_ficha_append_only` |
| A | todos (app_user) | `llaves_datos`, `custodios_llave`, `eventos_llaves` | todas | ninguna directa (`llaves_vigentes()`, `registrar_evento_llaves()`) | sin GRANT (RLS sin politicas) |
| A | ADMIN / GESTION / el propio | `roles_adicionales` (03a) | SELECT | todas / las suyas; escritura solo `otorgar_rol_adicional` / `iniciar_baja_rol` / `procesar_bajas` | GRANT SELECT + `roles_adicionales_select`; CHECK solo PROFESIONAL; trigger `roles_adicionales_validos` (23514 `roles_adicionales_combinacion`: principal ADMIN o GESTION) |
| A | todos | `usuarios` (03a) | rol activo de la sesion | `acceso_vigente()` acepta el rol principal o un adicional activo; cambiar el principal a PROFESIONAL desactiva el adicional; un exclusivo (PRACTICANTE, PACIENTE, RESPONSABLE) no convive con adicionales | trigger `usuarios_roles_coherentes`; `roles_adicionales_revoca_sesiones` corta las sesiones del rol dado de baja |
| A | todos (app_user) | `tokens_correo` (03a) | todas | ninguna directa: emitir y consumir solo via funciones (un solo uso, vence; solo el SHA-256) | sin GRANT (RLS sin politicas) + CHECK `tokens_correo_coherente` |
| B | todos (autenticados) / ADMIN | `politicas` (03a) | SELECT / INSERT | todas; version nueva = max + 1 (la fija la BD); nunca UPDATE ni DELETE | GRANT + `politicas_select` / `politicas_insert` + triggers `politicas_versionadas`, `politicas_append_only` (23001) |
| A | ADMIN / GESTION; paciente adulto o responsable; tratante | `aceptaciones_politica` (03a) | SELECT | todas; las propias (`app_pacientes_plenos`); de sus pacientes. Escritura solo `registrar_aceptacion`, `responder_token_consentimiento`, `concretar_solicitud_hora` | GRANT SELECT + `aceptaciones_politica_select` + trigger append-only + CHECK `aceptaciones_politica_coherente` (PRESENCIAL exige respaldo; menor: adulto responsable) |
| A | todos (app_user) | `solicitudes_hora` (03a) | todas | ninguna directa (portal publico via funciones; respuestas del match solo `respuestas_match_paciente`) | sin GRANT + CHECK `solicitudes_hora_coherente` / `_cifrado` |
| A+C | portal (sin usuario) | `bloqueos_temporales` (03a) | retencion de una solicitud | `usuario_id` nulo solo con `solicitud_id` (la crea `crear_solicitud_hora`, la borra `concretar_solicitud_hora` o el job) | CHECK `bloqueos_temporales_dueno` |
| A+C | todos | `citas` (03a) | INSERT, UPDATE | SOLICITADA retiene el horario (EXCLUDE por profesional y box); dentro del horario del centro y del box si existen; mover a otro profesional exige tratante o acceso temporal vigente en el horario | `citas_no_solapamiento_*` (23P01) + trigger `citas_agenda_valida` (23514 `citas_dentro_de_horario_centro` / `_espacio`) + trigger `citas_profesional_con_acceso` (23514) |
| A | todos | `citas` (03a) | aviso de hora liberada | cancelar, pasar a reprogramar o mover una cita futura avisa a la lista de espera (HORA_LIBERADA, sin autor) | trigger `citas_hora_liberada` |
| B | todos (autenticados) / ADMIN | `horario_centro` (03a) | SELECT / INSERT, DELETE | todos; minutos locales 0-1440 | GRANT + `horario_centro_select` / `horario_centro_admin` + CHECK `horario_centro_valido` |
| B | todos (autenticados) / ADMIN, GESTION | `horarios_espacio` (03a) | SELECT / INSERT, DELETE | todos | GRANT + `horarios_espacio_select` / `horarios_espacio_gestion` + CHECK `horarios_espacio_valido` |
| A | ADMIN / GESTION; PROFESIONAL; paciente o responsable | `lista_espera` (03a) | SELECT, INSERT, UPDATE (estado, cerrada_en) | todas; las suyas y de sus pacientes; las propias o de sus menores | GRANT + `lista_espera_*` + CHECK `lista_espera_coherente` (profesional o tipo de atencion) |
| C | todos (autenticados) / el propio o ADMIN | `imagenes_publicas` (03a) | SELECT / INSERT | todas; FOTO_PERFIL propia (equipo) o cualquiera ADMIN (LOGO); append-only; sin cifrar por diseño (publicas, sin metadatos) | GRANT + `imagenes_publicas_*` + CHECK `imagenes_publicas_validas` + trigger append-only; lectura publica `imagen_publica()` |
| C | todos (autenticados) / ADMIN | `contenido_publico` (03a) | SELECT / UPDATE | la fila unica | GRANT por columna + `contenido_publico_*` + CHECK `contenido_publico_valido`; lectura publica `contenido_publico_centro()` |
| B | ADMIN | `configuracion_centro` (03a) | UPDATE de `modulos_activos` | ninguna (solo el operador, como dueño); Match requiere Equipo y Cobros Agenda | sin GRANT de esa columna + CHECK `configuracion_centro_modulos_coherentes` |
| B | todos (autenticados) / ADMIN | `match_preguntas`, `match_opciones` (03a) | SELECT / INSERT, UPDATE | todas; nunca DELETE (se desactivan) | GRANT + politicas `match_*` + CHECK `match_preguntas_validas`, `match_opciones_validas`; lectura publica `cuestionario_match()` |
| C | ADMIN (metricas) | `match_resultados` (03a) | todas | ninguna directa: `registrar_resultado_match` (anonimo, sin respuestas) y `metricas_match` | sin GRANT |
| A | autor / PROFESIONAL | `resenas` (03a) | SELECT | las que escribio / las recibidas (incluye feedback privado). ADMIN solo via `resenas_para_moderar` (sin feedback). Escritura solo via funciones | GRANT SELECT + `resenas_select` + UNIQUE (paciente, profesional) (23505) + CHECK `resenas_coherente` |
| A | todos (app_user) | `resenas_reportes` (03a) | todas | ninguna directa (`reportar_resena`) | sin GRANT |
| A | ADMIN | `resenas_eventos` (03a) | SELECT | todas; append-only (sobrevive a la reseña) | GRANT SELECT + `resenas_eventos_select` + trigger append-only |
| A | tratante (o acceso temporal) | `altas_paciente` (03a) | SELECT | de sus pacientes; ADMIN/GESTION no (motivo clinico); escritura solo `registrar_alta`; append-only | GRANT SELECT + `altas_paciente_select` + `_consentimiento_practicante` + trigger append-only |
| A | ADMIN / PROFESIONAL (receptor o tratante) | `accesos_clinicos_temporales` (03a) | SELECT | todos / los que recibio y los de sus pacientes; escritura solo `otorgar_acceso_temporal`; append-only (se corta solo al vencer) | GRANT SELECT + `accesos_clinicos_temporales_select` + trigger append-only + CHECK (hasta 180 dias) |
| A | PROFESIONAL con acceso temporal | `pacientes`, `fichas_clinicas`, `evoluciones`, `adultos_responsables`, `documentos_clinicos`, `adjuntos_ficha` (03a) | SELECT (y INSERT de evoluciones con LECTURA_ESCRITURA) | del paciente, mientras el acceso este vigente | `acceso_temporal_vigente()` / `acceso_temporal_ficha()` en las politicas |
| A | autor (PROFESIONAL / PRACTICANTE tratante o con acceso temporal de escritura) | `borradores_evolucion` (03a) | SELECT, INSERT, UPDATE, DELETE | los propios (no son ficha: se descartan); contenido cifrado | GRANT + `borradores_evolucion_autor` + `_consentimiento_practicante` + CHECK `borradores_evolucion_cifrado` |
| B | equipo (ADMIN, GESTION, PROFESIONAL, PRACTICANTE) / ADMIN | `especialidades` (03a-2) | SELECT / INSERT, UPDATE (nombre, activo) | todas; nunca DELETE (se desactiva); PACIENTE y RESPONSABLE nada | GRANT + `especialidades_*` |
| B | PROFESIONAL (propio) / ADMIN, GESTION / equipo | `profesional_especialidades` (03a-2) | INSERT (PROPUESTO) / SELECT | las propias; todas; las APROBADAS. Revision solo `revisar_especialidad` (ADMIN) | GRANT SELECT, INSERT + `profesional_especialidades_*` + CHECK `profesional_especialidades_revision_coherente` |
| B | equipo / ADMIN y autor | `plantillas_clinicas` (03a-2) | SELECT | PUBLICADA e INACTIVA: todo el equipo; BORRADOR: ADMIN y quien la propuso. Escritura solo via funciones; publicada inmutable (solo pasa a INACTIVA) y nunca se borra, incluso como dueño | GRANT SELECT + `plantillas_clinicas_select` + CHECK `plantillas_clinicas_validas` (`definicion_plantilla_valida`) + indices unicos (una PUBLICADA y un BORRADOR por familia) + trigger `plantillas_clinicas_protegidas` (23001) |
| A | PROFESIONAL / PRACTICANTE tratante o con acceso temporal | `ingresos_ficha` (03a-2) | SELECT (lectura temporal) / INSERT (tratante o escritura temporal) | de la ficha que ve; valores cifrados (un JSON); plantilla INGRESO publicada (PROFESIONAL: de su especialidad aprobada); correccion = fila nueva con la misma version | GRANT SELECT, INSERT + `ingresos_ficha_*` + `_consentimiento_practicante` + CHECK `ingresos_ficha_cifrado` + trigger `ingresos_ficha_plantilla_valida` (23514) |
| A | ADMIN / GESTION / PACIENTE | `ingresos_ficha` | todas | ninguna (como evoluciones) | politicas sin rama |
| A | todos (incluso dueño) | `ingresos_ficha` | UPDATE, DELETE | append-only (retencion de la ficha) | trigger `ingresos_ficha_append_only` (23001) |
| A | todos | `evoluciones`, `borradores_evolucion` (03a-2) | INSERT (y UPDATE de plantilla en borradores) | `plantilla_id` + `valores` juntos y cifrados; plantilla EVOLUCION publicada (PROFESIONAL: de su especialidad aprobada); correccion con la misma version. RUT obligatorio antes de la primera evolucion para todo paciente | CHECK `*_plantilla_coherente` + triggers `*_plantilla_valida` (23514 `registro_plantilla_valida`, `registro_plantilla_especialidad`) + `evoluciones_cita_valida` (`evoluciones_paciente_requiere_rut`) |
| A | equipo con acceso clinico vigente (tratante PROFESIONAL, PRACTICANTE con consentimiento, acceso temporal) | `hilos_internos` CASO, `mensajes_internos`, `lecturas_hilo` (03a-2) | SELECT; INSERT de mensajes (autor = usuario, `rol_autor` = rol activo) y de la lectura propia | del paciente al que tiene acceso, verificado en cada consulta (`hilo_visible`); ADMIN, GESTION y supervision nunca | GRANT + `hilos_internos_select`, `mensajes_internos_*`, `lecturas_hilo_*` + CHECK `hilos_internos_coherentes`, `mensajes_internos_coherentes` |
| A | participantes (ADMIN, GESTION, PROFESIONAL, PRACTICANTE vigentes) | `hilos_internos` GENERAL, `participantes_hilo`, `mensajes_internos`, `lecturas_hilo` (03a-2) | SELECT; INSERT de mensajes y lectura propia | los hilos donde participa (sin paciente; no se nombra a pacientes). Crear hilo y agregar participantes solo via funciones | igual que arriba |
| A | todos (incluso dueño) | `mensajes_internos` | UPDATE, DELETE | sin edicion: solo `retirar_mensaje_interno` (autor, 5 minutos) y la purga por retencion | sin GRANT UPDATE/DELETE + trigger `mensajes_internos_protegidos` (23001) |
| A | todos (app_user) | `correos_cuenta_pendientes` (03a-2) | todas | ninguna directa; destinatario y cuerpo cifrados | sin GRANT; `encolar_correo_cuenta`, `correos_cuenta_por_enviar`, `resultado_correo_cuenta` (solo sin contexto) |
| A | todos (app_user) | `pacientes` (03a-2) | UPDATE (`posible_duplicado`) | ninguna directa: solo `resolver_posible_duplicado` (ADMIN/GESTION) | sin GRANT de la columna; trigger `pacientes_alerta_duplicado` (alerta + aviso a ADMIN/GESTION) |
| A | todos | `evoluciones` (03a) | INSERT | `cita_id` de una cita del mismo paciente; paciente del portal: RUT registrado antes de su primera evolucion | trigger `evoluciones_cita_valida` (23514 `evoluciones_cita_del_paciente`, `evoluciones_paciente_requiere_rut`) |
| A | RESPONSABLE (03a) | `pacientes`, `adultos_responsables`, `citas`, `pagos`, `boletas`, `resoluciones_cita`, `estado_pago_citas`, `documentos_clinicos`, `consentimientos`, `solicitudes_epicrisis`, `recordatorios_cita`, `notificaciones`, `preferencias_notificacion` | SELECT (epicrisis tambien INSERT) | de sus pacientes menores (`pacientes_a_cargo()`); nunca ficha ni evoluciones | politicas con `pacientes_a_cargo()` / `app_pacientes_plenos()` |
| A | RESPONSABLE (03a) | `mensajes_paciente` | SELECT, INSERT | solo los que el escribio (`autor_id`), por un menor a cargo, a su equipo tratante; nunca los del adolescente | `mensajes_paciente_select` / `_insert` |
| A | PACIENTE de 14 a 17 (03a) | `pagos`, `boletas`, `resoluciones_cita`, `estado_pago_citas`, `documentos_clinicos`, `consentimientos`, `solicitudes_epicrisis`, `aceptaciones_politica` | todas | ninguna (cuenta restringida: citas, recordatorios y mensajes) | `app_pacientes_plenos()` (solo adultos) |
| A | PACIENTE | `pacientes` (03a) | UPDATE | solo telefono (`actualizar_telefono_paciente`) y correo verificado (`usar_token_cambio_correo`) | sin politica de UPDATE para PACIENTE |
| A | todos (app_user) | `sesiones` | todas | ninguna directa (refresh tokens: solo el SHA-256) | sin GRANT; `crear_sesion` / `rotar_sesion` / `revocar_sesion` + trigger `usuarios_revoca_sesiones` |
| A | ADMIN | `alertas_internas` | SELECT | todas | GRANT + `alertas_internas_select`; escritura solo via `alertar_bajas_sin_admin` / `alertar_fallo_canario` / `atender_alerta` |
| A | todos (incluso dueño) | `alertas_internas` | UPDATE, DELETE | solo marcar atendida una vez (funcion) | sin GRANT + trigger `alertas_internas_append_only` (23001) |
| A | ADMIN / GESTION | `notificaciones` | SELECT | todas (la API les expone solo metadatos; el contenido, en la bandeja propia) | GRANT + `notificaciones_select` |
| A | destinatario (usuario o PACIENTE) | `notificaciones` | SELECT | las propias (bandeja: canal BANDEJA, asunto y cuerpo cifrados) | `notificaciones_select` |
| A | todos (autenticados) | `notificaciones` | INSERT | 02i: ninguna directa; via `notificar()` (a nombre del actor; una fila BANDEJA + CORREO segun plantilla y preferencias) | sin GRANT INSERT; avance solo via funciones del job + trigger `notificaciones_append_only` (23001) + CHECK `notificaciones_coherente` (WHATSAPP reservado) |
| A | BD (triggers, jobs) | `notificaciones` | INSERT | via `encolar_notificacion`: oferta al candidato (DERIVACION_OFRECIDA) cada vez que pasa a OFRECIDA, incluso via job o rechazo; cambio de estado al origen (DERIVACION_ACTUALIZADA, una pendiente por derivacion y canal); recordatorios; consentimientos por vencer; cancelacion por token. `creada_por_id` nulo | triggers `derivacion_candidatos_notificar`, `derivaciones_notificar`; funciones de job |
| B | ADMIN | `plantillas_mensaje` | SELECT, UPDATE (asunto, cuerpo, activa) | todas; variables solo de la lista permitida; BANDEJA no se desactiva; el ejemplo es fijo; sin INSERT ni DELETE (02i) | GRANT + `plantillas_mensaje_admin` + CHECK `plantillas_mensaje_variables_permitidas`, `plantillas_mensaje_coherente` (23514) |
| B | resto | `plantillas_mensaje` | todas | ninguna | politica sin rama |
| A | PACIENTE | `preferencias_notificacion` | SELECT, INSERT, UPDATE (recordatorios, avisos_operativos) | las propias; los avisos legales no tienen columna (02i) | GRANT + `preferencias_notificacion_*`; DELETE bloqueado (trigger) |
| A | ADMIN / GESTION | `preferencias_notificacion` | SELECT | todas | `preferencias_notificacion_select` |
| A | ADMIN / GESTION; PROFESIONAL / PACIENTE | `recordatorios_cita` | SELECT | todos; de citas que ven (02i). Escritura solo via `registrar_recordatorio` (job) y `responder_recordatorio` (token) | GRANT SELECT + `recordatorios_cita_select` + CHECK `recordatorios_cita_coherente` + trigger `recordatorios_cita_protegidos` (23001) |
| A | PROFESIONAL / PRACTICANTE tratante | `adjuntos_ficha` | SELECT, INSERT | de sus pacientes (PRACTICANTE con consentimiento); PDF, PNG o JPEG; contenido cifrado (02i) | GRANT + `adjuntos_ficha_*` + `_consentimiento_practicante` + CHECK `adjuntos_ficha_archivo` |
| A | ADMIN / GESTION / PACIENTE | `adjuntos_ficha` | todas | ninguna (como la ficha clinica) | politicas sin rama |
| A | todos (incluso dueño) | `adjuntos_ficha` (UPDATE, DELETE), `preferencias_notificacion` (DELETE) | UPDATE, DELETE | append-only | triggers `adjuntos_ficha_append_only`, `preferencias_notificacion_sin_delete` (23001) |
| A | PACIENTE | `mensajes_paciente` | SELECT, INSERT | los propios; destinatario solo de su equipo tratante (`mi_equipo_tratante`); contenido cifrado | GRANT + `mensajes_paciente_*` + CHECK `mensajes_paciente_cifrado` |
| A | PROFESIONAL / PRACTICANTE | `mensajes_paciente` | SELECT | los recibidos; marcar leido via `marcar_mensaje_leido` | `mensajes_paciente_select` |
| A | ADMIN / GESTION | `mensajes_paciente` | todas | ninguna (contenido del paciente) | politicas sin rama |
| A | PACIENTE | `solicitudes_epicrisis` | SELECT, INSERT | las propias (SOLICITADA); motivo cifrado | GRANT + `solicitudes_epicrisis_*` + CHECK `solicitudes_epicrisis_cifrado` |
| A | ADMIN / GESTION / tratante | `solicitudes_epicrisis` | SELECT | todas / de sus pacientes; resuelven ADMIN o el tratante via `resolver_solicitud_epicrisis` | `solicitudes_epicrisis_select` |
| A | todos (incluso dueño) | `mensajes_paciente`, `solicitudes_epicrisis` | UPDATE, DELETE | solo via funciones; nunca DELETE | sin GRANT + triggers `*_append_only` (23001) |
| B | equipo / ADMIN | `tipos_documento_clinico` | SELECT / INSERT, UPDATE (nombre, activo, plantilla) | todos; nunca DELETE (se desactiva); plantilla con variables permitidas (02i) | GRANT + `tipos_documento_clinico_*` + CHECK `tipos_documento_clinico_plantilla_valida` (23514) |
| B | PACIENTE | `tipos_documento_clinico` | SELECT | solo los tipos de sus documentos (titulo del PDF, 02i) | `tipos_documento_clinico_select_paciente` (via `tipo_documento_del_paciente`) |
| A | PROFESIONAL / PRACTICANTE tratante | `documentos_clinicos` | SELECT, INSERT | de sus pacientes (PRACTICANTE con consentimiento); tipo activo; contenido cifrado | GRANT + `documentos_clinicos_*` + `_consentimiento_practicante` + CHECK `documentos_clinicos_cifrado` |
| A | PACIENTE | `documentos_clinicos` | SELECT | los suyos; pide adjunto via `solicitar_adjunto_documento`; descarga via `registrar_descarga_documento` | `documentos_clinicos_select` |
| A | ADMIN / GESTION | `documentos_clinicos` | todas | ninguna (contenido clinico) | politicas sin rama |
| A | tratante | `envios_documento` | SELECT, INSERT | de documentos que ve; ENLACE (hash del token + URL cifrada + expiracion) o ADJUNTO solo con solicitud del paciente | GRANT + `envios_documento_*` + CHECK `envios_documento_coherente` + trigger `envios_documento_adjunto_solicitado` (23514) |
| A | ADMIN | `envios_documento`, `descargas_documento` | SELECT | todos (auditoria, sin el documento) | `*_select` |
| A | tratante / PACIENTE | `descargas_documento` | SELECT | de documentos que ve; escritura solo `registrar_descarga_documento` | GRANT SELECT + `descargas_documento_select` |
| A | todos (incluso dueño) | `documentos_clinicos`, `envios_documento`, `descargas_documento` | UPDATE, DELETE | append-only (documento: solo registrar una vez la solicitud de adjunto) | triggers `*_append_only` (23001) |
| A | PROFESIONAL / PRACTICANTE | `salas_videollamada` | SELECT, INSERT, UPDATE | la propia (modo ENLACE_PROPIO o JITSI; enlace cifrado) | GRANT + `salas_videollamada_*` + CHECK `salas_videollamada_cifrado` |
| A | ADMIN / GESTION | `salas_videollamada` | SELECT | todas (agendan citas online por otros) | `salas_videollamada_select` |
| A | PROFESIONAL / PRACTICANTE | `feeds_calendario` | SELECT, INSERT, UPDATE | el propio (solo el SHA-256 del token) | GRANT + `feeds_calendario_propio` |
| A | dueño (scripts de llaves) | `llaves_datos` | UPDATE / DELETE | solo activar, retirar y re-envolver / nunca | trigger `llaves_datos_protegidas` (23001) |
| A | todos (incluso dueño) | `eventos_llaves` | UPDATE, DELETE | ninguna | trigger `eventos_llaves_append_only` (23001) |

## Funciones (EXECUTE solo `app_user`; `SECURITY DEFINER`, `search_path` fijo)

| Cat. | Rol | Funcion | Alcance | Errores |
|---|---|---|---|---|
| C | sin contexto | `credenciales_login(email)` | id, password_hash, rol, activo, fecha_expiracion_acceso, paciente_id del email | — |
| C | sin contexto | `perfiles_publicos()` | id, nombre_publico, bio, foto_url, especialidad, enfoques, modalidad, tipos_atencion, verificado, titulos_verificados, tarifas vigentes de PROFESIONAL activos, sin baja, con `perfil_publico`. Nunca RUT, datos bancarios ni contacto | — |
| C | sin contexto (perfil publico) / autenticados | `disponibilidad_publica(profesional, desde, hasta)` | modalidad, inicio, fin de huecos libres (max. 62 dias); sin motivos | 23514 |
| C | ADMIN / GESTION / PROFESIONAL / PRACTICANTE | `directorio_interno()` | id, nombre, rol, tipos_atencion (activos) del equipo activo; email/telefono (cifrado) solo ADMIN/GESTION; PRACTICANTE solo ve a su supervisor | 42501 |
| A | PACIENTE | `datos_pago_profesional(cita)` | datos bancarios cifrados del profesional de SU cita CONFIRMADA con saldo > 0 (02h: "pago pendiente"), solo con cobro directo; 0 filas si no aplica; audita DATOS_PAGO | 42501 |
| A | sin contexto (API al arrancar) | `llaves_vigentes()` | todas las versiones envueltas con la KEK + huella + canario; nunca la envoltura de recuperacion | — |
| A | sin contexto (API) | `registrar_evento_llaves(tipo, detalle)` | solo VERIFICACION / FALLO_CANARIO | 42501 |
| C | ADMIN / supervisor vigente | `derivaciones_pendientes()` | derivacion_id, estado, motivo y detalle (cifrados), tipo, edad de PENDIENTE/SIN_ASIGNAR de todo el centro (minimo necesario para proponer); audita | 42501 |
| A | ADMIN | `cambiar_supervisor(practicante, nuevo)` | cierra y abre supervision en la misma transaccion; un aviso por paciente con consentimiento; devuelve cuantos | 42501, P0002, 55000, 23514 |
| A | PACIENTE (o su adulto responsable si es menor) / ADMIN / GESTION con respaldo | `responder_aviso_consentimiento(aviso, respuesta, otorgado_por, adulto, respaldo)` | CONFORME u OPOSICION (= revocacion del consentimiento); una vez, dentro del plazo | 42501, P0002, 55000, 23514 |
| A | job sin contexto | `cerrar_avisos_vencidos()` | avisos sin respuesta al vencer -> CONFORME tacito; idempotente; devuelve cuantos | — |
| A | ADMIN | `fichas_sobre_retencion()` | fichas con ultima atencion > 15 años + ultima revision; registra la consulta (`consultas_retencion`) y cada ficha (`accesos_ficha` RETENCION) | 42501 |
| A | ADMIN / GESTION / el propio profesional | `citas_en_conflicto_margen(profesional)` | pares de citas futuras que no cumplen el margen vigente (no se mueven solas) | 42501 |
| A | ADMIN / supervisor vigente del practicante | `proponer_practicante(derivacion, practicante)` | agrega al practicante al final | 42501, P0002, 55000, 23514 |
| A | PACIENTE (el propio o su adulto responsable si es menor) / ADMIN / GESTION con respaldo | `responder_consentimiento(id, acepta, version, otorgado_por, adulto, respaldo)` | ACEPTADO concreta el traspaso; RECHAZADO pasa al siguiente candidato | 42501, P0002, 55000, 23514 |
| A | idem | `revocar_consentimiento(id, revocado_por, adulto, respaldo)` | corte inmediato, citas futuras con el practicante POR_REPROGRAMAR, bandeja | 42501, P0002, 55000, 23514 |
| A | ADMIN / supervisor vigente | `solicitar_consentimiento(paciente)` | nueva solicitud para el practicante tratante y su supervisor actual | 42501, 23514, 23505 |
| C | PACIENTE | `mi_equipo_tratante()` | id, nombre de su tratante y de los profesionales de sus citas | 42501 |
| C | autenticados | `ocupacion_espacios(desde, hasta)` | espacio_id, inicio, fin (citas CONFIRMADA + bloqueos activos) | 42501 |
| C | supervisor (PROFESIONAL) | `supervision_casos()` | codigo seudonimo, practicante_id, edad_paciente, tipo_atencion de casos vigentes con consentimiento; audita SUPERVISION | 42501 |
| C | supervisor (PROFESIONAL) | `supervision_evoluciones(codigo)` | evolucion_id, autor_id, contenido, corrige_a_id, creado_en del practicante en ese caso; 0 filas si no es su caso; audita SUPERVISION | 42501 |
| A | ADMIN | `otorgar_acceso_practicante(practicante, fecha_expiracion)` | fija la expiracion (y reactiva si esta en gracia) + OTORGADO en bitacora; exige supervision vigente; cuenta cerrada -> 55000 | 42501, P0002, 55000, 23514 |
| A | ADMIN | `revocar_acceso_practicante(practicante, motivo)` | desactiva, citas futuras POR_REPROGRAMAR, REVOCADO en bitacora | 42501, P0002, 55000, 23514 |
| A | ADMIN | `iniciar_baja_profesional(usuario, fecha_efectiva)` | cualquier cuenta de equipo (GESTION como PROFESIONAL; ADMIN: nunca la propia ni la del ultimo ADMIN); no a quien supervisa practicantes activos; bloqueo de agenda BAJA y citas desde la fecha POR_REPROGRAMAR; devuelve cuantas | 42501, P0002, 55000, 23514, 23505 |
| A | job sin contexto | `procesar_bajas()` | practicantes vencidos -> inactivos + EXPIRADO; bajas cumplidas -> inactivas y cerradas; barrido de citas; cierra cuentas inactivas sin baja pasada la gracia; idempotente; devuelve desactivados | — |
| A | ADMIN / GESTION (con nombre) / supervisor vigente (sin nombre, solo sus practicantes) | `pacientes_por_reasignar()` | paciente, ficha, codigo, nombre, apellido, tratante, motivo (BAJA, ACCESO_REVOCADO, ACCESO_EXPIRADO, SIN_SUPERVISION, CONSENTIMIENTO, TRATANTE_INACTIVO), derivacion_abierta | 42501 |
| A | PROFESIONAL tratante / ADMIN o supervisor vigente de oficio | `crear_derivacion(id, ficha, motivo, tipo_atencion_id, detalle, candidatos[])` | `id` y motivo/detalle cifrados los da la API; de oficio solo si el paciente esta en la bandeja; `creada_por` = actor | 42501, 23514 (candidato, tipo inactivo, cifrado invalido), 23505 |
| A | ADMIN | `definir_candidatos_derivacion(id, candidatos[])` | reemplaza/agrega/reordena pendientes; PRACTICANTE solo con supervision vigente | 42501, P0002, 55000, 23514 |
| A | ADMIN | `reintegrar_candidato(id, profesional)` | candidato RECHAZADA/EXPIRADA/OMITIDA vuelve como fila nueva al final | 42501, P0002, 55000, 23514 |
| A | ADMIN (PENDIENTE o SIN_ASIGNAR) / origen (solo SIN_ASIGNAR) | `cancelar_derivacion(id, motivo)` | PENDIENTE -> CANCELADA, SIN_ASIGNAR -> CERRADA; motivo obligatorio | 42501, P0002, 55000, 23514 |
| C | candidato OFRECIDO | `oferta_derivacion(id)` | motivo y detalle (cifrados), tipo_atencion, edad_paciente, vence_en, citas_en_conflicto; 0 filas si no hay oferta | 42501 |
| A | candidato OFRECIDO (PROFESIONAL / PRACTICANTE) | `responder_derivacion(id, acepta)` | PROFESIONAL acepta: traspaso + citas futuras (si chocan, POR_REPROGRAMAR). PRACTICANTE acepta: ESPERANDO_CONSENTIMIENTO + solicitud (48 h). Rechazo: siguiente | 42501, 55000 |
| A | job sin contexto | `expirar_ofertas_derivacion()` | ofertas vencidas -> EXPIRADA; solicitudes de consentimiento vencidas -> VENCIDO + candidato RECHAZADO_POR_PACIENTE; siguiente; devuelve cuantas | — |
| A | ADMIN | `reporte_citas_por_profesional(desde, hasta)` | agregados por profesional; dueño `app_reportes` | 42501 |
| A | sin contexto (login) | `crear_sesion(usuario, rol, hash, expira)` | abre una familia si la cuenta esta habilitada (activa, rol de la BD, practicante vigente y supervisado) | 42501 |
| A | sin contexto (refresh) | `rotar_sesion(hash, hash_nuevo, expira)` | rota; reuso o cuenta sin acceso: revoca la familia y 0 filas | — |
| A | sin contexto (logout) | `revocar_sesion(hash)` | revoca la familia del token | — |
| A | job sin contexto | `alertar_bajas_sin_admin()` | alerta (una abierta por baja) las bajas cumplidas que dejarian al centro sin ADMIN; devuelve cuantas | — |
| A | job sin contexto | `alertar_fallo_canario(detalle)` | alerta FALLO_CANARIO (sin llaves ni datos en el detalle) | — |
| A | ADMIN | `atender_alerta(id)` | marca atendida una vez | 42501, P0002, 55000 |
| A | job sin contexto (con contexto: 42501) | `notificaciones_por_enviar(limite)` | 02i: pendientes vencidas (`proximo_intento`, SKIP LOCKED) con su plantilla activa, el contenido ya armado (si lo hay), el email solo en CORREO (menor: adulto responsable), el enlace cifrado y su origen (videollamada, recordatorio o documento), el documento si el envio es ADJUNTO y `datos` (centro; nombre del paciente solo si es el destinatario; profesional; horario, estado y SEQUENCE de la cita; metadatos del documento) | 42501 |
| A | job sin contexto | `guardar_contenido_notificacion(id, asunto, cuerpo)` | guarda una vez el mensaje armado (cifrado por la API) | 42501, 55000 |
| A | job sin contexto | `marcar_notificacion(id, enviada, detalle, reintentar)` | ENVIADO; o fallo: PENDIENTE con backoff 1, 2, 4, 8 min y FALLIDO al quinto intento (o sin reintento) | 42501, 55000 |
| A | job sin contexto | `avisar_consentimientos_por_vencer()` | una vez por solicitud SOLICITADA pasada la mitad de su plazo | 42501 |
| A | job sin contexto | `citas_por_recordar(limite)`, `registrar_recordatorio(id, cita, inicio, token_hash, enlace)` | citas CONFIRMADA en la ventana `recordatorio_horas_antes`; registra uno por cita y horario (idempotente) y su mensaje | 42501 |
| C | sin contexto (token en la URL) | `consultar_recordatorio(token_hash)` | horario, modalidad y profesional de la cita; vigencia; si una cancelacion seria a tiempo y la penalizacion vigente. Nunca datos del paciente | P0002 |
| A | sin contexto (token en la URL) | `responder_recordatorio(token_hash, respuesta)` | un solo uso, hasta el inicio: CONFIRMADA o CANCELADA (cancela la cita, informa a tiempo o tardia, avisa a paciente y profesional) | P0002, 55000 |
| A | todos (autenticados) | `notificar(tipo, paciente, usuario, referencia)` | registra el aviso a nombre del actor; los eventos de la BD (derivaciones, recordatorios, consentimiento por vencer) no se piden desde la API | 42501 |
| A | PACIENTE | `solicitar_adjunto_documento(documento)` | registra una vez que el paciente pide el documento adjunto | 42501, P0002, 55000 |
| A | PACIENTE | `registrar_descarga_documento(token_hash)` | documento del enlace si es suyo y vigente; registra la descarga (y `accesos_ficha` DESCARGA); vencido = `vencido` sin registrar | 42501, P0002 |
| C | sin contexto (token en la URL) | `feed_calendario(token_hash)` | id, inicio, fin, modalidad, estado, box, enlace cifrado y SEQUENCE (02i) de citas CONFIRMADA/POR_REPROGRAMAR/CANCELADA del dueño del token (activo); nunca paciente ni motivo | P0002 |
| A | ADMIN / GESTION / profesional de la cita con cobro directo | `registrar_pago(cita, monto, medio)` | bloquea la cita; monto > saldo -> 23514 `pagos_sin_sobrepago`; fija `cobrado_por` | 42501, P0002, 23514 |
| A | ADMIN / GESTION | `anular_pago(pago, motivo)` | REGISTRADO -> ANULADO con motivo; no si la cita tiene boleta o el pago esta en una liquidacion emitida | 42501, P0002, 55000, 23514 |
| A | ADMIN / GESTION / profesional con cobro directo | `emitir_boleta(id, cita, emisor_nombre, emisor_rut)` | una boleta por cita PAGADA (copia del emisor cifrada por la API, numero simulado); nulo si no corresponde | 42501 |
| A | ADMIN / GESTION | `resolver_cita(cita, decision, cita_nueva, motivo)` | politica de cancelacion (a tiempo o tardia segun `plazo_aviso_cancelacion_horas`; TRASLADO de pagos o DEVOLUCION menos `penalizacion_cancelacion_porcentaje`) e INASISTENCIA (`cobro_inasistencia_porcentaje`); una por cita | 42501, P0002, 55000, 23514 |
| A | ADMIN / GESTION | `generar_liquidacion(profesional, desde, hasta)` | BORRADOR: cobrado por el centro - devoluciones - comision (`comision_centro_porcentaje`) - arriendos; recalcula un BORRADOR del mismo periodo | 42501, 23514, 55000, 23P01 |
| A | ADMIN / GESTION | `avanzar_liquidacion(id, estado)` | BORRADOR -> EMITIDA -> PAGADA | 42501, P0002, 55000 |
| A | PROFESIONAL / PRACTICANTE destinatario | `marcar_mensaje_leido(id)` | una vez | 42501, P0002, 55000 |
| A | ADMIN / tratante | `resolver_solicitud_epicrisis(id, estado, documento)` | SOLICITADA -> EN_PROCESO/ENTREGADA/RECHAZADA; EN_PROCESO -> ENTREGADA/RECHAZADA; ENTREGADA exige documento | 42501, P0002, 55000, 23514 |
| A | sin contexto (login) | `roles_cuenta(usuario)`, `segundo_factor(usuario)`, `credenciales_login_rut(hmac)` | roles habilitados (principal primero); TOTP (secreto cifrado, activo, requerido si tiene rol clinico, correo); credenciales por RUT del paciente | — |
| A | sin contexto (refresh) | `cambiar_rol_sesion(hash, hash_nuevo, rol, expira)` | revoca la familia y abre otra con el rol pedido si la cuenta lo tiene; si no, nulo | — |
| A | ADMIN | `otorgar_rol_adicional(usuario, rol)`, `iniciar_baja_rol(usuario, rol, fecha)` | suma o reactiva PROFESIONAL; baja del rol: bloqueo de agenda y citas POR_REPROGRAMAR desde la fecha (no a quien supervisa) | 42501, P0002, 55000, 23514 |
| A | sin contexto | `crear_token_recuperacion`, `usar_token_recuperacion`, `crear_token_acceso` (solo PACIENTE/RESPONSABLE), `usar_token_acceso`, `activar_invitacion`, `usar_token_cambio_correo`, `guardar_totp`, `activar_totp` | un solo uso con vencimiento; la creacion devuelve si se emitio (la API responde igual) | P0002, 55000, 23505, 23514 |
| A | ADMIN / ADMIN, GESTION | `crear_invitacion_equipo` / `crear_invitacion_paciente` (desde 14 años, sin cuenta), `crear_invitacion_responsable` (de un menor) | token INVITACION; devuelve el correo | 42501, P0002, 23505, 23514 |
| A | PACIENTE / RESPONSABLE | `crear_token_cambio_correo`, `actualizar_telefono_paciente` (PACIENTE) | correo nuevo verificado por enlace; telefono cifrado | 42501 |
| A | ADMIN | `reiniciar_totp(usuario)` | otra cuenta; corta sus sesiones | 42501, P0002 |
| C | sin contexto | `politica_vigente(tipo)`, `contenido_publico_centro()`, `modulos_activos()`, `imagen_publica(id)`, `cuestionario_match()`, `resenas_publicas(profesional)` | datos publicos (nunca contacto de pacientes; la reseña muestra "Nombre + inicial" o "Usuario anonimo") | — |
| A | paciente adulto / responsable / ADMIN, GESTION con respaldo | `registrar_aceptacion(tipo, paciente, adulto, respaldo)` | version vigente; PORTAL o PRESENCIAL | 42501, P0002, 23514 |
| A | ADMIN / GESTION; sin contexto | `crear_token_consentimiento(referencia)`; `consultar_token_consentimiento`, `responder_token_consentimiento` | enlace al paciente o al adulto responsable; responde consentimiento de practicante, aviso de supervisor u atencion (el token consumido autoriza a `validar_otorgante`) | 42501, P0002, 55000, 23514 |
| A | sin contexto (portal) | `crear_solicitud_hora`, `datos_solicitud_hora`, `concretar_solicitud_hora`, `guardar_enlace_solicitud` | retiene la hora (perfil publico, disponibilidad, box libre, politica vigente, menor con adulto, maximo 2 pendientes por correo); concreta paciente, ficha, adulto, aceptaciones, cita (CONFIRMADA o SOLICITADA), lista de espera e invitacion | 23P01, 23514, 55000, P0002 |
| A | tratante / ADMIN, GESTION | `aprobar_cita_solicitada(cita)`, `invitar_tras_aprobar(cita, hash, expira)` | SOLICITADA -> CONFIRMADA; invitacion del paciente del portal sin cuenta | P0002, 55000 |
| A | tratante o acceso temporal | `respuestas_match_paciente(paciente)` | respuestas cifradas; audita LECTURA | P0002 |
| A | job sin contexto | `limpiar_solicitudes()` | vence retenciones, borra respuestas no concretadas pasados `dias_retencion_respuestas_match` y elimina solicitudes vencidas antiguas; idempotente | 42501 |
| A | autor (paciente adulto o responsable) / ADMIN / sin contexto | `crear_resena`, `editar_resena`, `retirar_resena` / `moderar_resena`, `resenas_para_moderar` / `reportar_resena` | una por paciente y profesional con sesion realizada (`cita_realizada`); editar vuelve a PENDIENTE; ocultar exige motivo; todo en `resenas_eventos`; se eliminan con la baja del profesional (`eliminar_resenas_de`) | 42501, P0002, 23505, 23514 |
| A | ADMIN / tratante | `otorgar_acceso_temporal(paciente, profesional, motivo, alcance, desde, hasta)` | otro PROFESIONAL activo; aviso ACCESO_CLINICO_TEMPORAL (legal) y `accesos_ficha` ACCESO_TEMPORAL | P0002, 23514 |
| A | tratante | `registrar_alta(id, paciente, fecha, motivo)` | motivo cifrado; borra respuestas del match y cierra la lista de espera; audita ESCRITURA | P0002, 23514 |
| A | ADMIN, GESTION, PROFESIONAL, PRACTICANTE | `reporte_dashboard()` | agregados por rol (ADMIN/GESTION: centro, sin datos clinicos; profesional: los suyos) | 42501 |
| A | ADMIN, GESTION / el propio | `estado_fichas_profesional(profesional)` | ultima y proxima sesion, sesiones sin cerrar, alta (metadata) | 42501 |
| A | ADMIN, GESTION / PROFESIONAL (los suyos) | `reporte_cobros(desde, hasta)` | sesiones realizadas, cobrado, pendiente y comision por profesional; medios de pago | 42501, 23514 |
| A | ADMIN | `metricas_match(dias)` | completados, mas recomendados, coincidencias que agendaron | 42501 |
| A | ADMIN / GESTION | `generar_liquidacion` (03a, C-11) | pagos cobrados por el centro de citas REALIZADAS del periodo (por fecha de la cita); con `liquidar_exige_evolucion`, solo citas con evolucion vinculada | 42501, 23514, 55000, 23P01 |
| A | ADMIN | `revisar_especialidad(profesional, especialidad, aprobar)` (03a-2) | PROPUESTO -> APROBADO/RECHAZADO | 42501, P0002 |
| B | ADMIN o PROFESIONAL con la especialidad aprobada / ADMIN | `proponer_plantilla`, `nueva_version_plantilla`, `editar_plantilla` (solo BORRADOR, ADMIN o autor) / `publicar_plantilla`, `desactivar_plantilla` (03a-2) | version 1 o nueva version (una en borrador por familia); publicar deja INACTIVA la anterior | 42501, P0002, 55000, 23505, 23514 |
| A | equipo | `crear_hilo_interno(id, tipo, asunto, paciente, participantes)`, `agregar_participantes_hilo`, `retirar_mensaje_interno`, `nombres_hilo` (03a-2) | CASO solo con acceso clinico; GENERAL solo integrantes vigentes; retiro del autor dentro de 5 minutos; nombres de un hilo visible ("Ex integrante del equipo" si la cuenta se cerro) | 42501, P0002, 23514, 55000 |
| A | job sin contexto | `purgar_mensajes_internos()` (03a-2) | mensajes mas antiguos que `retencion_mensajes_dias` y los hilos vacios | 42501 |
| A | sin contexto (API tras un envio fallido; job) | `encolar_correo_cuenta`, `correos_cuenta_por_enviar`, `resultado_correo_cuenta` (03a-2) | backoff 1, 5, 15, 60 minutos; se borra al enviarse, al quinto intento o al vencer el enlace | 42501 |
| A | ADMIN / GESTION | `resolver_posible_duplicado(paciente, DISTINTO o MISMO_PACIENTE)` (03a-2) | limpia el indicador, atiende la alerta y audita `DUPLICADO_<resolucion>` | 42501, P0002, 23514 |
| — | interno (sin EXECUTE para app_user) | 03a-2: `validar_plantilla_registro`, `proteger_plantilla_clinica`, `proteger_mensaje_interno`, `avisar_mensaje_interno`, `alertar_posible_duplicado`, `definicion_plantilla_valida`. 03a: `validar_rol_adicional`, `revocar_sesiones_de_rol`, `coherencia_roles_usuario`, `consumir_token`, `emitir_token`, `versionar_politica`, `validar_profesional_de_cita`, `invitar_paciente_del_portal`, `avisar_hora_liberada`, `validar_evolucion_cita`, `tocar_borrador`, `registrar_evento_resena`, `eliminar_resenas_de`. 02i: `encolar_notificacion`, `avanzar_secuencia_cita`, `proteger_recordatorio`. 02h: `tarifa_vigente`, `fijar_monto_cita`, `avisar_origen_derivacion`, `notificar_candidato_derivacion`, `notificar_estado_derivacion`, `validar_envio_documento`, `proteger_*`, `bloquear_cambios_registro`; `cuenta_habilitada`, `revocar_sesiones_por_cambio`, `ofrecer_siguiente_candidato`, `agregar_candidatos`, `registrar_accion_derivacion`, `desactivar_tratante`, `reasignar_citas_derivacion`, `motivo_reasignacion`, `cobro_directo`, `cerrar_cuenta`, `concretar_traspaso`, `consentimiento_no_otorgado`, `validar_otorgante`, `margen_vigente`, `ultima_atencion` | — | — |
| — | uso de politicas/triggers (EXECUTE `app_user`) | 03a-2: `tiene_especialidad`, `puede_proponer_plantilla`, `acceso_clinico_paciente`, `hilo_visible`, `es_integrante_equipo`, `edad_minima_cuenta`. 03a: `tiene_rol`, `edad_paciente`, `pacientes_a_cargo`, `app_pacientes_plenos`, `acceso_temporal_vigente`, `acceso_temporal_ficha`, `equipo_tratante_de`, `espacio_libre`, `cita_realizada`, `cita_liquidable`, `puede_resenar`. 02i: `plantilla_valida`, `categoria_evento`, `tipo_documento_del_paciente`; `acceso_vigente`, `app_paciente_id`, `es_profesional_de_*`, `rol_usuario`, `supervisor_vigente`, `es_supervisor_vigente_de`, `consentimiento_practicante_vigente`, `consentimiento_vigente_para`, `evolucion_supervisable`, `minuto_local`, `rango_con_margen` | booleanos / uuid / text / timestamptz | — |

Auditoria en `accesos_ficha`: toda funcion de derivacion con usuario
(`accion = 'DERIVACION'`, incluida la bandeja `derivaciones_pendientes`), toda
lectura de supervision (`accion = 'SUPERVISION'`) y la entrega de datos de
pago al paciente (`accion = 'DATOS_PAGO'`). 02h: la API registra la emision
de documentos clinicos (ESCRITURA) y cada envio (ENVIO); la descarga la
registra `registrar_descarga_documento` (DESCARGA). 02i: subida (ESCRITURA) y
descarga (LECTURA) de `adjuntos_ficha` las registra la API. 03a-2: la API
registra la ficha de ingreso (ESCRITURA/LECTURA, recurso `ingresos_ficha`) y
cada lectura o escritura de un hilo CASO (recurso `mensajes_internos`); la
resolucion de un duplicado la registra `resolver_posible_duplicado`. Los jobs no
escriben ahi (no hay usuario): su rastro es `derivacion_candidatos.estado =
EXPIRADA`, `historial_accesos_practicante.accion = EXPIRADO` y
`bajas.procesada_en`.
