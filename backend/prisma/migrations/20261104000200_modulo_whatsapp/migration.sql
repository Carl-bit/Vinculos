-- =============================================================================
-- Modulo contratado WHATSAPP (2026-11-03).
--
-- El canal WhatsApp existe solo si el centro lo contrato: es un modulo mas de
-- modulos_activos (lo activa el operador, sin GRANT a la API). Desactivado por
-- defecto: no se agrega a ningun centro ni al DEFAULT de la columna.
--
-- Sin el modulo:
--   - el paciente no puede dar el consentimiento nuevo (23514 -> 422);
--   - el consentimiento al reservar (solicitud) se ignora y no pasa al paciente.
-- Un consentimiento ya dado se conserva (el paciente puede retirarlo siempre).
-- Tablas tocadas: preferencias_notificacion (A), solicitudes_hora (B). Sin
-- tablas ni GRANT nuevos.
-- =============================================================================

ALTER TYPE modulo_centro ADD VALUE IF NOT EXISTS 'WHATSAPP';

-- Se compara como texto: el valor nuevo del enum no se puede usar en la misma
-- transaccion que lo crea.
CREATE FUNCTION whatsapp_contratado() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce('WHATSAPP' = ANY (modulos_activos::text[]), false) FROM configuracion_centro
$$;
REVOKE ALL ON FUNCTION whatsapp_contratado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_contratado() TO app_user;

CREATE OR REPLACE FUNCTION fechar_consentimiento_whatsapp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Consentimiento nuevo (no el que ya estaba) solo con el modulo contratado.
  IF NEW.whatsapp AND (TG_OP = 'INSERT' OR NOT OLD.whatsapp) AND NOT coalesce(whatsapp_contratado(), false) THEN
    RAISE EXCEPTION 'El centro no tiene avisos por WhatsApp'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'preferencias_notificacion_whatsapp_modulo';
  END IF;
  NEW.whatsapp_consentido_en := CASE
    WHEN NOT NEW.whatsapp THEN NULL
    WHEN TG_OP = 'UPDATE' AND OLD.whatsapp THEN OLD.whatsapp_consentido_en
    ELSE coalesce(NEW.whatsapp_consentido_en, now()) END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION consentir_whatsapp_solicitud(p_id uuid, p_reserva_hash bytea) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE solicitudes_hora SET acepta_whatsapp_en = now()
  WHERE id = p_id AND reserva_hash = p_reserva_hash AND paciente_id IS NULL AND acepta_whatsapp_en IS NULL
    AND whatsapp_contratado()
$$;

-- Al concretarse la solicitud: sin el modulo (se desactivo entre medio) no se
-- traspasa, para no romper la concrecion con el 23514 del trigger.
CREATE OR REPLACE FUNCTION whatsapp_desde_solicitud() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT coalesce(whatsapp_contratado(), false) THEN
    RETURN NEW;
  END IF;
  INSERT INTO preferencias_notificacion (paciente_id, whatsapp, whatsapp_consentido_en)
  VALUES (NEW.paciente_id, true, NEW.acepta_whatsapp_en)
  ON CONFLICT (paciente_id) DO UPDATE SET whatsapp = true,
    whatsapp_consentido_en = coalesce(preferencias_notificacion.whatsapp_consentido_en, EXCLUDED.whatsapp_consentido_en);
  RETURN NEW;
END;
$$;
