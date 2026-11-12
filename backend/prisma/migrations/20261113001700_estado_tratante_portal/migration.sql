-- =============================================================================
-- Puntos 9/43 (correcciones 2026-11-11): el portal sabe si su profesional
-- puede atenderlo. Si el tratante esta desactivado, de baja o con un bloqueo
-- vigente, "Mi profesional" no ofrece pedir hora ni escribirle: avisa que no
-- estara disponible y ofrece atenderse con otro profesional o cancelar las
-- horas que tenia con el. Si lo atiende un reemplazo (atencion temporal), lo
-- indica: la nueva hora es con el reemplazo, o puede pedir otro del equipo.
-- =============================================================================

-- Estado del tratante para la cuenta del portal (paciente o su adulto responsable).
CREATE FUNCTION estado_tratante_portal(p_paciente_id uuid)
RETURNS TABLE (tratante_id uuid, disponible boolean, vuelve_en timestamptz, principal_id uuid, principal_disponible boolean,
               horas_con_tratante integer, solicitud_pendiente boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_tratante uuid;
  v_principal uuid;
BEGIN
  IF NOT acceso_vigente() OR NOT coalesce(contacto_emergencia_propio(p_paciente_id), false) THEN
    RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT p.profesional_id INTO v_tratante FROM pacientes p WHERE p.id = p_paciente_id;
  SELECT a.profesional_principal_id INTO v_principal FROM atenciones_temporales a
  WHERE a.paciente_id = p_paciente_id AND a.cerrada_en IS NULL AND a.profesional_principal_id <> v_tratante;
  RETURN QUERY SELECT
    v_tratante,
    profesional_disponible(v_tratante),
    (SELECT max(b.fin) FROM bloqueos_agenda b WHERE b.profesional_id = v_tratante AND b.inicio <= now() AND b.fin > now()),
    v_principal,
    CASE WHEN v_principal IS NULL THEN NULL ELSE profesional_disponible(v_principal) END,
    (SELECT count(*)::int FROM citas c WHERE c.paciente_id = p_paciente_id AND c.profesional_id = v_tratante
       AND c.estado IN ('CONFIRMADA', 'SOLICITADA', 'POR_REPROGRAMAR') AND c.inicio > now()),
    EXISTS (SELECT 1 FROM alertas_internas a WHERE a.tipo = 'ATENCION_TEMPORAL' AND a.referencia_id = p_paciente_id AND a.atendida_en IS NULL);
END;
$$;
REVOKE EXECUTE ON FUNCTION estado_tratante_portal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estado_tratante_portal(uuid) TO app_user;

-- Pedir otro profesional sin pasar por una hora: tratante no disponible, o
-- prefiere otro del equipo mientras su principal no esta. Misma alerta y
-- registro que responder_ausencia (la cuenta madre lo deriva).
CREATE FUNCTION solicitar_otro_profesional(p_paciente_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tratante uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') OR NOT coalesce(contacto_emergencia_propio(p_paciente_id), false) THEN
    RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT profesional_id INTO v_tratante FROM pacientes WHERE id = p_paciente_id;
  INSERT INTO alertas_internas (tipo, referencia_id, detalle)
  VALUES ('ATENCION_TEMPORAL', p_paciente_id,
          'El paciente pide atenderse con otro profesional (su tratante no esta disponible o prefiere otro mientras tanto). Derivalo desde Fichas y pacientes > Derivaciones.')
  ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
  -- El principal es el de la atencion temporal abierta, si ya la hay; si no, el tratante actual.
  INSERT INTO atenciones_temporales (paciente_id, profesional_principal_id)
  VALUES (p_paciente_id, v_tratante)
  ON CONFLICT (paciente_id) WHERE cerrada_en IS NULL DO NOTHING;
END;
$$;
REVOKE EXECUTE ON FUNCTION solicitar_otro_profesional(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION solicitar_otro_profesional(uuid) TO app_user;

-- Cancelar las proximas horas con el tratante, solo si no esta disponible. Devuelve cuantas.
CREATE FUNCTION cancelar_horas_tratante_ausente(p_paciente_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tratante uuid;
  n int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') OR NOT coalesce(contacto_emergencia_propio(p_paciente_id), false) THEN
    RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT profesional_id INTO v_tratante FROM pacientes WHERE id = p_paciente_id;
  IF profesional_disponible(v_tratante) THEN
    RAISE EXCEPTION 'Tu profesional esta disponible: cancela cada hora con el'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_tratante_disponible';
  END IF;
  UPDATE citas SET estado = 'CANCELADA', updated_at = now()
  WHERE paciente_id = p_paciente_id AND profesional_id = v_tratante
    AND estado IN ('CONFIRMADA', 'SOLICITADA', 'POR_REPROGRAMAR') AND inicio > now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION cancelar_horas_tratante_ausente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancelar_horas_tratante_ausente(uuid) TO app_user;
