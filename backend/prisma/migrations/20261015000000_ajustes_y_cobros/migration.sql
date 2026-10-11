-- =============================================================================
-- 02h: ajustes a 02b-02g y modulo de Cobros. Corre como dueño (vinculos_owner).
--
-- A1 tipos de atencion por profesional: propone el profesional, decide ADMIN;
--    solo los APROBADOS cuentan (perfiles_publicos, directorio_interno).
-- A2 documentos clinicos por correo: catalogo tipos_documento_clinico (B),
--    documentos_clinicos (A, contenido cifrado), envios_documento (A, enlace
--    que expira o adjunto pedido por el paciente), descargas_documento (A).
-- A3 avisos de derivacion desde la BD (triggers): oferta al candidato, aunque
--    la pase un job o un rechazo; cambio de estado al origen.
-- A6 salas_videollamada (A), feeds_calendario (A) + feed_calendario(token).
-- B  citas.monto fijado al confirmar e inmutable; pagos solo via funciones
--    (sobrepago = 23514, anulacion con motivo); vista estado_pago_citas;
--    boleta unica por cita; resoluciones_cita (politica de cancelacion e
--    inasistencia); arriendos por periodo; liquidaciones.
--
-- Categorias (criterio_clasificacion.md): tipos_documento_clinico B; el resto
-- de tablas nuevas A. Todas ENABLE + FORCE RLS + <tabla>_acceso_vigente.
-- Columnas cifradas nuevas (registro.ts): documentos_clinicos.contenido,
-- envios_documento.enlace (CLINICO), salas_videollamada.enlace (IDENTIFICACION).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Politicas que dependen de columnas que cambian (se recrean en 13).
-- -----------------------------------------------------------------------------

DROP POLICY boletas_select ON boletas;
DROP POLICY boletas_insert ON boletas;
DROP POLICY boletas_update ON boletas;


