# Prompt - Seccion APIs (NestJS)

Lee CLAUDE.md y el schema de Prisma ya generado (seccion BD) antes de
empezar. Este prompt es para levantar los 5 modulos NestJS completos en una
sola pasada, con sus guards y DTOs, no un endpoint suelto a la vez.

## Tarea transversal (hacerla primero, todo lo demas depende de esto)

1. Modulo `Auth`: login con JWT, `RolesGuard` que lee el rol del usuario
   autenticado y lo compara contra un decorator `@Roles(...)` por endpoint.
2. `RlsInterceptor` (o middleware de Prisma): en cada request autenticado,
   antes de tocar la DB, correr dentro de una transaccion Prisma que empiece
   con `SET LOCAL app.current_usuario_id = '<id>'` y
   `SET LOCAL app.current_rol = '<rol>'`, para que las politicas RLS de
   Postgres definidas en la seccion BD se activen solas. Todo query a
   `pacientes`, `fichas_clinicas` o `evoluciones` pasa por este interceptor,
   sin excepcion.
3. `EventEmitterModule` de Nest configurado global, para que los modulos se
   comuniquen por eventos de dominio en vez de importarse entre si (ej:
   `CitaConfirmada` emitido por Agenda, escuchado por Cobros si aplica).
4. Filtro global de excepciones que capture el error de Postgres del
   constraint EXCLUDE y lo traduzca a 409 Conflict con mensaje claro, no un
   500 generico.
5. `ValidationPipe` global con `class-validator`, whitelist activado.

## Modulo Nucleo (usuarios, roles)
- CRUD de usuarios (solo ADMIN).
- Endpoint de otorgar/revocar acceso de practicante: llama a
  `otorgar_acceso_practicante` / `revocar_acceso_practicante` (escriben
  `usuarios` + `historial_accesos_practicante` en la misma transaccion; la
  API no inserta directo en la bitacora).
- Requisitos de BD que esta seccion debe respetar:
  `docs/seguridad/requisitos_02_apis.md`.

## Modulo Fichas y Pacientes
- CRUD de paciente.
- Endpoint de ficha clinica: GET filtra automaticamente por RLS (no hace
  falta logica extra en el controller, pero el service debe asumir que
  puede recibir 0 filas si no hay acceso, y devolver 404, no 403, para no
  filtrar la existencia del paciente a quien no tiene acceso).
- POST de evolucion: siempre crea fila nueva, nunca actualiza una existente.
- POST/PATCH de derivacion: activa/desactiva el acceso cruzado.

## Modulo Agenda y Espacios
- GET disponibilidad de espacios (excluye bloqueos_temporales no expirados
  y citas confirmadas que se solapen).
- POST bloqueo temporal (crea fila en `bloqueos_temporales` con TTL, ej. 5
  minutos).
- POST confirmar cita: valida contra `adultos_responsables` si el paciente
  es menor antes de intentar el insert; si pasa, intenta el insert real
  (protegido por el EXCLUDE constraint) y captura 409 si alguien gano la
  carrera. Si se confirma, borra el bloqueo_temporal asociado y emite el
  evento `CitaConfirmada`.
- DELETE/cancelar cita.

## Modulo Equipo
- CRUD de perfil profesional (especialidad, enfoque, tarifa, modalidad).
- Gestion de practicantes con fecha de expiracion.

## Modulo Match Terapeutico
- POST cuestionario -> devuelve lista de profesionales rankeados. Empezar
  con un scoring simple basado en reglas (coincidencia de especialidad +
  modalidad + disponibilidad si Agenda y Espacios ya esta integrado), no
  un modelo de ML, eso queda fuera de alcance salvo que se pida.
- GET busqueda avanzada con filtros (enfoque, tarifa, modalidad,
  disponibilidad).

## Modulo Cobros
- CRUD de arriendo/comision por profesional.
- POST pago asociado a una cita existente (rechazar si `cita_id` no existe
  o no esta CONFIRMADA).
- POST generar boleta (PDF) a partir de un pago.

## Restricciones que no se pueden dejar pendientes
- Ningun endpoint de ficha clinica sin pasar por el `RlsInterceptor`.
- Ningun modulo importa el service de otro modulo directamente, todo cruce
  pasa por eventos o por el Nucleo.
- Los 5 modulos salen en esta pasada, no uno por conversacion.

## Salida esperada
- Un modulo Nest por bounded context (carpeta propia, controller + service +
  dto + modulo).
