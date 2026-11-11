-- =============================================================================
-- Correcciones 2026-11-11, puntos 6 y 7 (MVP sin COBROS).
--
-- Punto 6: la hora que pide el paciente queda bloqueada 24 h (las horas de
-- horas_aprobacion_solicitud), no 30 minutos. La reserva sin cuenta retiene la
-- hora con ese mismo plazo mientras se verifica el correo, y la aprobacion del
-- profesional vence en el MISMO plazo (una sola ventana desde que se pidio la
-- hora, no 24 h nuevas tras verificar). Con COBROS (implementacion futura)
-- sigue el plazo de pago (minutos_retencion_solicitud).
--
-- Punto 7: el profesional que no acepta la solicitud puede proponer otras
-- horas de su agenda (1 a 5). La solicitud se cancela y cada propuesta queda
-- como cita PROPUESTA, bloqueada (EXCLUDE) hasta que el paciente elige o vence
-- el plazo:
--   - aceptar_propuesta: la elegida -> CONFIRMADA; las demas -> CANCELADA.
--   - rechazar_propuestas: ninguna le acomoda -> todas CANCELADA, aviso al
--     profesional; el paciente vuelve a elegir entre las horas libres.
--   - vencer_solicitudes (job): propuestas vencidas -> CANCELADA, un aviso al
--     paciente por grupo.
-- La API nunca fija ni saca PROPUESTA (solo puede cancelarla); el enlace de
-- videollamada de una propuesta online lo genera la API al proponer.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Citas: propuesta de cambio de hora
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "citas" ADD COLUMN "propuesta_de_id" UUID;
-- Sin GRANT de INSERT/UPDATE a app_user: solo lo fija proponer_cambio_hora.

-- CreateIndex
CREATE INDEX "citas_propuesta_de_id_idx" ON "citas"("propuesta_de_id");

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_propuesta_de_id_fkey" FOREIGN KEY ("propuesta_de_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE citas DROP CONSTRAINT citas_aprobacion_coherente;
ALTER TABLE citas ADD CONSTRAINT citas_aprobacion_coherente
  CHECK (estado NOT IN ('SOLICITADA', 'PROPUESTA') OR aprobacion_vence_en IS NOT NULL);
ALTER TABLE citas ADD CONSTRAINT citas_propuesta_coherente
  CHECK (estado <> 'PROPUESTA' OR propuesta_de_id IS NOT NULL);

ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_espacio;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_espacio
  EXCLUDE USING gist (espacio_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') AND modalidad = 'PRESENCIAL');
ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_profesional;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_profesional
  EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA', 'SOLICITADA', 'PROPUESTA'));

-- La API no fija ni saca SOLICITADA/PROPUESTA (solo puede cancelarlas), ni sus plazos ni el vinculo.
CREATE OR REPLACE FUNCTION proteger_estado_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') OR NEW.aprobacion_vence_en IS NOT NULL
       OR NEW.propuesta_de_id IS NOT NULL
       OR NEW.medio_confirmacion IS NOT NULL
       OR NEW.pago_vence_en IS NOT NULL OR NEW.ultimo_aviso_pago IS NOT NULL OR NEW.medio_saldo IS NOT NULL
       OR NEW.aviso_deuda_en IS NOT NULL OR NEW.liberada_por_id IS NOT NULL OR NEW.motivo_liberacion IS NOT NULL THEN
      RAISE EXCEPTION 'El estado de pago de la cita solo lo fija el flujo de confirmacion' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.estado = 'RETENIDA'
        OR NEW.medio_confirmacion IS DISTINCT FROM OLD.medio_confirmacion OR NEW.pago_vence_en IS DISTINCT FROM OLD.pago_vence_en
        OR NEW.ultimo_aviso_pago IS DISTINCT FROM OLD.ultimo_aviso_pago
        OR NEW.aprobacion_vence_en IS DISTINCT FROM OLD.aprobacion_vence_en
        OR NEW.propuesta_de_id IS DISTINCT FROM OLD.propuesta_de_id
        OR NEW.agendada_por_equipo IS DISTINCT FROM OLD.agendada_por_equipo
        OR NEW.aviso_deuda_en IS DISTINCT FROM OLD.aviso_deuda_en
        OR NEW.medio_saldo IS DISTINCT FROM OLD.medio_saldo
        OR (NEW.liberada_por_id, NEW.motivo_liberacion) IS DISTINCT FROM (OLD.liberada_por_id, OLD.motivo_liberacion)
        OR (NEW.estado IS DISTINCT FROM OLD.estado
            AND (NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') OR OLD.estado = 'LIBERADA'
                 OR (OLD.estado IN ('SOLICITADA', 'PROPUESTA') AND NEW.estado <> 'CANCELADA')
                 OR (OLD.estado = 'PENDIENTE_PAGO' AND NEW.estado <> 'CANCELADA'))) THEN
    RAISE EXCEPTION 'El estado de pago de la cita solo lo fija el flujo de confirmacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Listas de estados y plazo de la reserva (reescritura acotada; si un texto
--    esperado no aparece, la migracion falla)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  f text;
  def text;
  nuevo text;
