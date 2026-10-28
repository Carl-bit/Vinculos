-- =============================================================================
-- AUD-01 (E2.1; LEG-03, contradiccion C1; decision D5): acceso de soporte del
-- proveedor (Vinculos, Encargado) autorizado por el centro (Responsable).
--
-- El soporte NUNCA ve datos personales ni clinicos:
--   * rol de BD `soporte_vinculos` NOLOGIN, NOBYPASSRLS, sin GRANT sobre
--     ninguna tabla; solo EXECUTE de funciones de diagnostico que devuelven
--     agregados y configuracion (sin nombres, contactos, RUT ni texto clinico);
--   * cada funcion exige una autorizacion vigente de un ADMIN del centro
--     (motivo, alcance, hasta: maximo 72 horas) y deja registro append-only
--     que el ADMIN ve (registro_soporte);
--   * el operador habilita el LOGIN del rol solo mientras dure la
--     autorizacion (ALTER ROLE ... VALID UNTIL; runbook en
--     docs/cumplimiento/soporte.md). Sin autorizacion las funciones dan 42501.
-- Las credenciales de dueño quedan solo para mantencion (migraciones y
-- llaves), documentadas en el runbook.
-- =============================================================================

-- 1. Rol del soporte
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'soporte_vinculos') THEN
    CREATE ROLE soporte_vinculos NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  -- El dueño puede probar el rol (SET ROLE) sin heredar nada de el.
  EXECUTE format('GRANT soporte_vinculos TO %I WITH INHERIT FALSE, SET TRUE', current_user);
END $$;
REVOKE ALL ON SCHEMA public FROM soporte_vinculos;
GRANT USAGE ON SCHEMA public TO soporte_vinculos;

-- 2. Autorizaciones (A): las da y revoca un ADMIN, solo via funcion.
CREATE TYPE "alcance_soporte" AS ENUM ('DIAGNOSTICO', 'CONFIGURACION');

