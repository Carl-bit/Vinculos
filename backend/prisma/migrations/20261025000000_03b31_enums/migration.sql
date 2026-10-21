-- =============================================================================
-- 03b-3.1: valores de enum nuevos. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 02i, 03a y 03b).
-- =============================================================================

-- Cita a la espera del pago (transferencia por validar o pasarela en curso) y
-- cita cuyo plazo de pago vencio (la hora vuelve a quedar libre).
ALTER TYPE "estado_cita" ADD VALUE 'PENDIENTE_PAGO';
ALTER TYPE "estado_cita" ADD VALUE 'LIBERADA';

-- Avisos del flujo de pago. HORA_LIBERADA (03a, sin uso desde que se retiro
-- la lista de espera) vuelve a usarse: hora liberada por vencimiento del pago.
ALTER TYPE "tipo_notificacion" ADD VALUE 'INSTRUCCIONES_TRANSFERENCIA';
ALTER TYPE "tipo_notificacion" ADD VALUE 'COMPROBANTE_RECIBIDO';
ALTER TYPE "tipo_notificacion" ADD VALUE 'PAGO_VALIDADO';
ALTER TYPE "tipo_notificacion" ADD VALUE 'PAGO_RECHAZADO';

-- Pago confirmado por la pasarela (simulada en el centro de demostracion).
ALTER TYPE "medio_pago" ADD VALUE 'PASARELA';
ALTER TYPE "origen_pago" ADD VALUE 'PASARELA';
