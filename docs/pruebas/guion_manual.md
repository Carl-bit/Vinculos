# Guion de pruebas manuales de la API (02j)

Objetivo: probar la API a mano, por rol y por flujo, de forma repetible,
sobre el centro de demostracion y sin Docker. Cada paso indica el rol que lo
ejecuta, el resultado esperado y una casilla para anotar el resultado real.
Los pasos se ejecutan en Postman o Swagger; los marcados **(manual)**
necesitan Mailpit o un calendario real.

## 0. Preparacion

### 0.1 Requisitos (una vez)

- Node 22, Git Bash (los scripts son `sh`) y PostgreSQL 18 instalado
  (`initdb`, `pg_ctl` y `psql` en el PATH; en Windows:
  `C:\Program Files\PostgreSQL\18\bin`).
- Mailpit para Windows (binario, sin Docker): descargar
  `mailpit-windows-amd64.zip` de https://github.com/axllent/mailpit/releases,
  descomprimir `mailpit.exe` en una carpeta fuera del repo y ejecutarlo:

  ```sh
  mailpit.exe --listen 127.0.0.1:8025 --smtp 127.0.0.1:1025
  ```

  Bandeja web: http://localhost:8025. SMTP en el puerto 1025, sin usuario ni
  TLS. Los correos se guardan en memoria: se pierden al cerrar Mailpit.
- Postman (las pruebas manuales se hacen con la coleccion del usuario en
  Postman; no se versiona en el repo).

### 0.2 Entorno

```sh
cp backend/.env.example backend/.env
```

En `backend/.env`:
- `SMTP_URL="smtp://localhost:1025"` (Mailpit). Vacio = correo simulado (no
  sale nada).
- El puerto de `DATABASE_URL` y `MIGRATION_DATABASE_URL` es el de la BD
  local. Si el servicio de Windows `postgresql-x64-18` ocupa el 5432,
  detenerlo (PowerShell como administrador: `Stop-Service postgresql-x64-18`)
  o cambiar el puerto en ambas URL (por ejemplo 5433).
- `LOGIN_LIMITE_POR_MINUTO=30`: la coleccion inicia sesion con 11 usuarios
  seguidos (en un silo queda el default 10).

### 0.3 BD local y datos demo

Desde `backend/`:

```sh
npm install
npm run bd:local -- iniciar   # primera vez: crea un cluster en infra/local/pg, migra, seed base, llaves de dev
npm run seed:demo             # centro de demostracion (idempotente: si ya esta, no hace nada)
npm run build && npm run start:prod   # o npm run start:dev
```

- `npm run bd:local -- iniciar` despues de reiniciar el equipo solo levanta
  el cluster; `npm run bd:local -- detener` lo baja.
- **Volver al estado inicial** (antes de repetir el guion o la coleccion
  completa): detener la API y correr `npm run demo:reset`. Recrea la BD local
  (migraciones, seed base, llaves de dev nuevas) y vuelve a cargar los datos
  demo. Se niega con `NODE_ENV=production` o si la BD no es local. Despues,
  vaciar Mailpit ("Delete all"): los enlaces de correos anteriores ya no
  sirven.
- Si `seed:demo` falla a mitad de camino, corregir la causa y usar
  `demo:reset` (la marca de "ya cargado" es el usuario GESTION).

Comprobaciones: `curl http://localhost:3001/api/salud` responde
`{"estado":"ok","bd":true,"canarios":true}`; Swagger en
http://localhost:3001/docs (boton **Authorize**: pegar el `accessToken` del
login). `npm run openapi:exportar` regenera `docs/api/openapi.json`.

### 0.4 Postman y segundo factor

Las requests se arman en Postman contra `http://localhost:3001/api` (o desde
Swagger). Desde 03a el login es en dos pasos para el equipo clinico:
`POST /api/auth/login` devuelve `requiereTotp` y un `desafio`; luego
`POST /api/auth/totp` con el `desafio` y el codigo de 6 digitos. El seed demo
enrola el TOTP de esas cuentas y deja los secretos en
`infra/local/totp-demo.txt` (cargarlos en una app autenticadora).

### 0.5 Usuarios demo

Contraseña de todos: `dev-password` (solo desarrollo; `SEED_PASSWORD` la
cambia). Dominio `@centro-prueba.cl`.

