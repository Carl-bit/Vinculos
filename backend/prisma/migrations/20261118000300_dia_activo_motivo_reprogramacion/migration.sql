-- =============================================================================
-- 2026-11-18 (4): activar o desactivar un dia del horario; motivo de
-- reprogramacion.
--
-- 1. disponibilidad_profesional.activo (C): el profesional apaga un dia con un
--    clic y su horario se conserva para volver a encenderlo. Una fila inactiva
--    no decide la agenda (en_horario_profesional, disponibilidad_publica).
--    Apagar un dia pasa por el trigger de 20261118000200: sus sesiones futuras
--    quedan POR_REPROGRAMAR con aviso al paciente.
-- 2. citas.motivo_reprogramacion (C): DIA_SIN_ATENCION cuando la cita queda por
--    reprogramar porque el profesional no atiende ese dia (dias sin atencion o
--    cambio de horario), para que el equipo vea el motivo correcto (no el de
--    salida, revocacion o baja). Lo fija la BD; validar_agenda_cita lo limpia
--    al salir de POR_REPROGRAMAR.
--
-- Sin tablas nuevas ni GRANT nuevo.
-- =============================================================================

ALTER TABLE disponibilidad_profesional ADD COLUMN activo boolean NOT NULL DEFAULT true;
ALTER TABLE citas ADD COLUMN motivo_reprogramacion text,
  ADD CONSTRAINT citas_motivo_reprogramacion_valido CHECK (motivo_reprogramacion IS NULL OR motivo_reprogramacion = 'DIA_SIN_ATENCION');

CREATE OR REPLACE FUNCTION en_horario_profesional(p_profesional_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz, p_fin timestamptz)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_modalidad = 'PRESENCIAL' AND NOT EXISTS (SELECT 1 FROM disponibilidad_profesional d
                                                    WHERE d.profesional_id = p_profesional_id AND d.modalidad = 'PRESENCIAL' AND d.activo)
      THEN true
    ELSE coalesce((
      SELECT range_agg(tstzrange(minuto_local(g.dia::date, d.inicio_min), minuto_local(g.dia::date, d.fin_min), '[)'))
             @> tstzrange(p_inicio, p_fin, '[)')
      FROM generate_series((p_inicio AT TIME ZONE 'America/Santiago')::date::timestamp,
                           (p_fin AT TIME ZONE 'America/Santiago')::date::timestamp, interval '1 day') AS g(dia)
      JOIN disponibilidad_profesional d ON d.profesional_id = p_profesional_id AND d.modalidad = p_modalidad
                                       AND d.dia_semana = extract(isodow FROM g.dia) AND d.activo), false)
  END
$$;

