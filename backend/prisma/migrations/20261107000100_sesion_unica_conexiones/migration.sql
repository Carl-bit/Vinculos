-- =============================================================================
-- Sesion unica y registro de conexiones (2026-11-07, decision del usuario:
-- version web, una sola sesion por usuario; las conexiones quedan registradas
-- y el integrante las ve en Mi cuenta > Seguridad). Proceso completo:
-- docs/api/sesion_unica_conexiones.md.
--
--   - crear_sesion revoca toda otra sesion abierta del usuario
--     (motivo NUEVA_SESION) antes de abrir la nueva. Un candado por usuario
--     evita que dos logins simultaneos queden ambos abiertos.
--   - sesiones.dispositivo: resumen del navegador ("Chrome en Windows") que
--     arma la API desde el User-Agent. Sin IP ni User-Agent completo.
--   - sesion_vigente(familia): la API la evalua en cada request junto con
--     acceso_vigente(); con la sesion revocada el access token deja de servir
--     de inmediato (antes seguia vivo hasta vencer, JWT_ACCESO_MINUTOS).
--   - mis_conexiones(): historial de conexiones del usuario del contexto
--     (una fila por familia de sesiones), derivado de sesiones: inicio,
--     ultima actividad, fin y motivo. Solo el propio.
--   - motivo_fin_sesion(token): por que se cerro una sesion (solo quien tiene
--     el token); el front avisa "se inicio sesion en otro dispositivo".
-- rotar_sesion y cambiar_rol_sesion devuelven ademas la familia (va al JWT) y
-- copian el dispositivo. sesiones sigue sin GRANT directo (Categoria A).
-- Corre como dueño (vinculos_owner).
-- =============================================================================

ALTER TABLE sesiones ADD COLUMN dispositivo TEXT;
ALTER TABLE sesiones ADD CONSTRAINT sesiones_dispositivo
  CHECK (dispositivo IS NULL OR (btrim(dispositivo) <> '' AND length(dispositivo) <= 80));


