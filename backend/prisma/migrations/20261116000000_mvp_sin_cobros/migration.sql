-- MVP sin pagos ni finanzas (decision del usuario 2026-11-16, reemplaza la de
-- 2026-11-11 que dejaba las tablas dormidas): se elimina el modulo COBROS
-- completo de la BD. Fuera: pagos, transferencias, pasarela, comprobantes,
-- documentos tributarios, liquidaciones, acuerdos con profesionales, cuenta
-- bancaria del centro y de los profesionales, morosidad, arriendos de box,
-- resoluciones de cobro (inasistencia, devolucion, traslado), penalizacion por
-- cancelar tarde, comisiones y medios de pago; el estado PENDIENTE_PAGO, el
-- modulo COBROS, los avisos de pago y el token PAGO_CITA.
--
-- Se quedan como dato informativo: tarifas de los profesionales (perfil,
-- match), FONASA y la boleta reembolsable. La hora que pide el paciente sigue
-- igual: RETENIDA hasta verificar el correo (retencion_vence_en, antes
-- pago_vence_en), luego SOLICITADA hasta que la aprueba su profesional.
--
-- La categoria de llave FINANCIERO no se toca aqui: las llaves solo las
-- manejan los scripts de infra/scripts/llaves (queda sin columnas que cifrar).
--
-- Sin silos reales aun (solo de prueba): la migracion borra datos de cobros de
-- los silos de prueba. Las filas que usan valores que desaparecen se limpian
-- antes de recrear los tipos.

-- 1. Datos que usan valores que desaparecen.
ALTER TABLE notificaciones DISABLE TRIGGER notificaciones_append_only;
DELETE FROM notificaciones
WHERE tipo::text IN ('PAGO_REGISTRADO', 'COMPROBANTE_EMITIDO', 'INSTRUCCIONES_TRANSFERENCIA', 'COMPROBANTE_RECIBIDO',
                     'PAGO_VALIDADO', 'PAGO_RECHAZADO', 'PAGO_PENDIENTE', 'DEUDA_PENDIENTE');
ALTER TABLE notificaciones ENABLE TRIGGER notificaciones_append_only;
DELETE FROM plantillas_mensaje
WHERE evento::text IN ('PAGO_REGISTRADO', 'COMPROBANTE_EMITIDO', 'INSTRUCCIONES_TRANSFERENCIA', 'COMPROBANTE_RECIBIDO',
                       'PAGO_VALIDADO', 'PAGO_RECHAZADO', 'PAGO_PENDIENTE', 'DEUDA_PENDIENTE');
DELETE FROM tokens_correo WHERE tipo::text = 'PAGO_CITA';
UPDATE configuracion_centro SET modulos_activos = array_remove(modulos_activos, 'COBROS') WHERE 'COBROS' = ANY (modulos_activos);
UPDATE perfiles_rol SET restricciones = array_remove(restricciones, 'COBROS') WHERE 'COBROS' = ANY (restricciones);
DELETE FROM solicitudes_modulo WHERE modulo = 'COBROS';
-- Hora agendada que esperaba un pago: sin cobros queda confirmada (sin pasar
-- por los triggers de agenda: la hora ya estaba tomada).
ALTER TABLE citas DISABLE TRIGGER USER;
UPDATE citas SET estado = 'CONFIRMADA' WHERE estado = 'PENDIENTE_PAGO';
ALTER TABLE citas ENABLE TRIGGER USER;

-- 2. Triggers de cobros en tablas que se quedan.
DROP TRIGGER citas_estado_pago_protegido ON citas;
DROP TRIGGER citas_monto_fijado ON citas;
DROP TRIGGER citas_paciente_moroso ON citas;
DROP TRIGGER citas_pago_previo_equipo ON citas;
DROP TRIGGER citas_pasarela_cobro_directo ON citas;
DROP TRIGGER configuracion_centro_medios_pago_validos ON configuracion_centro;
-- Origen del paciente ("llego por el centro"): solo definia la comision por derivacion.
DROP TRIGGER pacientes_origen ON pacientes;
-- Y los de las propias tablas de cobros (usan funciones que se borran antes que las tablas).
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tg.tgname, tg.tgrelid::regclass AS tabla FROM pg_trigger tg
    WHERE NOT tg.tgisinternal AND tg.tgrelid::regclass::text IN ('comprobantes_pago', 'documentos_tributarios', 'cobros_pasarela',
      'transferencias', 'pagos', 'liquidaciones', 'acuerdos_profesional', 'cuenta_bancaria_centro', 'excepciones_morosidad',
      'arriendos', 'resoluciones_cita')
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', t.tgname, t.tabla);
  END LOOP;
END;
$$;

-- 3. Funciones de cobros (todas sus firmas; antes que las tablas, que usan sus tipos fila).
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY[
      'acuerdo_vigente', 'anular_documento_tributario', 'anular_pago', 'autorizar_cita_con_deuda', 'avanzar_liquidacion',
      'avisar_deudas', 'avisar_pagos_pendientes', 'bloquear_cita_moroso', 'cargo_cita', 'cita_de_enlace_pago',
      'cita_liquidable', 'cobra_para_confirmar', 'cobrar_reserva_en_caja', 'cobro_directo', 'cobro_previo_equipo',
      'comision_captado', 'comision_derivacion_cita', 'confirma_con_correo', 'confirmar_cobro_pasarela',
      'cuenta_transferencia_existe', 'datos_pago_profesional', 'datos_transferencia', 'datos_transferencia_enlace',
      'datos_transferencia_portal', 'datos_transferencia_reserva', 'decidir_confirmacion', 'deuda_pagable',
      'deudas_pacientes', 'deudas_vencidas', 'elegir_medio_cita', 'elegir_medio_enlace', 'elegir_medio_portal',
      'elegir_medio_reserva', 'emisor_tributario_cita', 'emitir_comprobante_pago', 'emitir_enlace_pago', 'fijar_origen_paciente', 'marcar_origen_paciente',
      'estado_pago_cita', 'estado_pago_enlace', 'estado_pago_portal', 'fijar_monto_cita', 'generar_liquidacion',
      'guardar_comprobante', 'iniciar_cobro_enlace', 'iniciar_cobro_pasarela', 'iniciar_cobro_portal',
      'iniciar_cobro_reserva', 'medios_confirmacion_vigentes', 'medios_de_profesional', 'medios_en_linea',
      'monto_confirmacion', 'paciente_moroso', 'plazo_pago', 'plazo_pago_equipo', 'proteger_comprobante_pago',
      'proteger_documento_tributario', 'proteger_estado_pago', 'proteger_excepcion_morosidad', 'proteger_liquidacion',
      'proteger_pago', 'puede_cobrar_presencial', 'puede_registrar_tributario', 'puede_validar_transferencia',
      'rechazar_pasarela_cobro_directo', 'rechazar_transferencia', 'registrar_acuerdo_profesional',
      'registrar_documento_tributario', 'registrar_pago', 'reporte_cobros', 'reserva_por_concretar', 'resolver_cita',
      'resumen_enlace_pago', 'saldo_cita', 'subir_comprobante_enlace', 'subir_comprobante_portal',
      'subir_comprobante_reserva', 'transferencia_de_cita', 'transferencia_de_enlace', 'transferencia_de_reserva',
      'transferencia_portal', 'validar_medios_pago', 'validar_transferencia'])
  LOOP
    EXECUTE 'DROP FUNCTION ' || f;
  END LOOP;
END;
$$;

-- 4. Vista y tablas de cobros (sus politicas, indices y triggers caen con ellas).
DROP VIEW estado_pago_citas;
DROP TABLE comprobantes_pago, documentos_tributarios, cobros_pasarela, transferencias, pagos, liquidaciones,
           acuerdos_profesional, cuenta_bancaria_centro, excepciones_morosidad, arriendos, resoluciones_cita;

-- 5. Columnas de cobros en tablas que se quedan.
ALTER TABLE citas
  DROP CONSTRAINT citas_pago_coherente,
  DROP CONSTRAINT citas_aviso_pago_valido,
  DROP CONSTRAINT citas_monto_no_negativo,
  DROP COLUMN monto,
  DROP COLUMN medio_confirmacion,
  DROP COLUMN medio_saldo,
  DROP COLUMN ultimo_aviso_pago,
  DROP COLUMN aviso_deuda_en,
  DROP COLUMN agendada_por_equipo;
ALTER TABLE citas RENAME COLUMN pago_vence_en TO retencion_vence_en;
COMMENT ON COLUMN citas.retencion_vence_en IS 'Hora RETENIDA (pedida sin cuenta): vence si no se verifica el correo a tiempo.';

ALTER TABLE configuracion_centro
  DROP CONSTRAINT configuracion_centro_cobros_validos,
  DROP CONSTRAINT configuracion_centro_comision_derivacion,
  DROP CONSTRAINT configuracion_centro_medios_pago,
  DROP CONSTRAINT configuracion_centro_morosidad_valida,
  DROP COLUMN modelo_cobro,
  DROP COLUMN penalizacion_cancelacion_porcentaje,
  DROP COLUMN cobro_inasistencia_porcentaje,
  DROP COLUMN comision_centro_porcentaje,
  DROP COLUMN liquidar_exige_evolucion,
  DROP COLUMN liquidar_cargos_a_profesional,
  DROP COLUMN medios_pago_habilitados,
  DROP COLUMN plazo_validacion_transferencia_horas,
  DROP COLUMN porcentaje_pago_confirmacion,
  DROP COLUMN horas_plazo_pago_equipo,
  DROP COLUMN dias_gracia_morosidad,
  DROP COLUMN bloquear_agenda_morosos,
  DROP COLUMN morosidad_desde,
  DROP COLUMN comision_derivacion_tipo,
  DROP COLUMN comision_derivacion_valor,
  ADD CONSTRAINT configuracion_centro_datos_validos
    CHECK (btrim(nombre_centro) <> '' AND plazo_aviso_cancelacion_horas BETWEEN 0 AND 720);

ALTER TABLE profesionales DROP COLUMN cobro_directo;

ALTER TABLE pacientes DROP COLUMN traido_por_centro;

ALTER TABLE profesional_datos_privados
  DROP CONSTRAINT profesional_datos_privados_cifrado,
  DROP COLUMN banco,
  DROP COLUMN tipo_cuenta,
  DROP COLUMN numero_cuenta,
  DROP COLUMN titular,
  ADD CONSTRAINT profesional_datos_privados_cifrado
    CHECK (octet_length(rut) >= 49 AND octet_length(rut_hmac) = 32 AND (rut IS NULL) = (rut_hmac IS NULL));

ALTER TABLE preferencias_aviso_equipo DROP COLUMN cobros;