CREATE OR REPLACE FUNCTION public.disponibilidad_publica(p_profesional_id uuid, desde timestamp with time zone, hasta timestamp with time zone)
 RETURNS TABLE(modalidad modalidad_atencion, inicio timestamp with time zone, fin timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
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
    FROM dias x JOIN disponibilidad_profesional d ON d.profesional_id = p_profesional_id AND d.dia_semana = extract(isodow FROM x.dia) AND d.activo
    GROUP BY d.modalidad
  ), ventanas AS (
    -- Presencial: horas de box apartadas, recortadas a su horario presencial si lo tiene.
    SELECT 'PRESENCIAL'::modalidad_atencion AS m,
           range_agg(tstzrange(b.inicio, b.fin, '[)'))
           * CASE WHEN EXISTS (SELECT 1 FROM disponibilidad_profesional d
                               WHERE d.profesional_id = p_profesional_id AND d.modalidad = 'PRESENCIAL' AND d.activo)
                  THEN coalesce((SELECT h.r FROM horario h WHERE h.m = 'PRESENCIAL'), '{}'::tstzmultirange)
                  ELSE tstzmultirange(tstzrange(NULL, NULL)) END AS r
    FROM bloques_atencion b
    WHERE b.profesional_id = p_profesional_id AND b.fin > desde AND b.inicio < hasta
    UNION ALL
    -- Online: su horario online, sin box.
    SELECT h.m, h.r FROM horario h WHERE h.m = 'ONLINE'
  ), centro AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM horario_centro)
                THEN (SELECT coalesce(range_agg(tstzrange(minuto_local(x.dia, h.inicio_min), minuto_local(x.dia, h.fin_min), '[)')),
                                      '{}'::tstzmultirange)
                      FROM dias x JOIN horario_centro h ON h.dia_semana = extract(isodow FROM x.dia))
                ELSE '{}'::tstzmultirange END AS r
  ), ocupado AS (
    SELECT range_agg(r) AS r FROM (
      SELECT tstzrange(c.inicio - interval '10 minutes', upper(rango_hora_clinica(c.inicio, c.fin)), '[)') AS r
      FROM citas c
      WHERE c.profesional_id = p_profesional_id AND c.estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA')
      UNION ALL
      SELECT tstzrange(b.inicio, b.fin, '[)') FROM bloqueos_agenda b WHERE b.profesional_id = p_profesional_id
      UNION ALL
      SELECT tstzrange(t.inicio - interval '10 minutes', upper(rango_hora_clinica(t.inicio, t.fin)), '[)')
      FROM bloqueos_temporales t
      WHERE t.profesional_id = p_profesional_id AND t.expira_en > now()
    ) x
  ), libres AS (
    SELECT v.m,
           unnest((v.r - coalesce((SELECT o.r FROM ocupado o), '{}'::tstzmultirange))
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
  -- El motivo de reprogramacion solo vive mientras la cita esta POR_REPROGRAMAR.
  IF NEW.estado <> 'POR_REPROGRAMAR' THEN
    NEW.motivo_reprogramacion := NULL;
  END IF;
  IF NEW.estado NOT IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') THEN
    RETURN NEW;
  END IF;
  -- Presencial: dentro de un bloque de box suyo (le da el box). Online: sin box.
  IF NEW.modalidad = 'PRESENCIAL' THEN
    SELECT b.espacio_id INTO v_box FROM bloques_atencion b
    WHERE b.profesional_id = NEW.profesional_id AND b.inicio <= NEW.inicio AND b.fin >= NEW.fin;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La cita cae fuera de la disponibilidad del profesional (horas de box apartadas)'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_disponibilidad';
    END IF;
  END IF;
  NEW.espacio_id := v_box;
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

CREATE OR REPLACE FUNCTION public.aplicar_ausencia_profesional()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c record;
BEGIN
  -- Solo sesiones futuras: lo que ya paso no se modifica.
  FOR c IN
    UPDATE citas SET estado = 'POR_REPROGRAMAR', motivo_reprogramacion = 'DIA_SIN_ATENCION', updated_at = now()
    WHERE profesional_id = NEW.profesional_id AND estado IN ('CONFIRMADA', 'SOLICITADA')
      AND inicio >= NEW.inicio AND (NEW.fin IS NULL OR inicio < NEW.fin) AND inicio > now()
    RETURNING id, paciente_id
  LOOP
    IF c.paciente_id IS NOT NULL THEN
      PERFORM encolar_notificacion('CITA_AUSENCIA_PROFESIONAL', c.paciente_id, NULL, c.id, app_usuario_id());
    END IF;
  END LOOP;
  FOR c IN
    WITH canceladas AS (
      UPDATE citas SET estado = 'CANCELADA', updated_at = now()
      WHERE profesional_id = NEW.profesional_id AND estado = 'PROPUESTA'
        AND inicio >= NEW.inicio AND (NEW.fin IS NULL OR inicio < NEW.fin) AND inicio > now()
      RETURNING paciente_id, propuesta_de_id
    )
    SELECT DISTINCT paciente_id, propuesta_de_id FROM canceladas
  LOOP
    PERFORM encolar_notificacion('CITA_CANCELADA', c.paciente_id, NULL, c.propuesta_de_id, app_usuario_id());
  END LOOP;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION reprogramar_fuera_de_horario() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
BEGIN
  FOR c IN
    UPDATE citas ci SET estado = 'POR_REPROGRAMAR', motivo_reprogramacion = 'DIA_SIN_ATENCION', updated_at = now()
    WHERE ci.profesional_id = OLD.profesional_id AND ci.modalidad = OLD.modalidad
      AND ci.estado IN ('CONFIRMADA', 'SOLICITADA') AND ci.inicio > now()
      AND extract(isodow FROM ci.inicio AT TIME ZONE 'America/Santiago') = OLD.dia_semana
      AND NOT en_horario_profesional(ci.profesional_id, ci.modalidad, ci.inicio, ci.fin)
    RETURNING ci.id, ci.paciente_id
  LOOP
    IF c.paciente_id IS NOT NULL THEN
      PERFORM encolar_notificacion('CITA_AUSENCIA_PROFESIONAL', c.paciente_id, NULL, c.id, app_usuario_id());
    END IF;
  END LOOP;
  FOR c IN
    WITH canceladas AS (
      UPDATE citas ci SET estado = 'CANCELADA', updated_at = now()
      WHERE ci.profesional_id = OLD.profesional_id AND ci.modalidad = OLD.modalidad
        AND ci.estado = 'PROPUESTA' AND ci.inicio > now()
        AND extract(isodow FROM ci.inicio AT TIME ZONE 'America/Santiago') = OLD.dia_semana
        AND NOT en_horario_profesional(ci.profesional_id, ci.modalidad, ci.inicio, ci.fin)
      RETURNING ci.paciente_id, ci.propuesta_de_id
    )
    SELECT DISTINCT paciente_id, propuesta_de_id FROM canceladas
  LOOP
    PERFORM encolar_notificacion('CITA_CANCELADA', c.paciente_id, NULL, c.propuesta_de_id, app_usuario_id());
  END LOOP;
  RETURN NULL;
END;
$$;
