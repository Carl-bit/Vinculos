-- =============================================================================
-- 03b-4.2: valores de enum nuevos. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 03b-3.x y 03b-4.1).
-- =============================================================================

-- Protocolo del centro (pendiente 5), versionado como las demas politicas:
-- uno interno para el equipo (lectura con acuse) y uno para el paciente
-- (acuse en el portal, en aceptaciones_politica).
ALTER TYPE "tipo_politica" ADD VALUE 'PROTOCOLO_EQUIPO';
ALTER TYPE "tipo_politica" ADD VALUE 'PROTOCOLO_PACIENTE';
