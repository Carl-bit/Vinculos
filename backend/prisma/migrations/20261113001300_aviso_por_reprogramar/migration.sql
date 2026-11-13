-- Punto 24 (correcciones 2026-11-10/11): accion rapida sobre varias horas por
-- reprogramar: avisar a cada paciente para que elija (otra hora, cancelar o
-- atencion temporal; responder_ausencia). Sirve tambien para las que dejo una
-- baja, que no avisaban con opciones. ADMIN/GESTION: cualquiera; el
-- profesional, solo las suyas. Devuelve cuantas avisó.
CREATE FUNCTION avisar_horas_por_reprogramar(p_citas uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  n int := 0;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
    RAISE EXCEPTION 'Solo el equipo avisa' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    SELECT id, paciente_id FROM citas
    WHERE id = ANY (p_citas) AND estado = 'POR_REPROGRAMAR' AND paciente_id IS NOT NULL AND inicio > now()
      AND (app_rol() IN ('ADMIN', 'GESTION') OR profesional_id = app_usuario_id())
  LOOP
    PERFORM encolar_notificacion('CITA_AUSENCIA_PROFESIONAL', c.paciente_id, NULL, c.id, app_usuario_id());
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION avisar_horas_por_reprogramar(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION avisar_horas_por_reprogramar(uuid[]) TO app_user;
