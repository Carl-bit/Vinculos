-- =============================================================================
-- AUD-01 (E2.2; LEG-06, LEG-01; decision D6): terminos de servicio y anexo de
-- tratamiento de datos (DPA) entre el centro (Responsable) y Vinculos
-- (Encargado), versionados en el silo (cada centro puede tener los suyos).
--
-- * Los publica el operador de Vinculos como dueño (docs/cumplimiento/
--   contrato_centro.md); el ADMIN del centro no los redacta ni los edita:
--   politicas_insert ya no le deja esos tipos.
-- * Solo ADMIN los lee (no son publicos: politica_vigente() no los entrega
--   a nadie mas).
-- * aceptaciones_contrato (A): version (politica), fecha y ADMIN que acepto.
--   Solo via aceptar_contrato(); contratos_pendientes() dice que version
--   vigente falta aceptar (el panel lo muestra antes de seguir).
-- =============================================================================

-- 1. Politicas: el ADMIN publica las del centro, no el contrato con Vinculos.
DROP POLICY politicas_insert ON politicas;
CREATE POLICY politicas_insert ON politicas FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'ADMIN' AND tipo NOT IN ('TERMINOS_SERVICIO', 'DPA'));
DROP POLICY politicas_select ON politicas;
CREATE POLICY politicas_select ON politicas FOR SELECT TO app_user
  USING (CASE
           WHEN tipo = 'PROTOCOLO_EQUIPO' THEN (SELECT app_rol()) IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
           WHEN tipo IN ('TERMINOS_SERVICIO', 'DPA') THEN (SELECT app_rol()) = 'ADMIN'
           ELSE true
         END);

CREATE OR REPLACE FUNCTION politica_vigente(p_tipo tipo_politica)
RETURNS TABLE (id uuid, version integer, texto text, vigente_desde timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.version, p.texto, p.vigente_desde FROM politicas p
  WHERE p.tipo = p_tipo
    AND (p_tipo <> 'PROTOCOLO_EQUIPO' OR coalesce(app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'), false))
    AND (p_tipo NOT IN ('TERMINOS_SERVICIO', 'DPA') OR coalesce(app_rol() = 'ADMIN', false))
  ORDER BY p.version DESC LIMIT 1
$$;

-- 2. Aceptaciones del centro (A)
-- CreateTable
CREATE TABLE "aceptaciones_contrato" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "politica_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "aceptada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aceptaciones_contrato_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "aceptaciones_contrato_politica_id_usuario_id_key" ON "aceptaciones_contrato"("politica_id", "usuario_id");
ALTER TABLE "aceptaciones_contrato" ADD CONSTRAINT "aceptaciones_contrato_politica_id_fkey" FOREIGN KEY ("politica_id") REFERENCES "politicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aceptaciones_contrato" ADD CONSTRAINT "aceptaciones_contrato_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMENT ON TABLE aceptaciones_contrato IS
  'Categoria A. Aceptacion de terminos de servicio y DPA por un ADMIN del centro (version, fecha, quien). Append-only; solo via aceptar_contrato().';
CREATE TRIGGER aceptaciones_contrato_append_only BEFORE UPDATE OR DELETE ON aceptaciones_contrato
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();
ALTER TABLE aceptaciones_contrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE aceptaciones_contrato FORCE ROW LEVEL SECURITY;
CREATE POLICY aceptaciones_contrato_select ON aceptaciones_contrato FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY aceptaciones_contrato_acceso_vigente ON aceptaciones_contrato AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON aceptaciones_contrato TO app_user;

-- Acepta la version VIGENTE del tipo (idempotente por ADMIN y version).
CREATE FUNCTION aceptar_contrato(p_tipo tipo_politica) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_politica uuid;
  v_aceptada timestamptz;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Acepta el contrato un ADMIN del centro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_tipo NOT IN ('TERMINOS_SERVICIO', 'DPA') THEN
    RAISE EXCEPTION 'Solo terminos de servicio o DPA' USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_contrato_tipo';
  END IF;
  SELECT id INTO v_politica FROM politica_vigente(p_tipo);
  IF v_politica IS NULL THEN
    RAISE EXCEPTION 'No hay una version publicada para aceptar' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO aceptaciones_contrato (politica_id, usuario_id) VALUES (v_politica, app_usuario_id())
  ON CONFLICT (politica_id, usuario_id) DO NOTHING;
  SELECT aceptada_en INTO v_aceptada FROM aceptaciones_contrato WHERE politica_id = v_politica AND usuario_id = app_usuario_id();
  RETURN v_aceptada;
END;
$$;

-- Versiones vigentes que el centro aun no acepta (ningun ADMIN). Solo ADMIN.
CREATE FUNCTION contratos_pendientes()
RETURNS TABLE (tipo tipo_politica, politica_id uuid, version integer, vigente_desde timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT t.tipo, v.id, v.version, v.vigente_desde
  FROM unnest(ARRAY['TERMINOS_SERVICIO', 'DPA']::tipo_politica[]) t(tipo)
  CROSS JOIN LATERAL politica_vigente(t.tipo) v
  WHERE NOT EXISTS (SELECT 1 FROM aceptaciones_contrato a WHERE a.politica_id = v.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION aceptar_contrato(tipo_politica), contratos_pendientes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aceptar_contrato(tipo_politica), contratos_pendientes() TO app_user;
