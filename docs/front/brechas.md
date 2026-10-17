# Brechas entre el diseño y la API (03a)

Fuente del diseño: `design-system/vinculos/Tenant/*.dc.html` (proyecto de
Claude Design, tenant "Centro Ejemplo", sistema Organic). Fuente del
comportamiento: `docs/seguridad/matriz_permisos.md`,
`docs/seguridad/requisitos_02_apis.md` y `docs/api/openapi.json` (02a-02j).

Regla: el diseño manda en lo visual; la API y la BD mandan en el
comportamiento. Lo que en el diseño contradice una regla de la BD se resuelve
cambiando el texto o el flujo de la pantalla, no la regla.

Leyenda de la columna Estado:

- **OK**: un endpoint existente lo cubre.
- **FALTA (03a)**: falta y esta en el alcance de 03a (seccion 3 del prompt).
- **FALTA (fuera)**: falta y queda fuera de 03a (se propone posponer).
- **C-n**: contradiccion con una regla (ver la seccion "Contradicciones").
- **D-n**: lo resuelve la decision n ya tomada (seccion 2 del prompt).
- **Texto**: se resuelve en el front (copia, etiqueta o calculo de
  presentacion), sin cambio de API.

Los datos de ejemplo del diseño (nombres, montos, cargos como "Psiquiatra" o
"Terapeuta ocupacional" en Cobros) no se consideran requisitos.

## 1. Pantallas publicas

### 1.1 Landing

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Nombre del centro, contacto (correo, telefono, direccion) | FALTA (03a) | contenido publico del centro editable por ADMIN; hoy solo `configuracion.nombre_centro` y requiere sesion |
| Hero, servicios (titulo, texto, icono) | FALTA (03a) | contenido publico del centro |
| "Proxima disponibilidad" del centro | FALTA (03a) | agregado sobre `disponibilidad_publica()` de los perfiles publicos (el front no debe pedir N profesionales) |
| Tarjetas de equipo (nombre, cargo, 2 fotos) | OK + FALTA (03a) | `GET publico/profesionales`; fotos: subida de imagenes publicas (hoy `foto_url` es texto libre) |
| Pedir hora / Match / Equipo / Iniciar sesion | OK | navegacion |
| "Privacidad" | FALTA (03a) | politica de datos versionada (D-3) |

### 1.2 Inicio de sesion

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Correo + contraseña | OK | `POST auth/login` |
| Paciente: "Correo o RUT" | FALTA (03a) | `credenciales_login` solo busca por email; agregar busqueda por `rut_hmac` del paciente (misma respuesta generica si no existe) |
| "¿La olvidaste?" | FALTA (03a) | recuperar contraseña |
| "Mantener sesion iniciada" | Texto | refresh token rotativo ya existe; el check decide si el front guarda el refresh fuera de la sesion del navegador |
| "Recibir enlace de acceso por correo" | C-6 | ver contradiccion; propuesta: enlace de un solo uso al correo verificado |
| Practicante: "Usa tu codigo de invitacion" | FALTA (03a) | activar cuenta por invitacion (mismo flujo para todo el equipo) |
| TOTP | FALTA (03a) | no aparece en el diseño: pantalla nueva (segundo paso del login), obligatorio PROFESIONAL/PRACTICANTE |

### 1.3 Equipo publico

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Nombre, foto, titulo, base (titulo de pregrado y año) | OK | `perfiles_publicos()` (titulos verificados) |
| Precio | OK | tarifas vigentes en `perfiles_publicos()` |
| Modalidad | OK | `profesionales.modalidad` |
| Años de experiencia | FALTA (03a) | derivado de la trayectoria (año del titulo mas antiguo), nunca editable |
| Calificacion y cantidad | D-1 | reseñas: promedio y cantidad en `perfiles_publicos()` |
| Filtro por atencion (adultos, parejas, adolescentes, niños) | FALTA (03a) | filtro por `tipos_atencion` aprobados en `GET publico/profesionales` |
| "Lead", bio, enfoque, posgrado, experiencia, especialidades, categorias (cada seccion solo si existe) | OK parcial | bio, enfoques y trayectoria existen; "enfoque" como texto aparte y "experiencia laboral" no existen: la trayectoria tiene tipo OTRO. Propuesta: experiencia = trayectoria tipo OTRO; enfoque = `enfoques[]` |
| Practicante con ficha publica y "Pedir hora con Josefa" | C-3 | |
| "Pedir hora con X" | OK + D-2 | solicitud de hora sin cuenta con profesional elegido |

