# MASTER - Vinculos (huecos del handoff)

Rige solo donde las vistas de `Tenant/` no tienen pantalla. Usa los tokens
de `frontend/src/app/globals.css` y las piezas de `components/ui/`; no
agrega colores ni tipografías nuevas. Inventario en `docs/front/inventario_ui.md`.

Fuente de criterio: `ui-ux-pro-max` (`.claude/skills/ui-ux-pro-max`). Se
consulta con `python .claude/skills/ui-ux-pro-max/scripts/search.py "..."`
(dominios `style`, `ux`, `react`) y lo que sirve se copia aca a mano. Nunca
`--persist`: genera paleta y fuentes propias (teal, Lora/Raleway) que
contradicen Organic. Estilo de referencia: "Nature Distilled" (terracota,
oliva, crema: calza con Organic), con el checklist de "Accessible & Ethical".

## Reglas generales

- Contraste AA sobre el diseño: texto claro sobre `accent-2-700` /
  `accent-700` (no `-600`); texto secundario en `neutral-700` (no `-600`).
- Verde (`accent-2`) = paciente y público. Terracota (`accent`) = equipo.
- Textura: grano de papel (SVG fractalNoise, opacidad 0.06, multiply) fijo
  sobre todo el sitio. Le quita la planitud de plantilla generada.
- Foco: anillo de 3 px en `accent`, offset 2 px.
- Objetivos tactiles: minimo 40 px (botones de icono `size-10`, items del
  menu `min-h-10`). Todo lo clickeable con `cursor-pointer`.
- Item activo del menu: fondo `accent-2-200` + pastilla de 4x20 px en
  `accent-2-600` pegada al borde del sidebar (escala en Y al activarse).
- Botones solidos: `shadow-sm`, `shadow-md` al hover y `scale(0.98)` al
  presionar.
- Entrada de contenido: `.entrada` (sube 6 px, 320 ms,
  cubic-bezier(0.22, 1, 0.36, 1)), en cada cambio de ruta.
- Carga: el indicador aparece recien a los 300 ms (`.aparecer-tarde`) para
  no parpadear; textos que esperan dato usan `.esqueleto` (barrido 1.4 s).
- Errores de formulario: el mensaje recibe el foco al aparecer.
- Movimiento: transiciones de color de 200 ms con ease-out. Las manchas del
  login derivan con ease-in-out (22 a 34 s). Sin rebote. Todo se apaga con
  `prefers-reduced-motion`.

## Selector de rol activo (sidebar, sobre el bloque de usuario)

- Un solo rol: texto "Rol activo: <nombre>" (11.5 px, `neutral-700`; el
  nombre en 800).
- Varios roles: `Field` "Rol activo" + `Select` compacto (`py-2.5`,
  13.5 px). Al cambiar: se deshabilita mientras pide el token y vuelve al
  inicio del rol. ADMIN se muestra como "Cuenta madre".

## Selector de equipo (solo ADMIN/GESTION, sobre el selector de rol)

- `Field` "Equipo" + `Select`: "Todo el equipo" + profesionales. Es un
  filtro de contexto, no un permiso: no cambia el token.

## Estados de vista (`shared/EstadoVista`)

- Centrados, `py-12`, icono de 28 px en `neutral-500`, título de 16 px en
  800 y mensaje de 13.5 px.
- Carga: `progress_activity` girando. Vacío: `inbox` + acción opcional.
  Error: `error` + "Reintentar" (botón secundario). Sin permiso: `lock`.
- Error de API: el texto sale de `mensajeError` (409/422 con el mensaje de
  la regla; el resto con un texto fijo por estado).

## Login, segundo paso TOTP

- Misma tarjeta, sin el selector paciente/equipo. Sobretítulo
  "Verificación en dos pasos" y h1 "Ingresa tu código.".
- Campo numérico de 6 dígitos (`one-time-code`). En el enrolamiento, la
  clave va en un bloque monoespaciado, seleccionable, antes del campo.
- Botón "Verificar" y "Volver" (ghost).

## Sitio publico (03b-2)

Criterio de ui-ux-pro-max (patron "Trust & Authority" + guias de formularios
y progreso): confianza con datos verificables, precio transparente y formulario
de baja friccion.

- Revelado al hacer scroll: `.revelar` (scroll-driven animations de CSS, sin
  JS; sin soporte o con movimiento reducido, el contenido se ve tal cual).
- Prueba de confianza con datos reales: formacion "verificada por el centro"
  (icono `verified`), valoraciones solo de pacientes atendidos, tarifas
  visibles. El chip del landing muestra profesionales y tarifa desde (la API
  no tiene "proxima disponibilidad").
- Perfil completo (no diseñado): columna de contenido con las secciones del
  detalle de "Match Publico" (solo las que tienen datos) y columna fija con
  "Agenda con X" y valoraciones. Cita destacada en bloque terracota con
  `format_quote`.
- Opciones de cuestionario: inputs reales (radio/casilla) `sr-only` dentro de
  pastillas o tarjetas; foco visible con `has-[:focus-visible]`. La escala es
  una fila de tarjetas con el numero grande (en vez del slider del diseño:
  las opciones las configura ADMIN).
- Avisos de riesgo de una opcion (`mensaje`): bloque terracota con `call` y
  `role="alert"`.
- Pasos: barra de 5 px por paso (Pedir hora) o barra con % y lista lateral
  (Match). El foco va al h1 de cada paso nuevo.
- Grilla de horas: carril de dias con scroll-snap (solo dias con horas),
  modalidad como pastillas, horas agrupadas en Mañana/Tarde.
- Retencion: anillo SVG que se vacia (verde; terracota en los ultimos 5 min) y
  mm:ss tabular. El lector de pantalla solo escucha el aviso cada minuto.
- Enlaces con token (verificar): accion explicita "Confirmar mi hora" (un
  escaner de correo no consume el enlace); `referrer: no-referrer`, noindex.

## Correcciones 03b (lista de espera, 404 en el panel, inactividad)

- Lista de espera sin cuenta: vive dentro de Pedir hora, nunca como pantalla
  aparte. Sin horas, es la accion principal (tarjeta accent-2 bajo el
  mensaje); con horas, va en un `<details>` despues de "Continuar" para no
  competir con la accion primaria. Mismo patron de formulario que Pedir hora
  (Field, `Casilla` de politica, trampa para bots) y la misma respuesta
  siempre.
- Enlaces del correo (confirmar inscripcion, salir): pagina sobria con un solo
  boton explicito (un escaner de correo no consume el token) y resultado con
  `ResultadoEnlace`; sin sobretitulo sobre el h1 (impeccable:
  kicker-above-heading).
- Ruta del panel o del portal sin pagina: `EstadoVista` vacio dentro del
  layout, con el menu y el rol a la vista y un boton secundario al inicio.
- Cierre por inactividad: aviso en el login con borde accent (no error rojo):
  explica el motivo y que basta con volver a ingresar.
