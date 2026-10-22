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

----------------------------------------------------------

# 03a - Alinear el backend con el diseño

## Contexto
API 02a-02j con commit. Diseños exportados en design-reference/ (tenant, landing y sistema de diseño Organic). Leer CLAUDE.md, requisitos_02_apis.md, matriz e integraciones.md.
Regla: el diseño es fuente de verdad visual; el comportamiento lo define la API y la matriz. Nada del diseño se implementa si contradice una regla de la BD.

## 1. Inventario (primero, antes de programar)
`docs/front/brechas.md`: por cada pantalla del diseño, cada dato y acción que muestra -> endpoint existente, endpoint faltante o contradicción con una regla.
Además, la lista inversa: funciones de la API sin pantalla en el diseño.
Detenerse y mostrarme el inventario si encuentras contradicciones fuera de las decisiones de abajo.

## 2. Decisiones ya tomadas
1. Reseñas: solo pacientes con al menos una sesión realizada con ese profesional; una por paciente y profesional, editable por su autor. Se muestran como "Nombre + inicial" o "Usuario anónimo" (anónimo por defecto, con advertencia). Moderación por ADMIN antes de publicar; ocultar con motivo; reporte público; todo auditado. Feedback privado opcional solo para el profesional. El paciente puede retirarla. Se eliminan con la baja del profesional. Promedio y cantidad en el perfil.
2. Paciente sin cuenta: el registro del paciente (y su ficha) se crea con la primera solicitud de hora; la cuenta es opcional y se vincula después por invitación al correo verificado. Nunca fusionar por nombre: identidad = RUT (índice ciego) + correo verificado. RUT opcional en la solicitud y obligatorio al confirmar la primera cita; GESTION concilia duplicados.
3. Consentimientos sin cuenta: política de datos con casilla obligatoria (versión, fecha) y verificación del correo por enlace antes de avanzar. Consentimiento informado de atención, practicante y oposición: portal, enlace con token de un solo uso por correo, o registro de ADMIN/GESTION con respaldo. Solicitud para un menor: el solicitante se declara adulto responsable; se confirma en la primera sesión.
4. Adolescentes: menores de 14 sin cuenta (opera el adulto responsable). De 14 a 17, cuenta restringida: sus citas, recordatorios y mensajes a su profesional. El adulto responsable ve citas, pagos y documentos emitidos, pero no los mensajes del adolescente. Nadie ve la ficha. Documentar que requiere validación legal (Ley 21.331).
5. Match: cálculo por reglas, sin IA.
6. Respuestas del match: cifradas (CLINICO); borradas a los 30 días si la solicitud no se concreta (configurable), conservadas durante la atención, borradas al alta.
7. Previsión: el perfil profesional indica si emite boleta reembolsable y sus convenios; filtro en el match.
Fuera de alcance: paquetes de sesiones (fase posterior de cobros) y vitrina de productos.

## 3. Backend a implementar (según inventario y decisiones)
- Solicitud de hora sin cuenta: verificación de correo, invitación de activación al confirmar la primera cita, aceptación de la política de datos. Rate limit y protección contra abuso.
- Alta por ADMIN/GESTION con invitación.
- Cuentas: recuperar contraseña, activar por invitación, cambiar contraseña. TOTP obligatorio para roles con acceso clínico (PROFESIONAL, PRACTICANTE) y opcional para el resto.
- Menores en el portal según la decisión 4.
- Cuestionario de match configurable (preguntas, opciones, pesos) y cálculo explicable por reglas. Respuestas guardadas solo al enviar la solicitud, cifradas.
- Previsión y convenios en el perfil profesional; años de experiencia derivados de la trayectoria.
- Fotos de perfil: subida de imágenes públicas (validadas por contenido, redimensionadas, sin metadatos EXIF), separadas de los adjuntos clínicos.
- Contenido público del centro editable por ADMIN.
- Dashboard por rol mediante funciones de reporte, sin datos clínicos para ADMIN/GESTION.
- Filtros por profesional para el selector de equipo.
- Módulos activos por centro: configuración y endpoint que el front consulte. La API rechaza llamadas a módulos inactivos (403).
- Reseñas según la decisión 1: tablas, moderación, reporte, feedback privado, promedio en perfiles_publicos.
- Tokens por correo para consentimientos y verificación (mismo patrón que los recordatorios).
- Alta del paciente: el tratante la registra con fecha y motivo; borra las respuestas del match; la ficha se conserva. Job que borra respuestas de solicitudes no concretadas.
- Cuenta restringida de adolescente y vista del adulto responsable según la decisión 4.