### 1.4 Match publico (7 pasos)

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Preguntas: motivos (multi), para quien, intensidad 1-10, relato, dias y franjas (max. 3), prevision, modalidad | FALTA (03a) | cuestionario configurable (preguntas, opciones, pesos); hoy `GET publico/match` tiene filtros fijos |
| Mensaje de riesgo en intensidad 9-10 (Salud Responde) | FALTA (03a) | texto de la opcion, parte del cuestionario configurable |
| Resultado: mejor match, "por que", advertencia si no cumple modalidad o prevision | FALTA (03a) | calculo por reglas con explicacion (D-5) |
| Filtro por prevision | FALTA (03a) | D-7: convenios y boleta reembolsable en el perfil |
| Disponibilidad real segun dias y franjas | OK parcial | `disponibilidad_publica()`; el calculo del match debe cruzarla |
| Paso 7: nombre y correo, "te enviamos el resultado por correo" | C-17 | |
| "Ver perfil y agendar" | OK | lleva a Pedir hora con el profesional elegido |

### 1.5 Pedir hora

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Bifurcacion primera vez / ya soy paciente | Texto | |
| Datos: nombre, nacimiento, telefono, correo | FALTA (03a) | solicitud de hora sin cuenta (D-2); RUT opcional aqui |
| Adulto responsable si es menor (nombre, relacion, telefono) | FALTA (03a) | D-3 y D-4; el solicitante se declara adulto responsable |
| Cuestionario (6 preguntas) | FALTA (03a) | mismo cuestionario configurable; respuestas cifradas, guardadas solo al enviar la solicitud (D-6) |
| Resultado + "otros profesionales" | FALTA (03a) | mismo calculo que el match publico |
| Elegir horario (dias, bloques AM/PM) | OK | `GET publico/profesionales/:id/disponibilidad` |
| Datos de la sesion: modalidad, precio, boleta, duracion | OK parcial | boleta reembolsable: D-7; duracion de sesion: no existe por profesional (FALTA (fuera), el front usa la del hueco) |
| "Avisarme si se libera una hora antes" | FALTA (fuera) | lista de espera |
| Condiciones de agendamiento (24 h, cobro completo, pago en el centro, menor) | Texto | generarlas desde `configuracion` (plazo, porcentajes, modelo de cobro); el texto fijo del diseño contradice los porcentajes en 0 |
| Casilla "acepto terminos de agendamiento" | FALTA (03a) | aceptacion de politica de datos versionada (D-3) + terminos |
| Verificacion del correo antes de avanzar | FALTA (03a) | no esta en el diseño (D-3): pantalla nueva "revisa tu correo" |
| "Confirmar mi hora" -> "tu cuenta quedo creada" | D-2 + C-15 | la cuenta no se crea aqui: se invita al confirmar la primera cita |
| Ya soy paciente: buscar por correo o telefono y ver profesional, ultima sesion y horas | C-6 | |

### 1.6 Paciente - Mi cuenta

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Mi profesional | OK | `GET portal/equipo` |
| Mis horas (proximas, pasadas, estado) | OK | `GET portal/citas`; "Completada" = CONFIRMADA ya terminada sin INASISTENCIA (calculo en la API) |
| Estado "Por confirmar" | Texto | recordatorio sin respuesta (`recordatorios_cita`); ver C-15 |
| Calificar esta sesion / ya calificaste | D-1 | una reseña por paciente y profesional (no por sesion) |
| Enviar mensaje al profesional + historial enviado | OK | `POST portal/mensajes`; FALTA (03a) `GET` de los propios enviados (hoy solo el profesional lista) |
| Mis datos: editar nombre, nacimiento, telefono, correo | C-9 | |
| Adulto responsable: ver y editar | OK lectura / C-9 escritura | `GET pacientes/:id/adultos-responsables` |
| Cuenta de una paciente de 16 años | D-4 | cuenta restringida 14-17 |
| "Pidela en el centro" (copia de ficha) | OK | `POST portal/epicrisis` |

## 2. Pantallas Admin

### 2.1 Dashboard

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Pacientes activos (+ del mes) | FALTA (03a) | funcion de reporte por rol |
| Sesiones hoy / por confirmar | FALTA (03a) | idem (hoy se puede armar con `GET citas`, pero no por rol en una llamada) |
| Ocupacion de boxes % | OK (03b) | `reporte_dashboard().ocupacion_boxes_hoy`: horas apartadas / horario de boxes (muestra; cada centro define la suya) |
| Fichas por cerrar | FALTA (03a) | requiere saber que cita tiene evolucion: hoy `evoluciones` no se vincula a `citas` (ver 2.4) |
| Modulos del centro (activo / no contratado) | FALTA (03a) | modulos activos por centro |
| Tus sesiones de hoy | OK | `GET citas` |
| Pendientes (fichas sin cerrar, confirmar horas, practicante por activar, consentimiento pendiente) | FALTA (03a) | reporte de pendientes por rol |
| Nuevo paciente / Agendar sesion | OK | `POST pacientes`, `POST citas` |

