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
- Texto directo sobre el fondo del panel (`neutral-300`): `neutral-800`
  (`neutral-700` da 4.4:1). Por eso la bajada de `Encabezado`,
  `EnlaceVolver`, la ayuda de `Field` y las opciones de `ChoiceGroup` van en
  `neutral-800` (03b-5.1).
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

- Lista de espera: retirada de la primera version (implementacion futura).
  Si se retoma, el criterio de diseño era este: vive dentro de Pedir hora,
  nunca como pantalla aparte. Sin horas, es la accion principal (tarjeta accent-2 bajo el
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

## Portal del paciente y paginas por enlace (03b-3)

- "Mi cuenta" sigue el diseño (dos columnas que bajan a una: profesional,
  horas, mensajes | datos, nota de ficha). Las secciones que el diseño no
  tiene (pagos, documentos, consentimientos, avisos, reseñas,
  seguridad) van en una fila de pildoras bajo el header, con la
  activa en accent-2-700; en movil la fila hace scroll horizontal.
- Solo el inicio del portal lleva sobretitulo ("Mi cuenta", como el diseño);
  las secciones nuevas y las paginas por enlace no (impeccable:
  kicker-above-heading). Excepcion: el paso TOTP, definido arriba.
- Adulto responsable: selector "Estás viendo la cuenta de" en un bloque
  accent-2-100 sobre las secciones; el menor elegido vive solo en memoria.
  Los textos cambian a tercera persona ("Su profesional", "Datos de Sofia").
- Cuenta restringida (14-17): las secciones que no le corresponden no
  aparecen en el menu; si entra por URL, `EstadoVista` sin permiso con la
  explicacion (no un 403 seco).
- Toda accion con consecuencias (aceptar o rechazar un consentimiento,
  oponerse, retirar, cancelar una hora, mostrar el nombre en una reseña)
  abre `Modal` con lo que pasa antes de confirmar. La pagina del enlace de
  consentimiento muestra lado a lado "Si aceptas" (exito) y "Si no aceptas"
  (advertencia).
- Paginas por enlace de cuenta (recuperar, acceso, activar, correo): misma
  tarjeta de vidrio del login (`TarjetaIngreso`), sin sobretitulo; el token
  se usa recien al presionar el boton y el resultado se muestra en la misma
  tarjeta (`ResultadoCuenta`). Enlace vencido: icono link_off y como pedir
  uno nuevo.
- TOTP: el enrolamiento muestra el codigo QR (generado en el navegador, sin
  red) y la clave monoespaciada debajo.
- Datos de transferencia del profesional: solo al pedirlos ("Ver datos para
  transferir"), en un bloque accent-2-100 con los valores seleccionables; no
  quedan en cache (gcTime 0).

## Backoffice (03b-4)

- Encabezado de cada módulo con sobretítulo cuando el diseño lo tiene
  (Agenda y Espacios, Cobros, Configuración, Match Terapéutico); Equipo y
  Mi perfil no lo tienen en el diseño y tampoco lo llevan acá.
- Secciones de un módulo: `Pestanas` en tono equipo (accent-700) bajo el
  encabezado, con la vista en la URL (`?vista=`), para que un pendiente del
  dashboard abra la pestaña que lo resuelve.
- Selector de periodo (semana / mes, por profesional / por box): pildora
  con borde y la opción activa en accent-700, flechas a los lados y el
  nombre del periodo en 13.5 px 800.
- Calendario: grilla como el diseño (columna de horas en neutral-100, celdas
  libres en neutral-100 con "Libre"); cada sesión con borde izquierdo de 4 px
  del color del profesional o del box (del diseño; impeccable lo marca como
  side-tab y se acepta) y el estado en mayúsculas. En móvil la grilla hace
  scroll horizontal dentro de su sección, nunca la página.
- Acciones con consecuencias (cancelar una cita, cubrir con acceso
  temporal, dar de baja, revocar, ocultar una reseña): bloque accent-100 con
  borde accent-500 que explica qué pasa y pide confirmar en el mismo lugar.
- Formularios largos (Configuración > Datos, Reglas y plazos): barra de
  guardado fija abajo (pildora bg con borde y sombra) con el mensaje de
  resultado a la izquierda.
- Datos sensibles (datos para pagos, RUT de otro): ocultos hasta "Ver datos";
  se piden a la API solo al abrirlos y no quedan en caché (gcTime 0).
- Listas de catálogo y de declaraciones: chips con borde (aprobado en
  accent-2, propuesto con badge "Por revisar", inactivo en neutral).

## Ficha clínica, plantillas y catálogos (03b-5.1)

- Ficha clínica: sobretítulo "Ficha clínica" (11 px, accent-800) sobre el
  nombre del paciente; secciones en `Pestanas` tono equipo con `?vista=`;
  columna derecha de 320 px (desde `xl`) con contacto de emergencia.
- Línea de tiempo (`FichaClinicaTimeline`): de la más reciente a la más
  antigua; cada registro en superficie neutral-100 con borde `divider`; el
  registro ya corregido pasa a borde punteado neutral-400 y badge
  "Corregida"; la corrección lleva badge "Corrección" y ambos se enlazan con
  `#evolucion-<id>`. Nivel de riesgo MEDIO/ALTO en tono atención y un aviso
  sobre la línea de tiempo con el último riesgo.
- Editor de evolución: `Panel` variante equipo; indicador de guardado a la
  derecha del título (12.5 px, `role=status`). Los campos estructurados van
  en el modal de confirmación (no se guardan en el borrador). Texto libre
  siempre con el aviso de no escribir datos identificatorios.
- Registros append-only (evolución, ingreso, alta, documento): confirmar
  explica que después no se edita ni se borra; corrección = registro nuevo.
- Vista previa de documentos: PDF real de la API en un `iframe` dentro de
  un marco neutral-100 con título; el object URL se libera al cambiar el
  texto o cerrar. "Emitir" se habilita solo después de verla.
- Editor de plantilla: cada campo en una tarjeta neutral-100 (sin tarjeta
  exterior: el editor reemplaza la lista, no la envuelve); subir, bajar y
  quitar con botones de icono de 40 px y `aria-label`; la clave interna se
  deriva de la etiqueta y se muestra en monoespaciada.
- Datos auditados al consultarlos (retención): no se piden al entrar a la
  vista, sino con un botón explícito que avisa que la consulta queda
  registrada.

## Acceso a fichas ajenas, supervisión y mensajes (03b-5.2)

- Ofertas de derivación: tarjeta accent-100 con borde accent-500 (requiere
  respuesta); solo motivo, edad y tipo. Aceptar o rechazar confirma en un
  modal que explica el traspaso (o el consentimiento, si es practicante).
- Listas con estado (derivaciones, consentimientos, accesos): fila con
  nombre en 14.5 px 800 + badge de estado, metadatos en 12.5 px y acciones a
  la derecha; sin tarjeta por fila (divisores).
- Supervisión: lista de casos por código en monoespaciada (nunca nombres) a
  la izquierda, evoluciones del caso a la derecha. Comentarios separados por
  divisores (no borde lateral de color: impeccable lo marca como side-tab).
- Mensajes: lista de conversaciones a la izquierda con contador de no leídos
  (píldora accent-700); burbuja propia en accent-200 a la derecha, ajena en bg
  a la izquierda; "Mensaje retirado" en cursiva neutral-700; "Leído por" al
  pie. Polling (30 s la lista, 15 s la conversación).

## Cierre de flujos (03b-5.3)

- Menú del panel en móvil (< md): barra superior con marca, "Rol: <rol>"
  (12 px, siempre visible) y botón de icono de 40 px "Abrir menú"
  (`aria-expanded`, `aria-controls`); se cierra al cambiar de ruta.
- Modales: `ui/Modal` se monta en un portal sobre `body` (nunca anidado en
  la tarjeta que lo abre).
- Tamaño mínimo de texto funcional: 11 px (etiquetas en mayúsculas); 12 px
  para texto corrido secundario.
- `Eyebrow` tono paciente: accent-2-800 (accent-2-700 da 4.4:1 sobre el
  fondo del panel).
- Filtro directo del match: dentro de la tarjeta del asistente, resultados
  separados por divisores (no tarjetas anidadas); el panel lateral cambia el
  progreso por un texto que explica el modo.
