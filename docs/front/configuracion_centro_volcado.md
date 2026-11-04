# Configuración del centro (volcado)

Generado 03-11-2026, 11:28:29 p. m. desde `/admin/configuracion` como **admin** del seed demo (Centro de Prueba). Datos de demostración, sin datos reales. Convención: `- **Campo** (tipo): valor`, `[x]`/`[ ]` casillas e interruptores, `[botón]` acciones disponibles.

Secciones: Datos y página pública · Horario y feriados · Agenda y plazos · Cobros y acuerdos · Medios de pago · Avisos al paciente y equipo · Roles y accesos · Consentimientos y políticas · Datos personales y auditoría · Módulos, contrato y soporte

---

## Datos y página pública

_Componente: `frontend/src/components/nucleo/DatosCentro.tsx`_

#### Datos y página pública

Lo que se edita acá aparece en correos, comprobantes y la página pública.

##### Identidad y contacto

- **Nombre del centro** (text): `Centro de Prueba Vinculos (DEMO)`
- **RUT del centro** (text): `76.111.222-8`
- **Correo de contacto** (email): `contacto@centro-prueba.cl`
También recibe las respuestas a los correos del sistema.
- **Teléfono** (tel): `+56222222222`
- **Dirección** (text): `Dirección ficticia 123, Santiago`
- **WhatsApp** (tel): _vacío_
- **Instagram** (text): _vacío_
Logo del centro JPEG, PNG o WebP. Se le quitan los metadatos antes de publicarlo.
- **Elegir logo** (file): _vacío_
- [botón] Subir logo

##### Textos de la página pública

- [enlace → /] Abrir la página pública
- **Título de la portada** (text): `Acompañamiento psicológico, con orden detrás.`
- **Texto de la portada** (texto largo):

  ```
  Atendemos consultas individuales, de pareja y familiares. Reserva en línea y un equipo que se coordina en la misma plataforma.
  ```

- **Misión** (texto largo):

  ```
  
  ```

Vacía: «Quiénes somos» no se muestra en la página.
- **Visión** (texto largo):

  ```
  
  ```

Vacía.
Servicios 3 de 12
- [botón] Agregar servicio
Terapia individual Sesiones presenciales o por videollamada, con seguimiento entre sesiones.
- [botón] Editar
- [botón] Quitar
Terapia de pareja Acompañamiento para conflictos de convivencia, comunicación y proyectos en común.
- [botón] Editar
- [botón] Quitar
Niños y adolescentes Evaluación y terapia con participación de la familia.
- [botón] Editar
- [botón] Quitar

##### Color de marca

Solo cambia la página pública; el panel mantiene la paleta del sistema.
- [botón] Arcilla _(activo)_
- [botón] Bosque
- [botón] Océano
- [botón] Ciruela
- [botón] Arena
- **Hexadecimal** (text): _vacío_
Así se ve en la portada Acompañamiento psicológico, con orden detrás. Reservar una hora Contraste AA correcto para el texto blanco.
Los cambios de «Datos y página pública» se guardan juntos y quedan en la auditoría.
- [botón] Descartar _(deshabilitado)_
- [botón] Guardar esta sección

---

## Horario y feriados

_Componente: `frontend/src/components/nucleo/HorarioPoliticasCentro.tsx (HorarioCentroEditor) + nucleo/FeriadosCentro.tsx`_

#### Horario y feriados

El marco dentro del que caen todas las citas y los horarios de box.

##### Horario general

- [botón] Lunes a viernes, 09:00 a 20:00
Ninguna cita ni horario de box puede quedar fuera. Las citas ya agendadas no se mueven.
- [x] Abrir el lunes _(switch)_
Lunes
- **Lunes: abre** (time): `00:00`
a
- **Lunes: cierra** (time): _vacío_
- [botón] Agregar pausa
- [x] Abrir el martes _(switch)_
Martes
- **Martes: abre** (time): `00:00`
a
- **Martes: cierra** (time): _vacío_
- [botón] Agregar pausa
- [x] Abrir el miércoles _(switch)_
Miércoles
- **Miércoles: abre** (time): `00:00`
a
- **Miércoles: cierra** (time): _vacío_
- [botón] Agregar pausa
- [x] Abrir el jueves _(switch)_
Jueves
- **Jueves: abre** (time): `00:00`
a
- **Jueves: cierra** (time): _vacío_
- [botón] Agregar pausa
- [x] Abrir el viernes _(switch)_
Viernes
- **Viernes: abre** (time): `00:00`
a
- **Viernes: cierra** (time): _vacío_
- [botón] Agregar pausa
- [x] Abrir el sábado _(switch)_
Sábado
- **Sábado: abre** (time): `00:00`
a
- **Sábado: cierra** (time): _vacío_
- [botón] Agregar pausa
- [x] Abrir el domingo _(switch)_
Domingo
- **Domingo: abre** (time): `00:00`
a
- **Domingo: cierra** (time): _vacío_
- [botón] Agregar pausa
- [enlace → /admin/agenda?vista=espacios] Ajustar horarios por box en Agenda y Espacios
Los cambios de «Horario general» se guardan juntos y quedan en la auditoría.
- [botón] Descartar _(deshabilitado)_
- [botón] Guardar esta sección

##### Feriados

Los nacionales se calculan solos cada año. No cuentan como días hábiles en los plazos.
Próximos
8 de diciembre de 2026 · Inmaculada Concepción Ley
25 de diciembre de 2026 · Navidad Ley
1 de enero de 2027 · Año Nuevo Ley
- **Agregar feriado propio** (date): _vacío_
- **Nombre del feriado** (text): _vacío_
- [botón] Agregar feriado
- [botón] Ver 2026 completo (16)

---

## Agenda y plazos

_Componente: `frontend/src/components/nucleo/ReglasCentro.tsx (seccion="agenda")`_

#### Agenda y plazos

Reservas, recordatorios y plazos de derivaciones, consentimientos y evoluciones.

##### Reservas y recordatorios

Para la página pública y los avisos por correo.
- **Recordatorio antes de la sesión** (text): `48`
horas 0 = sin recordatorio. Debe ser mayor que el aviso mínimo para cancelar.
- **Margen entre sesión presencial y online** (text): `30`
min Entre 0 y 240 min.
- **Retención de la hora mientras se verifica el correo** (text): `30`
min Entre 5 y 120 min.

##### Plazos clínicos

Derivaciones, consentimientos y cierre de sesiones.
- **Plazo para responder una derivación** (text): `24`
horas Entre 1 y 720 horas.
- **Plazo para responder un consentimiento** (text): `48`
horas Entre 1 y 720 horas.
- **Plazo de oposición del paciente** (text): `48`
horas Entre 1 y 720 horas.
- **Días para registrar la evolución de una sesión** (text): `30`
días Entre 1 y 365 días.

