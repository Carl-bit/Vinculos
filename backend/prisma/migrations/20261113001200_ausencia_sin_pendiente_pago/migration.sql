-- Punto 9: el bloqueo no toca PENDIENTE_PAGO. Esa hora es del modulo COBROS
-- (dormido en el MVP) y tiene su propia regla: si ya no cabe en la agenda, el
-- job la libera con aviso (caso 128). 20261113001100 la incluia.
CREATE OR REPLACE FUNCTION aplicar_ausencia_profesional() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
BEGIN
  FOR c IN
    UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
    WHERE profesional_id = NEW.profesional_id AND estado IN ('CONFIRMADA', 'SOLICITADA')
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
