-- =============================================================================
-- 02f: registro de notificaciones (categoria A).
--
-- Cada aviso al paciente o al equipo (cita confirmada, enlace online,
-- solicitud de consentimiento, aviso de cambio de supervisor, oferta de
-- derivacion, mensaje del paciente) queda registrado. La fila no guarda
-- contenido ni datos de contacto: tipo, destinatario y fila de referencia.
--
-- Flujo: la API inserta PENDIENTE con el contexto del actor (despues del
-- COMMIT de la accion). Un job sin contexto toma las pendientes con
-- notificaciones_por_enviar() (FOR UPDATE SKIP LOCKED, devuelve el email del
-- destinatario y, para ENLACE_ONLINE, el enlace cifrado), envia por la
-- interfaz de correo y cierra cada una con marcar_notificacion().
-- Corre como dueño (vinculos_owner).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. DDL (identico al que genera Prisma para el schema).
-- -----------------------------------------------------------------------------

CREATE TYPE "tipo_notificacion" AS ENUM ('CITA_CONFIRMADA', 'CITA_CANCELADA', 'CITA_REPROGRAMADA', 'ENLACE_ONLINE', 'CONSENTIMIENTO_SOLICITADO', 'AVISO_CAMBIO_SUPERVISOR', 'DERIVACION_OFRECIDA', 'MENSAJE_PACIENTE');
CREATE TYPE "estado_notificacion" AS ENUM ('PENDIENTE', 'ENVIADA', 'FALLIDA');

CREATE TABLE "notificaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "tipo_notificacion" NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'EMAIL',
    "paciente_id" UUID,
    "usuario_id" UUID,
    "referencia_id" UUID NOT NULL,
    "creada_por_id" UUID NOT NULL,
    "estado" "estado_notificacion" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "detalle_error" TEXT,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesada_en" TIMESTAMPTZ(6),

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notificaciones_estado_creada_en_idx" ON "notificaciones"("estado", "creada_en");
CREATE INDEX "notificaciones_paciente_id_idx" ON "notificaciones"("paciente_id");
CREATE INDEX "notificaciones_usuario_id_idx" ON "notificaciones"("usuario_id");

ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- 2. Reglas que Prisma no expresa.
-- -----------------------------------------------------------------------------

-- Un destinatario (paciente o usuario); estado coherente con procesada_en.
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_coherente
  CHECK ((paciente_id IS NULL) <> (usuario_id IS NULL)
         AND canal = 'EMAIL'
         AND (estado = 'PENDIENTE') = (procesada_en IS NULL)
         AND intentos >= 0);

-- Append-only salvo el cierre (PENDIENTE -> ENVIADA/FALLIDA), una vez. Incluso dueño.
CREATE FUNCTION proteger_notificacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.estado <> 'PENDIENTE'
     OR (NEW.id, NEW.tipo, NEW.canal, NEW.paciente_id, NEW.usuario_id, NEW.referencia_id, NEW.creada_por_id, NEW.creada_en)
        IS DISTINCT FROM
        (OLD.id, OLD.tipo, OLD.canal, OLD.paciente_id, OLD.usuario_id, OLD.referencia_id, OLD.creada_por_id, OLD.creada_en) THEN
    RAISE EXCEPTION 'notificaciones es append-only: solo se cierra una vez' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER notificaciones_append_only BEFORE UPDATE OR DELETE ON notificaciones
  FOR EACH ROW EXECUTE FUNCTION proteger_notificacion();


-- -----------------------------------------------------------------------------
-- 3. Funciones del job de envio (sin contexto).
-- -----------------------------------------------------------------------------

-- Pendientes a enviar, bloqueadas para esta transaccion (dos instancias no
-- envian la misma). Email: el del paciente (si es menor, el de un adulto
-- responsable con email) o el del usuario. enlace: solo ENLACE_ONLINE (cifrado;
-- la API descifra con AAD citas:enlace_online:<referencia_id>).
CREATE FUNCTION notificaciones_por_enviar(p_limite int)
RETURNS TABLE (id uuid, tipo tipo_notificacion, referencia_id uuid, email text, enlace bytea)
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
         CASE WHEN t.tipo = 'ENLACE_ONLINE' THEN (SELECT c.enlace_online FROM citas c WHERE c.id = t.referencia_id) END
  FROM tomadas t LEFT JOIN pacientes p ON p.id = t.paciente_id;
END;
$$;

CREATE FUNCTION marcar_notificacion(p_id uuid, p_enviada boolean, p_detalle text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE notificaciones
  SET estado = CASE WHEN p_enviada THEN 'ENVIADA'::estado_notificacion ELSE 'FALLIDA' END,
      intentos = intentos + 1, procesada_en = now(), detalle_error = CASE WHEN p_enviada THEN NULL ELSE left(p_detalle, 300) END
  WHERE id = p_id AND estado = 'PENDIENTE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificacion inexistente o ya procesada' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. RLS, politicas y GRANTs.
-- -----------------------------------------------------------------------------

ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones FORCE ROW LEVEL SECURITY;

-- Leen ADMIN/GESTION (todas), el usuario destinatario y el paciente destinatario.
CREATE POLICY notificaciones_select ON notificaciones FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR usuario_id = (SELECT app_usuario_id())
         OR paciente_id = (SELECT app_paciente_id()));
-- Inserta la API como el actor que origino el aviso (siempre PENDIENTE).
CREATE POLICY notificaciones_insert ON notificaciones FOR INSERT TO app_user
  WITH CHECK (creada_por_id = (SELECT app_usuario_id()) AND estado = 'PENDIENTE' AND intentos = 0);
CREATE POLICY notificaciones_acceso_vigente ON notificaciones AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));

GRANT SELECT, INSERT ON notificaciones TO app_user;

REVOKE EXECUTE ON FUNCTION
  proteger_notificacion(),
  notificaciones_por_enviar(int),
  marcar_notificacion(uuid, boolean, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  notificaciones_por_enviar(int),
  marcar_notificacion(uuid, boolean, text)
TO app_user;