##### Cuentas y conservación

Cuentas propias de pacientes y mensajes internos del equipo.
- **Edad mínima para la cuenta propia del paciente** (text): `14`
años Entre 14 y 18 años.
- **Conservación de mensajes internos del equipo** (text): `365`
días Entre 30 y 3650 días.
Los cambios de «Agenda y plazos» se guardan juntos y quedan en la auditoría.
- [botón] Descartar _(deshabilitado)_
- [botón] Guardar esta sección

---

## Cobros y acuerdos

_Componente: `frontend/src/components/nucleo/ReglasCentro.tsx (seccion="cobros") + cobros/AcuerdosProfesionales.tsx`_

#### Cobros y acuerdos

Quién cobra cada atención y qué se deben el centro y cada profesional.
Vinculos registra, calcula y conecta. El dinero pasa por la cuenta del centro o de cada profesional, y las boletas las emite su titular.

##### Acuerdo por defecto

Lo usan los profesionales sin acuerdo propio (y los que se suman al equipo). Después cada acuerdo se ajusta por persona.
- [ ] A Cobra el profesional Paga al centro por uso de box: hora, bloque o bolsa de horas. Arriendo, estilo coworking _(radio)_
- [x] B Cobra el centro Descuenta su comisión y liquida el resto al profesional. Comisión o revenue share _(radio)_
- [ ] C Mixto Combina cuota fija, cargo por box y comisiones (se definen por persona). Sin acuerdo propio cobra el centro, salvo quien adhiera al cobro directo. _(radio)_

##### Comisiones del acuerdo por defecto

Se descuentan en la liquidación de cada profesional.
- **Comisión del centro sobre lo cobrado** (text): `20`
% Sobre todas las atenciones liquidadas.
- **Comisión de pacientes que llegaron por el centro** (lista): La misma comisión general / Un porcentaje distinto / **Un monto fijo por sesión**
Pacientes del sitio público (Match o Pedir hora) o dados de alta por administración. Se marca en la ficha del paciente.
$
- **Monto por sesión** (text): `5000`
En pesos. Nunca más que lo cobrado de la sesión.

##### Acuerdos por profesional

Un cambio rige desde su fecha. Lo ya liquidado no cambia.
Profesional Quién cobra Cargos del centro Vigente desde
- [botón] Admin Centro Prueba ?Sin acuerdo propio Usa el acuerdo del centro - Definir _(activo)_
- [botón] Directora Demo ?Sin acuerdo propio Usa el acuerdo del centro - Definir
Practicante Demo - No cobra En práctica supervisada, sin cargos No se liquida
- [botón] Profesional Cinco (Demo) ?Sin acuerdo propio Usa el acuerdo del centro - Definir
- [botón] Profesional Cuatro (Demo) ?Sin acuerdo propio Usa el acuerdo del centro - Definir
- [botón] Profesional Dos ?Sin acuerdo propio Usa el acuerdo del centro - Definir
- [botón] Profesional Seis (Demo) ?Sin acuerdo propio Usa el acuerdo del centro - Definir
- [botón] Profesional Tres (Demo) ?Sin acuerdo propio Usa el acuerdo del centro - Definir
- [botón] Profesional Uno ?Sin acuerdo propio Usa el acuerdo del centro - Definir
Acuerdo de Admin Centro Prueba
- **Modelo** (lista): A · Cobra el profesional / **B · Cobra el centro** / C · Mixto
- **Quién cobra al paciente** (lista): **El centro** / El profesional _(deshabilitado)_
Lo fija el modelo.
- **Comisión sobre todas las atenciones** (text): `20`
% Sobre lo que cobra el centro.
- **Pacientes que llegaron por el centro** (lista): La misma comisión general / Un porcentaje distinto / **Un monto fijo por sesión**
Reemplaza la comisión general en esas sesiones.
$
- **Monto por sesión captada** (text): `5000`
$
- **Cuota fija mensual** (text): `0`
Una por cada mes que empieza dentro del período liquidado.
$
- **Cargo por uso de box** (text): `0`
por hora Por cada hora de box apartada en el período.
- **Vigente desde** (date): `2026-11-03`
Lo ya liquidado no cambia.
- [botón] Guardar acuerdo
Ejemplo de un mes 20 sesiones de $35.000, 8 de pacientes que llegaron por el centro, 20 h de box.
Bruto cobrado por el centro $700.000
Para el centro $124.000
Boleta del profesional $576.000
Retención 15,25% $87.840
Recibe el profesional $488.160
Cálculo informativo, no tributario.

##### Cancelaciones, inasistencias y deudas

Iguales para todo el centro. Se aplican al resolver cancelaciones y al calcular liquidaciones.
- **Aviso mínimo para cancelar sin cargo** (text): `24`
horas Entre 0 y 720 horas.
- **Cargo por cancelar fuera de plazo** (text): `25`
% Entre 0 y 100 %.
- **Cargo por inasistencia** (text): `100`
% Entre 0 y 100 %.
- **Pago previo de las horas que agenda el equipo** (text): `12`
horas Horas antes de la sesión. Si vence sin pago, la hora se mantiene y se paga en el centro.
- **Días de gracia antes de contar una deuda** (text): `0`
días Días después de una sesión impaga. 0 = la deuda cuenta apenas termina la sesión.
Liquidar solo sesiones con evolución registrada Una sesión realizada sin evolución no entra en la liquidación hasta que el profesional la cierre.
- [ ] Liquidar solo sesiones con evolución registrada _(switch)_
Liquidar al profesional los cargos cobrados Lo cobrado por inasistencia y cancelación fuera de plazo entra a la liquidación como línea aparte, con la comisión normal. Apagado, lo retiene el centro.
- [ ] Liquidar al profesional los cargos cobrados _(switch)_
No agendar a pacientes con deuda Con una sesión impaga, ni el paciente ni el profesional pueden agendar la siguiente. Administración o gestión pueden autorizar una hora indicando el motivo.
- [x] No agendar a pacientes con deuda _(switch)_

##### Parámetros tributarios

Solo para los cálculos informativos. Los mantiene Vinculos según la ley vigente.
- 2026 · retención 15,25%
- 2027 · 16%
- 2028 · 17%
- IVA · 19% (arriendo de box amoblado)
Los cambios de «Cobros y acuerdos» se guardan juntos y quedan en la auditoría.
- [botón] Descartar _(deshabilitado)_
- [botón] Guardar esta sección

---

## Medios de pago

_Componente: `frontend/src/components/nucleo/MediosPagoCentro.tsx`_

#### Medios de pago

Cómo paga el paciente y con qué cuenta se conecta cada cobro.

##### Lo que ve el paciente al reservar

