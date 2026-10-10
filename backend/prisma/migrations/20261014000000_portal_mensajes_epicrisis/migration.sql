-- =============================================================================
-- 02g: portal del paciente. Dos tablas nuevas (categoria A), con contenido
-- cifrado por la API (CLINICO; registro.ts) e id generado por la API (AAD):
--   - mensajes_paciente: el paciente escribe a un profesional de su equipo
--     tratante; comunicacion asimetrica (el profesional responde por canales
--     externos, no hay respuesta in-app). Se avisa al profesional
--     (notificaciones, sin el contenido).
--   - solicitudes_epicrisis: el paciente solicita su epicrisis; la resuelven
--     el tratante o ADMIN con resolver_solicitud_epicrisis().
-- Corre como dueño (vinculos_owner).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. DDL (identico al que genera Prisma para el schema).
-- -----------------------------------------------------------------------------

CREATE TYPE "estado_epicrisis" AS ENUM ('SOLICITADA', 'EN_PROCESO', 'ENTREGADA', 'RECHAZADA');

CREATE TABLE "mensajes_paciente" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "contenido" BYTEA NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leido_en" TIMESTAMPTZ(6),

    CONSTRAINT "mensajes_paciente_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "solicitudes_epicrisis" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "motivo" BYTEA,
    "estado" "estado_epicrisis" NOT NULL DEFAULT 'SOLICITADA',
    "solicitada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resuelta_en" TIMESTAMPTZ(6),
    "resuelta_por_id" UUID,
    "documento_ref" TEXT,

    CONSTRAINT "solicitudes_epicrisis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mensajes_paciente_profesional_id_creado_en_idx" ON "mensajes_paciente"("profesional_id", "creado_en");
CREATE INDEX "mensajes_paciente_paciente_id_creado_en_idx" ON "mensajes_paciente"("paciente_id", "creado_en");
CREATE INDEX "solicitudes_epicrisis_paciente_id_solicitada_en_idx" ON "solicitudes_epicrisis"("paciente_id", "solicitada_en");

