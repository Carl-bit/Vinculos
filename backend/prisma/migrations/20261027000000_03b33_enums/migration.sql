-- =============================================================================
-- 03b-3.3: valores de enum nuevos. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 03b-3.1/3.2).
-- =============================================================================

-- Sesion ya realizada con saldo pendiente: aviso al paciente (bandeja y correo,
-- tambien sin cuenta si tiene correo) y al profesional de la cita.
ALTER TYPE "tipo_notificacion" ADD VALUE 'DEUDA_PENDIENTE';
