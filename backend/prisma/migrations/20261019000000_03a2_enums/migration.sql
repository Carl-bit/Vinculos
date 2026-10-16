-- =============================================================================
-- 03a-2: valores de enum nuevos. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 02i y 03a-1).
-- =============================================================================

-- Posible paciente duplicado (RUT o correo de otro paciente): alerta y aviso a administracion.
ALTER TYPE "tipo_alerta" ADD VALUE 'POSIBLE_DUPLICADO';
ALTER TYPE "tipo_notificacion" ADD VALUE 'POSIBLE_DUPLICADO';

-- Mensaje nuevo en un hilo interno del equipo (aviso sin contenido).
ALTER TYPE "tipo_notificacion" ADD VALUE 'MENSAJE_INTERNO';
