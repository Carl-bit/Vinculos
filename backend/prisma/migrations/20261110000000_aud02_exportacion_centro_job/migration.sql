-- =============================================================================
-- AUD-02 (BD-05, COLA-01; decision del 2026-11-06): la exportacion completa
-- del centro pasa de la peticion a un job.
--
-- Antes: exportar_tabla_centro(tabla) devolvia cada tabla entera en un JSON y
-- la API armaba todo el centro en memoria (incluidos los archivos en bytea)
-- dentro de la transaccion de 20 s de la peticion.
--
-- Ahora:
-- 1. exportaciones_centro (Categoria A): estado y avance de cada exportacion,
--    sin datos ni la clave. Una sola EN_PROCESO por centro. Escritura solo
--    por funciones SECURITY DEFINER; lee ADMIN.
-- 2. Lectura por lotes (ADMIN, la usa el job en el contexto del ADMIN que la
--    pidio, dentro de una transaccion REPEATABLE READ de solo lectura):
--    exportar_tabla_centro_lote(tabla, despues, limite) con cursor por ctid,
--    pacientes_con_ficha_exportacion() y exportar_ficha_centro(paciente) para
--    el PDF de cada ficha.
-- 3. El archivo cifrado vive en un volumen del silo hasta descargarse o 24 h
--    (la clave nunca se guarda: sin ella el archivo no se abre).
-- 4. Sale exportar_tabla_centro(text): reemplazada por la lectura por lotes.
-- =============================================================================

CREATE TYPE estado_exportacion_centro AS ENUM ('EN_PROCESO', 'LISTA', 'FALLIDA', 'DESCARGADA', 'VENCIDA');

-- CreateTable
CREATE TABLE "exportaciones_centro" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "solicitada_por_id" UUID NOT NULL,
    "estado" "estado_exportacion_centro" NOT NULL DEFAULT 'EN_PROCESO',
    "tablas_total" INTEGER NOT NULL,
    "tablas_hechas" INTEGER NOT NULL DEFAULT 0,
    "fichas_total" INTEGER NOT NULL DEFAULT 0,
    "fichas_hechas" INTEGER NOT NULL DEFAULT 0,
    "bytes" BIGINT,
    "huella" TEXT,
    "motivo_fallo" TEXT,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminada_en" TIMESTAMPTZ(6),
    "vence_en" TIMESTAMPTZ(6),
    "descargada_en" TIMESTAMPTZ(6),

    CONSTRAINT "exportaciones_centro_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "exportaciones_centro_creada_en_idx" ON "exportaciones_centro"("creada_en");
