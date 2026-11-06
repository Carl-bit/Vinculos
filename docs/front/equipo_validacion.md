# Equipo del centro, versión 1: ficha del integrante con lista de validación

Fecha: 2026-11-05. Diseño de referencia:
`design-reference/Equipo/Versión 1 ficha del integrante con lista de validación-html/Main.dc.html`.

Este documento registra qué se implementó del diseño, qué flujos se agregaron
o corrigieron y dónde el diseño choca con las reglas de negocio ya vigentes
(gana la BD). Sirve para revisar si cada cambio es válido antes de subirlo.

Capturas (scratchpad de la sesión, no versionadas):
`eq-antes-*.png` (antes) y `eq-v1-integrantes.png`, `eq-v1-practicante.png`,
`eq-v1-practicantes.png`, `eq-v1-resenas.png` (después).

## 1. Qué cambia en pantalla

| Zona | Antes | Ahora (diseño v1) |
| --- | --- | --- |
| Cabecera | Título grande + pestañas sueltas | Lienzo punteado, barra flotante "Equipo del centro" con las secciones y **contadores de pendientes**; "Nueva cuenta" a la derecha |
| Resumen | — | Pastillas: integrantes, habilitados, por validar, vencidos |
| Lista | Tira horizontal o lista (preferencia en `localStorage`) | Panel lateral fijo: búsqueda, filtros **Todos / Por validar / Vencidos**, grupos por rol principal y **estado de validación** por integrante. Se retira la tira |
| Ficha: cabecera | Nombre, especialidad, roles | + estado (Habilitado / Por validar / Vencido / Baja / No requiere / Inactiva) y acciones **Ver perfil público**, **Escribirle**, **Ver su agenda** |
| Ficha: validación | Paneles separados (registro SIS, trayectoria, tipos) | Lista paso a paso con progreso "n de m al día"; cada paso con sus acciones |
| Ficha: perfil público | Formulario editable por la cuenta madre | **Solo lectura** + avisos del perfil + **Pedir una corrección** |
| Ficha: trabajo con pacientes | Panel "Horas y pacientes" | Igual, compacto, con enlace al seguimiento |
| Ficha: administrativo | Paneles "Tarifas" (historial) y "Datos para pagos" | Correo, tarifa vigente, **acuerdo con el centro (A/B/C)**, datos para pagos (a pedido) y estado de la cuenta |
| Ficha: cuenta | Panel "Cuenta" | Se mantiene (roles, activar, invitación, segundo factor, baja) |
| Practicantes | Tabla | Tarjetas con resumen, supervisor / práctica / acceso y acciones |
| Reseñas | Lista | + filtros Todas / Por moderar / Publicadas / Ocultas / Reportadas y la regla visible |
| Catálogos y Alertas | — | Sin cambios (ya coincidían con el diseño) |

Archivos: `components/equipo/EquipoCentro.tsx` (reescrito),
`components/equipo/FichaValidacion.tsx` (nuevo),
`components/equipo/PracticantesEquipo.tsx`, `components/equipo/ModeracionResenas.tsx`,
`components/ui/Pestanas.tsx` (contador opcional), `lib/validacionEquipo.ts`
(nuevo, con test). `FichaIntegrante.tsx` queda para "Mi perfil" de la cuenta
madre (modo `propio`) y exporta `AsignarTipos` y `CuentaIntegrante`.

## 2. Cómo se calcula la validación (`lib/validacionEquipo.ts`)

No existe un estado "habilitado" guardado en la BD: se arma con lo que la API
ya entrega.

- **Profesional** (rol principal o adicional): registro SIS verificado
  (automático o manual), al menos un título `TITULO` verificado (la BD exige
  respaldo para verificar) y ningún tipo de atención ni especialidad en
  `PROPUESTO`.
- **Practicante**: supervisor vigente, práctica en curso y acceso vigente
  (el vencimiento del acceso solo lo ve ADMIN; GESTION ve los dos primeros).
- **Cuenta madre o gestión sin rol profesional**: no requiere validación.
- Estado: Inactiva (cuenta desactivada) > Baja (baja de la cuenta o del rol
  profesional sin procesar) > Vencido (acceso de práctica vencido) >
  Habilitado / Por validar.
- Los pedidos de la lista usan las mismas claves de caché que la ficha (abrir
  un integrante no repite pedidos). Son 4 por profesional: con más de ~30
  profesionales conviene un endpoint agregado (`ponytail:` en el código).

## 3. Flujos agregados o corregidos

1. **Pedir una corrección del perfil** (nuevo). La cuenta madre elige motivos y
   un mensaje opcional; se abre una conversación general en Mensajes con el
   profesional. No modifica el perfil.
