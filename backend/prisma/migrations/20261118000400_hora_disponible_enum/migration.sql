-- 2026-11-18 (5): aviso al paciente cuando su hora original vuelve a estar disponible. Migracion propia: un ADD VALUE
-- no se usa en la misma transaccion.
ALTER TYPE "tipo_notificacion" ADD VALUE 'CITA_HORA_DISPONIBLE';