| Usuario | Rol | Para que |
|---|---|---|
| `admin` | ADMIN | configuracion, usuarios, aprobaciones, auditoria |
| `gestion` | GESTION (habilitado) | agenda, pagos, consentimientos con respaldo |
| `profesional1` | PROFESIONAL | tratante de Paciente Prueba y Diego; origen de derivaciones |
| `profesional2` | PROFESIONAL | supervisor del practicante; tratante de Sofia; candidato 1 |
| `profesional3` | PROFESIONAL | candidato 2 de la derivacion en curso |
| `practicante` | PRACTICANTE | tratante de Camila (consentimiento vigente), acceso por 90 dias |
| `paciente` | PACIENTE | Paciente Prueba (RUT 11.111.111-1) |
| `paciente2` | PACIENTE | Camila Demo Practicante (RUT 22.222.222-2) |
| `paciente3` | PACIENTE | Diego Demo Derivacion (RUT 33.333.333-3) |
| `inactivo` | PROFESIONAL desactivado | login rechazado |
| `practicante.expirado` | PRACTICANTE con acceso vencido | login rechazado |

`profesional3` existe para que la derivacion en curso tenga dos candidatos
ademas del origen (con solo dos profesionales no se puede).

### 0.6 Estado inicial del centro demo

- Configuracion: GESTION habilitado, modelo de cobro CENTRO, plazo de aviso
  de cancelacion 24 h, recordatorio 48 h, margen de traslado 30 min.
- Tipos de atencion aprobados por profesional; tipos de sesion aprobados
  (seed base); tipo de documento "Certificado de atencion (Demo)".
- Perfiles publicos con tarifa: Profesional Uno 35.000 (online 30.000), Dos
  40.000 (online 35.000), Tres 38.000. Sala de videollamada propia
  (`https://meet.jit.si/vinculos-demo-...`) para profesionales y practicante.
- Disponibilidad de lunes a viernes, 09:00 a 19:00, presencial y online.
  Boxes: "Box 1 (Demo)" y "Box 2 (Demo)".
- Sofia Demo Menor (12 años, de Profesional Dos) con adulto responsable
  "Madre Demo Responsable" (los correos de la menor van a la madre).
- Camila: derivada al practicante; consentimiento ACEPTADO (vigente); una
  evolucion del practicante.
- Diego: derivacion PENDIENTE de Profesional Uno con candidatos Profesional
  Dos (oferta abierta) y Profesional Tres.
- Citas (dias habiles desde hoy): -5 presencial PAGADA con boleta; -3 online
  del practicante; +4 presencial con pago parcial (15.000 de 35.000); +4
  presencial de Sofia; +5 online de Camila; +6 online; +7 presencial de
  Diego. Las del practicante quedan SIN_COBRO (no tiene tarifa).

## Flujos

Marcar la casilla con OK o con lo observado.

### 1. Autenticacion

| # | Rol | Paso | Esperado | Resultado |
|---|---|---|---|---|
| 1.1 | cada rol | `POST /api/auth/login` con cada usuario activo | 200 con `accessToken`, `refreshToken`, `rol` | [ ] |
| 1.2 | - | Login de `inactivo` | 401 "Credenciales invalidas o cuenta sin acceso" (no revela el motivo) | [ ] |
| 1.3 | - | Login de `practicante.expirado` | 401, mismo mensaje | [ ] |
| 1.4 | ADMIN | `POST /api/auth/refresh` con el refresh | 200, tokens nuevos; el refresh anterior ya no sirve (repetir: 401) | [ ] |
| 1.5 | - | `GET /api/usuarios/yo` sin token | 401 | [ ] |
| 1.6 | GESTION | `GET /api/usuarios` | 403 (solo ADMIN) | [ ] |

### 2. Agenda

