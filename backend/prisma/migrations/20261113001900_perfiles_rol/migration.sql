-- =============================================================================
-- Punto 36 (decision 2026-11-11): perfiles de rol. Nombre y descripcion sobre
-- un rol base fijo (ADMIN, GESTION o PROFESIONAL); por ejemplo "Recepcion"
-- sobre Gestion. Un perfil solo RESTRINGE modulos del rol base (nunca amplia):
-- la RLS sigue por rol base, asi que un error de la API no abre nada nuevo.
-- Sin modulos de finanzas ni WhatsApp (fuera del MVP). Permisos a medida por
-- rol: post-MVP (reescribir la RLS). Las profesiones son tipos de profesional.
--
-- perfiles_rol: Categoria B (catalogo sin datos personales): lo ve el equipo,
-- lo escribe ADMIN; se elimina solo sin personas asignadas (FK RESTRICT).
-- usuario_perfiles: Categoria A (vinculo laboral): ADMIN asigna; un perfil por
-- rol base y solo a quien tiene ese rol (principal o adicional).
-- =============================================================================

CREATE TABLE perfiles_rol (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL UNIQUE CHECK (length(btrim(nombre)) BETWEEN 1 AND 60),
  descripcion text CHECK (descripcion IS NULL OR length(descripcion) <= 300),
  rol_base rol NOT NULL CHECK (rol_base IN ('ADMIN', 'GESTION', 'PROFESIONAL')),
  restricciones modulo_centro[] NOT NULL DEFAULT '{}'
    CONSTRAINT perfiles_rol_restricciones CHECK (restricciones <@ ARRAY['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH']::modulo_centro[]),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE perfiles_rol IS 'Categoria B. Perfil sobre un rol base que solo restringe modulos (punto 36).';

CREATE TABLE usuario_perfiles (
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  perfil_id uuid NOT NULL REFERENCES perfiles_rol(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  asignado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, perfil_id)
);
CREATE INDEX usuario_perfiles_perfil_id_idx ON usuario_perfiles (perfil_id);
COMMENT ON TABLE usuario_perfiles IS 'Categoria A. Perfil asignado a una cuenta del equipo (punto 36).';

-- Solo a quien tiene el rol base, y un perfil por rol base.
CREATE FUNCTION validar_usuario_perfil() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_base rol;
BEGIN
  SELECT rol_base INTO v_base FROM perfiles_rol WHERE id = NEW.perfil_id;
  IF NOT tiene_rol(NEW.usuario_id, v_base) THEN
    RAISE EXCEPTION 'La cuenta no tiene el rol base del perfil'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuario_perfiles_rol_base';
  END IF;
  IF EXISTS (SELECT 1 FROM usuario_perfiles up JOIN perfiles_rol p ON p.id = up.perfil_id
             WHERE up.usuario_id = NEW.usuario_id AND p.rol_base = v_base AND up.perfil_id <> NEW.perfil_id) THEN
    RAISE EXCEPTION 'La cuenta ya tiene un perfil para ese rol'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuario_perfiles_uno_por_rol';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER usuario_perfiles_validar BEFORE INSERT ON usuario_perfiles
  FOR EACH ROW EXECUTE FUNCTION validar_usuario_perfil();

-- El rol base no se cambia con personas asignadas (cambiaria sus permisos por debajo).
CREATE FUNCTION proteger_rol_base_perfil() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rol_base IS DISTINCT FROM OLD.rol_base AND EXISTS (SELECT 1 FROM usuario_perfiles WHERE perfil_id = OLD.id) THEN
    RAISE EXCEPTION 'No se cambia el rol base de un perfil con personas asignadas'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'perfiles_rol_base_en_uso';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER perfiles_rol_proteger BEFORE UPDATE ON perfiles_rol
  FOR EACH ROW EXECUTE FUNCTION proteger_rol_base_perfil();

ALTER TABLE perfiles_rol ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfiles_rol FORCE ROW LEVEL SECURITY;
CREATE POLICY perfiles_rol_select ON perfiles_rol FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'));
CREATE POLICY perfiles_rol_escritura ON perfiles_rol FOR ALL TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY perfiles_rol_acceso_vigente ON perfiles_rol AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT, INSERT, DELETE ON perfiles_rol TO app_user;
GRANT UPDATE (nombre, descripcion, rol_base, restricciones, updated_at) ON perfiles_rol TO app_user;

ALTER TABLE usuario_perfiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_perfiles FORCE ROW LEVEL SECURITY;
CREATE POLICY usuario_perfiles_select ON usuario_perfiles FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN' OR usuario_id = (SELECT app_usuario_id()));
CREATE POLICY usuario_perfiles_escritura ON usuario_perfiles FOR ALL TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY usuario_perfiles_acceso_vigente ON usuario_perfiles AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT, INSERT, DELETE ON usuario_perfiles TO app_user;

-- Modulos que el perfil de la cuenta le restringe en el rol con que entro (sin contexto: lo usa el guard de la API).
CREATE FUNCTION modulos_restringidos(p_usuario_id uuid, p_rol rol) RETURNS modulo_centro[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT m), '{}')
  FROM usuario_perfiles up JOIN perfiles_rol p ON p.id = up.perfil_id
  CROSS JOIN LATERAL unnest(p.restricciones) AS m
  WHERE up.usuario_id = p_usuario_id AND p.rol_base = p_rol
$$;
REVOKE EXECUTE ON FUNCTION modulos_restringidos(uuid, rol) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION modulos_restringidos(uuid, rol) TO app_user;
