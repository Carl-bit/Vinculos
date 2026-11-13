-- =============================================================================
-- 03b-4.1 (pendientes aprobados, 2026-10-27):
--
-- 1. "Reservando..." ajeno en el calendario del panel (pendiente 4, opcion A).
--    retenciones_en_curso(desde, hasta, profesional) devuelve solo el box (si
--    es presencial) y el rango de los soft-locks activos de OTRAS personas.
--    Categoria C (criterio_clasificacion.md): sin quien retiene, sin
--    profesional y sin paciente. ADMIN/GESTION ven todos (o los del
--    profesional elegido en el selector de equipo); PROFESIONAL/PRACTICANTE
--    solo los que alguien tiene abiertos sobre su propia agenda. El soft-lock
--    sigue siendo solo UX: la fuente de verdad es el EXCLUDE de citas.
--
-- 2. Limpieza de codigos de verificacion (pendiente 18). Job diario:
--    codigos de correo vencidos o usados hace mas de 24 horas y codigos de
--    respaldo usados o anulados hace mas de 90 dias. Los respaldo vigentes no
--    se tocan. Minimizacion de credenciales (categoria A).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Retenciones en curso (categoria C)
-- -----------------------------------------------------------------------------
CREATE FUNCTION retenciones_en_curso(desde timestamptz, hasta timestamptz, p_profesional uuid DEFAULT NULL)
RETURNS TABLE (espacio_id uuid, inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'retenciones_en_curso: solo el equipo con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF desde IS NULL OR hasta IS NULL OR hasta <= desde OR hasta - desde > interval '62 days' THEN
    RAISE EXCEPTION 'Rango invalido (maximo 62 dias)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'retenciones_en_curso_rango';
  END IF;
  RETURN QUERY
  SELECT t.espacio_id, t.inicio, t.fin FROM bloqueos_temporales t
  WHERE t.expira_en > now()
    AND t.usuario_id IS DISTINCT FROM app_usuario_id()
    AND tstzrange(t.inicio, t.fin, '[)') && tstzrange(desde, hasta, '[)')
    AND CASE WHEN app_rol() IN ('ADMIN', 'GESTION') THEN p_profesional IS NULL OR t.profesional_id = p_profesional
             ELSE t.profesional_id = app_usuario_id() END
  ORDER BY t.inicio, t.espacio_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Purga de codigos de verificacion (job, sin contexto de usuario)
-- -----------------------------------------------------------------------------
CREATE FUNCTION purgar_codigos_verificacion() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n int;
  m int;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de limpieza' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM codigos_verificacion
  WHERE coalesce(usado_en, expira_en) < now() - interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM codigos_respaldo
  WHERE coalesce(usado_en, anulado_en) < now() - interval '90 days';
  GET DIAGNOSTICS m = ROW_COUNT;
  RETURN n + m;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Permisos de funciones
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION retenciones_en_curso(timestamptz, timestamptz, uuid), purgar_codigos_verificacion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retenciones_en_curso(timestamptz, timestamptz, uuid), purgar_codigos_verificacion() TO app_user;