Pago en el centro
- [x] Pago en el centro _(switch)_
La hora se confirma con el correo verificado y se paga al llegar. Visible al reservar
Transferencia
- [x] Transferencia _(switch)_
El paciente sube su comprobante; la hora se confirma al validarlo en Cobros. Visible al reservar
Link de pago
- [x] Link de pago _(switch)_
Tarjeta o transferencia por la pasarela del titular del cobro. Habilitado antes: se conserva
- **Plazo para pagar o validar** (text): `24`
horas Horas, entre 1 y 168. Nunca después del inicio de la sesión.
- **Porcentaje que se paga para confirmar** (text): `50`
% Del valor de la sesión, entre 1 y 100 %.
- [botón] Guardar medios de pago

#### Cuenta del centro

Datos que ve el paciente para transferir. Se guardan cifrados.
- **RUT del titular** (text): `761112228`
- **Titular** (text): `Centro de Prueba Vinculos SpA (Demo)`
- **Banco** (text): `Banco Ficticio (Demo)`
- **Tipo de cuenta** (lista): **Cuenta corriente** / Cuenta vista / Cuenta de ahorro
- **Número de cuenta** (text): `000-111-222`
- [botón] Guardar cuenta

##### Conexiones de cobro

Cada titular conecta su propia cuenta. Las credenciales se guardan cifradas y no se vuelven a mostrar.
Diseño de ejemplo: la conexión con pasarelas de pago todavía no está disponible. Hoy el paciente paga en el centro o por transferencia.
Centro de Prueba Vinculos SpA (Demo) Transferencia Banco Ficticio (Demo) · cuenta corriente terminada en 222 Activa
Centro de Prueba Vinculos SpA (Demo) Pasarela de pago Para las atenciones que cobra el centro (acuerdos B y C). Sin conectar
- [botón] Conectar _(deshabilitado)_
Profesionales con cobro propio Pasarela propia Para sus atenciones (acuerdo A). Cada uno la conecta desde Mi perfil. Ejemplo

---

## Avisos al paciente y equipo

_Componente: `frontend/src/components/nucleo/PlantillasMensaje.tsx`_

#### Avisos al paciente y equipo

Una fila por aviso, una columna por destino. Lo que va entre llaves lo completa el sistema.
- [botón] Todos _(activo)_
- [botón] Citas
- [botón] Pagos
- [botón] Clínico y consentimientos
- [botón] Equipo
Aviso Paciente · bandeja Paciente · correo Equipo · bandeja Equipo · correo
Citas
Cita confirmada
- [botón] Ejemplo _(activo)_
- [botón] Ejemplo
No aplica No aplica
Cita cancelada
- [botón] Ejemplo
- [botón] Ejemplo
- [botón] Ejemplo
- [botón] Ejemplo
Cita reprogramada
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Recordatorio de cita
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Hora liberada
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Solicitud de hora No aplica No aplica
- [botón] Ejemplo
- [botón] Ejemplo
Cierre requerido No aplica No aplica
- [botón] Ejemplo
- [botón] Ejemplo
Posible duplicado No aplica No aplica
- [botón] Ejemplo
- [botón] Ejemplo
Pagos
Instrucciones de transferencia
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Comprobante recibido
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Pago validado
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Pago rechazado
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Pago pendiente
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Pago registrado
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Comprobante emitido
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Deuda pendiente
- [botón] Ejemplo
- [botón] Ejemplo
- [botón] Ejemplo
- [botón] Ejemplo
Clínico y consentimientos
Consentimiento solicitado
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Consentimiento por vencer
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Cambio de supervisor
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Documento clínico
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Acceso clínico temporal
- [botón] Ejemplo
- [botón] Ejemplo
No aplica No aplica
Acceso clínico revocado
- [botón] Ejemplo
- [botón] Ejemplo
- [botón] Ejemplo
- [botón] Ejemplo
Equipo
Derivación ofrecida No aplica No aplica
- [botón] Ejemplo
- [botón] Ejemplo
Derivación actualizada No aplica No aplica
- [botón] Ejemplo
- [botón] Ejemplo
Mensaje de paciente No aplica No aplica
- [botón] Ejemplo
- [botón] Ejemplo
Mensaje interno No aplica No aplica
- [botón] Ejemplo
- [botón] Ejemplo
Paciente · bandeja

##### Cita confirmada

- **Asunto** (text): `Cita confirmada`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su cita con {profesional} quedó confirmada para el {fecha} a las {hora} ({modalidad}). Enlace: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su cita con Profesional Uno quedó confirmada para el jueves 12 de noviembre a las 11:00 (presencial, Box 1). Enlace: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cita confirmada, paciente · bandeja: ejemplo

Paciente · bandeja

##### Cita confirmada

- **Asunto** (text): `Cita confirmada`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su cita con {profesional} quedó confirmada para el {fecha} a las {hora} ({modalidad}). Enlace: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su cita con Profesional Uno quedó confirmada para el jueves 12 de noviembre a las 11:00 (presencial, Box 1). Enlace: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cita confirmada, paciente · correo: ejemplo

Paciente · correo

##### Cita confirmada

- **Asunto** (text): `Cita confirmada`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su cita con {profesional} quedó confirmada para el {fecha} a las {hora} ({modalidad}). Enlace: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su cita con Profesional Uno quedó confirmada para el jueves 12 de noviembre a las 11:00 (presencial, Box 1). Enlace: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cita cancelada, paciente · bandeja: ejemplo

Paciente · bandeja

##### Cita cancelada

- **Asunto** (text): `Cita cancelada`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su cita con {profesional} del {fecha} a las {hora} fue cancelada. Para agendar otra hora: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su cita con Profesional Uno del jueves 12 de noviembre a las 11:00 fue cancelada. Para agendar otra hora: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cita cancelada, paciente · correo: ejemplo

Paciente · correo

##### Cita cancelada

- **Asunto** (text): `Cita cancelada`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su cita con {profesional} del {fecha} a las {hora} fue cancelada. Para agendar otra hora: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su cita con Profesional Uno del jueves 12 de noviembre a las 11:00 fue cancelada. Para agendar otra hora: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cita cancelada, equipo · bandeja: ejemplo

Equipo · bandeja

##### Cita cancelada

- **Asunto** (text): `Cita cancelada`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: se canceló una cita de su agenda del {fecha} a las {hora}. Detalle en el sistema: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: se canceló una cita de su agenda del jueves 12 de noviembre a las 11:00. Detalle en el sistema: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cita cancelada, equipo · correo: ejemplo

Equipo · correo

##### Cita cancelada

- **Asunto** (text): `Cita cancelada`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: se canceló una cita de su agenda del {fecha} a las {hora}. Detalle en el sistema: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: se canceló una cita de su agenda del jueves 12 de noviembre a las 11:00. Detalle en el sistema: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cita reprogramada, paciente · bandeja: ejemplo