- Tests unitarios minimos solo para: el guard de RBAC, el interceptor de
  RLS, y el manejo del 409 por solapamiento (son los tres puntos donde un
  bug rompe una regla de negocio critica, priorizar estos sobre cobertura
  general).

--------------------------------------------------------------------------------
--------------------------------------------------------------------------------
--------------RESTRUCTURACION---------------------------------------------------
--------------------------------------------------------------------------------
--------------------------------------------------------------------------------

# 02a - Infraestructura de la API

## Contexto
Fase de BD cerrada (01-01g). Leer: CLAUDE.md (sección API), docs/seguridad/requisitos_02_apis.md, matriz_permisos.md, cifrado.md. Docker no disponible: tests contra Postgres 18 local.
Sin módulos de negocio en esta fase: solo la base que todos usan.

## 1. Configuración
- ConfigModule con validación de env al arrancar (falla si falta algo).
- Estructura de monolito modular: src/core (transversal) y src/modulos/<contexto> vacíos para nucleo, fichas, agenda, equipo, derivaciones, match, cobros.

## 2. Contexto RLS por request
- nestjs-cls (o AsyncLocalStorage) + interceptor: abre prisma.$transaction por request, ejecuta set_config(app.current_usuario_id) y set_config(app.current_rol) y expone el tx por CLS.
- Repositorios obtienen el tx desde CLS; nunca el PrismaClient global.
- Contexto de sistema para jobs: documentar cómo corre sin usuario (funciones diseñadas para eso).

## 3. Cifrado
- CryptoModule global: KEK desde /run/secrets (ruta configurable para desarrollo local), verifica huella y canarios al arrancar; si falla, la API no arranca.
- Extensión de Prisma ($extends) que cifra/descifra según registro.ts con AAD tabla:columna:id.
- Helper para descifrar resultados de $queryRaw y funciones SQL.
- Generación de ids en la API para filas con columnas cifradas.

## 4. Autenticación y autorización
- Login vía credenciales_login(email) sin contexto; bcrypt; verificar activo y expiración.
- JWT de acceso corto (sub = usuario id, rol). Refresh token: proponer diseño (rotación, revocación). Si requiere tabla, crear migración siguiendo el checklist.
- RolesGuard declarativo por endpoint según la matriz.
- Rate limit en login.

## 5. Errores, validación y logs
- Filtro global: SQLSTATE -> HTTP según requisitos (incluye PrismaClientUnknownRequestError, errores al COMMIT y lectura vacía -> 404). Nunca filtrar mensajes internos de Postgres al cliente.
- ValidationPipe global; validador de RUT con DV y normalización compartida con crypto.
- Logger (pino) con request id y redacción de campos de registro.ts y credenciales.

## 6. Jobs
- @nestjs/schedule + pg advisory lock por job.
- Registrar: expirar_ofertas_derivacion, procesar_bajas, vencimiento de consentimientos y avisos de supervisor, verificación diaria de canarios (alerta si falla).
- Alerta interna (log de nivel error + registro) cuando procesar_bajas deja pendiente una baja que dejaría al centro sin ADMIN.

## 7. Salud
- GET /salud: BD alcanzable y canarios OK. Sin datos sensibles.

## 8. Tests
- Harness Jest + Supertest: Postgres efímero con migraciones, seed y llaves de prueba; helper para obtener token por cada rol.
- Casos: login válido/inválido/inactivo/practicante expirado; request sin token 401; rol incorrecto 403; contexto aislado entre requests concurrentes; error 23P01 -> 409 y error al COMMIT -> 422; API no arranca con huella incorrecta o canario alterado; logs sin campos sensibles; job con lock no corre dos veces.
- correr_tests_bd.sh sigue pasando.

----------------------------------------------------------------

# 02b - Módulo Núcleo

Leer CLAUDE.md, requisitos_02_apis.md y matriz. Construir sobre 02a.

- Usuarios: crear (ADMIN; GESTION solo si está habilitado), ver propio, editar campos no sensibles propios, cambiar rol/activo/expiración (solo ADMIN). Reingreso = cuenta nueva.
- Configuración del centro: lectura con contexto; edición solo ADMIN (habilitar GESTION, plazos, márgenes, modelo de cobro, días de gracia).
- Accesos de practicantes: otorgar/revocar vía funciones; historial por rol.
- Bajas: iniciar (reglas de ADMIN: otro ADMIN, nunca la propia, nunca el último), bandeja pacientes_por_reasignar, alertas.
- Directorio: endpoints sobre directorio_interno y mi_equipo_tratante.
- Tests de integración por rol para cada endpoint, incluidos los bloqueos de la BD vistos como HTTP.