2. **Escribirle** (nuevo). Conversación general en Mensajes y navegación al hilo.
3. **Auditoría de los datos para pagos** (nuevo, API). El diseño dice "Ver los
   datos para pagos queda en la auditoría", pero la lectura no se registraba.
   Ahora `GET /profesionales/:id/datos-privados` deja una fila en
   `registro_exportaciones` (`recurso = profesional_datos_privados`) cuando
   quien lee no es el titular. Test: `backend/test/02e-equipo.e2e-spec.ts`.
4. **Fecha de práctica** corregida. La práctica salía un día antes
   ("6 oct" en vez de "7 oct") por leer la fecha como UTC; ahora se lee como día
   de calendario.
5. **Contadores en las secciones**: practicantes vencidos o sin supervisor,
   propuestas por revisar, reseñas por moderar o reportadas, y alertas + pacientes
   por reasignar + bajas pendientes.

## 4. Decisiones del usuario (2026-11-08) y cómo quedaron

La primera versión dejó estos puntos como contradicciones con la BD. El
usuario los resolvió y se implementaron en BD, API y front (migración
`20261108000000_equipo_validacion`).

| Punto | Decisión | Implementación |
| --- | --- | --- |
| "Por validar: no aparece en el sitio hasta validar" | La validación la hace la cuenta madre y el no validado **no** aparece en el sitio | `profesional_validado(uuid)` = registro SIS verificado + título `TITULO` verificado. Lo exigen `perfiles_publicos`, `registros_sis_publicos`, `disponibilidad_publica` (rama pública) y `crear_solicitud_hora`. En la ficha, solo el registro SIS y el título bloquean; los tipos de atención por revisar son un pendiente que no bloquea |
| Certificado de alumno regular y convenio de práctica | Se agregan como los respaldos de títulos; **no** afectan el acceso (lo definen las fechas de la práctica) | Tabla `practicante_documentos` (A, cifrada IDENTIFICACION, versionada). Suben el propio practicante (Mi cuenta > Mi formación) y la cuenta madre (ficha); leen el propio, ADMIN y GESTION; descarga auditada; `cerrar_cuenta` los borra. Paso "Documentos de la práctica" en la validación, informativo |
| Observar un título | La cuenta madre observa el documento, descargándolo o viéndolo en la plataforma | `observar_trayectoria` (ADMIN): el título vuelve a revisión con la observación; la limpia un respaldo nuevo o verificar. Visor en pantalla (`VisorArchivo`, la vista queda en el registro de descargas). El profesional ve la observación en Formación y recibe un mensaje |
| Corrección del perfil público | A la segunda solicitud del mismo dato sin cambios, la cuenta madre puede modificarlo y avisa: "Administración cambió el campo X por esta razón; si crees que no es correcto, modifícalo e indica el cambio a administración" | `correcciones_perfil` (B) con `pedir_correccion_perfil` y `corregir_campo_perfil` (la BD exige la segunda solicitud sin cambios: huella md5 del valor). ADMIN y GESTION ya no editan directo el texto público ajeno (trigger `profesionales_campos_publicos`); se retira `POST profesionales/:id/foto`. La foto solo la cambia el profesional |
| "Le llegó a su bandeja y por correo" | Sin cambio | La mensajería interna no envía correo: llega a Mensajes. **Pendiente**: aviso por correo (con SMTP) |
| Tipos de atención con "uso" en Catálogos | Sin cambio | La API no entrega el conteo |

## 5. Ajustes de pantalla de la segunda ronda

- Fondo de puntos: lo pinta el `<main>` del panel cuando la página marca
  `data-lienzo` (Mi perfil, Mi cuenta, Equipo); cubre todo el módulo y no la
  barra lateral.
- Ficha: el bloque con el nombre queda fijo arriba al desplazarse (mismo alto,
  sin cambiar de tamaño). "Ver su agenda" abre el mismo popup de Fichas y
  pacientes (`shared/AgendaProfesional`, subido desde `pacientes/`).
- Ficha: Cuenta debajo de Perfil público y al lado de Administrativo; vuelven
  Calificaciones (izquierda) e Historial de tarifas (derecha).
- Lista: ícono de búsqueda al final del campo; filtra mientras se escribe.

## 6. Pruebas

- BD: `seguridad_bd.sql` caso 161 (validación pública, observación, documentos
  del practicante, correcciones), casos 49 y 70 adaptados.
- Integración: `equipo-validacion.e2e-spec.ts`, `02e-equipo` (GESTION ya no
  edita el texto público ajeno) y `03b42b` (sin registro SIS sale del sitio).
- Vitest: `lib/validacionEquipo.test.ts` (bloqueantes vs informativos,
  documentos, práctica sin desfase, avisos del perfil).
- Playwright: `panel.spec.ts` "Equipo (diseño version 1)" (corrección por
  campo y popup de agenda). `publico.spec.ts` necesita el seed nuevo
  (`npm run demo:reset`): con la BD local anterior solo 2 profesionales están
  validados.
