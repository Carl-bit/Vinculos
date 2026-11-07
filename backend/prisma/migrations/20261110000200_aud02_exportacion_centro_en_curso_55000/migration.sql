-- =============================================================================
-- AUD-02: el aviso "ya hay una exportacion en curso" con SQLSTATE 55000
-- (object_not_in_prerequisite_state -> 409). Con 23505 Prisma reemplaza el
-- texto por "Unique constraint failed" y la API no puede dar el mensaje propio.
-- El indice parcial sigue cubriendo dos pedidos simultaneos (23505 generico).
-- =============================================================================

CREATE OR REPLACE FUNCTION iniciar_exportacion_centro() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  PERFORM exigir_admin_exportacion();
  IF EXISTS (SELECT 1 FROM exportaciones_centro WHERE estado = 'EN_PROCESO') THEN
    RAISE EXCEPTION 'Ya hay una exportacion del centro en curso'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'exportaciones_centro_una_en_proceso';
  END IF;
  INSERT INTO exportaciones_centro (solicitada_por_id, tablas_total)
  VALUES (app_usuario_id(), (SELECT count(*) FROM tablas_exportacion_centro()))
  RETURNING id INTO v;
  RETURN v;
END;
$$;
