-- =============================================================================
-- AUD-01 (E2.3c; ARCOP-04, ARCOP-05, ARCOP-06, ARCOP-07, COM-04; decision D3).
--
-- 1. Bloqueo del tratamiento: ADMIN bloquea los datos de un paciente mientras
--    resuelve una solicitud. Se muestra en sus vistas e impide gestiones
--    NUEVAS: citas, derivaciones y edicion de datos personales o de su adulto
--    responsable. Lo ya agendado se mantiene y la atencion de esas citas se
--    sigue registrando (la ficha es obligacion legal).
-- 2. Cancelacion de datos perifericos: borra contacto, preferencias,
--    respuestas del match y la cuenta del portal; conserva la ficha y la
--    identificacion (nombre, RUT, fecha de nacimiento) y devuelve el motivo
--    legal (Ley 20.584, Decreto 41: minimo 15 años desde la ultima atencion).
-- 3. Comunicaciones por canal: WhatsApp con consentimiento propio, desmarcado
--    por defecto (al reservar o en el portal), con fecha. El envio por
--    WhatsApp es post-MVP; aqui solo el consentimiento y la oposicion.
-- =============================================================================

-- 1. Bloqueo
ALTER TABLE pacientes ADD COLUMN "bloqueo_desde" TIMESTAMPTZ(6),
                      ADD COLUMN "bloqueo_motivo" TEXT,
                      ADD COLUMN "bloqueo_solicitud_id" UUID,
                      ADD COLUMN "bloqueado_por_id" UUID;
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_bloqueo_solicitud_id_fkey" FOREIGN KEY ("bloqueo_solicitud_id") REFERENCES "solicitudes_derechos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_bloqueado_por_id_fkey" FOREIGN KEY ("bloqueado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE pacientes ADD CONSTRAINT pacientes_bloqueo_coherente
  CHECK ((bloqueo_desde IS NULL) = (bloqueado_por_id IS NULL)
         AND (bloqueo_desde IS NULL) = (btrim(coalesce(bloqueo_motivo, '')) = '')
         AND (bloqueo_desde IS NOT NULL OR bloqueo_solicitud_id IS NULL)
         AND char_length(coalesce(bloqueo_motivo, '')) <= 500);

-- Gestiones nuevas sobre un paciente bloqueado -> 55000 (409). Las funciones
-- de bloqueo y cancelacion se autorizan con un ajuste local de la transaccion.
CREATE FUNCTION paciente_bloqueado(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT bloqueo_desde IS NOT NULL FROM pacientes WHERE id = p_paciente_id), false)
    AND coalesce(current_setting('vinculos.gestion_bloqueo', true), '') <> 'on'
$$;

CREATE FUNCTION rechazar_gestion_bloqueada() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_paciente uuid;
BEGIN
  v_paciente := CASE TG_TABLE_NAME
    WHEN 'pacientes' THEN (to_jsonb(NEW) ->> 'id')::uuid
    WHEN 'derivaciones' THEN (SELECT f.paciente_id FROM fichas_clinicas f WHERE f.id = (to_jsonb(NEW) ->> 'ficha_clinica_id')::uuid)
    ELSE (to_jsonb(NEW) ->> 'paciente_id')::uuid END;
  IF v_paciente IS NOT NULL AND paciente_bloqueado(v_paciente) THEN
    RAISE EXCEPTION 'El tratamiento de datos de este paciente esta bloqueado por una solicitud del titular: no se pueden hacer gestiones nuevas'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'pacientes_tratamiento_bloqueado';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION rechazar_gestion_bloqueada() FROM PUBLIC;
CREATE TRIGGER citas_paciente_bloqueado BEFORE INSERT ON citas
  FOR EACH ROW EXECUTE FUNCTION rechazar_gestion_bloqueada();
CREATE TRIGGER derivaciones_paciente_bloqueado BEFORE INSERT ON derivaciones
  FOR EACH ROW EXECUTE FUNCTION rechazar_gestion_bloqueada();
CREATE TRIGGER adultos_responsables_paciente_bloqueado BEFORE INSERT OR UPDATE ON adultos_responsables
  FOR EACH ROW EXECUTE FUNCTION rechazar_gestion_bloqueada();
CREATE TRIGGER pacientes_bloqueado BEFORE UPDATE ON pacientes
  FOR EACH ROW WHEN (OLD.bloqueo_desde IS NOT NULL) EXECUTE FUNCTION rechazar_gestion_bloqueada();

CREATE FUNCTION bloquear_tratamiento(p_paciente_id uuid, p_motivo text, p_solicitud_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Bloquea el tratamiento un ADMIN del centro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'El bloqueo exige motivo' USING ERRCODE = 'check_violation', CONSTRAINT = 'pacientes_bloqueo_coherente';
  END IF;
  IF p_solicitud_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM solicitudes_derechos WHERE id = p_solicitud_id
                                                AND (paciente_id IS NULL OR paciente_id = p_paciente_id)) THEN
    RAISE EXCEPTION 'La solicitud no corresponde a este paciente' USING ERRCODE = 'check_violation', CONSTRAINT = 'pacientes_bloqueo_coherente';
  END IF;
  PERFORM set_config('vinculos.gestion_bloqueo', 'on', true);
  UPDATE pacientes SET bloqueo_desde = now(), bloqueo_motivo = btrim(p_motivo), bloqueo_solicitud_id = p_solicitud_id,
                       bloqueado_por_id = app_usuario_id()
  WHERE id = p_paciente_id AND bloqueo_desde IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El paciente no existe o ya esta bloqueado' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM set_config('vinculos.gestion_bloqueo', '', true);
END;
$$;