Paciente · bandeja

##### Cita reprogramada

- **Asunto** (text): `Cita reprogramada`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su cita con {profesional} cambió al {fecha} a las {hora} ({modalidad}). Enlace: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su cita con Profesional Uno cambió al jueves 12 de noviembre a las 11:00 (presencial, Box 1). Enlace: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cita reprogramada, paciente · correo: ejemplo

Paciente · correo

##### Cita reprogramada

- **Asunto** (text): `Cita reprogramada`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su cita con {profesional} cambió al {fecha} a las {hora} ({modalidad}). Enlace: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su cita con Profesional Uno cambió al jueves 12 de noviembre a las 11:00 (presencial, Box 1). Enlace: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Recordatorio de cita, paciente · bandeja: ejemplo

Paciente · bandeja

##### Recordatorio de cita

- **Asunto** (text): `Recordatorio de su cita`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: le recordamos su cita con {profesional} el {fecha} a las {hora} ({modalidad}). Confirme su asistencia o cancele aquí: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: le recordamos su cita con Profesional Uno el jueves 12 de noviembre a las 11:00 (presencial, Box 1). Confirme su asistencia o cancele aquí: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Recordatorio de cita, paciente · correo: ejemplo

Paciente · correo

##### Recordatorio de cita

- **Asunto** (text): `Recordatorio de su cita`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: le recordamos su cita con {profesional} el {fecha} a las {hora} ({modalidad}). Confirme su asistencia o cancele aquí: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: le recordamos su cita con Profesional Uno el jueves 12 de noviembre a las 11:00 (presencial, Box 1). Confirme su asistencia o cancele aquí: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Hora liberada, paciente · bandeja: ejemplo

Paciente · bandeja

##### Hora liberada

- **Asunto** (text): `Su hora se libero`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su hora del {fecha} a las {hora} con {profesional} se libero porque vencio el plazo de pago. Si quiere, pida otra hora: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su hora del jueves 12 de noviembre a las 11:00 con Profesional Uno se libero porque vencio el plazo de pago. Si quiere, pida otra hora: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Hora liberada, paciente · correo: ejemplo

Paciente · correo

##### Hora liberada

- **Asunto** (text): `Su hora se libero`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su hora del {fecha} a las {hora} con {profesional} se libero porque vencio el plazo de pago. Si quiere, pida otra hora: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su hora del jueves 12 de noviembre a las 11:00 con Profesional Uno se libero porque vencio el plazo de pago. Si quiere, pida otra hora: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Solicitud de hora, equipo · bandeja: ejemplo

Equipo · bandeja

##### Solicitud de hora

- **Asunto** (text): `Solicitud de hora por aprobar`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: un paciente nuevo pidió hora para el {fecha} a las {hora}. Apruébela o cancélela en el sistema: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: un paciente nuevo pidió hora para el jueves 12 de noviembre a las 11:00. Apruébela o cancélela en el sistema: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Solicitud de hora, equipo · correo: ejemplo

Equipo · correo

##### Solicitud de hora

- **Asunto** (text): `Solicitud de hora por aprobar`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: un paciente nuevo pidió hora para el {fecha} a las {hora}. Apruébela o cancélela en el sistema: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: un paciente nuevo pidió hora para el jueves 12 de noviembre a las 11:00. Apruébela o cancélela en el sistema: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cierre requerido, equipo · bandeja: ejemplo

Equipo · bandeja

##### Cierre requerido

- **Asunto** (text): `Ficha de sesión por cerrar`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: la sesión del {fecha} a las {hora} sigue sin evolución registrada. Ciérrela en el sistema: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: la sesión del jueves 12 de noviembre a las 11:00 sigue sin evolución registrada. Ciérrela en el sistema: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cierre requerido, equipo · correo: ejemplo

Equipo · correo

##### Cierre requerido

- **Asunto** (text): `Ficha de sesión por cerrar`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: la sesión del {fecha} a las {hora} sigue sin evolución registrada. Ciérrela en el sistema: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: la sesión del jueves 12 de noviembre a las 11:00 sigue sin evolución registrada. Ciérrela en el sistema: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Posible duplicado, equipo · bandeja: ejemplo

Equipo · bandeja

##### Posible duplicado

- **Asunto** (text): `Posible paciente duplicado`
- **Mensaje** (texto largo):

  ```
  Se registró un paciente con el RUT o el correo de otro ya existente. Revíselo en el sistema: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Se registró un paciente con el RUT o el correo de otro ya existente. Revíselo en el sistema: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Posible duplicado, equipo · correo: ejemplo

Equipo · correo

##### Posible duplicado

- **Asunto** (text): `Posible paciente duplicado`
- **Mensaje** (texto largo):

  ```
  Se registró un paciente con el RUT o el correo de otro ya existente. Revíselo en el sistema: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Se registró un paciente con el RUT o el correo de otro ya existente. Revíselo en el sistema: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Instrucciones de transferencia, paciente · bandeja: ejemplo

Paciente · bandeja

##### Instrucciones de transferencia

- **Asunto** (text): `Datos para transferir`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su hora del {fecha} a las {hora} con {profesional} queda reservada hasta que validemos la transferencia. Los datos de la cuenta, el monto y el plazo estan en: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su hora del jueves 12 de noviembre a las 11:00 con Profesional Uno queda reservada hasta que validemos la transferencia. Los datos de la cuenta, el monto y el plazo estan en: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Instrucciones de transferencia, paciente · correo: ejemplo

Paciente · correo

##### Instrucciones de transferencia

- **Asunto** (text): `Datos para transferir`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su hora del {fecha} a las {hora} con {profesional} queda reservada hasta que validemos la transferencia. Los datos de la cuenta, el monto y el plazo estan en: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su hora del jueves 12 de noviembre a las 11:00 con Profesional Uno queda reservada hasta que validemos la transferencia. Los datos de la cuenta, el monto y el plazo estan en: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Comprobante recibido, paciente · bandeja: ejemplo

Paciente · bandeja

##### Comprobante recibido

- **Asunto** (text): `Recibimos su comprobante`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: recibimos el comprobante de su hora del {fecha} a las {hora}. Le avisaremos cuando quede validado. Detalle: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: recibimos el comprobante de su hora del jueves 12 de noviembre a las 11:00. Le avisaremos cuando quede validado. Detalle: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Comprobante recibido, paciente · correo: ejemplo

Paciente · correo

##### Comprobante recibido

- **Asunto** (text): `Recibimos su comprobante`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: recibimos el comprobante de su hora del {fecha} a las {hora}. Le avisaremos cuando quede validado. Detalle: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: recibimos el comprobante de su hora del jueves 12 de noviembre a las 11:00. Le avisaremos cuando quede validado. Detalle: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Pago validado, paciente · bandeja: ejemplo

