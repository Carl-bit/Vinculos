-- =============================================================================
-- 2026-11-18 (2): sin margen de traslado; hora clinica (cada sesion ocupa su hora);
-- aviso al paciente cuando el profesional agrega el enlace de la sala.
--
-- 1. Margen de traslado fuera (decision 2026-11-18): el horario online del
--    profesional queda libre (puede alternar online y presencial sin margen) y
--    el espacio fisico solo depende de la disponibilidad del box. Se quitan el
--    EXCLUDE citas_margen_traslado, las columnas margen_traslado_min (citas,
--    profesionales, configuracion_centro), fijar_margen_cita, margen_vigente,
--    citas_en_conflicto_margen, rango_con_margen y citas.en_centro (de la
--    migracion anterior, que solo servia para el margen).
-- 2. Hora clinica: las sesiones son de 50 minutos a la hora en punto; el resto
--    de la hora es del profesional (cerrar la ficha, transicion) y nadie agenda
--    en el. Una sesion ocupa al menos una hora de su agenda: EXCLUDE
--    citas_no_solapamiento_profesional sobre rango_hora_clinica(inicio, fin) =
--    [inicio, max(fin, inicio + 1 h)). Dos sesiones de una hora seguidas siguen
--    validas.
-- 3. Plantillas ENLACE_ONLINE (paciente, correo y bandeja): el profesional
--    agrega o cambia el enlace de una cita online (PUT /citas/:id/enlace).
--
-- Sin tablas nuevas ni GRANT nuevo.
-- =============================================================================

-- Rango que ocupa una sesion en la agenda de su profesional: al menos su hora.
-- IMMUTABLE para el EXCLUDE: suma una hora fija (no depende de la zona).
CREATE FUNCTION rango_hora_clinica(p_inicio timestamptz, p_fin timestamptz) RETURNS tstzrange
LANGUAGE sql IMMUTABLE AS $$
  SELECT tstzrange(p_inicio, greatest(p_fin, p_inicio + interval '1 hour'), '[)')
$$;

-- Triggers y funciones que usan en_centro o el margen, antes de quitar columnas.
DROP TRIGGER citas_agenda_valida ON citas;
DROP TRIGGER citas_margen_fijado ON citas;
DROP FUNCTION fijar_margen_cita();
DROP FUNCTION citas_en_conflicto_margen(uuid);

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
CREATE TRIGGER citas_agenda_valida BEFORE INSERT OR UPDATE OF estado, inicio, fin, profesional_id, modalidad, espacio_id ON citas
  FOR EACH ROW EXECUTE FUNCTION validar_agenda_cita();

-- Liberar un bloque: lo impiden sus citas o retenciones presenciales (las online no dependen del box).
CREATE OR REPLACE FUNCTION public.proteger_bloque_atencion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM citas c
             WHERE c.profesional_id = OLD.profesional_id AND c.modalidad = 'PRESENCIAL'
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

