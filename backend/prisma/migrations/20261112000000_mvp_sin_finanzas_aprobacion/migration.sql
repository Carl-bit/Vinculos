-- =============================================================================
-- MVP sin finanzas (correcciones 2026-11-11, punto 25): el modulo COBROS se
-- apaga en todos los centros (lo activa solo el operador; la UI ya no lo
-- ofrece). Sin COBROS, la hora que pide el paciente (reserva sin cuenta o
-- portal) queda SOLICITADA y la aprueba su profesional dentro del plazo
-- (horas_aprobacion_solicitud, 24 por defecto, nunca despues del inicio). La
-- que agenda el equipo queda CONFIRMADA (cobro_previo_equipo ya la confirma
-- directo sin COBROS).
--
-- Con COBROS activo (implementacion futura) sigue 03b-3.2: el pago es la
-- aprobacion. Asi el modulo dormido y su suite de tests siguen validos.
--
-- Flujo sin COBROS:
--   - Reserva sin cuenta: retencion (RETENIDA) -> correo verificado ->
--     concretar_reserva crea paciente y ficha (regla de 03b-3.2: solo con
--     correo verificado) y deja la cita SOLICITADA. Aviso SOLICITUD_HORA al
--     profesional.
--   - Portal: reservar_cita_portal deja la cita SOLICITADA. Mismo aviso.
--   - aprobar_cita: SOLICITADA -> CONFIRMADA. El aviso CITA_CONFIRMADA lo
--     emite la API (con el enlace de videollamada si es online).
--   - rechazar_cita: SOLICITADA -> CANCELADA (aviso CITA_CANCELADA).
--   - vencer_solicitudes (job): plazo vencido -> CANCELADA (aviso CITA_CANCELADA).
-- La hora SOLICITADA esta ocupada (EXCLUDE = fuente de verdad), asi el
-- profesional nunca aprueba dos solicitudes para el mismo horario.
--
-- Las tablas y funciones de cobros no se borran: quedan para la
-- implementacion futura.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. COBROS fuera
-- -----------------------------------------------------------------------------
UPDATE configuracion_centro SET modulos_activos = array_remove(modulos_activos, 'COBROS');
ALTER TABLE configuracion_centro ALTER COLUMN modulos_activos
  SET DEFAULT ARRAY['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH']::modulo_centro[];

-- AlterTable
ALTER TABLE "configuracion_centro" ADD COLUMN "horas_aprobacion_solicitud" SMALLINT NOT NULL DEFAULT 24;
ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_horas_aprobacion_valida
  CHECK (horas_aprobacion_solicitud BETWEEN 1 AND 168);
GRANT UPDATE (horas_aprobacion_solicitud) ON configuracion_centro TO app_user;

-- -----------------------------------------------------------------------------
-- 2. Citas: SOLICITADA vuelve, con plazo de aprobacion
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "citas" ADD COLUMN "aprobacion_vence_en" TIMESTAMPTZ(6);
-- Sin GRANT de INSERT/UPDATE a app_user: solo lo fija el flujo.

