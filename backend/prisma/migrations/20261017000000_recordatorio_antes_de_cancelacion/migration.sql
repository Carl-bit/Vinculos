-- =============================================================================
-- 02j: el recordatorio de citas sale antes de que venza el plazo de aviso de
-- cancelacion. Corre como dueño (vinculos_owner).
--
-- Si el recordatorio esta activo (recordatorio_horas_antes > 0), debe ser
-- mayor que plazo_aviso_cancelacion_horas: si no, el paciente recibe el
-- enlace cuando ya solo puede cancelar tarde. CHECK sobre la fila completa:
-- aplica cambie el que cambie (23514 -> 422).
-- Default nuevo: 48 horas (con el plazo por defecto de 24).
-- Sin tablas nuevas: configuracion_centro mantiene su categoria, RLS y GRANT.
-- =============================================================================

ALTER TABLE "configuracion_centro" ALTER COLUMN "recordatorio_horas_antes" SET DEFAULT 48;

-- Silos existentes: el valor anterior por defecto (24) igualaba al plazo (24).
-- Se mueve al minimo coherente; con un plazo de 168 horas o mas no cabe un
-- recordatorio valido y se desactiva.
UPDATE configuracion_centro
SET recordatorio_horas_antes = CASE
      WHEN plazo_aviso_cancelacion_horas < 48 THEN 48
      WHEN plazo_aviso_cancelacion_horas < 168 THEN plazo_aviso_cancelacion_horas + 1
      ELSE 0
    END
WHERE recordatorio_horas_antes > 0 AND recordatorio_horas_antes <= plazo_aviso_cancelacion_horas;

ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_recordatorio_antes_de_cancelacion
  CHECK (recordatorio_horas_antes = 0 OR recordatorio_horas_antes > plazo_aviso_cancelacion_horas);
