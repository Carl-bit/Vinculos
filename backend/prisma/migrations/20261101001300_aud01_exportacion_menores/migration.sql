-- =============================================================================
-- AUD-01 Fase 3 (ARCOP-02): a quien se envia la copia de datos segun la edad
-- del paciente (decision del 2026-10-28, docs/cumplimiento/exportacion.md):
--
--   * menor de 14 años: solo sus adultos responsables;
--   * 14 a 17 años: el paciente y sus adultos responsables;
--   * 18 o mas (o sin fecha de nacimiento): solo el paciente.
--
-- Cada destinatario recibe su propio enlace (y su codigo si no tiene cuenta),
-- en destinatarios_exportacion (A). Con cuenta, la descarga exige la sesion
-- de esa cuenta (paciente o RESPONSABLE); sin cuenta, el codigo.
-- El enlace y el codigo salen de exportaciones_paciente (los existentes se
-- copian como destinatario PACIENTE).
-- =============================================================================

-- CreateTable
CREATE TABLE "destinatarios_exportacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "exportacion_id" UUID NOT NULL,
    "adulto_responsable_id" UUID,
    "usuario_id" UUID,
    "token_hash" BYTEA NOT NULL,
    "codigo_hash" BYTEA,
    "descargas" INTEGER NOT NULL DEFAULT 0,
    "ultima_descarga_en" TIMESTAMPTZ(6),

    CONSTRAINT "destinatarios_exportacion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "destinatarios_exportacion_token_hash_key" ON "destinatarios_exportacion"("token_hash");
CREATE INDEX "destinatarios_exportacion_exportacion_id_idx" ON "destinatarios_exportacion"("exportacion_id");
ALTER TABLE "destinatarios_exportacion" ADD CONSTRAINT "destinatarios_exportacion_exportacion_id_fkey" FOREIGN KEY ("exportacion_id") REFERENCES "exportaciones_paciente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "destinatarios_exportacion" ADD CONSTRAINT "destinatarios_exportacion_adulto_responsable_id_fkey" FOREIGN KEY ("adulto_responsable_id") REFERENCES "adultos_responsables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "destinatarios_exportacion" ADD CONSTRAINT "destinatarios_exportacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Con cuenta, la sesion; sin cuenta, el codigo (nunca ambos ni ninguno).
ALTER TABLE destinatarios_exportacion ADD CONSTRAINT destinatarios_exportacion_sesion_o_codigo
  CHECK ((usuario_id IS NULL) = (codigo_hash IS NOT NULL));
COMMENT ON TABLE destinatarios_exportacion IS
  'Categoria A. Destinatarios de una exportacion de paciente (paciente y/o adultos responsables segun la edad): enlace propio, sesion o codigo.';

ALTER TABLE destinatarios_exportacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE destinatarios_exportacion FORCE ROW LEVEL SECURITY;
CREATE POLICY destinatarios_exportacion_select ON destinatarios_exportacion FOR SELECT TO app_user
  USING (exportacion_id IN (SELECT id FROM exportaciones_paciente));
CREATE POLICY destinatarios_exportacion_acceso_vigente ON destinatarios_exportacion AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
-- Metadatos (a quien y cuantas descargas), nunca los hashes.
GRANT SELECT (id, exportacion_id, adulto_responsable_id, descargas, ultima_descarga_en) ON destinatarios_exportacion TO app_user;

-- Las ya enviadas pasan como destinatario PACIENTE.
INSERT INTO destinatarios_exportacion (exportacion_id, usuario_id, token_hash, codigo_hash, descargas, ultima_descarga_en)
SELECT e.id,
       CASE WHEN e.codigo_hash IS NULL THEN
         (SELECT u.id FROM usuarios u WHERE u.paciente_id = e.paciente_id AND u.rol = 'PACIENTE' ORDER BY u.created_at LIMIT 1) END,
       e.token_hash, e.codigo_hash, e.descargas, e.ultima_descarga_en
