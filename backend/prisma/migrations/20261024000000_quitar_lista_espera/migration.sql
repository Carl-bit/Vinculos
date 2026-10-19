-- =============================================================================
-- Rollback de la lista de espera: queda como implementacion futura (entrega
-- posterior). Se retira de la primera version de prueba:
--
-- 1. Lista con cuenta (03a, lista_espera): tabla, estado_lista_espera, aviso
--    HORA_LIBERADA al liberarse una hora (trigger citas_hora_liberada), cierre
--    al registrar el alta y contador del dashboard.
-- 2. "Avisarme si se libera una hora antes" de la solicitud sin cuenta
--    (solicitudes_hora.lista_espera y p_lista_espera de crear_solicitud_hora).
-- 3. Lista publica sin cuenta (03b, lista_espera_publica): tabla, funciones de
--    inscripcion/verificacion/baja, job de avisos, aviso por bloque nuevo y
--    configuracion_centro.dias_lista_espera_publica.
--
-- Los valores de enum HORA_LIBERADA (tipo_notificacion) y
-- VERIFICACION_LISTA_ESPERA / BAJA_LISTA_ESPERA (tipo_token_correo) quedan sin
-- uso: PostgreSQL no quita valores de un enum sin recrear el tipo. Nadie los
-- emite despues de esta migracion. Las migraciones aplicadas no se editan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Avisos (triggers y funciones internas)
-- -----------------------------------------------------------------------------
DROP TRIGGER citas_hora_liberada ON citas;
DROP FUNCTION avisar_hora_liberada();
DROP TRIGGER bloques_atencion_avisan ON bloques_atencion;
DROP FUNCTION avisar_bloques_nuevos();
DROP FUNCTION avisar_lista_espera(uuid, uuid);

-- Lista publica: funciones sin contexto y del job.
DROP FUNCTION inscribir_lista_espera_publica(uuid, uuid, text, text, bytea, uuid, bytea);
DROP FUNCTION verificar_lista_espera_publica(bytea, bytea);
DROP FUNCTION baja_lista_espera_publica(bytea);
DROP FUNCTION avisos_lista_espera_publica(int);
DROP FUNCTION token_baja_lista_espera(uuid, bytea);
DROP FUNCTION limpiar_lista_espera_publica();

-- Enlaces de la lista publica que pudieran quedar vigentes.
DELETE FROM tokens_correo WHERE tipo IN ('VERIFICACION_LISTA_ESPERA', 'BAJA_LISTA_ESPERA');

-- Plantillas del aviso de hora liberada (nadie lo emite). Los avisos ya
-- enviados quedan en el historial de notificaciones.
DELETE FROM plantillas_mensaje WHERE evento = 'HORA_LIBERADA';

-- -----------------------------------------------------------------------------
-- 2. Funciones que tocaban lista_espera (mismo cuerpo, sin la lista)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_alta(p_id uuid, p_paciente_id uuid, p_fecha date, p_motivo bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR NOT es_profesional_de_paciente(p_paciente_id)
     OR (app_rol() = 'PRACTICANTE' AND NOT consentimiento_practicante_vigente(p_paciente_id)) THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_fecha IS NULL OR p_fecha > (now() AT TIME ZONE 'America/Santiago')::date THEN
    RAISE EXCEPTION 'La fecha de alta no puede ser futura' USING ERRCODE = 'check_violation', CONSTRAINT = 'altas_paciente_fecha';
  END IF;
  INSERT INTO altas_paciente (id, paciente_id, fecha, motivo, registrada_por_id)
  VALUES (p_id, p_paciente_id, p_fecha, p_motivo, app_usuario_id());
  UPDATE solicitudes_hora SET respuestas = NULL WHERE paciente_id = p_paciente_id AND respuestas IS NOT NULL;
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), app_rol()::rol, p_paciente_id, 'altas_paciente', 'ESCRITURA');
END;
$$;

