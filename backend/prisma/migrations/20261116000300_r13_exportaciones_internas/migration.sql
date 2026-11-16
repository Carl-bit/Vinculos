-- R13 (Vinculos Control): estado de las exportaciones del centro para el plano
-- de control, sin contenido. Lo lee el agente con el token del silo
-- (GET /api/internal/exportaciones) para:
--   * la salida (S3): fecha, tamano y huella del exporte sin tipearlos;
--   * no actualizar un silo con un exporte pendiente o en proceso.
-- Nunca entrega quien la pidio, la clave publica, la sal ni el archivo.
CREATE FUNCTION exportaciones_internas(p_token text)
RETURNS TABLE (id uuid, estado estado_exportacion_centro, creada_en timestamptz, terminada_en timestamptz,
               vence_en timestamptz, bytes bigint, huella text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT interno_token_valido(p_token) OR app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el plano de control (token del silo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Las 20 mas recientes: alcanza para la salida y para saber si hay una en curso.
  RETURN QUERY
  SELECT e.id, e.estado, e.creada_en, e.terminada_en, e.vence_en, e.bytes, e.huella
  FROM exportaciones_centro e
  ORDER BY e.creada_en DESC
  LIMIT 20;
END;
$$;
REVOKE EXECUTE ON FUNCTION exportaciones_internas(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION exportaciones_internas(text) TO app_user;
