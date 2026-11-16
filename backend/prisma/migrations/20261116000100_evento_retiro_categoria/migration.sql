-- Evento de bitacora para retirar una categoria de llaves completa (no una
-- version): lo usa la migracion siguiente al sacar FINANCIERO. Va en su propia
-- migracion porque un valor nuevo de enum no se puede usar en la misma
-- transaccion en que se crea.
ALTER TYPE tipo_evento_llaves ADD VALUE IF NOT EXISTS 'RETIRO_CATEGORIA';
