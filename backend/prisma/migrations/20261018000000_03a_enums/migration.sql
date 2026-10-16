-- =============================================================================
-- 03a-1: valores de enum nuevos. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 02i).
-- =============================================================================

-- D-4: cuenta del adulto responsable de pacientes menores (exclusiva).
ALTER TYPE "rol" ADD VALUE 'RESPONSABLE';

-- C-15: cita de un paciente nuevo que el profesional debe aprobar (retiene el horario).
ALTER TYPE "estado_cita" ADD VALUE 'SOLICITADA';

-- D-7: pago con bono FONASA o convenio.
ALTER TYPE "medio_pago" ADD VALUE 'CONVENIO';

-- Avisos nuevos: hora liberada (lista de espera), acceso clinico temporal
-- (aviso legal al paciente), solicitud por aprobar y cierre de ficha requerido.
ALTER TYPE "tipo_notificacion" ADD VALUE 'HORA_LIBERADA';
ALTER TYPE "tipo_notificacion" ADD VALUE 'ACCESO_CLINICO_TEMPORAL';
ALTER TYPE "tipo_notificacion" ADD VALUE 'SOLICITUD_HORA';
ALTER TYPE "tipo_notificacion" ADD VALUE 'CIERRE_REQUERIDO';

-- C-8: una baja cumplida no se procesa mientras el profesional tenga borradores.
ALTER TYPE "tipo_alerta" ADD VALUE 'BAJA_CON_BORRADORES';
