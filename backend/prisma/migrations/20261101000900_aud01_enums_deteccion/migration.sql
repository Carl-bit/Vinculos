-- =============================================================================
-- AUD-01 (E2.4): valores de enum nuevos en migracion aparte. Alertas de
-- deteccion: lecturas masivas de fichas e intentos de ingreso repetidos.
-- =============================================================================
ALTER TYPE "tipo_alerta" ADD VALUE 'ACCESO_ANOMALO';
ALTER TYPE "tipo_alerta" ADD VALUE 'LOGIN_FALLIDO_REPETIDO';
