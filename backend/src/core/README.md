# Core (infraestructura transversal, 02a)

Lo que vive aca lo puede usar cualquier modulo. Lo que vive en un modulo no lo
puede usar otro modulo.

| Carpeta | Contenido |
| --- | --- |
| `config/` | Validacion de variables de entorno al arrancar (`Entorno`): si falta algo, la API no arranca. |
| `prisma/` | `PrismaService`: cliente base (sin cifrado). Solo lo usan `crypto/` y `bd/`. |
| `crypto/` | `LlaveroService`: KEK desde archivo, huella y canarios al arrancar (falla cerrado), job diario, descifrado de `$queryRaw`, HMAC de RUT. |
| `bd/` | `ContextoBd`: transaccion por request con `set_config` + `acceso_vigente()`, tx en CLS (`tx()`), `sinContexto()` solo para login/publico/jobs/salud, `alConfirmar()` (despues del COMMIT). Extension de Prisma de cifrado (`claro()` / `texto()`), auditoria `accesos_ficha`. |
| `rls/` | `RlsInterceptor`: abre la transaccion de cada request autenticada. |
| `auth/` | Login, refresh rotativo, logout, `JwtGuard` y `RolesGuard` globales, `@Roles`, `@Publico`, `@Actor`. |
| `errores/` | Filtro global SQLSTATE -> HTTP (`sqlstate.ts`), nunca el texto de Postgres. |
| `logs/` | pino con request id y redaccion de campos de `registro.ts` y credenciales. |
| `jobs/` | Crons sin contexto con `pg_try_advisory_xact_lock` por job. |
| `notificaciones/` | Registro de avisos (tabla `notificaciones`), job de envio e interfaz de correo (simulada). |
| `eventos/` | Contratos de los eventos de dominio: el unico lenguaje comun entre modulos. |
| `salud/` | `GET /api/salud`: BD y canarios, sin datos. |
| `validacion/` | RUT con DV (misma normalizacion que el indice ciego), telefono, recorte de texto. |

Orden por request: `JwtGuard` -> `RolesGuard` -> `RlsInterceptor`
(transaccion + contexto) -> handler -> `SET CONSTRAINTS ALL IMMEDIATE` ->
COMMIT -> acciones `alConfirmar` (eventos) -> respuesta. `FiltroErrores`
traduce cualquier error de ese recorrido.