-- 6. Funciones compartidas sin cobros. Las que cambian de firma se borran y se
--    recrean con los mismos permisos (pg_temp.permisos guarda y reaplica el ACL).
CREATE TABLE pg_temp.acl_previo AS
  SELECT p.proname::text AS nombre, p.proacl AS acl FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('concretar_reserva', 'crear_solicitud_hora', 'estado_reserva', 'consultar_recordatorio', 'responder_recordatorio');

CREATE FUNCTION pg_temp.aplicar_acl(p_sig text, p_acl aclitem[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  g oid;
BEGIN
  IF p_acl IS NULL THEN
    RETURN;
  END IF;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', p_sig);
  FOR g IN SELECT DISTINCT a.grantee FROM aclexplode(p_acl) a WHERE a.privilege_type = 'EXECUTE' LOOP
    IF g = 0 THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', p_sig);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', p_sig, g::regrole);
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION pg_temp.reaplicar_acl(p_nombre text) RETURNS void LANGUAGE sql AS $$
  SELECT pg_temp.aplicar_acl(p.oid::regprocedure::text, a.acl)
  FROM pg_proc p JOIN pg_temp.acl_previo a ON a.nombre = p.proname
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_nombre
$$;

DROP FUNCTION concretar_reserva(uuid, bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz);
DROP FUNCTION crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea, bytea,
                                   bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea, bytea);
DROP FUNCTION estado_reserva(bytea);
DROP FUNCTION consultar_recordatorio(text);
DROP FUNCTION responder_recordatorio(text, respuesta_recordatorio);

-- Plazo de la hora RETENIDA (antes plazo_pago): minutos de retencion, nunca despues del inicio.
CREATE FUNCTION plazo_retencion(p_inicio timestamptz) RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT least(now() + make_interval(mins => minutos_retencion_solicitud), p_inicio) FROM configuracion_centro
$$;
REVOKE ALL ON FUNCTION plazo_retencion(timestamptz) FROM PUBLIC;

-- Reserva sin cuenta: la hora queda RETENIDA y sale el enlace para verificar el correo.
CREATE FUNCTION crear_solicitud_hora(p_id uuid, p_profesional_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz,
                                     p_fin timestamptz, p_nombre text, p_apellido text, p_fecha_nacimiento date, p_email text,
                                     p_telefono bytea, p_rut bytea, p_rut_hmac bytea, p_adulto_nombre text,
                                     p_adulto_parentesco text, p_adulto_telefono bytea, p_respuestas bytea,
                                     p_recomendado_id uuid, p_politica_id uuid, p_terminos_id uuid, p_token_hash bytea,
                                     p_reserva_hash bytea)
  RETURNS TABLE(expira timestamptz, cita_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_expira timestamptz := plazo_retencion(p_inicio);
  v_espacio uuid;
  v_cita uuid;
BEGIN
  IF p_inicio <= now() THEN
    RAISE EXCEPTION 'La hora ya paso' USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_hora_coherente';
  END IF;
  IF p_politica_id IS DISTINCT FROM (SELECT id FROM politica_vigente('POLITICA_DATOS'))
     OR p_terminos_id IS DISTINCT FROM (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')) THEN
    RAISE EXCEPTION 'Hay una version nueva de la politica: vuelva a aceptarla'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
  END IF;
  IF age((p_inicio AT TIME ZONE 'America/Santiago')::date, p_fecha_nacimiento) < interval '18 years'
     AND coalesce(btrim(p_adulto_nombre), '') = '' THEN
    RAISE EXCEPTION 'Paciente menor de 18: el solicitante se declara adulto responsable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_menor_requiere_adulto_responsable';
  END IF;
  IF (SELECT count(*) FROM solicitudes_hora s JOIN citas c ON c.id = s.cita_id
      WHERE lower(s.email) = lower(p_email) AND s.estado = 'PENDIENTE_VERIFICACION' AND c.estado = 'RETENIDA'
        AND c.retencion_vence_en > now()) >= 2 THEN
    RAISE EXCEPTION 'Ya hay reservas en curso para este correo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_hora_limite';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico)
     OR NOT profesional_validado(p_profesional_id)
     OR NOT tiene_rol(p_profesional_id, 'PROFESIONAL')
     OR EXISTS (SELECT 1 FROM bajas WHERE usuario_id = p_profesional_id)
     OR NOT EXISTS (SELECT 1 FROM disponibilidad_publica(p_profesional_id, p_inicio - interval '1 minute', p_fin + interval '1 minute') d
                    WHERE d.modalidad = p_modalidad AND d.inicio <= p_inicio AND d.fin >= p_fin) THEN
    RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_disponible';
  END IF;
  IF p_modalidad = 'ONLINE' AND NOT EXISTS (SELECT 1 FROM salas_videollamada s WHERE s.usuario_id = p_profesional_id
                                            AND (s.modo = 'JITSI' OR s.enlace IS NOT NULL)) THEN
    RAISE EXCEPTION 'El profesional no atiende online por el portal'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'videollamada_sin_sala';
  END IF;

  -- Presencial: la BD le pone el box del bloque del profesional (validar_agenda_cita).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, retencion_vence_en)
  VALUES (p_modalidad, p_profesional_id, NULL, p_inicio, p_fin, 'RETENIDA', v_expira)
  RETURNING id, espacio_id INTO v_cita, v_espacio;

  INSERT INTO solicitudes_hora (id, profesional_id, modalidad, espacio_id, inicio, fin, nombre, apellido, fecha_nacimiento,
                                email, telefono, rut, rut_hmac, adulto_nombre, adulto_parentesco, adulto_telefono,
                                respuestas, recomendado_id, politica_id, terminos_id, expira_en, reserva_hash, cita_id)
  VALUES (p_id, p_profesional_id, p_modalidad, v_espacio, p_inicio, p_fin, btrim(p_nombre), btrim(p_apellido),
          p_fecha_nacimiento, lower(btrim(p_email)), p_telefono, p_rut, p_rut_hmac, nullif(btrim(p_adulto_nombre), ''),
          p_adulto_parentesco, p_adulto_telefono, p_respuestas, p_recomendado_id,
          p_politica_id, p_terminos_id, v_expira, p_reserva_hash, v_cita);

  PERFORM emitir_token('VERIFICACION_SOLICITUD', p_token_hash, least(p_inicio, now() + interval '24 hours'),
                       NULL, NULL, NULL, p_id, NULL, lower(btrim(p_email)));
  RETURN QUERY SELECT v_expira, v_cita;
END;
$function$;
SELECT pg_temp.reaplicar_acl('crear_solicitud_hora');

-- Enlace del correo: nace el paciente (ficha, adulto responsable, aceptaciones)
-- y la hora pasa a su profesional (SOLICITADA), que la aprueba o propone otras.
CREATE FUNCTION concretar_reserva(p_token_hash bytea, p_paciente_id uuid, p_adulto_id uuid, p_telefono bytea, p_rut bytea,
                                  p_rut_hmac bytea, p_adulto_telefono bytea, p_invitacion_hash bytea,
                                  p_invitacion_expira timestamptz)
  RETURNS TABLE(paciente_id uuid, cita_id uuid, estado estado_cita, modalidad modalidad_atencion, profesional_id uuid,
                inicio timestamptz, fin timestamptz, invitacion_email text, invitacion_rol rol, sala_modo modo_videollamada,
                sala_enlace bytea)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE;
  s solicitudes_hora%ROWTYPE;
  c citas%ROWTYPE;
  v_menor boolean;
  v_rut_libre boolean;
  v_dup boolean;
  v_adulto uuid;
  v_inv_email text;
  v_inv_rol rol;
  -- Solo los errores de la hora (inicio, EXCLUDE, agenda) se tratan como "hora tomada";
  -- las variables de plpgsql no vuelven atras con el subbloque.
  v_en_hora boolean := false;
BEGIN
  t := consumir_token(p_token_hash, 'VERIFICACION_SOLICITUD');
  SELECT * INTO s FROM solicitudes_hora WHERE id = t.referencia_id FOR UPDATE;
  SELECT * INTO c FROM citas WHERE id = s.cita_id FOR UPDATE;
  IF s.id IS NULL OR c.id IS NULL OR s.estado = 'CONCRETADA' OR c.paciente_id IS NOT NULL OR c.estado NOT IN ('RETENIDA', 'LIBERADA') OR c.liberada_por_id IS NOT NULL THEN
    RAISE EXCEPTION 'La solicitud ya se proceso' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  BEGIN
    IF c.inicio <= now() THEN
      v_en_hora := true;
      RAISE EXCEPTION 'La hora ya paso' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_tomada';
    END IF;
    v_menor := age((s.inicio AT TIME ZONE 'America/Santiago')::date, s.fecha_nacimiento) < interval '18 years';
    v_rut_libre := p_rut_hmac IS NULL OR NOT EXISTS (SELECT 1 FROM pacientes x WHERE x.rut_hmac = p_rut_hmac);
    -- Nunca fusionar por nombre (D-2): identidad = RUT (indice ciego) + correo. Coincidencias -> GESTION concilia.
    v_dup := NOT v_rut_libre
             OR (NOT v_menor AND EXISTS (SELECT 1 FROM pacientes x WHERE lower(x.email) = s.email));

    INSERT INTO pacientes (id, nombre, apellido, rut, rut_hmac, fecha_nacimiento, email, telefono, profesional_id,
                           creado_por_solicitud, posible_duplicado)
    VALUES (p_paciente_id, s.nombre, s.apellido, CASE WHEN v_rut_libre THEN p_rut END, CASE WHEN v_rut_libre THEN p_rut_hmac END,
            s.fecha_nacimiento, CASE WHEN v_menor THEN NULL ELSE s.email END, p_telefono, s.profesional_id, true, v_dup);
    INSERT INTO fichas_clinicas (paciente_id) VALUES (p_paciente_id);
    IF s.adulto_nombre IS NOT NULL THEN
      INSERT INTO adultos_responsables (id, paciente_id, nombre, parentesco, telefono, email)
      VALUES (p_adulto_id, p_paciente_id, s.adulto_nombre, s.adulto_parentesco, p_adulto_telefono,
              CASE WHEN v_menor THEN s.email END);
      v_adulto := p_adulto_id;
    END IF;
    INSERT INTO aceptaciones_politica (politica_id, paciente_id, solicitud_id, otorgado_por, adulto_responsable_id, canal, aceptada_en)
    SELECT x.id, p_paciente_id, s.id, CASE WHEN v_menor THEN 'ADULTO_RESPONSABLE' ELSE 'PACIENTE' END::otorgante_consentimiento,
           CASE WHEN v_menor THEN v_adulto END, 'SOLICITUD', s.creada_en
    FROM unnest(ARRAY[s.politica_id, s.terminos_id]) AS x(id) WHERE x.id IS NOT NULL;

    -- Retencion vigente o vencida: el EXCLUDE y validar_agenda_cita deciden si la hora sigue libre.
    v_en_hora := true;
    UPDATE citas SET paciente_id = p_paciente_id, estado = 'SOLICITADA', aprobacion_vence_en = plazo_aprobacion(c.inicio),
                     retencion_vence_en = NULL, updated_at = now()
    WHERE id = c.id;
  EXCEPTION WHEN exclusion_violation OR check_violation THEN
    IF NOT v_en_hora THEN
      RAISE;
    END IF;
    RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_tomada';
  END;

  UPDATE solicitudes_hora SET estado = 'CONCRETADA', paciente_id = p_paciente_id, concretada_en = now() WHERE id = s.id;
  PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, c.profesional_id, c.id, NULL);
  IF p_invitacion_hash IS NOT NULL THEN
    SELECT i.email, i.rol INTO v_inv_email, v_inv_rol
    FROM invitar_paciente_del_portal(p_paciente_id, p_invitacion_hash, p_invitacion_expira) i;
  END IF;

  RETURN QUERY
  SELECT p_paciente_id, c.id, 'SOLICITADA'::estado_cita, c.modalidad, c.profesional_id, c.inicio, c.fin, v_inv_email, v_inv_rol,
         sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON c.modalidad = 'ONLINE' AND sv.usuario_id = c.profesional_id;
