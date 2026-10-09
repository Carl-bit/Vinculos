-- =============================================================================
-- 01g: cierre de la fase de BD.
--   - Un ADMIN nunca se desactiva a si mismo (23514), ademas de la regla del
--     ultimo ADMIN (01f).
--   - tipos_sesion: aprobado_por -> revisado_por (registra aprobaciones y
--     rechazos) + revisado_en.
--   - citas.enlace_online pasa a cifrado (bytea, categoria CLINICO). citas
--     conserva su DEFAULT de id: el enlace se genera despues de crear la cita
--     (02, con expiracion), cuando el id (parte del AAD) ya existe.
-- Corre como dueño (vinculos_owner).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Guardia: enlace_online pasa a bytea (la BD no tiene llaves para convertir).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM citas WHERE enlace_online IS NOT NULL) THEN
    RAISE EXCEPTION '01g cifra citas.enlace_online: requiere la columna vacia (desarrollo: infra/scripts/reset_dev.sh)';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- 1. DDL (identico al que genera Prisma para el schema).
-- -----------------------------------------------------------------------------

ALTER TABLE "tipos_sesion" RENAME COLUMN "aprobado_por_id" TO "revisado_por_id";
ALTER TABLE "tipos_sesion" RENAME CONSTRAINT "tipos_sesion_aprobado_por_id_fkey" TO "tipos_sesion_revisado_por_id_fkey";
ALTER TABLE "tipos_sesion" ADD COLUMN "revisado_en" TIMESTAMPTZ(6);
UPDATE "tipos_sesion" SET "revisado_en" = "updated_at" WHERE "estado" <> 'PROPUESTO';

ALTER TABLE "citas" ALTER COLUMN "enlace_online" SET DATA TYPE BYTEA USING NULL;


-- -----------------------------------------------------------------------------
-- 2. Reglas que Prisma no expresa.
-- -----------------------------------------------------------------------------

ALTER TABLE tipos_sesion DROP CONSTRAINT tipos_sesion_valido;
ALTER TABLE tipos_sesion ADD CONSTRAINT tipos_sesion_valido
  CHECK (btrim(nombre) <> ''
         AND (estado = 'PROPUESTO') = (revisado_por_id IS NULL)
         AND (estado = 'PROPUESTO') = (revisado_en IS NULL));

ALTER TABLE citas ADD CONSTRAINT citas_cifrado CHECK (octet_length(enlace_online) >= 49);


-- -----------------------------------------------------------------------------
-- 3. Triggers.
-- -----------------------------------------------------------------------------

-- tipos_sesion: revisado_por/revisado_en = quien y cuando aprobo o rechazo.
CREATE OR REPLACE FUNCTION proteger_tipo_sesion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF app_rol() IS DISTINCT FROM 'ADMIN' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Solo ADMIN modifica tipos de sesion' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.estado := 'PROPUESTO';
    NEW.revisado_por_id := NULL;
    NEW.revisado_en := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.revisado_por_id := CASE WHEN NEW.estado = 'PROPUESTO' THEN NULL ELSE app_usuario_id() END;
    NEW.revisado_en := CASE WHEN NEW.estado = 'PROPUESTO' THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END;
$$;

-- usuarios (reemplaza 01f): ademas, un ADMIN nunca se desactiva a si mismo
-- (lo desactiva otro ADMIN o su baja). Sin contexto (dueño, jobs) no aplica.
CREATE OR REPLACE FUNCTION proteger_ciclo_cuenta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Cuenta cerrada: no se modifica (quien vuelve recibe cuenta nueva)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.activo AND NOT NEW.activo THEN
    IF OLD.rol = 'ADMIN' AND OLD.id = app_usuario_id() THEN
      RAISE EXCEPTION 'Un ADMIN no se desactiva a si mismo'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_admin_no_se_desactiva';
    END IF;
    NEW.desactivado_en := now();
  ELSIF NOT OLD.activo AND NEW.activo THEN
    NEW.desactivado_en := NULL;
  END IF;
  IF OLD.rol = 'ADMIN' AND OLD.activo AND (NOT NEW.activo OR NEW.rol <> 'ADMIN') THEN
    PERFORM 1 FROM configuracion_centro FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE rol = 'ADMIN' AND activo AND id <> OLD.id) THEN
      RAISE EXCEPTION 'No se puede desactivar al ultimo ADMIN activo'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_ultimo_admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