-- -----------------------------------------------------------------------------
-- Login: sesion unica.
-- -----------------------------------------------------------------------------
DROP FUNCTION crear_sesion(uuid, rol, bytea, timestamptz);
CREATE FUNCTION crear_sesion(p_usuario_id uuid, p_rol rol, p_token_hash bytea, p_expira timestamptz,
                             p_dispositivo text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_familia uuid := gen_random_uuid();
BEGIN
  IF NOT cuenta_habilitada(p_usuario_id, p_rol::text) THEN
    RAISE EXCEPTION 'Cuenta sin acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Un login a la vez por usuario: el segundo espera y revoca al primero.
  PERFORM pg_advisory_xact_lock(hashtextextended('sesion:' || p_usuario_id::text, 0));
  UPDATE sesiones SET revocada_en = now(), motivo_revocacion = 'NUEVA_SESION'
  WHERE usuario_id = p_usuario_id AND revocada_en IS NULL;
  INSERT INTO sesiones (usuario_id, familia_id, token_hash, rol, expira_en, dispositivo)
  VALUES (p_usuario_id, v_familia, p_token_hash, p_rol, p_expira, left(nullif(btrim(p_dispositivo), ''), 80));
  RETURN v_familia;
END;
$$;


-- -----------------------------------------------------------------------------
-- Rotacion (misma regla de 20261012000000) + familia y dispositivo.
-- -----------------------------------------------------------------------------
DROP FUNCTION rotar_sesion(bytea, bytea, timestamptz);
CREATE FUNCTION rotar_sesion(p_token_hash bytea, p_nuevo_hash bytea, p_expira timestamptz)
RETURNS TABLE (usuario_id uuid, rol rol, familia_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  s sesiones%ROWTYPE;
BEGIN
  SELECT * INTO s FROM sesiones WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF s.usada_en IS NOT NULL OR s.revocada_en IS NOT NULL THEN
    UPDATE sesiones SET revocada_en = now(), motivo_revocacion = 'REUTILIZACION'
    WHERE familia_id = s.familia_id AND revocada_en IS NULL;
    RETURN;
  END IF;
  IF s.expira_en <= now() OR NOT cuenta_habilitada(s.usuario_id, s.rol::text) THEN
    UPDATE sesiones SET revocada_en = now(), motivo_revocacion = 'NO_VIGENTE'
    WHERE familia_id = s.familia_id AND revocada_en IS NULL;
    RETURN;
  END IF;

  UPDATE sesiones SET usada_en = now() WHERE id = s.id;
  INSERT INTO sesiones (usuario_id, familia_id, token_hash, rol, expira_en, dispositivo)
  VALUES (s.usuario_id, s.familia_id, p_nuevo_hash, s.rol, p_expira, s.dispositivo);
  RETURN QUERY SELECT s.usuario_id, s.rol, s.familia_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- Cambio de rol (misma regla de 20261018000100) + familia nueva y dispositivo.
-- -----------------------------------------------------------------------------
DROP FUNCTION cambiar_rol_sesion(bytea, bytea, rol, timestamptz);
CREATE FUNCTION cambiar_rol_sesion(p_token_hash bytea, p_nuevo_hash bytea, p_rol rol, p_expira timestamptz)
RETURNS TABLE (usuario_id uuid, familia_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  s sesiones%ROWTYPE;
  v_familia uuid := gen_random_uuid();
BEGIN
  SELECT * INTO s FROM sesiones WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR s.usada_en IS NOT NULL OR s.revocada_en IS NOT NULL OR s.expira_en <= now()
     OR NOT cuenta_habilitada(s.usuario_id, p_rol::text) THEN
    RETURN;
  END IF;
  UPDATE sesiones SET revocada_en = now(), motivo_revocacion = 'CAMBIO_ROL'
  WHERE familia_id = s.familia_id AND revocada_en IS NULL;
  INSERT INTO sesiones (usuario_id, familia_id, token_hash, rol, expira_en, dispositivo)
  VALUES (s.usuario_id, v_familia, p_nuevo_hash, p_rol, p_expira, s.dispositivo);
  RETURN QUERY SELECT s.usuario_id, v_familia;
END;
$$;


-- -----------------------------------------------------------------------------
-- Por request: la familia del access token sigue abierta.
-- -----------------------------------------------------------------------------
CREATE FUNCTION sesion_vigente(p_familia uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM sesiones
    WHERE familia_id = p_familia AND usuario_id = app_usuario_id()
      AND revocada_en IS NULL AND usada_en IS NULL AND expira_en > now()
  )
$$;

-- Motivo del cierre de la sesion de este token (NULL si sigue abierta o no existe).
CREATE FUNCTION motivo_fin_sesion(p_token_hash bytea) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT motivo_revocacion FROM sesiones WHERE token_hash = p_token_hash
$$;


-- -----------------------------------------------------------------------------
-- Historial de conexiones del propio usuario (una fila por familia).
--   activa: la familia tiene un token sin usar, sin revocar y sin vencer.
--   fin/motivo: revocacion (LOGOUT, NUEVA_SESION, CAMBIO_ROL, CAMBIO_CUENTA,
--   REUTILIZACION, NO_VIGENTE) o, si nadie la revoco, el vencimiento por
--   inactividad (INACTIVIDAD, fin = expira_en del ultimo token).
-- -----------------------------------------------------------------------------
CREATE FUNCTION mis_conexiones(p_limite integer DEFAULT 30)
RETURNS TABLE (familia_id uuid, rol rol, dispositivo text, inicio timestamptz, ultima_actividad timestamptz,
               fin timestamptz, motivo text, activa boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'mis_conexiones: requiere acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH f AS (
    SELECT s.familia_id,
           (array_agg(s.rol ORDER BY s.creada_en))[1] AS rol,
           (array_agg(s.dispositivo ORDER BY s.creada_en))[1] AS dispositivo,
           min(s.creada_en) AS inicio,
           max(coalesce(s.usada_en, s.creada_en)) AS ultima_actividad,
           max(s.revocada_en) AS revocada_en,
           max(s.motivo_revocacion) AS motivo,
           max(s.expira_en) AS expira_en,
           bool_or(s.revocada_en IS NULL AND s.usada_en IS NULL AND s.expira_en > now()) AS activa
    FROM sesiones s
    WHERE s.usuario_id = app_usuario_id()
    GROUP BY s.familia_id
  )
  SELECT f.familia_id, f.rol, f.dispositivo, f.inicio, f.ultima_actividad,
         CASE WHEN f.activa THEN NULL ELSE coalesce(f.revocada_en, f.expira_en) END,
         CASE WHEN f.activa THEN NULL ELSE coalesce(f.motivo, 'INACTIVIDAD') END,
         f.activa
  FROM f
  ORDER BY f.inicio DESC
  LIMIT least(greatest(coalesce(p_limite, 30), 1), 100);
END;
$$;


-- -----------------------------------------------------------------------------
-- GRANTs (las funciones recreadas pierden los anteriores).
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  crear_sesion(uuid, rol, bytea, timestamptz, text),
  rotar_sesion(bytea, bytea, timestamptz),
  cambiar_rol_sesion(bytea, bytea, rol, timestamptz),
  sesion_vigente(uuid),
  motivo_fin_sesion(bytea),
  mis_conexiones(integer)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  crear_sesion(uuid, rol, bytea, timestamptz, text),
  rotar_sesion(bytea, bytea, timestamptz),
  cambiar_rol_sesion(bytea, bytea, rol, timestamptz),
  sesion_vigente(uuid),
  motivo_fin_sesion(bytea),
  mis_conexiones(integer)
TO app_user;