END;
$function$;
SELECT pg_temp.reaplicar_acl('concretar_reserva');

-- Estado de la reserva sin cuenta (la pestaña lo consulta cada pocos segundos): solo estado, plazo y siguiente paso.
CREATE FUNCTION estado_reserva(p_hash bytea)
  RETURNS TABLE(estado text, vence_en timestamptz, siguiente text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  s solicitudes_hora%ROWTYPE;
  c citas%ROWTYPE;
  v_estado text;
BEGIN
  SELECT * INTO s FROM solicitudes_hora WHERE reserva_hash = p_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO c FROM citas WHERE id = s.cita_id;
  IF c.id IS NULL THEN
    -- Reserva anterior a 03b-3.2 (sin cita): solo pudo vencer.
    RETURN QUERY SELECT 'LIBERADA'::text, NULL::timestamptz, 'ELEGIR_OTRA_HORA'::text;
    RETURN;
  END IF;
  v_estado := CASE WHEN c.estado = 'RETENIDA' AND c.retencion_vence_en <= now() THEN 'LIBERADA' ELSE c.estado::text END;
  RETURN QUERY SELECT
    v_estado,
    CASE WHEN v_estado = 'RETENIDA' THEN c.retencion_vence_en WHEN v_estado = 'SOLICITADA' THEN c.aprobacion_vence_en END,
    CASE
      WHEN v_estado IN ('CONFIRMADA', 'SOLICITADA') THEN 'NINGUNO'
      WHEN EXISTS (SELECT 1 FROM citas x WHERE x.propuesta_de_id = c.id AND x.estado = 'PROPUESTA') THEN 'REVISAR_PROPUESTAS'
      WHEN v_estado = 'RETENIDA' THEN 'VERIFICAR_CORREO'
      ELSE 'ELEGIR_OTRA_HORA'
    END;
END;
$function$;
SELECT pg_temp.reaplicar_acl('estado_reserva');

CREATE FUNCTION consultar_recordatorio(p_token_hash text)
  RETURNS TABLE(inicio timestamptz, fin timestamptz, modalidad modalidad_atencion, profesional text,
                respuesta respuesta_recordatorio, vigente boolean, a_tiempo boolean, plazo_aviso_horas integer)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT c.inicio, c.fin, c.modalidad,
         (SELECT coalesce(pf.nombre_publico, u.nombre) FROM usuarios u LEFT JOIN profesionales pf ON pf.usuario_id = u.id
          WHERE u.id = c.profesional_id),
         r.respuesta,
         r.respuesta IS NULL AND r.expira_en > now() AND c.estado = 'CONFIRMADA' AND c.inicio = r.inicio,
         c.inicio - now() >= make_interval(hours => cc.plazo_aviso_cancelacion_horas),
         cc.plazo_aviso_cancelacion_horas
  FROM recordatorios_cita r JOIN citas c ON c.id = r.cita_id CROSS JOIN configuracion_centro cc
  WHERE r.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recordatorio inexistente' USING ERRCODE = 'no_data_found';
  END IF;
END;
$function$;
SELECT pg_temp.reaplicar_acl('consultar_recordatorio');

CREATE FUNCTION responder_recordatorio(p_token_hash text, p_respuesta respuesta_recordatorio)
  RETURNS TABLE(respuesta respuesta_recordatorio, a_tiempo boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_r recordatorios_cita%ROWTYPE;
  v_c citas%ROWTYPE;
  v_conf configuracion_centro%ROWTYPE;
  v_a_tiempo boolean;
BEGIN
  SELECT * INTO v_r FROM recordatorios_cita WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recordatorio inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_c FROM citas WHERE id = v_r.cita_id FOR UPDATE;
  IF v_r.respuesta IS NOT NULL OR v_r.expira_en <= now() OR v_c.estado <> 'CONFIRMADA' OR v_c.inicio <> v_r.inicio THEN
    RAISE EXCEPTION 'El enlace ya fue usado o ya no esta vigente' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT * INTO v_conf FROM configuracion_centro;
  IF p_respuesta = 'CANCELADA' THEN
    v_a_tiempo := v_c.inicio - now() >= make_interval(hours => v_conf.plazo_aviso_cancelacion_horas);
    UPDATE citas SET estado = 'CANCELADA', enlace_online = NULL WHERE id = v_c.id;
    PERFORM encolar_notificacion('CITA_CANCELADA', v_c.paciente_id, NULL, v_c.id, NULL);
    PERFORM encolar_notificacion('CITA_CANCELADA', NULL, v_c.profesional_id, v_c.id, NULL);
  END IF;
  UPDATE recordatorios_cita SET respuesta = p_respuesta, respondido_en = now(), a_tiempo = v_a_tiempo WHERE id = v_r.id;
  RETURN QUERY SELECT p_respuesta, v_a_tiempo;
END;
$function$;
SELECT pg_temp.reaplicar_acl('responder_recordatorio');

-- Lo que no era de cobros en los triggers que se fueron:
-- * fijar_monto_cita tambien fijaba cancelada_en (politica de cancelacion).
-- * proteger_estado_pago protegia el flujo de la reserva: la API no crea ni mueve horas
--   RETENIDA/SOLICITADA/PROPUESTA/LIBERADA ni sus plazos. Queda sin los campos de pago.
CREATE FUNCTION fijar_cancelada_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'CANCELADA' AND (TG_OP = 'INSERT' OR OLD.estado <> 'CANCELADA') THEN
    NEW.cancelada_en := now();
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cancelada_en := NULL;
  ELSE
    NEW.cancelada_en := OLD.cancelada_en;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION fijar_cancelada_en() FROM PUBLIC;
CREATE TRIGGER citas_cancelada_en BEFORE INSERT OR UPDATE ON citas FOR EACH ROW EXECUTE FUNCTION fijar_cancelada_en();

CREATE FUNCTION proteger_estado_cita() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado IN ('LIBERADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') OR NEW.aprobacion_vence_en IS NOT NULL
       OR NEW.propuesta_de_id IS NOT NULL OR NEW.retencion_vence_en IS NOT NULL
       OR NEW.liberada_por_id IS NOT NULL OR NEW.motivo_liberacion IS NOT NULL THEN
      RAISE EXCEPTION 'El estado de la cita solo lo fija el flujo de la reserva' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.estado = 'RETENIDA'
        OR NEW.retencion_vence_en IS DISTINCT FROM OLD.retencion_vence_en
        OR NEW.aprobacion_vence_en IS DISTINCT FROM OLD.aprobacion_vence_en
        OR NEW.propuesta_de_id IS DISTINCT FROM OLD.propuesta_de_id
        OR (NEW.liberada_por_id, NEW.motivo_liberacion) IS DISTINCT FROM (OLD.liberada_por_id, OLD.motivo_liberacion)
        OR (NEW.estado IS DISTINCT FROM OLD.estado
            AND (NEW.estado IN ('LIBERADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') OR OLD.estado = 'LIBERADA'
                 OR (OLD.estado IN ('SOLICITADA', 'PROPUESTA') AND NEW.estado <> 'CANCELADA'))) THEN
    RAISE EXCEPTION 'El estado de la cita solo lo fija el flujo de la reserva' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION proteger_estado_cita() FROM PUBLIC;
CREATE TRIGGER citas_estado_protegido BEFORE INSERT OR UPDATE ON citas FOR EACH ROW EXECUTE FUNCTION proteger_estado_cita();

-- Mismas firmas: CREATE OR REPLACE conserva los permisos.
CREATE OR REPLACE FUNCTION cita_realizada(p_cita_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM citas c WHERE c.id = p_cita_id AND c.estado = 'CONFIRMADA' AND c.fin <= now())
$$;

CREATE OR REPLACE FUNCTION contenido_publico_centro() RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT to_jsonb(cp) - 'id' || jsonb_build_object(
           'nombre_centro', cc.nombre_centro, 'modulos', to_jsonb(cc.modulos_activos),
           'match_filtro_directo', cc.match_filtro_directo,
           'plazo_aviso_cancelacion_horas', cc.plazo_aviso_cancelacion_horas)
  FROM contenido_publico cp CROSS JOIN configuracion_centro cc
$$;

CREATE OR REPLACE FUNCTION grupo_aviso_equipo(p_tipo tipo_notificacion) RETURNS text
  LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_tipo IN ('CITA_CANCELADA', 'SOLICITUD_HORA', 'PROPUESTA_ACEPTADA') THEN 'AGENDA'
    WHEN p_tipo = 'DERIVACION_ACTUALIZADA' THEN 'DERIVACIONES'
    WHEN p_tipo IN ('MENSAJE_PACIENTE', 'MENSAJE_INTERNO') THEN 'MENSAJES'
  END
$$;

CREATE OR REPLACE FUNCTION encolar_notificacion(p_tipo tipo_notificacion, p_paciente_id uuid, p_usuario_id uuid,
                                                p_referencia_id uuid, p_creada_por uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_destinatario destinatario_mensaje := CASE WHEN p_paciente_id IS NOT NULL THEN 'PACIENTE' ELSE 'EQUIPO' END;
  v_categoria text := categoria_evento(p_tipo);
  v_grupo text := grupo_aviso_equipo(p_tipo);
BEGIN
  INSERT INTO notificaciones (tipo, canal, paciente_id, usuario_id, referencia_id, creada_por_id)
  VALUES (p_tipo, 'BANDEJA', p_paciente_id, p_usuario_id, p_referencia_id, p_creada_por);
  IF EXISTS (SELECT 1 FROM plantillas_mensaje WHERE evento = p_tipo AND destinatario = v_destinatario
               AND canal = 'CORREO' AND activa)
     AND (CASE
           WHEN v_destinatario = 'EQUIPO' THEN NOT EXISTS (
             SELECT 1 FROM preferencias_aviso_equipo pe WHERE pe.usuario_id = p_usuario_id
               AND NOT CASE v_grupo WHEN 'AGENDA' THEN pe.agenda
                                    WHEN 'DERIVACIONES' THEN pe.derivaciones WHEN 'MENSAJES' THEN pe.mensajes
                                    ELSE true END)
           WHEN v_categoria = 'LEGAL' THEN true
           ELSE NOT EXISTS (
             SELECT 1 FROM preferencias_notificacion pr WHERE pr.paciente_id = p_paciente_id
               AND NOT CASE WHEN v_categoria = 'RECORDATORIO' THEN pr.recordatorios ELSE pr.avisos_operativos END)
         END) THEN
    INSERT INTO notificaciones (tipo, canal, paciente_id, usuario_id, referencia_id, creada_por_id)
    VALUES (p_tipo, 'CORREO', p_paciente_id, p_usuario_id, p_referencia_id, p_creada_por);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION liberar_hora_retenida(p_cita_id uuid, p_motivo text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  c citas%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION liberan una hora retenida' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'RETENIDA' OR c.paciente_id IS NOT NULL THEN
    RAISE EXCEPTION 'La cita no es una hora retenida' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Liberar exige motivo' USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_liberacion_coherente';
  END IF;
  UPDATE citas SET estado = 'LIBERADA', liberada_por_id = app_usuario_id(), motivo_liberacion = btrim(p_motivo), updated_at = now()
  WHERE id = c.id;
  UPDATE solicitudes_hora SET estado = 'EXPIRADA' WHERE cita_id = c.id AND estado = 'PENDIENTE_VERIFICACION';
END;
$function$;

-- Job: horas RETENIDAS cuyo correo no se verifico a tiempo.
CREATE OR REPLACE FUNCTION liberar_reservas_vencidas() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  c record;
  v_n int := 0;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    SELECT x.id, x.paciente_id FROM citas x
    WHERE x.estado = 'RETENIDA' AND x.retencion_vence_en <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE citas SET estado = 'LIBERADA', updated_at = now() WHERE id = c.id;
    IF c.paciente_id IS NOT NULL THEN
      PERFORM encolar_notificacion('HORA_LIBERADA', c.paciente_id, NULL, c.id, NULL);
    END IF;
    UPDATE solicitudes_hora SET estado = 'EXPIRADA' WHERE cita_id = c.id AND estado = 'PENDIENTE_VERIFICACION';
    v_n := v_n + 1;
  END LOOP;
  -- Reservas anteriores a 03b-3.2 (retenidas con soft-lock, sin cita).
  WITH vencidas AS (
    UPDATE solicitudes_hora SET estado = 'EXPIRADA'
    WHERE estado = 'PENDIENTE_VERIFICACION' AND cita_id IS NULL AND expira_en <= now() RETURNING id
  )
  DELETE FROM bloqueos_temporales b USING vencidas v WHERE b.solicitud_id = v.id;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION exportar_datos_paciente(p_paciente_id uuid, p_parte text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tratante uuid;
  v jsonb;
BEGIN
  SELECT profesional_id INTO v_tratante FROM pacientes WHERE id = p_paciente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_parte = 'ADMINISTRATIVA' THEN
    IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
      RAISE EXCEPTION 'La parte administrativa la genera un ADMIN' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v := jsonb_build_object(
      'pacientes', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM pacientes t WHERE t.id = p_paciente_id),
      'adultos_responsables', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM adultos_responsables t WHERE t.paciente_id = p_paciente_id),
      'citas', (SELECT jsonb_agg(fila_exportable(to_jsonb(t)) ORDER BY t.inicio) FROM citas t WHERE t.paciente_id = p_paciente_id),
      'consentimientos', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM consentimientos t WHERE t.paciente_id = p_paciente_id),
      'aceptaciones_politica', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM aceptaciones_politica t WHERE t.paciente_id = p_paciente_id),
      'preferencias_notificacion', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM preferencias_notificacion t WHERE t.paciente_id = p_paciente_id),
      'solicitudes_derechos', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM solicitudes_derechos t WHERE t.paciente_id = p_paciente_id),
      'altas_paciente', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM altas_paciente t WHERE t.paciente_id = p_paciente_id));
  ELSIF p_parte = 'CLINICA' THEN
    IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' OR app_usuario_id() IS DISTINCT FROM v_tratante THEN
      RAISE EXCEPTION 'La parte clinica la genera el profesional tratante' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v := jsonb_build_object(
      'fichas_clinicas', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM fichas_clinicas t WHERE t.paciente_id = p_paciente_id),
      'ingresos_ficha', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM ingresos_ficha t JOIN fichas_clinicas f ON f.id = t.ficha_clinica_id WHERE f.paciente_id = p_paciente_id),
      'evoluciones', (SELECT jsonb_agg(fila_exportable(to_jsonb(t)) ORDER BY t.created_at) FROM evoluciones t JOIN fichas_clinicas f ON f.id = t.ficha_clinica_id WHERE f.paciente_id = p_paciente_id),
      'evolucion_intervenciones', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM evolucion_intervenciones t JOIN evoluciones e ON e.id = t.evolucion_id JOIN fichas_clinicas f ON f.id = e.ficha_clinica_id WHERE f.paciente_id = p_paciente_id),
      'adjuntos_ficha', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM adjuntos_ficha t WHERE t.paciente_id = p_paciente_id),
      'documentos_clinicos', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM documentos_clinicos t WHERE t.paciente_id = p_paciente_id));
  ELSE
    RAISE EXCEPTION 'Parte desconocida' USING ERRCODE = 'check_violation', CONSTRAINT = 'exportaciones_paciente_parte';
  END IF;
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion, detalle)
  VALUES (app_usuario_id(), app_rol()::rol, p_paciente_id, 'exportacion_paciente', 'EXPORTACION', 'parte ' || lower(p_parte));
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION tablas_exportacion_centro() RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT table_name::text FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    AND table_name NOT IN ('_prisma_migrations', 'llaves_datos', 'custodios_llave', 'eventos_llaves', 'sesiones', 'tokens_correo',
                           'codigos_verificacion', 'codigos_respaldo', 'intentos_login_fallidos', 'correos_cuenta_pendientes',
                           'feeds_calendario', 'salas_videollamada', 'exportaciones_paciente')
  ORDER BY table_name