FROM exportaciones_paciente e
WHERE e.token_hash IS NOT NULL
  AND (e.codigo_hash IS NOT NULL OR EXISTS (SELECT 1 FROM usuarios u WHERE u.paciente_id = e.paciente_id AND u.rol = 'PACIENTE'));

ALTER TABLE exportaciones_paciente DROP CONSTRAINT exportaciones_paciente_coherente;
DROP INDEX "exportaciones_paciente_token_hash_key";
ALTER TABLE "exportaciones_paciente" DROP COLUMN "token_hash", DROP COLUMN "codigo_hash";
ALTER TABLE exportaciones_paciente ADD CONSTRAINT exportaciones_paciente_coherente
  CHECK ((clinica_en IS NULL) = (clinica_por_id IS NULL)
         AND (enviada_en IS NULL) = (vence_en IS NULL)
         AND (purgada_en IS NOT NULL OR datos_administrativos IS NOT NULL));

DROP FUNCTION enviar_exportacion(uuid, bytea, bytea);
DROP FUNCTION entregar_exportacion(bytea, bytea);
DROP FUNCTION exportacion_con_cuenta(uuid);

-- A quien se envia (interna): orden estable, el paciente primero.
-- Cuenta: la del paciente (rol PACIENTE) o la RESPONSABLE del adulto, activa.
CREATE FUNCTION destinatarios_por_edad(p_paciente_id uuid)
RETURNS TABLE (orden int, adulto_responsable_id uuid, correo text, usuario_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT id, email,
           CASE WHEN fecha_nacimiento IS NULL THEN 18
                ELSE extract(year FROM age((now() AT TIME ZONE 'America/Santiago')::date, fecha_nacimiento))::int END AS edad
    FROM pacientes WHERE id = p_paciente_id
  )
  SELECT 0, NULL::uuid, p.email,
         (SELECT u.id FROM usuarios u WHERE u.paciente_id = p.id AND u.rol = 'PACIENTE' AND u.activo AND u.cerrada_en IS NULL LIMIT 1)
  FROM p WHERE p.edad >= 14 AND p.email IS NOT NULL
  UNION ALL
  SELECT (row_number() OVER (ORDER BY a.created_at, a.id))::int, a.id, a.email,
         (SELECT u.id FROM usuarios u WHERE u.id = a.usuario_id AND u.activo AND u.cerrada_en IS NULL)
  FROM p JOIN adultos_responsables a ON a.paciente_id = p.id
  WHERE p.edad < 18 AND a.email IS NOT NULL
  ORDER BY 1
$$;

CREATE FUNCTION puede_enviar_exportacion(e exportaciones_paciente) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT acceso_vigente() AND (app_rol() = 'ADMIN' OR (app_rol() = 'PROFESIONAL' AND app_usuario_id() = e.clinica_por_id))
$$;

-- Cuantos enlaces genera la API (uno por destinatario).
CREATE FUNCTION destinatarios_pendientes_exportacion(p_id uuid) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e exportaciones_paciente%ROWTYPE;
BEGIN
  SELECT * INTO e FROM exportaciones_paciente WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exportacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT puede_enviar_exportacion(e) THEN
    RAISE EXCEPTION 'Envia la exportacion quien la completo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN (SELECT count(*)::int FROM destinatarios_por_edad(e.paciente_id));
END;
$$;

