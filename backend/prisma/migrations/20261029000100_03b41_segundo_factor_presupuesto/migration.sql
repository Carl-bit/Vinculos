-- =============================================================================
-- 03b-4.1: verificacion en dos pasos por correo, codigos de respaldo, login
-- por RUT de toda cuenta con RUT registrado y preferencia de pago en el match.
--
-- Segundo factor (decision del usuario, 2026-10-21): obligatorio para todo el
-- equipo (ADMIN, GESTION, PROFESIONAL, PRACTICANTE, como rol principal o
-- adicional) y opcional para pacientes y adultos responsables. Metodo activo:
-- codigo de 6 digitos por correo (vence en 10 minutos, un solo uso, 5
-- intentos, reenvio con 60 segundos de espera). Al activarlo se entregan 10
-- codigos de respaldo de un solo uso. El TOTP (03a) queda en el codigo y en
-- la BD, desactivado por configuracion de la API (TOTP_HABILITADO).
--
-- Categorias (criterio_clasificacion.md): codigos_verificacion y
-- codigos_respaldo son A (credenciales de una persona). Sin GRANT para
-- app_user: solo funciones SECURITY DEFINER, como tokens_correo. Guardan
-- HMAC-SHA256 (llave del silo, en la API) del codigo, nunca el codigo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tablas y columnas
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN "verificacion_correo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "codigos_verificacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "codigo_hash" BYTEA NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "intentos" SMALLINT NOT NULL DEFAULT 0,
    "usado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_verificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigos_respaldo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "codigo_hash" BYTEA NOT NULL,
    "usado_en" TIMESTAMPTZ(6),
    "anulado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_respaldo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "codigos_verificacion_usuario_id_creado_en_idx" ON "codigos_verificacion"("usuario_id", "creado_en");

-- CreateIndex
CREATE INDEX "codigos_respaldo_usuario_id_idx" ON "codigos_respaldo"("usuario_id");

-- AddForeignKey
ALTER TABLE "codigos_verificacion" ADD CONSTRAINT "codigos_verificacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_respaldo" ADD CONSTRAINT "codigos_respaldo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- codigos_verificacion (A) y codigos_respaldo (A): sin GRANT (RLS sin politicas).
ALTER TABLE codigos_verificacion ADD CONSTRAINT codigos_verificacion_coherente
  CHECK (octet_length(codigo_hash) = 32 AND expira_en > creado_en AND intentos BETWEEN 0 AND 5);
ALTER TABLE codigos_respaldo ADD CONSTRAINT codigos_respaldo_coherente
  CHECK (octet_length(codigo_hash) = 32 AND (usado_en IS NULL OR anulado_en IS NULL));
