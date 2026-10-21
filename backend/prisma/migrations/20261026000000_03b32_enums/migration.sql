-- =============================================================================
-- 03b-3.2: valores de enum nuevos. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 03b-3.1).
-- =============================================================================

-- Hora retenida de quien pide hora sin cuenta: fila de citas SIN paciente
-- (el paciente nace con el pago validado o, si paga en el centro, con el
-- correo verificado). Participa del EXCLUDE como cualquier hora ocupada.
ALTER TYPE "estado_cita" ADD VALUE 'RETENIDA';

-- Hora agendada por el equipo pendiente de pago: aviso al agendarla y
-- recordatorios 48 h y 24 h antes de la sesion.
ALTER TYPE "tipo_notificacion" ADD VALUE 'PAGO_PENDIENTE';
