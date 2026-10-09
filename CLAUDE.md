# CLAUDE.md - Vinculos (ERP modular, tenant actual: Centro de Prueba)

Producto: ERP modular para centros clinicos/psicologicos. El tenant que se
construye y valida primero es un centro de prueba generico (no Kibou), para
pulir los requerimientos comunes a cualquier centro clinico/psicologico
antes de validar contra clientes reales (Kibou incluido). Cada modulo se
construye y se prueba contra este tenant de prueba, no contra datos ni
naming especificos de Kibou. Proyecto de titulo, desarrollador unico.

## Stack (fijo, no proponer alternativas sin pedirlo)
- Backend: NestJS + Prisma ORM + PostgreSQL
- Frontend: Next.js (App Router). Portal publico = SSR/SSG. Backoffice = CSR, auth-gated.
- Infra: Docker Compose por cliente (1 contenedor + 1 DB Postgres = 1 silo). Traefik
  como reverse proxy (labels de Docker, Let's Encrypt automatico). Destino: AWS Lightsail.
- Un repo = un producto. Cada cliente = una instancia desplegada del mismo codigo,
  nunca una rama ni un fork.

## Arquitectura, no negociable
- Monolito modular, single-tenant. Cada silo tiene su propia DB. CERO joins o
  queries entre silos de distintos clientes. Nunca asumir un tenant_id compartido,
  el aislamiento es fisico (contenedor + DB), no logico.
- DDD: 4 bounded contexts + nucleo de seguridad (ver Modulos). Un modulo NUNCA
  importa un servicio de otro modulo directamente. Comunicacion entre modulos via
  EventEmitter interno de NestJS (domain events) o pasando por el nucleo.
- RLS real, no solo filtro en el service: usar politicas de PostgreSQL
  (`CREATE POLICY`) sobre `pacientes` y `fichas_clinicas`, activadas via
  `SET LOCAL app.current_usuario_id` / `app.current_rol` al inicio de cada
  transaccion Prisma. El filtro en el service es una segunda capa, no la unica.
- Reservas de box/agenda: la fuente de verdad es un constraint
  `EXCLUDE USING gist` sobre (espacio_id, rango horario) con la extension
  `btree_gist`. El soft-lock con TTL en tabla aparte es solo UX (evita que dos
  admins choquen en pantalla), nunca reemplaza el constraint. Todo endpoint de
  confirmacion de reserva debe capturar el error de constraint y devolver 409.
- Fichas clinicas: NUNCA hard delete. Modelo append-only para evoluciones
  (`ficha_clinica` fija + tabla `evoluciones` versionada). Retencion minima 15
  años desde la ultima atencion (Decreto 41, Ley 20.584). Acceso a ficha ajena
  solo via tabla `derivaciones` (protocolo formal), nunca por cambio de rol.
- Menores de edad: calcular edad desde `fecha_nacimiento`. Si <18, bloquear
  confirmacion de cita hasta que exista un registro en `adultos_responsables`
  vinculado al paciente.
- Practicantes: acceso siempre con expiracion (`fecha_expiracion_acceso`).
  Revocacion = deshabilitar, nunca borrar su historial de fichas que atendio.

## Modulos y orden de dependencia (= orden de sprints)
1. Nucleo: usuarios, roles, RLS. Sin dependencias, se construye primero.
2. Fichas y Pacientes | Agenda y Espacios | Equipo (RRHH/Perfiles): cada uno
   depende solo del Nucleo, no entre si. Se pueden construir en cualquier orden
   relativo entre ellos.
3. Match Terapeutico: depende de Equipo (requerido) y Agenda y Espacios
   (opcional, para mostrar disponibilidad real).
4. Cobros: depende de Agenda y Espacios (requerido) y Match Terapeutico
   (opcional, solo si se factura por derivacion).

## Fuera de alcance ahora (no implementar salvo pedido explicito)
- Onboarding self-service automatizado. El alta de un cliente nuevo es
  semi-manual via panel maestro, no una pipeline desatendida.
- Panel maestro / admin del producto: deprioritizado al final. Orden real:
  1) infra multi-tenant, 2) tenant de prueba generico (usado para validar
  cada modulo a medida que se construye), 3) sprints de modulos (nucleo
  primero) contra ese tenant, 4) panel maestro. El onboarding de Kibou u
  otro cliente real viene despues de validar el producto con el tenant de
  prueba, no antes.
- Reply in-app profesional -> paciente. El paciente contacta solo via
  formulario in-app (se reenvia a email del profesional + queda en historial
  in-app); el profesional responde por canal externo (no se implementa reply).
- Websockets/Redis para tiempo real: se resuelve con polling + soft-lock TTL.

## Diseño
Fuente de verdad visual: el proyecto de Claude Design "Vinculos Landing Page
Design" (tenant "Centro Ejemplo", vistas Admin- y Paciente- mas
Landing/Login/Match Publico compartidas). Traer el diseño al repo usando el
handoff nativo de Claude Design a Claude Code (boton de handoff dentro del
proyecto de Claude Design), no capturas de pantalla; si se prefiere dejarlo
como archivo versionado, exportar a HTML standalone y guardarlo en
`design-reference/`. No inventar un lenguaje visual nuevo donde ya existe
una pantalla equivalente diseñada; adaptar e implementar lo que ya esta.

Para vistas todavia no prototipadas y para animaciones, usar en el repo:
- `ui-ux-pro-max`: persiste el sistema de diseño en
  `design-system/vinculos/MASTER.md` + overrides por pagina, para que una
  vista nueva salga consistente con las ya construidas.
- `impeccable`: detector deterministico de anti-patrones "AI slop". Correr
  `npx impeccable detect` despues de generar cada vista nueva.

