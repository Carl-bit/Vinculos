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
