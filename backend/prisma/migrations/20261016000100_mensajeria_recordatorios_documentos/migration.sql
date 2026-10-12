-- =============================================================================
-- 02i (2/2): mensajeria, recordatorios, calendario y documentos. Corre como
-- dueño (vinculos_owner).
--
-- 1 Mensajeria en tres capas, evolucionando notificaciones (sin tablas
--   duplicadas):
--   - Eventos: catalogo fijo (enum tipo_notificacion) con categoria LEGAL,
--     RECORDATORIO u OPERATIVO (categoria_evento).
--   - Plantillas (plantillas_mensaje, B): evento + destinatario + canal; la
--     migracion carga el ejemplo; ADMIN personaliza o restaura. Variables
--     solo de la lista permitida (CHECK).
--   - Canales: una fila de notificaciones por canal. BANDEJA siempre (registro
--     oficial); CORREO segun plantilla activa y preferencias del paciente
--     (preferencias_notificacion, A); WHATSAPP reservado.
--   - Cola de salida: PENDIENTE | ENVIADO | FALLIDO, intentos y
--     proximo_intento con backoff. Solo la BD crea filas (encolar_notificacion,
--     notificar()).
-- 2 Recordatorios: configuracion_centro.recordatorio_horas_antes,
--   recordatorios_cita (A, token de un solo uso para confirmar o cancelar).
-- 3 Calendario: citas.secuencia (SEQUENCE del .ics) y feed con canceladas.
-- 4 Documentos: plantilla por tipo de documento; adjuntos_ficha (A).
-- Ademas: aviso de consentimiento por vencer (job).
--
-- Categorias (criterio_clasificacion.md): plantillas_mensaje B; el resto de
-- tablas nuevas A. Todas ENABLE + FORCE RLS + <tabla>_acceso_vigente.
-- Columnas cifradas nuevas (registro.ts, CLINICO): notificaciones.asunto,
-- notificaciones.cuerpo, recordatorios_cita.enlace, adjuntos_ficha.contenido.
--
-- documentos_clinicos.contenido pasa a ser el texto del documento (el PDF se
-- genera al entregarlo). Las filas de 02h guardaban el archivo en base64;
-- la fase no se desplego, asi que no hay filas que convertir.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. DDL (identico al que genera Prisma para el schema, salvo el cambio de
--    tipo de notificaciones.canal, que conserva las filas: EMAIL -> CORREO).
-- -----------------------------------------------------------------------------

-- DropIndex
DROP INDEX "notificaciones_estado_creada_en_idx";

-- AlterTable
ALTER TABLE "citas" ADD COLUMN     "secuencia" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "configuracion_centro" ADD COLUMN     "recordatorio_horas_antes" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_coherente;
ALTER TABLE "notificaciones" ADD COLUMN     "asunto" BYTEA,
ADD COLUMN     "cuerpo" BYTEA,
ADD COLUMN     "proximo_intento" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "canal" DROP DEFAULT,
ALTER COLUMN "canal" SET DATA TYPE "canal_mensaje" USING 'CORREO'::"canal_mensaje";

-- AlterTable
ALTER TABLE "tipos_documento_clinico" ADD COLUMN     "plantilla" TEXT NOT NULL DEFAULT '{{contenido}}';

-- CreateTable
CREATE TABLE "plantillas_mensaje" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evento" "tipo_notificacion" NOT NULL,
    "destinatario" "destinatario_mensaje" NOT NULL,
    "canal" "canal_mensaje" NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "asunto_ejemplo" TEXT NOT NULL,
    "cuerpo_ejemplo" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plantillas_mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferencias_notificacion" (
    "paciente_id" UUID NOT NULL,
    "recordatorios" BOOLEAN NOT NULL DEFAULT true,
    "avisos_operativos" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preferencias_notificacion_pkey" PRIMARY KEY ("paciente_id")
);