$$;

CREATE OR REPLACE FUNCTION solicitar_modulo(p_modulo modulo_centro, p_accion accion_modulo, p_motivo text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_activos modulo_centro[] := modulos_activos();
  v_id uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo la cuenta madre (ADMIN) solicita modulos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_modulo = 'WHATSAPP' THEN
    RAISE EXCEPTION 'El modulo % no esta disponible en esta version', p_modulo
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_disponible';
  END IF;
  IF p_accion = 'ACTIVAR' THEN
    IF p_modulo = ANY (v_activos) THEN
      RAISE EXCEPTION 'El modulo % ya esta activo', p_modulo
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_estado';
    END IF;
    IF p_modulo IN ('MATCH', 'PAGINA_PUBLICA') AND NOT 'EQUIPO' = ANY (v_activos) THEN
      RAISE EXCEPTION 'El modulo % requiere EQUIPO activo: solicita primero EQUIPO', p_modulo
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_dependencias';
    END IF;
  ELSE
    IF NOT p_modulo = ANY (v_activos) THEN
      RAISE EXCEPTION 'El modulo % no esta activo', p_modulo
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_estado';
    END IF;
    IF p_modulo = 'EQUIPO' AND ('MATCH' = ANY (v_activos) OR 'PAGINA_PUBLICA' = ANY (v_activos)) THEN
      RAISE EXCEPTION 'MATCH y PAGINA_PUBLICA dependen de EQUIPO: desactivalos primero'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_dependencias';
    END IF;
  END IF;
  INSERT INTO solicitudes_modulo (modulo, accion, motivo, pedida_por, pedida_por_rol)
  VALUES (p_modulo, p_accion, nullif(btrim(p_motivo), ''), app_usuario_id(), 'ADMIN')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Plano de control (R4): reglas de la lista cerrada del manifiesto, sin las de cobros.
CREATE OR REPLACE FUNCTION aplicar_config_interna(p_token text, p_revision integer, p_hash text, p_modulos modulo_centro[],
                                                  p_reglas jsonb) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION reservar_cita_portal(p_paciente_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz,
                                                p_fin timestamptz, p_politica_id uuid, p_terminos_id uuid)
  RETURNS TABLE(cita_id uuid, estado estado_cita, profesional_id uuid, sala_modo modo_videollamada, sala_enlace bytea)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_profesional uuid;
  v_adulto uuid;
  v_otorgante otorgante_consentimiento;
  v_cita uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'reservar_cita_portal: solo el paciente o su adulto responsable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_rol() = 'PACIENTE' THEN
    IF p_paciente_id IS DISTINCT FROM app_paciente_id() THEN
      RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
    END IF;
    IF edad_paciente(p_paciente_id) < 18 THEN
      RAISE EXCEPTION 'Las horas de un menor las pide su adulto responsable'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_portal_cuenta_restringida';
    END IF;
    v_otorgante := 'PACIENTE';
  ELSE
    SELECT a.id INTO v_adulto FROM adultos_responsables a WHERE a.paciente_id = p_paciente_id AND a.usuario_id = app_usuario_id();
    IF v_adulto IS NULL THEN
      RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
    END IF;
    v_otorgante := 'ADULTO_RESPONSABLE';
  END IF;
  IF p_inicio <= now() THEN
    RAISE EXCEPTION 'La hora ya paso' USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_portal_futura';
  END IF;
  IF p_politica_id IS DISTINCT FROM (SELECT id FROM politica_vigente('POLITICA_DATOS'))
     OR p_terminos_id IS DISTINCT FROM (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')) THEN
    RAISE EXCEPTION 'Hay una version nueva de la politica: vuelva a aceptarla'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
  END IF;

  -- Solo con el tratante actual (un tratante por paciente; otro profesional = derivacion).
  SELECT p.profesional_id INTO v_profesional FROM pacientes p WHERE p.id = p_paciente_id;
  IF v_profesional IS NULL OR EXISTS (SELECT 1 FROM bajas WHERE usuario_id = v_profesional) THEN
    RAISE EXCEPTION 'No tienes un profesional tratante que agende por el portal: escribe al centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_portal_tratante';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM disponibilidad_publica(v_profesional, p_inicio - interval '1 minute', p_fin + interval '1 minute') d
                 WHERE d.modalidad = p_modalidad AND d.inicio <= p_inicio AND d.fin >= p_fin) THEN
    RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_disponible';
  END IF;
  IF p_modalidad = 'ONLINE' AND NOT EXISTS (SELECT 1 FROM salas_videollamada s WHERE s.usuario_id = v_profesional
                                            AND (s.modo = 'JITSI' OR s.enlace IS NOT NULL)) THEN
    RAISE EXCEPTION 'El profesional no atiende online por el portal'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'videollamada_sin_sala';
  END IF;

  -- La aprueba su profesional. Presencial: la BD le pone el box del bloque (validar_agenda_cita).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en)
  VALUES (p_modalidad, v_profesional, p_paciente_id, p_inicio, p_fin, 'SOLICITADA', plazo_aprobacion(p_inicio))
  RETURNING id INTO v_cita;

  -- Politica de datos y terminos vigentes: se registran si esta version aun no estaba aceptada.
  INSERT INTO aceptaciones_politica (politica_id, paciente_id, otorgado_por, adulto_responsable_id, canal)
  SELECT x.id, p_paciente_id, v_otorgante, v_adulto, 'PORTAL'
  FROM unnest(ARRAY[p_politica_id, p_terminos_id]) AS x(id)
  WHERE NOT EXISTS (SELECT 1 FROM aceptaciones_politica a WHERE a.paciente_id = p_paciente_id AND a.politica_id = x.id);

  PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, v_profesional, v_cita, NULL);

  RETURN QUERY
  SELECT v_cita, 'SOLICITADA'::estado_cita, v_profesional, sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON p_modalidad = 'ONLINE' AND sv.usuario_id = v_profesional;
