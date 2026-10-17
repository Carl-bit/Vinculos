-- =============================================================================
-- 03b: valores de enum nuevos. Migracion aparte: un valor agregado con
-- ADD VALUE no se puede usar en la misma transaccion (como 02i y 03a).
-- =============================================================================

-- Lista de espera publica (sin cuenta): verificar el correo y darse de baja.
ALTER TYPE "tipo_token_correo" ADD VALUE 'VERIFICACION_LISTA_ESPERA';
ALTER TYPE "tipo_token_correo" ADD VALUE 'BAJA_LISTA_ESPERA';
