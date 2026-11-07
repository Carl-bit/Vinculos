# Regla de cache (AUD-02 CACHE-04, INFRA-02)

Que puede guardarse en un cache (navegador, Cloudflare, Next, Redis futuro) y
que nunca. Aplica a todo endpoint y vista nueva.

## Nunca a cache

Ningun cache compartido ni persistente guarda:

- Datos clinicos: fichas, evoluciones, ingresos, epicrisis, documentos clinicos, adjuntos, derivaciones.
- RUT, correos, telefonos, direcciones y contacto de emergencia (de pacientes, responsables o equipo).
- Tokens, codigos (2FA, verificacion, recuperacion, descarga), credenciales y cookies de sesion.
- Holds y reservas en curso (`bloqueos_temporales`, citas RETENIDA), pagos y comprobantes.
- Toda respuesta autenticada (`/api/*` con `Authorization`) y todo `/sesion/*`.
- Exportaciones (`.vxp`, JSON, PDF) y enlaces temporales.

## Como se cumple

| Capa | Regla | Donde |
|---|---|---|
| API | `Cache-Control: no-store` en toda respuesta por defecto | `backend/src/configurar-app.ts` (prueba en `test/02a-infra.e2e-spec.ts`) |
| API, excepcion | Solo imagenes publicas de perfil y logo: `public, max-age=31536000, immutable` (id inmutable, sin metadatos) | `match.controller.ts` (`@Header`) |
| Front (Next) | Lecturas publicas del sitio con `revalidate` de 60 s en el servidor (`lib/api/servidor.ts`). Solo catalogo publico: perfiles publicados, tipos de atencion, disponibilidad agregada, contenido publico. Nunca una lectura con sesion | `frontend/src/lib/api/servidor.ts` |
| Navegador | Nada clinico en localStorage, sessionStorage ni IndexedDB. Access token solo en memoria | CLAUDE.md (Front) |
| Cloudflare (al desplegar) | Cache solo de `/_next/static/*` e imagenes publicas; bypass de `/api/*` y `/sesion/*` | `docs/operacion/plan_trabajo_piloto.md` |
| Redis (futuro) | Solo catalogo publico, con el criterio CACHE-06; nunca datos de la lista de arriba | `docs/operacion/auditoria_rendimiento.md` |

## Endpoint nuevo

- No declarar `Cache-Control` publico salvo que la respuesta sea igual para cualquier visitante y no tenga ningun dato de la lista de arriba.
- Una descarga con datos personales no cambia el `no-store` global.
- Un `@Header('Cache-Control', ...)` nuevo se agrega a la tabla de excepciones de este documento.
