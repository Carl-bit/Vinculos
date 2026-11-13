-- =============================================================================
-- sesiones_espacios (C): horas de box tomadas por sesiones, sin quien.
--
-- ocupacion_espacios() entrega el bloque apartado completo: "Por box" se veia
-- como un solo bloque enorme. Esta funcion entrega cada sesion presencial del
-- box para que la grilla se lea igual que "Mi horario". Solo espacio, inicio y
-- fin: ni paciente ni profesional. Mismos estados que el EXCLUDE del box.
-- =============================================================================

CREATE FUNCTION sesiones_espacios(desde timestamptz, hasta timestamptz)
RETURNS TABLE (espacio_id uuid, inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'sesiones_espacios: requiere equipo con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF desde IS NULL OR hasta IS NULL OR hasta <= desde OR hasta - desde > interval '62 days' THEN
    RAISE EXCEPTION 'Rango invalido (maximo 62 dias)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'disponibilidad_publica_rango';
  END IF;
  RETURN QUERY
  SELECT c.espacio_id, c.inicio, c.fin FROM citas c
  WHERE c.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA') AND c.espacio_id IS NOT NULL
    AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(desde, hasta, '[)')
  ORDER BY c.espacio_id, c.inicio;
END;
$$;

REVOKE EXECUTE ON FUNCTION sesiones_espacios(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sesiones_espacios(timestamptz, timestamptz) TO app_user;
