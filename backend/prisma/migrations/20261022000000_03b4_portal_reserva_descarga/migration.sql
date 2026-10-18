-- =============================================================================
-- Antes de 03b-4 (pendientes de 03b-3, prompts/03_front.md):
--
-- 1. reservar_cita_portal: el paciente adulto (o el adulto responsable por su
--    menor) pide hora con SU tratante desde la cuenta, sin volver a dar sus
--    datos ni crear un registro nuevo. Solo con el tratante actual: atenderse
--    con otra persona del equipo pasa por una derivacion (C-4/C-5). El
--    adolescente (14-17) no reserva: lo hace su adulto responsable (D-4).
--    Misma disponibilidad que el portal publico (bloques de box); el EXCLUDE
--    sigue siendo la fuente de verdad. CONFIRMADA, o SOLICITADA si el
--    profesional aprueba pacientes nuevos y este paciente aun no tiene una
--    cita confirmada con el.
-- 2. guardar_enlace_portal: enlace de videollamada de la cita recien
--    reservada (misma transaccion), como guardar_enlace_solicitud.
-- 3. registrar_descarga_portal: descarga del PDF desde el portal con sesion,
--    sin el enlace del correo. Mismo registro que la descarga por enlace
--    (descargas_documento + accesos_ficha DESCARGA); el adolescente queda
--    fuera (app_pacientes_plenos).
--
-- Sin tablas nuevas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Reserva desde la cuenta
-- -----------------------------------------------------------------------------
CREATE FUNCTION reservar_cita_portal(p_paciente_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz,
                                     p_fin timestamptz, p_politica_id uuid, p_terminos_id uuid)
RETURNS TABLE (cita_id uuid, estado estado_cita, profesional_id uuid, sala_modo modo_videollamada, sala_enlace bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_profesional uuid;
  v_adulto uuid;
  v_otorgante otorgante_consentimiento;
  v_estado estado_cita;
  v_cita uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'reservar_cita_portal: solo el paciente o su adulto responsable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_rol() = 'PACIENTE' THEN
    IF p_paciente_id IS DISTINCT FROM app_paciente_id() THEN
      RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
    END IF;
    IF edad_paciente(p_paciente_id) < 18 THEN
      RAISE EXCEPTION 'Las horas de un menor las pide su adulto responsable'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_portal_cuenta_restringida';
    END IF;
    v_otorgante := 'PACIENTE';
  ELSE
    SELECT a.id INTO v_adulto FROM adultos_responsables a WHERE a.paciente_id = p_paciente_id AND a.usuario_id = app_usuario_id();
    IF v_adulto IS NULL THEN
      RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
    END IF;
    v_otorgante := 'ADULTO_RESPONSABLE';
  END IF;
  IF p_inicio <= now() THEN
    RAISE EXCEPTION 'La hora ya paso' USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_portal_futura';
  END IF;
  IF p_politica_id IS DISTINCT FROM (SELECT id FROM politica_vigente('POLITICA_DATOS'))
     OR p_terminos_id IS DISTINCT FROM (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')) THEN
    RAISE EXCEPTION 'Hay una version nueva de la politica: vuelva a aceptarla'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
  END IF;

  -- Solo con el tratante actual (un tratante por paciente; otro profesional = derivacion).
  SELECT p.profesional_id INTO v_profesional FROM pacientes p WHERE p.id = p_paciente_id;
  IF v_profesional IS NULL OR EXISTS (SELECT 1 FROM bajas WHERE usuario_id = v_profesional) THEN
    RAISE EXCEPTION 'No tienes un profesional tratante que agende por el portal: escribe al centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_portal_tratante';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM disponibilidad_publica(v_profesional, p_inicio - interval '1 minute', p_fin + interval '1 minute') d
                 WHERE d.modalidad = p_modalidad AND d.inicio <= p_inicio AND d.fin >= p_fin) THEN
    RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_disponible';
  END IF;
  IF p_modalidad = 'ONLINE' AND NOT EXISTS (SELECT 1 FROM salas_videollamada s WHERE s.usuario_id = v_profesional
                                            AND (s.modo = 'JITSI' OR s.enlace IS NOT NULL)) THEN
    RAISE EXCEPTION 'El profesional no atiende online por el portal'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'videollamada_sin_sala';
  END IF;

  v_estado := CASE WHEN (SELECT requiere_aprobacion_nuevos FROM profesionales WHERE usuario_id = v_profesional)
                        AND NOT EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id = p_paciente_id
                                          AND c.profesional_id = v_profesional AND c.estado = 'CONFIRMADA')
                   THEN 'SOLICITADA' ELSE 'CONFIRMADA' END;
  -- Presencial: la BD le pone el box del bloque del profesional (validar_agenda_cita).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado)
  VALUES (p_modalidad, v_profesional, p_paciente_id, p_inicio, p_fin, v_estado)
  RETURNING id INTO v_cita;

  -- Politica de datos y terminos vigentes: se registran si esta version aun no estaba aceptada.
  INSERT INTO aceptaciones_politica (politica_id, paciente_id, otorgado_por, adulto_responsable_id, canal)
  SELECT x.id, p_paciente_id, v_otorgante, v_adulto, 'PORTAL'
  FROM unnest(ARRAY[p_politica_id, p_terminos_id]) AS x(id)
  WHERE NOT EXISTS (SELECT 1 FROM aceptaciones_politica a WHERE a.paciente_id = p_paciente_id AND a.politica_id = x.id);

  IF v_estado = 'CONFIRMADA' THEN
    PERFORM encolar_notificacion('CITA_CONFIRMADA', p_paciente_id, NULL, v_cita, NULL);
  ELSE
    PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, v_profesional, v_cita, NULL);
  END IF;

  RETURN QUERY
  SELECT v_cita, v_estado, v_profesional, sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON p_modalidad = 'ONLINE' AND sv.usuario_id = v_profesional;
END;
$$;

-- Enlace de videollamada de la cita recien reservada por la misma cuenta (misma transaccion).
CREATE FUNCTION guardar_enlace_portal(p_cita_id uuid, p_enlace bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'guardar_enlace_portal: solo el paciente o su adulto responsable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE citas SET enlace_online = p_enlace
  WHERE id = p_cita_id AND modalidad = 'ONLINE' AND enlace_online IS NULL AND created_at = now()
    AND paciente_id IN (SELECT app_paciente_id() UNION SELECT pacientes_a_cargo());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no recien reservada' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Descarga del documento desde el portal (con sesion)
-- -----------------------------------------------------------------------------
CREATE FUNCTION registrar_descarga_portal(p_documento_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_paciente uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'Solo el paciente (o su adulto responsable) descarga sus documentos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT d.paciente_id INTO v_paciente FROM documentos_clinicos d
  WHERE d.id = p_documento_id AND d.paciente_id IN (SELECT app_pacientes_plenos());
  IF v_paciente IS NULL THEN
    RAISE EXCEPTION 'Documento inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO descargas_documento (documento_id, envio_id, usuario_id) VALUES (p_documento_id, NULL, app_usuario_id());
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), app_rol()::rol, v_paciente, 'documentos_clinicos', 'DESCARGA');
  RETURN p_documento_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  reservar_cita_portal(uuid, modalidad_atencion, timestamptz, timestamptz, uuid, uuid), guardar_enlace_portal(uuid, bytea),
  registrar_descarga_portal(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  reservar_cita_portal(uuid, modalidad_atencion, timestamptz, timestamptz, uuid, uuid), guardar_enlace_portal(uuid, bytea),
  registrar_descarga_portal(uuid)
TO app_user;
