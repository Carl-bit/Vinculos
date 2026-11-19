-- =============================================================================
-- 2026-11-18: horario del profesional y online sin box ni sala obligatoria.
--
-- 1. El horario del profesional (disponibilidad_profesional, por dia y
--    modalidad) vuelve a decidir la agenda, igual que el horario del centro:
--    - ONLINE: sale del horario ONLINE del profesional (sin box). Sin filas
--      ONLINE = no atiende online.
--    - PRESENCIAL: sigue saliendo de las horas de box apartadas
--      (bloques_atencion), recortadas a su horario PRESENCIAL si tiene filas
--      (sin filas PRESENCIAL = sin recorte, como antes).
--    Todo sigue dentro del horario del centro. disponibilidad_publica (sitio
--    publico, portal, match y backoffice) y validar_agenda_cita usan la misma
--    regla, asi lo que se ofrece es lo que la BD acepta.
-- 2. Margen de traslado por lugar, no por modalidad (atencion hibrida): una
--    cita esta "en el centro" (citas.en_centro, lo fija la BD) si es
--    presencial o si es online dentro de un bloque de box suyo (el
--    profesional esta en la oficina). El margen solo se exige entre una cita
--    en el centro y una remota: online en la oficina entre presenciales no lo
--    necesita. Liberar un bloque lo impiden sus citas en el centro.
-- 3. Agendar online ya no exige sala de videollamada configurada
--    (videollamada_sin_sala): las salas vencen y no hay automatizacion para
--    cargar enlaces. La cita queda sin enlace hasta que haya uno.
--
-- Sin tablas nuevas: disponibilidad_profesional ya es A + C con RLS
-- (20261009000000). citas.en_centro es dato de agenda (C, como modalidad):
-- sin GRANT nuevo, solo lo escribe el trigger validar_agenda_cita.
-- =============================================================================

ALTER TABLE citas ADD COLUMN en_centro boolean NOT NULL DEFAULT false;
UPDATE citas c SET en_centro = c.modalidad = 'PRESENCIAL'
  OR EXISTS (SELECT 1 FROM bloques_atencion b WHERE b.profesional_id = c.profesional_id AND b.inicio <= c.inicio AND b.fin >= c.fin);
ALTER TABLE citas DROP CONSTRAINT citas_margen_traslado,
  ADD CONSTRAINT citas_margen_traslado EXCLUDE USING gist (profesional_id WITH =, en_centro WITH <>,
    rango_con_margen(inicio, fin, margen_traslado_min::integer) WITH &&) WHERE (estado = 'CONFIRMADA');

-- Rango dentro del horario del profesional para esa modalidad (puede cruzar
-- filas contiguas del mismo dia o de dias seguidos). PRESENCIAL sin filas =
-- sin restriccion; ONLINE sin filas = fuera de horario.
CREATE FUNCTION en_horario_profesional(p_profesional_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz, p_fin timestamptz)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_modalidad = 'PRESENCIAL' AND NOT EXISTS (SELECT 1 FROM disponibilidad_profesional d
                                                    WHERE d.profesional_id = p_profesional_id AND d.modalidad = 'PRESENCIAL')
      THEN true
    ELSE coalesce((
      SELECT range_agg(tstzrange(minuto_local(g.dia::date, d.inicio_min), minuto_local(g.dia::date, d.fin_min), '[)'))
             @> tstzrange(p_inicio, p_fin, '[)')
      FROM generate_series((p_inicio AT TIME ZONE 'America/Santiago')::date::timestamp,
                           (p_fin AT TIME ZONE 'America/Santiago')::date::timestamp, interval '1 day') AS g(dia)
      JOIN disponibilidad_profesional d ON d.profesional_id = p_profesional_id AND d.modalidad = p_modalidad
                                       AND d.dia_semana = extract(isodow FROM g.dia)), false)
  END
