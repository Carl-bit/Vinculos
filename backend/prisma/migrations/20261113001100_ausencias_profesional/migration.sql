-- =============================================================================
-- Punto 9 (correcciones 2026-11-10/11): ausencias del profesional.
--
-- 1. Un bloqueo de agenda (vacaciones, licencia, personal; la causa sin
--    diagnostico) ya no solo resta horas libres: las citas que caen dentro
--    pasan a POR_REPROGRAMAR y cada paciente recibe CITA_AUSENCIA_PROFESIONAL;
--    las horas PROPUESTA del rango se cancelan con aviso. BAJA sigue por
--    iniciar_baja_profesional / iniciar_baja_rol.
-- 2. "No atendera mas": bloqueo sin fin. Sus pacientes pasan a por reasignar
--    (motivo NO_ATIENDE) y el sitio publico deja de ofrecer horas con el
--    (estado_atencion_publica: recibe = false; vuelve_en si el bloqueo tiene fin).
-- 3. El paciente responde desde su cuenta (responder_ausencia): CANCELAR la
--    hora o pedir ATENCION_TEMPORAL con otro profesional (alerta para la
--    cuenta madre; el paciente aparece en por reasignar, motivo
--    ATENCION_TEMPORAL). Reprogramar es pedir otra hora (flujo existente).
--    Nunca obligatorio: siempre lo decide el paciente.
-- =============================================================================

-- 1. El bloqueo reprograma lo que cae dentro.
CREATE FUNCTION aplicar_ausencia_profesional() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
BEGIN
  FOR c IN
    UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
    WHERE profesional_id = NEW.profesional_id AND estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'SOLICITADA')
      AND inicio >= NEW.inicio AND (NEW.fin IS NULL OR inicio < NEW.fin)
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
        AND inicio >= NEW.inicio AND (NEW.fin IS NULL OR inicio < NEW.fin)
      RETURNING paciente_id, propuesta_de_id
    )
    SELECT DISTINCT paciente_id, propuesta_de_id FROM canceladas
  LOOP
    PERFORM encolar_notificacion('CITA_CANCELADA', c.paciente_id, NULL, c.propuesta_de_id, app_usuario_id());
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER bloqueos_agenda_ausencia AFTER INSERT ON bloqueos_agenda
  FOR EACH ROW WHEN (NEW.motivo <> 'BAJA') EXECUTE FUNCTION aplicar_ausencia_profesional();

DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('notificaciones_por_enviar(int)'::regprocedure);
  nuevo := replace(def, $q$'CAMBIO_HORA_PROPUESTO', 'PROPUESTA_ACEPTADA') THEN t.referencia_id$q$,
                        $q$'CAMBIO_HORA_PROPUESTO', 'PROPUESTA_ACEPTADA', 'CITA_AUSENCIA_PROFESIONAL') THEN t.referencia_id$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'notificaciones_por_enviar no trae la lista de avisos esperada';
  END IF;
  EXECUTE nuevo;
END $$;

INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'CITA_AUSENCIA_PROFESIONAL'::tipo_notificacion, 'PACIENTE'::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('Tu profesional no podrá atenderte',
   'Hola {{nombre_paciente}}: {{nombre_profesional}} no podrá atenderte el {{fecha}} a las {{hora}}. En tu cuenta eliges qué hacer: pedir otra hora, cancelarla o atenderte con otro profesional mientras tanto: {{enlace}}')
) AS e(asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);

