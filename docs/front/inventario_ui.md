# Inventario UI (03b-1)

Fuente: las 15 vistas de `design-system/vinculos/Tenant/*.dc.html` y los
tokens del sistema Organic exportado en `design-reference/`. Las vistas son
referencia: se reimplementan como componentes React, nunca se copian.

## Tokens

Valores en `frontend/src/app/globals.css` (`@theme`). Así se usan como
utilidades de Tailwind (`bg-accent-2-700`, `shadow-md`, `rounded-lg`).

| Token | Usos en las vistas | Rol |
|---|---|---|
| `--font-body` (Figtree 400-900) | 320 | Única tipografía de las vistas (títulos en 900 con tracking negativo) |
| `--color-text` | 232 | Texto principal |
| `--color-bg` | 167 | Superficie de tarjetas, sidebar y páginas públicas |
| `--color-neutral-100..900` | 785 | 600/700: textos secundarios; 300: fondo del backoffice; 400: bordes de botones y campos |
| `--color-divider` | 212 | Bordes de tarjetas y separadores |
| `--color-accent-2-100..900` (verde) | 465 | Paciente y público: acciones, item activo del menú, enlaces |
| `--color-accent`, `-100..900` (terracota) | 495 | Equipo: acciones del panel, sobretítulos, avisos |
| `--radius-lg` (28 px) | 116 | Tarjetas y paneles. Botones, campos y badges usan pastilla (999 px) |
| `--shadow-sm/md/lg` | 138 | sm: tarjetas en reposo; md: paneles y sidebar; lg: hover y login |
| `--font-heading` (Caprasimo) | 0 | Está en el sistema, pero ninguna vista la usa: no se carga |

Iconos: Material Symbols Rounded (peso 500), como en todas las vistas. Google
sirve solo los glifos de `frontend/src/lib/iconos.ts` (`icon_names`); un icono
fuera de esa lista no compila. Figtree se sirve desde el mismo origen
(`next/font`). El sistema Organic declara Lucide, pero las vistas del tenant no
lo usan. Gana la vista.

### Ajuste por contraste AA (desviación del diseño)

`impeccable detect` y el cálculo WCAG dan menos de 4.5:1 en dos combinaciones
del diseño. Se sube un tono:

| Diseño | Contraste | Implementado | Contraste |
|---|---|---|---|
| Texto `neutral-100` sobre botón `accent-2-600` | 3.8:1 | `accent-2-700` (hover `-800`) | 5.9:1 |
| Texto `neutral-100` sobre botón `accent-600` | 4.1:1 | `accent-700` (hover `-800`) | 6.2:1 |
| Texto secundario `neutral-600` sobre `bg` | 3.6:1 | `neutral-700` | 5.5:1 |
| Placeholder | 3.1:1 | `neutral-700` | 5.5:1 |

El punto de la marca y los bordes siguen con `-600` (son decorativos, no son texto).

## Componentes repetidos y dónde viven