ALTER TABLE citas DROP CONSTRAINT citas_sin_solicitada;
ALTER TABLE citas ADD CONSTRAINT citas_aprobacion_coherente
  CHECK (estado <> 'SOLICITADA' OR aprobacion_vence_en IS NOT NULL);

ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_espacio;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_espacio
  EXCLUDE USING gist (espacio_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA', 'SOLICITADA') AND modalidad = 'PRESENCIAL');
ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_profesional;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_profesional
  EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA', 'SOLICITADA'));

-- Plazo para aprobar: las horas configuradas, nunca despues del inicio.
CREATE FUNCTION plazo_aprobacion(p_inicio timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT least(now() + make_interval(hours => horas_aprobacion_solicitud), p_inicio) FROM configuracion_centro
$$;
REVOKE EXECUTE ON FUNCTION plazo_aprobacion(timestamptz) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. Listas de estados y flujo de reserva (reescritura acotada; si un texto
--    esperado no aparece, la migracion falla)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  f text;
  def text;
  nuevo text;
BEGIN
  -- Hora ocupada (ocupacion, disponibilidad, agenda, monto): suma SOLICITADA.
  FOREACH f IN ARRAY ARRAY[
    'disponibilidad_publica(uuid, timestamptz, timestamptz)', 'estado_fichas_profesional(uuid)', 'fijar_monto_cita()',
    'ocupacion_espacios(timestamptz, timestamptz)', 'proteger_bloque_atencion()', 'sesiones_espacios(timestamptz, timestamptz)',
    'validar_agenda_cita()'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def, $q$IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA')$q$,
                          $q$IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA', 'SOLICITADA')$q$);
    IF nuevo = def THEN
      RAISE EXCEPTION 'La funcion % no trae la lista de estados esperada', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;
  -- Citas del paciente (menor sin adulto, bajas y revocaciones que mueven a POR_REPROGRAMAR).
  FOREACH f IN ARRAY ARRAY[
    'iniciar_baja_profesional(uuid, timestamptz)', 'iniciar_baja_rol(uuid, rol, timestamptz)', 'procesar_bajas()',
    'validar_menor_con_adulto_responsable()', 'revocar_acceso_temporal(uuid, motivo_revocacion_acceso)'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def, $q$IN ('CONFIRMADA', 'PENDIENTE_PAGO')$q$, $q$IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'SOLICITADA')$q$);
    IF nuevo = def THEN
      RAISE EXCEPTION 'La funcion % no trae la lista de estados esperada', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;

  -- La API no fija ni saca SOLICITADA (solo puede cancelarla), ni su plazo.
  def := pg_get_functiondef('proteger_estado_pago()'::regprocedure);
  nuevo := replace(def, $q$IF NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA') OR NEW.medio_confirmacion IS NOT NULL$q$,
                        $q$IF NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA', 'SOLICITADA') OR NEW.aprobacion_vence_en IS NOT NULL
       OR NEW.medio_confirmacion IS NOT NULL$q$);
  nuevo := replace(nuevo, $q$OR NEW.ultimo_aviso_pago IS DISTINCT FROM OLD.ultimo_aviso_pago
$q$,
                          $q$OR NEW.ultimo_aviso_pago IS DISTINCT FROM OLD.ultimo_aviso_pago
        OR NEW.aprobacion_vence_en IS DISTINCT FROM OLD.aprobacion_vence_en
$q$);
  nuevo := replace(nuevo, $q$AND (NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA') OR OLD.estado = 'LIBERADA'$q$,
                          $q$AND (NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA', 'SOLICITADA') OR OLD.estado = 'LIBERADA'
                 OR (OLD.estado = 'SOLICITADA' AND NEW.estado <> 'CANCELADA')$q$);
  IF (length(nuevo) - length(replace(nuevo, 'SOLICITADA', ''))) / length('SOLICITADA') <> 3
     OR nuevo NOT LIKE '%NEW.aprobacion_vence_en IS DISTINCT FROM%' THEN
    RAISE EXCEPTION 'proteger_estado_pago no trae las condiciones esperadas';
  END IF;
  EXECUTE nuevo;

  -- Reserva sin cuenta: el correo verificado concreta paciente y ficha; sin COBROS la cita queda por aprobar.
  def := pg_get_functiondef('concretar_reserva(uuid, bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz)'::regprocedure);
  nuevo := replace(def, $q$v_en_hora boolean := false;$q$,
                        $q$v_en_hora boolean := false;
  -- MVP: sin COBROS la aprueba el profesional.
  v_aprueba boolean := (SELECT NOT 'COBROS' = ANY (coalesce(modulos_activos, '{}')) FROM configuracion_centro);$q$);
  nuevo := replace(nuevo, $q$UPDATE citas SET paciente_id = p_paciente_id, estado = 'CONFIRMADA',$q$,
                          $q$UPDATE citas SET paciente_id = p_paciente_id,
                     estado = CASE WHEN v_aprueba THEN 'SOLICITADA' ELSE 'CONFIRMADA' END::estado_cita,
                     aprobacion_vence_en = CASE WHEN v_aprueba THEN plazo_aprobacion(c.inicio) END,
                     pago_vence_en = CASE WHEN v_aprueba THEN NULL ELSE pago_vence_en END,$q$);
  nuevo := replace(nuevo, $q$PERFORM encolar_notificacion('CITA_CONFIRMADA', p_paciente_id, NULL, c.id, NULL);$q$,
                          $q$IF v_aprueba THEN
    PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, c.profesional_id, c.id, NULL);
  ELSE
    PERFORM encolar_notificacion('CITA_CONFIRMADA', p_paciente_id, NULL, c.id, NULL);
  END IF;$q$);
  nuevo := replace(nuevo, $q$SELECT p_paciente_id, c.id, 'CONFIRMADA'::estado_cita,$q$,
                          $q$SELECT p_paciente_id, c.id, CASE WHEN v_aprueba THEN 'SOLICITADA' ELSE 'CONFIRMADA' END::estado_cita,$q$);
  IF (length(nuevo) - length(replace(nuevo, 'v_aprueba', ''))) / length('v_aprueba') <> 6 THEN
    RAISE EXCEPTION 'concretar_reserva no trae las condiciones esperadas';
  END IF;
  EXECUTE nuevo;

  -- Portal: sin COBROS la hora pedida desde la cuenta queda por aprobar.
  def := pg_get_functiondef('reservar_cita_portal(uuid, modalidad_atencion, timestamptz, timestamptz, uuid, uuid)'::regprocedure);
  nuevo := replace(def, $q$  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, pago_vence_en)
  VALUES (p_modalidad, v_profesional, p_paciente_id, p_inicio, p_fin, 'PENDIENTE_PAGO', plazo_pago(p_inicio))
  RETURNING id INTO v_cita;$q$,
                        $q$  IF (SELECT 'COBROS' = ANY (coalesce(modulos_activos, '{}')) FROM configuracion_centro) THEN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, pago_vence_en)
    VALUES (p_modalidad, v_profesional, p_paciente_id, p_inicio, p_fin, 'PENDIENTE_PAGO', plazo_pago(p_inicio))
    RETURNING id INTO v_cita;
  ELSE
    -- MVP: sin COBROS la aprueba el profesional.
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en)
    VALUES (p_modalidad, v_profesional, p_paciente_id, p_inicio, p_fin, 'SOLICITADA', plazo_aprobacion(p_inicio))
    RETURNING id INTO v_cita;
  END IF;$q$);
  nuevo := replace(nuevo, $q$v_estado := decidir_confirmacion(v_cita);$q$,
                          $q$v_estado := decidir_confirmacion(v_cita);
  IF v_estado = 'SOLICITADA' THEN
    PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, v_profesional, v_cita, NULL);
  END IF;$q$);
  IF (length(nuevo) - length(replace(nuevo, 'SOLICITADA', ''))) / length('SOLICITADA') <> 2 THEN
    RAISE EXCEPTION 'reservar_cita_portal no trae las condiciones esperadas';
  END IF;
  EXECUTE nuevo;

  -- Panel de inicio: solicitudes por aprobar (profesional y administracion).
  def := pg_get_functiondef('reporte_dashboard()'::regprocedure);
  nuevo := replace(def, $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'PENDIENTE_PAGO'),$q$,
                        $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'PENDIENTE_PAGO'),
      'solicitudes_por_aprobar', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'SOLICITADA'),$q$);
  nuevo := replace(nuevo, $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE estado = 'PENDIENTE_PAGO'),$q$,
                          $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE estado = 'PENDIENTE_PAGO'),
      'solicitudes_por_aprobar', (SELECT count(*) FROM citas WHERE estado = 'SOLICITADA'),$q$);
  IF (length(nuevo) - length(replace(nuevo, 'solicitudes_por_aprobar', ''))) / length('solicitudes_por_aprobar') <> 2 THEN
    RAISE EXCEPTION 'reporte_dashboard no trae las condiciones esperadas';
  END IF;
  EXECUTE nuevo;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Aprobar, rechazar y vencer