Prohibido sin excepcion, con o sin detector corriendo: degradados
morado-a-azul genericos de IA, Inter como unica tipografia, icono dentro de
un tile cuadrado redondeado repetido sobre cada titulo de seccion,
animaciones con easing de rebote por defecto.

## Componentes (jerarquia obligatoria, aplica a toda vista nueva)
- `components/ui/`: primitivos puros del sistema de diseño (Button, Input,
  Badge, Modal, Card base). Cero logica de negocio, cero fetch. Salen del
  handoff de Claude Design o del MASTER.md de ui-ux-pro-max, nunca se
  reinventan modulo a modulo.
- `components/shared/`: compuestos reutilizables entre publico y admin que
  ya asumen el dominio de Vinculos (LayoutPublico, LayoutAdmin,
  AvatarProfesional). Se arman combinando piezas de `ui/`.
- `components/<modulo>/`: organismos especificos de un bounded context
  (AgendaCalendar en Agenda y Espacios, FichaClinicaTimeline en Fichas y
  Pacientes, MatchWizard en Match Terapeutico). Usan `ui/` y `shared/`,
  NUNCA importan de otro `components/<modulo>/`.
- Antes de crear un componente, revisar si ya existe algo equivalente en
  `ui/` o `shared/` y reusarlo. Un componente que termina igual en dos
  modulos se sube a `shared/`, nunca se duplica.
- `app/(publico)/` y `app/(admin)/` solo componen paginas con piezas de
  `<modulo>/` y `shared/`; no definen estilos sueltos propios ahi.

## Pruebas
Un modulo con estado compartido critico (Agenda y Espacios) no se
considera terminado solo por pasar tests unitarios. Correr
`prompts/04_pruebas.md`: integracion con DB efimera, estres en k6
enfocado en colision de reservas sobre el mismo espacio+horario, y
simulacion con los limites reales del plan de Lightsail de entrada
(512MB/1vCPU). La prueba real es la query de duplicados en `citas`
despues del estres, no el reporte de k6.

## Convenciones
- snake_case en la base de datos, camelCase en TypeScript.
- DTOs con `class-validator` en cada endpoint, sin excepciones.
- Nada de `console.log` en el codigo final, usar el logger de Nest.
- Migraciones de Prisma versionadas, nunca editar una migracion ya aplicada.
- Documentacion y comentarios de dominio en español (idioma del proyecto de
  titulo), nombres de codigo en ingles/español segun ya este establecido en el
  schema (no mezclar dentro de la misma entidad).

## Checklists de seguridad (ver `docs/seguridad/matriz_permisos.md`)
Tabla nueva:
- Declara su categoria A/B/C (`docs/seguridad/criterio_clasificacion.md`) en
  la migracion, el schema y la columna Categoria de la matriz.
- ENABLE + FORCE RLS, politicas por rol + `<tabla>_acceso_vigente` RESTRICTIVE.
- Columna con RUT, contacto, dato bancario o texto clinico: cifrada (bytea +
  CHECK de largo + `backend/src/common/crypto/registro.ts`; id generado por la
  API). Ver `docs/seguridad/cifrado.md`.
- GRANT minimo a `app_user` (nunca DELETE ni UPDATE en datos clinicos/auditoria).
- Caso por rol en `backend/prisma/tests/seguridad_bd.sql` y fila en la matriz.
- Escritura con reglas de estado: sin GRANT directo, solo funcion SECURITY DEFINER.

Endpoint nuevo:
- Dentro de la transaccion del RlsInterceptor; nunca Prisma sin contexto RLS.
- Errores: 23P01/23505/55000/23001 -> 409, 23514 -> 422, 42501 -> 403/404, P0002 -> 404.
- Guard `@Roles` segun la matriz; acceso a datos clinicos registra en `accesos_ficha`.

## API (detalle en `docs/seguridad/requisitos_02_apis.md`)
- Conexion: solo `DATABASE_URL` (app_user). Nunca credenciales de migracion en runtime.
- Toda consulta dentro de la transaccion del interceptor, que empieza con `set_config` de `app.current_usuario_id` y `app.current_rol`. Excepciones: login (`credenciales_login`) y jobs (contexto de sistema documentado).
- Nombres de otros usuarios solo via `directorio_interno`, `mi_equipo_tratante` o `perfiles_publicos`; nunca `include` de Prisma.
- Escrituras con reglas de estado solo via funciones SECURITY DEFINER.
- `createMany` o `$executeRaw` donde el `RETURNING` falle por RLS.
- Campos cifrados segun `registro.ts`; ids de esas filas los genera la API; nunca loguear valores descifrados.
- Validacion de formato (RUT con DV, telefono, etc.) en DTOs.
- Errores: el filtro envuelve el `$transaction` completo (errores al COMMIT); tabla SQLSTATE -> HTTP de requisitos_02_apis.md.
- Cada endpoint: guard segun `matriz_permisos.md` + test de integracion por rol.
- Jobs idempotentes y con `pg_advisory_lock` (una sola instancia corriendo).
- Fuente de verdad: si un prompt contradice la matriz o requisitos_02_apis.md, manda la BD; reportar la contradiccion.

## Formato de entrega de cada fase
1. Archivos creados y modificados.
2. Tests: unitarios, integracion y `backend/prisma/tests/correr_tests_bd.sh` (resultado real, no supuesto).
3. Cambios en docs (matriz, requisitos, estado de fase).
4. Decisiones pendientes y lo que no se pudo probar (y por que).

## Al generar codigo
Antes de escribir, revisar que la entidad/endpoint no rompa una regla de esta
lista. Si una tarea pedida contradice una regla no negociable, avisar antes de
implementar, no implementar la version incorrecta "para despues arreglarla".