### 2.2 Agenda y Espacios

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Calendario semanal por profesional o por box | OK | `GET citas` (ADMIN/GESTION todas) |
| Estados Confirmada / Por confirmar / Reservando | OK parcial | "Reservando" = `horarios-tomados`; "Por confirmar": C-15 |
| Confirmar hora (accion de coordinacion) | C-15 | |
| Reasignar la cita a otro profesional | C-5 | |
| Espacios: nombre, nota, horario de funcionamiento, duracion por defecto, ocupacion % | OK parcial | `espacios` solo tiene nombre y activo; nota, horario y duracion: FALTA (fuera); ocupacion: reporte |
| "Un espacio no admite dos reservas en el mismo bloque" | OK | EXCLUDE |
| Horarios del equipo (ver y editar) | OK | `profesionales/:id/disponibilidad` |
| Filtro por profesional | FALTA (03a) | filtros por profesional en `GET citas` y en el selector de equipo |

### 2.3 Fichas y Pacientes (vista del profesional)

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Lista: paciente, menor + tutor, tipo, ultima sesion, estado | OK parcial | `GET pacientes`; ultima sesion y "sin cerrar" requieren el vinculo cita-evolucion |
| Filtros: sin cerrar, menores, derivados a mi | FALTA (03a) | filtros en `GET pacientes` |
| "Ficha compartida por derivacion", "coordinacion entre ambos profesionales" | C-4 | |
| Indicaciones del paciente (lo que respondio en el match) | FALTA (03a) | respuestas del match visibles solo al tratante (D-6) |
| Historial de sesiones con "Cerrar ficha" por sesion | FALTA (03a) | `evoluciones.cita_id` opcional (nuevo) para saber que sesion se cerro |
| Adulto responsable | OK | |
| Contacto de emergencia | FALTA (fuera) | campo nuevo cifrado |
| Notas y documentos: nota, derivacion, receta, justificativo, informe; adjuntos | OK | `evoluciones`, `documentos-clinicos` (tipos configurables), `adjuntos` |
| Nota en "borrador" y despues "cerrada" | C-8 | |
| Consentimiento firmado / pendiente | D-3 | consentimiento informado de atencion (tipo nuevo) |
| Motivo de consulta, notas generales, campos adicionales por especialidad | FALTA (fuera) | hoy todo el contenido clinico vive en evoluciones; campos por especialidad son un modulo propio |
| Alta del paciente | FALTA (03a) | no esta en el diseño; boton nuevo "Registrar alta" |

