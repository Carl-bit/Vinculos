-- =============================================================================
-- Respaldo de titulos como archivo (2026-11-07, decision del usuario sobre el
-- diseño de Perfil > Formacion). Proceso completo: docs/api/respaldo_titulos.md.
--
-- trayectoria_respaldos (Categoria A: identifica al profesional; puede traer
-- nombre y RUT): el archivo del titulo (PDF, PNG o JPEG) cifrado con la DEK
-- IDENTIFICACION (AAD trayectoria_respaldos:contenido:<id>, id generado por la
-- API). Reglas:
--   - Solo el propio profesional (o practicante) sube, via
--     subir_respaldo_trayectoria (SECURITY DEFINER): sin GRANT de escritura.
--   - Subir un archivo nuevo crea una version (nunca reemplaza ni borra la
--     anterior) y deja el titulo "En revision" (verificado = false).
--   - Leen el propio y ADMIN/GESTION. Nadie borra un respaldo suelto.
--   - Verificar un titulo exige al menos un respaldo (23514 -> 422). El enlace
--     antiguo (documento_respaldo_url) queda como dato historico y ya no cuenta.
--   - Al eliminar el titulo (el propio) o al cerrar la cuenta (cerrar_cuenta,
--     "del profesional no se retiene nada como persona") los respaldos se van
--     con el titulo (ON DELETE CASCADE). Mientras la cuenta exista, aunque este
--     desactivada, se conservan.
-- Corre como dueño (vinculos_owner).
-- =============================================================================

CREATE TABLE "trayectoria_respaldos" (
    "id" UUID NOT NULL,
    "trayectoria_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "tipo_mime" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "subido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trayectoria_respaldos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trayectoria_respaldos_trayectoria_id_idx" ON "trayectoria_respaldos"("trayectoria_id");

ALTER TABLE "trayectoria_respaldos" ADD CONSTRAINT "trayectoria_respaldos_trayectoria_id_fkey"
  FOREIGN KEY ("trayectoria_id") REFERENCES "profesional_trayectoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trayectoria_respaldos" ADD CONSTRAINT "trayectoria_respaldos_profesional_id_fkey"
  FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mismo formato que adjuntos_ficha: contenido cifrado (>= 49 bytes).
ALTER TABLE trayectoria_respaldos ADD CONSTRAINT trayectoria_respaldos_archivo
  CHECK (btrim(nombre_archivo) <> '' AND length(nombre_archivo) <= 200
         AND tipo_mime IN ('application/pdf', 'image/png', 'image/jpeg')
         AND tamano_bytes > 0 AND octet_length(contenido) >= 49);

COMMENT ON TABLE trayectoria_respaldos IS
  'Categoria A. Respaldo (archivo cifrado, IDENTIFICACION) de un titulo de la trayectoria; versionado, sin borrado suelto.';


-- -----------------------------------------------------------------------------
-- Subida (el propio). Devuelve el id; deja el titulo "En revision".
-- -----------------------------------------------------------------------------
CREATE FUNCTION subir_respaldo_trayectoria(p_id uuid, p_trayectoria_id uuid, p_nombre text, p_tipo text,
                                           p_tamano integer, p_contenido bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prof uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'Solo el profesional sube el respaldo de su titulo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT profesional_id INTO v_prof FROM profesional_trayectoria WHERE id = p_trayectoria_id FOR UPDATE;
  IF NOT FOUND OR v_prof IS DISTINCT FROM app_usuario_id() THEN
    RAISE EXCEPTION 'Titulo inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO trayectoria_respaldos (id, trayectoria_id, profesional_id, nombre_archivo, tipo_mime, tamano_bytes, contenido)
  VALUES (p_id, p_trayectoria_id, v_prof, p_nombre, p_tipo, p_tamano, p_contenido);
  -- Archivo nuevo = evidencia nueva: el centro vuelve a revisar.
  UPDATE profesional_trayectoria
  SET verificado = false, verificado_por_id = NULL, verificado_en = NULL, updated_at = now()
  WHERE id = p_trayectoria_id;
  RETURN p_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- Verificar exige respaldo (misma funcion del trigger de 20261009000000, con
-- la regla nueva en la rama ADMIN).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION proteger_trayectoria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF app_rol() = 'ADMIN' THEN
    IF TG_OP = 'INSERT'
       OR (NEW.profesional_id, NEW.tipo, NEW.titulo, NEW.institucion, NEW.anio, NEW.registro_superintendencia, NEW.documento_respaldo_url)
          IS DISTINCT FROM
          (OLD.profesional_id, OLD.tipo, OLD.titulo, OLD.institucion, OLD.anio, OLD.registro_superintendencia, OLD.documento_respaldo_url) THEN
      RAISE EXCEPTION 'ADMIN solo verifica la trayectoria' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.verificado AND NOT OLD.verificado
       AND NOT EXISTS (SELECT 1 FROM trayectoria_respaldos r WHERE r.trayectoria_id = NEW.id) THEN
      RAISE EXCEPTION 'Para verificar el titulo debe tener un respaldo cargado'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'trayectoria_verificar_con_respaldo';
    END IF;
    NEW.verificado_por_id := CASE WHEN NEW.verificado THEN app_usuario_id() END;
    NEW.verificado_en := CASE WHEN NEW.verificado THEN now() END;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.verificado, NEW.verificado_por_id, NEW.verificado_en)
                          IS DISTINCT FROM (OLD.verificado, OLD.verificado_por_id, OLD.verificado_en) THEN
    RAISE EXCEPTION 'Solo ADMIN verifica la trayectoria' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.verificado := false;
  NEW.verificado_por_id := NULL;
  NEW.verificado_en := NULL;
  RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- RLS, politicas y GRANTs.
-- -----------------------------------------------------------------------------
ALTER TABLE trayectoria_respaldos ENABLE ROW LEVEL SECURITY;
ALTER TABLE trayectoria_respaldos FORCE ROW LEVEL SECURITY;

CREATE POLICY trayectoria_respaldos_select ON trayectoria_respaldos FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()));
CREATE POLICY trayectoria_respaldos_acceso_vigente ON trayectoria_respaldos AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));

-- Solo lectura: la escritura pasa por subir_respaldo_trayectoria.
GRANT SELECT ON trayectoria_respaldos TO app_user;

REVOKE EXECUTE ON FUNCTION subir_respaldo_trayectoria(uuid, uuid, text, text, integer, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subir_respaldo_trayectoria(uuid, uuid, text, text, integer, bytea) TO app_user;
