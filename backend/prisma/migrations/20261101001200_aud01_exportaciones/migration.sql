-- =============================================================================
-- AUD-01 Fase 3 (E3.1, E3.2; ARCOP-02, LEG-04; decisiones X1 a X4 del
-- 2026-10-28, docs/cumplimiento/exportacion.md).
--
-- 1. Lectura para exportar (SECURITY DEFINER, columnas cifradas tal cual:
--    las descifra la API con registro.ts; sin hashes ni HMAC):
--    * exportar_datos_paciente(paciente, 'ADMINISTRATIVA'): ADMIN.
--    * exportar_datos_paciente(paciente, 'CLINICA'): solo el profesional
--      tratante (ADMIN nunca ve notas clinicas, CENS-S6).
--    * exportar_tabla_centro(tabla): ADMIN, para la salida del servicio; la
--      API cifra el resultado con la clave que da el ADMIN (D5).
--    Toda lectura queda en accesos_ficha (EXPORTACION) o la registra la API
--    en registro_exportaciones.
-- 2. exportaciones_paciente (A): la parte administrativa y la clinica,
--    cifradas (CLINICO, id de la API); al completarse, enlace de un solo uso
--    al correo registrado (vence en 72 h). Paciente con cuenta: la descarga
--    exige su sesion; sin cuenta: el codigo del segundo correo. Vencida, el
--    job borra los datos (queda el registro).
-- =============================================================================

-- Fila para exportar: sin hashes ni indices ciegos.
CREATE FUNCTION fila_exportable(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  FROM jsonb_each(p) AS e(k, v)
  WHERE k NOT LIKE '%\_hmac' AND k NOT LIKE '%\_hash' AND k NOT IN ('password_hash', 'totp_secreto')
$$;

CREATE FUNCTION exportar_datos_paciente(p_paciente_id uuid, p_parte text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
      'pagos', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM pagos t JOIN citas c ON c.id = t.cita_id WHERE c.paciente_id = p_paciente_id),
      'comprobantes_pago', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM comprobantes_pago t JOIN citas c ON c.id = t.cita_id WHERE c.paciente_id = p_paciente_id),
      'documentos_tributarios', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM documentos_tributarios t JOIN citas c ON c.id = t.cita_id WHERE c.paciente_id = p_paciente_id),
      'resoluciones_cita', (SELECT jsonb_agg(fila_exportable(to_jsonb(t))) FROM resoluciones_cita t JOIN citas c ON c.id = t.cita_id WHERE c.paciente_id = p_paciente_id),
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
$$;

-- Salida del centro: una tabla a la vez (lista cerrada). Sin llaves, sesiones, tokens ni codigos.
CREATE FUNCTION exportar_tabla_centro(p_tabla text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'La exportacion del centro la pide un ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_tabla IS NULL OR p_tabla IN ('_prisma_migrations', 'llaves_datos', 'custodios_llave', 'eventos_llaves', 'sesiones', 'tokens_correo',
                                    'codigos_verificacion', 'codigos_respaldo', 'intentos_login_fallidos', 'correos_cuenta_pendientes',
                                    'feeds_calendario', 'salas_videollamada', 'cobros_pasarela', 'exportaciones_paciente')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = p_tabla) THEN
    RAISE EXCEPTION 'Tabla fuera de la exportacion' USING ERRCODE = 'check_violation', CONSTRAINT = 'exportacion_centro_tabla';
  END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(fila_exportable(to_jsonb(t))), ''[]''::jsonb) FROM %I t', p_tabla) INTO v;
  RETURN v;
END;
$$;

-- Tablas de la exportacion del centro (la API las recorre en este orden).
CREATE FUNCTION tablas_exportacion_centro() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT table_name::text FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    AND table_name NOT IN ('_prisma_migrations', 'llaves_datos', 'custodios_llave', 'eventos_llaves', 'sesiones', 'tokens_correo',
                           'codigos_verificacion', 'codigos_respaldo', 'intentos_login_fallidos', 'correos_cuenta_pendientes',
                           'feeds_calendario', 'salas_videollamada', 'cobros_pasarela', 'exportaciones_paciente')
  ORDER BY table_name
$$;

-- 2. Exportaciones por paciente (A)
-- CreateTable
CREATE TABLE "exportaciones_paciente" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "solicitud_id" UUID NOT NULL,
    "datos_administrativos" BYTEA,
    "datos_clinicos" BYTEA,
    "requiere_clinica" BOOLEAN NOT NULL,
    "creada_por_id" UUID NOT NULL,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinica_por_id" UUID,
    "clinica_en" TIMESTAMPTZ(6),
    "token_hash" BYTEA,
    "codigo_hash" BYTEA,
    "enviada_en" TIMESTAMPTZ(6),
    "vence_en" TIMESTAMPTZ(6),
    "descargas" INTEGER NOT NULL DEFAULT 0,
    "ultima_descarga_en" TIMESTAMPTZ(6),
    "purgada_en" TIMESTAMPTZ(6),

    CONSTRAINT "exportaciones_paciente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "exportaciones_paciente_token_hash_key" ON "exportaciones_paciente"("token_hash");
