-- =============================================================================
-- AUD-01 (E2.3): valores de enum nuevos en migracion aparte (ADD VALUE no se
-- usa en la misma transaccion). Alerta interna de solicitud de derechos por
-- vencer.
-- =============================================================================
ALTER TYPE "tipo_alerta" ADD VALUE 'SOLICITUD_DERECHO_POR_VENCER';