| # | Rol | Paso | Esperado | Resultado |
|---|---|---|---|---|
| 2.1 | GESTION | Huecos de Profesional 1 en 14 dias | 200, huecos por modalidad | [ ] |
| 2.2 | GESTION | Verificar y crear cita presencial en Box 1 | 200 (verificacion) y 201 con `monto` 35000 | [ ] |
| 2.3 | GESTION | Misma hora y box para Profesional Dos | 409 (box ocupado) con motivos y alternativas | [ ] |
| 2.4 | GESTION | Online de Profesional 1 diez minutos despues de la presencial | 409 por margen de traslado, con `alternativas` | [ ] |
| 2.5 | GESTION | Reprogramar la cita | 200, conserva el monto | [ ] |
| 2.6 | GESTION | Cancelar la cita | 200, estado CANCELADA | [ ] |
| 2.7 | PROFESIONAL 2 | Paciente menor sin adulto responsable y cita | 201 (paciente) y 422 (cita) | [ ] |
| 2.8 | PACIENTE | Crear una cita | 403 | [ ] |
| 2.9 | (manual) | En Mailpit (http://localhost:8025): correos "Cita confirmada", "Cita reprogramada" y "Cita cancelada" a `paciente@` (llegan en menos de un minuto) | Cada uno con `sesion.ics`: confirmacion y reprogramacion `METHOD:PUBLISH`, cancelacion `METHOD:CANCEL` y `STATUS:CANCELLED`; mismo `UID` y `SEQUENCE` creciente | [ ] |
| 2.10 | (manual) | Importar el `.ics` de la confirmacion en un calendario real (Google Calendar: Configuracion > Importar; Outlook: abrir el adjunto). Luego el de la reprogramacion y el de la cancelacion | El evento aparece, se mueve y se elimina o marca cancelado (un solo evento, no duplicados). Anotar el cliente usado | [ ] |

### 3. Fichas

| # | Rol | Paso | Esperado | Resultado |
|---|---|---|---|---|
| 3.1 | PROFESIONAL 1 | Buscar por RUT `11.111.111-1` | 200, un paciente | [ ] |
| 3.2 | PROFESIONAL 2 | Misma busqueda | 200, lista vacia (RLS) | [ ] |
| 3.3 | PROFESIONAL 1 | Crear evolucion en la ficha de Paciente Prueba | 201; `copiaAutoria` con nombre, RUT y registro del autor | [ ] |
| 3.4 | PROFESIONAL 1 | Corregir la evolucion (`corrigeAId`) | 201: fila nueva; la original no cambia | [ ] |
| 3.5 | ADMIN | Leer evoluciones / leer metadata de la ficha | 403 / 200 | [ ] |
| 3.6 | PROFESIONAL 2 | Leer la ficha ajena | 404 | [ ] |
| 3.7 | PROFESIONAL 1 | Subir adjunto PDF (multipart, campo `archivo`), listarlo y descargarlo | 201, 200, 200; un `.txt` renombrado a `.pdf` da 422; mas de `ADJUNTO_MAX_MB` da 413 | [ ] |
| 3.8 | GESTION | Listar adjuntos | 403 | [ ] |
| 3.9 | PROFESIONAL 1 | Emitir documento y enviarlo por enlace | 201 y 201 | [ ] |
| 3.10 | (manual) PACIENTE | En Mailpit, correo "Documento disponible": copiar el `token` del enlace y llamar `GET /api/documentos-clinicos/descarga/<token>` con sesion de `paciente` (Swagger o Postman) | 200 `application/pdf` con el formato del centro; con otro rol 403; despues de `DOCUMENTO_ENLACE_HORAS`, 410 | [ ] |
| 3.11 | ADMIN | Envios del documento | 200 (auditoria, sin contenido) | [ ] |

### 4. Derivacion completa

| # | Rol | Paso | Esperado | Resultado |
|---|---|---|---|---|
| 4.1 | PROFESIONAL 2 | Ver la oferta de la derivacion de Diego | 200; sin lista de candidatos ni id del paciente (solo edad y motivo) | [ ] |
| 4.2 | PROFESIONAL 3 | Ver la oferta | 404 (aun no le toca) | [ ] |
| 4.3 | PROFESIONAL 2 | `GET /api/derivaciones/:id` | 404: el candidato no ve la derivacion ni la lista | [ ] |
| 4.4 | PROFESIONAL 2 | Rechazar | 200; ya no ve la oferta (404) | [ ] |
| 4.5 | PROFESIONAL 3 | Ver oferta y aceptar | 200 y 200 | [ ] |
| 4.6 | PROFESIONAL 1 | Ver la derivacion y al paciente | ACEPTADA; paciente 404 | [ ] |
| 4.7 | PROFESIONAL 3 | Ver al paciente | 200 | [ ] |
| 4.8 | (manual) | Mailpit | "Nueva oferta de derivación" a profesional2 y luego a profesional3; "Cambios en una derivación" al origen, sin decir quien rechazo | [ ] |

### 5. Practicante y consentimientos

| # | Rol | Paso | Esperado | Resultado |
|---|---|---|---|---|
| 5.1 | PACIENTE 2 | Ver su consentimiento | ACEPTADO, con practicante y supervisor | [ ] |
| 5.2 | PRACTICANTE | Ver a Camila | 200 | [ ] |
| 5.3 | PROFESIONAL 1 | Crear paciente A y derivarlo sin candidatos | 201 y 201 | [ ] |
| 5.4 | PROFESIONAL 2 | Bandeja de supervisor y proponer al practicante | La derivacion aparece; 200 | [ ] |
| 5.5 | PRACTICANTE | Aceptar | 200; consentimiento SOLICITADO (correo "Solicitud de consentimiento") | [ ] |
| 5.6 | GESTION | Registrar aceptacion sin respaldo / con respaldo | 422 (`consentimientos_respaldo_obligatorio`) / 200 ACEPTADO | [ ] |
| 5.7 | PRACTICANTE | Ver al paciente A | 200 | [ ] |
| 5.8 | GESTION / PRACTICANTE | Paciente B: mismo camino, GESTION registra rechazo con respaldo; practicante intenta verlo | RECHAZADO; 404 | [ ] |
| 5.9 | PROFESIONAL 2 | Casos de supervision y evoluciones de un caso | Codigos `C-...`, edad y tipo de atencion; sin nombre ni id del paciente | [ ] |
| 5.10 | PRACTICANTE | Casos de supervision | 403 | [ ] |

### 6. Cobros

| # | Rol | Paso | Esperado | Resultado |
|---|---|---|---|---|
| 6.1 | GESTION | Detalle de la cita con pago parcial | `monto` 35000 (fijo desde la confirmacion), PARCIAL, saldo 20000 | [ ] |
| 6.2 | GESTION | Pagar saldo + 1 | 422 `pagos_sin_sobrepago` | [ ] |
| 6.3 | GESTION | Pagar el saldo | 201; PAGADO y `boleta` emitida (correo "Boleta emitida") | [ ] |
| 6.4 | ADMIN | Recordatorio 24 h con plazo de cancelacion 24 h | 422 `configuracion_centro_recordatorio_antes_de_cancelacion` | [ ] |
| 6.5 | GESTION | Cancelacion a tiempo: cita a 12 dias, pago 10000, cancelar, resolver DEVOLUCION | `aTiempo` true, devolucion 10000 | [ ] |
| 6.6 | ADMIN + GESTION | Cancelacion tardia: plazo 720 h y penalizacion 50% (recordatorio en 0), cita a 3 dias, pago 20000, cancelar, DEVOLUCION | `aTiempo` false, porcentaje 50 | [ ] |
| 6.7 | ADMIN | Restaurar politica (48 / 24 / 0) | 200 | [ ] |
| 6.8 | PACIENTE | Sus cobros | Solo citas propias | [ ] |

### 7. Mensajeria

| # | Rol | Paso | Esperado | Resultado |
|---|---|---|---|---|
| 7.1 | PACIENTE | Bandeja | Mensajes armados por el job (hasta un minuto de demora) | [ ] |
| 7.2 | PACIENTE | Preferencias: desactivar recordatorios; intentar `avisosLegales` | 200 / 400 | [ ] |
| 7.3 | ADMIN | Preferencias / plantillas | 403 / 200; PROFESIONAL en plantillas 403 | [ ] |
| 7.4 | (manual) | Crear una cita para manana con `paciente` (o esperar la de +4 dias cuando entre en 48 h). El job de recordatorios corre cada 10 minutos | Correo "Recordatorio de su cita" con enlace `.../portal/citas/recordatorio?token=...` (sin `.ics`: el `.ics` va en la confirmacion) | [ ] |
| 7.5 | (sin sesion) | Copiar el token en la variable `tokenRecordatorio` del entorno y correr 07/09-11 (o `GET /api/recordatorios/<token>`, luego `POST .../confirmacion` y otra vez `.../cancelacion`) | 200 con la politica (a tiempo o tardia); 200 CONFIRMADA; 409 (un solo uso) | [ ] |

### 8. Portal del paciente y match publico

| # | Rol | Paso | Esperado | Resultado |
|---|---|---|---|---|
| 8.1 | anonimo | Perfiles publicos, match por tipo de atencion y modalidad, disponibilidad | 200; sin correos ni datos de contacto; mas de 60 consultas por minuto da 429 | [ ] |
| 8.2 | PACIENTE | Mi equipo, mis citas, datos de pago | 200 (datos de pago: `aplica` segun modelo de cobro) | [ ] |
| 8.3 | PACIENTE / PROFESIONAL 1 | Mensaje al profesional; el profesional lo ve | 201 / 200 (y correo al profesional) | [ ] |
| 8.4 | PACIENTE | Solicitar epicrisis | 201 | [ ] |
| 8.5 | PACIENTE | Su registro / el de otro paciente | 200 / 404 | [ ] |
| 8.6 | ADMIN | Portal | 403 | [ ] |

## Revisar la BD

Como dueño (`vinculos_owner`, se salta la RLS; solo para inspeccionar):
`psql postgresql://vinculos_owner:<OWNER>@localhost:5432/app`. Consultas
utiles (RUT cifrado, auditoria de fichas, solapamientos de citas) en
`backend/pruebas/README.md`.
