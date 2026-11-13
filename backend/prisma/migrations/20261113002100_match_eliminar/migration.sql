-- =============================================================================
-- Puntos 27/28 (correcciones 2026-11-10/11): el cuestionario del match se puede
-- depurar. Antes solo se apagaba (D-5: nunca DELETE).
--   - eliminar_pregunta_match: solo las propias del centro (las del sistema
--     alimentan el calculo del match: se apagan). Borra sus opciones.
--   - eliminar_opcion_match: cualquier opcion, salvo dejar sin opciones una
--     pregunta de seleccion.
-- Sin GRANT DELETE: solo estas funciones (ADMIN). Las respuestas guardadas de
-- solicitudes no referencian opciones (texto), asi que nada queda colgando.
-- =============================================================================

CREATE FUNCTION eliminar_pregunta_match(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_propia boolean;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN edita el match' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT propia_centro INTO v_propia FROM match_preguntas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pregunta inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT v_propia THEN
    RAISE EXCEPTION 'Las preguntas del sistema no se eliminan: apagala para que no se muestre'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'match_preguntas_sistema';
  END IF;
  DELETE FROM match_opciones WHERE pregunta_id = p_id;
  DELETE FROM match_preguntas WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION eliminar_pregunta_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eliminar_pregunta_match(uuid) TO app_user;

CREATE FUNCTION eliminar_opcion_match(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pregunta uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN edita el match' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT pregunta_id INTO v_pregunta FROM match_opciones WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opcion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM match_preguntas WHERE id = v_pregunta FOR UPDATE;
  IF (SELECT tipo::text FROM match_preguntas WHERE id = v_pregunta) <> 'TEXTO'
     AND (SELECT count(*) FROM match_opciones WHERE pregunta_id = v_pregunta) <= 1 THEN
    RAISE EXCEPTION 'La pregunta quedaria sin opciones: agrega otra o elimina la pregunta'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'match_opciones_ultima';
  END IF;
  DELETE FROM match_opciones WHERE id = p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION eliminar_opcion_match(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eliminar_opcion_match(uuid) TO app_user;