Paciente · bandeja

##### Pago validado

- **Asunto** (text): `Pago validado`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: validamos el pago de su hora del {fecha} a las {hora} con {profesional}. Su hora quedo confirmada. Detalle: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: validamos el pago de su hora del jueves 12 de noviembre a las 11:00 con Profesional Uno. Su hora quedo confirmada. Detalle: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Pago validado, paciente · correo: ejemplo

Paciente · correo

##### Pago validado

- **Asunto** (text): `Pago validado`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: validamos el pago de su hora del {fecha} a las {hora} con {profesional}. Su hora quedo confirmada. Detalle: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: validamos el pago de su hora del jueves 12 de noviembre a las 11:00 con Profesional Uno. Su hora quedo confirmada. Detalle: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Pago rechazado, paciente · bandeja: ejemplo

Paciente · bandeja

##### Pago rechazado

- **Asunto** (text): `No pudimos validar su pago`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: no pudimos validar la transferencia de su hora del {fecha} a las {hora}. Revise el motivo y vuelva a intentarlo antes del plazo: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: no pudimos validar la transferencia de su hora del jueves 12 de noviembre a las 11:00. Revise el motivo y vuelva a intentarlo antes del plazo: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Pago rechazado, paciente · correo: ejemplo

Paciente · correo

##### Pago rechazado

- **Asunto** (text): `No pudimos validar su pago`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: no pudimos validar la transferencia de su hora del {fecha} a las {hora}. Revise el motivo y vuelva a intentarlo antes del plazo: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: no pudimos validar la transferencia de su hora del jueves 12 de noviembre a las 11:00. Revise el motivo y vuelva a intentarlo antes del plazo: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Pago pendiente, paciente · bandeja: ejemplo

Paciente · bandeja

##### Pago pendiente

- **Asunto** (text): `Hora pendiente de pago`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su hora del {fecha} a las {hora} con {profesional} esta pendiente de pago. Puede pagarla antes de la sesion; si no alcanza, pague en el centro el dia de la atencion. Detalle: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su hora del jueves 12 de noviembre a las 11:00 con Profesional Uno esta pendiente de pago. Puede pagarla antes de la sesion; si no alcanza, pague en el centro el dia de la atencion. Detalle: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Pago pendiente, paciente · correo: ejemplo

Paciente · correo

##### Pago pendiente

- **Asunto** (text): `Hora pendiente de pago`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su hora del {fecha} a las {hora} con {profesional} esta pendiente de pago. Puede pagarla antes de la sesion; si no alcanza, pague en el centro el dia de la atencion. Detalle: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su hora del jueves 12 de noviembre a las 11:00 con Profesional Uno esta pendiente de pago. Puede pagarla antes de la sesion; si no alcanza, pague en el centro el dia de la atencion. Detalle: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Pago registrado, paciente · bandeja: ejemplo

Paciente · bandeja

##### Pago registrado

- **Asunto** (text): `Pago registrado`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: registramos un pago de su cita del {fecha} con {profesional}. Detalle en el portal: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: registramos un pago de su cita del jueves 12 de noviembre con Profesional Uno. Detalle en el portal: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Pago registrado, paciente · correo: ejemplo

Paciente · correo

##### Pago registrado

- **Asunto** (text): `Pago registrado`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: registramos un pago de su cita del {fecha} con {profesional}. Detalle en el portal: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: registramos un pago de su cita del jueves 12 de noviembre con Profesional Uno. Detalle en el portal: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Comprobante emitido, paciente · bandeja: ejemplo

Paciente · bandeja

##### Comprobante emitido

- **Asunto** (text): `Comprobante de pago`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: registramos el pago de su cita del {fecha}. Su comprobante de pago está disponible en el portal: {enlace}. Este comprobante no es una boleta del SII.
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: registramos el pago de su cita del jueves 12 de noviembre. Su comprobante de pago está disponible en el portal: centro-prueba.cl/portal. Este comprobante no es una boleta del SII.
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Comprobante emitido, paciente · correo: ejemplo

Paciente · correo

##### Comprobante emitido

- **Asunto** (text): `Comprobante de pago`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: registramos el pago de su cita del {fecha}. Su comprobante de pago está disponible en el portal: {enlace}. Este comprobante no es una boleta del SII.
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: registramos el pago de su cita del jueves 12 de noviembre. Su comprobante de pago está disponible en el portal: centro-prueba.cl/portal. Este comprobante no es una boleta del SII. Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Deuda pendiente, paciente · bandeja: ejemplo

Paciente · bandeja

##### Deuda pendiente

- **Asunto** (text): `Sesión con pago pendiente`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su sesión del {fecha} a las {hora} con {profesional} tiene un saldo pendiente. Puede pagarlo en línea o en el centro; mientras tanto no podrá agendar su próxima hora. Detalle: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su sesión del jueves 12 de noviembre a las 11:00 con Profesional Uno tiene un saldo pendiente. Puede pagarlo en línea o en el centro; mientras tanto no podrá agendar su próxima hora. Detalle: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Deuda pendiente, paciente · correo: ejemplo

Paciente · correo

##### Deuda pendiente

- **Asunto** (text): `Sesión con pago pendiente`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: su sesión del {fecha} a las {hora} con {profesional} tiene un saldo pendiente. Puede pagarlo en línea o en el centro; mientras tanto no podrá agendar su próxima hora. Detalle: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: su sesión del jueves 12 de noviembre a las 11:00 con Profesional Uno tiene un saldo pendiente. Puede pagarlo en línea o en el centro; mientras tanto no podrá agendar su próxima hora. Detalle: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Deuda pendiente, equipo · bandeja: ejemplo

Equipo · bandeja

##### Deuda pendiente

- **Asunto** (text): `Sesión con pago pendiente`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: la sesión del {fecha} a las {hora} quedó con saldo pendiente. Mientras no se regularice, el paciente no puede agendar una nueva hora: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: la sesión del jueves 12 de noviembre a las 11:00 quedó con saldo pendiente. Mientras no se regularice, el paciente no puede agendar una nueva hora: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Deuda pendiente, equipo · correo: ejemplo

Equipo · correo

##### Deuda pendiente

- **Asunto** (text): `Sesión con pago pendiente`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: la sesión del {fecha} a las {hora} quedó con saldo pendiente. Mientras no se regularice, el paciente no puede agendar una nueva hora: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: la sesión del jueves 12 de noviembre a las 11:00 quedó con saldo pendiente. Mientras no se regularice, el paciente no puede agendar una nueva hora: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Consentimiento solicitado, paciente · bandeja: ejemplo

Paciente · bandeja

##### Consentimiento solicitado

