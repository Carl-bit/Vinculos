# Propuesta 02h: definicion de "pago pendiente" y cambios de BD

Estado: **propuesta, esperando confirmacion** (el prompt 02h pide detenerse
aqui). Nada de esto esta implementado.

## Hoy

- `pagos(cita_id, monto, medio_pago, fecha)`: varios pagos por cita posibles,
  sin estado ni anulacion. `boletas` 1:1 con un pago (copia del emisor
  cifrada). `arriendos(profesional, monto, porcentaje_comision)`.
- La cita no guarda cuanto se cobra: la tarifa vive en `tarifas` (historial).
- "Pago pendiente" provisorio (solo en `datos_pago_profesional`): cita
  CONFIRMADA **sin ningun pago**. Un abono parcial la deja "pagada".

## Definicion propuesta

**Monto de la cita**: se fija al confirmar (como el margen de traslado) con
la tarifa vigente mas especifica del profesional: tipo de atencion del
paciente + modalidad, tipo, modalidad, general. Queda en `citas.monto`.
Cambiarlo despues (descuento, exencion) solo ADMIN/GESTION, con motivo y
registro.

**Saldo** = `citas.monto` - suma de pagos no anulados.

**Estado de pago** (derivado, no columna):

| Estado | Condicion |
|---|---|
| SIN_COBRO | monto nulo o 0, o cita CANCELADA / POR_REPROGRAMAR |
| PENDIENTE | CONFIRMADA, saldo = monto |
| PARCIAL | 0 < pagado < monto (abonos) |
| PAGADA | saldo = 0 |

**Pago pendiente** = estado PENDIENTE o PARCIAL (saldo > 0). Reemplaza la
definicion provisoria, tambien en `datos_pago_profesional`.

## Cambios de BD (una migracion)

1. `citas.monto int NULL` (CHECK >= 0) + trigger `citas_monto_fijado` al
   pasar a CONFIRMADA (tarifa aplicable). Tabla `ajustes_monto_cita` (A,
   append-only: monto anterior, nuevo, motivo, quien) + funcion
   `ajustar_monto_cita(cita, monto, motivo)` (ADMIN/GESTION).
2. `pagos`: `registrado_por_id`, `origen` (MANUAL | PASARELA), `estado`
   (REGISTRADO | ANULADO), `anulado_en`, `anulado_por_id`, `motivo_anulacion`.
   CHECK `monto > 0`. Sin UPDATE/DELETE directo: `anular_pago(pago, motivo)`.
   Nunca se borra (respaldo tributario).
3. `registrar_pago(cita, monto, medio)` (SECURITY DEFINER): rechaza montos
   que superen el saldo (23514) y citas sin cobro. Con modelo CENTRO
   registran ADMIN/GESTION; con cobro directo (DIRECTO o MIXTO adherido)
   tambien el profesional de la cita.
4. `estado_pago_citas(desde, hasta)` (funcion C): cita, monto, pagado,
   saldo, estado; por rol (ADMIN/GESTION todo; profesional las suyas;
   paciente las suyas).
5. `intentos_pago` (A) para la pasarela simulada: cita, monto, estado
   (PENDIENTE | APROBADO | RECHAZADO), referencia del proveedor; al aprobar
   crea el pago (origen PASARELA) en la misma transaccion.
6. Redefinir `datos_pago_profesional`: saldo > 0 en vez de "sin pagos".
7. Boletas: se mantiene 1 boleta por pago (cada abono emite la suya).

## Preguntas antes de construir

1. ¿Una cancelacion tardia o inasistencia genera cobro? (Propuesta: no por
   ahora; CANCELADA = SIN_COBRO.)
2. ¿El monto se fija al confirmar y solo cambia con ajuste auditado? (Propuesta: si.)
3. ¿Sobrepago: se rechaza o queda saldo a favor? (Propuesta: se rechaza.)
4. ¿Boleta por cada abono o una al completar el pago? (Propuesta: por abono.)
5. Liquidacion al profesional (modelo CENTRO) y cobro de arriendo/comision
   (modelo DIRECTO): ¿entran en 02h o despues? (Propuesta: despues; 02h solo
   registra pagos, saldos y arriendos.)