END;
$function$;

-- 7. Tipos que eran solo de cobros (ya sin funciones ni columnas que los usen).
DROP TYPE cobrado_por, cobrador_acuerdo, decision_cita, estado_cobro_pasarela, estado_documento_tributario,
          estado_liquidacion, estado_pago, estado_transferencia, medio_confirmacion, medio_pago, modelo_cobro,
          origen_pago, tipo_comision_derivacion, tipo_documento_tributario;

-- Mismas firmas: solo sale PENDIENTE_PAGO de las listas de estados que ocupan agenda.
CREATE OR REPLACE FUNCTION public.disponibilidad_publica(p_profesional_id uuid, desde timestamp with time zone, hasta timestamp with time zone)
 RETURNS TABLE(modalidad modalidad_atencion, inicio timestamp with time zone, fin timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_margen int := margen_vigente(p_profesional_id);
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
  ), ventanas AS (
    SELECT mm.m, tstzrange(b.inicio, b.fin, '[)') AS r
    FROM bloques_atencion b CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE b.profesional_id = p_profesional_id AND b.fin > desde AND b.inicio < hasta
  ), centro AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM horario_centro)
                THEN (SELECT coalesce(range_agg(tstzrange(minuto_local(x.dia, h.inicio_min), minuto_local(x.dia, h.fin_min), '[)')),
                                      '{}'::tstzmultirange)
                      FROM dias x JOIN horario_centro h ON h.dia_semana = extract(isodow FROM x.dia))
                ELSE '{}'::tstzmultirange END AS r
  ), ocupado AS (
    SELECT mm.m,
           CASE WHEN c.modalidad = mm.m THEN tstzrange(c.inicio, c.fin, '[)')
                ELSE rango_con_margen(c.inicio, c.fin, c.margen_traslado_min + v_margen) END AS r
    FROM citas c CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE c.profesional_id = p_profesional_id AND c.estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA')
    UNION ALL
    SELECT mm.m, tstzrange(b.inicio, b.fin, '[)')
    FROM bloqueos_agenda b CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE b.profesional_id = p_profesional_id
    UNION ALL
    SELECT mm.m,
           CASE WHEN t.modalidad = mm.m THEN tstzrange(t.inicio, t.fin, '[)')
                ELSE rango_con_margen(t.inicio, t.fin, 2 * v_margen) END
    FROM bloqueos_temporales t CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE t.profesional_id = p_profesional_id AND t.expira_en > now()
  ), libres AS (
    SELECT v.m,
           unnest((range_agg(v.r) - coalesce((SELECT range_agg(o.r) FROM ocupado o WHERE o.m = v.m), '{}'::tstzmultirange))
                  * tstzmultirange(tstzrange(desde, hasta, '[)')) * (SELECT c.r FROM centro c)) AS r
    FROM ventanas v GROUP BY v.m
  )
  SELECT l.m, lower(l.r), upper(l.r) FROM libres l ORDER BY 2, 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.estado_fichas_profesional(p_profesional_id uuid)
 RETURNS TABLE(paciente_id uuid, ultima_sesion timestamp with time zone, proxima_sesion timestamp with time zone, sesiones_sin_cerrar integer, alta_en date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente()
     OR NOT (app_rol() IN ('ADMIN', 'GESTION') OR (app_rol() IN ('PROFESIONAL', 'PRACTICANTE') AND p_profesional_id = app_usuario_id())) THEN
    RAISE EXCEPTION 'estado_fichas_profesional: ADMIN/GESTION o el propio' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT p.id,
         (SELECT max(c.inicio) FROM citas c WHERE c.paciente_id = p.id AND c.estado = 'CONFIRMADA' AND c.inicio < now()),
         (SELECT min(c.inicio) FROM citas c WHERE c.paciente_id = p.id AND c.estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA')
          AND c.inicio >= now()),
         (SELECT count(*)::int FROM citas c WHERE c.paciente_id = p.id AND c.profesional_id = p_profesional_id
          AND cita_realizada(c.id) AND NOT EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = c.id)),
         (SELECT max(a.fecha) FROM altas_paciente a WHERE a.paciente_id = p.id)
  FROM pacientes p WHERE p.profesional_id = p_profesional_id AND p.deleted_at IS NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.iniciar_baja_profesional(p_usuario_id uuid, p_fecha_efectiva timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rol text;
  v_activo boolean;
  v_citas int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN inicia bajas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_usuario_id = app_usuario_id() THEN
    RAISE EXCEPTION 'Nadie inicia su propia baja' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT rol::text, activo INTO v_rol, v_activo FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_rol IN ('PACIENTE', 'RESPONSABLE') OR p_fecha_efectiva IS NULL THEN
    RAISE EXCEPTION 'Baja solo para cuentas de equipo, con fecha efectiva'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bajas_validas';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'El usuario ya esta inactivo' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_rol = 'ADMIN' THEN
    PERFORM 1 FROM configuracion_centro FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.rol = 'ADMIN' AND u.activo AND u.id <> p_usuario_id
                   AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)) THEN
      RAISE EXCEPTION 'No se da de baja al ultimo ADMIN activo'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_ultimo_admin';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM supervisiones s JOIN usuarios u ON u.id = s.practicante_id
             WHERE s.supervisor_id = p_usuario_id AND u.activo
               AND s.desde <= now() AND (s.hasta IS NULL OR s.hasta > now())) THEN
    RAISE EXCEPTION 'Supervisa practicantes activos: cambiar su supervisor antes de la baja'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO bajas (usuario_id, fecha_efectiva, iniciada_por_id)
  VALUES (p_usuario_id, p_fecha_efectiva, app_usuario_id());
  IF v_rol IN ('PROFESIONAL', 'PRACTICANTE') OR tiene_rol(p_usuario_id, 'PROFESIONAL') THEN
    INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo)
    VALUES (p_usuario_id, p_fecha_efectiva, NULL, 'BAJA');
  END IF;

  UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
  WHERE profesional_id = p_usuario_id AND estado IN ('CONFIRMADA', 'SOLICITADA') AND inicio >= p_fecha_efectiva;
  GET DIAGNOSTICS v_citas = ROW_COUNT;
  PERFORM cancelar_propuestas_baja(p_usuario_id, p_fecha_efectiva);
  RETURN v_citas;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.iniciar_baja_rol(p_usuario_id uuid, p_rol rol, p_fecha_efectiva timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_citas int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN inicia bajas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_fecha_efectiva IS NULL THEN
    RAISE EXCEPTION 'Baja con fecha efectiva' USING ERRCODE = 'check_violation', CONSTRAINT = 'bajas_validas';
  END IF;
  PERFORM 1 FROM roles_adicionales WHERE usuario_id = p_usuario_id AND rol = p_rol AND activo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no tiene ese rol adicional activo' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM supervisiones s JOIN usuarios u ON u.id = s.practicante_id
             WHERE s.supervisor_id = p_usuario_id AND u.activo
               AND s.desde <= now() AND (s.hasta IS NULL OR s.hasta > now())) THEN
    RAISE EXCEPTION 'Supervisa practicantes activos: cambiar su supervisor antes de la baja'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE roles_adicionales SET fecha_baja = p_fecha_efectiva WHERE usuario_id = p_usuario_id AND rol = p_rol;
  INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo)
  VALUES (p_usuario_id, p_fecha_efectiva, NULL, 'BAJA');
  UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
  WHERE profesional_id = p_usuario_id AND estado IN ('CONFIRMADA', 'SOLICITADA') AND inicio >= p_fecha_efectiva;
  GET DIAGNOSTICS v_citas = ROW_COUNT;
  PERFORM cancelar_propuestas_baja(p_usuario_id, p_fecha_efectiva);
  RETURN v_citas;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ocupacion_espacios(desde timestamp with time zone, hasta timestamp with time zone)
 RETURNS TABLE(espacio_id uuid, inicio timestamp with time zone, fin timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'ocupacion_espacios: requiere acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT o.espacio_id, o.inicio, o.fin FROM (
    SELECT b.espacio_id, b.inicio, b.fin FROM bloques_atencion b
    WHERE tstzrange(b.inicio, b.fin, '[)') && tstzrange(desde, hasta, '[)')
    UNION ALL
    SELECT c.espacio_id, c.inicio, c.fin FROM citas c
    WHERE c.estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') AND c.espacio_id IS NOT NULL
      AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(desde, hasta, '[)')
      AND NOT EXISTS (SELECT 1 FROM bloques_atencion b WHERE b.espacio_id = c.espacio_id
                      AND b.inicio <= c.inicio AND b.fin >= c.fin)
    UNION ALL
    SELECT t.espacio_id, t.inicio, t.fin FROM bloqueos_temporales t
    WHERE t.expira_en > now() AND t.espacio_id IS NOT NULL
      AND tstzrange(t.inicio, t.fin, '[)') && tstzrange(desde, hasta, '[)')
      AND NOT EXISTS (SELECT 1 FROM bloques_atencion b WHERE b.espacio_id = t.espacio_id
                      AND b.inicio <= t.inicio AND b.fin >= t.fin)
  ) o
  ORDER BY o.espacio_id, o.inicio;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pendientes_fichas(p_profesional_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(profesional_id uuid, paciente_id uuid, codigo text, tipo text, cita_id uuid, fecha timestamp with time zone, vence timestamp with time zone, menor boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_prof uuid := p_profesional_id;
  v_dias int := coalesce((SELECT c.dias_gracia_cierre FROM configuracion_centro c LIMIT 1), 30);
  v_version int := (SELECT v.version FROM politica_vigente('CONSENTIMIENTO_ATENCION') v);
  v_hoy date := (now() AT TIME ZONE 'America/Santiago')::date;
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'pendientes_fichas: sin acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_rol() IN ('PROFESIONAL', 'PRACTICANTE') THEN
    IF v_prof IS NOT NULL AND v_prof <> app_usuario_id() THEN
      RAISE EXCEPTION 'pendientes_fichas: ADMIN/GESTION o el propio' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_prof := app_usuario_id();
  ELSIF app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'pendientes_fichas: ADMIN/GESTION o el propio' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH sin_evolucion AS (
    SELECT c.id AS cita_id, c.profesional_id, c.paciente_id, c.inicio
    FROM citas c
    WHERE (v_prof IS NULL OR c.profesional_id = v_prof) AND c.paciente_id IS NOT NULL
      AND cita_realizada(c.id) AND NOT EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = c.id)
  ),
  pac AS (
    SELECT p.id, p.profesional_id, p.codigo_seudonimo, p.rut IS NULL AS sin_rut,
           extract(year FROM age(v_hoy, p.fecha_nacimiento)) < 18 AS menor,
           (SELECT min(c.inicio) FROM citas c
            WHERE c.paciente_id = p.id AND c.estado IN ('CONFIRMADA') AND c.inicio >= now()) AS proxima
    FROM pacientes p
    WHERE p.deleted_at IS NULL AND (v_prof IS NULL OR p.profesional_id = v_prof)
  )
  SELECT s.profesional_id, s.paciente_id, p.codigo_seudonimo, 'SIN_EVOLUCION', s.cita_id, s.inicio,
         s.inicio + make_interval(days => v_dias), extract(year FROM age(v_hoy, p.fecha_nacimiento)) < 18
  FROM sin_evolucion s JOIN pacientes p ON p.id = s.paciente_id
  UNION ALL
  SELECT p.profesional_id, p.id, p.codigo_seudonimo, 'CONSENTIMIENTO', NULL::uuid, p.proxima, NULL::timestamptz, p.menor
  FROM pac p
  WHERE p.proxima IS NOT NULL AND v_version IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM aceptaciones_politica a JOIN politicas po ON po.id = a.politica_id
                    WHERE a.paciente_id = p.id AND po.tipo = 'CONSENTIMIENTO_ATENCION' AND po.version >= v_version)
  UNION ALL
  SELECT p.profesional_id, p.id, p.codigo_seudonimo, 'SIN_RUT', NULL::uuid, p.proxima, NULL::timestamptz, p.menor
  FROM pac p
  WHERE p.sin_rut AND (p.proxima IS NOT NULL OR EXISTS (SELECT 1 FROM sin_evolucion s WHERE s.paciente_id = p.id))
  UNION ALL
  SELECT p.profesional_id, p.id, p.codigo_seudonimo, 'SIN_RESPONSABLE', NULL::uuid, p.proxima, NULL::timestamptz, true
  FROM pac p
  WHERE p.menor AND p.proxima IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM adultos_responsables a WHERE a.paciente_id = p.id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.procesar_bajas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_total int := 0;
