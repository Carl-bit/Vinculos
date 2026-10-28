# Incidentes de seguridad: plan de contingencia (AUD-01, BRE-01, BRE-02)

Estandar propio de Vinculos como **Encargado**. Define en cuanto tiempo y
con que contenido minimo se avisa al centro (**Responsable**). La
notificacion a la Agencia de Proteccion de Datos Personales y a los
titulares la decide y la hace el centro; Vinculos entrega la informacion y
el apoyo para que pueda hacerlo. Los plazos de este documento son internos
y no reemplazan los que fije la ley o la Agencia: si una norma exige un
plazo menor, manda la norma.

## 1. Que es un incidente

Cualquier evento que comprometa, o pueda comprometer, la confidencialidad,
la integridad o la disponibilidad de los datos de un silo. Ejemplos:

- Acceso de alguien no autorizado a la BD, a la API con sesion ajena, a un
  respaldo o a una llave (KEK, partes de recuperacion).
- Lectura o exportacion anomala de fichas (alerta de `accesos_ficha`).
- Fallo de canario de cifrado (`FALLO_CANARIO`), alteracion de un registro
  append-only, perdida de un respaldo.
- Correo enviado al destinatario equivocado con datos de un paciente.
- Caida prolongada del silo (disponibilidad).

## 2. Severidad

| Nivel | Criterio | Ejemplo |
|---|---|---|
| S1 critico | Datos clinicos o personales de pacientes expuestos, extraidos o alterados, confirmado o muy probable; o llave comprometida | Respaldo filtrado junto con la KEK; acceso a evoluciones por un tercero |
| S2 alto | Exposicion acotada o no confirmada de datos personales; o caida del silo mayor al RTO | Correo con datos de un paciente a otra persona; credencial de un integrante comprometida |
| S3 medio | Intento sin exito, vulnerabilidad sin explotar, anomalia sin datos expuestos | Alerta de lecturas masivas que resulta legitima; dependencia critica sin explotar |

## 3. Plazos (desde que Vinculos detecta o recibe el aviso)

| Paso | S1 | S2 | S3 |
|---|---|---|---|
| Contencion inicial (cortar acceso, revocar credenciales, aislar el silo) | inmediata, maximo 1 h | maximo 4 h | maximo 2 dias habiles |
| **Aviso inicial al centro** | **maximo 24 h** | **maximo 48 h** | en el informe mensual |
| Actualizaciones al centro | cada 24 h hasta cerrar | cada 48 h hasta cerrar | — |
| Informe final | maximo 10 dias habiles | maximo 10 dias habiles | maximo 20 dias habiles |

El aviso inicial no espera a tener toda la informacion: se manda con lo que
se sabe y se completa en las actualizaciones.

## 4. Contenido minimo del aviso al centro

1. Identificador del incidente, fecha y hora de deteccion y de inicio
   estimado (America/Santiago).
2. Severidad y descripcion de lo ocurrido en lenguaje claro.
3. Datos afectados: categorias (identificacion, contacto, clinico,
   financiero), si estaban cifrados y si la llave tambien se vio
   comprometida.
4. Titulares afectados: numero aproximado y si hay menores de edad. Sin
   listar nombres en el aviso; la lista va por canal seguro si el centro la
   pide.
5. Consecuencias probables para los titulares.
6. Medidas tomadas y medidas propuestas (incluidas las que debe tomar el
   centro, p. ej. avisar a un profesional que cambie su contraseña).
7. Contacto del responsable del incidente en Vinculos.
8. Lo que falta saber y cuando se actualizara.

Canal: correo al ADMIN del centro y al contacto de cumplimiento acordado en
el DPA, mas llamada telefonica en S1. Nunca se envian datos de pacientes en
el cuerpo del correo.

## 5. Registro de incidentes

Lo lleva Vinculos fuera del silo (es informacion del proveedor y puede
abarcar varios centros). Una fila por incidente, incluidos los S3 y los
descartados:

| Campo | Contenido |
|---|---|
| id | `INC-AAAA-NNN` |
| deteccion | fecha y hora, como se detecto (alerta, reporte, auditoria) |
| severidad | S1 / S2 / S3, y si cambio durante la gestion |
| silos afectados | slug de cada silo (nunca datos de pacientes) |
| alcance | sistemas, categorias de datos, cifrado, numero de titulares |
| medidas | contencion, correccion, prevencion |
| avisos | a que centro, fecha y hora de cada aviso y actualizacion |
| decision del centro | si notifico a la Agencia y a los titulares (lo informa el centro) |
| cierre | fecha, causa raiz, acciones pendientes |

El registro se conserva al menos 5 años (plazo interno; confirmar con
asesoria).

## 6. Despues del incidente

- Causa raiz y acciones preventivas con responsable y fecha.
- Si hubo llave comprometida: runbook de compromiso
  (`docs/seguridad/runbooks_llaves.md`).
- Revisar si el estandar de este documento necesita cambios.

## Pendiente de validar

- Que los plazos de la seccion 3 sean compatibles con lo que exija la Ley
  21.719 y la Agencia al Responsable (el centro debe poder cumplir su plazo
  con nuestro aviso).
- Plazo de conservacion del registro.
