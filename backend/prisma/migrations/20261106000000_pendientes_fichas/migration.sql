-- =============================================================================
-- Fichas y Pacientes (2026-11-06): pendientes de las fichas para el
-- seguimiento del equipo (administracion, diseño "Administrador seguimiento
-- del trabajo de cada profesional") y el "Por hacer" del profesional (diseño
-- "Profesional flujo del dia y ficha completa").
--
-- pendientes_fichas(profesional) devuelve SOLO metadata administrativa, sin
-- contenido clinico ni nombres (Categoria A): paciente (id y codigo
-- seudonimo), tipo, fecha de referencia y vencimiento.
--   SIN_EVOLUCION    sesion realizada (cita_realizada) del profesional sin
--                    evolucion; fecha = inicio, vence = inicio + dias para
--                    registrar la evolucion (configuracion_centro.dias_gracia_cierre,
--                    "Agenda y plazos").
--   CONSENTIMIENTO   paciente con proxima hora y sin aceptar la version vigente
--                    del consentimiento informado de atencion; fecha = proxima hora.
--   SIN_RUT          paciente sin RUT con proxima hora o con una sesion sin
--                    evolucion (la BD exige el RUT antes de la primera evolucion).
--   SIN_RESPONSABLE  menor de edad con proxima hora y sin adulto responsable
--                    (sin el no se confirma la hora).
-- Permisos: ADMIN/GESTION todos (o uno); PROFESIONAL/PRACTICANTE solo los
-- propios, igual que estado_fichas_profesional. Sin escritura.
-- =============================================================================

CREATE FUNCTION pendientes_fichas(p_profesional_id uuid DEFAULT NULL)
RETURNS TABLE (profesional_id uuid, paciente_id uuid, codigo text, tipo text, cita_id uuid,
               fecha timestamptz, vence timestamptz, menor boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_prof uuid := p_profesional_id;
  v_dias int := coalesce((SELECT c.dias_gracia_cierre FROM configuracion_centro c LIMIT 1), 30);
  v_version int := (SELECT v.version FROM politica_vigente('CONSENTIMIENTO_ATENCION') v);
  v_hoy date := (now() AT TIME ZONE 'America/Santiago')::date;
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'pendientes_fichas: sin acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_rol() IN ('PROFESIONAL', 'PRACTICANTE') THEN
    IF v_prof IS NOT NULL AND v_prof <> app_usuario_id() THEN
      RAISE EXCEPTION 'pendientes_fichas: ADMIN/GESTION o el propio' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_prof := app_usuario_id();
  ELSIF app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'pendientes_fichas: ADMIN/GESTION o el propio' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH sin_evolucion AS (
    SELECT c.id AS cita_id, c.profesional_id, c.paciente_id, c.inicio
    FROM citas c
    WHERE (v_prof IS NULL OR c.profesional_id = v_prof) AND c.paciente_id IS NOT NULL
      AND cita_realizada(c.id) AND NOT EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = c.id)
  ),
  pac AS (
    SELECT p.id, p.profesional_id, p.codigo_seudonimo, p.rut IS NULL AS sin_rut,
           extract(year FROM age(v_hoy, p.fecha_nacimiento)) < 18 AS menor,
           (SELECT min(c.inicio) FROM citas c
            WHERE c.paciente_id = p.id AND c.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO') AND c.inicio >= now()) AS proxima
    FROM pacientes p
    WHERE p.deleted_at IS NULL AND (v_prof IS NULL OR p.profesional_id = v_prof)
  )
  SELECT s.profesional_id, s.paciente_id, p.codigo_seudonimo, 'SIN_EVOLUCION', s.cita_id, s.inicio,
         s.inicio + make_interval(days => v_dias), extract(year FROM age(v_hoy, p.fecha_nacimiento)) < 18
  FROM sin_evolucion s JOIN pacientes p ON p.id = s.paciente_id
  UNION ALL
  SELECT p.profesional_id, p.id, p.codigo_seudonimo, 'CONSENTIMIENTO', NULL::uuid, p.proxima, NULL::timestamptz, p.menor
  FROM pac p
  WHERE p.proxima IS NOT NULL AND v_version IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM aceptaciones_politica a JOIN politicas po ON po.id = a.politica_id
                    WHERE a.paciente_id = p.id AND po.tipo = 'CONSENTIMIENTO_ATENCION' AND po.version >= v_version)
  UNION ALL
  SELECT p.profesional_id, p.id, p.codigo_seudonimo, 'SIN_RUT', NULL::uuid, p.proxima, NULL::timestamptz, p.menor
  FROM pac p
  WHERE p.sin_rut AND (p.proxima IS NOT NULL OR EXISTS (SELECT 1 FROM sin_evolucion s WHERE s.paciente_id = p.id))
  UNION ALL
  SELECT p.profesional_id, p.id, p.codigo_seudonimo, 'SIN_RESPONSABLE', NULL::uuid, p.proxima, NULL::timestamptz, true
  FROM pac p
  WHERE p.menor AND p.proxima IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM adultos_responsables a WHERE a.paciente_id = p.id);
END;
$$;

COMMENT ON FUNCTION pendientes_fichas(uuid) IS
  'Categoria A. Pendientes administrativos de las fichas (sesiones sin evolucion, consentimiento, RUT, adulto responsable): solo metadata y codigo seudonimo. ADMIN/GESTION o el propio.';

REVOKE ALL ON FUNCTION pendientes_fichas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pendientes_fichas(uuid) TO app_user;
