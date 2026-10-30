# Exportaciones: propuesta de contenido (AUD-01 E3.0)

Decision D7: formato JSON para sistemas y PDF para lectura humana; el
contenido se define aqui antes de implementar. Cubre ARCOP-02 (acceso y
portabilidad de un paciente) y LEG-04 (salida de un centro).

Dos reglas ya vigentes condicionan el diseño:

- **CENS-S6**: administracion (ADMIN, GESTION) nunca ve notas clinicas.
- **D5**: el operador de Vinculos nunca ve datos personales ni clinicos.

Por eso ninguna exportacion se arma "a mano" ni queda legible para quien no
debe verla: la genera la API dentro del silo, se registra como EXPORTACION y
se entrega cifrada o por un canal que solo abre el destinatario.

---

## 1. Exportacion por paciente (E3.1)

### Contenido

| Bloque | Incluye | Formato |
|---|---|---|
| Datos personales | nombre, RUT, fecha de nacimiento, correo, telefono, contacto de emergencia, adultos responsables (sin datos de otras personas mas alla del vinculo) | JSON + PDF |
| Atencion | citas (fecha, modalidad, profesional, estado), pagos, comprobantes, documentos tributarios registrados | JSON + PDF |
| Consentimientos | politicas aceptadas (tipo, version, fecha), consentimientos de practicante, preferencias de aviso y WhatsApp | JSON + PDF |
| Documentos emitidos | los PDF ya emitidos al paciente | PDF (tal cual) |
| Ficha clinica | ficha de ingreso y evoluciones (con autoria), adjuntos | JSON + PDF + adjuntos |
| Solicitudes de derechos | las del propio titular | JSON |

No incluye: auditoria interna (`accesos_ficha`), mensajeria interna del
equipo ni comentarios de supervision (no son del titular).

### Quien la genera y como se entrega (propuesta)

- **Parte administrativa** (todo menos la ficha clinica): la genera ADMIN
  desde la solicitud de ACCESO o PORTABILIDAD.
- **Parte clinica**: la genera el profesional tratante (o el sistema por
  encargo del tratante). ADMIN no la ve (CENS-S6).
- **Entrega**: un enlace de un solo uso al correo registrado del paciente,
  que vence en 72 horas y exige iniciar sesion si el paciente tiene cuenta,
  igual que hoy los documentos clinicos. Sin cuenta: el enlace mas un codigo
  que llega en un segundo correo.
- Cada generacion y cada descarga quedan en `accesos_ficha` (EXPORTACION y
  DESCARGA). El archivo se guarda cifrado y se borra al vencer el enlace.

## 2. Exportacion del centro (E3.2, salida del servicio)

### Contenido

Todo lo del punto 1 por cada paciente, mas:

- equipo (cuentas, roles, perfiles, trayectoria, supervisiones, bajas);
- agenda (boxes, bloques, citas de todo el centro);
- cobros (pagos, comprobantes, documentos tributarios, liquidaciones, arriendos);
- configuracion, politicas versionadas y sus aceptaciones;
- auditoria (`accesos_ficha`, `registro_exportaciones`, `registro_soporte`,
  solicitudes de derechos): el centro es el responsable y debe conservarla.

Formato: un ZIP con JSON por entidad, con esquema versionado
(`schema_version`) y un indice, mas un PDF legible por ficha.

### Quien la genera y como se entrega (propuesta)

- La pide el ADMIN del centro desde el panel (no el operador).
- Antes de generarla, el ADMIN entrega una **clave de exportacion** (frase o
  llave publica) que no queda guardada en Vinculos. La API arma el ZIP
  dentro del silo y lo cifra con esa clave. El operador solo transfiere un
  archivo que no puede abrir (D5).
- Queda en `registro_exportaciones` (quien, cuando, tamaño y huella del
  archivo) y se entrega con un acta de recepcion.
- Despues: runbook de baja del silo (plazo acordado, borrado de BD,
  volumenes, respaldos y llaves, y acta de eliminacion).

## 3. Decisiones que faltan

| # | Pregunta | Recomendacion |
|---|---|---|
| X1 | Ficha clinica en la exportacion del paciente: ¿la genera el tratante (ADMIN nunca la ve) o se excluye y se sigue entregando por "copia de ficha" como hoy? | La genera el tratante (respeta CENS-S6 y cumple el acceso a la ficha) |
| X2 | Entrega al paciente sin cuenta: ¿enlace mas codigo por segundo correo, o solo retiro presencial? | Enlace mas codigo |
| X3 | Exportacion del centro: ¿cifrada con una clave que da el ADMIN (el operador nunca la abre) o la genera el operador con sus credenciales? | Clave del ADMIN (D5) |
| X4 | Formato: ¿JSON mas PDF (D7) o tambien CSV para planillas? | JSON mas PDF; CSV solo si un centro lo pide |

## Decisiones (2026-10-28) e implementacion

X1: la parte clinica la genera el tratante. X2: sin cuenta, enlace mas
codigo. X3: la del centro, cifrada con la clave del ADMIN. X4: JSON mas PDF.

| Pieza | Donde |
|---|---|
| Lectura para exportar | `exportar_datos_paciente(paciente, parte)`, `exportar_tabla_centro(tabla)`, `tablas_exportacion_centro()` (migracion `20261101001200_aud01_exportaciones`) |
| Exportacion por paciente | `exportaciones_paciente` (A, datos cifrados); API `POST derechos/solicitudes/:id/exportacion` (ADMIN), `GET exportaciones/pendientes` y `POST exportaciones/:id/clinica` (tratante), `POST portal/exportacion/descarga` (con cuenta), `POST publico/exportacion/descarga` (sin cuenta, codigo) |
| Pantallas | Configuracion > Solicitudes de datos ("Preparar copia de datos"); aviso en la ficha y en el inicio del tratante; `/exportacion` y `/portal/exportacion` para el paciente |
| Exportacion del centro | `POST exportacion-centro` (ADMIN, clave); Configuracion > Exportar datos; `infra/scripts/exportacion/descifrar.mjs` |
| Vencidas | job `purgar_exportaciones_vencidas` (04:15): borra los datos, queda el registro |
| Baja del centro | `docs/cumplimiento/baja_centro.md` |

### Paciente menor de edad (decision del 2026-10-28)

| Edad del paciente | Recibe la copia |
|---|---|
| Menor de 14 | Solo sus adultos responsables |
| 14 a 17 | El paciente y sus adultos responsables |
| 18 o mas (o sin fecha de nacimiento) | Solo el paciente |

- Cada destinatario recibe su propio enlace (`destinatarios_exportacion`).
  Con cuenta (la del paciente o la RESPONSABLE del adulto), la descarga exige
  esa sesion; sin cuenta, el codigo del segundo correo.
- La edad se calcula en la BD al enviar (`destinatarios_por_edad`, hora de
  Chile). Un destinatario sin correo registrado se omite; si nadie tiene
  correo, el envio falla y la copia se entrega en persona.
- Configuracion > Solicitudes de datos muestra a quien se envio ("el
  paciente y 2 adultos responsables"), sin correos.
