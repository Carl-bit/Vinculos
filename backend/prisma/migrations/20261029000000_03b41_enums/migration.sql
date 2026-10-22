-- =============================================================================
-- 03b-4.1: valores de enum nuevos. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 03b-3.x).
-- =============================================================================

-- Preferencia de pago por sesion en el match: no puntua ni filtra, ordena los
-- resultados por tramos de precio (la opcion lleva el tope en CLP).
ALTER TYPE "criterio_match" ADD VALUE 'PRESUPUESTO';
