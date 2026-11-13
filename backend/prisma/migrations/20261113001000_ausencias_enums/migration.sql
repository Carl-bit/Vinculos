-- Punto 9 (correcciones 2026-11-10/11): ausencias del profesional. Migracion
-- propia: un ADD VALUE no se usa en la misma transaccion.
ALTER TYPE "tipo_notificacion" ADD VALUE 'CITA_AUSENCIA_PROFESIONAL';
ALTER TYPE "tipo_alerta" ADD VALUE 'ATENCION_TEMPORAL';
