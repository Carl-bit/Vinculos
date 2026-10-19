-- =============================================================================
-- 03b-5: valor de enum nuevo. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 02i, 03a y 03b).
-- =============================================================================

-- Consentimiento de atencion con practicante supervisado, versionado como las
-- demas politicas (lo publica ADMIN en Configuracion).
ALTER TYPE "tipo_politica" ADD VALUE 'CONSENTIMIENTO_PRACTICANTE';