ALTER TABLE codigos_verificacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE codigos_verificacion FORCE ROW LEVEL SECURITY;
ALTER TABLE codigos_respaldo ENABLE ROW LEVEL SECURITY;
ALTER TABLE codigos_respaldo FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. Segundo factor
-- -----------------------------------------------------------------------------
-- Equipo = rol principal o adicional activo de ADMIN, GESTION, PROFESIONAL o PRACTICANTE.
CREATE FUNCTION es_cuenta_equipo(p_usuario_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = p_usuario_id
                   AND u.rol::text IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'))
      OR EXISTS (SELECT 1 FROM roles_adicionales r WHERE r.usuario_id = p_usuario_id AND r.activo)
$$;

-- Cambia el tipo de retorno: requerido = cuenta del equipo (antes: solo clinica);
-- correo = verificacion por correo ya activada (el equipo la activa en su
-- primer ingreso: hasta entonces la API la trata como enrolamiento).
DROP FUNCTION segundo_factor(uuid);
CREATE FUNCTION segundo_factor(p_usuario_id uuid)
RETURNS TABLE (secreto bytea, activo boolean, requerido boolean, email text, correo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.totp_secreto, u.totp_activo, es_cuenta_equipo(u.id), u.email, u.verificacion_correo
  FROM usuarios u WHERE u.id = p_usuario_id
$$;

-- Codigo nuevo por correo (sin contexto, tras validar la contraseña). Anula
-- los anteriores sin usar. p_espera: el reenvio exige que el ultimo tenga al
-- menos esos segundos (55000 si no). Devuelve el correo de destino.
CREATE FUNCTION emitir_codigo_verificacion(p_usuario_id uuid, p_hash bytea, p_espera_segundos int) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM usuarios WHERE id = p_usuario_id AND activo AND cerrada_en IS NULL FOR UPDATE;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Cuenta sin acceso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM codigos_verificacion WHERE usuario_id = p_usuario_id
               AND creado_en > now() - make_interval(secs => greatest(p_espera_segundos, 0))) THEN
    RAISE EXCEPTION 'Espera un momento antes de pedir otro codigo' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- Anulado = intentos agotados (el CHECK exige expira_en > creado_en).
  UPDATE codigos_verificacion SET intentos = 5 WHERE usuario_id = p_usuario_id AND usado_en IS NULL AND expira_en > now();
  INSERT INTO codigos_verificacion (usuario_id, codigo_hash, expira_en) VALUES (p_usuario_id, p_hash, now() + interval '10 minutes');
  RETURN v_email;
END;
$$;

-- Valida contra el codigo vigente (el ultimo emitido, sin usar y sin vencer).
-- Un error suma un intento; al quinto el codigo deja de servir. No lanza
-- excepcion al fallar: el intento tiene que quedar registrado.
CREATE FUNCTION verificar_codigo_verificacion(p_usuario_id uuid, p_hash bytea) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c codigos_verificacion%ROWTYPE;
BEGIN
  SELECT * INTO c FROM codigos_verificacion
  WHERE usuario_id = p_usuario_id AND usado_en IS NULL AND expira_en > now() AND intentos < 5
  ORDER BY creado_en DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF c.codigo_hash = p_hash THEN
    UPDATE codigos_verificacion SET usado_en = now() WHERE id = c.id;
    RETURN true;
  END IF;
  UPDATE codigos_verificacion SET intentos = intentos + 1 WHERE id = c.id;
  RETURN false;
END;
$$;

-- Codigo de respaldo (un solo uso).
CREATE FUNCTION usar_codigo_respaldo(p_usuario_id uuid, p_hash bytea) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH usado AS (
    UPDATE codigos_respaldo SET usado_en = now()
    WHERE usuario_id = p_usuario_id AND codigo_hash = p_hash AND usado_en IS NULL AND anulado_en IS NULL
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM usado)
$$;

-- 10 codigos nuevos (anula los anteriores sin usar). Sin contexto: la API la
-- llama al activar el segundo factor en el login (tras validar el codigo);
-- con contexto, solo para la propia cuenta.
CREATE FUNCTION generar_codigos_respaldo(p_usuario_id uuid, p_hashes bytea[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(cardinality(p_hashes), 0) <> 10 THEN
    RAISE EXCEPTION 'Se generan 10 codigos de respaldo' USING ERRCODE = 'check_violation';
  END IF;
  IF app_usuario_id() IS NOT NULL AND (NOT acceso_vigente() OR app_usuario_id() IS DISTINCT FROM p_usuario_id) THEN
    RAISE EXCEPTION 'Solo para la propia cuenta' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE codigos_respaldo SET anulado_en = now() WHERE usuario_id = p_usuario_id AND usado_en IS NULL AND anulado_en IS NULL;
  INSERT INTO codigos_respaldo (usuario_id, codigo_hash) SELECT p_usuario_id, h FROM unnest(p_hashes) AS h;
END;
$$;

-- Primera verificacion por correo del equipo (sin contexto): marca la cuenta
-- (desde ahi ya no es "enrolamiento") y devuelve true si era la primera vez.
CREATE FUNCTION activar_verificacion_correo(p_usuario_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH a AS (UPDATE usuarios SET verificacion_correo = true WHERE id = p_usuario_id AND NOT verificacion_correo RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM a)
$$;

-- Paciente o adulto responsable: activa o desactiva la suya. El equipo no la desactiva.
CREATE FUNCTION cambiar_verificacion_correo(p_activa boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'Sin acceso' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT p_activa AND es_cuenta_equipo(app_usuario_id()) THEN
    RAISE EXCEPTION 'La verificacion en dos pasos es obligatoria para el equipo' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'segundo_factor_obligatorio_equipo';
  END IF;
  UPDATE usuarios SET verificacion_correo = p_activa WHERE id = app_usuario_id();
  IF NOT p_activa THEN
    UPDATE codigos_respaldo SET anulado_en = now() WHERE usuario_id = app_usuario_id() AND usado_en IS NULL AND anulado_en IS NULL;
  END IF;
END;
$$;

-- Estado para "Seguridad" (propia cuenta).
CREATE FUNCTION estado_segundo_factor() RETURNS TABLE (activo boolean, obligatorio boolean, codigos_respaldo_restantes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.verificacion_correo OR es_cuenta_equipo(u.id), es_cuenta_equipo(u.id),
         (SELECT count(*)::int FROM codigos_respaldo c WHERE c.usuario_id = u.id AND c.usado_en IS NULL AND c.anulado_en IS NULL)
  FROM usuarios u WHERE u.id = app_usuario_id() AND acceso_vigente()
$$;

-- -----------------------------------------------------------------------------
-- 3. Login por RUT (03b-4.1): ademas del paciente, el adulto responsable con
--    cuenta y el integrante del equipo con RUT en sus datos privados. Puede
--    devolver mas de una fila (la misma persona con dos cuentas): la API
--    entra con la que coincide la contraseña.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION credenciales_login_rut(p_rut_hmac bytea)
RETURNS TABLE (id uuid, password_hash text, rol rol, activo boolean, fecha_expiracion_acceso timestamptz, paciente_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.password_hash, u.rol, u.activo, u.fecha_expiracion_acceso, u.paciente_id
  FROM usuarios u JOIN pacientes p ON p.id = u.paciente_id
  WHERE p.rut_hmac = p_rut_hmac AND u.rol = 'PACIENTE'
  UNION
  SELECT u.id, u.password_hash, u.rol, u.activo, u.fecha_expiracion_acceso, u.paciente_id
  FROM usuarios u JOIN adultos_responsables a ON a.usuario_id = u.id
  WHERE a.rut_hmac = p_rut_hmac AND u.rol = 'RESPONSABLE'
  UNION
  SELECT u.id, u.password_hash, u.rol, u.activo, u.fecha_expiracion_acceso, u.paciente_id
  FROM usuarios u JOIN profesional_datos_privados d ON d.usuario_id = u.id
  WHERE d.rut_hmac = p_rut_hmac
$$;

-- -----------------------------------------------------------------------------
-- 4. Match: preferencia de pago por sesion (rangos editables por ADMIN en la
--    configuracion del match: la etiqueta y el tope en CLP de cada opcion).
--    No puntua ni filtra: ordena por tramos de precio. No se guarda (C-17).
-- -----------------------------------------------------------------------------
ALTER TABLE match_opciones ADD CONSTRAINT match_opciones_presupuesto
  CHECK (criterio IS DISTINCT FROM 'PRESUPUESTO' OR (objetivo ~ '^[0-9]{4,7}$' AND peso = 0 AND NOT estricto));

INSERT INTO match_preguntas (clave, texto, ayuda, tipo, orden, max_selecciones, obligatoria)
VALUES ('presupuesto', '¿Cuánto prefieres pagar por sesión?',
        'Te mostramos primero a quienes están dentro de tu preferencia y después, por tramos, al resto del equipo. No se guarda.',
        'UNICA', 9, 1, true)
ON CONFLICT (clave) DO NOTHING;
INSERT INTO match_opciones (pregunta_id, valor, etiqueta, nota, orden, criterio, objetivo, peso, estricto)
SELECT q.id, o.valor, o.etiqueta, NULL, o.orden, o.criterio::criterio_match, o.objetivo, 0, false
FROM match_preguntas q JOIN (VALUES
  ('hasta_25000', 'Hasta $25.000', 1, 'PRESUPUESTO', '25000'),
  ('hasta_35000', 'Hasta $35.000', 2, 'PRESUPUESTO', '35000'),
  ('hasta_45000', 'Hasta $45.000', 3, 'PRESUPUESTO', '45000'),
  ('hasta_60000', 'Hasta $60.000', 4, 'PRESUPUESTO', '60000'),
  ('no_decir', 'Prefiero no decirlo', 5, NULL, NULL)
) AS o(valor, etiqueta, orden, criterio, objetivo) ON q.clave = 'presupuesto'
ON CONFLICT (pregunta_id, valor) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Permisos de funciones
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  es_cuenta_equipo(uuid), segundo_factor(uuid), emitir_codigo_verificacion(uuid, bytea, int),
  verificar_codigo_verificacion(uuid, bytea), usar_codigo_respaldo(uuid, bytea), generar_codigos_respaldo(uuid, bytea[]),
  activar_verificacion_correo(uuid), cambiar_verificacion_correo(boolean), estado_segundo_factor()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  segundo_factor(uuid), emitir_codigo_verificacion(uuid, bytea, int),
  verificar_codigo_verificacion(uuid, bytea), usar_codigo_respaldo(uuid, bytea), generar_codigos_respaldo(uuid, bytea[]),
  activar_verificacion_correo(uuid), cambiar_verificacion_correo(boolean), estado_segundo_factor()
TO app_user;
