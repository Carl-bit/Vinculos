# Retencion de datos

Del profesional no se retiene nada como persona; solo sobrevive lo contenido
en documentos de retencion legal (ficha clinica, documentos tributarios).

## Cuentas: una cuenta = un periodo de trabajo

- Aplica a todas las cuentas de equipo: ADMIN, GESTION, PROFESIONAL y
  PRACTICANTE (GESTION sigue el mismo flujo que PROFESIONAL).
- **Gracia**: una cuenta desactivada sin baja (revocacion, expiracion o
  desactivacion manual) se puede reactivar sin perder datos durante
  `configuracion_centro.dias_gracia_cierre` (30 dias por defecto), contados
  desde `usuarios.desactivado_en`.
- **Vaciado irreversible** (cierre) solo si hay baja explicita y llego su
  fecha efectiva, o si la cuenta lleva inactiva sin baja mas que la gracia.
- Cerrada, no vuelve: quien regresa (incluido un practicante que vuelve como
  PROFESIONAL) recibe una cuenta nueva, que no hereda nada (ni pacientes, ni
  derivaciones, ni supervisiones, ni historial).
- ADMIN: solo otro ADMIN inicia su baja, nunca la propia, y nunca se
  desactiva al ultimo ADMIN activo.

## Cierre de cuenta (procesar_bajas)

Cuando `procesar_bajas()` cierra una cuenta:

| Se borra / vacia | Se conserva |
|---|---|
| `usuarios.nombre`, `email` (queda libre para otra cuenta), `password_hash`, `telefono` | `usuarios.id`, `rol`, `created_at`, `cerrada_en`, `fecha_expiracion_acceso` |
| Perfil (`profesionales`): nombre publico, bio, foto, enfoques, cobro | Bitacora de accesos (`historial_accesos_practicante`) y bajas |
| Trayectoria (`profesional_trayectoria`) | Supervisiones (quien supervisaba a quien y cuando) |
| Datos privados (RUT, datos bancarios) | Evoluciones con su **copia de autoria cifrada** (nombre, RUT, registro al momento de escribir) |
| Tarifas, disponibilidad, tipos de atencion | Boletas con los **datos del emisor cifrados** |
| | Derivaciones, citas y auditoria (`accesos_ficha`) |

Una cuenta cerrada no se modifica mas (trigger, 23001).

## Pacientes

Los registros de pacientes no se tocan al cerrar la cuenta de un
profesional. La ficha clinica (`fichas_clinicas` + `evoluciones`) nunca se
borra automaticamente.

**15 años es el minimo legal (Decreto 41, Ley 20.584), no una fecha de
borrado.** No hay purga automatica:

- `fichas_sobre_retencion()` (solo ADMIN) lista las fichas cuya ultima
  atencion (ultima evolucion o cita confirmada ocurrida) supera 15 años, con
  su ultima revision. Cada consulta queda en `consultas_retencion` y cada
  ficha listada en `accesos_ficha` (RETENCION).
- `revisiones_retencion` (append-only, solo ADMIN, motivo obligatorio)
  registra CONSERVAR o PURGAR. PURGAR solo se acepta sobre fichas que superan
  los 15 años y **solo registra la decision**: la purga real sigue siendo
  manual y fuera del alcance del sistema.

## Cobros y documentos (02h)

- `pagos` no se borra ni se modifica: un error se **anula** con motivo
  (`anular_pago`) y queda el registro. `boletas`, `resoluciones_cita` y las
  liquidaciones emitidas tampoco cambian (respaldo tributario). Un traslado de
  pagos entre citas anula el original y crea uno nuevo que lo referencia.
- `documentos_clinicos`, `envios_documento` y `descargas_documento` son
  append-only: forman parte del registro clinico del paciente y siguen su
  retencion (minimo 15 años).

## Mensajeria y adjuntos (02i)

- `adjuntos_ficha` es append-only y sigue la retencion de la ficha (minimo
  15 años).
- `notificaciones` (la bandeja es el registro oficial de lo que se aviso) y
  `recordatorios_cita` son append-only: solo avanza el envio o se registra la
  respuesta. Sin purga automatica: se define junto con la de la ficha.

## Plantillas clinicas y mensajeria interna (03a-2)

- `ingresos_ficha` (ficha de ingreso) y los `valores` de plantilla en
  `evoluciones` son parte de la ficha: append-only y retencion minima de 15
  años desde la ultima atencion (como la ficha).
- `plantillas_clinicas`: nunca se borran (una version usada por un registro
  debe poder mostrarse mientras dure la retencion); se desactivan.
- `mensajes_internos`: la mensajeria no es el expediente; toda decision
  clinica se registra en una evolucion. Se conservan
  `configuracion_centro.retencion_mensajes_dias` (default 365, de 30 a 3650) y
  el job `purgar_mensajes_internos` (diario, 03:30) borra los mas antiguos y
  los hilos que quedan vacios. Un mensaje retirado conserva solo la marca
  (sin contenido).
- Cuenta cerrada de un participante: sus mensajes se conservan hasta la
  purga; su nombre se muestra como "Ex integrante del equipo".
- `correos_cuenta_pendientes`: minimizacion; se borra al enviarse, al quinto
  intento fallido o al vencer el enlace.

## Llaves

Las versiones de llaves que cifraron datos tampoco se destruyen mientras
esos datos existan (`cifrado.md`, `runbooks_llaves.md`).
