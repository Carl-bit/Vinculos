# Estado de la fase de BD (cerrada en 01g)

## Iteraciones
- **01**: schema de las 5 areas, EXCLUDE anti-choque de agenda, RLS inicial, triggers de no-borrado clinico, seed.
- **01b**: la API se conecta como `app_user` (sin superusuario ni BYPASSRLS), FORCE RLS, acceso vigente, auditoria `accesos_ficha`.
- **01c**: roles GESTION y PACIENTE, RLS en todas las tablas operativas, derivaciones con oferta secuencial.
- **01d**: directorio y perfiles publicos, catalogo de tipos de atencion, supervision, consentimiento, bajas, RLS restante.
- **01e**: cifrado de aplicacion con contingencia de llaves (Shamir 2 de 3), perfil y cobro, agenda por modalidad, consentimiento por derivacion.
- **01f**: cambio de supervisor con avisos, cierre de cuentas con gracia, tipos de sesion, disponibilidad en minutos, retencion, margen de traslado.
- **01g**: ADMIN no se autodesactiva, `revisado_por` en tipos de sesion, `enlace_online` cifrado, reglas de API en CLAUDE.md.

## Tests
- `backend/prisma/tests/correr_tests_bd.sh` (Postgres 18 temporal): **85 casos SQL** por rol + `migrate diff` + arranque de la API como `app_user` + scripts de llaves reales (aprovisionar, rotar, recuperar con 2 de 3, cambiar custodios).
- `npx jest` (backend): **16 tests unitarios** de cifrado y contingencia.

## Pendientes de Docker (no probados: Docker no instalado)
- `infra/scripts/reset_dev.sh`
- `infra/scripts/llaves/verificar_respaldo.sh`
- `MODO=docker` de los scripts de llaves
- Secret de la KEK (`vinculos_kek`) y config de la publica en `infra/docker-compose.yml`

## Decisiones movidas a la API (02)
Detalle en `docs/seguridad/requisitos_02_apis.md`.
- CryptoModule: KEK desde archivo, huella y canarios al arrancar, falla cerrado; job diario de canarios.
- Extension de Prisma para campos cifrados; descifrado manual en `$queryRaw`; ids generados en la API.
- Validacion de formato en DTOs (RUT con DV, telefono, datos bancarios); redaccion de logs.
- Generacion y expiracion de `enlace_online`.
- Aviso de margen de traslado en la UI con alternativas (la BD ya lo impone).
- Alerta cuando una baja no se procesa por dejar al centro sin ADMIN.
- Job de recalculo de `rut_hmac` ante compromiso de la llave HMAC (manual, runbook).
- UI que une los dos pasos de reactivar un practicante (`cambiar_supervisor` + `otorgar_acceso_practicante`).
- "Pago pendiente" provisorio: se redefine en Cobros.

## Decisiones pospuestas
- Custodio de la parte 2 de la llave de recuperacion por centro (quien, como se entrega).
- Validacion legal del modelo de consentimiento ("se consiente quien atiende, se informa quien supervisa", conformidad tacita a las 48 h) frente a Ley 21.719 y Ley 20.584.
