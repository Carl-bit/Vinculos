# Verificación de roles (03b-4.1)

Playwright `frontend/e2e/roles.spec.ts` contra la API local, el seed demo
(`docs/pruebas/usuarios_demo.md`) y Mailpit. Por usuario: el menú muestra
exactamente lo de la tabla, entrar por URL a una ruta no permitida muestra
"sin permiso" (portal del adolescente: "Esta sección la ve tu adulto
responsable") y la API responde 403 a la acción indicada. Roles según
`docs/seguridad/matriz_permisos.md`.

Resultado (2026-10-21): **8 de 8 casos OK** (dos corridas seguidas de
`roles.spec.ts` + `sesion.spec.ts`: 18/18). En una corrida previa un caso
falló por leer el menú antes de que llegaran los módulos activos; el test
ahora espera el número exacto de enlaces.

## Backoffice (rol x vista)

P = en el menú y permitido; B = bloqueado ("No tienes acceso a esta sección
con el rol activo"); — = no aplica.

| Vista | ADMIN (`admin`) | ADMIN+PROFESIONAL con PROFESIONAL activo (`directora`) | GESTION (`gestion`) | PROFESIONAL (`profesional1`) | PRACTICANTE (`practicante`) |
|---|---|---|---|---|---|
| Inicio | P | P | P | P | P |
| Mi perfil | P | P | P | P | P |
| Mensajes | P | P | P | P | P |
| Fichas y Pacientes | P | P | P | P | P |
| Agenda y Espacios | P | P | P | P | P |
| Equipo | P | P | P | P | P |
| Match Terapéutico | P | B (probado) | B (probado) | B (probado) | B |
| Cobros | P | P | P | P | B (probado) |
| Configuración | P | B (probado) | B (probado) | B (probado) | B (probado) |
| Página pública | P | P | P | P | P |
| API 403 probada | `GET portal/citas` | `GET usuarios` | `PATCH configuracion` | `GET usuarios` | `GET cobros/liquidaciones` |
| Resultado | OK | OK | OK | OK | OK |

## Portal (rol x sección)

| Sección | PACIENTE adulto (`paciente`) | PACIENTE adolescente (`adolescente`) | RESPONSABLE (`madre.demo`) |
|---|---|---|---|
| Resumen | P | P | P |
| Pagos | P | B (probado) | P |
| Documentos | P | B (probado) | P |
| Consentimientos | P | B | P |
| Avisos | P | P | P |
| Reseñas | P | B | P |
| Seguridad | P | P | P |
| Backoffice `/admin` | redirige a `/portal` | redirige a `/portal` | redirige a `/portal` |
| API 403 probada | `GET usuarios` | `GET cobros/liquidaciones` | `GET directorio` |
| Resultado | OK | OK | OK |

Además (`sesion.spec.ts`): un PACIENTE en `/admin` vuelve al portal; el
equipo no ve "Equipo" (selector) salvo ADMIN/GESTION; el selector de rol
solo aparece en cuentas con dos roles.
