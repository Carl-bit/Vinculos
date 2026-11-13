-- =============================================================================
-- AUD-01 (E2.2): valores de enum nuevos. Migracion aparte: un valor agregado
-- con ADD VALUE no se puede usar en la misma transaccion (como 03b-4.2).
-- Terminos de servicio y anexo de tratamiento de datos (DPA) entre el centro
-- y Vinculos, versionados por silo como las demas politicas.
-- =============================================================================
ALTER TYPE "tipo_politica" ADD VALUE 'TERMINOS_SERVICIO';
ALTER TYPE "tipo_politica" ADD VALUE 'DPA';