ALTER TABLE "exportaciones_centro" ADD CONSTRAINT "exportaciones_centro_solicitada_por_id_fkey" FOREIGN KEY ("solicitada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Una sola en proceso por centro (409 al pedir otra).
CREATE UNIQUE INDEX exportaciones_centro_una_en_proceso ON exportaciones_centro ((true)) WHERE estado = 'EN_PROCESO';
ALTER TABLE exportaciones_centro ADD CONSTRAINT exportaciones_centro_coherente
  CHECK (tablas_hechas BETWEEN 0 AND tablas_total AND fichas_hechas BETWEEN 0 AND fichas_total
         AND (huella IS NULL OR huella ~ '^[0-9a-f]{64}$')
         AND (motivo_fallo IS NULL OR length(motivo_fallo) <= 300)
         AND (estado <> 'EN_PROCESO' OR terminada_en IS NULL)
         AND (estado NOT IN ('LISTA', 'DESCARGADA', 'VENCIDA') OR (bytes IS NOT NULL AND huella IS NOT NULL AND vence_en IS NOT NULL AND terminada_en IS NOT NULL))
         AND (estado <> 'FALLIDA' OR (motivo_fallo IS NOT NULL AND terminada_en IS NOT NULL))
         AND (estado <> 'DESCARGADA' OR descargada_en IS NOT NULL));
COMMENT ON TABLE exportaciones_centro IS
  'Categoria A. Exportacion completa del centro (LEG-04) como job (AUD-02): estado y avance, sin datos ni clave. El archivo cifrado vive en el volumen del silo hasta descargarse o 24 h.';

ALTER TABLE exportaciones_centro ENABLE ROW LEVEL SECURITY;
ALTER TABLE exportaciones_centro FORCE ROW LEVEL SECURITY;
CREATE POLICY exportaciones_centro_select ON exportaciones_centro FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY exportaciones_centro_acceso_vigente ON exportaciones_centro AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON exportaciones_centro TO app_user;

-- Validacion comun: la tabla es de las exportables (misma lista que tablas_exportacion_centro).
CREATE FUNCTION exigir_admin_exportacion() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'La exportacion del centro la pide un ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- ADMIN: inicia una exportacion (devuelve su id).
CREATE FUNCTION iniciar_exportacion_centro() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  PERFORM exigir_admin_exportacion();
  INSERT INTO exportaciones_centro (solicitada_por_id, tablas_total)
  VALUES (app_usuario_id(), (SELECT count(*) FROM tablas_exportacion_centro()))
  RETURNING id INTO v;
  RETURN v;
END;
$$;

-- Fila de la exportacion en curso del ADMIN actual (el job corre en su contexto).
CREATE FUNCTION exportacion_centro_propia(p_id uuid) RETURNS exportaciones_centro
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e exportaciones_centro;
BEGIN
  PERFORM exigir_admin_exportacion();
  SELECT * INTO e FROM exportaciones_centro WHERE id = p_id AND solicitada_por_id = app_usuario_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exportacion no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN e;
END;
$$;

CREATE FUNCTION avance_exportacion_centro(p_id uuid, p_tablas_hechas int, p_fichas_hechas int, p_fichas_total int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e exportaciones_centro := exportacion_centro_propia(p_id);
BEGIN
  IF e.estado <> 'EN_PROCESO' THEN
    RAISE EXCEPTION 'La exportacion ya termino' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE exportaciones_centro
  SET tablas_hechas = p_tablas_hechas, fichas_hechas = p_fichas_hechas, fichas_total = p_fichas_total, actualizada_en = now()
  WHERE id = p_id;
END;
$$;

-- Lista: queda descargable 24 h; registra la exportacion (huella y tamaño).
CREATE FUNCTION terminar_exportacion_centro(p_id uuid, p_bytes bigint, p_huella text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e exportaciones_centro := exportacion_centro_propia(p_id);
  v_vence timestamptz := now() + interval '24 hours';
BEGIN
  IF e.estado <> 'EN_PROCESO' THEN
    RAISE EXCEPTION 'La exportacion ya termino' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE exportaciones_centro
  SET estado = 'LISTA', tablas_hechas = tablas_total, fichas_hechas = fichas_total, bytes = p_bytes, huella = p_huella,
      terminada_en = now(), vence_en = v_vence, actualizada_en = now()
  WHERE id = p_id;
  INSERT INTO registro_exportaciones (usuario_id, rol, recurso, referencia_id, detalle)
  VALUES (app_usuario_id(), 'ADMIN', 'exportacion_centro', p_id, format('%s tablas, %s bytes, sha256 %s', e.tablas_total, p_bytes, p_huella));
  RETURN v_vence;
END;
$$;

CREATE FUNCTION fallar_exportacion_centro(p_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e exportaciones_centro := exportacion_centro_propia(p_id);
BEGIN
  IF e.estado = 'EN_PROCESO' THEN
    UPDATE exportaciones_centro SET estado = 'FALLIDA', motivo_fallo = left(p_motivo, 300), terminada_en = now(), actualizada_en = now()
    WHERE id = p_id;
  END IF;
END;
$$;

-- Descarga: solo quien la pidio (el archivo va cifrado con su clave), LISTA y dentro de las 24 h.
CREATE FUNCTION descargar_exportacion_centro(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e exportaciones_centro := exportacion_centro_propia(p_id);
BEGIN
  IF e.estado <> 'LISTA' OR e.vence_en <= now() THEN
    RAISE EXCEPTION 'La exportacion no esta disponible para descargar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE exportaciones_centro SET estado = 'DESCARGADA', descargada_en = now(), actualizada_en = now() WHERE id = p_id;
END;
$$;

-- Job (sin contexto): vence las LISTA pasadas las 24 h y, al arrancar la API
-- (p_interrumpidas), da por fallidas las EN_PROCESO: la llave vivia solo en
-- la memoria del proceso. Devuelve los ids cuyos archivos se borran.
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
      SET estado = 'FALLIDA', motivo_fallo = 'Se interrumpio por un reinicio del servidor. Vuelve a pedirla.', terminada_en = now(), actualizada_en = now()
      WHERE estado = 'EN_PROCESO'
      RETURNING id;
  END IF;
END;
$$;

-- Lectura por lotes con cursor por ctid (estable dentro del snapshot REPEATABLE READ del job).
CREATE FUNCTION exportar_tabla_centro_lote(p_tabla text, p_despues tid, p_limite int)
RETURNS TABLE (fila jsonb, pos tid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_admin_exportacion();
  IF p_tabla IS NULL OR NOT EXISTS (SELECT 1 FROM tablas_exportacion_centro() t WHERE t = p_tabla) THEN
    RAISE EXCEPTION 'Tabla fuera de la exportacion' USING ERRCODE = 'check_violation', CONSTRAINT = 'exportacion_centro_tabla';
  END IF;
  RETURN QUERY EXECUTE format('SELECT fila_exportable(to_jsonb(t)), t.ctid FROM %I t WHERE t.ctid > $1 ORDER BY t.ctid LIMIT $2', p_tabla)
    USING coalesce(p_despues, '(0,0)'::tid), least(greatest(coalesce(p_limite, 1), 1), 1000);
END;
$$;

CREATE FUNCTION pacientes_con_ficha_exportacion() RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_admin_exportacion();
  RETURN QUERY SELECT DISTINCT f.paciente_id FROM fichas_clinicas f
               WHERE EXISTS (SELECT 1 FROM evoluciones e WHERE e.ficha_clinica_id = f.id)
                  OR EXISTS (SELECT 1 FROM ingresos_ficha i WHERE i.ficha_clinica_id = f.id)
               ORDER BY 1;
END;
$$;

-- Lo que necesita el PDF de la ficha de un paciente (mismas tablas que filtrarPaciente en la API).
CREATE FUNCTION exportar_ficha_centro(p_paciente_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM exigir_admin_exportacion();
  RETURN jsonb_build_object(
    'pacientes', (SELECT coalesce(jsonb_agg(fila_exportable(to_jsonb(p))), '[]') FROM pacientes p WHERE p.id = p_paciente_id),
    'fichas_clinicas', (SELECT coalesce(jsonb_agg(fila_exportable(to_jsonb(f))), '[]') FROM fichas_clinicas f WHERE f.paciente_id = p_paciente_id),
    'ingresos_ficha', (SELECT coalesce(jsonb_agg(fila_exportable(to_jsonb(i)) ORDER BY i.created_at), '[]') FROM ingresos_ficha i
                       JOIN fichas_clinicas f ON f.id = i.ficha_clinica_id WHERE f.paciente_id = p_paciente_id),
    'evoluciones', (SELECT coalesce(jsonb_agg(fila_exportable(to_jsonb(e)) ORDER BY e.created_at), '[]') FROM evoluciones e
                    JOIN fichas_clinicas f ON f.id = e.ficha_clinica_id WHERE f.paciente_id = p_paciente_id));
END;
$$;

DROP FUNCTION exportar_tabla_centro(text);

REVOKE EXECUTE ON FUNCTION exigir_admin_exportacion(), iniciar_exportacion_centro(), exportacion_centro_propia(uuid),
  avance_exportacion_centro(uuid, int, int, int), terminar_exportacion_centro(uuid, bigint, text), fallar_exportacion_centro(uuid, text),
  descargar_exportacion_centro(uuid), cerrar_exportaciones_centro(boolean), exportar_tabla_centro_lote(text, tid, int),
  pacientes_con_ficha_exportacion(), exportar_ficha_centro(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iniciar_exportacion_centro(), avance_exportacion_centro(uuid, int, int, int), terminar_exportacion_centro(uuid, bigint, text),
  fallar_exportacion_centro(uuid, text), descargar_exportacion_centro(uuid), cerrar_exportaciones_centro(boolean),
  exportar_tabla_centro_lote(text, tid, int), pacientes_con_ficha_exportacion(), exportar_ficha_centro(uuid) TO app_user;
