-- =============================================================================
-- Correcciones 2026-11-11 (tercera vuelta): la baja (de la cuenta o del rol
-- profesional) tambien cancela las horas PROPUESTA del profesional desde la
-- fecha efectiva. Antes quedaban retenidas y el paciente podia aceptar una
-- hora en una agenda ya bloqueada por la baja. Un aviso CITA_CANCELADA por
-- grupo de propuestas (como vencer_solicitudes); el paciente vuelve a pedir hora.
-- =============================================================================

CREATE FUNCTION cancelar_propuestas_baja(p_profesional_id uuid, p_desde timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g record;
BEGIN
  FOR g IN
    WITH canceladas AS (
      UPDATE citas SET estado = 'CANCELADA', updated_at = now()
      WHERE profesional_id = p_profesional_id AND estado = 'PROPUESTA' AND inicio >= p_desde
      RETURNING paciente_id, propuesta_de_id
    )
    SELECT DISTINCT paciente_id, propuesta_de_id FROM canceladas
  LOOP
    PERFORM encolar_notificacion('CITA_CANCELADA', g.paciente_id, NULL, g.propuesta_de_id, NULL);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION cancelar_propuestas_baja(uuid, timestamptz) FROM PUBLIC;

DO $$
DECLARE
  f text;
  def text;
  nuevo text;
BEGIN
  FOREACH f IN ARRAY ARRAY['iniciar_baja_profesional(uuid, timestamptz)', 'iniciar_baja_rol(uuid, rol, timestamptz)'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def, $q$  GET DIAGNOSTICS v_citas = ROW_COUNT;
  RETURN v_citas;$q$, $q$  GET DIAGNOSTICS v_citas = ROW_COUNT;
  PERFORM cancelar_propuestas_baja(p_usuario_id, p_fecha_efectiva);
  RETURN v_citas;$q$);
    IF nuevo = def THEN
      RAISE EXCEPTION '% no trae el cierre esperado', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;
END $$;