$$;
REVOKE ALL ON FUNCTION en_horario_profesional(uuid, modalidad_atencion, timestamptz, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.disponibilidad_publica(p_profesional_id uuid, desde timestamp with time zone, hasta timestamp with time zone)
 RETURNS TABLE(modalidad modalidad_atencion, inicio timestamp with time zone, fin timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_margen int := margen_vigente(p_profesional_id);
BEGIN
  IF desde IS NULL OR hasta IS NULL OR hasta <= desde OR hasta - desde > interval '62 days' THEN
    RAISE EXCEPTION 'Rango invalido (maximo 62 dias)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'disponibilidad_publica_rango';
  END IF;
  IF NOT (tiene_rol(p_profesional_id, 'PROFESIONAL') OR tiene_rol(p_profesional_id, 'PRACTICANTE'))
     OR NOT (acceso_vigente() OR EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico AND profesional_validado(usuario_id))) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH dias AS (
    SELECT g.dia::date AS dia
    FROM generate_series((desde AT TIME ZONE 'America/Santiago')::date::timestamp,
                         (hasta AT TIME ZONE 'America/Santiago')::date::timestamp, interval '1 day') AS g(dia)
  ), horario AS (
    SELECT d.modalidad AS m, range_agg(tstzrange(minuto_local(x.dia, d.inicio_min), minuto_local(x.dia, d.fin_min), '[)')) AS r
    FROM dias x JOIN disponibilidad_profesional d ON d.profesional_id = p_profesional_id AND d.dia_semana = extract(isodow FROM x.dia)
    GROUP BY d.modalidad
  ), bloques AS (
    SELECT coalesce(range_agg(tstzrange(b.inicio, b.fin, '[)')), '{}'::tstzmultirange) AS r
    FROM bloques_atencion b
    WHERE b.profesional_id = p_profesional_id AND b.fin > desde AND b.inicio < hasta
  ), ventanas AS (
    -- (modalidad, en el centro). Presencial: horas de box apartadas, recortadas a su horario presencial si lo tiene.
    SELECT 'PRESENCIAL'::modalidad_atencion AS m, true AS en_centro,
           (SELECT b.r FROM bloques b)
           * CASE WHEN EXISTS (SELECT 1 FROM disponibilidad_profesional d
                               WHERE d.profesional_id = p_profesional_id AND d.modalidad = 'PRESENCIAL')
                  THEN coalesce((SELECT h.r FROM horario h WHERE h.m = 'PRESENCIAL'), '{}'::tstzmultirange)
                  ELSE tstzmultirange(tstzrange(NULL, NULL)) END AS r
    UNION ALL
    -- Online: su horario online, sin box. Dentro de sus bloques esta en el centro; fuera, remoto.
    SELECT h.m, true, h.r * (SELECT b.r FROM bloques b) FROM horario h WHERE h.m = 'ONLINE'
    UNION ALL
    SELECT h.m, false, h.r - (SELECT b.r FROM bloques b) FROM horario h WHERE h.m = 'ONLINE'
  ), lugares AS (
    SELECT unnest(ARRAY[true, false]) AS l
  ), centro AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM horario_centro)
                THEN (SELECT coalesce(range_agg(tstzrange(minuto_local(x.dia, h.inicio_min), minuto_local(x.dia, h.fin_min), '[)')),
                                      '{}'::tstzmultirange)
                      FROM dias x JOIN horario_centro h ON h.dia_semana = extract(isodow FROM x.dia))
                ELSE '{}'::tstzmultirange END AS r
  ), ocupado AS (
    -- Por lugar: en el mismo lugar choca solo la cita; en otro lugar, tambien su margen de traslado.
    SELECT x.l,
           CASE WHEN c.en_centro = x.l THEN tstzrange(c.inicio, c.fin, '[)')
                ELSE rango_con_margen(c.inicio, c.fin, c.margen_traslado_min + v_margen) END AS r
    FROM citas c CROSS JOIN lugares x
    WHERE c.profesional_id = p_profesional_id AND c.estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA')
    UNION ALL
    SELECT x.l, tstzrange(b.inicio, b.fin, '[)')
    FROM bloqueos_agenda b CROSS JOIN lugares x
    WHERE b.profesional_id = p_profesional_id
    UNION ALL
    SELECT x.l,
           CASE WHEN (t.modalidad = 'PRESENCIAL' OR EXISTS (SELECT 1 FROM bloques_atencion b WHERE b.profesional_id = t.profesional_id
                                                            AND b.inicio <= t.inicio AND b.fin >= t.fin)) = x.l
                THEN tstzrange(t.inicio, t.fin, '[)')
                ELSE rango_con_margen(t.inicio, t.fin, 2 * v_margen) END
    FROM bloqueos_temporales t CROSS JOIN lugares x
    WHERE t.profesional_id = p_profesional_id AND t.expira_en > now()
  ), libres AS (
    -- ponytail: online en el centro y remoto salen como huecos aparte aunque se toquen (no se ofrece una cita que
    -- cruce el borde de un bloque); unirlos exigiria validar el margen del tramo remoto por separado.
    SELECT v.m,
           unnest((v.r - coalesce((SELECT range_agg(o.r) FROM ocupado o WHERE o.l = v.en_centro), '{}'::tstzmultirange))
                  * tstzmultirange(tstzrange(desde, hasta, '[)')) * (SELECT c.r FROM centro c)) AS r
    FROM ventanas v WHERE v.r IS NOT NULL
  )
  SELECT l.m, lower(l.r), upper(l.r) FROM libres l ORDER BY 2, 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validar_agenda_cita()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_box uuid;
