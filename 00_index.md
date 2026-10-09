# Indice de prompts - Vinculos ERP

Una sesion de Claude Code por prompt, en este orden. CLAUDE.md se lee
siempre primero, en cada sesion, antes del prompt de turno.

## Back
1. `01_bd.md` - schema Prisma completo (BD): las 5 areas del sistema,
   constraints (EXCLUDE, politicas RLS), sin dependencias previas.
2. `02_apis.md` - modulos NestJS completos (API): guards de RBAC,
   interceptor de RLS, los 5 modulos. Depende de 01 (usa el schema ya
   generado).

## Pruebas (back)
3. `04_pruebas.md` - integracion (Jest/Supertest), estres (k6) enfocado en
   la colision de reservas sobre el EXCLUDE constraint, y simulacion de
   los limites reales de Lightsail con Docker. Depende de 02. Correrlo
   antes o en paralelo a 03, no despues: mas barato encontrar un bug de
   concurrencia ahora que con UI ya construida encima.

## Front
4. `03_front.md` - portal publico + backoffice completo (Next.js):
   jerarquia de componentes, vistas segun el handoff de Claude Design.
   Depende de 02 (consume los endpoints ya generados).

## Reglas transversales (definidas una vez en CLAUDE.md, no repetir en cada prompt)
- Arquitectura: monolito modular, single-tenant, DDD, orden de modulos.
- Diseño: fuente de verdad = handoff de Claude Design (Centro Ejemplo),
  persistido en `design-system/vinculos/MASTER.md`, auditado con
  `impeccable detect`.
- Componentes: jerarquia `ui/` -> `shared/` -> `<modulo>/` -> paginas,
  obligatoria para toda vista nueva, incluidas sesiones futuras.

## Al agregar un modulo nuevo mas adelante
Sumar un prompt `0N_<modulo>.md` con el mismo formato que 01-03: tarea,
restricciones que no se pueden dejar pendientes, salida esperada. No crear
una jerarquia de componentes nueva ni redefinir reglas ya fijadas en
CLAUDE.md, solo referenciarlas. Agregar la fila correspondiente a este
indice (Back o Front segun corresponda) en el orden de dependencia real.
