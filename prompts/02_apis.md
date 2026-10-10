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