## 4. Tests y documentación
- Tests de integración por rol para cada endpoint nuevo; las tres suites pasan.
- Regenerar openapi.json.
- Actualizar matriz, requisitos y brechas.md con lo resuelto.

## Entrega
Formato de CLAUDE.md. Commits propuestos; no ejecutarlos hasta mi confirmación.

---------------------------------------------------------------------------------------------

Decisiones sobre las contradicciones:

- C-1 y C-2: una cuenta con varios roles; un rol activo por sesión.
  - Elige rol al entrar y puede cambiar sin cerrar sesión; cada cambio emite token nuevo. La BD sigue recibiendo un solo app.current_rol; la matriz no cambia.
  - Combinaciones permitidas: ADMIN+PROFESIONAL y GESTION+PROFESIONAL. PRACTICANTE y PACIENTE son exclusivos.
  - Bajas y expiraciones por rol. La auditoría registra el rol usado.
  - "Cuenta madre" es el nombre visible de ADMIN.
- C-15: reserva directa.
  - Al elegir la hora se retiene 30 min (bloqueos temporales); al verificar el correo queda CONFIRMADA automáticamente; si no, se libera.
  - RUT obligatorio antes o en la primera sesión (lo registra el profesional o GESTION).
  - Invitación de cuenta al confirmar.
  - Opción por profesional "requiere aprobación para pacientes nuevos" con estado SOLICITADA.
- C-8: tabla de borradores cifrada, solo visible para su autor, con guardado automático. Al confirmar pasa a evolución y se elimina. Aviso por borradores pendientes; la baja no se completa con borradores sin confirmar.
- C-6: solo correo, respuesta idéntica exista o no la cuenta, enlace de acceso de un solo uso, rate limit.
- C-3: practicantes fuera del equipo público y del match.
- C-4 y C-5: acceso clínico temporal con motivo (REEMPLAZO | INTERCONSULTA), alcance (lectura o lectura y escritura de evoluciones), fecha de término, aviso al paciente y auditoría; se corta solo al vencer. En la agenda, "reasignar" se separa en "Derivar paciente" (derivación) y "Cubrir sesión" (reemplazo). Mover una cita a un no tratante sin acceso: 422.
- C-9: el paciente edita solo teléfono y correo (correo nuevo verificado).
- C-10: fase posterior de finanzas.
- C-11: liquidación según cita REALIZADA, sin depender de la ficha. Configuración opcional del centro: exigir evolución registrada (solo el dato sí/no) para liquidar.
- C-17: el match no guarda nada; muestra el resultado y lleva a Pedir hora.

Funciones a incluir (ya no quedan fuera):
- Horario general del centro y por box (las citas deben caer dentro).
- Contacto de emergencia del paciente (cifrado; visible para el tratante y ADMIN/GESTION).
- Lista de espera por profesional o tipo de atención, con aviso al liberarse una hora.
- PDF de reporte de cobros y de liquidación.
- Idiomas y cita destacada en el perfil público.
- Campos clínicos por especialidad (plantillas de evolución configurables, contenido cifrado).
- Mensajería interna del equipo (cifrada, con RLS y retención).
- Género del profesional en el match: [Fuera]
- Fuera: protocolo con registro de lectura y WhatsApp.

Divide la sección 3 en dos subfases y detente al terminar cada una:
- 03a-1: varios roles por cuenta + decisiones C, horarios, contacto de emergencia, lista de espera, PDF de cobros, campos del perfil y acceso clínico temporal.
- 03a-2: campos clínicos por especialidad y mensajería interna.

---------------------------------------------------------------------------

# 03b - Frontend (Next.js), por fases

