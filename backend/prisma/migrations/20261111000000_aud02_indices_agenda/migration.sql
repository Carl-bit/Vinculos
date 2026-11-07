-- AUD-02 BD-03: indices de agenda. Sin tabla nueva (no aplica categoria A/B/C).
-- La agenda por box y por profesional en un rango hacia Seq Scan: los gist de
-- no solapamiento son parciales (solo estados activos) y no sirven para listar
-- todas las citas de la semana. EXPLAIN antes y despues en
-- docs/operacion/auditoria_rendimiento.md (BD-03).
CREATE INDEX "citas_espacio_id_inicio_idx" ON "citas"("espacio_id", "inicio");
CREATE INDEX "citas_profesional_id_inicio_idx" ON "citas"("profesional_id", "inicio");
