-- =============================================================================
-- 03b-3.4: valores de enum nuevos. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 03b-3.1/3.2/3.3).
-- =============================================================================

-- Enlace de pago de una cita para quien no tiene cuenta (correos de pago
-- pendiente y de deuda). Se usa varias veces hasta vencer: solo autoriza
-- pagar ESA cita.
ALTER TYPE "tipo_token_correo" ADD VALUE 'PAGO_CITA';