-- Verificar el correo concreta la solicitud: paciente (id de la API), ficha,
-- adulto responsable, aceptaciones, cita CONFIRMADA (o SOLICITADA si el
-- profesional aprueba pacientes nuevos) e invitacion.
CREATE OR REPLACE FUNCTION concretar_solicitud_hora(
  p_token_hash bytea, p_paciente_id uuid, p_adulto_id uuid, p_telefono bytea, p_rut bytea, p_rut_hmac bytea,
  p_adulto_telefono bytea, p_invitacion_hash bytea, p_invitacion_expira timestamptz)
RETURNS TABLE (paciente_id uuid, cita_id uuid, estado estado_cita, modalidad modalidad_atencion, profesional_id uuid,
               inicio timestamptz, fin timestamptz, invitacion_email text, invitacion_rol rol,
               sala_modo modo_videollamada, sala_enlace bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_token_hash, 'VERIFICACION_SOLICITUD');
  s solicitudes_hora%ROWTYPE;
  v_menor boolean;
  v_rut_libre boolean;
  v_dup boolean;
  v_estado estado_cita;
  v_cita uuid;
  v_adulto uuid;
  v_inv_email text;
  v_inv_rol rol;
BEGIN
  SELECT * INTO s FROM solicitudes_hora WHERE id = t.referencia_id FOR UPDATE;
  IF s.estado <> 'PENDIENTE_VERIFICACION' OR s.expira_en <= now() THEN
    RAISE EXCEPTION 'La solicitud vencio: pida la hora de nuevo' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  v_menor := age((s.inicio AT TIME ZONE 'America/Santiago')::date, s.fecha_nacimiento) < interval '18 years';
  v_rut_libre := p_rut_hmac IS NULL OR NOT EXISTS (SELECT 1 FROM pacientes WHERE rut_hmac = p_rut_hmac);
  -- Nunca fusionar por nombre (D-2): identidad = RUT (indice ciego) + correo verificado. Coincidencias -> GESTION concilia.
  v_dup := NOT v_rut_libre
           OR (NOT v_menor AND EXISTS (SELECT 1 FROM pacientes WHERE lower(email) = s.email));

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

  DELETE FROM bloqueos_temporales WHERE solicitud_id = s.id;
  v_estado := CASE WHEN (SELECT requiere_aprobacion_nuevos FROM profesionales WHERE usuario_id = s.profesional_id)
                   THEN 'SOLICITADA' ELSE 'CONFIRMADA' END;
  INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin, estado)
  VALUES (s.espacio_id, s.modalidad, s.profesional_id, p_paciente_id, s.inicio, s.fin, v_estado)
  RETURNING id INTO v_cita;
  UPDATE solicitudes_hora SET estado = 'CONCRETADA', paciente_id = p_paciente_id, cita_id = v_cita, concretada_en = now()
  WHERE id = s.id;

  IF v_estado = 'CONFIRMADA' THEN
    PERFORM encolar_notificacion('CITA_CONFIRMADA', p_paciente_id, NULL, v_cita, NULL);
    IF p_invitacion_hash IS NOT NULL THEN
      SELECT i.email, i.rol INTO v_inv_email, v_inv_rol
      FROM invitar_paciente_del_portal(p_paciente_id, p_invitacion_hash, p_invitacion_expira) i;
    END IF;
  ELSE
    PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, s.profesional_id, v_cita, NULL);
  END IF;

  RETURN QUERY
  SELECT p_paciente_id, v_cita, v_estado, s.modalidad, s.profesional_id, s.inicio, s.fin, v_inv_email, v_inv_rol,
         sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON s.modalidad = 'ONLINE' AND sv.usuario_id = s.profesional_id;
END;
$$;

-- Solicitud de hora sin cuenta (como 03b), sin p_lista_espera.
DROP FUNCTION crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea,
                                   bytea, bytea, text, text, bytea, bytea, uuid, boolean, uuid, uuid, bytea);
ALTER TABLE solicitudes_hora DROP COLUMN lista_espera;