----------------------------------------------------------------

# 02c - Fichas y pacientes

Leer CLAUDE.md, requisitos_02_apis.md y matriz. Construir sobre 02b.

- Pacientes: crear, ver, editar datos administrativos; sin DELETE. RUT cifrado con índice ciego (búsqueda exacta por RUT).
- Adultos responsables: alta y vínculo; menores requieren responsable (error de la BD -> 422 con mensaje claro).
- Fichas: metadata (ADMIN lee metadata, nunca evoluciones).
- Evoluciones: crear con copia de autoría cifrada generada en la API; corregir = fila nueva con corrige_a_id; campos estructurados (tipo de sesión aprobado, intervenciones, estado de avance, nivel de riesgo); advertencia de no escribir datos identificatorios en la respuesta del endpoint de creación (para la UI).
- Tipos de sesión: proponer (profesional), revisar (ADMIN).
- Auditoría: registrar en accesos_ficha cada lectura/escritura clínica en la misma transacción.
- Retención: endpoint ADMIN sobre fichas_sobre_retencion y registro de revisiones.
- Tests por rol, incluidos: ADMIN no lee evoluciones, practicante solo sus pacientes, auditoría registrada.

----------------------------------------------------------------

# 02c - Fichas y pacientes

Leer CLAUDE.md, requisitos_02_apis.md y matriz. Construir sobre 02b.

- Pacientes: crear, ver, editar datos administrativos; sin DELETE. RUT cifrado con índice ciego (búsqueda exacta por RUT).
- Adultos responsables: alta y vínculo; menores requieren responsable (error de la BD -> 422 con mensaje claro).
- Fichas: metadata (ADMIN lee metadata, nunca evoluciones).
- Evoluciones: crear con copia de autoría cifrada generada en la API; corregir = fila nueva con corrige_a_id; campos estructurados (tipo de sesión aprobado, intervenciones, estado de avance, nivel de riesgo); advertencia de no escribir datos identificatorios en la respuesta del endpoint de creación (para la UI).
- Tipos de sesión: proponer (profesional), revisar (ADMIN).
- Auditoría: registrar en accesos_ficha cada lectura/escritura clínica en la misma transacción.
- Retención: endpoint ADMIN sobre fichas_sobre_retencion y registro de revisiones.
- Tests por rol, incluidos: ADMIN no lee evoluciones, practicante solo sus pacientes, auditoría registrada.

----------------------------------------------------------------

# 02d - Agenda y espacios

Leer CLAUDE.md, requisitos_02_apis.md y matriz. Construir sobre 02c.

- Espacios: catálogo (ADMIN/GESTION escriben).
- Disponibilidad: en minutos desde medianoche; conversión con America/Santiago solo en la BD; la API expone horas legibles.
- Bloqueos de agenda y bloqueos temporales (holds con TTL) para presencial y online.
- Citas: crear, confirmar, cancelar (UPDATE de estado, sin DELETE), reprogramar; modalidad; margen de traslado.
- Antes de confirmar (opción C): verificar disponibilidad y margen, y devolver advertencias con alternativas. La BD bloquea igual (409).
- enlace_online: interfaz de proveedor de videollamada con implementación simulada; enlace cifrado y con expiración.
- Ocupación y disponibilidad pública; listas de citas POR_REPROGRAMAR y de conflictos de margen.
- Tests por rol + concurrencia: dos reservas simultáneas al mismo box/horario -> una 201 y otra 409. Preparar el script k6 de colisiones según 04_pruebas.md (no correrlo sin Docker).

----------------------------------------------------------------

# 02e - Equipo y practicantes

Leer CLAUDE.md, requisitos_02_apis.md y matriz. Construir sobre 02d.

- Perfil profesional autogestionado: perfil público, trayectoria (ADMIN verifica), datos privados cifrados, tipos de atención, tarifas (general obligatoria para publicar).
- Supervisiones: asignar y cambiar_supervisor (solo ADMIN, sin hueco); bloqueo de baja de supervisor con practicantes.
- Supervisión seudonimizada: casos y evoluciones por código; comentarios append-only.
- Job manual (no programado) de recálculo de rut_hmac ante compromiso, según el runbook.
- Tests por rol: el supervisor nunca recibe identificadores; los comentarios los lee el tratante actual; datos privados solo propio y ADMIN/GESTION.

