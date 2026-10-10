-- =============================================================================
-- 02a: infraestructura de la API.
--   - sesiones (A): refresh tokens con rotacion y deteccion de reuso. Solo se
--     guarda el SHA-256 del token. Sin GRANT a app_user: el login y el refresh
--     corren sin contexto y usan crear_sesion / rotar_sesion / revocar_sesion.
--     Un trigger en usuarios revoca las sesiones al cambiar rol, activo,
--     contraseña o cierre, o al acortar la expiracion de un practicante
--     (requisitos_02_apis.md 1: "invalidar sus sesiones").
--   - alertas_internas (A): alertas para ADMIN que generan los jobs (baja que
--     dejaria al centro sin ADMIN, fallo de canario). Escritura solo via
--     funciones; ADMIN lee y marca atendida con atender_alerta().
-- Corre como dueño (vinculos_owner).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. DDL (identico al que genera Prisma para el schema).
-- -----------------------------------------------------------------------------

CREATE TYPE "tipo_alerta" AS ENUM ('BAJA_SIN_ADMIN', 'FALLO_CANARIO');

CREATE TABLE "sesiones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "familia_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "rol" "rol" NOT NULL,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "usada_en" TIMESTAMPTZ(6),
    "revocada_en" TIMESTAMPTZ(6),
    "motivo_revocacion" TEXT,

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "alertas_internas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "tipo_alerta" NOT NULL,
    "referencia_id" UUID,
    "detalle" TEXT NOT NULL,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atendida_en" TIMESTAMPTZ(6),
    "atendida_por_id" UUID,

    CONSTRAINT "alertas_internas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sesiones_token_hash_key" ON "sesiones"("token_hash");