CREATE FUNCTION crear_solicitud_hora(
  p_id uuid, p_profesional_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz, p_fin timestamptz,
  p_nombre text, p_apellido text, p_fecha_nacimiento date, p_email text, p_telefono bytea,
  p_rut bytea, p_rut_hmac bytea, p_adulto_nombre text, p_adulto_parentesco text, p_adulto_telefono bytea,
  p_respuestas bytea, p_recomendado_id uuid, p_politica_id uuid, p_terminos_id uuid,
  p_token_hash bytea)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_expira timestamptz := now() + make_interval(mins => (SELECT minutos_retencion_solicitud FROM configuracion_centro));
  v_espacio uuid;
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
  IF (SELECT count(*) FROM solicitudes_hora
      WHERE lower(email) = lower(p_email) AND estado = 'PENDIENTE_VERIFICACION' AND expira_en > now()) >= 2 THEN
    RAISE EXCEPTION 'Ya hay solicitudes pendientes de verificar para este correo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_hora_limite';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico)
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
  IF p_modalidad = 'PRESENCIAL' THEN
    -- disponibilidad_publica ya exige un bloque que cubra la hora.
    SELECT b.espacio_id INTO v_espacio FROM bloques_atencion b
    WHERE b.profesional_id = p_profesional_id AND b.inicio <= p_inicio AND b.fin >= p_fin;
  END IF;

  INSERT INTO solicitudes_hora (id, profesional_id, modalidad, espacio_id, inicio, fin, nombre, apellido, fecha_nacimiento,
                                email, telefono, rut, rut_hmac, adulto_nombre, adulto_parentesco, adulto_telefono,
                                respuestas, recomendado_id, politica_id, terminos_id, expira_en)
  VALUES (p_id, p_profesional_id, p_modalidad, v_espacio, p_inicio, p_fin, btrim(p_nombre), btrim(p_apellido),
          p_fecha_nacimiento, lower(btrim(p_email)), p_telefono, p_rut, p_rut_hmac, nullif(btrim(p_adulto_nombre), ''),
          p_adulto_parentesco, p_adulto_telefono, p_respuestas, p_recomendado_id,
          p_politica_id, p_terminos_id, v_expira);
  INSERT INTO bloqueos_temporales (solicitud_id, profesional_id, espacio_id, modalidad, inicio, fin, expira_en)
  VALUES (p_id, p_profesional_id, v_espacio, p_modalidad, p_inicio, p_fin, v_expira);
  PERFORM emitir_token('VERIFICACION_SOLICITUD', p_token_hash, v_expira, NULL, NULL, NULL, p_id, NULL, lower(btrim(p_email)));
  RETURN v_expira;
END;
$$;
REVOKE EXECUTE ON FUNCTION
  crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea,
                       bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea,
                       bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea)
TO app_user;

-- Dashboard (como 03b) sin pendientes.lista_espera.
CREATE OR REPLACE FUNCTION reporte_dashboard() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
$$;

-- Job de mensajes (como 03a) sin el caso HORA_LIBERADA (leia lista_espera).
CREATE OR REPLACE FUNCTION notificaciones_por_enviar(p_limite int)
RETURNS TABLE (id uuid, tipo tipo_notificacion, canal canal_mensaje, referencia_id uuid, email text,
               asunto bytea, cuerpo bytea, plantilla_asunto text, plantilla_cuerpo text,
               enlace bytea, enlace_origen text, enlace_id uuid, adjunto bytea, datos jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
                             'CIERRE_REQUERIDO') THEN t.referencia_id
             WHEN t.tipo = 'RECORDATORIO_CITA' THEN (SELECT r.cita_id FROM recordatorios_cita r WHERE r.id = t.referencia_id)
             WHEN t.tipo = 'PAGO_REGISTRADO' THEN (SELECT pg.cita_id FROM pagos pg WHERE pg.id = t.referencia_id)
             WHEN t.tipo = 'BOLETA_EMITIDA' THEN (SELECT b.cita_id FROM boletas b WHERE b.id = t.referencia_id)
           END AS cita_id,
           CASE
             WHEN t.tipo = 'ACCESO_CLINICO_TEMPORAL'
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
$$;

-- -----------------------------------------------------------------------------
-- 3. Tablas y configuracion
-- -----------------------------------------------------------------------------
DROP TABLE lista_espera_publica;
DROP TABLE lista_espera;
DROP TYPE estado_lista_espera;
ALTER TABLE configuracion_centro DROP COLUMN dias_lista_espera_publica;