----------------------------------------------------------------

# 02f - Derivaciones y consentimientos

Leer CLAUDE.md, requisitos_02_apis.md, consentimiento.md y matriz. Construir sobre 02e.

- Derivaciones solo vía funciones: crear, definir candidatos, oferta (0 filas -> 404), responder, cancelar, derivación de oficio, reintegrar candidato.
- Practicante candidato: ESPERANDO_CONSENTIMIENTO y solicitud al paciente.
- Consentimientos: solicitar, responder (portal del paciente o ADMIN/GESTION con respaldo; menor responde adulto responsable), revocar.
- Avisos de cambio de supervisor: listar, responder conformidad u oposición.
- Notificaciones: interfaz de envío (correo) con implementación simulada; registrar cada notificación.
- Tests de flujo completo: aceptar, rechazar, vencer, agotar lista, consentimiento aceptado/rechazado/vencido, revocación con citas POR_REPROGRAMAR.

----------------------------------------------------------------

# 02g - Match terapéutico y portal

Leer CLAUDE.md, requisitos_02_apis.md y matriz. Construir sobre 02f.

- Perfiles públicos sin autenticación (perfiles_publicos), con rate limit.
- Match: filtros por necesidad (tipo de atención), tiempos (disponibilidad_publica) y precio (tarifa máxima del paciente), en ese orden de prioridad.
- Portal del paciente: su equipo tratante, sus citas, sus consentimientos y avisos, datos de pago cuando el cobro es directo.
- Mensajes al profesional y solicitud de epicrisis: no existen tablas. Diseñarlas siguiendo el checklist (categoría, RLS, cifrado del contenido), crear la migración y luego los endpoints. Comunicación asimétrica: el paciente escribe, el profesional responde por canales externos.
- Tests por rol, incluido acceso anónimo solo a datos públicos.

----------------------------------------------------------------

# 02h - Cobros

Leer CLAUDE.md, requisitos_02_apis.md y matriz. Construir sobre 02g.

- Antes de construir: proponer la definición de "pago pendiente" (montos, abonos, pagos parciales) y los cambios de BD necesarios. Detenerse y esperar mi confirmación.
- Modelo de cobro CENTRO, DIRECTO y MIXTO; pagos; boletas con datos del emisor; arriendos.
- Interfaz de pasarela de pago con implementación simulada (sin proveedor real todavía).
- Tests por rol y por modelo de cobro.

----------------------------------------------------------------

# 02h - Ajustes a 02b-02g y módulo de Cobros

## Contexto
02a-02g implementados y con commit. Leer CLAUDE.md, requisitos_02_apis.md, matriz y docs/api/propuesta_02h_cobros.md. Docker no disponible.
Confirmado: alta de usuarios (solo ADMIN; GESTION si está habilitado), match (la necesidad filtra; tiempos y precio ordenan) y "24:00" como presentación del minuto 1440.

## Parte A - Ajustes

### A1. Tipos de atención por profesional
- Mismo patrón que tipos_sesion: el profesional declara (PROPUESTO), ADMIN aprueba o rechaza.
- Solo los APROBADOS cuentan en el match, en perfiles_publicos y en el filtro de candidatos de derivación.
- Migración si hace falta; actualizar la matriz.

### A2. Documentos clínicos por correo
- Catálogo `tipos_documento_clinico` (B), por centro: nombre (epicrisis, receta, justificativo, etc.), activo. Solo ADMIN.
- Envío por defecto: correo con enlace que expira y exige iniciar sesión; registra cada descarga.
- Adjunto: solo si el paciente lo pidió explícitamente (registrar la solicitud).
- Auditar cada envío y descarga.
- Mensajes del paciente: sin cambios (el correo solo avisa y remite al portal). Documentar la regla: el único contenido clínico que sale por correo son documentos emitidos.

### A3. Notificaciones de derivación
- Notificar al candidato cuando recibe una oferta, también cuando un job o un rechazo pasa la oferta al siguiente. El aviso solo dice que tiene una oferta.
- El candidato nunca ve la lista, el orden ni quién rechazó.
- El profesional que deriva recibe aviso de cada cambio de estado y ve el detalle completo.