BEGIN
  IF NEW.estado NOT IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') THEN
    RETURN NEW;
  END IF;
  -- Presencial: dentro de un bloque de box suyo (le da el box). Online: sin box; dentro de un bloque suyo esta en
  -- el centro (sin margen de traslado con sus presenciales), fuera es remota.
  SELECT b.espacio_id INTO v_box FROM bloques_atencion b
  WHERE b.profesional_id = NEW.profesional_id AND b.inicio <= NEW.inicio AND b.fin >= NEW.fin;
  NEW.en_centro := FOUND;
  IF NEW.modalidad = 'PRESENCIAL' AND NOT FOUND THEN
    RAISE EXCEPTION 'La cita cae fuera de la disponibilidad del profesional (horas de box apartadas)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_disponibilidad';
  END IF;
  NEW.espacio_id := CASE WHEN NEW.modalidad = 'PRESENCIAL' THEN v_box END;
  IF NOT en_horario_profesional(NEW.profesional_id, NEW.modalidad, NEW.inicio, NEW.fin) THEN
    RAISE EXCEPTION 'La cita cae fuera del horario del profesional para esa modalidad'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_horario_profesional';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bloqueos_agenda b
    WHERE b.profesional_id = NEW.profesional_id
      AND tstzrange(b.inicio, b.fin, '[)') && tstzrange(NEW.inicio, NEW.fin, '[)')
  ) THEN
    RAISE EXCEPTION 'El profesional tiene la agenda bloqueada en ese horario'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_fuera_de_bloqueos';
  END IF;
  IF NOT en_horario_centro(NEW.inicio, NEW.fin) THEN
    RAISE EXCEPTION 'La cita cae fuera del horario de atencion del centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_horario_centro';
  END IF;
  IF NEW.modalidad = 'PRESENCIAL' AND NOT en_horario_espacio(NEW.espacio_id, NEW.inicio, NEW.fin) THEN
    RAISE EXCEPTION 'La cita cae fuera del horario de funcionamiento del box'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_horario_espacio';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.proteger_bloque_atencion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM citas c
             WHERE c.profesional_id = OLD.profesional_id AND c.en_centro
               AND c.estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA')
               AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(OLD.inicio, OLD.fin, '[)'))
     OR EXISTS (SELECT 1 FROM bloqueos_temporales t
                WHERE t.profesional_id = OLD.profesional_id AND t.modalidad = 'PRESENCIAL' AND t.expira_en > now()
                  AND tstzrange(t.inicio, t.fin, '[)') && tstzrange(OLD.inicio, OLD.fin, '[)')) THEN
    RAISE EXCEPTION 'El bloque tiene citas o reservas en curso: reprograme o cancele antes de liberarlo'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN OLD;
