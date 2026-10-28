# Dependencias vulnerables (AUD-01 E0, CENS-S4)

## Revision

`npm run auditoria` (raiz del repo) corre `npm audit --omit=dev
--audit-level=high` en `backend` y `frontend`. Falla (salida distinta de
cero) si hay una vulnerabilidad alta o critica en dependencias de
produccion.

| Cuando | Quien | Que |
|---|---|---|
| Cada semana | Desarrollo | `npm run auditoria`; si falla, corregir en la semana (critica: el mismo dia) |
| Antes de cada despliegue | Quien despliega | `npm run auditoria` debe pasar; si no, no se despliega |
| CI (cuando exista) | Pipeline | El mismo script como gate |

Las vulnerabilidades bajas o moderadas, y las de dependencias de
desarrollo, se revisan en la misma pasada pero no bloquean el despliegue.

## Como corregir

1. `npm audit fix` (sin `--force`): parches compatibles.
2. Si la vulnerable es una dependencia transitiva fijada por otro paquete,
   `overrides` en el `package.json` con la version corregida, limitado al
   paquete que la trae cuando se puede (p. ej. `"next": { "postcss": ... }`).
   Despues, si el lockfile conserva la copia anidada vieja, borrarla y
   reinstalar.
3. Subir una version mayor (Prisma, Next, swagger) es una decision aparte:
   se propone con su impacto y se aplica en una entrega propia.
4. Tras cualquier cambio: `tsc`, tests unitarios, `npm run test:bd`, e2e
   del backend, Vitest, `npm run build` del front y Playwright.

## Estado (2026-10-28)

Fase 0 de AUD-01: backend y frontend con 0 vulnerabilidades de produccion.

| Paquete | Correccion |
|---|---|
| `tar` (critica, via `bcrypt@5`) | `bcrypt@6` (binarios precompilados, sin `node-pre-gyp`; los hashes existentes siguen validos) |
| `body-parser`, `qs`, `nodemailer` | `npm audit fix` |
| `multer` (via `@nestjs/platform-express`) | override `^2.5.0` |
| `deepmerge-ts` (via `prisma@6`) | override `^8.0.2` (sin subir a Prisma 7) |
| `js-yaml` (via `@nestjs/swagger@11`) | override acotado `^5.5.0` |
| `sharp` | `^0.35.5`; sus tipos raiz pasaron a ESM, asi que `tsconfig.json` apunta `sharp` a `dist/index.d.cts` (`paths`); en ejecucion sigue siendo `require('sharp')` |
| `postcss` (via `next@15`) | override acotado `next > postcss ^8.5.30` (sin subir a Next 16) |

Quedan 9 vulnerabilidades bajas en dependencias de desarrollo del backend
(`deepmerge` via herramientas de build); no llegan a produccion.