-- 2. Motivos nuevos de reasignacion: el tratante no atiende (bloqueo sin fin vigente) o el paciente pidio atencion temporal.
CREATE OR REPLACE FUNCTION motivo_reasignacion(p_paciente_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = t.id)
         OR EXISTS (SELECT 1 FROM roles_adicionales r WHERE r.usuario_id = t.id AND r.rol = 'PROFESIONAL'
                    AND r.fecha_baja IS NOT NULL) THEN 'BAJA'
    WHEN t.rol::text = 'PRACTICANTE' AND (NOT t.activo OR t.fecha_expiracion_acceso <= now()) THEN
      coalesce((SELECT CASE WHEN h.accion::text = 'REVOCADO' THEN 'ACCESO_REVOCADO' ELSE 'ACCESO_EXPIRADO' END
                FROM historial_accesos_practicante h WHERE h.practicante_id = t.id
                ORDER BY h.created_at DESC LIMIT 1), 'ACCESO_EXPIRADO')
    WHEN t.rol::text = 'PRACTICANTE' AND supervisor_vigente(t.id) IS NULL THEN 'SIN_SUPERVISION'
    WHEN t.rol::text = 'PRACTICANTE' AND NOT consentimiento_vigente_para(p.id, t.id) THEN 'CONSENTIMIENTO'
    WHEN NOT t.activo OR (t.rol::text <> 'PRACTICANTE' AND NOT tiene_rol(t.id, 'PROFESIONAL')) THEN 'TRATANTE_INACTIVO'
    WHEN EXISTS (SELECT 1 FROM bloqueos_agenda b WHERE b.profesional_id = t.id AND b.motivo <> 'BAJA'
                 AND b.fin IS NULL AND b.inicio <= now()) THEN 'NO_ATIENDE'
    WHEN EXISTS (SELECT 1 FROM alertas_internas a WHERE a.tipo = 'ATENCION_TEMPORAL' AND a.referencia_id = p.id
                 AND a.atendida_en IS NULL) THEN 'ATENCION_TEMPORAL'
  END
  FROM pacientes p JOIN usuarios t ON t.id = p.profesional_id
  WHERE p.id = p_paciente_id AND p.deleted_at IS NULL
$$;

-- Sitio publico: si el profesional recibe pacientes y, si esta ausente con fecha, cuando vuelve. Sin motivo.
CREATE FUNCTION estado_atencion_publica() RETURNS TABLE (profesional_id uuid, recibe boolean, vuelve_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id,
         NOT EXISTS (SELECT 1 FROM bloqueos_agenda b WHERE b.profesional_id = u.id AND b.fin IS NULL AND b.inicio <= now()),
         (SELECT max(b.fin) FROM bloqueos_agenda b WHERE b.profesional_id = u.id AND b.inicio <= now() AND b.fin > now())
  FROM usuarios u
  WHERE u.activo AND u.cerrada_en IS NULL AND (u.rol = 'PROFESIONAL' OR tiene_rol(u.id, 'PROFESIONAL'))
$$;
REVOKE EXECUTE ON FUNCTION estado_atencion_publica() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estado_atencion_publica() TO app_user;

-- 3. Respuesta del paciente a una hora afectada.
CREATE FUNCTION responder_ausencia(p_cita_id uuid, p_opcion text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
BEGIN
  SELECT id, paciente_id, estado::text AS estado INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND OR NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE')
     -- coalesce: con NULL (responsable sin paciente propio) la comparacion no debe dejar pasar.
     OR NOT (coalesce(c.paciente_id = app_paciente_id(), false)
             OR coalesce(c.paciente_id IN (SELECT pacientes_a_cargo()), false)) THEN
    RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'POR_REPROGRAMAR' THEN
    RAISE EXCEPTION 'La hora ya no esta por reprogramar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_opcion = 'CANCELAR' THEN
    UPDATE citas SET estado = 'CANCELADA', updated_at = now() WHERE id = p_cita_id;
  ELSIF p_opcion = 'ATENCION_TEMPORAL' THEN
    INSERT INTO alertas_internas (tipo, referencia_id, detalle)
    VALUES ('ATENCION_TEMPORAL', c.paciente_id,
            'El paciente pide atenderse con otro profesional mientras su tratante no atiende. Derivalo desde Fichas y pacientes > Derivaciones.')
    ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
  ELSE
    RAISE EXCEPTION 'Opcion: CANCELAR o ATENCION_TEMPORAL' USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_respuesta_ausencia';
  END IF;
  RETURN p_opcion;
END;
$$;
REVOKE EXECUTE ON FUNCTION responder_ausencia(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION responder_ausencia(uuid, text) TO app_user;