-- CreateTable
CREATE TABLE "recordatorios_cita" (
    "id" UUID NOT NULL,
    "cita_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "token_hash" TEXT NOT NULL,
    "enlace" BYTEA NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respuesta" "respuesta_recordatorio",
    "respondido_en" TIMESTAMPTZ(6),
    "a_tiempo" BOOLEAN,

    CONSTRAINT "recordatorios_cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjuntos_ficha" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "subido_por_id" UUID NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "tipo_mime" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "subido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjuntos_ficha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_mensaje_evento_destinatario_canal_key" ON "plantillas_mensaje"("evento", "destinatario", "canal");

-- CreateIndex
CREATE UNIQUE INDEX "recordatorios_cita_token_hash_key" ON "recordatorios_cita"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "recordatorios_cita_cita_id_inicio_key" ON "recordatorios_cita"("cita_id", "inicio");

-- CreateIndex
CREATE INDEX "adjuntos_ficha_paciente_id_idx" ON "adjuntos_ficha"("paciente_id");

-- CreateIndex
CREATE INDEX "notificaciones_estado_proximo_intento_idx" ON "notificaciones"("estado", "proximo_intento");

-- AddForeignKey
ALTER TABLE "preferencias_notificacion" ADD CONSTRAINT "preferencias_notificacion_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordatorios_cita" ADD CONSTRAINT "recordatorios_cita_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjuntos_ficha" ADD CONSTRAINT "adjuntos_ficha_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjuntos_ficha" ADD CONSTRAINT "adjuntos_ficha_subido_por_id_fkey" FOREIGN KEY ("subido_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- 2. Plantillas: variables permitidas y ejemplos.
-- -----------------------------------------------------------------------------

-- Toda variable {{x}} esta en la lista y no quedan llaves sueltas.
CREATE FUNCTION plantilla_valida(p_texto text, p_permitidas text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM regexp_matches(p_texto, '\{\{([^{}]*)\}\}', 'g') m
                     WHERE NOT (btrim(m[1]) = ANY (p_permitidas)))
     AND regexp_replace(p_texto, '\{\{[^{}]*\}\}', '', 'g') !~ '\{\{|\}\}'
$$;

-- Mensajes: nunca motivo, diagnostico, notas ni contenido clinico.
ALTER TABLE plantillas_mensaje ADD CONSTRAINT plantillas_mensaje_variables_permitidas
  CHECK (plantilla_valida(asunto || ' ' || cuerpo, ARRAY['nombre_paciente', 'nombre_profesional', 'fecha', 'hora',
                                                       'modalidad', 'enlace', 'nombre_centro']));
ALTER TABLE plantillas_mensaje ADD CONSTRAINT plantillas_mensaje_coherente
  CHECK (btrim(asunto) <> '' AND btrim(cuerpo) <> '' AND length(asunto) <= 200 AND length(cuerpo) <= 4000
         AND canal <> 'WHATSAPP' AND (canal <> 'BANDEJA' OR activa));

-- Documentos: el profesional redacta {{contenido}}; el resto lo llena el servidor.
ALTER TABLE tipos_documento_clinico ADD CONSTRAINT tipos_documento_clinico_plantilla_valida
  CHECK (btrim(plantilla) <> '' AND length(plantilla) <= 20000
         AND plantilla_valida(plantilla, ARRAY['nombre_paciente', 'nombre_profesional', 'fecha', 'nombre_centro', 'contenido']));

-- Ejemplos en español: BANDEJA y CORREO por evento y destinatario (el correo
-- firma con el nombre del centro). ADMIN los personaliza; el ejemplo queda fijo.
INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT e.evento::tipo_notificacion, e.destinatario::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('CITA_CONFIRMADA', 'PACIENTE', 'Cita confirmada',
   'Hola {{nombre_paciente}}: su cita con {{nombre_profesional}} quedó confirmada para el {{fecha}} a las {{hora}} ({{modalidad}}). Enlace: {{enlace}}'),
  ('CITA_REPROGRAMADA', 'PACIENTE', 'Cita reprogramada',
   'Hola {{nombre_paciente}}: su cita con {{nombre_profesional}} cambió al {{fecha}} a las {{hora}} ({{modalidad}}). Enlace: {{enlace}}'),
  ('CITA_CANCELADA', 'PACIENTE', 'Cita cancelada',
   'Hola {{nombre_paciente}}: su cita con {{nombre_profesional}} del {{fecha}} a las {{hora}} fue cancelada. Para agendar otra hora: {{enlace}}'),
  ('CITA_CANCELADA', 'EQUIPO', 'Cita cancelada',
   'Hola {{nombre_profesional}}: se canceló una cita de su agenda del {{fecha}} a las {{hora}}. Detalle en el sistema: {{enlace}}'),
  ('RECORDATORIO_CITA', 'PACIENTE', 'Recordatorio de su cita',
   'Hola {{nombre_paciente}}: le recordamos su cita con {{nombre_profesional}} el {{fecha}} a las {{hora}} ({{modalidad}}). Confirme su asistencia o cancele aquí: {{enlace}}'),
  ('DERIVACION_OFRECIDA', 'EQUIPO', 'Nueva oferta de derivación',
   'Hola {{nombre_profesional}}: tiene una nueva oferta de derivación. Revísela en el sistema antes de que venza: {{enlace}}'),
  ('DERIVACION_ACTUALIZADA', 'EQUIPO', 'Cambios en una derivación',
   'Hola {{nombre_profesional}}: una derivación que usted originó cambió de estado. Detalle en el sistema: {{enlace}}'),
  ('CONSENTIMIENTO_SOLICITADO', 'PACIENTE', 'Solicitud de consentimiento',
   'Hola {{nombre_paciente}}: {{nombre_centro}} le solicita un consentimiento. Revíselo y responda en el portal: {{enlace}}'),
  ('CONSENTIMIENTO_POR_VENCER', 'PACIENTE', 'Consentimiento por vencer',
   'Hola {{nombre_paciente}}: la solicitud de consentimiento de {{nombre_centro}} vence pronto. Responda en el portal: {{enlace}}'),
  ('AVISO_CAMBIO_SUPERVISOR', 'PACIENTE', 'Aviso: cambio de supervisor',
   'Hola {{nombre_paciente}}: hubo un cambio en la supervisión de su atención. Revise el aviso en el portal: {{enlace}}'),
  ('DOCUMENTO_CLINICO', 'PACIENTE', 'Documento disponible',
   'Hola {{nombre_paciente}}: {{nombre_profesional}} emitió un documento para usted. Para descargarlo debe iniciar sesión: {{enlace}}' || E'\n' || 'No comparta este enlace.'),
  ('PAGO_REGISTRADO', 'PACIENTE', 'Pago registrado',
   'Hola {{nombre_paciente}}: registramos un pago de su cita del {{fecha}} con {{nombre_profesional}}. Detalle en el portal: {{enlace}}'),
  ('BOLETA_EMITIDA', 'PACIENTE', 'Boleta emitida',
   'Hola {{nombre_paciente}}: se emitió la boleta de su cita del {{fecha}}. Disponible en el portal: {{enlace}}'),
  ('MENSAJE_PACIENTE', 'EQUIPO', 'Nuevo mensaje de un paciente',
   'Hola {{nombre_profesional}}: tiene un nuevo mensaje de un paciente. Léalo en el sistema: {{enlace}}')
) AS e(evento, destinatario, asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);


-- -----------------------------------------------------------------------------
-- 3. Notificaciones: canal, cola con backoff y contenido armado (una vez).
-- -----------------------------------------------------------------------------

ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_coherente
  CHECK ((paciente_id IS NULL) <> (usuario_id IS NULL)
         AND canal <> 'WHATSAPP'
         AND (estado = 'PENDIENTE') = (procesada_en IS NULL)
         AND intentos >= 0
         AND (asunto IS NULL) = (cuerpo IS NULL)
         AND (asunto IS NULL OR (octet_length(asunto) >= 49 AND octet_length(cuerpo) >= 49))
         AND (canal <> 'BANDEJA' OR estado <> 'ENVIADO' OR cuerpo IS NOT NULL));

-- Append-only salvo el avance del envio mientras esta PENDIENTE (intentos,
-- proximo intento, cierre) y el contenido, que se escribe una sola vez.
CREATE OR REPLACE FUNCTION proteger_notificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.estado <> 'PENDIENTE' OR NEW.intentos < OLD.intentos
     OR (OLD.asunto IS NOT NULL AND (NEW.asunto, NEW.cuerpo) IS DISTINCT FROM (OLD.asunto, OLD.cuerpo))
     OR (NEW.id, NEW.tipo, NEW.canal, NEW.paciente_id, NEW.usuario_id, NEW.referencia_id, NEW.creada_por_id, NEW.creada_en)
        IS DISTINCT FROM
        (OLD.id, OLD.tipo, OLD.canal, OLD.paciente_id, OLD.usuario_id, OLD.referencia_id, OLD.creada_por_id, OLD.creada_en) THEN
    RAISE EXCEPTION 'notificaciones es append-only: solo avanza su envio' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- LEGAL: nunca se desactiva. RECORDATORIO y OPERATIVO: segun preferencias.
CREATE FUNCTION categoria_evento(p_tipo tipo_notificacion) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_tipo IN ('CONSENTIMIENTO_SOLICITADO', 'CONSENTIMIENTO_POR_VENCER', 'AVISO_CAMBIO_SUPERVISOR', 'DOCUMENTO_CLINICO')
      THEN 'LEGAL'
    WHEN p_tipo = 'RECORDATORIO_CITA' THEN 'RECORDATORIO'
    ELSE 'OPERATIVO'
  END
$$;

-- Unica forma de crear mensajes. BANDEJA siempre; CORREO si su plantilla
-- esta activa y, para el paciente, si sus preferencias lo permiten (los
-- avisos legales no se pueden desactivar). Interna: la usan triggers, jobs y
-- notificar().
CREATE FUNCTION encolar_notificacion(p_tipo tipo_notificacion, p_paciente_id uuid, p_usuario_id uuid,
                                     p_referencia_id uuid, p_creada_por uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_destinatario destinatario_mensaje := CASE WHEN p_paciente_id IS NOT NULL THEN 'PACIENTE' ELSE 'EQUIPO' END;
  v_categoria text := categoria_evento(p_tipo);
BEGIN
  INSERT INTO notificaciones (tipo, canal, paciente_id, usuario_id, referencia_id, creada_por_id)
  VALUES (p_tipo, 'BANDEJA', p_paciente_id, p_usuario_id, p_referencia_id, p_creada_por);
  IF EXISTS (SELECT 1 FROM plantillas_mensaje WHERE evento = p_tipo AND destinatario = v_destinatario
               AND canal = 'CORREO' AND activa)
     AND (v_destinatario = 'EQUIPO' OR v_categoria = 'LEGAL' OR NOT EXISTS (
            SELECT 1 FROM preferencias_notificacion pr WHERE pr.paciente_id = p_paciente_id
              AND NOT CASE WHEN v_categoria = 'RECORDATORIO' THEN pr.recordatorios ELSE pr.avisos_operativos END)) THEN
    INSERT INTO notificaciones (tipo, canal, paciente_id, usuario_id, referencia_id, creada_por_id)
    VALUES (p_tipo, 'CORREO', p_paciente_id, p_usuario_id, p_referencia_id, p_creada_por);
  END IF;
END;
$$;

-- La API registra un aviso a nombre del actor (despues del COMMIT de la
-- accion). Los eventos que origina la BD o un job no se piden desde la API.
CREATE FUNCTION notificar(p_tipo tipo_notificacion, p_paciente_id uuid, p_usuario_id uuid, p_referencia_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente()
     OR p_tipo IN ('DERIVACION_OFRECIDA', 'DERIVACION_ACTUALIZADA', 'RECORDATORIO_CITA', 'CONSENTIMIENTO_POR_VENCER') THEN
    RAISE EXCEPTION 'Aviso no permitido desde la API' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM encolar_notificacion(p_tipo, p_paciente_id, p_usuario_id, p_referencia_id, app_usuario_id());
END;
$$;

DROP POLICY notificaciones_insert ON notificaciones;
REVOKE INSERT ON notificaciones FROM app_user;

-- Avisos de derivacion (02h) via encolar_notificacion (bandeja + correo).
CREATE OR REPLACE FUNCTION avisar_origen_derivacion(p_derivacion_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_origen uuid;
BEGIN
  SELECT profesional_origen_id INTO v_origen FROM derivaciones WHERE id = p_derivacion_id;
  IF v_origen IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM notificaciones WHERE tipo = 'DERIVACION_ACTUALIZADA' AND usuario_id = v_origen
         AND referencia_id = p_derivacion_id AND estado = 'PENDIENTE') THEN
    PERFORM encolar_notificacion('DERIVACION_ACTUALIZADA', NULL, v_origen, p_derivacion_id, NULL);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION notificar_candidato_derivacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'OFRECIDA' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'OFRECIDA') THEN
    PERFORM encolar_notificacion('DERIVACION_OFRECIDA', NULL, NEW.profesional_id, NEW.derivacion_id, NULL);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    PERFORM avisar_origen_derivacion(NEW.derivacion_id);
  END IF;
  RETURN NULL;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. Job de mensajes (sin contexto: con contexto de usuario -> 42501).
--   Devuelve lo necesario para armar cada mensaje con su plantilla:
--   plantilla vigente (si ya se armo, asunto/cuerpo cifrados), email (solo
--   CORREO), enlace cifrado con su origen (AAD), adjunto del documento y
--   datos: centro, nombres (el del paciente solo si el es el destinatario),
--   horario de la cita (sin paciente ni motivo) o metadatos del documento.
-- -----------------------------------------------------------------------------

DROP FUNCTION notificaciones_por_enviar(int);
CREATE FUNCTION notificaciones_por_enviar(p_limite int)
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
             WHEN t.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'CITA_CANCELADA', 'ENLACE_ONLINE') THEN t.referencia_id
             WHEN t.tipo = 'RECORDATORIO_CITA' THEN (SELECT r.cita_id FROM recordatorios_cita r WHERE r.id = t.referencia_id)
             WHEN t.tipo = 'PAGO_REGISTRADO' THEN (SELECT pg.cita_id FROM pagos pg WHERE pg.id = t.referencia_id)
             WHEN t.tipo = 'BOLETA_EMITIDA' THEN (SELECT b.cita_id FROM boletas b WHERE b.id = t.referencia_id)
           END AS cita_id
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
                                  WHERE u.id = coalesce(c.profesional_id, d.emitido_por_id, co.practicante_id))
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