### 2.4 Fichas - Vista administrativa (ADMIN)

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| "Aislamiento clinico": sin notas, motivos ni diagnosticos | OK | coincide con la matriz |
| Directorio: nombre, especialidad, carga, estado actual, registro | OK parcial | `GET directorio` + reporte de carga; estado actual desde citas de hoy |
| Contacto: anexo, movil, correo | OK parcial | `directorio` da email y telefono (ADMIN/GESTION); anexo: FALTA (fuera) |
| Bloques presenciales | OK | disponibilidad |
| Derivaciones internas (conteo + historial) | OK | `GET derivaciones` |
| Liquidacion (al dia / pendiente) | OK | `GET cobros/liquidaciones` |
| Pacientes por profesional con estado administrativo | FALTA (03a) | reporte por profesional (sin datos clinicos) |
| Un paciente con dos profesionales (Sofia, Matias + evaluacion neuropsicologica) | C-4 | |
| Acciones: reasignar | C-5 | |
| Acciones: cambiar box, recordatorio, requerir cierre, asignar cupo | OK / FALTA | cambiar box: `PATCH citas/:id/reprogramacion`; recordatorio manual y "requerir cierre": FALTA (03a, via `notificar`); asignar cupo (lista de espera): FALTA (fuera) |
| Agregar profesional: nombre, correo, rol, fecha de termino | FALTA (03a) | alta con invitacion; un practicante ademas necesita supervisor (el diseño no lo pide) |
| Rol "Cuenta madre" | C-2 | |
| "Contactar equipo" | FALTA (fuera) | mensajeria interna |
| Numero de ficha (#0412) | FALTA (fuera) | hoy no hay correlativo; se puede mostrar `codigo_seudonimo` |

### 2.5 Match - Configuracion

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Preguntas activas / apagadas, pregunta propia del centro | FALTA (03a) | cuestionario configurable |
| Preguntas: tarifa por rango, genero del profesional, corriente teorica | FALTA (03a) parcial | tarifa y corriente (enfoques) existen en el perfil; genero del profesional no existe (ver pendientes) |
| Filtro directo ("prefiero filtrar yo mismo") | FALTA (03a) | bandera de configuracion del match |
| Metricas 30 dias: cuestionarios completados, mas recomendados, coincidencias que agendaron | FALTA (03a) | reporte sobre solicitudes (conteos, sin respuestas) |
| Dependencias (Equipo requerido, Agenda opcional) | FALTA (03a) | modulos activos |

### 2.6 Cobros

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Periodo semana / mes; sesiones, cobrado, pendiente | OK parcial | `GET cobros/citas` (por cita); FALTA (03a) agregado por profesional y periodo como funcion de reporte |
| Comision por derivacion (solo pacientes del Match; monto fijo o %) | C-10 | |
| Metodos de pago incluye "Convenio / FONASA" | FALTA (03a) | D-7: agregar medio CONVENIO |
| Exportar periodo (PDF) | FALTA (fuera) | |
| "Cerrar sesion" desde Cobros (marcar pagado y cerrar) | C-11 | |
| Modulo "No contratado" | FALTA (03a) | modulos activos (403) |

### 2.7 Configuracion

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Identidad: logo, nombre, correo, direccion, telefono, WhatsApp, Instagram, mision, vision | FALTA (03a) | contenido publico del centro; logo por la misma subida de imagenes publicas |
| Modulos contratados (estado, "solicitar") | FALTA (03a) lectura | la activacion la hace el operador (panel maestro fuera de alcance); "solicitar" queda como texto/correo |
| Horario general de atencion | FALTA (fuera) | la BD ya limita por disponibilidad de cada profesional |
| Consentimiento informado editable con "ultima edicion" | FALTA (03a) | politica de datos y consentimiento de atencion versionados (D-3) |
| Politica de menores (texto fijo) | OK | trigger `citas_menor_requiere_adulto_responsable` |
| Retencion 15 años (texto fijo) | OK | |
| Canales: correo / WhatsApp | OK correo / FALTA (fuera) WhatsApp | WhatsApp reservado desde 02i |
| "Recordatorio 24 h antes" | Texto | con CHECK 02j el recordatorio debe ser mayor que el plazo de cancelacion (24): mostrar el valor configurado |
| Plantillas de mensaje (`{paciente}`...) | OK | `plantillas-mensaje` (sintaxis `{{variable}}`) |
| Dominio propio | FALTA (fuera) | infra |
| Color de marca | FALTA (03a) | parte del contenido publico |
| Roles y accesos: cuenta madre, profesional, practicante | C-2 | falta GESTION; textos no calzan con la matriz |
| Transferir cuenta madre | C-2 | |

### 2.8 Mi perfil y Perfil profesional (Equipo)

| Dato o accion | Estado | Endpoint / nota |
|---|---|---|
| Foto (subir) | FALTA (03a) | imagenes publicas validadas, redimensionadas, sin EXIF |
| Nombre, especialidad, telefono, correo, bio | OK | `usuarios/yo`, `profesionales/yo/perfil` |
| Años de experiencia (campo editable) | FALTA (03a) + Texto | derivado de la trayectoria; el campo pasa a solo lectura |
| Registro profesional | OK | trayectoria (`registro_superintendencia`) |
| Cita destacada, idiomas, duracion de sesion | FALTA (fuera) | campos de perfil nuevos |
| Convenios, prevision | FALTA (03a) | D-7 |
| Calificaciones (solo lectura, verificadas) | D-1 | + feedback privado solo para el profesional |
| Indicadores: sesiones semana, pacientes activos, fichas sin cerrar | FALTA (03a) | reporte por rol |
| Mis pacientes con estado administrativo | OK parcial | `GET pacientes` + citas; "pago pendiente" via `cobros/citas` |
| Protocolo del centro + "marcar como leido" (registro visible para la direccion) | FALTA (fuera) | documento interno con acuse; se propone posponer |
| Cambiar contraseña | OK | `POST usuarios/yo/password` |
| Avisos y recordatorios | OK parcial | preferencias existen solo para PACIENTE |
| Mis liquidaciones | OK | `GET cobros/liquidaciones` |
| ADMIN edita el perfil de otro y su rol | OK | `PATCH profesionales/:id/perfil`, `PATCH usuarios/:id` (publicar sigue siendo solo del propio) |
| Cuenta temporal con fecha de termino | OK | `POST practicantes/:id/acceso` |
| Vista publica: proximas horas, calificar | OK + D-1 | |

## 3. Contradicciones con reglas (fuera de las 7 decisiones)

| # | Diseño | Regla que contradice | Propuesta |
|---|---|---|---|
| C-1 | La directora (cuenta madre, ADMIN) atiende pacientes y escribe notas clinicas desde la misma cuenta | Un usuario tiene un rol (`usuarios.rol`, `acceso_vigente()` exige rol de BD = rol de contexto); ADMIN sin acceso clinico | (a) dos cuentas (ADMIN y PROFESIONAL, correos distintos). (b) roles multiples con rol activo elegido al entrar: cambia el nucleo (tabla de roles por usuario, `acceso_vigente`, JWT, matriz completa). Recomendado: (a) ahora |
| C-2 | "Cuenta madre" unica, exclusiva de Configuracion y Cobros; transferible; sin rol GESTION | Puede haber varios ADMIN (la BD solo impide quedar sin ninguno); GESTION opera cobros; PROFESIONAL ve sus pagos y liquidaciones | Texto: "cuenta madre" = ADMIN; mostrar GESTION si `rol_gestion_habilitado`; "transferir" = alta de otro ADMIN + baja propia por otro ADMIN |
| C-3 | Practicante en el equipo publico con "Pedir hora" y "sin costo" | Un paciente llega a un practicante solo via derivacion con consentimiento (trigger `pacientes_asignacion_practicante`); `perfiles_publicos()` solo PROFESIONAL | Los practicantes no aparecen en el equipo publico ni en el match |
| C-4 | Ficha "compartida por derivacion"; el derivante sigue coordinando; un paciente con dos profesionales a la vez (interconsulta neuropsicologica) | Un tratante por paciente; la derivacion traspasa (el origen pierde la ficha); acceso a ficha ajena solo via derivacion | Texto: "derivado desde X" (traspaso). La interconsulta (segundo profesional con acceso acotado) queda fuera: cambio de modelo de acceso |
| C-5 | Reasignar una cita a otro profesional desde la agenda | El nuevo profesional no es tratante: no ve la ficha ni puede registrar la sesion. La BD lo permite a ADMIN/GESTION (`citas_update`) | La API rechaza (422) una cita con un profesional que no es el tratante; en la UI "reasignar" abre una derivacion |
| C-6 | "Ya soy paciente": buscar por correo o telefono sin sesion y ver profesional, ultima sesion y horas | Ser paciente de un centro de salud mental es dato sensible; sin contexto la BD no entrega datos de pacientes | Pedir sesion. Alternativa: enlace de acceso de un solo uso al correo verificado (respuesta identica exista o no la cuenta), que es la opcion "recibir enlace por correo" del login |
| C-8 | Nota de sesion guardada como borrador editable y luego "cerrada" | `evoluciones` append-only (sin UPDATE ni DELETE) | Borrador fuera de la ficha: tabla propia, cifrada (CLINICO), solo el autor, editable y descartable; al cerrar se crea la evolucion y se elimina el borrador. Alternativa: borrador solo en memoria del navegador |
| C-9 | El paciente (16 años) edita nombre, fecha de nacimiento, telefono, correo y datos del adulto responsable | PACIENTE solo lee `pacientes` y `adultos_responsables`; cambiar la fecha de nacimiento saltaria la regla de menores | El paciente edita solo su telefono y correo (funcion SECURITY DEFINER; el correo nuevo se verifica). Nombre, nacimiento y adulto responsable: ADMIN/GESTION/tratante |
| C-10 | Comision solo por pacientes llegados por Match (monto fijo o % por sesion) | 02h: comision porcentual sobre todo lo cobrado por el centro | Fuera de 03a; el propio diseño lo marca "no definido (RF-11)". Va con la fase posterior de cobros |
| C-11 | "Marcar como pagado y cerrar sesion" desde Cobros; protocolo: "la liquidacion solo considera sesiones con ficha cerrada" | La liquidacion es por pagos; ADMIN no toca la ficha; acoplar cobro y ficha haria depender un dato administrativo de uno clinico | "Cerrar sesion" en Cobros = registrar pago. "Ficha cerrada" = evolucion del tratante vinculada a la cita. La liquidacion no depende de la ficha |
| C-15 | Citas "por confirmar" (por el profesional o el apoderado) y "Confirmar hora"; la solicitud del paciente sin cuenta reserva la hora | `estado_cita` solo tiene CONFIRMADA, CANCELADA, POR_REPROGRAMAR; el EXCLUDE solo protege CONFIRMADA; D-2 exige RUT "al confirmar la primera cita" | Estado nuevo SOLICITADA: retiene el horario (entra al EXCLUDE), vence si no se confirma en N horas, no fija monto. Confirma el tratante, ADMIN o GESTION con el RUT; al confirmar se envia la invitacion. "Por confirmar" de una cita ya confirmada = recordatorio sin respuesta |
| C-17 | Match publico pide nombre y correo y envia el resultado por correo | D-3 (politica aceptada y correo verificado antes de avanzar) y D-6 (respuestas guardadas solo al enviar una solicitud) | El match publico no guarda nada: muestra el resultado en pantalla y lleva a Pedir hora. Se quita el paso de contacto |

Menores (no bloqueantes, solo texto): rangos "adolescente 12-18" y "niño
hasta 11" del cuestionario vs D-4 (<14 sin cuenta, 14-17 restringida): las
opciones son configurables; la edad real sale de la fecha de nacimiento.
"Calificar esta sesion" vs D-1 (una por paciente y profesional).
"Tu cuenta quedo creada" vs D-2.

## 4. Funciones de la API sin pantalla en el diseño

Necesitan vistas nuevas (con `ui-ux-pro-max` + `impeccable`, ver CLAUDE.md):

- Derivaciones: crear, bandeja de ofertas (`derivaciones/pendientes`,
  `:id/oferta`, `:id/respuesta`), candidatos, reintegro, cancelacion,
  proponer practicante.
- Consentimiento de practicante y avisos de cambio de supervisor (portal del
  paciente y registro con respaldo por ADMIN/GESTION).
- Supervision: casos seudonimizados, evoluciones y comentarios.
- Practicantes: otorgar y revocar acceso, historial, cambio de supervisor.
- Bajas y bandeja de pacientes por reasignar; alertas internas.
- Retencion: fichas sobre 15 años y revisiones (ADMIN).
- Catalogos: tipos de sesion (cola de propuestas), intervenciones, estados de
  avance, tipos de atencion (propuestas), tipos de documento clinico.
- Evolucion estructurada: tipo de sesion, nivel de riesgo, estado de avance,
  intervenciones, correccion (`corrige_a_id`).
- Documentos clinicos: envios (enlace o adjunto), descarga con token.
- Epicrisis: bandeja y resolucion.
- Mensajes del paciente: bandeja del profesional y marcar leido.
- Agenda: citas por reprogramar, conflictos de margen, bloqueos de agenda,
  margen de traslado, cancelacion y reprogramacion.
- Videollamada (sala propia o Jitsi), feed de calendario (URL una vez),
  enlace de cita online.
- Pagina del recordatorio con token (confirmar o cancelar) y del feed.
- Perfil: datos privados (RUT y banco), historial de tarifas, trayectoria con
  verificacion por ADMIN, tipos de atencion propuestos.
- Cobros: pagos y anulacion, resolucion de cancelacion o inasistencia,
  arriendos, liquidaciones (generar, emitir, pagar), datos de pago en el
  portal.
- Notificaciones: bandeja propia y preferencias del paciente.
- Configuracion: politica de cancelacion, comision, margen, plazos de
  derivacion y consentimiento, dias de gracia, rol GESTION.

## 5. Pendientes de decidir (no bloquean el inventario)

- Genero del profesional como filtro del match: requiere un dato personal
  nuevo, autodeclarado y opcional. No se implementa sin confirmacion.
- Lista de espera, protocolo con acuse de lectura, mensajeria interna,
  exportar PDF de cobros, horario general y por box, campos clinicos por
  especialidad, contacto de emergencia, idiomas y cita destacada del perfil:
  propuestos fuera de 03a.

## 6. Resolucion en 03a-1 (backend)

Decisiones del usuario aplicadas en la API y la BD (migraciones
`20261018000000_03a_enums` y `20261018000100_03a_cuentas_portal_agenda`).
Estado por fila de las secciones 1-5:

| Brecha | Resolucion |
|---|---|
| D-1 Reseñas | `resenas` (cifrado CLINICO), una por paciente y profesional con al menos una sesion realizada; anonima por defecto o "Nombre + inicial"; moderacion ADMIN antes de publicar, ocultar con motivo, reporte publico, retiro por el autor, `resenas_eventos` como auditoria; feedback privado solo para el profesional; se eliminan con la baja del profesional; promedio y cantidad en `perfiles_publicos()` |
| D-2 Paciente sin cuenta | `POST publico/solicitudes` crea paciente y ficha con la primera solicitud (RUT opcional, indice ciego); cuenta opcional por invitacion al correo verificado; nunca se fusiona por nombre: posible duplicado por RUT o correo, lo concilia GESTION (`duplicado-revisado`) |
| D-3 Politicas y consentimiento | `politicas` versionadas y `aceptaciones_politica` (version y fecha); verificacion del correo con token de un solo uso; consentimiento informado por portal, enlace con token por correo o registro ADMIN/GESTION con respaldo; el solicitante de un menor se declara adulto responsable |
| D-4 Menores | Menor de 14 sin cuenta; 14-17 cuenta restringida (sus citas, recordatorios y mensajes a su profesional); rol RESPONSABLE ve citas, pagos y documentos emitidos del menor, no sus mensajes; nadie ve la ficha. Validacion legal pendiente (ver estado_fase_api.md) |
| D-5/D-6/D-7 Match | Reglas sin IA (`reglas-match.ts`), preguntas y opciones configurables; respuestas cifradas solo al enviar una solicitud, borradas a los 30 dias si no se concreta (configurable) y al alta; boleta reembolsable y convenios en el perfil y como filtro |
| C-1/C-2 | Una cuenta con varios roles (`roles_adicionales`), un rol activo por sesion (`auth/cambio-rol`, token nuevo); ADMIN+PROFESIONAL y GESTION+PROFESIONAL; PRACTICANTE y PACIENTE exclusivos; bajas por rol; "Cuenta madre" = texto de ADMIN |
| C-3 | Practicantes fuera del equipo publico y del match |
| C-4/C-5 | `accesos_clinicos_temporales` (REEMPLAZO o INTERCONSULTA, lectura o lectura+escritura, fecha de termino, aviso al paciente, auditado, vence solo); "Cubrir sesion" (`PATCH citas/:id/profesional`) exige acceso vigente, si no 422; "Derivar paciente" sigue por derivaciones |
| C-6 | Enlace de acceso de un solo uso al correo, respuesta identica, rate limit |
| C-8 | `borradores_evolucion` cifrados, solo el autor, guardado automatico (PUT), al confirmar pasan a evolucion y se eliminan; aviso por borradores pendientes; la baja no se completa con borradores sin confirmar (alerta `BAJA_CON_BORRADORES`) |
| C-9 | El paciente edita solo telefono y correo (correo nuevo verificado) via `portal/mis-datos` |
| C-10 | Fuera de 03a (fase posterior de cobros) |
| C-11 | La liquidacion considera citas REALIZADAS (terminadas); configuracion opcional para exigir evolucion vinculada. **Pendiente**: si se liquidan los cobros por cancelacion tardia e inasistencia (hoy no) |
| C-15 | Estado SOLICITADA: la reserva directa retiene 30 min (bloqueos temporales) y queda CONFIRMADA al verificar el correo; opcion por profesional "requiere aprobacion para pacientes nuevos" deja la cita SOLICITADA hasta `citas/:id/aprobacion`; RUT obligatorio al registrar la primera evolucion; invitacion al confirmar |
| C-17 | El match publico no guarda nada: resultado en pantalla y paso a Pedir hora |
| Seccion 5 | Incluidos en 03a-1: lista de espera con aviso al liberarse una hora, PDF de reporte de cobros y de liquidacion, horario general y por box (citas dentro del horario), contacto de emergencia cifrado, idiomas y cita destacada. Para 03a-2: campos clinicos por especialidad y mensajeria interna. Fuera: genero del profesional, protocolo con acuse de lectura, WhatsApp |

## 7. Decisiones para 03a-2 (usuario, 2026-10-15)

- **Menores (D-4)**: se confirma el modelo. Menos de 14 sin perfil; 14 a 17
  perfil restringido; todo consentimiento (politica de datos, atencion,
  practicante) lo da el adulto responsable, nunca el menor. Los cortes de
  edad y demas puntos de la validacion legal quedan como parametros de
  `configuracion_centro` (default: 14), para que el centro los resuelva.
- **Preferencias de notificacion para RESPONSABLE** y **reintento con backoff
  de los correos de cuenta** (invitacion, verificacion, recuperacion,
  enlaces): se implementan en 03a-2.
- **Duplicados**: solo los resuelve administracion (ADMIN/GESTION) via
  funcion SECURITY DEFINER auditada; al detectarse uno, alerta interna
  `POSIBLE_DUPLICADO` y aviso en la bandeja de ADMIN/GESTION; se quita el
  GRANT UPDATE de `posible_duplicado` (el tratante solo ve el indicador).
- **RUT**: obligatorio antes de la primera evolucion para todo paciente (no
  solo los creados por solicitud).
- **Liquidacion (C-11)**: se mantiene por cita realizada; queda pendiente si
  se liquidan los cobros por cancelacion tardia e inasistencia.
- **Bruno**: eliminado; pruebas manuales en Postman.

## 8. Resolucion en 03a-2 (backend)

| Brecha | Resolucion |
|---|---|
| Campos clinicos por especialidad | `especialidades` (catalogo de ADMIN) y `profesional_especialidades` (el profesional declara, ADMIN aprueba). `plantillas_clinicas` versionadas (INGRESO o EVOLUCION; publicada inmutable, editar = version nueva, nunca se borra); el profesional propone, solo ADMIN publica; ejemplos cargados para las 5 especialidades. Ficha de ingreso (`ingresos_ficha`, append-only) y valores en evoluciones y borradores, cifrados y validados contra su version; supervision solo con campos marcados |
| Mensajeria interna | Hilos GENERAL (participantes del equipo, sin pacientes) y CASO (acceso clinico vigente; ADMIN/GESTION no). Sin edicion, retiro en 5 minutos, sin adjuntos, lectura por polling, registro de lectura, rate limit, auditoria de hilos de caso, aviso sin contenido, purga por `retencion_mensajes_dias` (default 365), nombre minimizado tras el cierre de la cuenta |
| Seccion 7 | Edad minima de cuenta configurable; preferencias del adulto responsable; reintento de correos de cuenta; duplicados solo por administracion con alerta y aviso; RUT antes de la primera evolucion para todo paciente. Bruno eliminado |
| Pendiente | C-11 (si se liquidan los cobros por cancelacion tardia e inasistencia). Validacion legal de D-4 (con los cortes de edad ya configurables). Tiempo real (SSE) para la mensajeria. Fusion de fichas duplicadas (hoy se registra MISMO_PACIENTE y se concilia a mano) |

## 9. Resolucion en 03b-2 (front publico)

- Landing, Equipo, perfil completo, Match y Pedir hora conectados a `publico/*`
  (SSR para SEO; Match y Pedir hora con formularios en el cliente).
- "Proxima disponibilidad" del centro (1.1): sigue sin agregado en la API. El
  landing muestra en su lugar un dato real: cantidad de profesionales y tarifa
  mas baja. No se piden N disponibilidades desde el front.
- Duracion de sesion (1.5): la API entrega rangos libres; el front ofrece
  bloques de 50 min a hora en punto (`lib/horarios.ts`). Pendiente que la API
  publique la duracion del profesional o del box.
- Horario del box: `disponibilidad_publica()` no lo considera; un presencial
  sin box libre se rechaza al enviar (409 `solicitudes_hora_sin_box`) y el
  front vuelve a la grilla con el mensaje.
- Retencion de 30 min: empieza al enviar la solicitud (la crea
  `crear_solicitud_hora`), no al tocar la hora. La cuenta regresiva se muestra
  en "Revisa tu correo".
- Lista de espera sin horas (1.5): `POST lista-espera` exige cuenta de
  paciente. Sin cuenta solo existe "avisarme si se libera una hora antes"
  junto a una hora reservada (`listaEspera` de la solicitud); sin horas, el
  front ofrece entrar a la cuenta o ver otros profesionales.
- Ya soy paciente (C-6): solo `auth/enlace-acceso`, respuesta identica exista
  o no la cuenta.
- Genero del profesional: 03a no lo implemento; no se muestra.
- Respuestas del match: solo en memoria de la pestaña (`lib/match-memoria.ts`),
  viajan cifradas con la solicitud; nunca en storage ni en la URL.

## 10. Correcciones antes de 03b-3 (decisiones del usuario)

- **La agenda sale del box.** ADMIN define cuando se usa cada box
  (`horarios_espacio`, ahora por periodo: semana, mes o trimestre); el
  profesional (o ADMIN/GESTION por el) aparta bloques dentro de ese horario
  (`bloques_atencion`, EXCLUDE por box y por profesional). Solo lo apartado
  se ofrece: disponibilidad publica, match, huecos del backoffice y validacion
  de citas (presencial u online). La cita presencial usa el box del bloque
  (lo fija la BD; la API ya no recibe `espacioId`). Resuelve el pendiente
  "horario del box" de la seccion 9: `solicitudes_hora_sin_box` ya no existe.
  `disponibilidad_profesional` queda como horario habitual (referencia para
  apartar). Endpoints: `GET /espacios/disponibilidad`,
  `GET|POST /profesionales/:id/bloques`, `DELETE /profesionales/:id/bloques/:id`.
  La pantalla para apartar y el horario del box por periodo son de 03b-4
  (Agenda y Espacios).
- **Lista de espera sin cuenta.** `lista_espera_publica`: nombre, correo,
  telefono cifrado, solo por profesional; verificada por correo (24 h),
  vigente `dias_lista_espera_publica` (60), sin paciente ni ficha.
  Aviso por correo (job cada 10 min) cuando se libera una hora o el
  profesional aparta un bloque nuevo, con enlace de baja (borra la
  inscripcion). En el front: desde Pedir hora, sin horas o "ninguna hora me
  acomoda"; paginas `/lista-espera/verificar` y `/lista-espera/baja`. Por tipo
  de atencion: quitado de la BD y la API (pendiente, implementacion futura;
  necesita un listado publico de tipos con id). La lista con cuenta (03a)
  conserva su CHECK `lista_espera_coherente` sin cambios.
- **Sesion de 30 minutos sin actividad.** `SESION_INACTIVIDAD_MINUTOS`
  (reemplaza `REFRESH_DIAS`): el refresh vence a esos minutos y se renueva al
  rotar; la cookie dura lo mismo. El front cierra la sesion tras 30 min sin
  actividad (marca compartida entre pestañas en localStorage, no clinica) y el
  login lo explica. Se quito "Mantener sesion iniciada" (seccion 1): no tiene
  sentido con cierre por inactividad.
- **"Se pierde el rol al recargar".** Revisado: la sesion y el rol activo se
  recuperan al recargar (los guarda el servidor, no el navegador). Lo que se
  veia era el 404 de Next sin el layout en rutas del menu que aun no existen
  (03b-3/03b-4). Ahora `/admin/*` y `/portal/*` sin pagina muestran el aviso
  dentro del panel, con menu y rol.
- Duracion de la sesion clinica: sigue en bloques de 50 min a hora en punto
  (los 30 minutos pedidos eran de la sesion de login).
