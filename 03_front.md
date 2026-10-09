# Prompt - Seccion Frontend (Next.js)

Lee CLAUDE.md y los endpoints ya generados (seccion APIs) antes de empezar.
Este es el frontend de UN silo (una instancia de cliente), no la landing del
producto Vinculos, que es un sitio aparte. Generar el portal publico y el
backoffice completos en una sola pasada, no pantalla por pantalla.

## Paso 0: antes de generar cualquier vista
1. Traer el diseño real via el handoff de Claude Design a Claude Code (o el
   HTML standalone exportado en `design-reference/` si se uso esa ruta).
   Cada vista que ya tiene una pantalla equivalente ahi se implementa
   adaptando ese diseño, no reinterpretandolo ni cayendo en un layout
   generico propio.
2. Si existe `design-system/vinculos/MASTER.md` (generado por ui-ux-pro-max),
   leerlo y usarlo para las vistas que no estan en el handoff.
3. Evitar sin excepcion: degradados morado-a-azul de IA, Inter como unica
   tipografia, icono en tile cuadrado redondeado repetido sobre cada titulo,
   easing de rebote por defecto, tarjetas anidadas dentro de tarjetas.
4. Al terminar cada vista, correr `npx impeccable detect` sobre los archivos
   tocados y corregir lo que marque antes de pasar a la siguiente.

## Estructura general
- App Router de Next.js.
- `app/(publico)/...` renderiza SSR/SSG, sin autenticacion, optimizado para
  SEO (metadata por pagina, sitemap).
- `app/(admin)/...` renderiza CSR, protegido por el JWT del modulo Auth,
  redirige a login si no hay sesion valida.
- Cliente de datos: React Query (o SWR) para todo llamado al backend NestJS,
  nunca fetch suelto repetido por componente.

## Portal publico (captacion de pacientes)
- `/`: landing del centro (no del producto Vinculos), presenta al centro y
  a los profesionales.
- `/profesionales/[id]`: perfil educativo del profesional (especialidad,
  enfoque explicado sin tecnicismos, modalidad, tarifa).
- `/match`: flujo de preguntas -> llama al endpoint de match terapeutico ->
  muestra profesionales recomendados.
- `/busqueda`: filtros avanzados (enfoque, tarifa, modalidad,
  disponibilidad), llama al endpoint de busqueda.
- `/contacto/[profesionalId]`: formulario de mensaje (nombre, contacto,
  mensaje). Al enviar, solo pega al endpoint que reenvia por email y guarda
  historial in-app. No implementar bandeja de respuesta in-app, eso esta
  fuera de alcance.

## Backoffice (admin/profesional/practicante, segun rol)
- `/admin/dashboard`: vista global de ocupacion de agendas (solo ADMIN).
- `/admin/agenda`: calendario de espacios. Al seleccionar un horario libre,
  primero pega al endpoint de bloqueo temporal (soft-lock), muestra el
  espacio como "en proceso de reserva" con cuenta regresiva visible, y solo
  al confirmar pega al endpoint de confirmar cita. Si el backend devuelve
  409 (alguien gano la carrera), mostrar mensaje claro y refrescar
  disponibilidad, no reintentar solo. Refrescar disponibilidad por polling
  cada pocos segundos mientras la pantalla de agenda este abierta (no usar
  websockets, no esta en el alcance).
- `/admin/pacientes`: lista y ficha de pacientes, visible solo segun lo que
  el backend devuelva ya filtrado por RLS (el frontend no debe intentar
  ocultar/mostrar fichas por su cuenta, confia en lo que el backend
  entrega).
- `/admin/pacientes/[id]/evoluciones`: timeline de evoluciones (solo
  agregar, nunca editar una entrada existente en la UI, coherente con que
  el backend tampoco lo permite).
- `/admin/equipo`: gestion de profesionales y practicantes (solo ADMIN),
  incluye alta/baja de acceso temporal con fecha de expiracion visible.
- `/admin/cobros`: arriendos, comisiones, pagos, emision de boleta.

## Componentes (seguir la jerarquia de CLAUDE.md, no crear una propia)
- `components/ui/`: Button, Input, Badge, Modal, Card base. Extraer del
  handoff de Claude Design, no inventar variantes nuevas.
- `components/shared/`: LayoutPublico, LayoutAdmin (header distinto, admin
  siempre con el rol visible y logout), AvatarProfesional.
- `components/agenda/`: SelectorHorario con estado visual de libre /
  bloqueado por mi / bloqueado por otro / confirmado.
- `components/pacientes/`: FormularioPaciente con validacion de fecha de
  nacimiento que anticipa si va a requerir adulto responsable (espejando la
  regla del backend, sin reemplazarla).
- Antes de escribir un componente nuevo, revisar si `ui/` o `shared/` ya
  tienen algo equivalente.

## Restricciones que no se pueden dejar pendientes
- El portal publico y el backoffice completo salen en esta pasada, no
  "primero el publico y despues el admin en otra conversacion".
- Ninguna pantalla debe replicar en el cliente una regla de negocio que ya
  vive en el backend (RLS, EXCLUDE, validacion de menores); el frontend
  refleja el estado que el backend entrega, no decide por su cuenta.

## Salida esperada
- Paginas y componentes listados arriba, con llamadas reales a los
  endpoints del modulo APIs (no mockeados).
- README corto indicando variables de entorno esperadas (URL del backend,
  etc.) para levantar el frontend contra el backend local.