BEGIN
  FOR r IN
    SELECT id, fecha_expiracion_acceso FROM usuarios
    WHERE rol::text = 'PRACTICANTE' AND activo AND fecha_expiracion_acceso <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM desactivar_tratante(r.id, now());
    INSERT INTO historial_accesos_practicante (practicante_id, accion, fecha_expiracion)
    VALUES (r.id, 'EXPIRADO', r.fecha_expiracion_acceso);
    v_total := v_total + 1;
  END LOOP;

  FOR r IN
    SELECT b.id, b.usuario_id, b.fecha_efectiva FROM bajas b
    WHERE b.procesada_en IS NULL AND b.fecha_efectiva <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (SELECT 1 FROM borradores_evolucion WHERE autor_id = r.usuario_id) THEN
      INSERT INTO alertas_internas (tipo, referencia_id, detalle)
      VALUES ('BAJA_CON_BORRADORES', r.id, 'Baja cumplida sin procesar: el profesional tiene borradores de evolucion sin confirmar.')
      ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
      CONTINUE;
    END IF;
    BEGIN
      PERFORM desactivar_tratante(r.usuario_id, r.fecha_efectiva);
      UPDATE bajas SET procesada_en = now() WHERE id = r.id;
      PERFORM cerrar_cuenta(r.usuario_id);
      v_total := v_total + 1;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  -- Baja de un rol adicional: lo desactiva (corta sus sesiones) y elimina sus reseñas.
  FOR r IN
    SELECT ra.usuario_id, ra.rol FROM roles_adicionales ra
    WHERE ra.activo AND ra.fecha_baja <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (SELECT 1 FROM borradores_evolucion WHERE autor_id = r.usuario_id) THEN
      INSERT INTO alertas_internas (tipo, referencia_id, detalle)
      VALUES ('BAJA_CON_BORRADORES', r.usuario_id, 'Baja de rol cumplida sin procesar: hay borradores de evolucion sin confirmar.')
      ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
      CONTINUE;
    END IF;
    UPDATE roles_adicionales SET activo = false, desactivado_en = now() WHERE usuario_id = r.usuario_id AND rol = r.rol;
    PERFORM eliminar_resenas_de(r.usuario_id);
    v_total := v_total + 1;
  END LOOP;

  UPDATE citas c SET estado = 'POR_REPROGRAMAR', updated_at = now()
  FROM bajas b
  WHERE c.profesional_id = b.usuario_id AND c.estado IN ('CONFIRMADA', 'SOLICITADA') AND c.inicio >= b.fecha_efectiva;

  FOR r IN
    SELECT u.id FROM usuarios u
    WHERE u.rol::text <> 'PACIENTE' AND NOT u.activo AND u.cerrada_en IS NULL
      AND u.desactivado_en <= now() - make_interval(days => (SELECT dias_gracia_cierre FROM configuracion_centro))
      AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM cerrar_cuenta(r.id);
  END LOOP;

  RETURN v_total;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.proteger_bloque_atencion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM citas c
             WHERE c.profesional_id = OLD.profesional_id AND c.estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA')
               AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(OLD.inicio, OLD.fin, '[)'))
     OR EXISTS (SELECT 1 FROM bloqueos_temporales t
                WHERE t.profesional_id = OLD.profesional_id AND t.expira_en > now()
                  AND tstzrange(t.inicio, t.fin, '[)') && tstzrange(OLD.inicio, OLD.fin, '[)')) THEN
    RAISE EXCEPTION 'El bloque tiene citas o reservas en curso: reprograme o cancele antes de liberarlo'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.revocar_acceso_temporal(p_acceso_id uuid, p_motivo motivo_revocacion_acceso)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  a accesos_clinicos_temporales%ROWTYPE;
  v_tratante uuid;