CREATE INDEX "sesiones_usuario_id_idx" ON "sesiones"("usuario_id");
CREATE INDEX "sesiones_familia_id_idx" ON "sesiones"("familia_id");
CREATE INDEX "alertas_internas_creada_en_idx" ON "alertas_internas"("creada_en");

ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "alertas_internas" ADD CONSTRAINT "alertas_internas_atendida_por_id_fkey" FOREIGN KEY ("atendida_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- 2. Reglas que Prisma no expresa.
-- -----------------------------------------------------------------------------

-- SHA-256 = 32 bytes: nunca el token en claro.
ALTER TABLE sesiones ADD CONSTRAINT sesiones_valida
  CHECK (octet_length(token_hash) = 32 AND expira_en > creada_en);

ALTER TABLE alertas_internas ADD CONSTRAINT alertas_internas_coherente
  CHECK (btrim(detalle) <> '' AND (atendida_en IS NULL) = (atendida_por_id IS NULL));
-- Una alerta abierta por (tipo, referencia): el job puede correr cada hora sin duplicar.
CREATE UNIQUE INDEX alertas_internas_una_abierta
  ON alertas_internas (tipo, referencia_id) WHERE atendida_en IS NULL;


-- -----------------------------------------------------------------------------
-- 3. Sesiones (sin contexto: login y refresh).
-- -----------------------------------------------------------------------------

-- Interno: misma regla que acceso_vigente() pero para un usuario dado.
CREATE FUNCTION cuenta_habilitada(p_usuario_id uuid, p_rol text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = p_usuario_id AND u.activo AND u.cerrada_en IS NULL AND u.rol::text = p_rol
      AND (u.rol::text <> 'PRACTICANTE'
           OR (u.fecha_expiracion_acceso > now() AND supervisor_vigente(u.id) IS NOT NULL))
  )
$$;

-- La API la llama despues de verificar la contraseña (bcrypt). Abre una
-- familia nueva. Cuenta no habilitada -> 42501.
CREATE FUNCTION crear_sesion(p_usuario_id uuid, p_rol rol, p_token_hash bytea, p_expira timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_familia uuid := gen_random_uuid();
BEGIN
  IF NOT cuenta_habilitada(p_usuario_id, p_rol::text) THEN
    RAISE EXCEPTION 'Cuenta sin acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO sesiones (usuario_id, familia_id, token_hash, rol, expira_en)
  VALUES (p_usuario_id, v_familia, p_token_hash, p_rol, p_expira);
  RETURN v_familia;
END;
$$;

-- Rotacion: el token vigente se marca usado y nace el siguiente de la misma
-- familia. Reusar un token usado o revocado = robo probable: se revoca la
-- familia. Token vencido o cuenta sin acceso: se revoca la familia. En esos
-- casos devuelve 0 filas (no RAISE: la revocacion debe quedar).
CREATE FUNCTION rotar_sesion(p_token_hash bytea, p_nuevo_hash bytea, p_expira timestamptz)
RETURNS TABLE (usuario_id uuid, rol rol)
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
  INSERT INTO sesiones (usuario_id, familia_id, token_hash, rol, expira_en)
  VALUES (s.usuario_id, s.familia_id, p_nuevo_hash, s.rol, p_expira);
  RETURN QUERY SELECT s.usuario_id, s.rol;
END;
$$;

-- Logout: revoca la familia del token (quien tiene el token puede cerrarla).
CREATE FUNCTION revocar_sesion(p_token_hash bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE sesiones SET revocada_en = now(), motivo_revocacion = 'LOGOUT'
  WHERE revocada_en IS NULL
    AND familia_id = (SELECT familia_id FROM sesiones WHERE token_hash = p_token_hash);
END;
$$;

-- Cambios de cuenta que invalidan las sesiones (incluye procesar_bajas y
-- cerrar_cuenta, que pasan por UPDATE usuarios).
CREATE FUNCTION revocar_sesiones_por_cambio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE sesiones SET revocada_en = now(), motivo_revocacion = 'CAMBIO_CUENTA'
  WHERE usuario_id = NEW.id AND revocada_en IS NULL;
  RETURN NULL;
END;
$$;

CREATE TRIGGER usuarios_revoca_sesiones AFTER UPDATE ON usuarios
  FOR EACH ROW
  WHEN (OLD.rol IS DISTINCT FROM NEW.rol
        OR (OLD.activo AND NOT NEW.activo)
        OR OLD.password_hash IS DISTINCT FROM NEW.password_hash
        OR NEW.cerrada_en IS NOT NULL
        OR NEW.fecha_expiracion_acceso < OLD.fecha_expiracion_acceso)
  EXECUTE FUNCTION revocar_sesiones_por_cambio();


-- -----------------------------------------------------------------------------
-- 4. Alertas internas.
-- -----------------------------------------------------------------------------

-- Job sin contexto, despues de procesar_bajas(): bajas cumplidas que no se
-- procesaron porque el usuario es el ultimo ADMIN activo (la baja sigue
-- pendiente y se reintenta). Una alerta abierta por baja. Devuelve cuantas
-- bajas estan en esa situacion (aunque la alerta ya existiera).
CREATE FUNCTION alertar_bajas_sin_admin() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total int;
BEGIN
  WITH bloqueadas AS (
    SELECT b.id FROM bajas b JOIN usuarios u ON u.id = b.usuario_id
    WHERE b.procesada_en IS NULL AND b.fecha_efectiva <= now() AND u.rol = 'ADMIN' AND u.activo
      AND NOT EXISTS (SELECT 1 FROM usuarios o WHERE o.rol = 'ADMIN' AND o.activo AND o.id <> u.id)
  ), alertas AS (
    INSERT INTO alertas_internas (tipo, referencia_id, detalle)
    SELECT 'BAJA_SIN_ADMIN', x.id, 'Baja cumplida sin procesar: dejaria al centro sin ADMIN activo. Crear otro ADMIN.'
    FROM bloqueadas x
    ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING
  )
  SELECT count(*) INTO v_total FROM bloqueadas;
  RETURN v_total;
END;
$$;

-- Job de canarios sin contexto (la API ya registro FALLO_CANARIO en
-- eventos_llaves). El detalle nunca lleva llaves ni datos.
CREATE FUNCTION alertar_fallo_canario(p_detalle text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO alertas_internas (tipo, detalle)
  VALUES ('FALLO_CANARIO', left(coalesce(nullif(btrim(p_detalle), ''), 'Fallo de canario'), 500));
END;
$$;

-- ADMIN marca una alerta como atendida (una vez).
CREATE FUNCTION atender_alerta(p_alerta_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN atiende alertas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE alertas_internas SET atendida_en = now(), atendida_por_id = app_usuario_id()
  WHERE id = p_alerta_id AND atendida_en IS NULL;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM alertas_internas WHERE id = p_alerta_id) THEN
      RAISE EXCEPTION 'La alerta ya fue atendida' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    RAISE EXCEPTION 'Alerta inexistente' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

-- Append-only salvo atender (solo la funcion, que es del dueño). Nunca DELETE.
CREATE FUNCTION proteger_alerta_interna() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.atendida_en IS NOT NULL
     OR (NEW.id, NEW.tipo, NEW.referencia_id, NEW.detalle, NEW.creada_en)
        IS DISTINCT FROM (OLD.id, OLD.tipo, OLD.referencia_id, OLD.detalle, OLD.creada_en) THEN
    RAISE EXCEPTION 'alertas_internas: solo se marca atendida una vez' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER alertas_internas_append_only BEFORE UPDATE OR DELETE ON alertas_internas
  FOR EACH ROW EXECUTE FUNCTION proteger_alerta_interna();


-- -----------------------------------------------------------------------------
-- 5. RLS, politicas y GRANTs.
-- -----------------------------------------------------------------------------

ALTER TABLE sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas_internas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesiones FORCE ROW LEVEL SECURITY;
ALTER TABLE alertas_internas FORCE ROW LEVEL SECURITY;

-- sesiones: sin politicas ni GRANT (como llaves_datos). Solo funciones.
-- alertas_internas: solo ADMIN lee.
CREATE POLICY alertas_internas_select ON alertas_internas FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY alertas_internas_acceso_vigente ON alertas_internas AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));

GRANT SELECT ON alertas_internas TO app_user;

REVOKE EXECUTE ON FUNCTION
  cuenta_habilitada(uuid, text),
  crear_sesion(uuid, rol, bytea, timestamptz),
  rotar_sesion(bytea, bytea, timestamptz),
  revocar_sesion(bytea),
  revocar_sesiones_por_cambio(),
  alertar_bajas_sin_admin(),
  alertar_fallo_canario(text),
  atender_alerta(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  crear_sesion(uuid, rol, bytea, timestamptz),
  rotar_sesion(bytea, bytea, timestamptz),
  revocar_sesion(bytea),
  alertar_bajas_sin_admin(),
  alertar_fallo_canario(text),
  atender_alerta(uuid)
TO app_user;


-- -----------------------------------------------------------------------------
-- 6. evoluciones.created_at: default transaction_timestamp() (= now(), mismo
-- valor que el CURRENT_TIMESTAMP anterior) y en el schema dbgenerated: Prisma
-- deja de enviar la columna. Con @default(now()) el motor de
-- Prisma enviaba la hora del cliente y la politica evolucion_intervenciones_insert
-- (created_at = now() de la transaccion) rechazaba las intervenciones.
-- -----------------------------------------------------------------------------

ALTER TABLE "evoluciones" ALTER COLUMN "created_at" SET DEFAULT transaction_timestamp();