BEGIN
  -- Hora ocupada (ocupacion, disponibilidad, agenda, monto): suma PROPUESTA.
  FOREACH f IN ARRAY ARRAY[
    'disponibilidad_publica(uuid, timestamptz, timestamptz)', 'estado_fichas_profesional(uuid)', 'fijar_monto_cita()',
    'ocupacion_espacios(timestamptz, timestamptz)', 'proteger_bloque_atencion()', 'sesiones_espacios(timestamptz, timestamptz)',
    'validar_agenda_cita()'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def, $q$IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA', 'SOLICITADA')$q$,
                          $q$IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA', 'SOLICITADA', 'PROPUESTA')$q$);
    IF nuevo = def THEN
      RAISE EXCEPTION 'La funcion % no trae la lista de estados esperada', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;

  -- Punto 6: sin COBROS, la reserva sin cuenta retiene la hora el plazo de aprobacion (24 h), no el de pago.
  def := pg_get_functiondef('crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea, bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea, bytea)'::regprocedure);
  nuevo := replace(def, $q$v_expira timestamptz := plazo_pago(p_inicio);$q$,
                        $q$v_expira timestamptz := CASE WHEN (SELECT 'COBROS' = ANY (coalesce(modulos_activos, '{}')) FROM configuracion_centro)
                                 THEN plazo_pago(p_inicio) ELSE plazo_aprobacion(p_inicio) END;$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'crear_solicitud_hora no trae el plazo esperado';
  END IF;
  EXECUTE nuevo;

  -- Punto 6: verificar el correo no reinicia el plazo; el profesional aprueba dentro de la misma ventana.
  def := pg_get_functiondef('concretar_reserva(uuid, bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz)'::regprocedure);
  nuevo := replace(def, $q$aprobacion_vence_en = CASE WHEN v_aprueba THEN plazo_aprobacion(c.inicio) END,$q$,
                        $q$aprobacion_vence_en = CASE WHEN v_aprueba THEN
                       CASE WHEN c.pago_vence_en > now() THEN c.pago_vence_en ELSE plazo_aprobacion(c.inicio) END END,$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'concretar_reserva no trae el plazo esperado';
  END IF;
  EXECUTE nuevo;

  -- Job de mensajes: el aviso de propuesta trae fecha, hora y profesional de la solicitud original.
  def := pg_get_functiondef('notificaciones_por_enviar(int)'::regprocedure);
  nuevo := replace(def, $q$'PAGO_VALIDADO', 'PAGO_RECHAZADO', 'PAGO_PENDIENTE', 'DEUDA_PENDIENTE') THEN t.referencia_id$q$,
                        $q$'PAGO_VALIDADO', 'PAGO_RECHAZADO', 'PAGO_PENDIENTE', 'DEUDA_PENDIENTE',
                             'CAMBIO_HORA_PROPUESTO') THEN t.referencia_id$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'notificaciones_por_enviar no trae la lista de avisos esperada';
  END IF;
  EXECUTE nuevo;
END $$;

INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'CAMBIO_HORA_PROPUESTO'::tipo_notificacion, 'PACIENTE'::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('Su profesional le propone otra hora',
   'Hola {{nombre_paciente}}: {{nombre_profesional}} no puede atenderle el {{fecha}} a las {{hora}} y le propone otras horas. Las guardamos para usted por un tiempo limitado: elija una en su cuenta o pida otra: {{enlace}}')
) AS e(asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);

-- -----------------------------------------------------------------------------
-- 3. Proponer, aceptar, rechazar y vencer
-- -----------------------------------------------------------------------------
-- Solo el profesional de la cita SOLICITADA, con el rol PROFESIONAL activo.
-- p_opciones: [{"inicio": timestamptz, "fin": timestamptz, "modalidad": modalidad_atencion}], 1 a 5.
-- Cada hora pasa por el EXCLUDE y validar_agenda_cita (bloque del profesional, box): tomada -> 23P01 (409).
CREATE FUNCTION proponer_cambio_hora(p_cita_id uuid, p_opciones jsonb) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  o jsonb;
  v_inicio timestamptz;
  v_id uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' THEN
    RAISE EXCEPTION 'proponer_cambio_hora: solo el profesional de la cita' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_opciones) IS DISTINCT FROM 'array' OR jsonb_array_length(p_opciones) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Propon entre 1 y 5 horas' USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_propuestas_cantidad';
  END IF;
  SELECT * INTO c FROM citas WHERE id = p_cita_id AND profesional_id = app_usuario_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'SOLICITADA' THEN
    RAISE EXCEPTION 'La solicitud ya no esta por aprobar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- Primero se suelta la hora pedida: una propuesta puede ser el mismo horario en otra modalidad.
  UPDATE citas SET estado = 'CANCELADA', cancelada_en = now(), aprobacion_vence_en = NULL, updated_at = now() WHERE id = c.id;
  FOR o IN SELECT x FROM jsonb_array_elements(p_opciones) AS x LOOP
    v_inicio := (o->>'inicio')::timestamptz;
    IF v_inicio <= now() THEN
      RAISE EXCEPTION 'La hora propuesta ya paso' USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_propuesta_futura';
    END IF;
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en, propuesta_de_id)
    VALUES ((o->>'modalidad')::modalidad_atencion, c.profesional_id, c.paciente_id, v_inicio, (o->>'fin')::timestamptz,
            'PROPUESTA', plazo_aprobacion(v_inicio), c.id)
    RETURNING id INTO v_id;
    RETURN NEXT v_id;
  END LOOP;
  PERFORM encolar_notificacion('CAMBIO_HORA_PROPUESTO', c.paciente_id, NULL, c.id, NULL);