### A4. Recálculo de rut_hmac
- Se mantiene como comando de mantención (dueño + llaves), nunca en el contenedor de la API.
- Completar el runbook: ventana de mantención (API detenida o en solo lectura), contenedor puntual tipo migrate, registro en eventos_llaves, verificación de búsqueda y duplicados.
- Simulacro de punta a punta en desarrollo: generar HMAC nueva, recalcular, activar, verificar, retirar la anterior. Reportar el resultado.

### A5. Jobs programados
- Test con tiempo simulado que verifique que cada job se dispara según su programación.

### A6. Integraciones sin configuración (Google pospuesto)
- Interfaces genéricas: ProveedorCorreo, ProveedorVideollamada y ProveedorCalendario. Los módulos solo dependen de la interfaz; las implementaciones se eligen por configuración. Las simuladas siguen siendo el default en tests.
- Correo: implementación SMTP genérica (sirve con SES u otro servicio), configurada por env a nivel de plataforma. Remitente por defecto de la plataforma con el nombre del centro.
- Feed iCal privado por profesional: endpoint con token en la URL (guardado como hash), regenerable por el propio profesional. Eventos solo con "Sesión", modalidad, horario y enlace o box; nunca nombre del paciente ni motivo. Incluye citas confirmadas y por reprogramar marcadas como tales.
- Adjunto .ics en los correos de confirmación y reprogramación de citas, con la misma regla de contenido.
- Videollamada, modo configurable por profesional:
  - ENLACE_PROPIO (default): enlace fijo de su sala, guardado cifrado en su perfil.
  - JITSI: enlace único por cita con nombre de sala no adivinable; URL base configurable; desactivado por defecto.
- Documentar en docs/api/integraciones.md: modos disponibles, por qué Google queda pospuesto (gestión de Workspace, OAuth por profesional, verificación de Google, datos de salud en terceros) y cómo se agregaría como adaptador opcional.
- Tests: el feed exige token válido y no contiene nombres ni motivos; regenerar el token invalida el anterior; el .ics cumple la misma regla; cada modo de videollamada genera el enlace esperado; ningún módulo importa una implementación concreta.

## Parte B - Cobros

### B1. Montos
- citas.monto se fija al confirmar con la tarifa más específica vigente. Inmutable: no hay ajustes. Un cambio de tarifa solo afecta citas confirmadas después.

### B2. Pagos
- registrar_pago(cita_id, monto, ...): rechaza montos mayores al saldo (sobrepago = error).
- Anulación en vez de borrado, con motivo.
- Saldo = monto - pagos no anulados. Estados: PENDIENTE | PARCIAL | PAGADO.
- Redefinir datos_pago_profesional con el saldo.
- Boleta: una sola, emitida al quedar PAGADO, con los datos del emisor (copia).

### B3. Política de cancelación
- configuracion_centro: plazo_aviso_cancelacion_horas (default 24), penalizacion_cancelacion_porcentaje (default 0) y cobro_inasistencia_porcentaje (default 0). Los dos porcentajes quedan pendientes de definir con el caso de estudio.
- Cancelación con aviso dentro del plazo: sin cobro; los pagos hechos quedan como crédito o devolución.
- Cancelación tardía: el paciente elige reprogramar (el pago se traslada a la nueva cita) o devolución menos la penalización.
- Inasistencia sin aviso: cobro según el porcentaje configurado.
- Toda decisión queda registrada y auditada.

### B4. Liquidación y arriendos
- configuracion_centro.comision_centro_porcentaje (default 0, pendiente del caso de estudio).
- Arriendos: cobro de box al profesional por período.
- Liquidación por profesional y período: pagos cobrados por el centro (modelo CENTRO o MIXTO) - comisión - arriendos. Estados: BORRADOR | EMITIDA | PAGADA. Solo ADMIN/GESTION la emiten; el profesional ve las suyas.

### B5. Fuera de alcance
- Pasarela de pago real, medios de pago, integración con el SII y propuestas financieras: quedan para el final. Mantener las interfaces simuladas.

## Tests
- A1-A5 por rol, incluido que el candidato nunca recibe información de la lista.
- B: monto fijo tras cambio de tarifa; sobrepago rechazado; pago parcial; anulación; boleta solo al completar; cancelación a tiempo, tardía (reprogramar y devolución) e inasistencia con porcentajes configurados; liquidación con comisión y arriendo; acceso por rol.
- npm run test:e2e, npx jest y correr_tests_bd.sh deben pasar.