CREATE INDEX "exportaciones_paciente_paciente_id_idx" ON "exportaciones_paciente"("paciente_id");
ALTER TABLE "exportaciones_paciente" ADD CONSTRAINT "exportaciones_paciente_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exportaciones_paciente" ADD CONSTRAINT "exportaciones_paciente_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes_derechos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exportaciones_paciente" ADD CONSTRAINT "exportaciones_paciente_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "exportaciones_paciente" ADD CONSTRAINT "exportaciones_paciente_clinica_por_id_fkey" FOREIGN KEY ("clinica_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE exportaciones_paciente ADD CONSTRAINT exportaciones_paciente_cifrado
  CHECK ((datos_administrativos IS NULL OR octet_length(datos_administrativos) >= 49)
         AND (datos_clinicos IS NULL OR octet_length(datos_clinicos) >= 49));
ALTER TABLE exportaciones_paciente ADD CONSTRAINT exportaciones_paciente_coherente
  CHECK ((clinica_en IS NULL) = (clinica_por_id IS NULL)
         AND (enviada_en IS NULL) = (token_hash IS NULL) AND (enviada_en IS NULL) = (vence_en IS NULL)
         AND (purgada_en IS NOT NULL OR datos_administrativos IS NOT NULL));
COMMENT ON TABLE exportaciones_paciente IS
  'Categoria A. Exportacion de los datos de un paciente (ARCOP-02): parte administrativa (ADMIN) y clinica (tratante), cifradas; enlace de un solo uso, 72 h; vencida se purga.';

ALTER TABLE exportaciones_paciente ENABLE ROW LEVEL SECURITY;
ALTER TABLE exportaciones_paciente FORCE ROW LEVEL SECURITY;
-- Metadatos: ADMIN todas; el tratante las de sus pacientes (para generar la parte clinica).
CREATE POLICY exportaciones_paciente_select ON exportaciones_paciente FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN'
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND paciente_id IN (SELECT id FROM pacientes WHERE profesional_id = (SELECT app_usuario_id()))));
CREATE POLICY exportaciones_paciente_acceso_vigente ON exportaciones_paciente AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT (id, paciente_id, solicitud_id, requiere_clinica, creada_por_id, creada_en, clinica_por_id, clinica_en, enviada_en,
              vence_en, descargas, ultima_descarga_en, purgada_en) ON exportaciones_paciente TO app_user;

-- ADMIN: con una solicitud abierta de ACCESO o PORTABILIDAD del paciente.
CREATE FUNCTION crear_exportacion_paciente(p_id uuid, p_solicitud_id uuid, p_datos bytea) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s solicitudes_derechos%ROWTYPE;
  v_clinica boolean;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'La exportacion la prepara un ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM solicitudes_derechos WHERE id = p_solicitud_id;
  IF NOT FOUND OR s.paciente_id IS NULL OR s.tipo NOT IN ('ACCESO', 'PORTABILIDAD') OR s.estado NOT IN ('RECIBIDA', 'EN_CURSO') THEN
    RAISE EXCEPTION 'Se exporta con una solicitud abierta de acceso o portabilidad de un paciente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'exportaciones_paciente_solicitud';
  END IF;
  IF EXISTS (SELECT 1 FROM exportaciones_paciente WHERE solicitud_id = p_solicitud_id AND purgada_en IS NULL) THEN
    RAISE EXCEPTION 'La solicitud ya tiene una exportacion en curso' USING ERRCODE = 'unique_violation',
      CONSTRAINT = 'exportaciones_paciente_una_por_solicitud';
  END IF;
  v_clinica := EXISTS (SELECT 1 FROM fichas_clinicas WHERE paciente_id = s.paciente_id);
  INSERT INTO exportaciones_paciente (id, paciente_id, solicitud_id, datos_administrativos, requiere_clinica, creada_por_id)
  VALUES (p_id, s.paciente_id, s.id, p_datos, v_clinica, app_usuario_id());
  IF s.estado = 'RECIBIDA' THEN
    UPDATE solicitudes_derechos SET estado = 'EN_CURSO' WHERE id = s.id;
  END IF;
  RETURN v_clinica;
END;
$$;