- **Asunto** (text): `Solicitud de consentimiento`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: {centro} le solicita un consentimiento. Revíselo y responda en el portal: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: Centro de Prueba le solicita un consentimiento. Revíselo y responda en el portal: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Consentimiento solicitado, paciente · correo: ejemplo

Paciente · correo

##### Consentimiento solicitado

- **Asunto** (text): `Solicitud de consentimiento`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: {centro} le solicita un consentimiento. Revíselo y responda en el portal: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: Centro de Prueba le solicita un consentimiento. Revíselo y responda en el portal: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Consentimiento por vencer, paciente · bandeja: ejemplo

Paciente · bandeja

##### Consentimiento por vencer

- **Asunto** (text): `Consentimiento por vencer`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: la solicitud de consentimiento de {centro} vence pronto. Responda en el portal: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: la solicitud de consentimiento de Centro de Prueba vence pronto. Responda en el portal: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Consentimiento por vencer, paciente · correo: ejemplo

Paciente · correo

##### Consentimiento por vencer

- **Asunto** (text): `Consentimiento por vencer`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: la solicitud de consentimiento de {centro} vence pronto. Responda en el portal: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: la solicitud de consentimiento de Centro de Prueba vence pronto. Responda en el portal: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cambio de supervisor, paciente · bandeja: ejemplo

Paciente · bandeja

##### Cambio de supervisor

- **Asunto** (text): `Aviso: cambio de supervisor`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: hubo un cambio en la supervisión de su atención. Revise el aviso en el portal: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: hubo un cambio en la supervisión de su atención. Revise el aviso en el portal: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Cambio de supervisor, paciente · correo: ejemplo

Paciente · correo

##### Cambio de supervisor

- **Asunto** (text): `Aviso: cambio de supervisor`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: hubo un cambio en la supervisión de su atención. Revise el aviso en el portal: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: hubo un cambio en la supervisión de su atención. Revise el aviso en el portal: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Documento clínico, paciente · bandeja: ejemplo

Paciente · bandeja

##### Documento clínico

- **Asunto** (text): `Documento disponible`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: {profesional} emitió un documento para usted. Para descargarlo debe iniciar sesión: {enlace}
  No comparta este enlace.
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: Profesional Uno emitió un documento para usted. Para descargarlo debe iniciar sesión: centro-prueba.cl/portal No comparta este enlace.
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Documento clínico, paciente · correo: ejemplo

Paciente · correo

##### Documento clínico

- **Asunto** (text): `Documento disponible`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: {profesional} emitió un documento para usted. Para descargarlo debe iniciar sesión: {enlace}
  No comparta este enlace.
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: Profesional Uno emitió un documento para usted. Para descargarlo debe iniciar sesión: centro-prueba.cl/portal No comparta este enlace. Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Acceso clínico temporal, paciente · bandeja: ejemplo

Paciente · bandeja

##### Acceso clínico temporal

- **Asunto** (text): `Aviso: acceso temporal a su ficha`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: {profesional} tendrá acceso temporal a su ficha (reemplazo o interconsulta) para continuar su atención. Detalle en el portal: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: Profesional Uno tendrá acceso temporal a su ficha (reemplazo o interconsulta) para continuar su atención. Detalle en el portal: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Acceso clínico temporal, paciente · correo: ejemplo

Paciente · correo

##### Acceso clínico temporal

- **Asunto** (text): `Aviso: acceso temporal a su ficha`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: {profesional} tendrá acceso temporal a su ficha (reemplazo o interconsulta) para continuar su atención. Detalle en el portal: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: Profesional Uno tendrá acceso temporal a su ficha (reemplazo o interconsulta) para continuar su atención. Detalle en el portal: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Acceso clínico revocado, paciente · bandeja: ejemplo

Paciente · bandeja

##### Acceso clínico revocado

- **Asunto** (text): `Aviso: terminó un acceso temporal a su ficha`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: {profesional} ya no tiene acceso temporal a su ficha. Detalle en el portal: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: Profesional Uno ya no tiene acceso temporal a su ficha. Detalle en el portal: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Acceso clínico revocado, paciente · correo: ejemplo

Paciente · correo

##### Acceso clínico revocado

- **Asunto** (text): `Aviso: terminó un acceso temporal a su ficha`
- **Mensaje** (texto largo):

  ```
  Hola {paciente}: {profesional} ya no tiene acceso temporal a su ficha. Detalle en el portal: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola María José: Profesional Uno ya no tiene acceso temporal a su ficha. Detalle en el portal: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Acceso clínico revocado, equipo · bandeja: ejemplo

Equipo · bandeja

##### Acceso clínico revocado

- **Asunto** (text): `Tu acceso temporal a una ficha terminó`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: tu acceso clínico temporal a una ficha fue revocado antes de su fecha de término.
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: tu acceso clínico temporal a una ficha fue revocado antes de su fecha de término.
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Acceso clínico revocado, equipo · correo: ejemplo

Equipo · correo

##### Acceso clínico revocado

- **Asunto** (text): `Tu acceso temporal a una ficha terminó`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: tu acceso clínico temporal a una ficha fue revocado antes de su fecha de término.
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: tu acceso clínico temporal a una ficha fue revocado antes de su fecha de término. Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Derivación ofrecida, equipo · bandeja: ejemplo

Equipo · bandeja

##### Derivación ofrecida

- **Asunto** (text): `Nueva oferta de derivación`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: tiene una nueva oferta de derivación. Revísela en el sistema antes de que venza: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: tiene una nueva oferta de derivación. Revísela en el sistema antes de que venza: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Derivación ofrecida, equipo · correo: ejemplo

Equipo · correo

##### Derivación ofrecida

- **Asunto** (text): `Nueva oferta de derivación`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: tiene una nueva oferta de derivación. Revísela en el sistema antes de que venza: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: tiene una nueva oferta de derivación. Revísela en el sistema antes de que venza: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Derivación actualizada, equipo · bandeja: ejemplo

Equipo · bandeja

##### Derivación actualizada

- **Asunto** (text): `Cambios en una derivación`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: una derivación que usted originó cambió de estado. Detalle en el sistema: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: una derivación que usted originó cambió de estado. Detalle en el sistema: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Derivación actualizada, equipo · correo: ejemplo

Equipo · correo

##### Derivación actualizada

- **Asunto** (text): `Cambios en una derivación`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: una derivación que usted originó cambió de estado. Detalle en el sistema: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: una derivación que usted originó cambió de estado. Detalle en el sistema: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Mensaje de paciente, equipo · bandeja: ejemplo

Equipo · bandeja

##### Mensaje de paciente

- **Asunto** (text): `Nuevo mensaje de un paciente`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: tiene un nuevo mensaje de un paciente. Léalo en el sistema: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: tiene un nuevo mensaje de un paciente. Léalo en el sistema: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Mensaje de paciente, equipo · correo: ejemplo

Equipo · correo

##### Mensaje de paciente

- **Asunto** (text): `Nuevo mensaje de un paciente`
- **Mensaje** (texto largo):

  ```
  Hola {profesional}: tiene un nuevo mensaje de un paciente. Léalo en el sistema: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Hola Profesional Uno: tiene un nuevo mensaje de un paciente. Léalo en el sistema: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Mensaje interno, equipo · bandeja: ejemplo

