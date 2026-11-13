-- =============================================================================
-- AUD-01 (E1.4, contradiccion C3; decision D9): comprobante de pago y boleta
-- del SII son documentos distintos y se manejan los dos.
--
-- 1. `boletas` pasa a `comprobantes_pago`: el documento interno que emite el
--    sistema al quedar pagada una cita. NO es tributario (numero propio
--    "CP-", no un folio del SII). Las filas existentes conservan su numero.
--    El cifrado de emisor_nombre/emisor_rut conserva el AAD con el nombre con
--    que se cifro ("boletas"): ver `aadTabla` en registro.ts; no se recifra.
--    El evento BOLETA_EMITIDA pasa a COMPROBANTE_EMITIDO.
-- 2. `documentos_tributarios` (A): registro de la boleta (o factura) emitida
--    FUERA del sistema por quien cobro: folio, tipo, fecha y monto. El centro
--    (ADMIN/GESTION) si cobro el centro; el profesional de la cita si cobro
--    el directamente. Append-only: un error se anula con motivo. Sin columnas
--    cifradas (folio, tipo y monto no identifican a una persona); el emisor
--    profesional va por id.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Comprobante de pago
-- -----------------------------------------------------------------------------
ALTER TABLE boletas RENAME TO comprobantes_pago;
ALTER SEQUENCE boletas_numero_seq RENAME TO comprobantes_pago_numero_seq;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'comprobantes_pago'::regclass AND conname LIKE 'boletas\_%' LOOP
    EXECUTE format('ALTER TABLE comprobantes_pago RENAME CONSTRAINT %I TO %I', r.conname, 'comprobantes_pago_' || substr(r.conname, 9));
  END LOOP;
  FOR r IN SELECT indexname FROM pg_indexes WHERE tablename = 'comprobantes_pago' AND indexname LIKE 'boletas\_%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, 'comprobantes_pago_' || substr(r.indexname, 9));
  END LOOP;
END $$;
ALTER POLICY boletas_select ON comprobantes_pago RENAME TO comprobantes_pago_select;
ALTER POLICY boletas_acceso_vigente ON comprobantes_pago RENAME TO comprobantes_pago_acceso_vigente;
ALTER TRIGGER boletas_append_only ON comprobantes_pago RENAME TO comprobantes_pago_append_only;
COMMENT ON TABLE comprobantes_pago IS
  'Categoria A. Comprobante de pago interno (no tributario), uno por cita pagada. La boleta del SII va en documentos_tributarios.';

ALTER FUNCTION proteger_boleta() RENAME TO proteger_comprobante_pago;
CREATE OR REPLACE FUNCTION proteger_comprobante_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.pdf_url IS NOT NULL
     OR (NEW.id, NEW.cita_id, NEW.numero, NEW.monto, NEW.emisor_nombre, NEW.emisor_rut, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.cita_id, OLD.numero, OLD.monto, OLD.emisor_nombre, OLD.emisor_rut, OLD.created_at) THEN
    RAISE EXCEPTION 'comprobantes_pago es append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION emitir_boleta(uuid, uuid, bytea, bytea);
CREATE FUNCTION emitir_comprobante_pago(p_id uuid, p_cita_id uuid, p_emisor_nombre bytea, p_emisor_rut bytea) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado text;
  v_exigible int;
  v_profesional uuid;
  v_numero text;
BEGIN
  SELECT profesional_id INTO v_profesional FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT acceso_vigente() OR NOT (app_rol() IN ('ADMIN', 'GESTION')
          OR (app_rol() = 'PROFESIONAL' AND v_profesional = app_usuario_id())) THEN
    RAISE EXCEPTION 'Emiten ADMIN/GESTION, o el profesional de la cita con cobro directo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT estado_pago, exigible INTO v_estado, v_exigible FROM estado_pago_citas WHERE cita_id = p_cita_id;
  IF v_estado IS DISTINCT FROM 'PAGADO'
     OR EXISTS (SELECT 1 FROM comprobantes_pago WHERE cita_id = p_cita_id)
     OR EXISTS (SELECT 1 FROM pagos p JOIN pagos o ON o.id = p.traslado_de_id JOIN comprobantes_pago b ON b.cita_id = o.cita_id
                WHERE p.cita_id = p_cita_id) THEN
    RETURN NULL;
  END IF;
  v_numero := 'CP-' || lpad(nextval('comprobantes_pago_numero_seq')::text, 8, '0');
  INSERT INTO comprobantes_pago (id, cita_id, numero, monto, emisor_nombre, emisor_rut)
  VALUES (p_id, p_cita_id, v_numero, v_exigible, p_emisor_nombre, p_emisor_rut);
  RETURN v_numero;