-- Completa: un enlace (hash) por destinatario, en el orden de
-- destinatarios_por_edad; el codigo solo si no tiene cuenta. Devuelve a quien
-- escribir (correo, si tiene cuenta, si es adulto responsable).
CREATE FUNCTION enviar_exportacion(p_id uuid, p_tokens bytea[], p_codigos bytea[])
RETURNS TABLE (correo text, con_cuenta boolean, es_adulto boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  e exportaciones_paciente%ROWTYPE;
  d record;
  i int := 0;
BEGIN
  SELECT * INTO e FROM exportaciones_paciente x WHERE x.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exportacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT puede_enviar_exportacion(e) THEN
    RAISE EXCEPTION 'Envia la exportacion quien la completo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF e.enviada_en IS NOT NULL OR e.purgada_en IS NOT NULL OR (e.requiere_clinica AND e.clinica_en IS NULL) THEN
    RAISE EXCEPTION 'La exportacion no esta lista para enviar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM destinatarios_por_edad(e.paciente_id)) THEN
    RAISE EXCEPTION 'Nadie con correo registrado para recibir la copia (paciente o adulto responsable segun la edad): entregar en persona'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'exportaciones_paciente_sin_correo';
  END IF;
  IF coalesce(array_length(p_tokens, 1), 0) <> (SELECT count(*) FROM destinatarios_por_edad(e.paciente_id))
     OR coalesce(array_length(p_codigos, 1), 0) <> coalesce(array_length(p_tokens, 1), 0) THEN
    RAISE EXCEPTION 'Los destinatarios cambiaron: vuelve a intentarlo' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  FOR d IN SELECT * FROM destinatarios_por_edad(e.paciente_id) LOOP
    i := i + 1;
    INSERT INTO destinatarios_exportacion (exportacion_id, adulto_responsable_id, usuario_id, token_hash, codigo_hash)
    VALUES (e.id, d.adulto_responsable_id, d.usuario_id, p_tokens[i], CASE WHEN d.usuario_id IS NULL THEN p_codigos[i] END);
    correo := d.correo;
    con_cuenta := d.usuario_id IS NOT NULL;
    es_adulto := d.adulto_responsable_id IS NOT NULL;
    RETURN NEXT;
  END LOOP;
  UPDATE exportaciones_paciente SET enviada_en = now(), vence_en = now() + interval '72 hours' WHERE id = e.id;
END;
$$;

-- Descarga: con cuenta, la sesion de esa cuenta; sin cuenta, el codigo. Devuelve los datos cifrados.
CREATE FUNCTION entregar_exportacion(p_token_hash bytea, p_codigo_hash bytea)
RETURNS TABLE (id uuid, paciente_id uuid, datos_administrativos bytea, datos_clinicos bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  d destinatarios_exportacion%ROWTYPE;
  e exportaciones_paciente%ROWTYPE;
BEGIN
  SELECT * INTO d FROM destinatarios_exportacion x WHERE x.token_hash = p_token_hash FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO e FROM exportaciones_paciente x WHERE x.id = d.exportacion_id FOR UPDATE;
  END IF;
  IF d.id IS NULL OR e.purgada_en IS NOT NULL OR e.vence_en <= now() THEN
    RAISE EXCEPTION 'Enlace inexistente o vencido' USING ERRCODE = 'no_data_found';
  END IF;
  IF d.usuario_id IS NOT NULL THEN
    IF app_usuario_id() IS DISTINCT FROM d.usuario_id THEN
      RAISE EXCEPTION 'Inicia sesion con tu cuenta para descargar' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
    VALUES (d.usuario_id, app_rol()::rol, e.paciente_id, 'exportacion_paciente', 'DESCARGA');
  ELSIF p_codigo_hash IS DISTINCT FROM d.codigo_hash THEN
    RAISE EXCEPTION 'Codigo incorrecto' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE destinatarios_exportacion SET descargas = descargas + 1, ultima_descarga_en = now() WHERE destinatarios_exportacion.id = d.id;
  UPDATE exportaciones_paciente SET descargas = descargas + 1, ultima_descarga_en = now() WHERE exportaciones_paciente.id = e.id;
  RETURN QUERY SELECT e.id, e.paciente_id, e.datos_administrativos, e.datos_clinicos;
END;
$$;

REVOKE EXECUTE ON FUNCTION destinatarios_por_edad(uuid), puede_enviar_exportacion(exportaciones_paciente),
  destinatarios_pendientes_exportacion(uuid), enviar_exportacion(uuid, bytea[], bytea[]), entregar_exportacion(bytea, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION destinatarios_pendientes_exportacion(uuid), enviar_exportacion(uuid, bytea[], bytea[]),
  entregar_exportacion(bytea, bytea) TO app_user;