## Contexto
- Backend completo (02a-02j) y alineado con el diseño (03a-1, 03a-2). Mapeo pantalla -> endpoint: docs/front/brechas.md. Contrato: docs/api/openapi.json.
- Diseño: design-reference/tenant/, design-reference/_ds/ (sistema Organic) y design-reference/landing/ si existe. Son HTML de referencia: se reimplementan como componentes React, nunca se copian.
- - Entorno local: Postgres en Docker (servicio db del compose), API con `npm run start:dev` y front con `npm run dev` fuera de Docker. Detener el Postgres de Windows para liberar el puerto 5432. El front solo habla con la API, nunca con la BD. Usar rewrites de Next.js para que /api/* se sirva desde el mismo origen del front. La prueba completa en Docker (api y front en contenedores) queda para después.
- Proyecto en `frontend/` del mismo repo.
- Correo en desarrollo: Mailpit (no versionar el binario).
  - Script `infra/scripts/dev/instalar_mailpit.ps1`: descarga una versión fija desde los releases de GitHub, verifica checksum y lo deja en `tools/` (ignorado por git). Documentarlo en el README.
  - `npm run dev` en la raíz: levanta Mailpit, API y front en paralelo. Además, `.vscode/tasks.json` con una tarea compuesta equivalente.
  - SMTP_URL=smtp://localhost:1025; interfaz en http://localhost:8025.

## Fuera de alcance
Paquetes de sesiones, vitrina de productos, Google, WhatsApp, videollamada niveles 2 y 3, IA, protocolo con registro de lectura, comisión por origen del paciente, landing de producto de Vinculos y panel de plataforma. Si el diseño muestra alguno, no se implementa y se reporta.

## Reglas comunes (agregar a CLAUDE.md, sección Front, máximo 15 líneas)
- Diseño = fuente visual. Comportamiento = API y matriz. Si una pantalla muestra algo que la API no entrega, se reporta; no se inventa.
- Jerarquía: components/ui/ (primitivas), components/shared/ (compuestos del dominio), components/<modulo>/ (nunca importa de otro módulo). Lo repetido entre módulos sube a shared/. Las páginas solo componen desde shared/ y <modulo>/.
- Cliente de API generado desde openapi.json; nunca tipos escritos a mano.
- Sesión: access token en memoria, refresh en cookie httpOnly, renovación automática. Rol activo visible siempre; cambiar de rol emite token nuevo y recarga permisos.
- Errores: 409 con alternativas, 422 con el mensaje de la regla, 403, 404, 413, con texto claro.
- Estados obligatorios en cada vista: carga, vacío, error y sin permiso.
- Fechas en America/Santiago, montos en CLP, RUT con dígito verificador.
- Nada clínico en localStorage, sessionStorage ni logs; sin analítica de terceros en vistas con datos de pacientes.
- Animaciones sutiles con prefers-reduced-motion; accesible por teclado; contraste AA.
- El menú oculta módulos inactivos del centro y opciones que el rol activo no tiene.
- Tests: Testing Library para componentes; Playwright contra la API local y el seed demo.
- ui-ux-pro-max para huecos de diseño (persistir en MASTER.md); impeccable para auditar cada vista antes de cerrarla.

## 03b-1 Base
- Leer design-system/vinculos/Tenant y producir docs/front/inventario_ui.md: tokens, componentes repetidos y su ubicación (ui/, shared/, <modulo>/).
- Next.js (App Router, TypeScript estricto). SSR para público; CSR para portal y backoffice.
- Tokens Organic y primitivas en components/ui/.
- Cliente de API generado, sesión y renovación, manejo global de errores.
- Layouts: público, portal del paciente y backoffice. Guardas de ruta por rol activo (solo experiencia; la API aplica la seguridad).
- Selector de rol activo (cuentas con varios roles; "Cuenta madre" es el nombre visible de ADMIN).
- Selector de equipo del backoffice como cambio de contexto (ADMIN/GESTION).
- Módulos activos y menú dinámico.
- Renderizador de formularios dinámicos en shared/ a partir de una definición de plantilla (tipos: texto, texto largo, número, fecha, selección única y múltiple, sí/no; obligatorios; advertencia en campos de texto libre). Se usa en 03b-5.

## 03b-2 Público
- Landing del centro (contenido editable por ADMIN), Equipo público con filtros por tipo de atención (sin practicantes), perfil completo con secciones condicionales (solo las que tienen datos): formación verificada, especialidades, idiomas, cita destacada, previsión y convenios, tarifas, modalidades, reseñas. Género solo si 03a lo implementó.
- Reseñas en el perfil: promedio, cantidad, lista con "Nombre + inicial" o "Usuario anónimo", aviso de que solo evalúan pacientes atendidos.
- Match: cuestionario configurable paso a paso, análisis por reglas con explicación y tarjeta del profesional. No guarda nada ni pide datos de contacto: muestra el resultado y lleva a Pedir hora. Sin practicantes.
- Pedir hora sin cuenta:
  - horarios disponibles (respetan horario del centro y del box);
  - al elegir, la hora se retiene 30 minutos y se muestra la cuenta regresiva;
  - datos de contacto, RUT opcional, casilla obligatoria de política de datos con enlace al documento, opción "pido hora para un menor";
  - pantalla "revisa tu correo": la cita se confirma al verificar; si vence, se explica que la hora se liberó;
  - si el profesional exige aprobación para pacientes nuevos, el flujo termina en "solicitud enviada".
- Sin horas disponibles: unirse a la lista de espera.
- "Ya soy paciente": solo pide el correo y responde siempre lo mismo ("si existe una cuenta, te enviamos un enlace"). Nunca muestra profesional ni horas sin sesión.
- Todo SSR con metadatos para SEO. Sin datos de pacientes en páginas públicas.

## 03b-3 Cuentas y portal del paciente
- Inicio de sesión, enlace de acceso por correo, recuperar contraseña, activación por invitación (vincula al registro existente), cambio de contraseña, TOTP para roles clínicos.
- Páginas por token (sin cuenta): verificación de correo, consentimiento informado de atención, consentimiento de practicante, oposición a cambio de supervisor, recordatorio (confirmar o cancelar mostrando la política que aplica), aviso de hora liberada de la lista de espera. Cada una explica qué se acepta y qué pasa si se rechaza.
- Mi Cuenta: citas, pagos, documentos emitidos, mensajes a su profesional, solicitud de epicrisis, consentimientos y avisos, preferencias de notificación, lista de espera. Datos personales: solo teléfono y correo editables (correo nuevo con verificación); contacto de emergencia.
- Reseña tras una sesión realizada: nombre o anónimo (anónimo por defecto, con advertencia), feedback privado opcional, editar y retirar.
- Vista restringida del adolescente (14-17): sus citas, recordatorios y mensajes. Vista del adulto responsable: citas, pagos y documentos del menor, nunca los mensajes del adolescente.

---------------------------------------------
# 03b-3.1 - Correctivo: confirmación de citas por medio de pago

## Contexto
Corrección sobre lo ya construido (backend, 03b-2 y 03b-3). Hoy la cita se confirma al verificar el correo; desde ahora la confirmación depende del medio de pago. Además, la pestaña con la cuenta regresiva no se entera cuando el correo se verifica en otra pestaña o dispositivo.
Leer CLAUDE.md, requisitos, matriz, brechas.md e integraciones.md. Pasarela real fuera de alcance (interfaz simulada).
Corregir solo lo necesario: no reescribir pantallas ni módulos que no estén involucrados.
- Marco: se construye sobre el centro de demostración, para mostrar flujos y funcionamiento. No se integra ninguna pasarela real.
- La pasarela es solo visual y simulada:
  - la interfaz indica claramente "modo demostración: no se realiza ningún cobro";
  - no puede activarse en producción sin un adaptador real y credenciales configuradas (la API lo rechaza al arrancar);
  - el adaptador real se elige y configura por centro, según el convenio que cada centro negocie (proveedor y comisiones). Documentarlo en integraciones.md.
- Pago en el centro y transferencia sí funcionan de verdad, porque no dependen de terceros.

## Parte A - Backend

### A1. Estados de la cita
- RETENIDA: hora retenida esperando verificación del correo (30 min). Pacientes con cuenta verificada se la saltan.
- PENDIENTE_PAGO: correo verificado; transferencia por validar o pasarela en curso. Bloquea la hora. Vence según plazo.
- CONFIRMADA: pago validado, o medio "pago en el centro".
- LIBERADA: venció RETENIDA o PENDIENTE_PAGO. Avisa al paciente y a la lista de espera.
- SOLICITADA: se mantiene para profesionales que exigen aprobar pacientes nuevos.
- El vencimiento lo decide un job del servidor, nunca el cliente.
- Migración de datos: las citas existentes (incluido el seed demo) quedan CONFIRMADAS; ajustar seed demo para tener ejemplos de cada estado.

### A2. Estado de la reserva consultable
- Al retener, la API devuelve un identificador opaco de reserva (sin datos personales).
- GET de estado por ese identificador: solo estado, vencimiento y siguiente paso. Rate limit.
- Verificación tardía: si la retención venció y la hora sigue libre, se vuelve a retener y continúa; si no, devuelve alternativas.

### A3. Medios de pago
- configuracion_centro:
  - medios_pago_habilitados: PAGO_EN_CENTRO (default activo), TRANSFERENCIA (requiere datos bancarios), PASARELA (desactivado; requiere convenio).
  - plazo_validacion_transferencia_horas (default 24; siempre antes del inicio de la sesión).
  - porcentaje_pago_confirmacion (default 100).
- PAGO_EN_CENTRO: confirma al verificar; el pago queda pendiente y se registra al llegar.
- TRANSFERENCIA: datos bancarios según el modelo de cobro (centro o profesional); comprobante opcional (adjunto validado por contenido, cifrado); valida GESTION/ADMIN (cobro del centro) o el profesional (cobro directo). Validar registra el pago y confirma. Rechazar con motivo y aviso al paciente.
- PASARELA: interfaz simulada; el webhook simulado (idempotente y verificado) confirma la cita.
- Sin lectura de correos bancarios.

### A4. Mensajería
Plantillas nuevas: hora retenida, instrucciones de transferencia, comprobante recibido, pago validado o rechazado, hora liberada por vencimiento. Sin contenido clínico.

## Parte B - Frontend ya construido

### B1. Pedir hora (03b-2)
- Retención de 30 min con cuenta regresiva (solo visual).
- Datos para la ficha, RUT opcional, política de datos y consentimiento obligatorios, opción "pido hora para un menor".
- "Revisa tu correo": consulta el estado de la reserva cada pocos segundos mientras la pestaña está visible y avanza sola al verificarse, también si se verificó desde otro dispositivo. Si el contador llega a cero, consultar el estado antes de mostrar "hora liberada": manda el servidor.
- Paso de pago con los medios habilitados del centro:
  - pago en el centro: confirmación inmediata con aviso "pagas al llegar";
  - transferencia: datos bancarios, plazo visible, subida opcional de comprobante y "esperando validación" que se actualiza sola;
  - pasarela: flujo simulado.
- Pantallas finales: confirmada, pendiente de pago, liberada (con horas alternativas y opción de lista de espera).
- Si el profesional exige aprobación para pacientes nuevos: "solicitud enviada".
- Paciente con cuenta verificada: pasa directo al paso de pago.

### B2. Portal del paciente (03b-3)
- Página del enlace de verificación: confirma la verificación y, si la pestaña original sigue abierta, indica que puede volver a ella.
- Mi Cuenta: citas pendientes de pago con su plazo y opción de subir el comprobante; estados nuevos visibles en la lista de citas.

## Tests
- Backend: transiciones y vencimientos (job, no cliente); estado consultable desde otra sesión; verificación tardía con hora libre y tomada; cada medio de pago y quién valida según el modelo de cobro; transferencia vencida libera la hora y avisa a la lista de espera; webhook idempotente; migración de citas existentes.
- Front: componentes del paso de pago y del polling (se detiene al ocultar la pestaña y al llegar a un estado final).
- Las tres suites del backend pasan; regenerar openapi.json y el cliente del front.

## Pendiente para fases siguientes (no implementar ahora; agregar a brechas.md)
- 03b-5, Cobros: bandeja de transferencias por validar (comprobante, validar o rechazar con motivo) según el modelo de cobro; configuración de medios de pago, plazo y porcentaje.
- 03b-6, Playwright: verificación en otra pestaña con la original avanzando sola; cada medio de pago; transferencia vencida (enlace leído desde la API de Mailpit).

## Entrega
Formato de CLAUDE.md, capturas de las pantallas corregidas, actualizar matriz, requisitos, brechas.md e integraciones.md. Commits propuestos; no ejecutarlos hasta mi confirmación.
---------------------------------------------



## 03b-4 Backoffice según diseño
Conectar a la API, según brechas.md:
- Dashboard por rol activo (sin datos clínicos para ADMIN/GESTION).
- Fichas y pacientes, y vista administrativa (solo metadata). Registro de RUT en la primera sesión (recepción).
- Agenda y espacios: en vez de "reasignar", dos acciones: "Derivar paciente" (abre derivación) y "Cubrir sesión" (acceso clínico temporal).
- Cobros: "cerrar sesión" pasa a "registrar asistencia y pago"; la liquidación según citas realizadas.
- Configuración, Perfil profesional, Mi perfil, Match configuración.
Si una vista contradice una regla, seguir la regla y reportarlo.

-----------------------------------------------------------------------------------------

# 03b-4.1 - Correctivo: flujos públicos, formularios, autenticación, sesión y conformidad del backoffice con el diseño

## Contexto
Correcciones encontradas en pruebas manuales. Ejecutar después de 03b-3.1. Leer CLAUDE.md, brechas.md e inventario_ui.md.
Diseño de referencia: design-system/vinculos/tenant/.
Corregir solo lo indicado; ajustar el diseño agregando elementos, no eliminando.

## Regla de proceso
03b-5 queda en pausa. "Terminé 03b-5" fue incorrecto: 03b-4 no está conforme con el diseño. No avanzar de fase hasta cumplir la sección 4 y entregar capturas comparadas lado a lado con el diseño. Si una fase no está completa, decirlo explícitamente.

## 1. Flujos públicos

### 1.1 Relato del match ("Cuéntanos con tus palabras")
- Validación en el momento: contador de caracteres visible y mensaje del mínimo (10) mientras escribe.
- Botón "Continuar" deshabilitado hasta cumplir el mínimo. Nunca descubrir el error al final del flujo.
- Aplicar el mismo criterio a todo campo con mínimo o formato (validar al escribir o al salir del campo, no al enviar).

### 1.2 Presupuesto en el match (preferencia de pago)
- Nueva pregunta: "¿Cuánto prefieres pagar por sesión?" con rangos en CLP y la opción "prefiero no decirlo".
- Resultados por tramos:
  1. Dentro de la preferencia (primero).
  2. Tramos sucesivos de mayor precio, cada uno con un encabezado claro (por ejemplo "Hasta $X más que tu preferencia") y la tarifa visible en cada tarjeta.
- Dentro de cada tramo se mantiene el orden por necesidad y disponibilidad.
- "Prefiero no decirlo": sin tramos; orden por necesidad y disponibilidad.
- Se compara con la tarifa vigente según la modalidad elegida (general si no hay específica).
- No se guarda. Actualizar el cálculo en la API y la configuración del cuestionario (rangos editables por ADMIN).

### 1.3 Textos para pacientes
- "Retener la hora y enviar enlace" pasa a "Reservar mi hora".
- Revisar todos los textos públicos y del portal: lenguaje del negocio, nunca técnico (retener, token, estado, endpoint, etc.). Listar los cambios.

### 1.4 Filtros de modalidad (Online / Presencial)
- Control segmentado visible: más grande, con ícono por opción, estado activo evidente y foco de teclado. Coherente con el sistema Organic.

## 2. Formularios

### 2.1 Fecha de nacimiento
- Reemplazar el campo actual por tres desplegables (día, mes, año) con el estilo del sistema Organic, como componente en components/shared/.
- Días válidos según mes y año (bisiestos); años en rango razonable; mensaje si la fecha resulta en menor de edad (activa el flujo de adulto responsable).

### 2.2 RUT
- Componente único en components/shared/ para todo campo de RUT.
- Acepta cualquier forma de escribirlo (con o sin puntos, con o sin guion) y lo formatea mientras escribe o al salir: 12.345.678-9, con K en mayúscula.
- Valida el dígito verificador en el momento.
- Envía a la API el valor normalizado.
- Reemplazar todos los campos de RUT existentes por este componente.

### 2.3 Inicio de sesión con correo o RUT
- El campo de identificador acepta correo o RUT (detecta cuál es; si es RUT, usa el componente 2.2).
- Backend: búsqueda por rut_hmac en la función de login. Mismo mensaje de error genérico en ambos casos (no revelar si existe la cuenta). Mismo rate limit.

## 3. Verificación en dos pasos (por ahora, por correo)
- Obligatoria para todos los roles del equipo (ADMIN, GESTION, PROFESIONAL, PRACTICANTE); opcional para PACIENTE.
- Método activo: código por correo (6 dígitos, vence en 10 minutos, un solo uso, máximo de intentos y reenvío con espera).
- Mensajes claros: "Te enviamos un código a tu correo"; "El código no es válido o venció. Puedes pedir uno nuevo."; botón "Reenviar código".
- 10 códigos de respaldo de un solo uso al activar la verificación (descargar o copiar).
- App de autenticación (TOTP): si ya existe en el código, dejarla desactivada por configuración y oculta en la interfaz. Se habilitará más adelante. Documentarlo.
- En desarrollo y demo, los códigos llegan a Mailpit.

## 4. Backoffice conforme al diseño (completar 03b-4)
- Revisar cada archivo de design-system/vinculos/tenant/ e implementar lo que falta según las reglas actuales. Prioridad: "Admin - Mi perfil" y la vista de equipo de administración.
- Selector de equipo: al elegir un integrante, todas las vistas que dependen de él (agenda, perfil, cobros) cambian a su contexto, con indicador visible de "viendo a" y opción de volver. Nunca abre datos clínicos para ADMIN/GESTION.
- Selector de rol activo: solo visible si la cuenta tiene más de un rol; al cambiar, el menú y las vistas cambian según el rol. El usuario ADMIN del seed demo debe tener ADMIN y PROFESIONAL para demostrarlo.
- "Mi perfil": implementar según el diseño (no la versión actual).
- Agenda: en la cabecera "<- periodo ->", el periodo pasa a ser un control Semana | Mes (segmentado, claramente botón), más un botón "Hoy". Implementar la vista mensual.
- Entregar capturas lado a lado (diseño vs implementación) de cada vista de 03b-4 y una lista de diferencias que quedan, con su motivo (regla de la BD, dato inexistente, etc.).

## 5. Datos de demostración
- Revisar el seed demo para que permita probar todas las vistas:
  - al menos 6 profesionales con especialidades, tarifas, modalidades, previsión y disponibilidad variadas (para probar filtros, presupuesto y match);
  - usuarios demo por rol con credenciales documentadas en docs/pruebas/usuarios_demo.md (el segundo factor llega a Mailpit);
  - citas y datos suficientes para que ninguna vista aparezca vacía sin motivo.
- Solo en modo demo (nunca en producción): selector de usuario demo en el login para entrar rápido con cada rol.

## 6. Sesión persistente y verificación de roles

### 6.1 Sesión
- Error actual: al pasar del backoffice a la landing (o volver al inicio) se pierde la sesión y se pide iniciar sesión otra vez.
- Mantener el modelo: access token en memoria y refresh en cookie httpOnly. Nunca guardar tokens en localStorage ni sessionStorage. En localStorage solo preferencias sin datos sensibles (último rol activo elegido, vista de agenda, tema).
- Al cargar cualquier layout (público, portal o backoffice), intentar renovar la sesión en silencio con la cookie de refresh antes de decidir si hay sesión.
- Revisar la cookie de refresh: mismo origen vía rewrites de /api, Path y SameSite correctos, Secure solo con HTTPS (en localhost sin HTTPS debe funcionar).
- En la landing, con sesión activa, mostrar "Ir a mi panel" en vez de "Iniciar sesión".
- La sesión solo termina por cierre de sesión, expiración del refresh o revocación.

### 6.2 Verificación de roles
- Test Playwright por cada usuario demo (ADMIN, ADMIN+PROFESIONAL, GESTION, PROFESIONAL, PRACTICANTE, PACIENTE adulto, adolescente, adulto responsable):
  - el menú muestra solo lo que corresponde según la matriz;
  - entrar por URL directa a una ruta no permitida muestra "sin permiso";
  - la API responde 403 a las acciones no permitidas.
- Generar docs/pruebas/verificacion_roles.md con la tabla rol x vista (permitido / bloqueado) y su resultado.

## Tests
- Componentes: RUT (formatos de entrada, DV, normalización), fecha (días por mes, bisiestos, menor de edad), relato (botón deshabilitado bajo el mínimo), control segmentado, selector Semana | Mes.
- API: login por RUT y por correo con error genérico; match con presupuesto (tramos, "prefiero no decirlo", orden dentro de cada tramo); segundo factor por correo obligatorio para el equipo (código leído desde Mailpit, vencimiento, reenvío, códigos de respaldo); TOTP desactivado no accesible.
- Playwright: recargar la página mantiene la sesión; ir del backoffice a la landing y volver mantiene la sesión; cerrar sesión la termina en todas las pestañas; ningún token en localStorage ni sessionStorage; verificación de roles de 6.2.
- Las tres suites del backend pasan; regenerar openapi.json y el cliente del front.

## Entrega
Formato de CLAUDE.md, capturas lado a lado de lo corregido, lista de textos cambiados, verificacion_roles.md y estado real de cada fase (03b-2, 03b-3, 03b-4: completa o con pendientes). Commits propuestos; no ejecutarlos hasta mi confirmación.

-----------------------------------------------------------------------------------------


## 03b-5 Pantallas nuevas
No están en el diseño: diseñarlas con el sistema Organic y el inventario de 03b-1.
- Clínico:
  - Ficha de ingreso y evoluciones con formularios dinámicos según la plantilla de la especialidad (versión con que se escribió cada registro), más los campos estructurados (tipo de sesión, intervenciones, estado de avance, nivel de riesgo).
  - Borrador con guardado automático y botón "Confirmar en el expediente" (con aviso de que después no se edita); lista de borradores pendientes.
  - Corrección como registro nuevo; documentos emitidos (redacción y vista previa del PDF); adjuntos; contacto de emergencia visible para el tratante.
  - Alta del paciente; catálogos con propuesta y aprobación; revisión de retención.
- Plantillas clínicas: editor de plantillas por especialidad (campos, tipos, opciones, orden, visible en supervisión), propuesta del profesional, publicación por ADMIN, historial de versiones. Especialidades del profesional con aprobación.
- Accesos clínicos temporales: otorgar (motivo REEMPLAZO o INTERCONSULTA, alcance, fecha de término), ver activos y vencidos; aviso al paciente.
- Derivaciones: crear con candidatos, estado para el origen, bandeja de ofertas del candidato (solo motivo, edad y tipo), gestión de ADMIN.
- Practicantes: consentimientos, supervisión seudonimizada con comentarios, accesos, cambio de supervisor.
- Equipo: trayectoria con verificación, datos privados, tarifas, tipos de atención y especialidades con aprobación, previsión, idiomas, cita destacada, consentimiento de perfil público, modo de videollamada, roles de la cuenta, bajas por rol con bandeja de reasignación (avisar borradores pendientes), alertas internas, directorio.
- Agenda: horario del centro y por box, disponibilidad semanal por modalidad, bloqueos, margen de traslado, alternativas ante 409, citas por reprogramar, conflictos de margen, lista de espera, feed iCal (copiar y regenerar), aprobación de pacientes nuevos.
- Cobros: pagos parciales, anulaciones, boletas, resoluciones de cancelación, liquidaciones y arriendos, exportar PDF de reportes y liquidaciones, opción "exigir evolución registrada para liquidar".
- Mensajería:
  - bandeja del equipo y editor de plantillas de mensajes (variables permitidas);
  - mensajería interna: hilos GENERAL (aviso de no nombrar pacientes) y CASO (solo con acceso clínico; desaparece al perder el acceso), retirar mensaje dentro de 5 minutos, leídos, polling.
- Reseñas: moderación (publicar, ocultar con motivo, reportes) y feedback privado del profesional.
- Configuración completa del centro: GESTION, plazos, márgenes, porcentajes, modelo de cobro, recordatorio, días de gracia, retención de mensajes, contenido público, horarios.
Pasar cada vista nueva por impeccable y adjuntar captura.

## 03b-6 Pulido
- Animaciones y transiciones coherentes con el sistema; estados vacíos ilustrados; skeletons de carga.
- Responsive: público y portal primero para móvil; backoffice usable en tablet.
- Accesibilidad completa (teclado, lectores de pantalla, foco visible, contraste).
- Rendimiento: bundle, imágenes optimizadas, SSR del público.
- Playwright con los flujos del guion manual de 02j y los nuevos:
  - reserva sin cuenta con retención, verificación y vencimiento;
  - "ya soy paciente" sin revelar información;
  - cambio de rol activo;
  - consentimiento por token;
  - reseña con moderación;
  - adolescente y adulto responsable;
  - borrador confirmado al expediente;
  - cubrir sesión con acceso temporal;
  - lista de espera;
  - hilo CASO que desaparece al perder acceso.
  - Los flujos que dependen de un correo (verificación, enlace de acceso, consentimientos por token, recordatorio, lista de espera) leen el enlace desde la API de Mailpit; nada se copia a mano.

## Entrega por fase
Formato de CLAUDE.md, capturas de cada vista nueva o modificada, lista de lo reportado como contradicción o fuera de alcance, y commits propuestos en español (no ejecutarlos hasta mi confirmación).