-- =============================================================================
-- AUD-01 (E2.4; BRE-03): deteccion de accesos indebidos.
--
-- * intentos_login_fallidos (A): solo el HMAC del identificador (correo o
--   RUT) y la hora; nunca el valor. Sin GRANT: solo via funcion, desde el
--   login (sin contexto). Se purgan a los 30 dias.
-- * detectar_anomalias() (job cada hora, sin contexto): alerta interna
--   (sin nombres) cuando
--     - una cuenta leyo, descargo o exporto datos de mas de 40 pacientes
--       distintos en la ultima hora (ACCESO_ANOMALO, referencia = la cuenta);
--     - un mismo identificador tuvo 10 o mas ingresos fallidos en la ultima
--       hora (LOGIN_FALLIDO_REPETIDO, referencia derivada del HMAC).
--   Una alerta abierta por referencia (indice de alertas_internas).
-- =============================================================================

-- CreateTable
CREATE TABLE "intentos_login_fallidos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identificador_hmac" BYTEA NOT NULL,
    "ocurrido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intentos_login_fallidos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "intentos_login_fallidos_ocurrido_en_idx" ON "intentos_login_fallidos"("ocurrido_en");
COMMENT ON TABLE intentos_login_fallidos IS
  'Categoria A. Ingresos fallidos: HMAC del identificador (nunca el correo o RUT) y hora. Sin GRANT; purga a los 30 dias.';
ALTER TABLE intentos_login_fallidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE intentos_login_fallidos FORCE ROW LEVEL SECURITY;

CREATE FUNCTION registrar_login_fallido(p_identificador_hmac bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_usuario_id() IS NOT NULL OR p_identificador_hmac IS NULL OR octet_length(p_identificador_hmac) < 16 THEN
    RAISE EXCEPTION 'Solo el login registra intentos fallidos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO intentos_login_fallidos (identificador_hmac) VALUES (p_identificador_hmac);
END;
$$;

CREATE FUNCTION detectar_anomalias() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n int := 0;
  m int;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de deteccion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO alertas_internas (tipo, referencia_id, detalle)
  SELECT 'ACCESO_ANOMALO', a.usuario_id,
         format('Una cuenta (%s) accedio a datos de %s pacientes distintos en la ultima hora. Revisar en Auditoria de accesos.',
                a.rol, count(DISTINCT a.paciente_id))
  FROM accesos_ficha a
  WHERE a.ocurrido_en >= now() - interval '1 hour' AND a.accion IN ('LECTURA', 'DESCARGA', 'EXPORTACION')
  GROUP BY a.usuario_id, a.rol
  HAVING count(DISTINCT a.paciente_id) > 40
  ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
  GET DIAGNOSTICS m = ROW_COUNT;
  n := n + m;
  INSERT INTO alertas_internas (tipo, referencia_id, detalle)
  SELECT 'LOGIN_FALLIDO_REPETIDO', md5(i.identificador_hmac)::uuid,
         format('%s ingresos fallidos con un mismo correo o RUT en la ultima hora.', count(*))
  FROM intentos_login_fallidos i
  WHERE i.ocurrido_en >= now() - interval '1 hour'
  GROUP BY i.identificador_hmac
  HAVING count(*) >= 10
  ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
  GET DIAGNOSTICS m = ROW_COUNT;
  n := n + m;
  DELETE FROM intentos_login_fallidos WHERE ocurrido_en < now() - interval '30 days';
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION registrar_login_fallido(bytea), detectar_anomalias() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_login_fallido(bytea), detectar_anomalias() TO app_user;