Equipo · bandeja

##### Mensaje interno

- **Asunto** (text): `Mensaje nuevo del equipo`
- **Mensaje** (texto largo):

  ```
  Tienes un mensaje nuevo en un hilo del equipo. Revísalo en el sistema: {enlace}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Tienes un mensaje nuevo en un hilo del equipo. Revísalo en el sistema: centro-prueba.cl/portal
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

### Mensaje interno, equipo · correo: ejemplo

Equipo · correo

##### Mensaje interno

- **Asunto** (text): `Mensaje nuevo del equipo`
- **Mensaje** (texto largo):

  ```
  Tienes un mensaje nuevo en un hilo del equipo. Revísalo en el sistema: {enlace}
  
  {centro}
  ```

Pulsa un dato para agregarlo al final del texto:
- [botón] {paciente} nombre del paciente
- [botón] {profesional} nombre del profesional
- [botón] {fecha} día de la cita
- [botón] {hora} hora de la cita
- [botón] {modalidad} presencial u online
- [botón] {centro} nombre del centro
- [botón] {enlace} enlace para entrar
Así le llega Tienes un mensaje nuevo en un hilo del equipo. Revísalo en el sistema: centro-prueba.cl/portal Centro de Prueba
Enviar este aviso Desactivada, este aviso no se envía por este canal.
- [x] Enviar este aviso _(switch)_
- [botón] Restaurar ejemplo
- [botón] Guardar plantilla

---

## Roles y accesos

_Componente: `frontend/src/components/nucleo/ReglasCentro.tsx (seccion="roles")`_

#### Roles y accesos

La política general. El rol de cada persona se asigna en Equipo.

##### Jerarquía de accesos

Ningún rol administrativo ve contenido clínico.
- Cuenta madre Configuración, cobros, equipo y la vista administrativa de fichas. 2 personas
- Gestión Agenda, recepción y cobros del día a día, sin Configuración. 1 persona
- Profesional Sus pacientes, su agenda y sus fichas. Otras fichas solo por derivación o acceso temporal. 8 personas
- Practicante Con fecha de término, bajo supervisión y con consentimiento del paciente. 1 persona
- [enlace → /admin/equipo] Ver personas en Equipo

##### Opciones

Habilitar el rol de gestión Para centros con recepción o coordinación administrativa. Si se desactiva, deja de estar disponible.
- [x] Habilitar el rol de gestión _(switch)_

---

## Consentimientos y políticas

_Componente: `frontend/src/components/nucleo/HorarioPoliticasCentro.tsx (PoliticasCentro)`_

#### Consentimientos y políticas

Cada versión nueva queda registrada con quién la aceptó y cuándo.

##### Documentos para pacientes

Se aceptan de forma explícita (Ley 20.584 y Ley 21.719).

###### Consentimiento informado

Versión 1 · desde 31 de octubre de 2026 Vigente
- [botón] Ver texto
- [botón] Nueva versión

###### Política de datos personales

Versión 2 · desde 31 de octubre de 2026 · 1 anterior Vigente
- [botón] Ver texto
- [botón] Nueva versión

###### Términos de agendamiento

Versión 2 · desde 31 de octubre de 2026 · 1 anterior Vigente
- [botón] Ver texto
- [botón] Nueva versión

###### Consentimiento de atención con practicante

Versión 1 · desde 31 de octubre de 2026 Vigente
- [botón] Ver texto
- [botón] Nueva versión

###### Protocolo para pacientes

Versión 1 · desde 31 de octubre de 2026 Vigente
- [botón] Ver texto
- [botón] Nueva versión

##### Documentos del equipo

Cada integrante lo marca como leído en Mi perfil.

###### Protocolo interno del equipo

Versión 1 · desde 31 de octubre de 2026 Vigente
- [botón] Ver texto
- [botón] Nueva versión
1 de 10 integrantes lo leyeron 9 pendientes
- [botón] Ver quién falta
- [botón] Recordar a pendientes _(deshabilitado)_

##### Reglas del sistema

Vienen de la normativa: el centro no las cambia.
- Menores de 18 años Necesitan un adulto responsable registrado antes de su primera hora. Fija
- Conservación de fichas Al menos 15 años desde la última atención (Decreto 41, Ley 20.584). Nunca se borran. Fija
- Acceso a fichas ajenas Solo por derivación o acceso temporal registrado, nunca cambiando el rol. Fija

---

## Datos personales y auditoría

_Componente: `frontend/src/components/nucleo/SolicitudesDerechos.tsx + AuditoriaAccesos.tsx + ExportacionCentro.tsx`_

#### Datos personales y auditoría

Derechos de los titulares (Ley 21.719), registro de accesos y exportación.

#### Registrar una solicitud

Acceso, rectificación, cancelación, oposición, portabilidad o bloqueo de datos personales. El plazo para responder es de 30 días hábiles.
- **Derecho** (lista): **Acceso** / Rectificación / Cancelación / Oposición / Portabilidad / Bloqueo
- **Cómo llegó** (lista): **Presencial** / Correo / Portal del paciente
- **Buscar paciente** (text): _vacío_
Opcional: el titular puede no ser paciente. Escribe al menos 2 letras.
- **Paciente** (lista): **Sin paciente asociado**
- **Detalle** (texto largo):

  ```
  
  ```

Qué pide el titular. Se guarda cifrado.
- [botón] Registrar solicitud

#### Solicitudes

Ordenadas por vencimiento. Faltando 5 días hábiles o menos, el inicio muestra una alerta.
- Oposición Resuelta · Titular sin paciente asociado · Presencial · recibida el 3 de noviembre de 2026 · Prueba automatizada 1793755080198: no quiere recibir recordatorios · Respuesta: Se apagaron sus recordatorios.
- Oposición Resuelta · Titular sin paciente asociado · Presencial · recibida el 3 de noviembre de 2026 · Prueba automatizada 1793755331787: no quiere recibir recordatorios · Respuesta: Se apagaron sus recordatorios.
Acceso Recibida Vence el 16 de diciembre de 2026 · 30 días hábiles
Paciente Prueba · Formulario público · recibida el 3 de noviembre de 2026
- **Respuesta al titular** (texto largo):

  ```
  
  ```

Obligatoria para resolver o rechazar. Se guarda cifrada.
- [botón] Bloquear tratamiento
- [botón] Preparar copia de datos
- [botón] Marcar en curso
- [botón] Rechazar
- [botón] Resolver
Acceso En curso Vence el 16 de diciembre de 2026 · 30 días hábiles
Paciente Prueba · Presencial · recibida el 3 de noviembre de 2026
Copia automatizada 1793755340096
Copia de datos: Esperando la parte clínica del tratante
- **Respuesta al titular** (texto largo):

  ```
  
  ```

Obligatoria para resolver o rechazar. Se guarda cifrada.
- [botón] Bloquear tratamiento
- [botón] Rechazar
- [botón] Resolver
- Oposición Resuelta · Titular sin paciente asociado · Presencial · recibida el 3 de noviembre de 2026 · Prueba automatizada 1793759009867: no quiere recibir recordatorios · Respuesta: Se apagaron sus recordatorios.
Acceso Recibida Vence el 16 de diciembre de 2026 · 30 días hábiles
Paciente Prueba · Formulario público · recibida el 3 de noviembre de 2026
- **Respuesta al titular** (texto largo):

  ```
  
  ```

Obligatoria para resolver o rechazar. Se guarda cifrada.
- [botón] Bloquear tratamiento
- [botón] Preparar copia de datos
- [botón] Marcar en curso
- [botón] Rechazar
- [botón] Resolver
Acceso En curso Vence el 16 de diciembre de 2026 · 30 días hábiles
Paciente Prueba · Presencial · recibida el 3 de noviembre de 2026
Copia automatizada 1793759017166
Copia de datos: Esperando la parte clínica del tratante
- **Respuesta al titular** (texto largo):

  ```
  
  ```

Obligatoria para resolver o rechazar. Se guarda cifrada.
- [botón] Bloquear tratamiento
- [botón] Rechazar
- [botón] Resolver
- Oposición Resuelta · Titular sin paciente asociado · Presencial · recibida el 3 de noviembre de 2026 · Prueba automatizada 1793759231276: no quiere recibir recordatorios · Respuesta: Se apagaron sus recordatorios.

#### Auditoría de accesos

Quién vio, editó, descargó o exportó datos del centro, cuándo y con qué rol activo. Las ediciones muestran los campos que cambiaron, nunca los valores.
Últimos 7 días 71 lecturas · 225 ediciones · 2 exportaciones (primeros 300 registros)
- [botón] Abrir auditoría
Último acceso a una ficha Admin Centro Prueba · 03-11-2026, 11:27 p. m. · Lectura de solicitudes_derechos

#### Exportación completa del centro

Todos los datos del centro (pacientes, fichas, agenda, equipo, cobros, políticas y auditoría) en un archivo cifrado, para conservarlos o llevarlos a otro sistema.
Guarda la clave en un lugar seguro
Vinculos no guarda la clave ni el archivo: sin la clave nadie puede abrirlo, tampoco Vinculos. El archivo incluye las fichas clínicas: entrégalo solo a quien responde legalmente por ellas. La exportación queda registrada en la auditoría.
- **Clave** (password): _vacío_
Al menos 16 caracteres. Una frase larga es más fácil de recordar.
- **Repite la clave** (password): _vacío_
- [botón] Generar y descargar

---

## Módulos, contrato y soporte

_Componente: `frontend/src/components/nucleo/ReglasCentro.tsx (seccion="modulos") + ContratoCentro.tsx + SoporteCentro.tsx`_

#### Módulos, contrato y soporte

Tu relación con Vinculos: lo contratado, lo aceptado y lo autorizado.

##### Módulos contratados

6 de 7 activos
Los activa Vinculos según lo contratado. Para sumar uno, escríbenos: la activación no es automática.
- Página pública del centro Sitio con equipo, servicios y contacto Activo
- Fichas y Pacientes Fichas clínicas con acceso restringido por profesional Activo
- Agenda y Espacios Reservas por box y disponibilidad del equipo Activo
- Equipo Perfiles, especialidades y roles del centro Activo
- Match Terapéutico Cuestionario público que recomienda profesionales Activo
- Cobros Pagos, comprobantes y liquidaciones por profesional Activo
Avisos por WhatsApp Los pacientes pueden aceptar avisos de sus horas por WhatsApp No contratado
- [botón] Solicitar _(deshabilitado)_

#### Contrato con Vinculos

Términos de servicio y anexo de tratamiento de datos entre el centro y Vinculos. Los publica Vinculos; el centro los acepta y queda registrado quién y cuándo.
Términos de servicio de Vinculos Versión 1 Aceptada
Vigente desde el 31 de octubre de 2026. Aceptó Admin Centro Prueba el 31-10-2026, 5:14 p. m..
- [botón] Leer
Anexo de tratamiento de datos (DPA) Versión 1 Aceptada
Vigente desde el 31 de octubre de 2026. Aceptó Admin Centro Prueba el 31-10-2026, 5:14 p. m..
- [botón] Leer

#### Soporte de Vinculos

Autoriza al equipo de Vinculos a revisar el estado del sistema por un plazo acotado.
El soporte nunca ve datos de pacientes ni del equipo
Solo ejecuta diagnósticos con conteos y estados (por ejemplo, cuántos correos fallaron). No ve nombres, contactos, RUT ni fichas. Cada diagnóstico queda registrado abajo.
- **Motivo** (texto largo):

  ```
  
  ```

Lo que pediste al soporte. Queda registrado.
- **Alcance** (lista): **Diagnóstico** / Diagnóstico y configuración
Conteos y estado de envíos, sin personas.
- **Plazo (horas)** (text): `24`
De 1 a 72.
- [botón] Autorizar soporte

#### Autorizaciones

Las últimas 50, de la más reciente a la más antigua.

| Estado | Motivo | Alcance | Vigencia | Usos |  |
| --- | --- | --- | --- | --- | --- |
| Revocada | Prueba automatizada de soporte Autorizó Admin Centro Prueba | Diagnóstico | 03-11-2026, 11:27 p. m. hasta 03-11-2026, 11:27 p. m. | 0 |  |
| Revocada | Prueba automatizada de soporte Autorizó Admin Centro Prueba | Diagnóstico | 03-11-2026, 11:23 p. m. hasta 03-11-2026, 11:23 p. m. | 0 |  |
| Revocada | Prueba automatizada de soporte Autorizó Admin Centro Prueba | Diagnóstico | 03-11-2026, 10:22 p. m. hasta 03-11-2026, 10:22 p. m. | 0 |  |
| Revocada | Prueba automatizada de soporte Autorizó Admin Centro Prueba | Diagnóstico | 03-11-2026, 10:17 p. m. hasta 03-11-2026, 10:17 p. m. | 0 |  |

#### Registro del soporte

Cada diagnóstico que ejecutó el soporte, con la autorización que lo cubrió.
El soporte no ha ejecutado diagnósticos
