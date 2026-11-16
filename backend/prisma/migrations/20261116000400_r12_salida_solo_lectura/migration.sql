-- R12 (Vinculos Control, salida S2): el silo pasa a solo lectura mientras el
-- centro sale. Siguen el ingreso, la lectura, la contrasena y el segundo
-- factor propios, los exportes (del centro y del paciente) y los derechos de
-- los pacientes (Ley 21.719: el centro sigue siendo responsable y los
-- responde). Lo demas responde 423 (SoloLecturaGuard de la API).
-- Lo activa y lo quita solo el plano de control (token del silo, sin contexto
-- de usuario). Cada cambio queda en eventos_salida (solo se agrega).
ALTER TABLE identidad_silo
  ADD COLUMN solo_lectura_desde timestamptz,
  ADD COLUMN fecha_corte date;

CREATE TABLE eventos_salida (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solo_lectura boolean NOT NULL,
  fecha_corte date,
  ocurrido_en timestamptz NOT NULL DEFAULT now()
);
-- Solo se agrega: nadie lo edita ni lo borra (tampoco el dueno por error).
CREATE FUNCTION eventos_salida_inmutables() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'eventos_salida solo se agrega' USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER eventos_salida_inmutables BEFORE UPDATE OR DELETE ON eventos_salida
  FOR EACH ROW EXECUTE FUNCTION eventos_salida_inmutables();
REVOKE ALL ON eventos_salida FROM PUBLIC;
-- Como toda tabla de la app (caso 46): RLS + FORCE, sin politicas (solo la escribe salida_interna como dueno).
ALTER TABLE eventos_salida ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_salida FORCE ROW LEVEL SECURITY;

-- Lectura para la API (guard y aviso en la UI): sin token ni datos personales.
CREATE FUNCTION estado_salida_silo()
RETURNS TABLE (solo_lectura boolean, desde timestamptz, fecha_corte date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.solo_lectura_desde IS NOT NULL, i.solo_lectura_desde, i.fecha_corte FROM identidad_silo i
  UNION ALL
  SELECT false, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM identidad_silo);
$$;
REVOKE EXECUTE ON FUNCTION estado_salida_silo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estado_salida_silo() TO app_user;

-- POST /api/internal/salida. Idempotente: repetir el mismo estado no cambia
-- nada ni agrega eventos (salvo que cambie la fecha de corte).
CREATE FUNCTION salida_interna(p_token text, p_solo_lectura boolean, p_fecha_corte date)
RETURNS TABLE (resultado text, solo_lectura boolean, desde timestamptz, fecha_corte date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v identidad_silo%ROWTYPE;
BEGIN
  IF NOT interno_token_valido(p_token) OR app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el plano de control (token del silo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_solo_lectura IS NULL OR (p_solo_lectura AND p_fecha_corte IS NULL) OR (NOT p_solo_lectura AND p_fecha_corte IS NOT NULL) THEN
    RAISE EXCEPTION 'Solo lectura exige fecha de corte; quitarla no lleva fecha'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'salida_interna_formato';
  END IF;
  SELECT * INTO v FROM identidad_silo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El silo no tiene identidad (migrate sin identidad_silo.js)' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF (v.solo_lectura_desde IS NOT NULL) = p_solo_lectura AND v.fecha_corte IS NOT DISTINCT FROM p_fecha_corte THEN
    RETURN QUERY SELECT 'SIN_CAMBIOS'::text, p_solo_lectura, v.solo_lectura_desde, v.fecha_corte;
    RETURN;
  END IF;
  UPDATE identidad_silo
     SET solo_lectura_desde = CASE WHEN p_solo_lectura THEN coalesce(v.solo_lectura_desde, now()) END,
         fecha_corte = p_fecha_corte
  RETURNING identidad_silo.solo_lectura_desde INTO v.solo_lectura_desde;
  INSERT INTO eventos_salida (solo_lectura, fecha_corte) VALUES (p_solo_lectura, p_fecha_corte);
  RETURN QUERY SELECT 'APLICADA'::text, p_solo_lectura, v.solo_lectura_desde, p_fecha_corte;
END;
$$;
REVOKE EXECUTE ON FUNCTION salida_interna(text, boolean, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION salida_interna(text, boolean, date) TO app_user;