-- Guarda el mensaje armado (cifrado por la API con AAD notificaciones:<columna>:<id>), una vez.
CREATE FUNCTION guardar_contenido_notificacion(p_id uuid, p_asunto bytea, p_cuerpo bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de mensajes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE notificaciones SET asunto = p_asunto, cuerpo = p_cuerpo
  WHERE id = p_id AND estado = 'PENDIENTE' AND asunto IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificacion inexistente, cerrada o ya armada' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END;
$$;

-- Cierre o reintento. Fallo reintentable: vuelve a PENDIENTE con backoff
-- exponencial (1, 2, 4, 8 minutos); al quinto intento (o si no se puede
-- reintentar, p. ej. sin email) queda FALLIDO.
DROP FUNCTION marcar_notificacion(uuid, boolean, text);
CREATE FUNCTION marcar_notificacion(p_id uuid, p_enviada boolean, p_detalle text, p_reintentar boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de mensajes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE notificaciones
  SET intentos = intentos + 1,
      estado = CASE WHEN p_enviada THEN 'ENVIADO'::estado_notificacion
                    WHEN p_reintentar AND intentos + 1 < 5 THEN 'PENDIENTE'
                    ELSE 'FALLIDO' END,
      proximo_intento = CASE WHEN NOT p_enviada AND p_reintentar AND intentos + 1 < 5
                             THEN now() + make_interval(mins => power(2, intentos)::int) ELSE proximo_intento END,
      procesada_en = CASE WHEN p_enviada OR NOT p_reintentar OR intentos + 1 >= 5 THEN now() END,
      detalle_error = CASE WHEN p_enviada THEN NULL ELSE left(p_detalle, 300) END
  WHERE id = p_id AND estado = 'PENDIENTE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificacion inexistente o ya procesada' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END;
$$;

-- Aviso de consentimiento por vencer: una vez por solicitud, pasada la mitad
-- de su plazo y antes de que venza (job).
CREATE FUNCTION avisar_consentimientos_por_vencer() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v record;
  n int := 0;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de avisos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR v IN SELECT co.id, co.paciente_id FROM consentimientos co
           WHERE co.estado = 'SOLICITADO' AND co.vence_en > now()
             AND now() >= co.solicitado_en + (co.vence_en - co.solicitado_en) / 2
             AND NOT EXISTS (SELECT 1 FROM notificaciones nt WHERE nt.tipo = 'CONSENTIMIENTO_POR_VENCER'
                             AND nt.referencia_id = co.id)
           FOR UPDATE OF co SKIP LOCKED LOOP
    PERFORM encolar_notificacion('CONSENTIMIENTO_POR_VENCER', v.paciente_id, NULL, v.id, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. Preferencias del paciente (A).
-- -----------------------------------------------------------------------------

CREATE TRIGGER preferencias_notificacion_sin_delete BEFORE DELETE ON preferencias_notificacion
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();


-- -----------------------------------------------------------------------------
-- 6. Recordatorios de citas.
-- -----------------------------------------------------------------------------

ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_recordatorio_valido
  CHECK (recordatorio_horas_antes BETWEEN 0 AND 168);
GRANT UPDATE (recordatorio_horas_antes) ON configuracion_centro TO app_user;

ALTER TABLE recordatorios_cita ADD CONSTRAINT recordatorios_cita_coherente
  CHECK (token_hash ~ '^[0-9a-f]{64}$' AND octet_length(enlace) >= 49
         AND (respuesta IS NULL) = (respondido_en IS NULL)
         AND (respuesta IS NOT DISTINCT FROM 'CANCELADA') = (a_tiempo IS NOT NULL));

-- Solo se responde una vez; nada mas cambia (incluso dueño). Nunca DELETE.
CREATE FUNCTION proteger_recordatorio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.respuesta IS NOT NULL
     OR (NEW.id, NEW.cita_id, NEW.inicio, NEW.token_hash, NEW.enlace, NEW.expira_en, NEW.creado_en)
        IS DISTINCT FROM (OLD.id, OLD.cita_id, OLD.inicio, OLD.token_hash, OLD.enlace, OLD.expira_en, OLD.creado_en) THEN
    RAISE EXCEPTION 'recordatorios_cita solo registra una respuesta' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER recordatorios_cita_protegidos BEFORE UPDATE OR DELETE ON recordatorios_cita
  FOR EACH ROW EXECUTE FUNCTION proteger_recordatorio();

-- Citas confirmadas que entran en la ventana del recordatorio y aun no lo
-- tienen para su horario actual (job).
CREATE FUNCTION citas_por_recordar(p_limite int) RETURNS TABLE (cita_id uuid, inicio timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de recordatorios' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT c.id, c.inicio FROM citas c CROSS JOIN configuracion_centro cc
  WHERE cc.recordatorio_horas_antes > 0 AND c.estado = 'CONFIRMADA'
    AND c.inicio > now() AND c.inicio <= now() + make_interval(hours => cc.recordatorio_horas_antes)
    AND NOT EXISTS (SELECT 1 FROM recordatorios_cita r WHERE r.cita_id = c.id AND r.inicio = c.inicio)
  ORDER BY c.inicio
  LIMIT greatest(coalesce(p_limite, 100), 1);
END;
$$;

-- Registra el recordatorio (token y URL cifrada que arma la API) y su
-- mensaje. Idempotente: uno por cita y horario. false si ya existia o la
-- cita ya no esta confirmada en ese horario.
CREATE FUNCTION registrar_recordatorio(p_id uuid, p_cita_id uuid, p_inicio timestamptz, p_token_hash text, p_enlace bytea)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cita citas%ROWTYPE;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de recordatorios' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_cita FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND OR v_cita.estado <> 'CONFIRMADA' OR v_cita.inicio <> p_inicio THEN
    RETURN false;
  END IF;
  INSERT INTO recordatorios_cita (id, cita_id, inicio, token_hash, enlace, expira_en)
  VALUES (p_id, p_cita_id, p_inicio, p_token_hash, p_enlace, p_inicio)
  ON CONFLICT (cita_id, inicio) DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM encolar_notificacion('RECORDATORIO_CITA', v_cita.paciente_id, NULL, p_id, NULL);
  RETURN true;
END;
$$;

-- Lo que vera el paciente antes de responder (sin sesion: el token autoriza).
-- a_tiempo: si cancelara ahora, segun la politica vigente.
CREATE FUNCTION consultar_recordatorio(p_token_hash text)
RETURNS TABLE (inicio timestamptz, fin timestamptz, modalidad modalidad_atencion, profesional text,
               respuesta respuesta_recordatorio, vigente boolean, a_tiempo boolean,
               plazo_aviso_horas int, penalizacion_porcentaje numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT c.inicio, c.fin, c.modalidad,
         (SELECT coalesce(pf.nombre_publico, u.nombre) FROM usuarios u LEFT JOIN profesionales pf ON pf.usuario_id = u.id
          WHERE u.id = c.profesional_id),
         r.respuesta,
         r.respuesta IS NULL AND r.expira_en > now() AND c.estado = 'CONFIRMADA' AND c.inicio = r.inicio,
         c.inicio - now() >= make_interval(hours => cc.plazo_aviso_cancelacion_horas),
         cc.plazo_aviso_cancelacion_horas,
         cc.penalizacion_cancelacion_porcentaje
  FROM recordatorios_cita r JOIN citas c ON c.id = r.cita_id CROSS JOIN configuracion_centro cc
  WHERE r.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recordatorio inexistente' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

-- Respuesta del paciente con el token (un solo uso, hasta el inicio de la
-- cita). CANCELADA aplica la politica vigente: queda a_tiempo segun el plazo
-- de aviso (la cancelacion registra cancelada_en; resolver_cita decide
-- despues traslado o devolucion con el mismo criterio) y avisa al paciente y
-- al profesional.
CREATE FUNCTION responder_recordatorio(p_token_hash text, p_respuesta respuesta_recordatorio)
RETURNS TABLE (respuesta respuesta_recordatorio, a_tiempo boolean, penalizacion_porcentaje numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  RETURN QUERY SELECT p_respuesta, v_a_tiempo,
                      CASE WHEN v_a_tiempo IS FALSE THEN v_conf.penalizacion_cancelacion_porcentaje ELSE 0 END::numeric;
END;
$$;


-- -----------------------------------------------------------------------------
-- 7. Calendario: SEQUENCE por cita y feed con canceladas.
-- -----------------------------------------------------------------------------

-- Sube en cada cambio que el calendario debe reflejar (horario, modalidad,
-- box o estado). UID fijo = id de la cita. Incluso dueño.
CREATE FUNCTION avanzar_secuencia_cita() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.secuencia := 0;
  ELSIF (NEW.inicio, NEW.fin, NEW.estado, NEW.modalidad, NEW.espacio_id)
        IS DISTINCT FROM (OLD.inicio, OLD.fin, OLD.estado, OLD.modalidad, OLD.espacio_id) THEN
    NEW.secuencia := OLD.secuencia + 1;
  ELSE
    NEW.secuencia := OLD.secuencia;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER citas_secuencia_calendario BEFORE INSERT OR UPDATE ON citas
  FOR EACH ROW EXECUTE FUNCTION avanzar_secuencia_cita();

-- Feed (02h) + canceladas de la ventana (STATUS:CANCELLED) y la secuencia.
DROP FUNCTION feed_calendario(text);
CREATE FUNCTION feed_calendario(p_token_hash text)
RETURNS TABLE (id uuid, inicio timestamptz, fin timestamptz, modalidad modalidad_atencion, estado estado_cita,
               espacio text, enlace bytea, secuencia int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_usuario uuid;
BEGIN
  SELECT f.usuario_id INTO v_usuario FROM feeds_calendario f
  JOIN usuarios u ON u.id = f.usuario_id AND u.activo AND u.cerrada_en IS NULL
  WHERE f.token_hash = p_token_hash;
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'Calendario inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN QUERY
  SELECT c.id, c.inicio, c.fin, c.modalidad, c.estado, e.nombre, c.enlace_online, c.secuencia
  FROM citas c LEFT JOIN espacios e ON e.id = c.espacio_id
  WHERE c.profesional_id = v_usuario
    AND c.estado IN ('CONFIRMADA', 'POR_REPROGRAMAR', 'CANCELADA')
    AND c.inicio >= now() - interval '30 days' AND c.inicio < now() + interval '365 days'
  ORDER BY c.inicio;
END;
$$;


-- -----------------------------------------------------------------------------
-- 8. Adjuntos externos de la ficha (misma RLS que la ficha).
-- -----------------------------------------------------------------------------

ALTER TABLE adjuntos_ficha ADD CONSTRAINT adjuntos_ficha_archivo
  CHECK (btrim(nombre_archivo) <> '' AND length(nombre_archivo) <= 200
         AND tipo_mime IN ('application/pdf', 'image/png', 'image/jpeg')
         AND tamano_bytes > 0 AND octet_length(contenido) >= 49);
CREATE TRIGGER adjuntos_ficha_append_only BEFORE UPDATE OR DELETE ON adjuntos_ficha
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();


-- -----------------------------------------------------------------------------
-- 9. RLS, politicas y GRANTs.
-- -----------------------------------------------------------------------------

ALTER TABLE plantillas_mensaje ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantillas_mensaje FORCE ROW LEVEL SECURITY;
ALTER TABLE preferencias_notificacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferencias_notificacion FORCE ROW LEVEL SECURITY;
ALTER TABLE recordatorios_cita ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordatorios_cita FORCE ROW LEVEL SECURITY;
ALTER TABLE adjuntos_ficha ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjuntos_ficha FORCE ROW LEVEL SECURITY;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['plantillas_mensaje', 'preferencias_notificacion', 'recordatorios_cita', 'adjuntos_ficha'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO app_user
                    USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()))', t || '_acceso_vigente', t);
  END LOOP;
END $$;

-- plantillas_mensaje (B): solo ADMIN lee y personaliza; sin INSERT ni DELETE.
CREATE POLICY plantillas_mensaje_admin ON plantillas_mensaje FOR ALL TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
GRANT SELECT ON plantillas_mensaje TO app_user;
GRANT UPDATE (asunto, cuerpo, activa, updated_at) ON plantillas_mensaje TO app_user;

-- preferencias_notificacion (A): el paciente las suyas; ADMIN/GESTION leen.
CREATE POLICY preferencias_notificacion_select ON preferencias_notificacion FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR paciente_id = (SELECT app_paciente_id()));
CREATE POLICY preferencias_notificacion_insert ON preferencias_notificacion FOR INSERT TO app_user
  WITH CHECK (paciente_id = (SELECT app_paciente_id()));
CREATE POLICY preferencias_notificacion_update ON preferencias_notificacion FOR UPDATE TO app_user
  USING (paciente_id = (SELECT app_paciente_id())) WITH CHECK (paciente_id = (SELECT app_paciente_id()));
GRANT SELECT, INSERT ON preferencias_notificacion TO app_user;
GRANT UPDATE (recordatorios, avisos_operativos, updated_at) ON preferencias_notificacion TO app_user;

-- recordatorios_cita (A): leen ADMIN/GESTION y PROFESIONAL/PACIENTE de citas
-- que ven; las escrituras son de funciones (job y token).
CREATE POLICY recordatorios_cita_select ON recordatorios_cita FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PACIENTE') AND cita_id IN (SELECT id FROM citas)));
GRANT SELECT ON recordatorios_cita TO app_user;

-- adjuntos_ficha (A): como la ficha clinica: el tratante (PRACTICANTE con
-- consentimiento vigente) sube y lee. ADMIN/GESTION y el paciente no.
CREATE POLICY adjuntos_ficha_select ON adjuntos_ficha FOR SELECT TO app_user
  USING (es_profesional_de_paciente(paciente_id));
CREATE POLICY adjuntos_ficha_insert ON adjuntos_ficha FOR INSERT TO app_user
  WITH CHECK (subido_por_id = (SELECT app_usuario_id()) AND es_profesional_de_paciente(paciente_id));
CREATE POLICY adjuntos_ficha_consentimiento_practicante ON adjuntos_ficha AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id))
  WITH CHECK ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id));
GRANT SELECT, INSERT ON adjuntos_ficha TO app_user;

-- tipos_documento_clinico: ADMIN edita tambien la plantilla. El paciente lee
-- solo los tipos de sus documentos (titulo del PDF que descarga).
GRANT UPDATE (plantilla) ON tipos_documento_clinico TO app_user;
-- (Funcion SECURITY DEFINER: una subconsulta a documentos_clinicos en la
-- politica seria recursiva, porque la de documentos_clinicos lee los tipos.)
CREATE FUNCTION tipo_documento_del_paciente(p_tipo_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM documentos_clinicos WHERE tipo_documento_id = p_tipo_id AND paciente_id = app_paciente_id())
$$;
CREATE POLICY tipos_documento_clinico_select_paciente ON tipos_documento_clinico FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'PACIENTE' AND tipo_documento_del_paciente(id));

