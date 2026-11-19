-- =============================================================================
-- 2026-11-18 (3): dias sin atencion.
--
-- 1. Bloquear agenda (vacaciones, licencia, personal) solo toca sesiones
--    futuras: las que ya pasaron (aunque sean del mismo dia) no se modifican.
-- 2. Quitar o cambiar un dia del horario del profesional (disponibilidad_
--    profesional) deja POR_REPROGRAMAR sus sesiones futuras que quedan fuera
--    del horario nuevo y avisa a cada paciente (CITA_AUSENCIA_PROFESIONAL:
--    pide otra hora con el mismo profesional, cancela o se atiende con otro
--    mientras tanto); las horas PROPUESTA que quedan fuera se cancelan con
--    aviso, como en un bloqueo. El profesional las reprograma desde
--    Agenda > Pendientes (flujo existente).
--
-- Sin tablas nuevas ni GRANT nuevo (triggers SECURITY DEFINER).
-- =============================================================================

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
    UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
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

-- Sesiones futuras de ese dia y modalidad que quedan fuera del horario nuevo.
CREATE FUNCTION reprogramar_fuera_de_horario() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
BEGIN
  FOR c IN
    UPDATE citas ci SET estado = 'POR_REPROGRAMAR', updated_at = now()
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
REVOKE ALL ON FUNCTION reprogramar_fuera_de_horario() FROM PUBLIC;
CREATE TRIGGER disponibilidad_profesional_reprograma AFTER DELETE OR UPDATE ON disponibilidad_profesional
  FOR EACH ROW EXECUTE FUNCTION reprogramar_fuera_de_horario();