-- -----------------------------------------------------------------------------
-- 1. DDL (identico al que genera Prisma para el schema).
-- -----------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "estado_pago" AS ENUM ('REGISTRADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "origen_pago" AS ENUM ('MANUAL', 'TRASLADO');

-- CreateEnum
CREATE TYPE "cobrado_por" AS ENUM ('CENTRO', 'PROFESIONAL');

-- CreateEnum
CREATE TYPE "decision_cita" AS ENUM ('TRASLADO', 'DEVOLUCION', 'INASISTENCIA');

-- CreateEnum
CREATE TYPE "estado_liquidacion" AS ENUM ('BORRADOR', 'EMITIDA', 'PAGADA');

-- CreateEnum
CREATE TYPE "modo_envio_documento" AS ENUM ('ENLACE', 'ADJUNTO');

-- CreateEnum
CREATE TYPE "modo_videollamada" AS ENUM ('ENLACE_PROPIO', 'JITSI');

-- AlterEnum (los valores nuevos solo se usan dentro de funciones plpgsql)

ALTER TYPE "tipo_notificacion" ADD VALUE 'DOCUMENTO_CLINICO';
ALTER TYPE "tipo_notificacion" ADD VALUE 'DERIVACION_ACTUALIZADA';

-- DropForeignKey
ALTER TABLE "boletas" DROP CONSTRAINT "boletas_pago_id_fkey";

-- DropIndex
DROP INDEX "boletas_pago_id_key";

-- AlterTable
ALTER TABLE "arriendos" DROP COLUMN "porcentaje_comision",
ADD COLUMN     "espacio_id" UUID,
ADD COLUMN     "periodo_desde" DATE NOT NULL,
ADD COLUMN     "periodo_hasta" DATE NOT NULL;

-- AlterTable
ALTER TABLE "boletas" DROP COLUMN "pago_id",
ADD COLUMN     "cita_id" UUID NOT NULL,
ADD COLUMN     "monto" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "citas" ADD COLUMN     "cancelada_en" TIMESTAMPTZ(6),
ADD COLUMN     "monto" INTEGER;

-- AlterTable
ALTER TABLE "configuracion_centro" ADD COLUMN     "cobro_inasistencia_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "comision_centro_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nombre_centro" TEXT NOT NULL DEFAULT 'Centro',
ADD COLUMN     "penalizacion_cancelacion_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "plazo_aviso_cancelacion_horas" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "rut_centro" TEXT;

-- AlterTable
ALTER TABLE "notificaciones" ALTER COLUMN "creada_por_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "anulado_en" TIMESTAMPTZ(6),
ADD COLUMN     "anulado_por_id" UUID,
ADD COLUMN     "cobrado_por" "cobrado_por" NOT NULL DEFAULT 'CENTRO',
ADD COLUMN     "estado" "estado_pago" NOT NULL DEFAULT 'REGISTRADO',
ADD COLUMN     "motivo_anulacion" TEXT,
ADD COLUMN     "origen" "origen_pago" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "registrado_por_id" UUID,
ADD COLUMN     "traslado_de_id" UUID;

-- AlterTable
ALTER TABLE "profesional_tipos_atencion" ADD COLUMN     "estado" "estado_tipo_sesion" NOT NULL DEFAULT 'PROPUESTO',
ADD COLUMN     "revisado_en" TIMESTAMPTZ(6),
ADD COLUMN     "revisado_por_id" UUID;

-- CreateTable
CREATE TABLE "resoluciones_cita" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cita_id" UUID NOT NULL,
    "decision" "decision_cita" NOT NULL,
    "a_tiempo" BOOLEAN,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "monto_exigible" INTEGER NOT NULL,
    "monto_devolucion" INTEGER NOT NULL,
    "cita_nueva_id" UUID,
    "motivo" TEXT,
    "decidido_por_id" UUID NOT NULL,
    "decidido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resoluciones_cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID NOT NULL,
    "periodo_desde" DATE NOT NULL,
    "periodo_hasta" DATE NOT NULL,
    "total_cobrado" INTEGER NOT NULL,
    "comision_porcentaje" DECIMAL(5,2) NOT NULL,
    "comision" INTEGER NOT NULL,
    "arriendos" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "estado" "estado_liquidacion" NOT NULL DEFAULT 'BORRADOR',
    "creada_por_id" UUID NOT NULL,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emitida_en" TIMESTAMPTZ(6),
    "pagada_en" TIMESTAMPTZ(6),

    CONSTRAINT "liquidaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_documento_clinico" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipos_documento_clinico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_clinicos" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "tipo_documento_id" UUID NOT NULL,
    "emitido_por_id" UUID NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "tipo_mime" TEXT NOT NULL,
    "contenido" BYTEA NOT NULL,
    "adjunto_solicitado_en" TIMESTAMPTZ(6),
    "emitido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_clinicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envios_documento" (
    "id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "modo" "modo_envio_documento" NOT NULL,
    "token_hash" TEXT,
    "enlace" BYTEA,
    "expira_en" TIMESTAMPTZ(6),
    "enviado_por_id" UUID NOT NULL,
    "enviado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "envios_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "descargas_documento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documento_id" UUID NOT NULL,
    "envio_id" UUID,
    "usuario_id" UUID NOT NULL,
    "descargado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "descargas_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salas_videollamada" (
    "usuario_id" UUID NOT NULL,
    "modo" "modo_videollamada" NOT NULL DEFAULT 'ENLACE_PROPIO',
    "enlace" BYTEA,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salas_videollamada_pkey" PRIMARY KEY ("usuario_id")
);

-- CreateTable
CREATE TABLE "feeds_calendario" (
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feeds_calendario_pkey" PRIMARY KEY ("usuario_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resoluciones_cita_cita_id_key" ON "resoluciones_cita"("cita_id");

-- CreateIndex
CREATE INDEX "liquidaciones_profesional_id_idx" ON "liquidaciones"("profesional_id");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_documento_clinico_nombre_key" ON "tipos_documento_clinico"("nombre");

-- CreateIndex
CREATE INDEX "documentos_clinicos_paciente_id_idx" ON "documentos_clinicos"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "envios_documento_token_hash_key" ON "envios_documento"("token_hash");

-- CreateIndex
CREATE INDEX "envios_documento_documento_id_idx" ON "envios_documento"("documento_id");

-- CreateIndex
CREATE INDEX "descargas_documento_documento_id_idx" ON "descargas_documento"("documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "feeds_calendario_token_hash_key" ON "feeds_calendario"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "boletas_cita_id_key" ON "boletas"("cita_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_traslado_de_id_key" ON "pagos"("traslado_de_id");

-- AddForeignKey
ALTER TABLE "profesional_tipos_atencion" ADD CONSTRAINT "profesional_tipos_atencion_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arriendos" ADD CONSTRAINT "arriendos_espacio_id_fkey" FOREIGN KEY ("espacio_id") REFERENCES "espacios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_traslado_de_id_fkey" FOREIGN KEY ("traslado_de_id") REFERENCES "pagos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_anulado_por_id_fkey" FOREIGN KEY ("anulado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boletas" ADD CONSTRAINT "boletas_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resoluciones_cita" ADD CONSTRAINT "resoluciones_cita_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resoluciones_cita" ADD CONSTRAINT "resoluciones_cita_cita_nueva_id_fkey" FOREIGN KEY ("cita_nueva_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resoluciones_cita" ADD CONSTRAINT "resoluciones_cita_decidido_por_id_fkey" FOREIGN KEY ("decidido_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_clinicos" ADD CONSTRAINT "documentos_clinicos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_clinicos" ADD CONSTRAINT "documentos_clinicos_tipo_documento_id_fkey" FOREIGN KEY ("tipo_documento_id") REFERENCES "tipos_documento_clinico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_clinicos" ADD CONSTRAINT "documentos_clinicos_emitido_por_id_fkey" FOREIGN KEY ("emitido_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_documento" ADD CONSTRAINT "envios_documento_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos_clinicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "envios_documento" ADD CONSTRAINT "envios_documento_enviado_por_id_fkey" FOREIGN KEY ("enviado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descargas_documento" ADD CONSTRAINT "descargas_documento_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documentos_clinicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descargas_documento" ADD CONSTRAINT "descargas_documento_envio_id_fkey" FOREIGN KEY ("envio_id") REFERENCES "envios_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descargas_documento" ADD CONSTRAINT "descargas_documento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salas_videollamada" ADD CONSTRAINT "salas_videollamada_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeds_calendario" ADD CONSTRAINT "feeds_calendario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- -----------------------------------------------------------------------------
-- 2. A1: tipos de atencion por profesional (propone el profesional, decide ADMIN).
-- -----------------------------------------------------------------------------

-- Las asignaciones previas las hizo ADMIN: quedan aprobadas.
UPDATE profesional_tipos_atencion SET estado = 'APROBADO', revisado_en = created_at;

ALTER TABLE profesional_tipos_atencion ADD CONSTRAINT profesional_tipos_atencion_revision_coherente
  CHECK ((estado = 'PROPUESTO') = (revisado_en IS NULL));

-- Mismo patron que tipos_sesion: no ADMIN siempre propone; ADMIN decide y
-- queda registrado quien y cuando. El dueño (migraciones, seed) no pasa por aqui.
CREATE FUNCTION proteger_tipo_atencion_profesional() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF app_rol() IS DISTINCT FROM 'ADMIN' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Solo ADMIN aprueba o rechaza tipos de atencion' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.estado := 'PROPUESTO';
    NEW.revisado_por_id := NULL;
    NEW.revisado_en := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF TG_OP = 'UPDATE' AND (NEW.profesional_id, NEW.tipo_atencion_id, NEW.created_at)
                            IS DISTINCT FROM (OLD.profesional_id, OLD.tipo_atencion_id, OLD.created_at) THEN
      RAISE EXCEPTION 'Solo se cambia el estado de la propuesta' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.revisado_por_id := CASE WHEN NEW.estado = 'PROPUESTO' THEN NULL ELSE app_usuario_id() END;
    NEW.revisado_en := CASE WHEN NEW.estado = 'PROPUESTO' THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profesional_tipos_atencion_protegidos BEFORE INSERT OR UPDATE ON profesional_tipos_atencion
  FOR EACH ROW EXECUTE FUNCTION proteger_tipo_atencion_profesional();

DROP POLICY profesional_tipos_atencion_insert ON profesional_tipos_atencion;
CREATE POLICY profesional_tipos_atencion_insert ON profesional_tipos_atencion FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'ADMIN'
              OR (profesional_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) = 'PROFESIONAL'));
CREATE POLICY profesional_tipos_atencion_update ON profesional_tipos_atencion FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
GRANT UPDATE (estado) ON profesional_tipos_atencion TO app_user;

-- Solo los APROBADOS: perfiles publicos (match) y directorio (candidatos de derivacion).
CREATE OR REPLACE FUNCTION perfiles_publicos()
 RETURNS TABLE(id uuid, nombre_publico text, bio text, foto_url text, especialidad text, enfoques text[], modalidad modalidad, tipos_atencion text[], verificado boolean, titulos_verificados text[], tarifas jsonb)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.usuario_id, p.nombre_publico, p.bio, p.foto_url, p.especialidad, p.enfoques, p.modalidad,
         ARRAY(SELECT t.nombre FROM profesional_tipos_atencion pt JOIN tipos_atencion t ON t.id = pt.tipo_atencion_id
               WHERE pt.profesional_id = p.usuario_id AND pt.estado = 'APROBADO' AND t.activo ORDER BY t.nombre),
         EXISTS (SELECT 1 FROM profesional_trayectoria tr WHERE tr.profesional_id = p.usuario_id AND tr.verificado),
         ARRAY(SELECT tr.titulo FROM profesional_trayectoria tr
               WHERE tr.profesional_id = p.usuario_id AND tr.verificado ORDER BY tr.anio, tr.titulo),
         (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo_atencion', ta.nombre, 'modalidad', v.modalidad, 'monto', v.monto)
                                    ORDER BY ta.nombre NULLS FIRST, v.modalidad NULLS FIRST), '[]'::jsonb)
          FROM (SELECT DISTINCT ON (tf.tipo_atencion_id, tf.modalidad) tf.tipo_atencion_id, tf.modalidad, tf.monto
                FROM tarifas tf
                WHERE tf.profesional_id = p.usuario_id AND tf.vigente_desde <= now()
                ORDER BY tf.tipo_atencion_id, tf.modalidad, tf.vigente_desde DESC, tf.created_at DESC) v
          LEFT JOIN tipos_atencion ta ON ta.id = v.tipo_atencion_id)
  FROM profesionales p JOIN usuarios u ON u.id = p.usuario_id
  WHERE p.perfil_publico AND u.activo AND u.rol::text = 'PROFESIONAL'
    AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
  ORDER BY p.nombre_publico
$$;

CREATE OR REPLACE FUNCTION directorio_interno()
 RETURNS TABLE(id uuid, nombre text, rol rol, tipos_atencion text[], email text, telefono bytea)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_rol text := app_rol();
  v_contacto boolean := app_rol() IN ('ADMIN', 'GESTION');
BEGIN
  IF NOT acceso_vigente() OR v_rol NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'directorio_interno: solo equipo con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT u.id, u.nombre, u.rol,
         ARRAY(SELECT t.nombre FROM profesional_tipos_atencion pt JOIN tipos_atencion t ON t.id = pt.tipo_atencion_id
               WHERE pt.profesional_id = u.id AND pt.estado = 'APROBADO' AND t.activo ORDER BY t.nombre),
         CASE WHEN v_contacto THEN u.email END,
         CASE WHEN v_contacto THEN u.telefono END
  FROM usuarios u
  WHERE u.activo AND u.rol::text <> 'PACIENTE'
    AND (v_rol <> 'PRACTICANTE' OR u.id = supervisor_vigente(app_usuario_id()))
  ORDER BY u.nombre;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. A2: documentos clinicos por correo (Fichas y Pacientes).
-- -----------------------------------------------------------------------------

ALTER TABLE tipos_documento_clinico ADD CONSTRAINT tipos_documento_clinico_nombre_no_vacio CHECK (btrim(nombre) <> '');
ALTER TABLE documentos_clinicos ADD CONSTRAINT documentos_clinicos_cifrado CHECK (octet_length(contenido) >= 49);
ALTER TABLE documentos_clinicos ADD CONSTRAINT documentos_clinicos_archivo
  CHECK (btrim(nombre_archivo) <> '' AND tipo_mime IN ('application/pdf', 'image/png', 'image/jpeg'));
-- ENLACE: token (hash), enlace cifrado y expiracion; ADJUNTO: nada de eso.
ALTER TABLE envios_documento ADD CONSTRAINT envios_documento_coherente
  CHECK ((modo = 'ENLACE') = (token_hash IS NOT NULL AND enlace IS NOT NULL AND expira_en IS NOT NULL)
         AND (modo = 'ENLACE' OR (token_hash IS NULL AND enlace IS NULL AND expira_en IS NULL))
         AND (enlace IS NULL OR octet_length(enlace) >= 49)
         AND (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'));

-- Append-only (incluso dueño). documentos_clinicos solo registra una vez la
-- solicitud de adjunto del paciente (solicitar_adjunto_documento).
CREATE FUNCTION proteger_documento_clinico() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.adjunto_solicitado_en IS NOT NULL
     OR (NEW.id, NEW.paciente_id, NEW.tipo_documento_id, NEW.emitido_por_id, NEW.nombre_archivo, NEW.tipo_mime,
         NEW.contenido, NEW.emitido_en)
        IS DISTINCT FROM
        (OLD.id, OLD.paciente_id, OLD.tipo_documento_id, OLD.emitido_por_id, OLD.nombre_archivo, OLD.tipo_mime,
         OLD.contenido, OLD.emitido_en) THEN
    RAISE EXCEPTION 'documentos_clinicos es append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documentos_clinicos_append_only BEFORE UPDATE OR DELETE ON documentos_clinicos
  FOR EACH ROW EXECUTE FUNCTION proteger_documento_clinico();

CREATE FUNCTION bloquear_cambios_registro() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER envios_documento_append_only BEFORE UPDATE OR DELETE ON envios_documento
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();
CREATE TRIGGER descargas_documento_append_only BEFORE UPDATE OR DELETE ON descargas_documento
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();

-- Adjunto solo si el paciente lo pidio explicitamente (registrado antes del envio).
CREATE FUNCTION validar_envio_documento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.modo = 'ADJUNTO' AND NOT EXISTS (SELECT 1 FROM documentos_clinicos
                                          WHERE id = NEW.documento_id AND adjunto_solicitado_en IS NOT NULL) THEN
    RAISE EXCEPTION 'Adjunto sin solicitud explicita del paciente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'envios_documento_adjunto_solicitado';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER envios_documento_adjunto_solicitado BEFORE INSERT ON envios_documento
  FOR EACH ROW EXECUTE FUNCTION validar_envio_documento();

-- El paciente pide recibir el documento adjunto (una vez).
CREATE FUNCTION solicitar_adjunto_documento(p_documento_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_solicitado timestamptz;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PACIENTE' THEN
    RAISE EXCEPTION 'Solo el paciente pide su documento adjunto' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT adjunto_solicitado_en INTO v_solicitado FROM documentos_clinicos
  WHERE id = p_documento_id AND paciente_id = app_paciente_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_solicitado IS NOT NULL THEN
    RAISE EXCEPTION 'El adjunto ya fue solicitado' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE documentos_clinicos SET adjunto_solicitado_en = now() WHERE id = p_documento_id;
END;
$$;

-- Descarga por enlace: solo el paciente del documento, con sesion y antes de
-- que venza. Registra la descarga (y en accesos_ficha). Vencido: no registra.
CREATE FUNCTION registrar_descarga_documento(p_token_hash text)
RETURNS TABLE (documento_id uuid, vencido boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_envio envios_documento%ROWTYPE;
  v_paciente uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PACIENTE' THEN
    RAISE EXCEPTION 'Solo el paciente descarga sus documentos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT e.* INTO v_envio FROM envios_documento e JOIN documentos_clinicos d ON d.id = e.documento_id
  WHERE e.token_hash = p_token_hash AND d.paciente_id = app_paciente_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enlace inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_envio.expira_en <= now() THEN
    RETURN QUERY SELECT v_envio.documento_id, true;
    RETURN;
  END IF;
  v_paciente := app_paciente_id();
  INSERT INTO descargas_documento (documento_id, envio_id, usuario_id)
  VALUES (v_envio.documento_id, v_envio.id, app_usuario_id());
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), 'PACIENTE', v_paciente, 'documentos_clinicos', 'DESCARGA');
  RETURN QUERY SELECT v_envio.documento_id, false;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. A3: avisos de derivacion desde la BD (tambien cuando un job o un rechazo
--    pasa la oferta al siguiente). El candidato solo sabe que tiene una oferta:
--    la fila no dice quien la origino (creada_por_id nulo). El origen recibe
--    un aviso por cambio de estado (uno pendiente por derivacion a la vez).
-- -----------------------------------------------------------------------------

CREATE FUNCTION avisar_origen_derivacion(p_derivacion_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_origen uuid;
BEGIN
  SELECT profesional_origen_id INTO v_origen FROM derivaciones WHERE id = p_derivacion_id;
  IF v_origen IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM notificaciones WHERE tipo = 'DERIVACION_ACTUALIZADA' AND usuario_id = v_origen
         AND referencia_id = p_derivacion_id AND estado = 'PENDIENTE') THEN
    INSERT INTO notificaciones (tipo, usuario_id, referencia_id, creada_por_id)
    VALUES ('DERIVACION_ACTUALIZADA', v_origen, p_derivacion_id, NULL);
  END IF;
END;
$$;

CREATE FUNCTION notificar_candidato_derivacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'OFRECIDA' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'OFRECIDA') THEN
    INSERT INTO notificaciones (tipo, usuario_id, referencia_id, creada_por_id)
    VALUES ('DERIVACION_OFRECIDA', NEW.profesional_id, NEW.derivacion_id, NULL);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    PERFORM avisar_origen_derivacion(NEW.derivacion_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER derivacion_candidatos_notificar AFTER INSERT OR UPDATE OF estado ON derivacion_candidatos
  FOR EACH ROW EXECUTE FUNCTION notificar_candidato_derivacion();

CREATE FUNCTION notificar_estado_derivacion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    PERFORM avisar_origen_derivacion(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER derivaciones_notificar AFTER UPDATE OF estado ON derivaciones
  FOR EACH ROW EXECUTE FUNCTION notificar_estado_derivacion();


-- -----------------------------------------------------------------------------
-- 5. A6: sala de videollamada y feed iCal (Agenda y Espacios).
-- -----------------------------------------------------------------------------

ALTER TABLE salas_videollamada ADD CONSTRAINT salas_videollamada_cifrado CHECK (enlace IS NULL OR octet_length(enlace) >= 49);
ALTER TABLE feeds_calendario ADD CONSTRAINT feeds_calendario_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$');

-- Feed privado (sin contexto: la URL lleva el token; invalido -> P0002). Solo citas CONFIRMADA y
-- POR_REPROGRAMAR del dueño del token, de 30 dias atras a un año adelante.
-- Nunca paciente ni motivo: modalidad, horario, box y el enlace (cifrado).
CREATE FUNCTION feed_calendario(p_token_hash text)
RETURNS TABLE (id uuid, inicio timestamptz, fin timestamptz, modalidad modalidad_atencion, estado estado_cita,
               espacio text, enlace bytea)
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
  SELECT c.id, c.inicio, c.fin, c.modalidad, c.estado, e.nombre, c.enlace_online
  FROM citas c LEFT JOIN espacios e ON e.id = c.espacio_id
  WHERE c.profesional_id = v_usuario
    AND c.estado IN ('CONFIRMADA', 'POR_REPROGRAMAR')
    AND c.inicio >= now() - interval '30 days' AND c.inicio < now() + interval '365 days'
  ORDER BY c.inicio;
END;
$$;


-- -----------------------------------------------------------------------------
-- 6. Configuracion del centro (remitente, politica de cancelacion, comision).
-- -----------------------------------------------------------------------------

ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_cobros_validos
  CHECK (btrim(nombre_centro) <> '' AND plazo_aviso_cancelacion_horas BETWEEN 0 AND 720
         AND penalizacion_cancelacion_porcentaje BETWEEN 0 AND 100
         AND cobro_inasistencia_porcentaje BETWEEN 0 AND 100
         AND comision_centro_porcentaje BETWEEN 0 AND 100);
GRANT UPDATE (nombre_centro, rut_centro, plazo_aviso_cancelacion_horas, penalizacion_cancelacion_porcentaje,
              cobro_inasistencia_porcentaje, comision_centro_porcentaje) ON configuracion_centro TO app_user;


-- -----------------------------------------------------------------------------
-- 7. B1: monto de la cita, fijado al confirmar e inmutable.
-- -----------------------------------------------------------------------------

ALTER TABLE citas ADD CONSTRAINT citas_monto_no_negativo CHECK (monto IS NULL OR monto >= 0);

-- Tarifa mas especifica vigente: tipo+modalidad, tipo, modalidad, general.
CREATE FUNCTION tarifa_vigente(p_profesional_id uuid, p_tipo_atencion_id uuid, p_modalidad modalidad_atencion)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.monto FROM tarifas t
  WHERE t.profesional_id = p_profesional_id AND t.vigente_desde <= now()
    AND (t.tipo_atencion_id IS NULL OR t.tipo_atencion_id = p_tipo_atencion_id)
    AND (t.modalidad IS NULL OR t.modalidad = p_modalidad)
  ORDER BY (t.tipo_atencion_id IS NOT NULL) DESC, (t.modalidad IS NOT NULL) DESC, t.vigente_desde DESC, t.created_at DESC
  LIMIT 1
$$;

-- Al confirmar (INSERT CONFIRMADA o primera confirmacion de una cita sin
-- monto) fija el monto; despues no cambia (incluso dueño). Sin tarifa = 0.
-- Reprogramar es la misma fila: conserva su monto. Tambien fija cancelada_en.
CREATE FUNCTION fijar_monto_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.monto IS NOT NULL AND NEW.monto IS DISTINCT FROM OLD.monto THEN
    RAISE EXCEPTION 'El monto de la cita es inmutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.estado = 'CONFIRMADA' AND (TG_OP = 'INSERT' OR OLD.monto IS NULL) THEN
    NEW.monto := coalesce(tarifa_vigente(NEW.profesional_id,
                                         (SELECT tipo_atencion_id FROM pacientes WHERE id = NEW.paciente_id),
                                         NEW.modalidad), 0);
  ELSIF TG_OP = 'INSERT' THEN
    NEW.monto := NULL;
  END IF;
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
CREATE TRIGGER citas_monto_fijado BEFORE INSERT OR UPDATE ON citas
  FOR EACH ROW EXECUTE FUNCTION fijar_monto_cita();


-- -----------------------------------------------------------------------------
-- 8. B2: pagos (sin escritura directa), saldo y boleta unica.
-- -----------------------------------------------------------------------------

ALTER TABLE pagos ADD CONSTRAINT pagos_anulacion_coherente
  CHECK ((estado = 'ANULADO') = (anulado_en IS NOT NULL)
         AND (estado = 'REGISTRADO' OR btrim(coalesce(motivo_anulacion, '')) <> '')
         AND (origen = 'TRASLADO') = (traslado_de_id IS NOT NULL));

-- Solo anular una vez (REGISTRADO -> ANULADO con quien, cuando y motivo). Incluso dueño.
CREATE FUNCTION proteger_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.estado <> 'REGISTRADO' OR NEW.estado <> 'ANULADO'
     OR (NEW.id, NEW.cita_id, NEW.monto, NEW.medio_pago, NEW.fecha, NEW.origen, NEW.cobrado_por, NEW.traslado_de_id,
         NEW.registrado_por_id, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.cita_id, OLD.monto, OLD.medio_pago, OLD.fecha, OLD.origen, OLD.cobrado_por, OLD.traslado_de_id,
         OLD.registrado_por_id, OLD.created_at) THEN
    RAISE EXCEPTION 'pagos no se modifica ni se borra: solo se anula una vez' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pagos_append_only BEFORE UPDATE OR DELETE ON pagos
  FOR EACH ROW EXECUTE FUNCTION proteger_pago();

-- Boleta: solo cambia pdf_url (de nulo a generado). Nunca DELETE.
CREATE FUNCTION proteger_boleta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.pdf_url IS NOT NULL
     OR (NEW.id, NEW.cita_id, NEW.numero, NEW.monto, NEW.emisor_nombre, NEW.emisor_rut, NEW.created_at)
        IS DISTINCT FROM (OLD.id, OLD.cita_id, OLD.numero, OLD.monto, OLD.emisor_nombre, OLD.emisor_rut, OLD.created_at) THEN
    RAISE EXCEPTION 'boletas es append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER boletas_append_only BEFORE UPDATE OR DELETE ON boletas
  FOR EACH ROW EXECUTE FUNCTION proteger_boleta();
ALTER TABLE boletas ADD CONSTRAINT boletas_monto_positivo CHECK (monto > 0);
CREATE SEQUENCE boletas_numero_seq;

-- Resoluciones (B3): append-only incluso dueño.
ALTER TABLE resoluciones_cita ADD CONSTRAINT resoluciones_cita_coherente
  CHECK (monto_exigible >= 0 AND monto_devolucion >= 0 AND porcentaje BETWEEN 0 AND 100
         AND (decision = 'TRASLADO') = (cita_nueva_id IS NOT NULL)
         AND (decision = 'INASISTENCIA') = (a_tiempo IS NULL)
         AND cita_nueva_id IS DISTINCT FROM cita_id);
CREATE TRIGGER resoluciones_cita_append_only BEFORE UPDATE OR DELETE ON resoluciones_cita
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();

-- Estado de pago por cita. security_invoker: cada rol ve las citas y pagos
-- que su RLS le deja ver (PRACTICANTE no ve pagos: sin filas).
--   exigible = resolucion (cancelacion o inasistencia) o, sin ella, el monto
--              (0 si la cita esta cancelada sin decision).
--   saldo    = exigible - (pagado no anulado - devolucion).
--   estado   = SIN_COBRO (exigible 0) | PENDIENTE | PARCIAL | PAGADO.
CREATE VIEW estado_pago_citas WITH (security_invoker = true) AS
SELECT c.id AS cita_id, c.profesional_id, c.paciente_id, c.estado AS estado_cita, c.inicio, c.fin, c.monto,
       x.exigible, x.pagado, x.devolucion,
       greatest(x.exigible - (x.pagado - x.devolucion), 0) AS saldo,
       CASE
         WHEN x.exigible = 0 THEN 'SIN_COBRO'
         WHEN x.pagado - x.devolucion >= x.exigible THEN 'PAGADO'
         WHEN x.pagado - x.devolucion > 0 THEN 'PARCIAL'
         ELSE 'PENDIENTE'
       END AS estado_pago
FROM citas c
LEFT JOIN resoluciones_cita r ON r.cita_id = c.id
CROSS JOIN LATERAL (
  SELECT coalesce(r.monto_exigible, CASE WHEN c.estado = 'CANCELADA' THEN 0 ELSE coalesce(c.monto, 0) END) AS exigible,
         coalesce((SELECT sum(p.monto) FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO'), 0)::int AS pagado,
         coalesce(r.monto_devolucion, 0) AS devolucion
) x
WHERE (SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE';

-- Registra un pago. ADMIN/GESTION; con cobro directo tambien el profesional
-- de la cita. Sobrepago = 23514. La fila de la cita se bloquea: dos pagos
-- simultaneos no superan el saldo entre ambos.
CREATE FUNCTION registrar_pago(p_cita_id uuid, p_monto int, p_medio medio_pago) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_profesional uuid;
  v_saldo int;
  v_id uuid;
BEGIN
  SELECT profesional_id INTO v_profesional FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT acceso_vigente() OR NOT (app_rol() IN ('ADMIN', 'GESTION')
          OR (app_rol() = 'PROFESIONAL' AND v_profesional = app_usuario_id() AND cobro_directo(v_profesional))) THEN
    RAISE EXCEPTION 'Registran ADMIN/GESTION, o el profesional de la cita con cobro directo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_profesional IS NULL THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser positivo' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_monto_positivo';
  END IF;
  SELECT saldo INTO v_saldo FROM estado_pago_citas WHERE cita_id = p_cita_id;
  IF p_monto > v_saldo THEN
    RAISE EXCEPTION 'El pago supera el saldo de la cita (%)', v_saldo
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_sin_sobrepago';
  END IF;
  INSERT INTO pagos (cita_id, monto, medio_pago, registrado_por_id, cobrado_por)
  VALUES (p_cita_id, p_monto, p_medio, app_usuario_id(),
          CASE WHEN cobro_directo(v_profesional) THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO' END)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Anulacion con motivo (ADMIN/GESTION). No sobre una cita con boleta ni
-- sobre un pago ya liquidado (liquidacion emitida o pagada de ese periodo).
CREATE FUNCTION anular_pago(p_pago_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pago pagos%ROWTYPE;
  v_profesional uuid;
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
  SELECT profesional_id INTO v_profesional FROM citas WHERE id = v_pago.cita_id;
  IF v_pago.estado <> 'REGISTRADO'
     OR EXISTS (SELECT 1 FROM boletas WHERE cita_id = v_pago.cita_id)
     OR EXISTS (SELECT 1 FROM liquidaciones l WHERE l.profesional_id = v_profesional AND l.estado <> 'BORRADOR'
                AND (v_pago.fecha AT TIME ZONE 'America/Santiago')::date >= l.periodo_desde
                AND (v_pago.fecha AT TIME ZONE 'America/Santiago')::date < l.periodo_hasta) THEN
    RAISE EXCEPTION 'El pago ya esta anulado, tiene boleta o esta liquidado'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE pagos SET estado = 'ANULADO', anulado_en = now(), anulado_por_id = app_usuario_id(), motivo_anulacion = btrim(p_motivo)
  WHERE id = p_pago_id;
END;
$$;

-- Boleta unica de la cita al quedar PAGADA. La API arma la copia del emisor
-- (cifrada con el id que genera) y la pasa. Devuelve el numero, o nulo si no
-- corresponde: no esta pagada, ya tiene boleta, o lo pagado viene trasladado
-- de una cita que ya tenia boleta (la misma plata no se boletea dos veces).
CREATE FUNCTION emitir_boleta(p_id uuid, p_cita_id uuid, p_emisor_nombre bytea, p_emisor_rut bytea) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado text;
  v_exigible int;
  v_profesional uuid;
  v_numero text;
BEGIN
  SELECT profesional_id INTO v_profesional FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT acceso_vigente() OR NOT (app_rol() IN ('ADMIN', 'GESTION')
          OR (app_rol() = 'PROFESIONAL' AND v_profesional = app_usuario_id() AND cobro_directo(v_profesional))) THEN
    RAISE EXCEPTION 'Emiten ADMIN/GESTION, o el profesional de la cita con cobro directo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT estado_pago, exigible INTO v_estado, v_exigible FROM estado_pago_citas WHERE cita_id = p_cita_id;
  IF v_estado IS DISTINCT FROM 'PAGADO'
     OR EXISTS (SELECT 1 FROM boletas WHERE cita_id = p_cita_id)
     OR EXISTS (SELECT 1 FROM pagos p JOIN pagos o ON o.id = p.traslado_de_id JOIN boletas b ON b.cita_id = o.cita_id
                WHERE p.cita_id = p_cita_id) THEN
    RETURN NULL;
  END IF;
  v_numero := 'SIM-' || lpad(nextval('boletas_numero_seq')::text, 8, '0');
  INSERT INTO boletas (id, cita_id, numero, monto, emisor_nombre, emisor_rut)
  VALUES (p_id, p_cita_id, v_numero, v_exigible, p_emisor_nombre, p_emisor_rut);
  RETURN v_numero;
END;
$$;


-- -----------------------------------------------------------------------------
-- 9. B3: politica de cancelacion e inasistencia (resolver_cita).
-- -----------------------------------------------------------------------------

-- ADMIN/GESTION registran la decision (la del paciente, en cancelaciones):
--   cancelacion a tiempo (aviso >= plazo): sin cobro; TRASLADO (credito a
--     cita_nueva) o DEVOLUCION de lo pagado.
--   cancelacion tardia: TRASLADO (reprograma: el pago pasa a cita_nueva, sin
--     penalizacion) o DEVOLUCION de lo pagado menos la penalizacion.
--   INASISTENCIA (cita confirmada ya terminada): cobro del porcentaje configurado.
-- Copia el porcentaje vigente; una decision por cita, append-only.
CREATE FUNCTION resolver_cita(p_cita_id uuid, p_decision decision_cita, p_cita_nueva_id uuid, p_motivo text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cita citas%ROWTYPE;
  v_nueva citas%ROWTYPE;
  v_conf configuracion_centro%ROWTYPE;
  v_a_tiempo boolean;
  v_porcentaje numeric(5,2) := 0;
  v_exigible int := 0;
  v_pagado int;
  v_saldo_nueva int;
  v_pago pagos%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION registran la decision de cobro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_cita FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM resoluciones_cita WHERE cita_id = p_cita_id) THEN
    RAISE EXCEPTION 'La cita ya tiene una decision de cobro' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT * INTO v_conf FROM configuracion_centro;

  IF p_decision = 'INASISTENCIA' THEN
    IF v_cita.estado <> 'CONFIRMADA' OR v_cita.fin > now() THEN
      RAISE EXCEPTION 'Inasistencia solo de una cita confirmada ya terminada' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    v_porcentaje := v_conf.cobro_inasistencia_porcentaje;
  ELSE
    IF v_cita.estado <> 'CANCELADA' THEN
      RAISE EXCEPTION 'La cita no esta cancelada' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    v_a_tiempo := v_cita.inicio - coalesce(v_cita.cancelada_en, v_cita.updated_at)
                  >= make_interval(hours => v_conf.plazo_aviso_cancelacion_horas);
    IF p_decision = 'DEVOLUCION' AND NOT v_a_tiempo THEN
      v_porcentaje := v_conf.penalizacion_cancelacion_porcentaje;
    END IF;
  END IF;
  v_exigible := round(coalesce(v_cita.monto, 0) * v_porcentaje / 100);

  IF p_decision = 'TRASLADO' THEN
    SELECT * INTO v_nueva FROM citas WHERE id = p_cita_nueva_id FOR UPDATE;
    IF NOT FOUND OR v_nueva.id = v_cita.id OR v_nueva.paciente_id <> v_cita.paciente_id OR v_nueva.estado <> 'CONFIRMADA' THEN
      RAISE EXCEPTION 'Traslado: indicar una cita nueva confirmada del mismo paciente'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'resoluciones_cita_coherente';
    END IF;
    SELECT saldo INTO v_saldo_nueva FROM estado_pago_citas WHERE cita_id = v_nueva.id;
    IF (SELECT coalesce(sum(monto), 0) FROM pagos WHERE cita_id = v_cita.id AND estado = 'REGISTRADO') > v_saldo_nueva THEN
      RAISE EXCEPTION 'Lo pagado supera el saldo de la cita nueva'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_sin_sobrepago';
    END IF;
    FOR v_pago IN SELECT * FROM pagos WHERE cita_id = v_cita.id AND estado = 'REGISTRADO' ORDER BY fecha LOOP
      UPDATE pagos SET estado = 'ANULADO', anulado_en = now(), anulado_por_id = app_usuario_id(),
                       motivo_anulacion = 'Traslado a la cita ' || v_nueva.id
      WHERE id = v_pago.id;
      INSERT INTO pagos (cita_id, monto, medio_pago, fecha, origen, cobrado_por, traslado_de_id, registrado_por_id)
      VALUES (v_nueva.id, v_pago.monto, v_pago.medio_pago, v_pago.fecha, 'TRASLADO', v_pago.cobrado_por, v_pago.id,
              app_usuario_id());
    END LOOP;
  END IF;

  SELECT coalesce(sum(monto), 0) INTO v_pagado FROM pagos WHERE cita_id = v_cita.id AND estado = 'REGISTRADO';
  INSERT INTO resoluciones_cita (cita_id, decision, a_tiempo, porcentaje, monto_exigible, monto_devolucion,
                                 cita_nueva_id, motivo, decidido_por_id)
  VALUES (v_cita.id, p_decision, v_a_tiempo, v_porcentaje, v_exigible, greatest(v_pagado - v_exigible, 0),
          CASE WHEN p_decision = 'TRASLADO' THEN v_nueva.id END, nullif(btrim(p_motivo), ''), app_usuario_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- 10. B4: arriendos y liquidaciones.
-- -----------------------------------------------------------------------------

ALTER TABLE arriendos ADD CONSTRAINT arriendos_validos CHECK (monto > 0 AND periodo_hasta > periodo_desde);

ALTER TABLE liquidaciones ADD CONSTRAINT liquidaciones_coherente
  CHECK (periodo_hasta > periodo_desde AND comision_porcentaje BETWEEN 0 AND 100
         AND total = total_cobrado - comision - arriendos
         AND (estado = 'BORRADOR') = (emitida_en IS NULL)
         AND (estado = 'PAGADA') = (pagada_en IS NOT NULL));
ALTER TABLE liquidaciones ADD CONSTRAINT liquidaciones_sin_solape
  EXCLUDE USING gist (profesional_id WITH =, daterange(periodo_desde, periodo_hasta, '[)') WITH &&);

-- Solo BORRADOR se recalcula; despues solo avanza de estado. Nunca DELETE.
CREATE FUNCTION proteger_liquidacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (OLD.estado <> 'BORRADOR' AND NOT (OLD.estado = 'EMITIDA' AND NEW.estado = 'PAGADA'
         AND (NEW.total_cobrado, NEW.comision, NEW.arriendos, NEW.total, NEW.emitida_en)
             IS NOT DISTINCT FROM (OLD.total_cobrado, OLD.comision, OLD.arriendos, OLD.total, OLD.emitida_en)))
     OR (NEW.id, NEW.profesional_id, NEW.periodo_desde, NEW.periodo_hasta, NEW.creada_en)
        IS DISTINCT FROM (OLD.id, OLD.profesional_id, OLD.periodo_desde, OLD.periodo_hasta, OLD.creada_en) THEN
    RAISE EXCEPTION 'Una liquidacion emitida no se modifica ni se borra' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER liquidaciones_protegidas BEFORE UPDATE OR DELETE ON liquidaciones
  FOR EACH ROW EXECUTE FUNCTION proteger_liquidacion();

-- Liquidacion [desde, hasta) en fechas de Chile: pagos cobrados por el centro
-- (no anulados) menos devoluciones decididas en el periodo, menos la comision
-- vigente, menos los arriendos que empiezan en el periodo. Recalcula si ya
-- hay un BORRADOR del mismo periodo; un periodo emitido o solapado no (55000/23P01).
CREATE FUNCTION generar_liquidacion(p_profesional_id uuid, p_desde date, p_hasta date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cobrado int;
  v_devuelto int;
  v_pct numeric(5,2);
  v_comision int;
  v_arriendos int;
  v_id uuid;
  v_estado estado_liquidacion;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION liquidan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF rol_usuario(p_profesional_id) IS DISTINCT FROM 'PROFESIONAL' OR p_hasta <= p_desde THEN
    RAISE EXCEPTION 'Liquidacion: un PROFESIONAL y un periodo valido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidaciones_coherente';
  END IF;
  SELECT coalesce(sum(p.monto), 0) INTO v_cobrado
  FROM pagos p JOIN citas c ON c.id = p.cita_id
  WHERE c.profesional_id = p_profesional_id AND p.estado = 'REGISTRADO' AND p.cobrado_por = 'CENTRO'
    AND (p.fecha AT TIME ZONE 'America/Santiago')::date >= p_desde
    AND (p.fecha AT TIME ZONE 'America/Santiago')::date < p_hasta;
  SELECT coalesce(sum(r.monto_devolucion), 0) INTO v_devuelto
  FROM resoluciones_cita r JOIN citas c ON c.id = r.cita_id
  WHERE c.profesional_id = p_profesional_id
    AND EXISTS (SELECT 1 FROM pagos p WHERE p.cita_id = c.id AND p.cobrado_por = 'CENTRO')
    AND (r.decidido_en AT TIME ZONE 'America/Santiago')::date >= p_desde
    AND (r.decidido_en AT TIME ZONE 'America/Santiago')::date < p_hasta;
  v_cobrado := v_cobrado - v_devuelto;
  SELECT comision_centro_porcentaje INTO v_pct FROM configuracion_centro;
  v_comision := round(greatest(v_cobrado, 0) * v_pct / 100);
  SELECT coalesce(sum(monto), 0) INTO v_arriendos FROM arriendos
  WHERE profesional_id = p_profesional_id AND periodo_desde >= p_desde AND periodo_desde < p_hasta;

  SELECT id, estado INTO v_id, v_estado FROM liquidaciones
  WHERE profesional_id = p_profesional_id AND periodo_desde = p_desde AND periodo_hasta = p_hasta FOR UPDATE;
  IF v_estado IS NOT NULL AND v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La liquidacion del periodo ya fue emitida' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO liquidaciones (profesional_id, periodo_desde, periodo_hasta, total_cobrado, comision_porcentaje, comision,
                               arriendos, total, creada_por_id)
    VALUES (p_profesional_id, p_desde, p_hasta, v_cobrado, v_pct, v_comision, v_arriendos,
            v_cobrado - v_comision - v_arriendos, app_usuario_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE liquidaciones SET total_cobrado = v_cobrado, comision_porcentaje = v_pct, comision = v_comision,
                             arriendos = v_arriendos, total = v_cobrado - v_comision - v_arriendos
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- BORRADOR -> EMITIDA -> PAGADA (ADMIN/GESTION).
CREATE FUNCTION avanzar_liquidacion(p_id uuid, p_estado estado_liquidacion) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado estado_liquidacion;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION emiten o pagan liquidaciones' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT estado INTO v_estado FROM liquidaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Liquidacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT ((v_estado = 'BORRADOR' AND p_estado = 'EMITIDA') OR (v_estado = 'EMITIDA' AND p_estado = 'PAGADA')) THEN
    RAISE EXCEPTION 'Transicion de liquidacion invalida: % -> %', v_estado, p_estado
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE liquidaciones
  SET estado = p_estado,
      emitida_en = CASE WHEN p_estado = 'EMITIDA' THEN now() ELSE emitida_en END,
      pagada_en = CASE WHEN p_estado = 'PAGADA' THEN now() ELSE pagada_en END
  WHERE id = p_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- 11. datos_pago_profesional: "pago pendiente" = saldo > 0 (antes: sin pagos).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION datos_pago_profesional(p_cita_id uuid)
RETURNS TABLE(profesional_id uuid, rut bytea, banco bytea, tipo_cuenta bytea, numero_cuenta bytea, titular bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_profesional uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PACIENTE' THEN
    RAISE EXCEPTION 'datos_pago_profesional: solo PACIENTE' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.profesional_id INTO v_profesional FROM citas c
  WHERE c.id = p_cita_id AND c.paciente_id = app_paciente_id() AND c.estado = 'CONFIRMADA'
    AND (SELECT e.saldo FROM estado_pago_citas e WHERE e.cita_id = c.id) > 0;
  IF v_profesional IS NULL OR NOT cobro_directo(v_profesional) THEN
    RETURN;
  END IF;

  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), 'PACIENTE', app_paciente_id(), 'datos_pago_profesional', 'DATOS_PAGO');

  RETURN QUERY
  SELECT d.usuario_id, d.rut, d.banco, d.tipo_cuenta, d.numero_cuenta, d.titular
  FROM profesional_datos_privados d WHERE d.usuario_id = v_profesional;
END;
$$;


-- -----------------------------------------------------------------------------
-- 12. Job de envio de correos: datos para el .ics y los documentos.
--   enlace : citas.enlace_online (ENLACE_ONLINE y confirmacion/reprogramacion)
--            o envios_documento.enlace (DOCUMENTO_CLINICO); la API descifra.
--   adjunto: contenido del documento si el envio es ADJUNTO.
--   datos  : nombre del centro (remitente) y, segun el tipo, horario de la
--            cita (sin paciente ni motivo) o metadatos del documento.
-- -----------------------------------------------------------------------------

DROP FUNCTION notificaciones_por_enviar(int);
CREATE FUNCTION notificaciones_por_enviar(p_limite int)
RETURNS TABLE (id uuid, tipo tipo_notificacion, referencia_id uuid, email text, enlace bytea, adjunto bytea, datos jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH tomadas AS (
    SELECT n.id, n.tipo, n.referencia_id, n.paciente_id, n.usuario_id FROM notificaciones n
    WHERE n.estado = 'PENDIENTE' ORDER BY n.creada_en
    LIMIT greatest(coalesce(p_limite, 50), 1)
    FOR UPDATE SKIP LOCKED
  )
  SELECT t.id, t.tipo, t.referencia_id,
         CASE
           WHEN t.usuario_id IS NOT NULL THEN (SELECT u.email FROM usuarios u WHERE u.id = t.usuario_id AND u.activo)
           WHEN age((now() AT TIME ZONE 'America/Santiago')::date, p.fecha_nacimiento) < interval '18 years' THEN
             (SELECT a.email FROM adultos_responsables a WHERE a.paciente_id = p.id AND a.email IS NOT NULL
              ORDER BY a.created_at LIMIT 1)
           ELSE coalesce(p.email, (SELECT u.email FROM usuarios u WHERE u.paciente_id = p.id AND u.activo))
         END,
         CASE WHEN t.tipo IN ('ENLACE_ONLINE', 'CITA_CONFIRMADA', 'CITA_REPROGRAMADA') THEN c.enlace_online
              WHEN t.tipo = 'DOCUMENTO_CLINICO' THEN ev.enlace END,
         CASE WHEN t.tipo = 'DOCUMENTO_CLINICO' AND ev.modo = 'ADJUNTO' THEN d.contenido END,
         jsonb_build_object('centro', (SELECT nombre_centro FROM configuracion_centro))
         || CASE WHEN t.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA') AND c.id IS NOT NULL THEN
                   jsonb_build_object('inicio', c.inicio, 'fin', c.fin, 'modalidad', c.modalidad, 'estado', c.estado,
                                      'espacio', (SELECT e.nombre FROM espacios e WHERE e.id = c.espacio_id))
                 WHEN t.tipo = 'DOCUMENTO_CLINICO' AND ev.id IS NOT NULL THEN
                   jsonb_build_object('documento_id', d.id, 'nombre_archivo', d.nombre_archivo, 'tipo_mime', d.tipo_mime,
                                      'modo', ev.modo, 'expira_en', ev.expira_en)
                 ELSE '{}'::jsonb END
  FROM tomadas t
  LEFT JOIN pacientes p ON p.id = t.paciente_id
  LEFT JOIN citas c ON t.tipo IN ('ENLACE_ONLINE', 'CITA_CONFIRMADA', 'CITA_REPROGRAMADA') AND c.id = t.referencia_id
  LEFT JOIN envios_documento ev ON t.tipo = 'DOCUMENTO_CLINICO' AND ev.id = t.referencia_id
  LEFT JOIN documentos_clinicos d ON d.id = ev.documento_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- 13. RLS, politicas y GRANTs de lo nuevo y de lo que cambio.
-- -----------------------------------------------------------------------------

ALTER TABLE tipos_documento_clinico ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_documento_clinico FORCE ROW LEVEL SECURITY;
ALTER TABLE documentos_clinicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_clinicos FORCE ROW LEVEL SECURITY;
ALTER TABLE envios_documento ENABLE ROW LEVEL SECURITY;
ALTER TABLE envios_documento FORCE ROW LEVEL SECURITY;
ALTER TABLE descargas_documento ENABLE ROW LEVEL SECURITY;
ALTER TABLE descargas_documento FORCE ROW LEVEL SECURITY;
ALTER TABLE salas_videollamada ENABLE ROW LEVEL SECURITY;
ALTER TABLE salas_videollamada FORCE ROW LEVEL SECURITY;
ALTER TABLE feeds_calendario ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeds_calendario FORCE ROW LEVEL SECURITY;
ALTER TABLE resoluciones_cita ENABLE ROW LEVEL SECURITY;
ALTER TABLE resoluciones_cita FORCE ROW LEVEL SECURITY;
ALTER TABLE liquidaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidaciones FORCE ROW LEVEL SECURITY;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tipos_documento_clinico', 'documentos_clinicos', 'envios_documento', 'descargas_documento',
                           'salas_videollamada', 'feeds_calendario', 'resoluciones_cita', 'liquidaciones'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO app_user
                    USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()))', t || '_acceso_vigente', t);
  END LOOP;
END $$;

-- tipos_documento_clinico (B): el equipo lee; ADMIN escribe; nunca DELETE.
CREATE POLICY tipos_documento_clinico_select ON tipos_documento_clinico FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'));
CREATE POLICY tipos_documento_clinico_insert ON tipos_documento_clinico FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY tipos_documento_clinico_update ON tipos_documento_clinico FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
GRANT SELECT, INSERT ON tipos_documento_clinico TO app_user;
GRANT UPDATE (nombre, activo, updated_at) ON tipos_documento_clinico TO app_user;

-- documentos_clinicos (A): emite y lee el tratante (PRACTICANTE con
-- consentimiento); el paciente lee los suyos. ADMIN/GESTION nunca (clinico).
CREATE POLICY documentos_clinicos_select ON documentos_clinicos FOR SELECT TO app_user
  USING (es_profesional_de_paciente(paciente_id) OR paciente_id = (SELECT app_paciente_id()));
CREATE POLICY documentos_clinicos_insert ON documentos_clinicos FOR INSERT TO app_user
  WITH CHECK (emitido_por_id = (SELECT app_usuario_id()) AND es_profesional_de_paciente(paciente_id)
              AND EXISTS (SELECT 1 FROM tipos_documento_clinico t WHERE t.id = tipo_documento_id AND t.activo));
CREATE POLICY documentos_clinicos_consentimiento_practicante ON documentos_clinicos AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id))
  WITH CHECK ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id));
GRANT SELECT, INSERT ON documentos_clinicos TO app_user;

-- envios_documento (A): el tratante envia y ve; ADMIN audita (sin contenido).
CREATE POLICY envios_documento_select ON envios_documento FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN' OR documento_id IN (SELECT id FROM documentos_clinicos));
CREATE POLICY envios_documento_insert ON envios_documento FOR INSERT TO app_user
  WITH CHECK (enviado_por_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE')
              AND documento_id IN (SELECT id FROM documentos_clinicos));
GRANT SELECT, INSERT ON envios_documento TO app_user;

-- descargas_documento (A): las escribe registrar_descarga_documento; leen
-- ADMIN, el tratante y el paciente (las suyas).
CREATE POLICY descargas_documento_select ON descargas_documento FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN' OR documento_id IN (SELECT id FROM documentos_clinicos));
GRANT SELECT ON descargas_documento TO app_user;

-- salas_videollamada (A): el propio escribe; ADMIN/GESTION leen (agendan por otros).
CREATE POLICY salas_videollamada_select ON salas_videollamada FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR usuario_id = (SELECT app_usuario_id()));
CREATE POLICY salas_videollamada_insert ON salas_videollamada FOR INSERT TO app_user
  WITH CHECK (usuario_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE'));
CREATE POLICY salas_videollamada_update ON salas_videollamada FOR UPDATE TO app_user
  USING (usuario_id = (SELECT app_usuario_id())) WITH CHECK (usuario_id = (SELECT app_usuario_id()));
GRANT SELECT, INSERT ON salas_videollamada TO app_user;
GRANT UPDATE (modo, enlace, updated_at) ON salas_videollamada TO app_user;

-- feeds_calendario (A): solo el propio (el feed se lee sin contexto con feed_calendario).
CREATE POLICY feeds_calendario_propio ON feeds_calendario FOR ALL TO app_user
  USING (usuario_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE'))
  WITH CHECK (usuario_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE'));
GRANT SELECT, INSERT ON feeds_calendario TO app_user;
GRANT UPDATE (token_hash, creado_en) ON feeds_calendario TO app_user;

-- pagos: sin escritura directa (registrar_pago / anular_pago / resolver_cita).
DROP POLICY pagos_insert ON pagos;
DROP POLICY pagos_update ON pagos;
REVOKE INSERT, UPDATE ON pagos FROM app_user;

-- boletas: sin escritura directa (emitir_boleta). Leen ADMIN/GESTION y,
-- PROFESIONAL/PACIENTE, las de citas que ven.
CREATE POLICY boletas_select ON boletas FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PACIENTE') AND cita_id IN (SELECT id FROM citas)));
REVOKE INSERT, UPDATE ON boletas FROM app_user;

-- resoluciones_cita (A): leen ADMIN/GESTION y PROFESIONAL/PACIENTE de citas que ven.
CREATE POLICY resoluciones_cita_select ON resoluciones_cita FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PACIENTE') AND cita_id IN (SELECT id FROM citas)));
GRANT SELECT ON resoluciones_cita TO app_user;

-- liquidaciones (A): ADMIN/GESTION todas; el profesional las suyas ya emitidas.
CREATE POLICY liquidaciones_select ON liquidaciones FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR (profesional_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) = 'PROFESIONAL' AND estado <> 'BORRADOR'));
GRANT SELECT ON liquidaciones TO app_user;

GRANT SELECT ON estado_pago_citas TO app_user;

REVOKE EXECUTE ON FUNCTION
  proteger_tipo_atencion_profesional(), proteger_documento_clinico(), bloquear_cambios_registro(),
  validar_envio_documento(), avisar_origen_derivacion(uuid), notificar_candidato_derivacion(),
  notificar_estado_derivacion(), fijar_monto_cita(), tarifa_vigente(uuid, uuid, modalidad_atencion),
  proteger_pago(), proteger_boleta(), proteger_liquidacion(),
  solicitar_adjunto_documento(uuid), registrar_descarga_documento(text), feed_calendario(text),
  registrar_pago(uuid, int, medio_pago), anular_pago(uuid, text), emitir_boleta(uuid, uuid, bytea, bytea),
  resolver_cita(uuid, decision_cita, uuid, text), generar_liquidacion(uuid, date, date),
  avanzar_liquidacion(uuid, estado_liquidacion), notificaciones_por_enviar(int)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  solicitar_adjunto_documento(uuid), registrar_descarga_documento(text), feed_calendario(text),
  registrar_pago(uuid, int, medio_pago), anular_pago(uuid, text), emitir_boleta(uuid, uuid, bytea, bytea),
  resolver_cita(uuid, decision_cita, uuid, text), generar_liquidacion(uuid, date, date),
  avanzar_liquidacion(uuid, estado_liquidacion), notificaciones_por_enviar(int)
TO app_user;
