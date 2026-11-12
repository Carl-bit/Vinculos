-- Punto 36: tiene_rol recibe el rol como texto (20261113001900 le pasaba el tipo rol).
CREATE OR REPLACE FUNCTION validar_usuario_perfil() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_base rol;
BEGIN
  SELECT rol_base INTO v_base FROM perfiles_rol WHERE id = NEW.perfil_id;
  IF NOT tiene_rol(NEW.usuario_id, v_base::text) THEN
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