-- Disponibilidad sin margen: cada cita, retencion o soft-lock ocupa su hora clinica y, antes, los 10 minutos que
-- la sesion nueva de 50 necesita para cerrar su propia hora; asi la hora ofrecida cumple el EXCLUDE.
-- ponytail: supone sesiones de 50 min (DURACION_SESION_MIN del front); con duracion por profesional, usarla aqui.
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
    FROM dias x JOIN disponibilidad_profesional d ON d.profesional_id = p_profesional_id AND d.dia_semana = extract(isodow FROM x.dia)
    GROUP BY d.modalidad
  ), ventanas AS (
    -- Presencial: horas de box apartadas, recortadas a su horario presencial si lo tiene.
    SELECT 'PRESENCIAL'::modalidad_atencion AS m,
           range_agg(tstzrange(b.inicio, b.fin, '[)'))
           * CASE WHEN EXISTS (SELECT 1 FROM disponibilidad_profesional d
                               WHERE d.profesional_id = p_profesional_id AND d.modalidad = 'PRESENCIAL')
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

DROP FUNCTION margen_vigente(uuid);

ALTER TABLE citas
  DROP CONSTRAINT citas_margen_traslado,
  DROP CONSTRAINT citas_no_solapamiento_profesional,
  DROP COLUMN en_centro,
  DROP COLUMN margen_traslado_min;
DROP FUNCTION rango_con_margen(timestamptz, timestamptz, integer);
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_profesional EXCLUDE USING gist (profesional_id WITH =, rango_hora_clinica(inicio, fin) WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA'));
ALTER TABLE profesionales DROP COLUMN margen_traslado_min;
ALTER TABLE configuracion_centro
  DROP CONSTRAINT configuracion_centro_plazos_01f,
  DROP COLUMN margen_traslado_min,
  ADD CONSTRAINT configuracion_centro_plazos_01f CHECK (plazo_oposicion_horas > 0 AND dias_gracia_cierre >= 0);

-- 3. Aviso del enlace de la sala (lo agrega el profesional despues de agendar).
INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'ENLACE_ONLINE'::tipo_notificacion, 'PACIENTE'::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('Sala de tu sesión online',
   'Hola {{nombre_paciente}}: {{nombre_profesional}} agregó la sala virtual para tu sesión online del {{fecha}} a las {{hora}}. Entra aquí: {{enlace}}')
) AS e(asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal)
ON CONFLICT (evento, destinatario, canal) DO NOTHING;

-- Vinculos Control puede seguir enviando margen_traslado_min: se acepta y se ignora (resto igual a 20261116000000).
CREATE OR REPLACE FUNCTION public.aplicar_config_interna(p_token text, p_revision integer, p_hash text, p_modulos modulo_centro[], p_reglas jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Lista cerrada (CAMPOS_REGLAS del manifiesto). Nada de nombres libres en el SQL dinamico.
  c_reglas CONSTANT text[] := ARRAY[
    'rol_gestion_habilitado', 'max_cuentas_madre', 'plazo_aviso_cancelacion_horas', 'recordatorio_horas_antes',
    'margen_traslado_min', 'horas_aprobacion_solicitud', 'minutos_retencion_solicitud', 'plazo_respuesta_derivacion_horas',
    'plazo_consentimiento_horas', 'plazo_oposicion_horas', 'match_filtro_directo', 'dias_retencion_respuestas_match',
    'edad_minima_cuenta', 'dias_gracia_cierre', 'retencion_mensajes_dias'];
  v_id identidad_silo%ROWTYPE;
  v_actual configuracion_centro%ROWTYPE;
  v_nueva configuracion_centro%ROWTYPE;
  v_modulos modulo_centro[];
  k text;
  v_set text;
BEGIN
  IF NOT interno_token_valido(p_token) OR app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el plano de control (token del silo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_revision IS NULL OR p_revision < 1 OR p_hash !~ '^[0-9a-f]{64}$' OR p_modulos IS NULL
     OR jsonb_typeof(coalesce(p_reglas, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Revision, hash, modulos o reglas con formato invalido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_interna_formato';
  END IF;
  SELECT * INTO v_id FROM identidad_silo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El silo no tiene identidad (migrate sin identidad_silo.js)' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_id.revision_aplicada = p_revision AND v_id.hash_aplicado = p_hash THEN
    RETURN 'SIN_CAMBIOS';
  END IF;
  IF v_id.revision_aplicada IS NOT NULL AND p_revision <= v_id.revision_aplicada THEN
    RAISE EXCEPTION 'La revision % no es posterior a la aplicada (%)', p_revision, v_id.revision_aplicada
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  SELECT coalesce(array_agg(DISTINCT m ORDER BY m), '{}') INTO v_modulos FROM unnest(p_modulos) AS m;
  IF ('MATCH' = ANY (v_modulos) OR 'PAGINA_PUBLICA' = ANY (v_modulos)) AND NOT 'EQUIPO' = ANY (v_modulos) THEN
    RAISE EXCEPTION 'Dependencias de modulos: MATCH y PAGINA_PUBLICA requieren EQUIPO'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_interna_dependencias';
  END IF;
  FOR k IN SELECT jsonb_object_keys(coalesce(p_reglas, '{}'::jsonb)) LOOP
    IF NOT k = ANY (c_reglas) THEN
      RAISE EXCEPTION 'Regla desconocida: %', k USING ERRCODE = 'check_violation', CONSTRAINT = 'config_interna_regla';
    END IF;
  END LOOP;
  -- 2026-11-18: el margen de traslado ya no existe; Vinculos Control puede seguir enviandolo y se ignora.
  p_reglas := coalesce(p_reglas, '{}'::jsonb) - 'margen_traslado_min';

  UPDATE configuracion_centro SET modulos_activos = v_modulos WHERE id;
  -- Tipos y rangos: jsonb_populate_record convierte con el tipo de cada columna;
  -- los CHECK y triggers de configuracion_centro validan como en una edicion del ADMIN.
  SELECT * INTO v_actual FROM configuracion_centro WHERE id;
  v_nueva := jsonb_populate_record(v_actual, coalesce(p_reglas, '{}'::jsonb));
  -- Un solo UPDATE con todas las reglas: los CHECK entre columnas (por ejemplo,
  -- recordatorio antes del plazo de cancelacion) se evaluan sobre el estado final.
  SELECT string_agg(format('%1$I = ($1).%1$I', x), ', ') INTO v_set FROM jsonb_object_keys(coalesce(p_reglas, '{}'::jsonb)) AS x;
  IF v_set IS NOT NULL THEN
    EXECUTE format('UPDATE configuracion_centro SET %s WHERE id', v_set) USING v_nueva;
  END IF;

  UPDATE identidad_silo SET revision_aplicada = p_revision, hash_aplicado = p_hash, aplicada_en = now();
  RETURN 'APLICADA';
END;
$function$;

