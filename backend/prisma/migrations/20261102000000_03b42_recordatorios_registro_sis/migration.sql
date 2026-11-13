-- =============================================================================
-- 03b-4.2: recordatorios personales del equipo y registro en la
-- Superintendencia de Salud (RNPI).
--
-- * recordatorios_personales (A): lista de tareas de cada integrante del
--   equipo. Solo la ve y la escribe su autor (ningun rol ve las de otro, ni
--   ADMIN). Texto cifrado (CLINICO: es texto libre y alguien podria escribir
--   un dato de salud aunque la pantalla advierte que no). No es parte de la
--   ficha: el autor la borra.
-- * registros_sis (A+C): numero de registro de prestador individual del
--   profesional y su verificacion. Minimizacion: solo numero, titulo
--   habilitante, institucion, fecha, estado y metodo (nunca fecha de
--   nacimiento, sexo ni nacionalidad de la respuesta del RNPI). Sin GRANT de
--   escritura: el profesional lo informa con informar_registro_sis() y la
--   verificacion queda con registrar_verificacion_sis() (automatica: la API
--   tras consultar el RNPI desde el servidor; manual: ADMIN).
--   Publico: registros_sis_publicos() (solo verificados y con perfil publico).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Recordatorios personales (A)
-- -----------------------------------------------------------------------------
CREATE TABLE "recordatorios_personales" (
    "id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "texto" BYTEA NOT NULL,
    "vence_el" DATE,
    "hecho_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recordatorios_personales_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recordatorios_personales_autor_id_idx" ON "recordatorios_personales"("autor_id");
ALTER TABLE "recordatorios_personales" ADD CONSTRAINT "recordatorios_personales_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE recordatorios_personales ADD CONSTRAINT recordatorios_personales_cifrado CHECK (octet_length(texto) >= 49);
COMMENT ON TABLE recordatorios_personales IS
  'Categoria A. Recordatorios personales del equipo: solo su autor (texto cifrado, sin vinculo obligatorio con pacientes).';

ALTER TABLE recordatorios_personales ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordatorios_personales FORCE ROW LEVEL SECURITY;
CREATE POLICY recordatorios_personales_autor ON recordatorios_personales FOR ALL TO app_user
  USING (autor_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'))
  WITH CHECK (autor_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'));
CREATE POLICY recordatorios_personales_acceso_vigente ON recordatorios_personales AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT, INSERT, DELETE ON recordatorios_personales TO app_user;
GRANT UPDATE (hecho_en) ON recordatorios_personales TO app_user;

-- -----------------------------------------------------------------------------
-- Registro en la Superintendencia de Salud (A+C)
-- -----------------------------------------------------------------------------
CREATE TABLE "registros_sis" (
    "profesional_id" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "metodo" TEXT,
    "titulo_habilitante" TEXT,
    "institucion" TEXT,
    "verificado_en" TIMESTAMPTZ(6),
    "verificado_por_id" UUID,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registros_sis_pkey" PRIMARY KEY ("profesional_id")
);
ALTER TABLE "registros_sis" ADD CONSTRAINT "registros_sis_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registros_sis" ADD CONSTRAINT "registros_sis_verificado_por_id_fkey" FOREIGN KEY ("verificado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE registros_sis ADD CONSTRAINT registros_sis_valido CHECK (
  numero ~ '^[0-9]{1,10}$'
  AND estado IN ('PENDIENTE', 'VERIFICADO_AUTOMATICO', 'VERIFICADO_MANUAL', 'NO_COINCIDE')
  AND (metodo IS NULL OR metodo IN ('AUTOMATICO', 'MANUAL'))
  AND (estado = 'PENDIENTE') = (metodo IS NULL AND verificado_en IS NULL)
  AND (estado <> 'VERIFICADO_AUTOMATICO' OR metodo = 'AUTOMATICO')
  AND (estado <> 'VERIFICADO_MANUAL' OR (metodo = 'MANUAL' AND verificado_por_id IS NOT NULL))
  AND (titulo_habilitante IS NULL OR length(titulo_habilitante) <= 200)
  AND (institucion IS NULL OR length(institucion) <= 200));
COMMENT ON TABLE registros_sis IS
  'Categoria A+C. Registro de prestador individual (RNPI) del profesional y su verificacion; publico solo verificado via registros_sis_publicos().';

ALTER TABLE registros_sis ENABLE ROW LEVEL SECURITY;
ALTER TABLE registros_sis FORCE ROW LEVEL SECURITY;
-- Lectura interna: todo el equipo (el registro es publico en el RNPI); el paciente nunca por la tabla.
CREATE POLICY registros_sis_select ON registros_sis FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'));
CREATE POLICY registros_sis_acceso_vigente ON registros_sis AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON registros_sis TO app_user;

-- Los numeros ya informados en la trayectoria pasan al registro (verificado
-- por el centro si el ADMIN ya habia verificado esa trayectoria).
INSERT INTO registros_sis (profesional_id, numero, estado, metodo, verificado_en, verificado_por_id)
SELECT DISTINCT ON (tr.profesional_id) tr.profesional_id, regexp_replace(tr.registro_superintendencia, '[^0-9]', '', 'g'),
       CASE WHEN tr.verificado AND tr.verificado_por_id IS NOT NULL THEN 'VERIFICADO_MANUAL' ELSE 'PENDIENTE' END,
       CASE WHEN tr.verificado AND tr.verificado_por_id IS NOT NULL THEN 'MANUAL' END,
       CASE WHEN tr.verificado AND tr.verificado_por_id IS NOT NULL THEN coalesce(tr.verificado_en, tr.updated_at) END,
       CASE WHEN tr.verificado AND tr.verificado_por_id IS NOT NULL THEN tr.verificado_por_id END
FROM profesional_trayectoria tr
WHERE regexp_replace(coalesce(tr.registro_superintendencia, ''), '[^0-9]', '', 'g') ~ '^[0-9]{1,10}$'
ORDER BY tr.profesional_id, tr.verificado DESC, tr.updated_at DESC;

-- El profesional informa (o quita, con NULL) su numero: queda PENDIENTE.
CREATE FUNCTION informar_registro_sis(p_numero text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' THEN
    RAISE EXCEPTION 'Solo el profesional informa su registro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_numero IS NULL THEN
    DELETE FROM registros_sis WHERE profesional_id = app_usuario_id();
    RETURN;
  END IF;
  INSERT INTO registros_sis (profesional_id, numero, estado)
  VALUES (app_usuario_id(), p_numero, 'PENDIENTE')
  ON CONFLICT (profesional_id) DO UPDATE
    SET numero = EXCLUDED.numero, estado = 'PENDIENTE', metodo = NULL, titulo_habilitante = NULL, institucion = NULL,
        verificado_en = NULL, verificado_por_id = NULL, actualizado_en = now()
    WHERE registros_sis.numero IS DISTINCT FROM EXCLUDED.numero;
END;
$$;

-- Resultado de una verificacion. AUTOMATICO: la API tras consultar el RNPI
-- (ADMIN, el propio profesional o el job sin contexto). MANUAL: solo ADMIN
-- (respaldo de la trayectoria). p_numero = el numero consultado: si el
-- profesional lo cambio entretanto, 55000.
CREATE FUNCTION registrar_verificacion_sis(p_profesional uuid, p_numero text, p_estado text, p_metodo text,
                                           p_titulo text, p_institucion text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r registros_sis%ROWTYPE;
  v_job boolean := app_usuario_id() IS NULL;
BEGIN
  IF NOT v_job AND NOT acceso_vigente() THEN
    RAISE EXCEPTION 'registrar_verificacion_sis: requiere acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_metodo = 'MANUAL' AND (v_job OR app_rol() IS DISTINCT FROM 'ADMIN') THEN
    RAISE EXCEPTION 'La verificacion manual la hace un ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_metodo = 'AUTOMATICO' AND NOT v_job AND app_rol() IS DISTINCT FROM 'ADMIN'
     AND NOT (app_rol() = 'PROFESIONAL' AND p_profesional = app_usuario_id()) THEN
    RAISE EXCEPTION 'Sin permiso para verificar este registro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_estado NOT IN ('VERIFICADO_AUTOMATICO', 'VERIFICADO_MANUAL', 'NO_COINCIDE')
     OR p_metodo NOT IN ('AUTOMATICO', 'MANUAL')
     OR (p_estado = 'VERIFICADO_AUTOMATICO' AND p_metodo <> 'AUTOMATICO')
     OR (p_estado = 'VERIFICADO_MANUAL' AND p_metodo <> 'MANUAL') THEN
    RAISE EXCEPTION 'Estado o metodo de verificacion invalido' USING ERRCODE = 'check_violation', CONSTRAINT = 'registros_sis_valido';
  END IF;
  SELECT * INTO r FROM registros_sis WHERE profesional_id = p_profesional FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El profesional no tiene registro informado' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.numero IS DISTINCT FROM p_numero THEN
    RAISE EXCEPTION 'El numero de registro cambio mientras se verificaba' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE registros_sis
     SET estado = p_estado, metodo = p_metodo, titulo_habilitante = left(p_titulo, 200), institucion = left(p_institucion, 200),
         verificado_en = now(), verificado_por_id = CASE WHEN p_metodo = 'MANUAL' THEN app_usuario_id() END, actualizado_en = now()
   WHERE profesional_id = p_profesional;
END;
$$;

-- Datos para verificar contra el RNPI (numero, nombre interno, profesion y
-- RUT cifrado). Un profesional: ADMIN, el propio o el job. Todos (NULL): solo
-- el job mensual, y omite los verificados por el centro (decision del ADMIN).
CREATE FUNCTION datos_verificacion_sis(p_profesional uuid DEFAULT NULL)
RETURNS TABLE (profesional_id uuid, numero text, nombre text, especialidad text, rut bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_job boolean := app_usuario_id() IS NULL;
BEGIN
  IF NOT v_job AND (p_profesional IS NULL OR NOT acceso_vigente()
                    OR NOT (app_rol() = 'ADMIN' OR (app_rol() = 'PROFESIONAL' AND p_profesional = app_usuario_id()))) THEN
    RAISE EXCEPTION 'Sin permiso para verificar registros' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT r.profesional_id, r.numero, u.nombre, p.especialidad, d.rut
  FROM registros_sis r
  JOIN usuarios u ON u.id = r.profesional_id
  LEFT JOIN profesionales p ON p.usuario_id = r.profesional_id
  LEFT JOIN profesional_datos_privados d ON d.usuario_id = r.profesional_id
  WHERE (p_profesional IS NULL AND r.estado <> 'VERIFICADO_MANUAL') OR r.profesional_id = p_profesional;
END;
$$;

-- Publico (sin autenticacion, como perfiles_publicos): solo registros
-- verificados de perfiles publicados.
CREATE FUNCTION registros_sis_publicos()
RETURNS TABLE (profesional_id uuid, numero text, estado text, verificado_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.profesional_id, r.numero, r.estado, r.verificado_en
  FROM registros_sis r JOIN profesionales p ON p.usuario_id = r.profesional_id
  WHERE p.perfil_publico AND r.estado IN ('VERIFICADO_AUTOMATICO', 'VERIFICADO_MANUAL')
$$;

REVOKE EXECUTE ON FUNCTION informar_registro_sis(text), registrar_verificacion_sis(uuid, text, text, text, text, text),
  datos_verificacion_sis(uuid), registros_sis_publicos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION informar_registro_sis(text), registrar_verificacion_sis(uuid, text, text, text, text, text),
  datos_verificacion_sis(uuid), registros_sis_publicos() TO app_user;