| Patrón en el diseño | Vistas (apariciones) | Componente | Carpeta |
|---|---|---|---|
| Botón pastilla (sólido, con borde, sin borde) | 13 (85) | `Button` (primary, team, secondary, ghost) | `ui/` |
| Superficie con borde, `radius-lg` y sombra | 15 (116) | `Card` | `ui/` |
| Sobretítulo en mayúsculas con línea bajo el h1 | 14 (23) | `Eyebrow` | `ui/` |
| Etiqueta pastilla con borde (box, estado) | 7 | `Badge` | `ui/` |
| Círculo con iniciales | 6 (11) | `Avatar` | `ui/` |
| Campo con etiqueta, texto o área de texto | 12 (29 inputs, 12 textareas) | `Field` + `Input` / `Textarea` / `Select` | `ui/` |
| Grupo de casillas u opciones | 2 | `ChoiceGroup` | `ui/` |
| Icono | todas | `Icon` | `ui/` |
| Punto de color + nombre del centro | todas | `Marca` | `shared/` |
| Header público (marca, nav, "Iniciar sesión", pie) | Landing, Equipo, Match | `LayoutPublico` | `shared/` |
| Header del portal (marca, nav, chip de usuario) | Paciente - Mi Cuenta / Pedir Hora | `LayoutPortal` | `shared/` |
| Sidebar del backoffice (grupos, módulos, usuario) | 9 vistas Admin | `LayoutAdmin` | `shared/` |
| Login con fondo difuso y selector paciente/equipo | Inicio de Sesión | `FormularioIngreso` | `shared/` |
| Saludo con fecha | Dashboard, Mi Cuenta | `Bienvenida` | `shared/` |
| Enlace con forma de boton | Landing, Equipo, Match | `ButtonLink` (mismas variantes que `Button` + `outlinePatient`) | `ui/` |
| "← Volver" | Pedir Hora | `EnlaceVolver` | `ui/` |
| Foto o iniciales del profesional | Landing, Equipo, Match, Pedir Hora | `AvatarProfesional` | `shared/` |
| Bloque verde de llamado a la accion | Landing, Equipo | `LlamadoAccion` | `shared/` |
| Texto de politica versionada | (nuevo) | `DocumentoPolitica` | `shared/` |
| Portada, servicios, mision/vision, equipo destacado, contacto | Landing | `Landing.tsx` | `nucleo/` |
| Tarjeta de profesional, perfil completo, reseñas | Equipo Publico | `TarjetaPerfil`, `PerfilCompleto`, `EquipoPublico` | `equipo/` |
| Cuestionario paso a paso y resultado | Match Publico | `AsistenteMatch`, `PreguntaMatch` | `match/` |
| Bifurcacion, horario, datos, retencion, verificacion | Paciente - Pedir Hora | `InicioPedirHora`, `SelectorHorario`, `SolicitudHora`, `CuentaRegresiva`, `VerificarSolicitud`, `ResultadoEnlace` | `agenda/` |
| Lista de espera sin cuenta (inscripcion, confirmar, salir) | (nuevo, 03b) | `InscripcionListaEspera`, `EnlaceListaEspera` | `agenda/` |
| Casilla obligatoria con forma de tarjeta (aceptar politicas) | Pedir Hora | `Casilla` | `ui/` |
| Ruta del panel o del portal sin pagina (404 dentro del layout) | (nuevo, 03b) | `not-found` de `/admin` y `/portal` con `EstadoVista` | `app/` |
| Modal (overlay fijo) | 7 (9) | pendiente: entra con la primera vista que lo use | `ui/` |
| Tabla | 2 | pendiente | `ui/` |
| Pestañas | 3 | pendiente | `ui/` |
| Tile de estadística, tarjeta de módulo | Dashboard | pendiente (fase dashboard) | `shared/` |
| Calendario, timeline de ficha, wizard de match | Agenda, Fichas, Match | fase de cada módulo | `<modulo>/` |

## Huecos del diseño (resueltos en `design-system/vinculos/MASTER.md`)

- Selector de rol activo y selector de equipo: no están diseñados.
- Estados de carga, vacío, error y sin permiso: no están diseñados.
- Segundo paso TOTP del login: no está diseñado.

## Lo que el diseño muestra y no se implementa en 03b-1

- Módulo inactivo con candado en el menú. La regla 03b es ocultarlo
  (`GET /api/modulos`: "el front oculta los inactivos").
- Cargo bajo el nombre del usuario ("Directora"): la API no tiene cargo, así
  que se muestra el rol activo.
- Login: "¿La olvidaste?", "Recibir enlace de acceso por correo", "Usa tu
  código de invitación" y "Pide tu primera hora" quedan para la fase del
  portal. La API ya los soporta (`recuperacion`, `enlace-acceso`,
  `activacion`, `publico/solicitudes`).
- Dashboard (estadísticas, módulos, sesiones de hoy, pendientes): fase del
  dashboard.