-- Tratante: agrega la parte clinica.
CREATE FUNCTION agregar_clinica_exportacion(p_id uuid, p_datos bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e exportaciones_paciente%ROWTYPE;
BEGIN
  SELECT * INTO e FROM exportaciones_paciente WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exportacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL'
     OR app_usuario_id() IS DISTINCT FROM (SELECT profesional_id FROM pacientes WHERE id = e.paciente_id) THEN
    RAISE EXCEPTION 'La parte clinica la genera el profesional tratante' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT e.requiere_clinica OR e.clinica_en IS NOT NULL OR e.purgada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La exportacion no espera la parte clinica' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE exportaciones_paciente SET datos_clinicos = p_datos, clinica_por_id = app_usuario_id(), clinica_en = now() WHERE id = p_id;
END;
$$;

-- Completa: registra el enlace (hash) y, si no tiene cuenta, el codigo (hash). Devuelve el correo registrado.
CREATE FUNCTION enviar_exportacion(p_id uuid, p_token_hash bytea, p_codigo_hash bytea) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e exportaciones_paciente%ROWTYPE;
  v_correo text;
BEGIN
  SELECT * INTO e FROM exportaciones_paciente WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exportacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT acceso_vigente() OR NOT (app_rol() = 'ADMIN' OR (app_rol() = 'PROFESIONAL' AND app_usuario_id() = e.clinica_por_id)) THEN
    RAISE EXCEPTION 'Envia la exportacion quien la completo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF e.enviada_en IS NOT NULL OR e.purgada_en IS NOT NULL OR (e.requiere_clinica AND e.clinica_en IS NULL) THEN
    RAISE EXCEPTION 'La exportacion no esta lista para enviar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT email INTO v_correo FROM pacientes WHERE id = e.paciente_id;
  IF v_correo IS NULL THEN
    RAISE EXCEPTION 'El paciente no tiene correo registrado: entregar en persona' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'exportaciones_paciente_sin_correo';
  END IF;
  UPDATE exportaciones_paciente SET token_hash = p_token_hash,
         codigo_hash = CASE WHEN exportacion_con_cuenta(e.paciente_id) THEN NULL ELSE p_codigo_hash END,
         enviada_en = now(), vence_en = now() + interval '72 hours'
  WHERE id = p_id;
  RETURN v_correo;
END;
$$;

-- El paciente tiene cuenta propia activa (entonces la descarga exige su sesion).
CREATE FUNCTION exportacion_con_cuenta(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios WHERE paciente_id = p_paciente_id AND rol = 'PACIENTE' AND activo AND cerrada_en IS NULL)
$$;

-- Descarga: con cuenta, la sesion del paciente; sin cuenta, el codigo. Devuelve los datos cifrados.
CREATE FUNCTION entregar_exportacion(p_token_hash bytea, p_codigo_hash bytea)
RETURNS TABLE (id uuid, paciente_id uuid, datos_administrativos bytea, datos_clinicos bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  e exportaciones_paciente%ROWTYPE;
BEGIN
  SELECT * INTO e FROM exportaciones_paciente x WHERE x.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR e.purgada_en IS NOT NULL OR e.vence_en <= now() THEN
    RAISE EXCEPTION 'Enlace inexistente o vencido' USING ERRCODE = 'no_data_found';
  END IF;
  IF exportacion_con_cuenta(e.paciente_id) THEN
    IF app_usuario_id() IS NULL OR app_usuario_id() IS DISTINCT FROM
         (SELECT u.id FROM usuarios u WHERE u.paciente_id = e.paciente_id AND u.rol = 'PACIENTE' AND u.activo LIMIT 1) THEN
      RAISE EXCEPTION 'Inicia sesion con tu cuenta para descargar' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion) VALUES (app_usuario_id(), 'PACIENTE', e.paciente_id, 'exportacion_paciente', 'DESCARGA');
  ELSIF e.codigo_hash IS NULL OR p_codigo_hash IS DISTINCT FROM e.codigo_hash THEN
    RAISE EXCEPTION 'Codigo incorrecto' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE exportaciones_paciente SET descargas = descargas + 1, ultima_descarga_en = now() WHERE exportaciones_paciente.id = e.id;
  RETURN QUERY SELECT e.id, e.paciente_id, e.datos_administrativos, e.datos_clinicos;
END;
$$;

-- Job (sin contexto): borra los datos de las vencidas (queda el registro).
CREATE FUNCTION purgar_exportaciones_vencidas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n int;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de purga' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE exportaciones_paciente SET datos_administrativos = NULL, datos_clinicos = NULL, purgada_en = now()
  WHERE purgada_en IS NULL AND ((vence_en IS NOT NULL AND vence_en <= now()) OR (enviada_en IS NULL AND creada_en < now() - interval '30 days'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION fila_exportable(jsonb), exportar_datos_paciente(uuid, text), exportar_tabla_centro(text), tablas_exportacion_centro(),
  crear_exportacion_paciente(uuid, uuid, bytea), agregar_clinica_exportacion(uuid, bytea), enviar_exportacion(uuid, bytea, bytea),
  exportacion_con_cuenta(uuid), entregar_exportacion(bytea, bytea), purgar_exportaciones_vencidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION exportar_datos_paciente(uuid, text), exportar_tabla_centro(text), tablas_exportacion_centro(),
  crear_exportacion_paciente(uuid, uuid, bytea), agregar_clinica_exportacion(uuid, bytea), enviar_exportacion(uuid, bytea, bytea),
  exportacion_con_cuenta(uuid), entregar_exportacion(bytea, bytea), purgar_exportaciones_vencidas() TO app_user;
