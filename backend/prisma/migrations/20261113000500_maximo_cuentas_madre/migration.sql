-- =============================================================================
-- Correcciones 2026-11-11 (tercera vuelta): maximo de cuentas madre por centro.
--
-- Regla del centro (configuracion_centro.max_cuentas_madre, 2 por defecto):
-- cuantas cuentas activas tienen el rol ADMIN, como principal o adicional. El
-- resto del equipo combina gestion y profesional (el practicante sigue
-- exclusivo). Quitar roles sigue siendo solo de la cuenta madre y nunca sobre
-- si misma (quitar_rol_adicional), asi nadie se quita roles.
--
-- Se valida en los tres puntos que suman o cuentan una cuenta madre: alta o
-- reactivacion de un ADMIN principal, un ADMIN adicional y bajar el maximo.
-- Se serializa con FOR UPDATE sobre configuracion_centro (dos altas a la vez
-- no pasan las dos el conteo).
-- =============================================================================

-- NULL = sin limite (solo lo deja el operador o las BD de prueba; la API exige 1 a 10).
ALTER TABLE configuracion_centro ADD COLUMN max_cuentas_madre smallint DEFAULT 2;
ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_max_cuentas_madre
  CHECK (max_cuentas_madre BETWEEN 1 AND 10);
GRANT UPDATE (max_cuentas_madre) ON configuracion_centro TO app_user;

-- Cuentas activas con rol ADMIN (principal o adicional activo).
CREATE FUNCTION cuentas_madre_activas() RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM usuarios u
  WHERE u.activo AND u.cerrada_en IS NULL
    AND (u.rol = 'ADMIN' OR EXISTS (SELECT 1 FROM roles_adicionales ra WHERE ra.usuario_id = u.id AND ra.rol = 'ADMIN' AND ra.activo))
$$;
REVOKE EXECUTE ON FUNCTION cuentas_madre_activas() FROM PUBLIC;

-- Un centro que ya tiene mas cuentas madre que el maximo por defecto no queda invalido.
UPDATE configuracion_centro SET max_cuentas_madre = greatest(2, least(10, cuentas_madre_activas()));

CREATE FUNCTION validar_maximo_cuentas_madre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_max int;
BEGIN
  SELECT max_cuentas_madre INTO v_max FROM configuracion_centro FOR UPDATE;
  IF v_max IS NOT NULL AND cuentas_madre_activas() > v_max THEN
    RAISE EXCEPTION 'El centro ya tiene el maximo de cuentas madre (%)', v_max
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_maximo_cuentas_madre';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER usuarios_maximo_cuentas_madre
  AFTER INSERT OR UPDATE OF rol, activo, cerrada_en ON usuarios
  FOR EACH ROW WHEN (NEW.rol = 'ADMIN' AND NEW.activo AND NEW.cerrada_en IS NULL)
  EXECUTE FUNCTION validar_maximo_cuentas_madre();

CREATE TRIGGER roles_adicionales_maximo_cuentas_madre
  AFTER INSERT OR UPDATE OF activo ON roles_adicionales
  FOR EACH ROW WHEN (NEW.rol = 'ADMIN' AND NEW.activo)
  EXECUTE FUNCTION validar_maximo_cuentas_madre();

-- Bajar el maximo por debajo de las cuentas madre activas: primero se quita el rol.
CREATE FUNCTION validar_baja_maximo_cuentas_madre() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.max_cuentas_madre < cuentas_madre_activas() THEN
    RAISE EXCEPTION 'Hay mas cuentas madre activas que el nuevo maximo: quita el rol a alguna antes'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'configuracion_centro_cuentas_madre_activas';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER configuracion_centro_maximo_cuentas_madre
  BEFORE UPDATE OF max_cuentas_madre ON configuracion_centro
  FOR EACH ROW WHEN (NEW.max_cuentas_madre < OLD.max_cuentas_madre OR (OLD.max_cuentas_madre IS NULL AND NEW.max_cuentas_madre IS NOT NULL))
  EXECUTE FUNCTION validar_baja_maximo_cuentas_madre();