ALTER TABLE "mensajes_paciente" ADD CONSTRAINT "mensajes_paciente_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mensajes_paciente" ADD CONSTRAINT "mensajes_paciente_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "solicitudes_epicrisis" ADD CONSTRAINT "solicitudes_epicrisis_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "solicitudes_epicrisis" ADD CONSTRAINT "solicitudes_epicrisis_resuelta_por_id_fkey" FOREIGN KEY ("resuelta_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- 2. Reglas que Prisma no expresa.
-- -----------------------------------------------------------------------------

-- Cifrados: largo minimo del formato (49 bytes).
ALTER TABLE mensajes_paciente ADD CONSTRAINT mensajes_paciente_cifrado CHECK (octet_length(contenido) >= 49);
ALTER TABLE solicitudes_epicrisis ADD CONSTRAINT solicitudes_epicrisis_cifrado CHECK (octet_length(motivo) >= 49);

ALTER TABLE solicitudes_epicrisis ADD CONSTRAINT solicitudes_epicrisis_coherente
  CHECK ((estado IN ('SOLICITADA')) = (resuelta_en IS NULL)
         AND (resuelta_en IS NULL) = (resuelta_por_id IS NULL)
         AND (estado <> 'ENTREGADA' OR btrim(coalesce(documento_ref, '')) <> ''));

-- Append-only: mensajes solo cambian leido_en (una vez); solicitudes solo
-- avanzan de estado. Nunca DELETE (incluso dueño).
CREATE FUNCTION proteger_mensaje_paciente() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.leido_en IS NOT NULL
     OR (NEW.id, NEW.paciente_id, NEW.profesional_id, NEW.contenido, NEW.creado_en)
        IS DISTINCT FROM (OLD.id, OLD.paciente_id, OLD.profesional_id, OLD.contenido, OLD.creado_en) THEN
    RAISE EXCEPTION 'mensajes_paciente es append-only: solo se marca leido una vez' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mensajes_paciente_append_only BEFORE UPDATE OR DELETE ON mensajes_paciente
  FOR EACH ROW EXECUTE FUNCTION proteger_mensaje_paciente();

CREATE FUNCTION proteger_solicitud_epicrisis() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.estado IN ('ENTREGADA', 'RECHAZADA')
     OR (NEW.id, NEW.paciente_id, NEW.motivo, NEW.solicitada_en)
        IS DISTINCT FROM (OLD.id, OLD.paciente_id, OLD.motivo, OLD.solicitada_en) THEN
    RAISE EXCEPTION 'solicitudes_epicrisis: solo avanza de estado; nunca se borra' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER solicitudes_epicrisis_append_only BEFORE UPDATE OR DELETE ON solicitudes_epicrisis
  FOR EACH ROW EXECUTE FUNCTION proteger_solicitud_epicrisis();


-- -----------------------------------------------------------------------------
-- 3. Funciones (escritura con reglas de estado).
-- -----------------------------------------------------------------------------

-- El destinatario marca el mensaje como leido (una vez).
CREATE FUNCTION marcar_mensaje_leido(p_mensaje_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'Solo el profesional destinatario marca el mensaje' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE mensajes_paciente SET leido_en = now()
  WHERE id = p_mensaje_id AND profesional_id = app_usuario_id() AND leido_en IS NULL;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM mensajes_paciente WHERE id = p_mensaje_id AND profesional_id = app_usuario_id()) THEN
      RAISE EXCEPTION 'El mensaje ya estaba leido' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    RAISE EXCEPTION 'Mensaje inexistente' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

-- Resuelve el tratante actual o ADMIN. SOLICITADA -> EN_PROCESO | ENTREGADA |
-- RECHAZADA; EN_PROCESO -> ENTREGADA | RECHAZADA. ENTREGADA exige documento.
CREATE FUNCTION resolver_solicitud_epicrisis(p_id uuid, p_estado estado_epicrisis, p_documento_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_s solicitudes_epicrisis%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM solicitudes_epicrisis WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT acceso_vigente()
     OR NOT (app_rol() = 'ADMIN' OR (app_rol() IN ('PROFESIONAL', 'PRACTICANTE') AND es_profesional_de_paciente(v_s.paciente_id))) THEN
    RAISE EXCEPTION 'Resuelve el tratante o ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_s.estado IN ('ENTREGADA', 'RECHAZADA') OR p_estado IS NULL OR p_estado = 'SOLICITADA'
     OR (v_s.estado = 'EN_PROCESO' AND p_estado = 'EN_PROCESO') THEN
    RAISE EXCEPTION 'Transicion de estado invalida' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- documento faltante en ENTREGADA -> CHECK solicitudes_epicrisis_coherente (23514).
  UPDATE solicitudes_epicrisis
  SET estado = p_estado, resuelta_en = now(), resuelta_por_id = app_usuario_id(),
      documento_ref = CASE WHEN p_estado = 'ENTREGADA' THEN p_documento_ref ELSE documento_ref END
  WHERE id = p_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. RLS, politicas y GRANTs.
-- -----------------------------------------------------------------------------

ALTER TABLE mensajes_paciente ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_epicrisis ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes_paciente FORCE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_epicrisis FORCE ROW LEVEL SECURITY;

-- mensajes_paciente: el paciente escribe solo a su equipo tratante
-- (mi_equipo_tratante: tratante y profesionales de sus citas) y lee los
-- suyos; el destinatario lee los que recibe. ADMIN/GESTION nunca (contenido).
CREATE POLICY mensajes_paciente_select ON mensajes_paciente FOR SELECT TO app_user
  USING (paciente_id = (SELECT app_paciente_id()) OR profesional_id = (SELECT app_usuario_id()));
CREATE POLICY mensajes_paciente_insert ON mensajes_paciente FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'PACIENTE' AND paciente_id = (SELECT app_paciente_id()) AND leido_en IS NULL
              AND profesional_id IN (SELECT e.id FROM mi_equipo_tratante() e));

-- solicitudes_epicrisis: el paciente crea y ve las suyas; ADMIN/GESTION ven
-- todas (seguimiento de plazos); el tratante las de sus pacientes.
CREATE POLICY solicitudes_epicrisis_select ON solicitudes_epicrisis FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR paciente_id = (SELECT app_paciente_id())
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE') AND es_profesional_de_paciente(paciente_id)));
CREATE POLICY solicitudes_epicrisis_insert ON solicitudes_epicrisis FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'PACIENTE' AND paciente_id = (SELECT app_paciente_id()) AND estado = 'SOLICITADA');

CREATE POLICY mensajes_paciente_acceso_vigente ON mensajes_paciente AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY solicitudes_epicrisis_acceso_vigente ON solicitudes_epicrisis AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));

-- Sin UPDATE ni DELETE: cambios solo via funciones.
GRANT SELECT, INSERT ON mensajes_paciente, solicitudes_epicrisis TO app_user;

REVOKE EXECUTE ON FUNCTION
  proteger_mensaje_paciente(),
  proteger_solicitud_epicrisis(),
  marcar_mensaje_leido(uuid),
  resolver_solicitud_epicrisis(uuid, estado_epicrisis, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  marcar_mensaje_leido(uuid),
  resolver_solicitud_epicrisis(uuid, estado_epicrisis, text)
TO app_user;