## Entrega
Formato de CLAUDE.md. Actualizar estado_fase_api.md y requisitos. Commits propuestos en español; no ejecutarlos hasta mi confirmación.

----------------------------------------------------------------------------------

# 02i - Mensajería, recordatorios y documentos

## Contexto
02a-02h con commit. Leer CLAUDE.md, requisitos_02_apis.md, integraciones.md y matriz. Docker no disponible.
Confirmado: canales bandeja en portal + correo; WhatsApp a futuro; videollamada solo nivel 1 (enlace propio). Jitsi queda implementado pero desactivado.

## 1. Mensajería en tres capas
Evolucionar notificaciones existentes; no duplicar tablas.
- Eventos: catálogo fijo en código (cita confirmada, reprogramada, cancelada, recordatorio, oferta de derivación, cambio de estado de derivación, consentimiento solicitado o por vencer, aviso de cambio de supervisor, documento emitido, pago registrado, boleta emitida). Documentar destinatarios por evento.
- Plantillas (`plantillas_mensaje`, B): evento, destinatario (rol), canal, asunto, cuerpo, activa. La migración carga plantillas de ejemplo en español; ADMIN las personaliza.
  - Variables solo de una lista permitida (nombre del paciente, nombre del profesional, fecha, hora, modalidad, enlace, nombre del centro). Nunca motivo, diagnóstico, notas ni contenido clínico. Validar al guardar: variable no permitida = 422.
  - Restaurar a la plantilla de ejemplo.
- Canales:
  - BANDEJA: siempre; es el registro oficial.
  - CORREO: copia o aviso.
  - WHATSAPP: valor reservado en el enum, sin implementación.
- Preferencias del paciente (`preferencias_notificacion`, A): puede desactivar recordatorios y avisos operativos; nunca los avisos legales (consentimientos, cambio de supervisor, documentos emitidos).
- Cola de salida: estado (PENDIENTE | ENVIADO | FALLIDO), intentos y próximo intento con backoff; job idempotente con lock. Un fallo de correo nunca bloquea la operación que lo originó; el mensaje queda en la bandeja.
- Remitente: dominio de la plataforma con el nombre del centro. Dominio propio por centro: documentado como opción futura (SPF/DKIM).

## 2. Recordatorios de citas
- configuracion_centro.recordatorio_horas_antes (default 24; 0 = desactivado).
- Job que envía el recordatorio una sola vez por cita.
- Enlaces "confirmo asistencia" y "cancelar", con token de un solo uso y expiración. La cancelación aplica la política de cancelación vigente (a tiempo o tardía) e informa al paciente cuál aplicó antes de confirmar.
- Respeta las preferencias del paciente.

## 3. Calendario
- .ics con UID fijo por cita y SEQUENCE incremental: una reprogramación actualiza el evento existente; una cancelación envía METHOD:CANCEL.
- Mismo criterio en el feed iCal del profesional.

## 4. Documentos
- Emitidos: plantillas por tipo_documento_clinico; el profesional redacta en la app (contenido cifrado) y el servidor genera el PDF con el formato del centro al entregarlo (librería Node). Sin subida de archivos.
- Adjuntos externos: subida multipart en streaming; límite configurable (default 10 MB); tipos permitidos PDF e imágenes, validados por contenido (magic bytes); cifrado con DEK CLINICO y AAD; guardado como bytea con la misma RLS y auditoría de la ficha.
- Volver el límite del body JSON a un valor pequeño (1 MB) y quitar el envío en base64.
- Documentar la ruta futura a almacenamiento de objetos y que la firma electrónica queda pendiente.

## 5. Cobros
- Cancelación a tiempo, con pagos hechos y sin reagendar: devolución completa sin penalización (además del traslado a una cita nueva que ya existe).

## 6. Videollamada
- Solo nivel 1 (ENLACE_PROPIO) habilitado. Jitsi desactivado por configuración. Documentar los niveles 2 y 3 como futuros en integraciones.md.

## 7. Tests
- Plantillas: ejemplo cargado; personalizar; variable no permitida rechazada; restaurar.
- Preferencias: recordatorio desactivable; aviso legal no desactivable.
- Cola: fallo de correo reintenta con backoff y la bandeja tiene el mensaje; job sin duplicados.
- Recordatorio: se envía una vez; token de un solo uso; cancelación a tiempo vs tardía según política.
- .ics: misma UID al reprogramar; CANCEL al cancelar.
- Documentos: PDF emitido sin datos fuera de la plantilla; subida que excede el límite o con tipo falso rechazada; adjunto cifrado y auditado; JSON grande rechazado.
- Devolución sin penalización.
- Las tres suites deben pasar.

