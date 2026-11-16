-- R6 (Vinculos Control): notas de version para el ADMIN del centro. Las
-- escribe el operador de Vinculos (texto plano, sin datos personales) y el
-- agente las entrega al actualizar el silo (U6). Solo ADMIN las lee.
CREATE TABLE notas_version (
  version     text PRIMARY KEY CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$'),
  notas       text NOT NULL CHECK (length(notas) BETWEEN 1 AND 4000),
  recibida_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notas_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_version FORCE ROW LEVEL SECURITY;
CREATE POLICY notas_version_select ON notas_version FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY notas_version_acceso_vigente ON notas_version AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON notas_version TO app_user;

-- POST /api/internal/notas-version. Idempotente: las mismas notas no cambian
-- nada; notas nuevas para la misma version las reemplazan (el operador las
-- corrigio) y vuelven a quedar como recientes.
CREATE FUNCTION registrar_notas_version(p_token text, p_version text, p_notas text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actual text;
  v_notas text := btrim(coalesce(p_notas, ''));
BEGIN
  IF NOT interno_token_valido(p_token) OR app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el plano de control (token del silo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_version IS NULL OR p_version !~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$' OR length(v_notas) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Version o notas con formato invalido' USING ERRCODE = 'check_violation', CONSTRAINT = 'notas_version_formato';
  END IF;
  SELECT notas INTO v_actual FROM notas_version WHERE version = p_version FOR UPDATE;
  IF v_actual = v_notas THEN
    RETURN 'SIN_CAMBIOS';
  END IF;
  INSERT INTO notas_version (version, notas) VALUES (p_version, v_notas)
  ON CONFLICT (version) DO UPDATE SET notas = EXCLUDED.notas, recibida_en = now();
  RETURN 'REGISTRADA';
END;
$$;
REVOKE EXECUTE ON FUNCTION registrar_notas_version(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_notas_version(text, text, text) TO app_user;