CREATE FUNCTION levantar_bloqueo(p_paciente_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Levanta el bloqueo un ADMIN del centro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('vinculos.gestion_bloqueo', 'on', true);
  UPDATE pacientes SET bloqueo_desde = NULL, bloqueo_motivo = NULL, bloqueo_solicitud_id = NULL, bloqueado_por_id = NULL
  WHERE id = p_paciente_id AND bloqueo_desde IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El paciente no esta bloqueado' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM set_config('vinculos.gestion_bloqueo', '', true);
END;
$$;

-- 2. Comunicaciones por canal (WhatsApp con consentimiento propio)
ALTER TABLE preferencias_notificacion ADD COLUMN "whatsapp" BOOLEAN NOT NULL DEFAULT false,
                                      ADD COLUMN "whatsapp_consentido_en" TIMESTAMPTZ(6);
ALTER TABLE preferencias_notificacion ADD CONSTRAINT preferencias_notificacion_whatsapp_coherente
  CHECK (whatsapp = (whatsapp_consentido_en IS NOT NULL));
-- La fecha del consentimiento la fija la BD (no la API).
CREATE FUNCTION fechar_consentimiento_whatsapp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.whatsapp_consentido_en := CASE
    WHEN NOT NEW.whatsapp THEN NULL
    WHEN TG_OP = 'UPDATE' AND OLD.whatsapp THEN OLD.whatsapp_consentido_en
    ELSE coalesce(NEW.whatsapp_consentido_en, now()) END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preferencias_notificacion_whatsapp BEFORE INSERT OR UPDATE ON preferencias_notificacion
  FOR EACH ROW EXECUTE FUNCTION fechar_consentimiento_whatsapp();
GRANT INSERT (whatsapp), UPDATE (whatsapp) ON preferencias_notificacion TO app_user;

-- Consentimiento al reservar (sin cuenta): la solicitud lo guarda y pasa al paciente al concretarse.
ALTER TABLE solicitudes_hora ADD COLUMN "acepta_whatsapp_en" TIMESTAMPTZ(6);
CREATE FUNCTION consentir_whatsapp_solicitud(p_id uuid, p_reserva_hash bytea) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE solicitudes_hora SET acepta_whatsapp_en = now()
  WHERE id = p_id AND reserva_hash = p_reserva_hash AND paciente_id IS NULL AND acepta_whatsapp_en IS NULL
$$;
CREATE FUNCTION whatsapp_desde_solicitud() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO preferencias_notificacion (paciente_id, whatsapp, whatsapp_consentido_en)
  VALUES (NEW.paciente_id, true, NEW.acepta_whatsapp_en)
  ON CONFLICT (paciente_id) DO UPDATE SET whatsapp = true,
    whatsapp_consentido_en = coalesce(preferencias_notificacion.whatsapp_consentido_en, EXCLUDED.whatsapp_consentido_en);
  RETURN NEW;
END;
$$;
CREATE TRIGGER solicitudes_hora_whatsapp AFTER UPDATE OF paciente_id ON solicitudes_hora
  FOR EACH ROW WHEN (NEW.paciente_id IS NOT NULL AND OLD.paciente_id IS NULL AND NEW.acepta_whatsapp_en IS NOT NULL)
  EXECUTE FUNCTION whatsapp_desde_solicitud();

-- 3. Cancelacion de datos perifericos (ADMIN, con la solicitud). Devuelve que se conserva y por que.
CREATE FUNCTION cancelar_datos_perifericos(p_paciente_id uuid, p_solicitud_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Aplica la cancelacion un ADMIN del centro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM solicitudes_derechos WHERE id = p_solicitud_id AND tipo = 'CANCELACION'
                 AND estado IN ('RECIBIDA', 'EN_CURSO') AND (paciente_id IS NULL OR paciente_id = p_paciente_id)) THEN
    RAISE EXCEPTION 'Se aplica con una solicitud de cancelacion abierta de este paciente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_derechos_cancelacion';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pacientes WHERE id = p_paciente_id) THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM set_config('vinculos.gestion_bloqueo', 'on', true);
  UPDATE pacientes SET email = NULL, telefono = NULL, contacto_emergencia = NULL, updated_at = now() WHERE id = p_paciente_id;
  UPDATE preferencias_notificacion SET recordatorios = false, avisos_operativos = false, whatsapp = false, updated_at = now()
  WHERE paciente_id = p_paciente_id;
  UPDATE solicitudes_hora SET respuestas = NULL, telefono = NULL, adulto_telefono = NULL, acepta_whatsapp_en = NULL
  WHERE paciente_id = p_paciente_id;
  UPDATE usuarios SET activo = false WHERE paciente_id = p_paciente_id AND activo;
  PERFORM set_config('vinculos.gestion_bloqueo', '', true);
  RETURN 'Se eliminaron el correo, el telefono, el contacto de emergencia, las preferencias de aviso, las respuestas del match '
      || 'y la cuenta del portal. La ficha clinica y los datos que identifican al paciente (nombre, RUT y fecha de nacimiento) '
      || 'se conservan al menos 15 años desde la ultima atencion por obligacion legal (Ley 20.584 y Decreto 41): no se eliminan.';
END;
$$;

REVOKE EXECUTE ON FUNCTION paciente_bloqueado(uuid), bloquear_tratamiento(uuid, text, uuid), levantar_bloqueo(uuid),
  consentir_whatsapp_solicitud(uuid, bytea), cancelar_datos_perifericos(uuid, uuid), whatsapp_desde_solicitud() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION paciente_bloqueado(uuid), bloquear_tratamiento(uuid, text, uuid), levantar_bloqueo(uuid),
  consentir_whatsapp_solicitud(uuid, bytea), cancelar_datos_perifericos(uuid, uuid) TO app_user;
