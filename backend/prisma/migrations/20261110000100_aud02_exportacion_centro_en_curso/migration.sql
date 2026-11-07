-- =============================================================================
-- AUD-02: "ya hay una exportacion en curso" con mensaje propio.
--
-- El indice parcial exportaciones_centro_una_en_proceso sigue siendo la
-- garantia ante dos pedidos simultaneos, pero Postgres no informa el nombre
-- de un indice de expresion en el error (solo "Key ((true))=(t) already
-- exists"). La funcion revisa antes y levanta el error con su restriccion,
-- que la API traduce a 409 con el texto de sqlstate.ts.
-- =============================================================================

CREATE OR REPLACE FUNCTION iniciar_exportacion_centro() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  PERFORM exigir_admin_exportacion();
  IF EXISTS (SELECT 1 FROM exportaciones_centro WHERE estado = 'EN_PROCESO') THEN
    RAISE EXCEPTION 'Ya hay una exportacion del centro en curso'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'exportaciones_centro_una_en_proceso';
  END IF;
  INSERT INTO exportaciones_centro (solicitada_por_id, tablas_total)
  VALUES (app_usuario_id(), (SELECT count(*) FROM tablas_exportacion_centro()))
  RETURNING id INTO v;
  RETURN v;
END;
$$;