## Entrega
Formato de CLAUDE.md. Actualizar estado_fase_api.md, requisitos, integraciones.md y matriz. Commits propuestos en español; no ejecutarlos hasta mi confirmación.

-----------------------------------------------------

# 02j - Preparación para pruebas manuales

## Contexto
02a-02i con commit. Leer CLAUDE.md, requisitos_02_apis.md y matriz. Docker no disponible: todo debe funcionar con el Postgres 18 local.
Objetivo: poder probar la API a mano, por rol y por flujo, de forma repetible. Sin funcionalidades nuevas de negocio.

## 1. Recordatorio vs. política de cancelación
- recordatorio_horas_antes default 48.
- Validación en configuracion_centro: si el recordatorio está activo, debe ser mayor que plazo_aviso_cancelacion_horas (23514 -> 422 con mensaje claro).
- Ajustar tests y documentación.

## 2. Documentación OpenAPI
- @nestjs/swagger en /docs, solo si NODE_ENV != production (o protegido por configuración).
- Todos los controllers con tags por módulo, DTOs documentados, respuestas y errores principales (401, 403, 404, 409, 413, 422).
- Botón de autorización con JWT.
- Exportar openapi.json a docs/api/ con un script npm.

## 3. Centro de demostración
- Script `npm run seed:demo` (separado del seed de tests), idempotente, que crea en la BD local:
  - Un usuario por rol (ADMIN, PROFESIONAL x2, PRACTICANTE, PACIENTE x3) con contraseñas de desarrollo documentadas. GESTION habilitado y con un usuario, para probar ese flujo.
  - Practicante con supervisor y consentimiento vigente de un paciente.
  - Paciente menor con adulto responsable.
  - Disponibilidad, espacios, tarifas aprobadas, tipos de atención y de sesión aprobados.
  - Citas pasadas y futuras, presenciales y online, una con pago parcial.
  - Una derivación en curso con dos candidatos.
- Datos ficticios evidentes (nombres de prueba, RUT válidos de prueba).
- `npm run demo:reset`: vacía y vuelve a cargar solo los datos demo. Nunca debe correr si NODE_ENV=production.

## 4. Correo local
- Documentar Mailpit para Windows (binario, sin Docker) y las variables SMTP en .env.example.
- Verificar que los correos de confirmación, reprogramación, cancelación y recordatorio llegan a Mailpit con su .ics.

## 5. Colección de peticiones
- Colección Bruno en `backend/pruebas/bruno/`, versionada.
- Entorno local con variables (URL base y tokens por rol); login por rol que guarda el token.
- Carpetas por flujo: autenticación, agenda, fichas, derivaciones, consentimientos, cobros, mensajería, portal del paciente.

## 6. Guion de pruebas manuales
`docs/pruebas/guion_manual.md`, por flujo: pasos, rol que ejecuta, resultado esperado y casilla de resultado. Mínimo:
1. Login de cada rol, usuario inactivo y practicante expirado.
2. Agenda: crear cita, choque de box (409), margen de traslado (409 con alternativas), reprogramar y cancelar (revisar .ics en Mailpit e importarlo en un calendario real).
3. Fichas: evolución con copia de autoría; ADMIN no la lee; búsqueda por RUT; adjunto y PDF emitido.
4. Derivación completa: oferta, rechazo, paso al siguiente, aceptación; el candidato no ve la lista.
5. Practicante: consentimiento solicitado, aceptado y rechazado; supervisor ve casos seudonimizados.
6. Cobros: monto fijo, pago parcial, sobrepago rechazado, boleta al completar, cancelación a tiempo y tardía.
7. Mensajería: bandeja, preferencias, recordatorio con token de un solo uso.
8. Portal del paciente y match público anónimo.

## 7. ESLint
- Configuración ESLint + Prettier acorde a NestJS. Corregir lo que salga sin cambiar comportamiento; reportar lo que requiera decisión.

## Entrega
Formato de CLAUDE.md. Las tres suites deben pasar. Commits propuestos en español; no ejecutarlos hasta mi confirmación.