END;
$$;
REVOKE EXECUTE ON FUNCTION proponer_cambio_hora(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION proponer_cambio_hora(uuid, jsonb) TO app_user;

-- El paciente (o su adulto responsable) elige una propuesta vigente; las otras se sueltan.
CREATE FUNCTION aceptar_propuesta(p_cita_id uuid) RETURNS estado_cita
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'aceptar_propuesta: solo el paciente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND OR NOT (c.paciente_id = app_paciente_id() OR c.paciente_id IN (SELECT pacientes_a_cargo())) THEN
    RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'PROPUESTA' OR c.aprobacion_vence_en <= now() THEN
    RAISE EXCEPTION 'La propuesta ya no esta vigente' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE citas SET estado = 'CANCELADA', cancelada_en = now(), aprobacion_vence_en = NULL, updated_at = now()
  WHERE propuesta_de_id = c.propuesta_de_id AND estado = 'PROPUESTA' AND id <> c.id;
  UPDATE citas SET estado = 'CONFIRMADA', aprobacion_vence_en = NULL, updated_at = now() WHERE id = c.id;
  PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
  RETURN 'CONFIRMADA';
END;
$$;
REVOKE EXECUTE ON FUNCTION aceptar_propuesta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aceptar_propuesta(uuid) TO app_user;

-- Ninguna propuesta le acomoda: se sueltan todas y se avisa al profesional. El
-- paciente vuelve a elegir entre las horas libres (flujo normal de solicitud).
CREATE FUNCTION rechazar_propuestas(p_cita_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  v_n int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'rechazar_propuestas: solo el paciente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND OR NOT (c.paciente_id = app_paciente_id() OR c.paciente_id IN (SELECT pacientes_a_cargo())) THEN
    RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'PROPUESTA' THEN
    RAISE EXCEPTION 'La propuesta ya no esta vigente' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE citas SET estado = 'CANCELADA', cancelada_en = now(), aprobacion_vence_en = NULL, updated_at = now()
  WHERE propuesta_de_id = c.propuesta_de_id AND estado = 'PROPUESTA';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM encolar_notificacion('CITA_CANCELADA', NULL, c.profesional_id, c.propuesta_de_id, NULL);
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION rechazar_propuestas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rechazar_propuestas(uuid) TO app_user;

-- Job: solicitud o propuesta sin respuesta al vencer el plazo -> CANCELADA. Un
-- aviso al paciente por solicitud, y uno por grupo de propuestas (al soltar la ultima).
CREATE OR REPLACE FUNCTION vencer_solicitudes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  v_n int := 0;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN SELECT x.id, x.paciente_id, x.estado, x.propuesta_de_id FROM citas x
           WHERE x.estado IN ('SOLICITADA', 'PROPUESTA') AND x.aprobacion_vence_en <= now() FOR UPDATE SKIP LOCKED LOOP
    UPDATE citas SET estado = 'CANCELADA', cancelada_en = now(), aprobacion_vence_en = NULL, updated_at = now() WHERE id = c.id;
    IF c.estado = 'SOLICITADA' THEN
      PERFORM encolar_notificacion('CITA_CANCELADA', c.paciente_id, NULL, c.id, NULL);
    ELSIF NOT EXISTS (SELECT 1 FROM citas y WHERE y.propuesta_de_id = c.propuesta_de_id AND y.estado = 'PROPUESTA') THEN
      PERFORM encolar_notificacion('CITA_CANCELADA', c.paciente_id, NULL, c.propuesta_de_id, NULL);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
