-- =============================================================================
-- AUD-02 (decision del 2026-11-06): exportacion del centro programada en la
-- ventana nocturna, con opcion urgente, y a prueba de reinicios.
--
-- Antes la llave derivada de la clave del ADMIN vivia solo en la memoria del
-- proceso: un reinicio a mitad dejaba la exportacion FALLIDA y no se podia
-- programar para la noche. Ahora la clave deriva un par X25519: la BD guarda
-- solo la llave PUBLICA y la sal. El job cifra con la publica (ECDH con un par
-- efimero por archivo) y puede correr a cualquier hora o reintentarse; abrir
-- el archivo exige la clave (la privada nunca sale del navegador del centro
-- ni se guarda). Formato de archivo v2 (infra/scripts/exportacion/descifrar.mjs).
--
-- Estados: PENDIENTE (programada o esperando reintento) -> EN_PROCESO ->
-- LISTA | FALLIDA (tras 3 intentos) -> DESCARGADA | VENCIDA.
-- =============================================================================

-- Las EN_PROCESO de la version anterior no tienen llave publica: no se pueden retomar.
UPDATE exportaciones_centro
SET estado = 'FALLIDA', motivo_fallo = 'Se interrumpio por una actualizacion del sistema. Vuelve a pedirla.', terminada_en = now(), actualizada_en = now()
WHERE estado = 'EN_PROCESO';

ALTER TABLE exportaciones_centro
  ADD COLUMN clave_publica BYTEA,
  ADD COLUMN sal BYTEA,
  ADD COLUMN urgente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN programada_para TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN intentos INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN iniciada_en TIMESTAMPTZ(6);
ALTER TABLE exportaciones_centro ALTER COLUMN estado SET DEFAULT 'PENDIENTE';

ALTER TABLE exportaciones_centro DROP CONSTRAINT exportaciones_centro_coherente;
ALTER TABLE exportaciones_centro ADD CONSTRAINT exportaciones_centro_coherente
  CHECK (tablas_hechas BETWEEN 0 AND tablas_total AND fichas_hechas BETWEEN 0 AND fichas_total
         AND intentos BETWEEN 0 AND 3
         AND (huella IS NULL OR huella ~ '^[0-9a-f]{64}$')
         AND (motivo_fallo IS NULL OR length(motivo_fallo) <= 300)
         AND (clave_publica IS NULL OR octet_length(clave_publica) = 32)
         AND (sal IS NULL OR octet_length(sal) = 16)
         AND (estado NOT IN ('PENDIENTE', 'EN_PROCESO') OR (terminada_en IS NULL AND clave_publica IS NOT NULL AND sal IS NOT NULL))
         AND (estado <> 'EN_PROCESO' OR iniciada_en IS NOT NULL)
         AND (estado NOT IN ('LISTA', 'DESCARGADA', 'VENCIDA') OR (bytes IS NOT NULL AND huella IS NOT NULL AND vence_en IS NOT NULL AND terminada_en IS NOT NULL))
         AND (estado <> 'FALLIDA' OR (motivo_fallo IS NOT NULL AND terminada_en IS NOT NULL))
         AND (estado <> 'DESCARGADA' OR descargada_en IS NOT NULL));

-- Una sola pedida y sin terminar por centro (programada, en espera o en curso).
DROP INDEX exportaciones_centro_una_en_proceso;
CREATE UNIQUE INDEX exportaciones_centro_una_en_proceso ON exportaciones_centro ((true)) WHERE estado IN ('PENDIENTE', 'EN_PROCESO');
CREATE INDEX exportaciones_centro_pendientes ON exportaciones_centro (programada_para) WHERE estado = 'PENDIENTE';

-- Ventana nocturna: una hora antes de la apertura del proximo dia con
-- atencion (horario_centro, hora de Chile), al menos tres horas despues del
-- cierre del dia anterior y dentro de 24 h. Sin horario o sin apertura en ese
-- plazo (fin de semana): la proxima 03:00 de Chile.
CREATE FUNCTION proxima_ventana_exportacion(p_desde timestamptz DEFAULT now()) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoy date := (p_desde AT TIME ZONE 'America/Santiago')::date;
  v_dia date;
  v_apertura int;
  v_cierre_previo int;
  v_t timestamptz;
BEGIN
  FOR k IN 0..2 LOOP
    v_dia := v_hoy + k;
    SELECT min(inicio_min) INTO v_apertura FROM horario_centro WHERE dia_semana = extract(isodow FROM v_dia);
    CONTINUE WHEN v_apertura IS NULL;
    v_t := (v_dia + make_interval(mins => v_apertura - 60)) AT TIME ZONE 'America/Santiago';
    SELECT max(fin_min) INTO v_cierre_previo FROM horario_centro WHERE dia_semana = extract(isodow FROM v_dia - 1);
    IF v_t > p_desde AND v_t <= p_desde + interval '24 hours'
       AND (v_cierre_previo IS NULL OR v_t >= ((v_dia - 1) + make_interval(mins => v_cierre_previo + 180)) AT TIME ZONE 'America/Santiago') THEN
      RETURN v_t;
    END IF;
  END LOOP;
  v_t := (v_hoy + time '03:00') AT TIME ZONE 'America/Santiago';
  IF v_t <= p_desde THEN
    v_t := ((v_hoy + 1) + time '03:00') AT TIME ZONE 'America/Santiago';
  END IF;
  RETURN v_t;
