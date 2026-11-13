-- =============================================================================
-- R5 (Vinculos Control, 2026-11-13): invitacion del ADMIN inicial de un silo
-- nuevo (paso P9 del job aprovisionar). Reemplaza al seed en silos reales.
--
-- invitar_admin_inicial(): solo el plano de control (token del silo, sin
-- contexto de usuario). Crea la cuenta ADMIN sin contraseña y emite una
-- invitacion de un solo uso (tokens_correo INVITACION, la misma que usa el
-- ADMIN para su equipo; la activa activar_invitacion()).
--   - El silo ya tiene una cuenta madre activada (con contraseña): 55000.
--   - Hay una cuenta madre pendiente con el mismo correo: reemite la
--     invitacion (la anterior queda anulada por emitir_token). Idempotente.
--   - Pendiente con otro correo: 55000 (el operador corrige el manifiesto).
-- Nunca usa ni crea credenciales de dueño en runtime.
-- =============================================================================

CREATE FUNCTION invitar_admin_inicial(p_token text, p_email text, p_nombre text, p_nuevo_id uuid,
                                      p_hash bytea, p_expira timestamptz)
RETURNS TABLE (usuario_id uuid, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_email text := lower(btrim(p_email));
  v_id uuid;
  v_pendiente_email text;
BEGIN
  IF NOT interno_token_valido(p_token) OR app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el plano de control (token del silo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR char_length(btrim(coalesce(p_nombre, ''))) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Correo o nombre del ADMIN inicial invalido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'admin_inicial_datos';
  END IF;
  IF p_expira <= now() OR p_expira > now() + interval '7 days' THEN
    RAISE EXCEPTION 'Vigencia de la invitacion invalida'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'admin_inicial_datos';
  END IF;
  -- Cuenta madre activada (principal o adicional): R5 ya no aplica.
  IF EXISTS (SELECT 1 FROM usuarios u
             WHERE u.activo AND u.cerrada_en IS NULL AND u.password_hash IS NOT NULL
               AND (u.rol = 'ADMIN' OR EXISTS (SELECT 1 FROM roles_adicionales r
                                               WHERE r.usuario_id = u.id AND r.rol = 'ADMIN' AND r.activo))) THEN
    RAISE EXCEPTION 'El centro ya tiene una cuenta madre activa'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT u.id, u.email INTO v_id, v_pendiente_email FROM usuarios u
  WHERE u.rol = 'ADMIN' AND u.activo AND u.cerrada_en IS NULL AND u.password_hash IS NULL
  ORDER BY u.created_at LIMIT 1;
  IF v_id IS NOT NULL AND v_pendiente_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'Ya hay una cuenta madre pendiente con otro correo'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO usuarios (id, email, nombre, rol) VALUES (p_nuevo_id, v_email, btrim(p_nombre), 'ADMIN');
    v_id := p_nuevo_id;
  END IF;
  PERFORM emitir_token('INVITACION', p_hash, p_expira, v_id, NULL, NULL, NULL, NULL, v_email);
  RETURN QUERY SELECT v_id, v_email;
END;
$$;
REVOKE EXECUTE ON FUNCTION invitar_admin_inicial(text, text, text, uuid, bytea, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitar_admin_inicial(text, text, text, uuid, bytea, timestamptz) TO app_user;
