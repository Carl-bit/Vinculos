-- =============================================================================
-- Nivel de riesgo en el borrador de evolucion (A, misma categoria de la tabla).
--
-- El editor pedia el riesgo pero la API solo lo recibia al confirmar: al
-- reabrir un borrador el valor elegido se perdia sin aviso. Queda como opcional
-- en el borrador; al confirmar sigue siendo obligatorio (ConfirmarBorradorDto).
-- Es un enum, sin cifrar, igual que evoluciones.nivel_riesgo.
-- =============================================================================

ALTER TABLE "borradores_evolucion" ADD COLUMN "nivel_riesgo" "nivel_riesgo";

-- UPDATE es por columna: sin esto el guardado automatico falla con 42501.
GRANT UPDATE (nivel_riesgo) ON borradores_evolucion TO app_user;