END;
$$;

-- ADMIN: pide la exportacion con su llave publica (la clave no llega a la BD).
DROP FUNCTION iniciar_exportacion_centro();
CREATE FUNCTION iniciar_exportacion_centro(p_clave_publica bytea, p_sal bytea, p_urgente boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  PERFORM exigir_admin_exportacion();
  IF EXISTS (SELECT 1 FROM exportaciones_centro WHERE estado IN ('PENDIENTE', 'EN_PROCESO')) THEN
    RAISE EXCEPTION 'Ya hay una exportacion del centro en curso'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'exportaciones_centro_una_en_proceso';
  END IF;
  INSERT INTO exportaciones_centro (solicitada_por_id, tablas_total, clave_publica, sal, urgente, programada_para)
  VALUES (app_usuario_id(), (SELECT count(*) FROM tablas_exportacion_centro()), p_clave_publica, p_sal, coalesce(p_urgente, false),
          CASE WHEN p_urgente THEN now() ELSE proxima_ventana_exportacion() END)
  RETURNING id INTO v;
  RETURN v;
END;
$$;

-- Job (sin contexto): toma la proxima vencida (una a la vez: SKIP LOCKED y el indice unico).
CREATE FUNCTION tomar_exportacion_centro()
RETURNS TABLE (id uuid, solicitada_por_id uuid, clave_publica bytea, sal bytea, intentos int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    UPDATE exportaciones_centro e
    SET estado = 'EN_PROCESO', intentos = e.intentos + 1, iniciada_en = now(), tablas_hechas = 0, fichas_hechas = 0, actualizada_en = now()
    WHERE e.id = (SELECT x.id FROM exportaciones_centro x WHERE x.estado = 'PENDIENTE' AND x.programada_para <= now()
                  ORDER BY x.programada_para LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING e.id, e.solicitada_por_id, e.clave_publica, e.sal, e.intentos;
END;
$$;

-- Un intento fallido vuelve a PENDIENTE (en 10 minutos) hasta el tercero; entonces FALLIDA.
DROP FUNCTION fallar_exportacion_centro(uuid, text);
CREATE FUNCTION fallar_exportacion_centro(p_id uuid, p_motivo text) RETURNS estado_exportacion_centro
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e exportaciones_centro := exportacion_centro_propia(p_id);
BEGIN
  IF e.estado <> 'EN_PROCESO' THEN
    RETURN e.estado;
  END IF;
  IF e.intentos < 3 THEN
    UPDATE exportaciones_centro SET estado = 'PENDIENTE', programada_para = now() + interval '10 minutes', actualizada_en = now() WHERE id = p_id;
    RETURN 'PENDIENTE';
  END IF;
  UPDATE exportaciones_centro SET estado = 'FALLIDA', motivo_fallo = left(p_motivo, 300), terminada_en = now(), actualizada_en = now()
  WHERE id = p_id;
  RETURN 'FALLIDA';
END;
$$;

-- Job (sin contexto): vence las LISTA pasadas las 24 h y, al arrancar la API,
-- devuelve las EN_PROCESO interrumpidas a PENDIENTE (o FALLIDA si ya iban 3
-- intentos). Devuelve los ids cuyos archivos se borran.
DROP FUNCTION cerrar_exportaciones_centro(boolean);
CREATE FUNCTION cerrar_exportaciones_centro(p_interrumpidas boolean) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    UPDATE exportaciones_centro SET estado = 'VENCIDA', actualizada_en = now()
    WHERE estado = 'LISTA' AND vence_en <= now()
    RETURNING id;
  IF p_interrumpidas THEN
    RETURN QUERY
      UPDATE exportaciones_centro
      SET estado = CASE WHEN intentos < 3 THEN 'PENDIENTE'::estado_exportacion_centro ELSE 'FALLIDA'::estado_exportacion_centro END,
          programada_para = now(),
          motivo_fallo = CASE WHEN intentos < 3 THEN NULL ELSE 'Se interrumpio tres veces. Vuelve a pedirla.' END,
          terminada_en = CASE WHEN intentos < 3 THEN NULL ELSE now() END,
          actualizada_en = now()
      WHERE estado = 'EN_PROCESO'
      RETURNING id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION proxima_ventana_exportacion(timestamptz), iniciar_exportacion_centro(bytea, bytea, boolean), tomar_exportacion_centro(),
  fallar_exportacion_centro(uuid, text), cerrar_exportaciones_centro(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION proxima_ventana_exportacion(timestamptz), iniciar_exportacion_centro(bytea, bytea, boolean), tomar_exportacion_centro(),
  fallar_exportacion_centro(uuid, text), cerrar_exportaciones_centro(boolean) TO app_user;