-- -----------------------------------------------------------------------------
-- Solo el profesional de la cita, con el rol PROFESIONAL activo. Sin aviso: la
-- API genera el enlace online y emite CITA_CONFIRMADA (como al agendar).
CREATE FUNCTION aprobar_cita(p_cita_id uuid) RETURNS estado_cita
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' THEN
    RAISE EXCEPTION 'aprobar_cita: solo el profesional de la cita' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM citas WHERE id = p_cita_id AND profesional_id = app_usuario_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'SOLICITADA' OR c.aprobacion_vence_en <= now() THEN
    RAISE EXCEPTION 'La solicitud ya no esta por aprobar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE citas SET estado = 'CONFIRMADA', aprobacion_vence_en = NULL, updated_at = now() WHERE id = c.id;
  RETURN 'CONFIRMADA';
END;
$$;
REVOKE EXECUTE ON FUNCTION aprobar_cita(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aprobar_cita(uuid) TO app_user;

CREATE FUNCTION rechazar_cita(p_cita_id uuid) RETURNS estado_cita
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' THEN
    RAISE EXCEPTION 'rechazar_cita: solo el profesional de la cita' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM citas WHERE id = p_cita_id AND profesional_id = app_usuario_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'SOLICITADA' THEN
    RAISE EXCEPTION 'La solicitud ya no esta por aprobar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE citas SET estado = 'CANCELADA', cancelada_en = now(), aprobacion_vence_en = NULL, updated_at = now() WHERE id = c.id;
  PERFORM encolar_notificacion('CITA_CANCELADA', c.paciente_id, NULL, c.id, NULL);
  RETURN 'CANCELADA';
END;
$$;
REVOKE EXECUTE ON FUNCTION rechazar_cita(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rechazar_cita(uuid) TO app_user;

-- Job: solicitud sin respuesta al vencer el plazo -> CANCELADA, con aviso al paciente.
CREATE FUNCTION vencer_solicitudes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  v_n int := 0;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN SELECT x.id, x.paciente_id FROM citas x
           WHERE x.estado = 'SOLICITADA' AND x.aprobacion_vence_en <= now() FOR UPDATE SKIP LOCKED LOOP
    UPDATE citas SET estado = 'CANCELADA', cancelada_en = now(), aprobacion_vence_en = NULL, updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('CITA_CANCELADA', c.paciente_id, NULL, c.id, NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION vencer_solicitudes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vencer_solicitudes() TO app_user;

-- -----------------------------------------------------------------------------
-- 5. Citas pendientes de pago al migrar
-- -----------------------------------------------------------------------------
-- Las del equipo quedan CONFIRMADAS (pago en el centro); las del paciente, por
-- aprobar. Las RETENIDAS siguen su curso (el job las libera; el correo
-- verificado las deja SOLICITADA).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, inicio, agendada_por_equipo FROM citas WHERE estado = 'PENDIENTE_PAGO' FOR UPDATE LOOP
    BEGIN
      IF r.inicio <= now() OR r.agendada_por_equipo THEN
        UPDATE citas SET estado = 'CONFIRMADA', medio_confirmacion = 'PAGO_EN_CENTRO', pago_vence_en = NULL, updated_at = now()
        WHERE id = r.id;
      ELSE
        UPDATE citas SET estado = 'SOLICITADA', aprobacion_vence_en = plazo_aprobacion(r.inicio), pago_vence_en = NULL,
                         updated_at = now()
        WHERE id = r.id;
      END IF;
    EXCEPTION WHEN check_violation OR exclusion_violation THEN
      UPDATE citas SET estado = 'CANCELADA', cancelada_en = now(), pago_vence_en = NULL, updated_at = now() WHERE id = r.id;
      RAISE NOTICE 'Cita pendiente de pago % cancelada al migrar: ya no cabe en la agenda', r.id;
    END;
  END LOOP;
END $$;
