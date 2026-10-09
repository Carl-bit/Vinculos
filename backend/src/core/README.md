# Core (nucleo de seguridad e infraestructura transversal)

Lo que vive aca lo puede usar cualquier modulo. Lo que vive en un modulo no lo
puede usar otro modulo.

| Carpeta                  | Contenido                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `prisma/`                | `PrismaService` (cliente del silo) + modulo global. Ya generado.                                   |
| `auth/`                  | Login JWT, `JwtStrategy`, `RolesGuard`, decorator `@Roles(...)`, DTOs de login.                    |
| `rls/`                   | `RlsInterceptor`: abre la transaccion y emite `SET LOCAL app.current_usuario_id` / `app.current_rol`. |
| `common/filters/`        | Filtro global que traduce el error del constraint `EXCLUDE` de Postgres a **409 Conflict**.        |
| `common/interceptors/`   | Interceptores transversales que no son el de RLS.                                                  |
| `eventos/`               | Contratos de los domain events (`CitaConfirmada`, etc.) y sus nombres. Es el unico "lenguaje comun" entre modulos. |

Salvo `prisma/`, el contenido lo genera los prompts 02a-02h (`prompts/00_index.md`).
