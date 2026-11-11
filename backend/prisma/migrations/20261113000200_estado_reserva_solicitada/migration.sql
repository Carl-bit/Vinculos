-- =============================================================================
-- Correcciones 2026-11-11, puntos 6 y 7: la pantalla de la reserva sin cuenta
-- consulta estado_pago_cita. Sin COBROS, tras verificar el correo la cita queda
-- SOLICITADA: el estado trae el plazo de aprobacion (24 h) y ningun paso
-- pendiente para el paciente. Si el profesional no la acepto y propuso otras
-- horas, el paso es REVISAR_PROPUESTAS (se eligen en la cuenta del paciente).
-- =============================================================================
DO $$
DECLARE
  def text := pg_get_functiondef('estado_pago_cita(uuid)'::regprocedure);
  nuevo text;
BEGIN
  nuevo := replace(def, $q$CASE WHEN v_pendiente THEN c.pago_vence_en END,$q$,
                        $q$CASE WHEN v_pendiente THEN c.pago_vence_en WHEN v_estado = 'SOLICITADA' THEN c.aprobacion_vence_en END,$q$);
  nuevo := replace(nuevo, $q$      WHEN v_estado = 'CONFIRMADA' THEN 'NINGUNO'
$q$,
                          $q$      WHEN v_estado IN ('CONFIRMADA', 'SOLICITADA') THEN 'NINGUNO'
      WHEN EXISTS (SELECT 1 FROM citas x WHERE x.propuesta_de_id = c.id AND x.estado = 'PROPUESTA') THEN 'REVISAR_PROPUESTAS'
$q$);
  IF (length(nuevo) - length(replace(nuevo, 'SOLICITADA', ''))) / length('SOLICITADA') <> 2
     OR nuevo NOT LIKE '%REVISAR_PROPUESTAS%' THEN
    RAISE EXCEPTION 'estado_pago_cita no trae las condiciones esperadas';
  END IF;
  EXECUTE nuevo;
END $$;
