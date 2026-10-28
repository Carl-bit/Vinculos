-- =============================================================================
-- AUD-01 (E1.5; CENS-S3, ARCOP-03): trazabilidad de ediciones y descargas.
--
-- 1. accesos_ficha.detalle: texto corto con los NOMBRES de los campos que
--    cambiaron (nunca valores). Acciones nuevas en uso: DESCARGA (copia o
--    archivo bajado) y EXPORTACION (salida estructurada de datos).
-- 2. La edicion de datos personales de un paciente o de su adulto
--    responsable queda en accesos_ficha (ESCRITURA) por trigger, venga de la
--    API o de una funcion, con el usuario y el rol del contexto. Sin contexto
--    (jobs del sistema) no se registra: el job ya deja su propia traza.
-- 3. registro_exportaciones (A): descargas y exportaciones que no son de un
--    paciente (PDF del reporte de cobros y de liquidaciones; mas adelante la
--    exportacion del centro). Append-only; solo ADMIN lo lee.
-- =============================================================================

-- 1. Detalle (campos, nunca valores)
ALTER TABLE accesos_ficha ADD COLUMN "detalle" TEXT;
ALTER TABLE accesos_ficha ADD CONSTRAINT accesos_ficha_detalle_largo CHECK (detalle IS NULL OR char_length(detalle) <= 500);

-- 2. Edicion de datos personales: quien, cuando, con que rol y que campos.
CREATE FUNCTION auditar_edicion_persona() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_usuario uuid := app_usuario_id();
  v_campos text[];
  v_paciente uuid := (to_jsonb(NEW) ->> CASE TG_TABLE_NAME WHEN 'pacientes' THEN 'id' ELSE 'paciente_id' END)::uuid;
BEGIN
  IF v_usuario IS NULL OR app_rol() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Columnas que cambiaron (sin las tecnicas); solo los nombres.
  SELECT array_agg(n.key ORDER BY n.key) INTO v_campos
  FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
  WHERE n.value IS DISTINCT FROM o.value AND n.key NOT IN ('updated_at', 'created_at', 'rut_hmac');
  IF v_campos IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion, detalle)
  VALUES (v_usuario, app_rol()::rol, v_paciente,
          TG_TABLE_NAME, 'ESCRITURA', left('campos: ' || array_to_string(v_campos, ', '), 500));
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION auditar_edicion_persona() FROM PUBLIC;
CREATE TRIGGER pacientes_auditar_edicion AFTER UPDATE ON pacientes
  FOR EACH ROW EXECUTE FUNCTION auditar_edicion_persona();
CREATE TRIGGER adultos_responsables_auditar_edicion AFTER UPDATE ON adultos_responsables
  FOR EACH ROW EXECUTE FUNCTION auditar_edicion_persona();

-- 3. Exportaciones sin paciente (A)
-- CreateTable
CREATE TABLE "registro_exportaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "rol" "rol" NOT NULL,
    "recurso" TEXT NOT NULL,
    "referencia_id" UUID,
    "detalle" TEXT,
    "ocurrido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_exportaciones_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "registro_exportaciones_ocurrido_en_idx" ON "registro_exportaciones"("ocurrido_en");
CREATE INDEX "registro_exportaciones_usuario_id_ocurrido_en_idx" ON "registro_exportaciones"("usuario_id", "ocurrido_en");
ALTER TABLE "registro_exportaciones" ADD CONSTRAINT "registro_exportaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE registro_exportaciones ADD CONSTRAINT registro_exportaciones_valores
  CHECK (btrim(recurso) <> '' AND char_length(recurso) <= 80 AND (detalle IS NULL OR char_length(detalle) <= 500));
COMMENT ON TABLE registro_exportaciones IS
  'Categoria A. Descargas y exportaciones sin paciente (reportes, liquidaciones, exportacion del centro). Append-only; solo ADMIN lee.';

CREATE TRIGGER registro_exportaciones_append_only BEFORE UPDATE OR DELETE ON registro_exportaciones
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();

ALTER TABLE registro_exportaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE registro_exportaciones FORCE ROW LEVEL SECURITY;
-- Como accesos_ficha: cada uno inserta lo suyo con su rol; solo ADMIN lee.
CREATE POLICY registro_exportaciones_insert ON registro_exportaciones FOR INSERT TO app_user
  WITH CHECK (usuario_id = (SELECT app_usuario_id()) AND rol::text = (SELECT app_rol()));
CREATE POLICY registro_exportaciones_select ON registro_exportaciones FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY registro_exportaciones_acceso_vigente ON registro_exportaciones AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT, INSERT ON registro_exportaciones TO app_user;