END;
$function$
;

-- Citas futuras bajo el margen vigente: por lugar, igual que el EXCLUDE.
CREATE OR REPLACE FUNCTION citas_en_conflicto_margen(p_profesional_id uuid)
RETURNS TABLE (cita_id uuid, cita_conflicto_id uuid, inicio timestamptz, separacion_min int, margen_min int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_margen int := margen_vigente(p_profesional_id);
BEGIN
  IF NOT acceso_vigente() OR NOT (app_rol() IN ('ADMIN', 'GESTION') OR app_usuario_id() = p_profesional_id) THEN
    RAISE EXCEPTION 'citas_en_conflicto_margen: ADMIN, GESTION o el propio profesional' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT a.id, b.id, a.inicio, (extract(epoch FROM b.inicio - a.fin) / 60)::int, v_margen
  FROM citas a
  JOIN citas b ON b.profesional_id = a.profesional_id AND b.en_centro <> a.en_centro
              AND b.estado = 'CONFIRMADA' AND b.inicio >= a.fin
              AND b.inicio < a.fin + v_margen * interval '1 minute'
  WHERE a.profesional_id = p_profesional_id AND a.estado = 'CONFIRMADA' AND a.inicio > now()
  ORDER BY a.inicio;
END;
$$;

-- en_centro lo recalcula el trigger tambien si alguien intenta escribirlo.
DROP TRIGGER citas_agenda_valida ON citas;
CREATE TRIGGER citas_agenda_valida BEFORE INSERT OR UPDATE OF estado, inicio, fin, profesional_id, modalidad, espacio_id, en_centro ON citas
  FOR EACH ROW EXECUTE FUNCTION validar_agenda_cita();

-- 3. Sin exigencia de sala de videollamada (resto igual a 20261116000000_mvp_sin_cobros).
CREATE OR REPLACE FUNCTION crear_solicitud_hora(p_id uuid, p_profesional_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz,
                                     p_fin timestamptz, p_nombre text, p_apellido text, p_fecha_nacimiento date, p_email text,
                                     p_telefono bytea, p_rut bytea, p_rut_hmac bytea, p_adulto_nombre text,
                                     p_adulto_parentesco text, p_adulto_telefono bytea, p_respuestas bytea,
                                     p_recomendado_id uuid, p_politica_id uuid, p_terminos_id uuid, p_token_hash bytea,
                                     p_reserva_hash bytea)
  RETURNS TABLE(expira timestamptz, cita_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_expira timestamptz := plazo_retencion(p_inicio);
  v_espacio uuid;
  v_cita uuid;
BEGIN
  IF p_inicio <= now() THEN
    RAISE EXCEPTION 'La hora ya paso' USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_hora_coherente';
  END IF;
  IF p_politica_id IS DISTINCT FROM (SELECT id FROM politica_vigente('POLITICA_DATOS'))
     OR p_terminos_id IS DISTINCT FROM (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')) THEN
    RAISE EXCEPTION 'Hay una version nueva de la politica: vuelva a aceptarla'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
  END IF;
  IF age((p_inicio AT TIME ZONE 'America/Santiago')::date, p_fecha_nacimiento) < interval '18 years'
     AND coalesce(btrim(p_adulto_nombre), '') = '' THEN
    RAISE EXCEPTION 'Paciente menor de 18: el solicitante se declara adulto responsable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_menor_requiere_adulto_responsable';
  END IF;
  IF (SELECT count(*) FROM solicitudes_hora s JOIN citas c ON c.id = s.cita_id
      WHERE lower(s.email) = lower(p_email) AND s.estado = 'PENDIENTE_VERIFICACION' AND c.estado = 'RETENIDA'
        AND c.retencion_vence_en > now()) >= 2 THEN
    RAISE EXCEPTION 'Ya hay reservas en curso para este correo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_hora_limite';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico)
     OR NOT profesional_validado(p_profesional_id)
     OR NOT tiene_rol(p_profesional_id, 'PROFESIONAL')
     OR EXISTS (SELECT 1 FROM bajas WHERE usuario_id = p_profesional_id)
     OR NOT EXISTS (SELECT 1 FROM disponibilidad_publica(p_profesional_id, p_inicio - interval '1 minute', p_fin + interval '1 minute') d
                    WHERE d.modalidad = p_modalidad AND d.inicio <= p_inicio AND d.fin >= p_fin) THEN
    RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_disponible';
  END IF;

  -- Presencial: la BD le pone el box del bloque del profesional (validar_agenda_cita).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, retencion_vence_en)
  VALUES (p_modalidad, p_profesional_id, NULL, p_inicio, p_fin, 'RETENIDA', v_expira)
  RETURNING id, espacio_id INTO v_cita, v_espacio;

  INSERT INTO solicitudes_hora (id, profesional_id, modalidad, espacio_id, inicio, fin, nombre, apellido, fecha_nacimiento,
                                email, telefono, rut, rut_hmac, adulto_nombre, adulto_parentesco, adulto_telefono,
                                respuestas, recomendado_id, politica_id, terminos_id, expira_en, reserva_hash, cita_id)
  VALUES (p_id, p_profesional_id, p_modalidad, v_espacio, p_inicio, p_fin, btrim(p_nombre), btrim(p_apellido),
          p_fecha_nacimiento, lower(btrim(p_email)), p_telefono, p_rut, p_rut_hmac, nullif(btrim(p_adulto_nombre), ''),
          p_adulto_parentesco, p_adulto_telefono, p_respuestas, p_recomendado_id,
          p_politica_id, p_terminos_id, v_expira, p_reserva_hash, v_cita);

  PERFORM emitir_token('VERIFICACION_SOLICITUD', p_token_hash, least(p_inicio, now() + interval '24 hours'),
                       NULL, NULL, NULL, p_id, NULL, lower(btrim(p_email)));
  RETURN QUERY SELECT v_expira, v_cita;
END;
$function$;

CREATE OR REPLACE FUNCTION reservar_cita_portal(p_paciente_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz,
                                                p_fin timestamptz, p_politica_id uuid, p_terminos_id uuid)
  RETURNS TABLE(cita_id uuid, estado estado_cita, profesional_id uuid, sala_modo modo_videollamada, sala_enlace bytea)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_profesional uuid;
  v_adulto uuid;
  v_otorgante otorgante_consentimiento;
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

  -- La aprueba su profesional. Presencial: la BD le pone el box del bloque (validar_agenda_cita).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en)
  VALUES (p_modalidad, v_profesional, p_paciente_id, p_inicio, p_fin, 'SOLICITADA', plazo_aprobacion(p_inicio))
  RETURNING id INTO v_cita;

  -- Politica de datos y terminos vigentes: se registran si esta version aun no estaba aceptada.
  INSERT INTO aceptaciones_politica (politica_id, paciente_id, otorgado_por, adulto_responsable_id, canal)
  SELECT x.id, p_paciente_id, v_otorgante, v_adulto, 'PORTAL'
  FROM unnest(ARRAY[p_politica_id, p_terminos_id]) AS x(id)
  WHERE NOT EXISTS (SELECT 1 FROM aceptaciones_politica a WHERE a.paciente_id = p_paciente_id AND a.politica_id = x.id);

  PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, v_profesional, v_cita, NULL);

  RETURN QUERY
  SELECT v_cita, 'SOLICITADA'::estado_cita, v_profesional, sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON p_modalidad = 'ONLINE' AND sv.usuario_id = v_profesional;
END;
$function$;
