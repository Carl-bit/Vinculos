-- AUD-02 (2026-11-06): la exportacion del centro puede quedar programada
-- (ventana nocturna) o en espera de reintento. Va sola: un valor nuevo de un
-- enum no se puede usar en la misma transaccion que lo agrega.
ALTER TYPE estado_exportacion_centro ADD VALUE IF NOT EXISTS 'PENDIENTE' BEFORE 'EN_PROCESO';
