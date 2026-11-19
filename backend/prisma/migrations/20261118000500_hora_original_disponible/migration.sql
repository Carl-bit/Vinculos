-- =============================================================================
-- 2026-11-18 (6): la hora original vuelve a estar disponible.
--
-- Si el profesional vuelve a activar un dia (o agrega horario, o quita un "dia
-- sin atencion") y quedan citas POR_REPROGRAMAR por ese motivo cuya hora
-- original vuelve a estar libre, la cita pasa a motivo HORA_DISPONIBLE y el
-- paciente recibe CITA_HORA_DISPONIBLE: puede mantener su hora original o, si
-- ya pidio otra, quedarse con una de las dos (mantener_hora_original). Pedir
-- otra hora, cancelar o atencion temporal siguen como antes.
--
-- Sin tablas nuevas. mantener_hora_original: SECURITY DEFINER, EXECUTE solo
-- app_user (PACIENTE/RESPONSABLE de la cita).
-- =============================================================================

ALTER TABLE citas DROP CONSTRAINT citas_motivo_reprogramacion_valido,
  ADD CONSTRAINT citas_motivo_reprogramacion_valido
    CHECK (motivo_reprogramacion IS NULL OR motivo_reprogramacion IN ('DIA_SIN_ATENCION', 'HORA_DISPONIBLE'));

-- Citas por reprogramar por dia sin atencion de un profesional cuya hora original vuelve a estar libre (la misma
-- regla de la agenda publica: horario, box, bloqueos, hora clinica). Se avisa una sola vez por cita.
CREATE FUNCTION avisar_horas_disponibles(p_profesional_id uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  n int := 0;
BEGIN
  FOR c IN
    SELECT ci.id, ci.paciente_id FROM citas ci
    WHERE ci.profesional_id = p_profesional_id AND ci.estado = 'POR_REPROGRAMAR'
      AND ci.motivo_reprogramacion = 'DIA_SIN_ATENCION' AND ci.inicio > now()
      AND EXISTS (SELECT 1 FROM disponibilidad_publica(ci.profesional_id, ci.inicio - interval '1 minute', ci.fin + interval '1 minute') d
                  WHERE d.modalidad = ci.modalidad AND d.inicio <= ci.inicio AND d.fin >= ci.fin)
    FOR UPDATE
  LOOP
    UPDATE citas SET motivo_reprogramacion = 'HORA_DISPONIBLE', updated_at = now() WHERE id = c.id;
    IF c.paciente_id IS NOT NULL THEN
      PERFORM encolar_notificacion('CITA_HORA_DISPONIBLE', c.paciente_id, NULL, c.id, app_usuario_id());
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION avisar_horas_disponibles(uuid) FROM PUBLIC;

CREATE FUNCTION avisar_horas_disponibles_horario() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM avisar_horas_disponibles(NEW.profesional_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION avisar_horas_disponibles_horario() FROM PUBLIC;
CREATE TRIGGER disponibilidad_profesional_hora_disponible AFTER INSERT OR UPDATE ON disponibilidad_profesional
  FOR EACH ROW WHEN (NEW.activo) EXECUTE FUNCTION avisar_horas_disponibles_horario();

CREATE FUNCTION avisar_horas_disponibles_bloqueo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM avisar_horas_disponibles(OLD.profesional_id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION avisar_horas_disponibles_bloqueo() FROM PUBLIC;
CREATE TRIGGER bloqueos_agenda_hora_disponible AFTER DELETE ON bloqueos_agenda
  FOR EACH ROW WHEN (OLD.motivo <> 'BAJA') EXECUTE FUNCTION avisar_horas_disponibles_bloqueo();

-- El paciente (o su adulto responsable) mantiene su hora original: vuelve a CONFIRMADA si sigue libre (el trigger
-- y el EXCLUDE de la agenda deciden: tomada -> 23P01, 409). Si ya habia pedido otra hora y prefiere la original,
-- p_cancelar es esa otra (suya, vigente y futura), que se cancela con aviso al profesional.
CREATE FUNCTION mantener_hora_original(p_cita_id uuid, p_cancelar uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  o record;
BEGIN
  SELECT id, paciente_id, profesional_id, estado::text AS estado, inicio INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND OR NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE')
     OR NOT (coalesce(c.paciente_id = app_paciente_id(), false)
             OR coalesce(c.paciente_id IN (SELECT pacientes_a_cargo()), false)) THEN
    RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'POR_REPROGRAMAR' OR c.inicio <= now() THEN
    RAISE EXCEPTION 'La hora ya no esta por reprogramar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_cancelar IS NOT NULL THEN
    SELECT id, profesional_id INTO o FROM citas
    WHERE id = p_cancelar AND paciente_id = c.paciente_id AND id <> c.id
      AND estado IN ('CONFIRMADA', 'SOLICITADA') AND inicio > now()
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'no_data_found';
    END IF;
    UPDATE citas SET estado = 'CANCELADA', enlace_online = NULL, updated_at = now() WHERE id = o.id;
    PERFORM encolar_notificacion('CITA_CANCELADA', NULL, o.profesional_id, o.id, app_usuario_id());
  END IF;
  UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = c.id;
  PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, app_usuario_id());
  RETURN 'CONFIRMADA';
END;
$$;
REVOKE ALL ON FUNCTION mantener_hora_original(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mantener_hora_original(uuid, uuid) TO app_user;

-- El aviso lleva la cita como referencia (como CITA_AUSENCIA_PROFESIONAL).
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('notificaciones_por_enviar(int)'::regprocedure);
  nuevo := replace(def, $q$'PROPUESTA_ACEPTADA', 'CITA_AUSENCIA_PROFESIONAL') THEN t.referencia_id$q$,
                        $q$'PROPUESTA_ACEPTADA', 'CITA_AUSENCIA_PROFESIONAL', 'CITA_HORA_DISPONIBLE') THEN t.referencia_id$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'notificaciones_por_enviar no trae la lista de avisos esperada';
  END IF;
  EXECUTE nuevo;
END $$;

INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'CITA_HORA_DISPONIBLE'::tipo_notificacion, 'PACIENTE'::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('Tu hora vuelve a estar disponible',
   'Hola {{nombre_paciente}}: {{nombre_profesional}} vuelve a atender el {{fecha}} a las {{hora}}. Si quieres mantener esa hora, confírmalo en tu cuenta; si ya pediste otra, eliges con cuál te quedas: {{enlace}}')
) AS e(asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);