BEGIN
  SELECT * INTO a FROM accesos_clinicos_temporales WHERE id = p_acceso_id FOR UPDATE;
  SELECT profesional_id INTO v_tratante FROM pacientes WHERE id = a.paciente_id;
  IF a.id IS NULL OR NOT acceso_vigente()
     OR NOT (app_rol() = 'ADMIN' OR (app_rol() = 'PROFESIONAL' AND v_tratante = app_usuario_id())) THEN
    RAISE EXCEPTION 'Acceso temporal inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF a.hasta <= now() OR EXISTS (SELECT 1 FROM revocaciones_acceso_temporal WHERE acceso_id = a.id) THEN
    RAISE EXCEPTION 'El acceso temporal ya no esta vigente' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id = a.paciente_id AND c.profesional_id = a.profesional_id
               AND c.profesional_id IS DISTINCT FROM v_tratante AND c.inicio > now()
               AND c.estado IN ('CONFIRMADA', 'SOLICITADA')) THEN
    RAISE EXCEPTION 'El profesional tiene sesiones por cubrir con este paciente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'revocacion_con_sesiones_por_cubrir';
  END IF;
  INSERT INTO revocaciones_acceso_temporal (acceso_id, motivo, revocado_por_id) VALUES (a.id, p_motivo, app_usuario_id());
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion, detalle)
  VALUES (app_usuario_id(), app_rol()::rol, a.paciente_id, 'accesos_clinicos_temporales', 'ACCESO_TEMPORAL', 'revocado');
  PERFORM encolar_notificacion('ACCESO_CLINICO_REVOCADO', a.paciente_id, NULL, a.id, app_usuario_id());
  PERFORM encolar_notificacion('ACCESO_CLINICO_REVOCADO', NULL, a.profesional_id, a.id, app_usuario_id());
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sesiones_espacios(desde timestamp with time zone, hasta timestamp with time zone)
 RETURNS TABLE(espacio_id uuid, inicio timestamp with time zone, fin timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'sesiones_espacios: requiere equipo con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF desde IS NULL OR hasta IS NULL OR hasta <= desde OR hasta - desde > interval '62 days' THEN
    RAISE EXCEPTION 'Rango invalido (maximo 62 dias)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'disponibilidad_publica_rango';
  END IF;
  RETURN QUERY
  SELECT c.espacio_id, c.inicio, c.fin FROM citas c
  WHERE c.estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') AND c.espacio_id IS NOT NULL
    AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(desde, hasta, '[)')
  ORDER BY c.espacio_id, c.inicio;
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
  IF NEW.estado NOT IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') THEN
    RETURN NEW;
  END IF;
  SELECT b.espacio_id INTO v_box FROM bloques_atencion b
  WHERE b.profesional_id = NEW.profesional_id AND b.inicio <= NEW.inicio AND b.fin >= NEW.fin;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cita cae fuera de la disponibilidad del profesional (horas de box apartadas)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_disponibilidad';
  END IF;
  NEW.espacio_id := CASE WHEN NEW.modalidad = 'PRESENCIAL' THEN v_box END;
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

CREATE OR REPLACE FUNCTION public.validar_menor_con_adulto_responsable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fecha_nacimiento date;
BEGIN
  IF NEW.estado NOT IN ('CONFIRMADA', 'SOLICITADA') THEN
    RETURN NEW;
  END IF;

  SELECT fecha_nacimiento INTO v_fecha_nacimiento FROM pacientes WHERE id = NEW.paciente_id;

  IF age((NEW.inicio AT TIME ZONE 'America/Santiago')::date, v_fecha_nacimiento) < interval '18 years'
     AND NOT EXISTS (SELECT 1 FROM adultos_responsables WHERE paciente_id = NEW.paciente_id) THEN
    RAISE EXCEPTION 'Paciente menor de 18 sin adulto responsable registrado'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_menor_requiere_adulto_responsable';
  END IF;

  RETURN NEW;
END;
$function$
;

-- Avisos y tablero sin pagos, deudas ni transferencias.
CREATE OR REPLACE FUNCTION public.notificaciones_por_enviar(p_limite integer)
 RETURNS TABLE(id uuid, tipo tipo_notificacion, canal canal_mensaje, referencia_id uuid, email text, asunto bytea, cuerpo bytea, plantilla_asunto text, plantilla_cuerpo text, enlace bytea, enlace_origen text, enlace_id uuid, adjunto bytea, datos jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de mensajes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH tomadas AS (
    SELECT n.id, n.tipo, n.canal, n.referencia_id, n.paciente_id, n.usuario_id, n.asunto, n.cuerpo, n.creada_en
    FROM notificaciones n
    WHERE n.estado = 'PENDIENTE' AND n.proximo_intento <= now()
    ORDER BY n.proximo_intento, n.creada_en
    LIMIT greatest(coalesce(p_limite, 50), 1)
    FOR UPDATE SKIP LOCKED
  ), base AS (
    SELECT t.*,
           CASE WHEN t.paciente_id IS NOT NULL THEN 'PACIENTE'::destinatario_mensaje ELSE 'EQUIPO' END AS destinatario,
           CASE
             WHEN t.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'CITA_CANCELADA', 'ENLACE_ONLINE', 'SOLICITUD_HORA',
                             'CIERRE_REQUERIDO', 'HORA_LIBERADA',
                             'CAMBIO_HORA_PROPUESTO', 'PROPUESTA_ACEPTADA', 'CITA_AUSENCIA_PROFESIONAL') THEN t.referencia_id
             WHEN t.tipo = 'RECORDATORIO_CITA' THEN (SELECT r.cita_id FROM recordatorios_cita r WHERE r.id = t.referencia_id)
           END AS cita_id,
           CASE
             WHEN t.tipo IN ('ACCESO_CLINICO_TEMPORAL', 'ACCESO_CLINICO_REVOCADO')
               THEN (SELECT a.profesional_id FROM accesos_clinicos_temporales a WHERE a.id = t.referencia_id)
           END AS otro_profesional_id
    FROM tomadas t
  )
  SELECT b.id, b.tipo, b.canal, b.referencia_id,
         CASE
           WHEN b.canal <> 'CORREO' THEN NULL
           WHEN b.usuario_id IS NOT NULL THEN (SELECT u.email FROM usuarios u WHERE u.id = b.usuario_id AND u.activo)
           WHEN age((now() AT TIME ZONE 'America/Santiago')::date, p.fecha_nacimiento) < interval '18 years' THEN
             (SELECT a.email FROM adultos_responsables a WHERE a.paciente_id = p.id AND a.email IS NOT NULL
              ORDER BY a.created_at LIMIT 1)
           ELSE coalesce(p.email, (SELECT u.email FROM usuarios u WHERE u.paciente_id = p.id AND u.activo))
         END,
         b.asunto, b.cuerpo, pl.asunto, pl.cuerpo,
         CASE WHEN b.tipo = 'RECORDATORIO_CITA' THEN r.enlace
              WHEN b.tipo = 'DOCUMENTO_CLINICO' THEN ev.enlace
              WHEN b.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'ENLACE_ONLINE') THEN c.enlace_online END,
         CASE WHEN b.tipo = 'RECORDATORIO_CITA' THEN 'recordatorios_cita'
              WHEN b.tipo = 'DOCUMENTO_CLINICO' THEN 'envios_documento'
              WHEN b.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'ENLACE_ONLINE') THEN 'citas' END,
         CASE WHEN b.tipo = 'RECORDATORIO_CITA' THEN r.id
              WHEN b.tipo = 'DOCUMENTO_CLINICO' THEN ev.id
              WHEN b.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'ENLACE_ONLINE') THEN c.id END,
         CASE WHEN b.canal = 'CORREO' AND b.tipo = 'DOCUMENTO_CLINICO' AND ev.modo = 'ADJUNTO' THEN d.contenido END,
         jsonb_strip_nulls(jsonb_build_object(
           'centro', (SELECT cc.nombre_centro FROM configuracion_centro cc),
           'destinatario', b.destinatario,
           'paciente', CASE WHEN b.destinatario = 'PACIENTE' THEN p.nombre END,
           'profesional', CASE
                            WHEN b.destinatario = 'EQUIPO' THEN ud.nombre
                            ELSE (SELECT coalesce(pf.nombre_publico, u.nombre) FROM usuarios u
                                  LEFT JOIN profesionales pf ON pf.usuario_id = u.id
                                  WHERE u.id = coalesce(c.profesional_id, d.emitido_por_id, co.practicante_id,
                                                        b.otro_profesional_id))
                          END,
           'cita_id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'modalidad', c.modalidad, 'estado', c.estado,
           'secuencia', c.secuencia, 'espacio', (SELECT e.nombre FROM espacios e WHERE e.id = c.espacio_id),
           'documento_id', d.id, 'tipo_documento', td.nombre, 'nombre_archivo', d.nombre_archivo,
           'emitido_en', d.emitido_en, 'modo', ev.modo,
           'creada_en', b.creada_en))
  FROM base b
  LEFT JOIN pacientes p ON p.id = b.paciente_id
  LEFT JOIN usuarios ud ON ud.id = b.usuario_id
  LEFT JOIN citas c ON c.id = b.cita_id
  LEFT JOIN recordatorios_cita r ON b.tipo = 'RECORDATORIO_CITA' AND r.id = b.referencia_id
  LEFT JOIN envios_documento ev ON b.tipo = 'DOCUMENTO_CLINICO' AND ev.id = b.referencia_id
  LEFT JOIN documentos_clinicos d ON d.id = ev.documento_id
  LEFT JOIN tipos_documento_clinico td ON td.id = d.tipo_documento_id
  LEFT JOIN consentimientos co ON b.tipo IN ('CONSENTIMIENTO_SOLICITADO', 'CONSENTIMIENTO_POR_VENCER') AND co.id = b.referencia_id
  LEFT JOIN plantillas_mensaje pl ON pl.evento = b.tipo AND pl.destinatario = b.destinatario AND pl.canal = b.canal
                                 AND pl.activa;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reporte_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rol text := app_rol();
  v_yo uuid := app_usuario_id();
  v_hoy date := (now() AT TIME ZONE 'America/Santiago')::date;
  v_ini timestamptz := v_hoy::timestamp AT TIME ZONE 'America/Santiago';
  v_fin timestamptz := (v_hoy + 1)::timestamp AT TIME ZONE 'America/Santiago';
  v_semana timestamptz := (v_hoy - (extract(isodow FROM v_hoy)::int - 1))::timestamp AT TIME ZONE 'America/Santiago';
  v_mes timestamptz := date_trunc('month', v_hoy)::timestamp AT TIME ZONE 'America/Santiago';
  v_minutos_box numeric;
  v_minutos_ocupados numeric;
BEGIN
  IF NOT acceso_vigente() OR v_rol NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'reporte_dashboard: solo equipo con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_rol IN ('PROFESIONAL', 'PRACTICANTE') THEN
    RETURN jsonb_build_object(
      'rol', v_rol,
      'sesiones_hoy', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'CONFIRMADA'
                       AND inicio >= v_ini AND inicio < v_fin),
      'sesiones_semana', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'CONFIRMADA'
                          AND inicio >= v_semana AND inicio < v_semana + interval '7 days'),
      'pacientes_activos', (SELECT count(DISTINCT c.paciente_id) FROM citas c
                            WHERE c.profesional_id = v_yo AND c.estado = 'CONFIRMADA' AND c.fin >= now() - interval '90 days'
                              AND NOT EXISTS (SELECT 1 FROM altas_paciente a WHERE a.paciente_id = c.paciente_id
                                              AND a.fecha >= (c.inicio AT TIME ZONE 'America/Santiago')::date)),
      'fichas_sin_cerrar', (SELECT count(*) FROM citas c WHERE c.profesional_id = v_yo AND cita_realizada(c.id)
                            AND c.fin >= now() - interval '30 days'
                            AND NOT EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = c.id)),
      'borradores', (SELECT count(*) FROM borradores_evolucion WHERE autor_id = v_yo),
      'solicitudes_por_aprobar', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'SOLICITADA'),
      'mensajes_sin_leer', (SELECT count(*) FROM mensajes_paciente WHERE profesional_id = v_yo AND leido_en IS NULL),
      'calificacion', (SELECT round(avg(calificacion), 1) FROM resenas WHERE profesional_id = v_yo AND estado = 'PUBLICADA'),
      'resenas', (SELECT count(*) FROM resenas WHERE profesional_id = v_yo AND estado = 'PUBLICADA'),
      'proxima_sesion', (SELECT jsonb_build_object('cita_id', id, 'inicio', inicio, 'espacio_id', espacio_id, 'modalidad', modalidad)
                         FROM citas WHERE profesional_id = v_yo AND estado = 'CONFIRMADA' AND inicio >= now()
                         ORDER BY inicio LIMIT 1));
  END IF;

  -- Horario de hoy de cada box activo: sus filas del periodo vigente; box sin
  -- filas propias = horario del centro; sin ninguno = 09:00-20:00 (muestra).
  SELECT coalesce(sum(extract(epoch FROM upper(r) - lower(r)) / 60), 0) INTO v_minutos_box
  FROM (SELECT tstzrange(minuto_local(v_hoy, h.inicio_min), minuto_local(v_hoy, h.fin_min), '[)') AS r
        FROM espacios e JOIN horarios_espacio h ON h.espacio_id = e.id
        WHERE e.activo AND h.dia_semana = extract(isodow FROM v_hoy)
          AND (h.vigente_desde IS NULL OR h.vigente_desde <= v_hoy) AND (h.vigente_hasta IS NULL OR v_hoy <= h.vigente_hasta)
        UNION ALL
        SELECT tstzrange(minuto_local(v_hoy, coalesce(hc.inicio_min, 540)), minuto_local(v_hoy, coalesce(hc.fin_min, 1200)), '[)')
        FROM espacios e
        LEFT JOIN horario_centro hc ON hc.dia_semana = extract(isodow FROM v_hoy)
        WHERE e.activo AND NOT EXISTS (SELECT 1 FROM horarios_espacio h WHERE h.espacio_id = e.id)
          AND (hc.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM horario_centro))) x;
  -- Apartado: minutos de hoy en bloques de atencion de boxes activos (el
  -- bloque ya cae dentro del horario del box y del centro).
  SELECT coalesce(sum(extract(epoch FROM least(b.fin, v_fin) - greatest(b.inicio, v_ini)) / 60), 0) INTO v_minutos_ocupados
  FROM bloques_atencion b JOIN espacios e ON e.id = b.espacio_id AND e.activo
  WHERE b.inicio < v_fin AND b.fin > v_ini;

  RETURN jsonb_build_object(
    'rol', v_rol,
    'pacientes_activos', (SELECT count(DISTINCT c.paciente_id) FROM citas c
                          WHERE c.estado = 'CONFIRMADA' AND c.fin >= now() - interval '90 days'
                            AND NOT EXISTS (SELECT 1 FROM altas_paciente a WHERE a.paciente_id = c.paciente_id
                                            AND a.fecha >= (c.inicio AT TIME ZONE 'America/Santiago')::date)),
    'pacientes_nuevos_mes', (SELECT count(*) FROM pacientes WHERE created_at >= v_mes),
    'sesiones_hoy', (SELECT count(*) FROM citas WHERE estado = 'CONFIRMADA' AND inicio >= v_ini AND inicio < v_fin),
    'por_confirmar', (SELECT count(*) FROM citas c WHERE c.inicio >= now() AND c.inicio < now() + interval '48 hours'
                      AND (c.estado = 'SOLICITADA'
                           OR (c.estado = 'CONFIRMADA' AND EXISTS (SELECT 1 FROM recordatorios_cita r
                                                                   WHERE r.cita_id = c.id AND r.respuesta IS NULL)))),
    'ocupacion_boxes_hoy', CASE WHEN v_minutos_box > 0 THEN least(100, round(100 * v_minutos_ocupados / v_minutos_box)) ELSE 0 END,
    'horas_libres_boxes_hoy', round(greatest(v_minutos_box - v_minutos_ocupados, 0) / 60.0, 1),
    'boxes_activos', (SELECT count(*) FROM espacios WHERE activo),
    'fichas_por_cerrar', (SELECT count(*) FROM citas c WHERE cita_realizada(c.id) AND c.fin >= now() - interval '7 days'
                          AND NOT EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = c.id)),
    'pendientes', jsonb_build_object(
      'solicitudes_por_aprobar', (SELECT count(*) FROM citas WHERE estado = 'SOLICITADA'),
      'ruts_faltantes', (SELECT count(*) FROM pacientes WHERE creado_por_solicitud AND rut IS NULL),
      'posibles_duplicados', (SELECT count(*) FROM pacientes WHERE posible_duplicado),
      'consentimientos_pendientes', (SELECT count(*) FROM consentimientos WHERE estado = 'SOLICITADO'),
      'practicantes_por_vencer', (SELECT count(*) FROM usuarios WHERE rol = 'PRACTICANTE' AND activo
                                  AND fecha_expiracion_acceso < now() + interval '14 days'),
      'por_reprogramar', (SELECT count(*) FROM citas WHERE estado = 'POR_REPROGRAMAR' AND inicio >= now()),
      'resenas_por_moderar', CASE WHEN v_rol = 'ADMIN' THEN (SELECT count(*) FROM resenas WHERE estado = 'PENDIENTE') END,
      'alertas_abiertas', CASE WHEN v_rol = 'ADMIN' THEN (SELECT count(*) FROM alertas_internas WHERE atendida_en IS NULL) END));