-- plantilla_valida y categoria_evento quedan publicas: puras, las usan CHECK y funciones.
REVOKE EXECUTE ON FUNCTION
  encolar_notificacion(tipo_notificacion, uuid, uuid, uuid, uuid),
  notificar(tipo_notificacion, uuid, uuid, uuid),
  notificaciones_por_enviar(int), guardar_contenido_notificacion(uuid, bytea, bytea),
  marcar_notificacion(uuid, boolean, text, boolean), avisar_consentimientos_por_vencer(),
  proteger_recordatorio(), citas_por_recordar(int),
  registrar_recordatorio(uuid, uuid, timestamptz, text, bytea),
  consultar_recordatorio(text), responder_recordatorio(text, respuesta_recordatorio),
  avanzar_secuencia_cita(), feed_calendario(text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  notificar(tipo_notificacion, uuid, uuid, uuid),
  notificaciones_por_enviar(int), guardar_contenido_notificacion(uuid, bytea, bytea),
  marcar_notificacion(uuid, boolean, text, boolean), avisar_consentimientos_por_vencer(),
  citas_por_recordar(int), registrar_recordatorio(uuid, uuid, timestamptz, text, bytea),
  consultar_recordatorio(text), responder_recordatorio(text, respuesta_recordatorio),
  feed_calendario(text)
TO app_user;