-- CreateTable
CREATE TABLE "autorizaciones_soporte" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "motivo" TEXT NOT NULL,
    "alcance" "alcance_soporte" NOT NULL,
    "desde" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasta" TIMESTAMPTZ(6) NOT NULL,
    "otorgada_por_id" UUID NOT NULL,
    "revocada_en" TIMESTAMPTZ(6),
    "revocada_por_id" UUID,

    CONSTRAINT "autorizaciones_soporte_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "autorizaciones_soporte" ADD CONSTRAINT "autorizaciones_soporte_otorgada_por_id_fkey" FOREIGN KEY ("otorgada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "autorizaciones_soporte" ADD CONSTRAINT "autorizaciones_soporte_revocada_por_id_fkey" FOREIGN KEY ("revocada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE autorizaciones_soporte ADD CONSTRAINT autorizaciones_soporte_valores
  CHECK (char_length(btrim(motivo)) BETWEEN 5 AND 500 AND hasta > desde AND hasta <= desde + interval '72 hours'
         AND (revocada_en IS NULL) = (revocada_por_id IS NULL));
COMMENT ON TABLE autorizaciones_soporte IS
  'Categoria A. Autorizacion del centro (ADMIN) para que el soporte de Vinculos ejecute diagnosticos sin datos personales. Maximo 72 horas.';

CREATE FUNCTION proteger_autorizacion_soporte() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.revocada_en IS NOT NULL
     OR (NEW.id, NEW.motivo, NEW.alcance, NEW.desde, NEW.hasta, NEW.otorgada_por_id)
        IS DISTINCT FROM (OLD.id, OLD.motivo, OLD.alcance, OLD.desde, OLD.hasta, OLD.otorgada_por_id) THEN
    RAISE EXCEPTION 'autorizaciones_soporte es append-only (solo se revoca)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER autorizaciones_soporte_append_only BEFORE UPDATE OR DELETE ON autorizaciones_soporte
  FOR EACH ROW EXECUTE FUNCTION proteger_autorizacion_soporte();

ALTER TABLE autorizaciones_soporte ENABLE ROW LEVEL SECURITY;
ALTER TABLE autorizaciones_soporte FORCE ROW LEVEL SECURITY;
CREATE POLICY autorizaciones_soporte_select ON autorizaciones_soporte FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY autorizaciones_soporte_acceso_vigente ON autorizaciones_soporte AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON autorizaciones_soporte TO app_user;

-- 3. Registro de uso (A, append-only): cada funcion de soporte ejecutada.
-- CreateTable
CREATE TABLE "registro_soporte" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "autorizacion_id" UUID NOT NULL,
    "funcion" TEXT NOT NULL,
    "rol_bd" TEXT NOT NULL,
    "ocurrido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_soporte_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "registro_soporte_ocurrido_en_idx" ON "registro_soporte"("ocurrido_en");
ALTER TABLE "registro_soporte" ADD CONSTRAINT "registro_soporte_autorizacion_id_fkey" FOREIGN KEY ("autorizacion_id") REFERENCES "autorizaciones_soporte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMENT ON TABLE registro_soporte IS
  'Categoria A. Cada diagnostico ejecutado por el soporte de Vinculos, con la autorizacion que lo cubrio. Append-only; ADMIN lee.';
CREATE TRIGGER registro_soporte_append_only BEFORE UPDATE OR DELETE ON registro_soporte
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();
ALTER TABLE registro_soporte ENABLE ROW LEVEL SECURITY;
ALTER TABLE registro_soporte FORCE ROW LEVEL SECURITY;
CREATE POLICY registro_soporte_select ON registro_soporte FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY registro_soporte_acceso_vigente ON registro_soporte AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON registro_soporte TO app_user;

-- 4. ADMIN otorga y revoca.
CREATE FUNCTION otorgar_soporte(p_motivo text, p_alcance alcance_soporte, p_horas integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN autoriza el soporte' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_horas IS NULL OR p_horas NOT BETWEEN 1 AND 72 THEN
    RAISE EXCEPTION 'La autorizacion dura entre 1 y 72 horas'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'autorizaciones_soporte_valores';
  END IF;
  INSERT INTO autorizaciones_soporte (motivo, alcance, hasta, otorgada_por_id)
  VALUES (btrim(p_motivo), p_alcance, now() + make_interval(hours => p_horas), app_usuario_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION revocar_soporte(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN revoca el soporte' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE autorizaciones_soporte SET revocada_en = now(), revocada_por_id = app_usuario_id()
  WHERE id = p_id AND revocada_en IS NULL AND hasta > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La autorizacion no existe o ya no esta vigente' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END;
$$;

-- 5. Funciones del soporte: autorizacion vigente + registro; solo agregados.
CREATE FUNCTION soporte_autorizado(p_alcance alcance_soporte, p_funcion text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM autorizaciones_soporte
  WHERE revocada_en IS NULL AND now() >= desde AND now() < hasta
    AND (alcance = p_alcance OR (p_alcance = 'DIAGNOSTICO' AND alcance = 'CONFIGURACION'))
  ORDER BY hasta DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Sin autorizacion vigente del centro para soporte (%)', p_alcance USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO registro_soporte (autorizacion_id, funcion, rol_bd) VALUES (v_id, p_funcion, session_user);
END;
$$;

-- Estado general del silo: conteos, colas y version. Sin datos personales.
CREATE FUNCTION soporte_resumen() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM soporte_autorizado('DIAGNOSTICO', 'soporte_resumen');
  RETURN jsonb_build_object(
    'migracion', (SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1),
    'usuarios_activos_por_rol', (SELECT coalesce(jsonb_object_agg(rol, n), '{}') FROM (SELECT rol::text, count(*) n FROM usuarios WHERE activo GROUP BY rol) x),
    'citas_7_dias_por_estado', (SELECT coalesce(jsonb_object_agg(estado, n), '{}') FROM (
        SELECT estado::text, count(*) n FROM citas WHERE inicio >= now() AND inicio < now() + interval '7 days' GROUP BY estado) x),
    'notificaciones_7_dias_por_estado', (SELECT coalesce(jsonb_object_agg(estado, n), '{}') FROM (
        SELECT estado::text, count(*) n FROM notificaciones WHERE creada_en >= now() - interval '7 days' GROUP BY estado) x),
    'correos_cuenta_pendientes', (SELECT count(*) FROM correos_cuenta_pendientes),
    'alertas_abiertas_por_tipo', (SELECT coalesce(jsonb_object_agg(tipo, n), '{}') FROM (
        SELECT tipo::text, count(*) n FROM alertas_internas WHERE atendida_en IS NULL GROUP BY tipo) x),
    'ultima_verificacion_llaves', (SELECT max(ocurrido_en) FROM eventos_llaves WHERE tipo = 'VERIFICACION')
  );
END;
$$;

-- Envios fallidos o con reintento: tipo, canal y error generico (sin destinatario ni contenido).
CREATE FUNCTION soporte_notificaciones_con_error(p_dias integer DEFAULT 7)
RETURNS TABLE (tipo text, canal text, estado text, intentos integer, detalle_error text, creada_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM soporte_autorizado('DIAGNOSTICO', 'soporte_notificaciones_con_error');
  RETURN QUERY
  SELECT n.tipo::text, n.canal::text, n.estado::text, n.intentos, n.detalle_error, n.creada_en
  FROM notificaciones n
  WHERE n.creada_en >= now() - make_interval(days => least(greatest(coalesce(p_dias, 7), 1), 30))
    AND (n.estado = 'FALLIDO' OR n.intentos > 0)
  ORDER BY n.creada_en DESC LIMIT 200;
END;
$$;

-- Configuracion del centro (alcance CONFIGURACION): parametros, sin personas.
CREATE FUNCTION soporte_configuracion() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM soporte_autorizado('CONFIGURACION', 'soporte_configuracion');
  RETURN (SELECT to_jsonb(c) - 'rut_centro' FROM configuracion_centro c);
END;
$$;

REVOKE EXECUTE ON FUNCTION otorgar_soporte(text, alcance_soporte, integer), revocar_soporte(uuid),
  soporte_autorizado(alcance_soporte, text), soporte_resumen(), soporte_notificaciones_con_error(integer), soporte_configuracion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION otorgar_soporte(text, alcance_soporte, integer), revocar_soporte(uuid) TO app_user;
GRANT EXECUTE ON FUNCTION soporte_resumen(), soporte_notificaciones_con_error(integer), soporte_configuracion() TO soporte_vinculos;