END;
$$;
REVOKE EXECUTE ON FUNCTION emitir_comprobante_pago(uuid, uuid, bytea, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION emitir_comprobante_pago(uuid, uuid, bytea, bytea) TO app_user;

-- anular_pago (02h): misma regla, con el nombre nuevo de la tabla.
CREATE OR REPLACE FUNCTION anular_pago(p_pago_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pago pagos%ROWTYPE;
  v_cita citas%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION anulan pagos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'Anular exige motivo' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_anulacion_coherente';
  END IF;
  SELECT * INTO v_pago FROM pagos WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_cita FROM citas WHERE id = v_pago.cita_id;
  IF v_pago.estado <> 'REGISTRADO'
     OR EXISTS (SELECT 1 FROM comprobantes_pago WHERE cita_id = v_pago.cita_id)
     OR EXISTS (SELECT 1 FROM liquidaciones l WHERE l.profesional_id = v_cita.profesional_id AND l.estado <> 'BORRADOR'
                AND (v_cita.inicio AT TIME ZONE 'America/Santiago')::date >= l.periodo_desde
                AND (v_cita.inicio AT TIME ZONE 'America/Santiago')::date < l.periodo_hasta) THEN
    RAISE EXCEPTION 'El pago ya esta anulado, tiene comprobante de pago o esta liquidado'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE pagos SET estado = 'ANULADO', anulado_en = now(), anulado_por_id = app_usuario_id(), motivo_anulacion = btrim(p_motivo)
  WHERE id = p_pago_id;
END;
$function$;


ALTER TYPE tipo_notificacion RENAME VALUE 'BOLETA_EMITIDA' TO 'COMPROBANTE_EMITIDO';

-- notificaciones_por_enviar (03b-3.4): el evento y la tabla con su nombre nuevo.
CREATE OR REPLACE FUNCTION notificaciones_por_enviar(p_limite integer)
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
                             'CIERRE_REQUERIDO', 'HORA_LIBERADA', 'INSTRUCCIONES_TRANSFERENCIA', 'COMPROBANTE_RECIBIDO',
                             'PAGO_VALIDADO', 'PAGO_RECHAZADO', 'PAGO_PENDIENTE', 'DEUDA_PENDIENTE') THEN t.referencia_id
             WHEN t.tipo = 'RECORDATORIO_CITA' THEN (SELECT r.cita_id FROM recordatorios_cita r WHERE r.id = t.referencia_id)
             WHEN t.tipo = 'PAGO_REGISTRADO' THEN (SELECT pg.cita_id FROM pagos pg WHERE pg.id = t.referencia_id)
             WHEN t.tipo = 'COMPROBANTE_EMITIDO' THEN (SELECT b.cita_id FROM comprobantes_pago b WHERE b.id = t.referencia_id)
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
$function$;


-- Plantillas: el ejemplo nuevo; las no personalizadas lo siguen.
UPDATE plantillas_mensaje SET
  asunto = CASE WHEN asunto = asunto_ejemplo THEN 'Comprobante de pago' ELSE asunto END,
  cuerpo = CASE WHEN cuerpo = cuerpo_ejemplo
                THEN 'Hola {{nombre_paciente}}: registramos el pago de su cita del {{fecha}}. Su comprobante de pago está disponible en el portal: {{enlace}}. Este comprobante no es una boleta del SII.'
                     || CASE WHEN canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
                ELSE cuerpo END,
  asunto_ejemplo = 'Comprobante de pago',
  cuerpo_ejemplo = 'Hola {{nombre_paciente}}: registramos el pago de su cita del {{fecha}}. Su comprobante de pago está disponible en el portal: {{enlace}}. Este comprobante no es una boleta del SII.'
                   || CASE WHEN canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
WHERE evento = 'COMPROBANTE_EMITIDO';

-- -----------------------------------------------------------------------------
-- 2. Documentos tributarios emitidos fuera del sistema (A)
-- -----------------------------------------------------------------------------
CREATE TYPE "tipo_documento_tributario" AS ENUM ('BOLETA_ELECTRONICA', 'BOLETA_HONORARIOS', 'FACTURA_ELECTRONICA', 'OTRO');
CREATE TYPE "estado_documento_tributario" AS ENUM ('REGISTRADO', 'ANULADO');

-- CreateTable
CREATE TABLE "documentos_tributarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cita_id" UUID NOT NULL,
    "tipo" "tipo_documento_tributario" NOT NULL,
    "folio" TEXT NOT NULL,
    "emisor" "cobrado_por" NOT NULL,
    "emisor_profesional_id" UUID,
    "fecha_emision" DATE NOT NULL,
    "monto" INTEGER NOT NULL,
    "estado" "estado_documento_tributario" NOT NULL DEFAULT 'REGISTRADO',
    "registrado_por_id" UUID NOT NULL,
    "registrado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anulado_en" TIMESTAMPTZ(6),
    "anulado_por_id" UUID,
    "motivo_anulacion" TEXT,

    CONSTRAINT "documentos_tributarios_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "documentos_tributarios_cita_id_idx" ON "documentos_tributarios"("cita_id");
ALTER TABLE "documentos_tributarios" ADD CONSTRAINT "documentos_tributarios_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documentos_tributarios" ADD CONSTRAINT "documentos_tributarios_emisor_profesional_id_fkey" FOREIGN KEY ("emisor_profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documentos_tributarios" ADD CONSTRAINT "documentos_tributarios_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documentos_tributarios" ADD CONSTRAINT "documentos_tributarios_anulado_por_id_fkey" FOREIGN KEY ("anulado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE documentos_tributarios ADD CONSTRAINT documentos_tributarios_valores
  CHECK (folio ~ '^[0-9]{1,12}$' AND monto > 0
         AND (emisor = 'PROFESIONAL') = (emisor_profesional_id IS NOT NULL)
         -- TRI-04: la boleta de honorarios la emite una persona natural (el profesional).
         AND (tipo <> 'BOLETA_HONORARIOS' OR emisor = 'PROFESIONAL'));
ALTER TABLE documentos_tributarios ADD CONSTRAINT documentos_tributarios_anulacion_coherente
  CHECK ((estado = 'ANULADO') = (anulado_en IS NOT NULL AND anulado_por_id IS NOT NULL AND btrim(coalesce(motivo_anulacion, '')) <> ''));
-- Un folio vigente por emisor y tipo.
CREATE UNIQUE INDEX documentos_tributarios_folio_unico ON documentos_tributarios
  (emisor, coalesce(emisor_profesional_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo, folio) WHERE estado = 'REGISTRADO';
COMMENT ON TABLE documentos_tributarios IS
  'Categoria A. Documento tributario (boleta o factura) emitido fuera del sistema; lo registra quien cobro. Append-only; se anula con motivo.';

-- Append-only: solo REGISTRADO -> ANULADO (incluso como dueño).
CREATE FUNCTION proteger_documento_tributario() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.estado = 'ANULADO'
     OR (NEW.id, NEW.cita_id, NEW.tipo, NEW.folio, NEW.emisor, NEW.emisor_profesional_id, NEW.fecha_emision, NEW.monto,
         NEW.registrado_por_id, NEW.registrado_en)
        IS DISTINCT FROM (OLD.id, OLD.cita_id, OLD.tipo, OLD.folio, OLD.emisor, OLD.emisor_profesional_id, OLD.fecha_emision, OLD.monto,
                          OLD.registrado_por_id, OLD.registrado_en) THEN
    RAISE EXCEPTION 'documentos_tributarios es append-only (solo se anula)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documentos_tributarios_append_only BEFORE UPDATE OR DELETE ON documentos_tributarios
  FOR EACH ROW EXECUTE FUNCTION proteger_documento_tributario();

ALTER TABLE documentos_tributarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_tributarios FORCE ROW LEVEL SECURITY;
-- Como el comprobante: ADMIN/GESTION todo; el profesional los de sus citas; el paciente (o su responsable) los suyos.
CREATE POLICY documentos_tributarios_select ON documentos_tributarios FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND cita_id IN (SELECT id FROM citas))
         OR cita_id IN (SELECT c.id FROM citas c WHERE c.paciente_id IN (SELECT app_pacientes_plenos())));
CREATE POLICY documentos_tributarios_acceso_vigente ON documentos_tributarios AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
-- Escritura con reglas de estado: sin GRANT de escritura, solo las funciones de abajo.
GRANT SELECT ON documentos_tributarios TO app_user;

-- Quien cobro la cita: el profesional si algun pago vigente lo cobro el; si no, el centro.
CREATE FUNCTION emisor_tributario_cita(p_cita_id uuid) RETURNS cobrado_por
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM pagos WHERE cita_id = p_cita_id AND estado = 'REGISTRADO' AND cobrado_por = 'PROFESIONAL')
              THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO'::cobrado_por END
$$;

CREATE FUNCTION puede_registrar_tributario(p_cita_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT acceso_vigente() AND CASE emisor_tributario_cita(p_cita_id)
    WHEN 'PROFESIONAL' THEN app_rol() = 'PROFESIONAL'
                            AND app_usuario_id() = (SELECT profesional_id FROM citas WHERE id = p_cita_id)
    ELSE app_rol() IN ('ADMIN', 'GESTION')
  END
$$;

-- Registra la boleta emitida fuera: monto hasta lo pagado (neto) menos lo ya documentado; fecha no futura.
CREATE FUNCTION registrar_documento_tributario(p_cita_id uuid, p_tipo tipo_documento_tributario, p_folio text,
                                               p_fecha date, p_monto integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  v_emisor cobrado_por;
  v_pagado int;
  v_documentado int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT puede_registrar_tributario(c.id) THEN
    RAISE EXCEPTION 'Registra el documento tributario quien cobro: el centro (ADMIN/GESTION) o el profesional con cobro directo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_fecha IS NULL OR p_fecha > (now() AT TIME ZONE 'America/Santiago')::date THEN
    RAISE EXCEPTION 'La fecha de emision no puede ser futura'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'documentos_tributarios_fecha';
  END IF;
  SELECT x.pagado - x.devolucion INTO v_pagado FROM estado_pago_citas x WHERE x.cita_id = c.id;
  SELECT coalesce(sum(monto), 0) INTO v_documentado FROM documentos_tributarios WHERE cita_id = c.id AND estado = 'REGISTRADO';
  IF p_monto IS NULL OR p_monto > coalesce(v_pagado, 0) - v_documentado THEN
    RAISE EXCEPTION 'El monto supera lo pagado de la cita que aun no tiene documento tributario'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'documentos_tributarios_monto';
  END IF;
  v_emisor := emisor_tributario_cita(c.id);
  INSERT INTO documentos_tributarios (cita_id, tipo, folio, emisor, emisor_profesional_id, fecha_emision, monto, registrado_por_id)
  VALUES (c.id, p_tipo, btrim(p_folio), v_emisor, CASE WHEN v_emisor = 'PROFESIONAL' THEN c.profesional_id END,
          p_fecha, p_monto, app_usuario_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION anular_documento_tributario(p_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d documentos_tributarios%ROWTYPE;
BEGIN
  SELECT * INTO d FROM documentos_tributarios WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT acceso_vigente() OR NOT (CASE d.emisor
       WHEN 'PROFESIONAL' THEN app_rol() = 'PROFESIONAL' AND app_usuario_id() = d.emisor_profesional_id
       ELSE app_rol() IN ('ADMIN', 'GESTION') END) THEN
    RAISE EXCEPTION 'Anula el documento quien lo emitio' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'Anular exige motivo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'documentos_tributarios_anulacion_coherente';
  END IF;
  IF d.estado = 'ANULADO' THEN
    RAISE EXCEPTION 'El documento ya esta anulado' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE documentos_tributarios SET estado = 'ANULADO', anulado_en = now(), anulado_por_id = app_usuario_id(),
         motivo_anulacion = btrim(p_motivo)
  WHERE id = d.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION emisor_tributario_cita(uuid), puede_registrar_tributario(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION registrar_documento_tributario(uuid, tipo_documento_tributario, text, date, integer),
                           anular_documento_tributario(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_documento_tributario(uuid, tipo_documento_tributario, text, date, integer),
                          anular_documento_tributario(uuid, text) TO app_user;
