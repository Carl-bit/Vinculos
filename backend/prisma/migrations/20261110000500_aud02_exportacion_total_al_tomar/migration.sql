-- AUD-02: el total de tablas se calcula al tomar la exportacion, no al pedirla.
-- Una programada para la noche puede correr despues de un despliegue que sumo
-- tablas: con el total viejo el avance violaba exportaciones_centro_coherente
-- y los tres intentos fallaban.
CREATE OR REPLACE FUNCTION tomar_exportacion_centro()
RETURNS TABLE (id uuid, solicitada_por_id uuid, clave_publica bytea, sal bytea, intentos int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    UPDATE exportaciones_centro e
    SET estado = 'EN_PROCESO', intentos = e.intentos + 1, iniciada_en = now(), tablas_hechas = 0, fichas_hechas = 0, fichas_total = 0,
        tablas_total = (SELECT count(*) FROM tablas_exportacion_centro()), actualizada_en = now()
    WHERE e.id = (SELECT x.id FROM exportaciones_centro x WHERE x.estado = 'PENDIENTE' AND x.programada_para <= now()
                  ORDER BY x.programada_para LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING e.id, e.solicitada_por_id, e.clave_publica, e.sal, e.intentos;
END;
$$;
