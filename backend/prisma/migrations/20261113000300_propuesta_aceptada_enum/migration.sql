-- Aviso al profesional cuando el paciente elige una de sus horas propuestas
-- (correcciones 2026-11-11, pendiente del punto 7). Migracion propia: un ADD
-- VALUE no se usa en la misma transaccion.
ALTER TYPE "tipo_notificacion" ADD VALUE 'PROPUESTA_ACEPTADA';