END;
$function$
;


-- 8. Valores de enum que desaparecen: Postgres no borra valores, se recrea el
--    tipo. pg_temp.recrear_enum guarda las funciones con el tipo en la firma
--    (definicion y permisos), las borra, cambia el tipo de las columnas y las
--    vuelve a crear con los mismos permisos. Los constraints, indices y
--    triggers que nombran el tipo o la columna se rehacen aparte.
CREATE FUNCTION pg_temp.recrear_enum(p_tipo text, p_valores text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  f record;
  c record;
  v_anterior text := p_tipo || '_anterior';
BEGIN
  CREATE TEMP TABLE firmas_enum AS
    SELECT p.oid::regprocedure::text AS sig, pg_get_functiondef(p.oid) AS def, p.proacl AS acl
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND (pg_get_function_arguments(p.oid) ~ ('\m' || p_tipo || '\M') OR pg_get_function_result(p.oid) ~ ('\m' || p_tipo || '\M'));
  FOR f IN SELECT * FROM firmas_enum LOOP
    EXECUTE 'DROP FUNCTION ' || f.sig;
  END LOOP;

  EXECUTE format('ALTER TYPE %I RENAME TO %I', p_tipo, v_anterior);
  EXECUTE format('CREATE TYPE %I AS ENUM (%s)', p_tipo, (SELECT string_agg(quote_literal(v), ', ') FROM unnest(p_valores) AS v));
  FOR c IN
    SELECT table_name, column_name, column_default, data_type = 'ARRAY' AS arreglo
    FROM information_schema.columns
    WHERE table_schema = 'public' AND udt_name IN (v_anterior, '_' || v_anterior)
  LOOP
    IF c.column_default IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', c.table_name, c.column_name);
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %I%s USING %I::text%s::%I%s', c.table_name, c.column_name,
                   p_tipo, CASE WHEN c.arreglo THEN '[]' ELSE '' END, c.column_name,
                   CASE WHEN c.arreglo THEN '[]' ELSE '' END, p_tipo, CASE WHEN c.arreglo THEN '[]' ELSE '' END);
    IF c.column_default IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s', c.table_name, c.column_name,
                     replace(c.column_default, v_anterior, p_tipo));
    END IF;
  END LOOP;
  EXECUTE format('DROP TYPE %I', v_anterior);

  FOR f IN SELECT * FROM firmas_enum LOOP
    EXECUTE f.def;
    PERFORM pg_temp.aplicar_acl(f.sig, f.acl);
  END LOOP;
  DROP TABLE firmas_enum;
END;
$$;

-- estado_cita sin PENDIENTE_PAGO. Los EXCLUDE y CHECK con valores del tipo y
-- los triggers con UPDATE OF estado no dejan cambiar la columna: se rehacen.
ALTER TABLE citas
  DROP CONSTRAINT citas_margen_traslado,
  DROP CONSTRAINT citas_paciente_segun_estado,
  DROP CONSTRAINT citas_liberacion_coherente,
  DROP CONSTRAINT citas_aprobacion_coherente,
  DROP CONSTRAINT citas_propuesta_coherente,
  DROP CONSTRAINT citas_no_solapamiento_espacio,
  DROP CONSTRAINT citas_no_solapamiento_profesional;
DROP TRIGGER citas_menor_requiere_adulto_responsable ON citas;
DROP TRIGGER citas_margen_fijado ON citas;
DROP TRIGGER citas_agenda_valida ON citas;

SELECT pg_temp.recrear_enum('estado_cita',
  ARRAY['CONFIRMADA', 'CANCELADA', 'POR_REPROGRAMAR', 'SOLICITADA', 'LIBERADA', 'RETENIDA', 'PROPUESTA']);

ALTER TABLE citas
  ADD CONSTRAINT citas_margen_traslado EXCLUDE USING gist (profesional_id WITH =, modalidad WITH <>,
    rango_con_margen(inicio, fin, margen_traslado_min::integer) WITH &&) WHERE (estado = 'CONFIRMADA'),
  ADD CONSTRAINT citas_paciente_segun_estado CHECK (paciente_id IS NOT NULL OR estado IN ('RETENIDA', 'LIBERADA')),
  ADD CONSTRAINT citas_retencion_coherente CHECK (estado <> 'RETENIDA' OR retencion_vence_en IS NOT NULL),
  ADD CONSTRAINT citas_liberacion_coherente CHECK ((liberada_por_id IS NULL) = (motivo_liberacion IS NULL)
    AND (liberada_por_id IS NULL OR (estado = 'LIBERADA' AND length(btrim(motivo_liberacion)) BETWEEN 3 AND 500))),
  ADD CONSTRAINT citas_aprobacion_coherente CHECK (estado NOT IN ('SOLICITADA', 'PROPUESTA') OR aprobacion_vence_en IS NOT NULL),
  ADD CONSTRAINT citas_propuesta_coherente CHECK (estado <> 'PROPUESTA' OR propuesta_de_id IS NOT NULL),
  ADD CONSTRAINT citas_no_solapamiento_espacio EXCLUDE USING gist (espacio_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
    WHERE (estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA') AND modalidad = 'PRESENCIAL'),
  ADD CONSTRAINT citas_no_solapamiento_profesional EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
    WHERE (estado IN ('CONFIRMADA', 'RETENIDA', 'SOLICITADA', 'PROPUESTA'));
CREATE TRIGGER citas_menor_requiere_adulto_responsable BEFORE INSERT OR UPDATE OF estado, paciente_id, inicio ON citas
  FOR EACH ROW EXECUTE FUNCTION validar_menor_con_adulto_responsable();
CREATE TRIGGER citas_margen_fijado BEFORE INSERT OR UPDATE OF estado, profesional_id, inicio, fin, modalidad ON citas
  FOR EACH ROW EXECUTE FUNCTION fijar_margen_cita();
CREATE TRIGGER citas_agenda_valida BEFORE INSERT OR UPDATE OF estado, inicio, fin, profesional_id, modalidad, espacio_id ON citas
  FOR EACH ROW EXECUTE FUNCTION validar_agenda_cita();

-- tipo_notificacion sin los avisos de pago.
SELECT pg_temp.recrear_enum('tipo_notificacion',
  ARRAY['CITA_CONFIRMADA', 'CITA_CANCELADA', 'CITA_REPROGRAMADA', 'ENLACE_ONLINE', 'CONSENTIMIENTO_SOLICITADO',
        'AVISO_CAMBIO_SUPERVISOR', 'DERIVACION_OFRECIDA', 'MENSAJE_PACIENTE', 'DOCUMENTO_CLINICO', 'DERIVACION_ACTUALIZADA',
        'RECORDATORIO_CITA', 'CONSENTIMIENTO_POR_VENCER', 'HORA_LIBERADA', 'ACCESO_CLINICO_TEMPORAL', 'SOLICITUD_HORA',
        'CIERRE_REQUERIDO', 'POSIBLE_DUPLICADO', 'MENSAJE_INTERNO', 'ACCESO_CLINICO_REVOCADO', 'CAMBIO_HORA_PROPUESTO',
        'PROPUESTA_ACEPTADA', 'CONTACTO_EMERGENCIA_PENDIENTE', 'CITA_AUSENCIA_PROFESIONAL', 'MENSAJE_PROFESIONAL']);

-- modulo_centro sin COBROS (la BD exige solo MATCH -> EQUIPO).
ALTER TABLE configuracion_centro DROP CONSTRAINT configuracion_centro_modulos_coherentes;
ALTER TABLE perfiles_rol DROP CONSTRAINT perfiles_rol_restricciones;
SELECT pg_temp.recrear_enum('modulo_centro', ARRAY['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'WHATSAPP']);
ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_modulos_coherentes
  CHECK (modulos_activos IS NOT NULL AND (NOT 'MATCH' = ANY (modulos_activos) OR 'EQUIPO' = ANY (modulos_activos)));
ALTER TABLE perfiles_rol ADD CONSTRAINT perfiles_rol_restricciones
  CHECK (restricciones <@ ARRAY['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH']::modulo_centro[]);

-- tipo_token_correo sin PAGO_CITA (enlace de pago por correo).
SELECT pg_temp.recrear_enum('tipo_token_correo',
  ARRAY['VERIFICACION_SOLICITUD', 'INVITACION', 'RECUPERACION', 'ACCESO', 'VERIFICACION_CORREO', 'CONSENTIMIENTO',
        'VERIFICACION_LISTA_ESPERA', 'BAJA_LISTA_ESPERA']);
