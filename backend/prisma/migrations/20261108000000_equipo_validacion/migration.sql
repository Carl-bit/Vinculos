-- =============================================================================
-- Equipo del centro, version 1 (2026-11-08, decisiones del usuario sobre el
-- diseño "ficha del integrante con lista de validacion"). Detalle:
-- docs/front/equipo_validacion.md.
--
-- 1. Validacion de la cuenta madre: un profesional aparece en el sitio publico
--    (perfiles, registro SIS publico, disponibilidad publica y pedir hora)
--    solo si esta validado: registro SIS verificado y al menos un titulo
--    (TITULO) verificado por ADMIN. profesional_validado(uuid).
-- 2. Observacion de un titulo: ADMIN deja una observacion sobre el respaldo
--    (observar_trayectoria). El titulo vuelve a "En revision"; la observacion
--    se limpia cuando el profesional sube una version nueva o ADMIN verifica.
-- 3. practicante_documentos (Categoria A, cifrada IDENTIFICACION): certificado
--    de alumno regular y convenio de practica, versionados como los respaldos
--    de titulos. No habilitan ni cortan el acceso (eso lo definen las fechas de
--    la practica): son parte del perfil del practicante. Suben el propio
--    practicante o ADMIN; leen el propio, ADMIN y GESTION. cerrar_cuenta los
--    borra (del profesional no se retiene nada como persona).
-- 4. correcciones_perfil (Categoria B): pedidos de correccion del perfil
--    publico por campo. ADMIN/GESTION ya no editan los campos publicos de un
--    perfil ajeno directamente: ADMIN puede corregir un campo solo a la
--    segunda solicitud del mismo campo sin cambios (corregir_campo_perfil).
-- Corre como dueño (vinculos_owner).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Validado = registro SIS verificado + titulo verificado.
-- -----------------------------------------------------------------------------
CREATE FUNCTION profesional_validado(p_profesional_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM registros_sis r WHERE r.profesional_id = p_profesional_id
                 AND r.estado IN ('VERIFICADO_AUTOMATICO', 'VERIFICADO_MANUAL'))
     AND EXISTS (SELECT 1 FROM profesional_trayectoria t WHERE t.profesional_id = p_profesional_id
                 AND t.tipo = 'TITULO' AND t.verificado)
$$;
REVOKE EXECUTE ON FUNCTION profesional_validado(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION profesional_validado(uuid) TO app_user;


-- -----------------------------------------------------------------------------
-- 2. Observacion de un titulo (ADMIN).
-- -----------------------------------------------------------------------------
ALTER TABLE profesional_trayectoria
  ADD COLUMN observacion text,
  ADD COLUMN observada_en timestamptz(6),
  ADD COLUMN observada_por_id uuid REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE profesional_trayectoria ADD CONSTRAINT trayectoria_observacion
  CHECK (observacion IS NULL OR (btrim(observacion) <> '' AND char_length(observacion) <= 500));

CREATE FUNCTION observar_trayectoria(p_id uuid, p_observacion text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() <> 'ADMIN' THEN
    RAISE EXCEPTION 'Solo la cuenta madre observa un titulo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE profesional_trayectoria
  SET observacion = btrim(p_observacion), observada_en = now(), observada_por_id = app_usuario_id(),
      verificado = false, verificado_por_id = NULL, verificado_en = NULL, updated_at = now()
  WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Titulo inexistente' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION observar_trayectoria(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION observar_trayectoria(uuid, text) TO app_user;

-- Version nueva del respaldo: limpia la observacion (evidencia nueva).
CREATE OR REPLACE FUNCTION subir_respaldo_trayectoria(p_id uuid, p_trayectoria_id uuid, p_nombre text, p_tipo text,
                                                      p_tamano integer, p_contenido bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prof uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'Solo el profesional sube el respaldo de su titulo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT profesional_id INTO v_prof FROM profesional_trayectoria WHERE id = p_trayectoria_id FOR UPDATE;
  IF NOT FOUND OR v_prof IS DISTINCT FROM app_usuario_id() THEN
    RAISE EXCEPTION 'Titulo inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO trayectoria_respaldos (id, trayectoria_id, profesional_id, nombre_archivo, tipo_mime, tamano_bytes, contenido)
  VALUES (p_id, p_trayectoria_id, v_prof, p_nombre, p_tipo, p_tamano, p_contenido);
  UPDATE profesional_trayectoria
  SET verificado = false, verificado_por_id = NULL, verificado_en = NULL,
      observacion = NULL, observada_en = NULL, observada_por_id = NULL, updated_at = now()
  WHERE id = p_trayectoria_id;
  RETURN p_id;
END;
$$;

-- El trigger: ADMIN no toca la observacion por UPDATE directo (usa la funcion);
-- verificar la limpia; el propio no la cambia.
CREATE OR REPLACE FUNCTION proteger_trayectoria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF app_rol() = 'ADMIN' THEN
    IF TG_OP = 'INSERT'
       OR (NEW.profesional_id, NEW.tipo, NEW.titulo, NEW.institucion, NEW.anio, NEW.registro_superintendencia,
           NEW.documento_respaldo_url, NEW.observacion, NEW.observada_en, NEW.observada_por_id)
          IS DISTINCT FROM
          (OLD.profesional_id, OLD.tipo, OLD.titulo, OLD.institucion, OLD.anio, OLD.registro_superintendencia,
           OLD.documento_respaldo_url, OLD.observacion, OLD.observada_en, OLD.observada_por_id) THEN
      RAISE EXCEPTION 'ADMIN solo verifica la trayectoria' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.verificado AND NOT OLD.verificado
       AND NOT EXISTS (SELECT 1 FROM trayectoria_respaldos r WHERE r.trayectoria_id = NEW.id) THEN
      RAISE EXCEPTION 'Para verificar el titulo debe tener un respaldo cargado'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'trayectoria_verificar_con_respaldo';
    END IF;
    NEW.verificado_por_id := CASE WHEN NEW.verificado THEN app_usuario_id() END;
    NEW.verificado_en := CASE WHEN NEW.verificado THEN now() END;
    IF NEW.verificado THEN
      NEW.observacion := NULL;
      NEW.observada_en := NULL;
      NEW.observada_por_id := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.verificado, NEW.verificado_por_id, NEW.verificado_en)
                          IS DISTINCT FROM (OLD.verificado, OLD.verificado_por_id, OLD.verificado_en) THEN
    RAISE EXCEPTION 'Solo ADMIN verifica la trayectoria' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.verificado := false;
  NEW.verificado_por_id := NULL;
  NEW.verificado_en := NULL;
  IF TG_OP = 'INSERT' THEN
    NEW.observacion := NULL;
    NEW.observada_en := NULL;
    NEW.observada_por_id := NULL;
  ELSE
    NEW.observacion := OLD.observacion;
    NEW.observada_en := OLD.observada_en;
    NEW.observada_por_id := OLD.observada_por_id;
  END IF;
  RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. Documentos del practicante (A, cifrados, versionados).
-- -----------------------------------------------------------------------------
CREATE TYPE "tipo_documento_practicante" AS ENUM ('CERTIFICADO_ALUMNO_REGULAR', 'CONVENIO_PRACTICA');

CREATE TABLE "practicante_documentos" (
    "id" UUID NOT NULL,
    "practicante_id" UUID NOT NULL,
    "tipo" "tipo_documento_practicante" NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "tipo_mime" TEXT NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "vigente_hasta" DATE,
    "subido_por_id" UUID NOT NULL,
    "subido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practicante_documentos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "practicante_documentos_practicante_id_idx" ON "practicante_documentos"("practicante_id");
ALTER TABLE "practicante_documentos" ADD CONSTRAINT "practicante_documentos_practicante_id_fkey"
  FOREIGN KEY ("practicante_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "practicante_documentos" ADD CONSTRAINT "practicante_documentos_subido_por_id_fkey"
  FOREIGN KEY ("subido_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE practicante_documentos ADD CONSTRAINT practicante_documentos_archivo
  CHECK (btrim(nombre_archivo) <> '' AND length(nombre_archivo) <= 200
         AND tipo_mime IN ('application/pdf', 'image/png', 'image/jpeg')
         AND tamano_bytes > 0 AND octet_length(contenido) >= 49);
COMMENT ON TABLE practicante_documentos IS
  'Categoria A. Certificado de alumno regular y convenio de practica (archivo cifrado, IDENTIFICACION); versionado, sin borrado suelto. No habilita el acceso.';

CREATE FUNCTION subir_documento_practicante(p_id uuid, p_practicante_id uuid, p_tipo tipo_documento_practicante,
                                            p_nombre text, p_tipo_mime text, p_tamano integer, p_contenido bytea,
                                            p_vigente_hasta date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente()
     OR NOT (app_rol() = 'ADMIN' OR (app_rol() = 'PRACTICANTE' AND p_practicante_id = app_usuario_id())) THEN
    RAISE EXCEPTION 'Solo el practicante o la cuenta madre suben sus documentos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM practicantes WHERE usuario_id = p_practicante_id) THEN
    RAISE EXCEPTION 'Practicante inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO practicante_documentos (id, practicante_id, tipo, nombre_archivo, tipo_mime, tamano_bytes, contenido,
                                      vigente_hasta, subido_por_id)
  VALUES (p_id, p_practicante_id, p_tipo, p_nombre, p_tipo_mime, p_tamano, p_contenido, p_vigente_hasta, app_usuario_id());
  RETURN p_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION subir_documento_practicante(uuid, uuid, tipo_documento_practicante, text, text, integer, bytea, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION subir_documento_practicante(uuid, uuid, tipo_documento_practicante, text, text, integer, bytea, date) TO app_user;

ALTER TABLE practicante_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE practicante_documentos FORCE ROW LEVEL SECURITY;
CREATE POLICY practicante_documentos_select ON practicante_documentos FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR practicante_id = (SELECT app_usuario_id()));
CREATE POLICY practicante_documentos_acceso_vigente ON practicante_documentos AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON practicante_documentos TO app_user;

-- Cierre de cuenta: tambien los documentos del practicante.
CREATE OR REPLACE FUNCTION cerrar_cuenta(p_usuario_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM eliminar_resenas_de(p_usuario_id);
  DELETE FROM profesional_tipos_atencion WHERE profesional_id = p_usuario_id;
  DELETE FROM tarifas WHERE profesional_id = p_usuario_id;
  DELETE FROM disponibilidad_profesional WHERE profesional_id = p_usuario_id;
  DELETE FROM profesional_trayectoria WHERE profesional_id = p_usuario_id;
  DELETE FROM practicante_documentos WHERE practicante_id = p_usuario_id;
  DELETE FROM correcciones_perfil WHERE profesional_id = p_usuario_id;
  DELETE FROM profesional_datos_privados WHERE usuario_id = p_usuario_id;
  DELETE FROM profesionales WHERE usuario_id = p_usuario_id;
  UPDATE roles_adicionales SET activo = false, desactivado_en = now() WHERE usuario_id = p_usuario_id AND activo;
  UPDATE usuarios
  SET nombre = NULL, email = NULL, password_hash = NULL, telefono = NULL, totp_secreto = NULL, totp_activo = false,
      cerrada_en = now(), updated_at = now()
  WHERE id = p_usuario_id AND NOT activo AND cerrada_en IS NULL;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. Correcciones del perfil publico (B).
-- -----------------------------------------------------------------------------
CREATE TABLE "correcciones_perfil" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID NOT NULL,
    "campo" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "autor_id" UUID NOT NULL,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correcciones_perfil_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "correcciones_perfil_profesional_id_campo_idx" ON "correcciones_perfil"("profesional_id", "campo");
ALTER TABLE "correcciones_perfil" ADD CONSTRAINT "correcciones_perfil_profesional_id_fkey"
  FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "correcciones_perfil" ADD CONSTRAINT "correcciones_perfil_autor_id_fkey"
  FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE correcciones_perfil ADD CONSTRAINT correcciones_perfil_valores
  CHECK (campo IN ('nombre_publico', 'especialidad', 'cita_destacada', 'bio', 'enfoques', 'foto_url')
         AND accion IN ('PEDIDA', 'APLICADA')
         AND char_length(btrim(motivo)) BETWEEN 3 AND 500);
COMMENT ON TABLE correcciones_perfil IS
  'Categoria B. Pedidos de correccion del perfil publico por campo (PEDIDA) y correcciones de la cuenta madre (APLICADA). huella = md5 del valor del campo en ese momento.';

-- Valor actual de un campo publico (interna, sin GRANT).
CREATE FUNCTION valor_campo_perfil(p_profesional_id uuid, p_campo text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE p_campo
           WHEN 'nombre_publico' THEN p.nombre_publico
           WHEN 'especialidad' THEN p.especialidad
           WHEN 'cita_destacada' THEN p.cita_destacada
           WHEN 'bio' THEN p.bio
           WHEN 'enfoques' THEN array_to_string(p.enfoques, '|')
           WHEN 'foto_url' THEN p.foto_url
         END
  FROM profesionales p WHERE p.usuario_id = p_profesional_id
$$;
REVOKE EXECUTE ON FUNCTION valor_campo_perfil(uuid, text) FROM PUBLIC;

-- Pedidos del mismo campo con el mismo valor desde la ultima correccion aplicada.
CREATE FUNCTION solicitudes_sin_cambio(p_profesional_id uuid, p_campo text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM correcciones_perfil c
  WHERE c.profesional_id = p_profesional_id AND c.campo = p_campo AND c.accion = 'PEDIDA'
    AND c.huella = md5(coalesce(valor_campo_perfil(p_profesional_id, p_campo), ''))
    AND c.creada_en > coalesce((SELECT max(a.creada_en) FROM correcciones_perfil a
                                WHERE a.profesional_id = p_profesional_id AND a.campo = p_campo AND a.accion = 'APLICADA'),
                               '-infinity')
$$;
REVOKE EXECUTE ON FUNCTION solicitudes_sin_cambio(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION solicitudes_sin_cambio(uuid, text) TO app_user;

CREATE FUNCTION pedir_correccion_perfil(p_profesional_id uuid, p_campos text[], p_motivo text)
RETURNS TABLE(campo text, solicitudes integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_campo text;
BEGIN
  IF NOT acceso_vigente() OR app_rol() <> 'ADMIN' OR p_profesional_id = app_usuario_id() THEN
    RAISE EXCEPTION 'Solo la cuenta madre pide correcciones de un perfil ajeno' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id) THEN
    RAISE EXCEPTION 'Perfil inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF coalesce(cardinality(p_campos), 0) = 0 THEN
    RAISE EXCEPTION 'Elige al menos un campo' USING ERRCODE = 'check_violation', CONSTRAINT = 'correcciones_perfil_valores';
  END IF;
  FOREACH v_campo IN ARRAY (SELECT array_agg(DISTINCT x) FROM unnest(p_campos) x) LOOP
    INSERT INTO correcciones_perfil (profesional_id, campo, accion, motivo, huella, autor_id)
    VALUES (p_profesional_id, v_campo, 'PEDIDA', btrim(p_motivo),
            md5(coalesce(valor_campo_perfil(p_profesional_id, v_campo), '')), app_usuario_id());
    campo := v_campo;
    solicitudes := solicitudes_sin_cambio(p_profesional_id, v_campo);
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION pedir_correccion_perfil(uuid, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pedir_correccion_perfil(uuid, text[], text) TO app_user;

-- La cuenta madre corrige un campo de texto a la segunda solicitud sin cambios.
-- p_valor: texto (enfoques separados por coma). La foto no se corrige aca.
CREATE FUNCTION corregir_campo_perfil(p_profesional_id uuid, p_campo text, p_valor text, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_valor text := nullif(btrim(p_valor), '');
BEGIN
  IF NOT acceso_vigente() OR app_rol() <> 'ADMIN' OR p_profesional_id = app_usuario_id() THEN
    RAISE EXCEPTION 'Solo la cuenta madre corrige un perfil ajeno' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_campo NOT IN ('nombre_publico', 'especialidad', 'cita_destacada', 'bio', 'enfoques') THEN
    RAISE EXCEPTION 'Ese campo no lo corrige la cuenta madre'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'correccion_campo_editable';
  END IF;
  IF solicitudes_sin_cambio(p_profesional_id, p_campo) < 2 THEN
    RAISE EXCEPTION 'Se corrige a la segunda solicitud del mismo campo sin cambios'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'correccion_requiere_segunda_solicitud';
  END IF;
  IF p_campo = 'especialidad' AND (v_valor IS NULL OR char_length(v_valor) NOT BETWEEN 2 AND 120)
     OR p_campo = 'nombre_publico' AND char_length(v_valor) NOT BETWEEN 2 AND 120
     OR p_campo = 'cita_destacada' AND char_length(v_valor) > 300
     OR p_campo = 'bio' AND char_length(v_valor) > 2000 THEN
    RAISE EXCEPTION 'Valor invalido para el campo' USING ERRCODE = 'check_violation', CONSTRAINT = 'correccion_valor';
  END IF;
  UPDATE profesionales SET
    nombre_publico = CASE WHEN p_campo = 'nombre_publico' THEN v_valor ELSE nombre_publico END,
    especialidad = CASE WHEN p_campo = 'especialidad' THEN v_valor ELSE especialidad END,
    cita_destacada = CASE WHEN p_campo = 'cita_destacada' THEN v_valor ELSE cita_destacada END,
    bio = CASE WHEN p_campo = 'bio' THEN v_valor ELSE bio END,
    enfoques = CASE WHEN p_campo = 'enfoques'
                    THEN coalesce(ARRAY(SELECT btrim(x) FROM unnest(string_to_array(v_valor, ',')) x WHERE btrim(x) <> ''), '{}')
                    ELSE enfoques END,
    updated_at = now()
  WHERE usuario_id = p_profesional_id;
  INSERT INTO correcciones_perfil (profesional_id, campo, accion, motivo, huella, autor_id)
  VALUES (p_profesional_id, p_campo, 'APLICADA', btrim(p_motivo),
          md5(coalesce(valor_campo_perfil(p_profesional_id, p_campo), '')), app_usuario_id());
END;
$$;
REVOKE EXECUTE ON FUNCTION corregir_campo_perfil(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION corregir_campo_perfil(uuid, text, text, text) TO app_user;

ALTER TABLE correcciones_perfil ENABLE ROW LEVEL SECURITY;
ALTER TABLE correcciones_perfil FORCE ROW LEVEL SECURITY;
CREATE POLICY correcciones_perfil_select ON correcciones_perfil FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()));
CREATE POLICY correcciones_perfil_acceso_vigente ON correcciones_perfil AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON correcciones_perfil TO app_user;

-- ADMIN/GESTION no editan los campos publicos de un perfil ajeno por UPDATE
-- directo (antes podian: "corrigen el perfil"). Lo hace corregir_campo_perfil
-- (SECURITY DEFINER: current_user es el dueño). Su propio perfil, si.
CREATE FUNCTION proteger_campos_publicos_perfil() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_user' AND app_rol() IN ('ADMIN', 'GESTION') AND NEW.usuario_id IS DISTINCT FROM app_usuario_id()
     AND (NEW.nombre_publico, NEW.especialidad, NEW.cita_destacada, NEW.bio, NEW.enfoques, NEW.foto_url)
         IS DISTINCT FROM (OLD.nombre_publico, OLD.especialidad, OLD.cita_destacada, OLD.bio, OLD.enfoques, OLD.foto_url) THEN
    RAISE EXCEPTION 'El perfil publico lo corrige el profesional; la cuenta madre, a la segunda solicitud sin cambios'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profesionales_campos_publicos BEFORE UPDATE ON profesionales
  FOR EACH ROW EXECUTE FUNCTION proteger_campos_publicos_perfil();


-- -----------------------------------------------------------------------------
-- 1 (cont.). El sitio publico solo con profesionales validados.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.perfiles_publicos()
 RETURNS TABLE(id uuid, nombre_publico text, bio text, foto_url text, especialidad text, enfoques text[], modalidad modalidad, tipos_atencion text[], verificado boolean, titulos_verificados text[], tarifas jsonb, trayectoria jsonb, anios_experiencia integer, boleta_reembolsable boolean, convenios text[], idiomas text[], cita_destacada text, calificacion numeric, resenas integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p.usuario_id, p.nombre_publico, p.bio, p.foto_url, p.especialidad, p.enfoques, p.modalidad,
         ARRAY(SELECT t.nombre FROM profesional_tipos_atencion pt JOIN tipos_atencion t ON t.id = pt.tipo_atencion_id
               WHERE pt.profesional_id = p.usuario_id AND pt.estado = 'APROBADO' AND t.activo ORDER BY t.nombre),
         EXISTS (SELECT 1 FROM profesional_trayectoria tr WHERE tr.profesional_id = p.usuario_id AND tr.verificado),
         ARRAY(SELECT tr.titulo FROM profesional_trayectoria tr
               WHERE tr.profesional_id = p.usuario_id AND tr.verificado ORDER BY tr.anio, tr.titulo),
         (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo_atencion', ta.nombre, 'modalidad', v.modalidad, 'monto', v.monto)
                                    ORDER BY ta.nombre NULLS FIRST, v.modalidad NULLS FIRST), '[]'::jsonb)
          FROM (SELECT DISTINCT ON (tf.tipo_atencion_id, tf.modalidad) tf.tipo_atencion_id, tf.modalidad, tf.monto
                FROM tarifas tf
                WHERE tf.profesional_id = p.usuario_id AND tf.vigente_desde <= now()
                ORDER BY tf.tipo_atencion_id, tf.modalidad, tf.vigente_desde DESC, tf.created_at DESC) v
          LEFT JOIN tipos_atencion ta ON ta.id = v.tipo_atencion_id),
         (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo', tr.tipo, 'titulo', tr.titulo, 'institucion', tr.institucion,
                                                       'anio', tr.anio) ORDER BY tr.anio DESC, tr.titulo), '[]'::jsonb)
          FROM profesional_trayectoria tr WHERE tr.profesional_id = p.usuario_id AND tr.verificado),
         (SELECT extract(year FROM now())::int - min(tr.anio) FROM profesional_trayectoria tr
          WHERE tr.profesional_id = p.usuario_id AND tr.verificado AND tr.tipo = 'TITULO'),
         p.boleta_reembolsable, coalesce(p.convenios, '{}'), coalesce(p.idiomas, '{}'), p.cita_destacada,
         (SELECT round(avg(r.calificacion), 1) FROM resenas r WHERE r.profesional_id = p.usuario_id AND r.estado = 'PUBLICADA'),
         (SELECT count(*)::int FROM resenas r WHERE r.profesional_id = p.usuario_id AND r.estado = 'PUBLICADA')
  FROM profesionales p JOIN usuarios u ON u.id = p.usuario_id
  WHERE p.perfil_publico AND tiene_rol(u.id, 'PROFESIONAL') AND profesional_validado(u.id)
    AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM roles_adicionales ra WHERE ra.usuario_id = u.id AND ra.rol = 'PROFESIONAL'
                    AND ra.fecha_baja IS NOT NULL)
  ORDER BY p.nombre_publico
$function$;

CREATE OR REPLACE FUNCTION public.registros_sis_publicos()
 RETURNS TABLE(profesional_id uuid, numero text, estado text, verificado_en timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT r.profesional_id, r.numero, r.estado, r.verificado_en
  FROM registros_sis r JOIN profesionales p ON p.usuario_id = r.profesional_id
  WHERE p.perfil_publico AND profesional_validado(p.usuario_id) AND r.estado IN ('VERIFICADO_AUTOMATICO', 'VERIFICADO_MANUAL')
$function$;

CREATE OR REPLACE FUNCTION public.disponibilidad_publica(p_profesional_id uuid, desde timestamp with time zone, hasta timestamp with time zone)
 RETURNS TABLE(modalidad modalidad_atencion, inicio timestamp with time zone, fin timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_margen int := margen_vigente(p_profesional_id);
BEGIN
  IF desde IS NULL OR hasta IS NULL OR hasta <= desde OR hasta - desde > interval '62 days' THEN
    RAISE EXCEPTION 'Rango invalido (maximo 62 dias)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'disponibilidad_publica_rango';
  END IF;
  IF NOT (tiene_rol(p_profesional_id, 'PROFESIONAL') OR tiene_rol(p_profesional_id, 'PRACTICANTE'))
     OR NOT (acceso_vigente() OR EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico AND profesional_validado(usuario_id))) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH dias AS (
    SELECT g.dia::date AS dia
    FROM generate_series((desde AT TIME ZONE 'America/Santiago')::date::timestamp,
                         (hasta AT TIME ZONE 'America/Santiago')::date::timestamp, interval '1 day') AS g(dia)
  ), ventanas AS (
    SELECT mm.m, tstzrange(b.inicio, b.fin, '[)') AS r
    FROM bloques_atencion b CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE b.profesional_id = p_profesional_id AND b.fin > desde AND b.inicio < hasta
  ), centro AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM horario_centro)
                THEN (SELECT coalesce(range_agg(tstzrange(minuto_local(x.dia, h.inicio_min), minuto_local(x.dia, h.fin_min), '[)')),
                                      '{}'::tstzmultirange)
                      FROM dias x JOIN horario_centro h ON h.dia_semana = extract(isodow FROM x.dia))
                ELSE '{}'::tstzmultirange END AS r
  ), ocupado AS (
    SELECT mm.m,
           CASE WHEN c.modalidad = mm.m THEN tstzrange(c.inicio, c.fin, '[)')
                ELSE rango_con_margen(c.inicio, c.fin, c.margen_traslado_min + v_margen) END AS r
    FROM citas c CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE c.profesional_id = p_profesional_id AND c.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA')
    UNION ALL
    SELECT mm.m, tstzrange(b.inicio, b.fin, '[)')
    FROM bloqueos_agenda b CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE b.profesional_id = p_profesional_id
    UNION ALL
    SELECT mm.m,
           CASE WHEN t.modalidad = mm.m THEN tstzrange(t.inicio, t.fin, '[)')
                ELSE rango_con_margen(t.inicio, t.fin, 2 * v_margen) END
    FROM bloqueos_temporales t CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE t.profesional_id = p_profesional_id AND t.expira_en > now()
  ), libres AS (
    SELECT v.m,
           unnest((range_agg(v.r) - coalesce((SELECT range_agg(o.r) FROM ocupado o WHERE o.m = v.m), '{}'::tstzmultirange))
                  * tstzmultirange(tstzrange(desde, hasta, '[)')) * (SELECT c.r FROM centro c)) AS r
    FROM ventanas v GROUP BY v.m
  )
  SELECT l.m, lower(l.r), upper(l.r) FROM libres l ORDER BY 2, 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_solicitud_hora(p_id uuid, p_profesional_id uuid, p_modalidad modalidad_atencion, p_inicio timestamp with time zone, p_fin timestamp with time zone, p_nombre text, p_apellido text, p_fecha_nacimiento date, p_email text, p_telefono bytea, p_rut bytea, p_rut_hmac bytea, p_adulto_nombre text, p_adulto_parentesco text, p_adulto_telefono bytea, p_respuestas bytea, p_recomendado_id uuid, p_politica_id uuid, p_terminos_id uuid, p_token_hash bytea, p_reserva_hash bytea)
 RETURNS TABLE(expira timestamp with time zone, cita_id uuid, verificar_correo boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_expira timestamptz := plazo_pago(p_inicio);
  v_espacio uuid;
  v_cita uuid;
  v_verificar boolean;
BEGIN
  IF p_inicio <= now() THEN
    RAISE EXCEPTION 'La hora ya paso' USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_hora_coherente';
  END IF;
  IF p_politica_id IS DISTINCT FROM (SELECT id FROM politica_vigente('POLITICA_DATOS'))
     OR p_terminos_id IS DISTINCT FROM (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')) THEN
    RAISE EXCEPTION 'Hay una version nueva de la politica: vuelva a aceptarla'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
  END IF;
  IF age((p_inicio AT TIME ZONE 'America/Santiago')::date, p_fecha_nacimiento) < interval '18 years'
     AND coalesce(btrim(p_adulto_nombre), '') = '' THEN
    RAISE EXCEPTION 'Paciente menor de 18: el solicitante se declara adulto responsable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_menor_requiere_adulto_responsable';
  END IF;
  IF (SELECT count(*) FROM solicitudes_hora s JOIN citas c ON c.id = s.cita_id
      WHERE lower(s.email) = lower(p_email) AND s.estado = 'PENDIENTE_VERIFICACION' AND c.estado = 'RETENIDA'
        AND c.pago_vence_en > now()) >= 2 THEN
    RAISE EXCEPTION 'Ya hay reservas en curso para este correo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_hora_limite';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico)
     OR NOT profesional_validado(p_profesional_id)
     OR NOT tiene_rol(p_profesional_id, 'PROFESIONAL')
     OR EXISTS (SELECT 1 FROM bajas WHERE usuario_id = p_profesional_id)
     OR NOT EXISTS (SELECT 1 FROM disponibilidad_publica(p_profesional_id, p_inicio - interval '1 minute', p_fin + interval '1 minute') d
                    WHERE d.modalidad = p_modalidad AND d.inicio <= p_inicio AND d.fin >= p_fin) THEN
    RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_disponible';
  END IF;
  IF p_modalidad = 'ONLINE' AND NOT EXISTS (SELECT 1 FROM salas_videollamada s WHERE s.usuario_id = p_profesional_id
                                            AND (s.modo = 'JITSI' OR s.enlace IS NOT NULL)) THEN
    RAISE EXCEPTION 'El profesional no atiende online por el portal'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'videollamada_sin_sala';
  END IF;

  -- Presencial: la BD le pone el box del bloque del profesional (validar_agenda_cita).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, pago_vence_en)
  VALUES (p_modalidad, p_profesional_id, NULL, p_inicio, p_fin, 'RETENIDA', v_expira)
  RETURNING id, espacio_id INTO v_cita, v_espacio;

  INSERT INTO solicitudes_hora (id, profesional_id, modalidad, espacio_id, inicio, fin, nombre, apellido, fecha_nacimiento,
                                email, telefono, rut, rut_hmac, adulto_nombre, adulto_parentesco, adulto_telefono,
                                respuestas, recomendado_id, politica_id, terminos_id, expira_en, reserva_hash, cita_id)
  VALUES (p_id, p_profesional_id, p_modalidad, v_espacio, p_inicio, p_fin, btrim(p_nombre), btrim(p_apellido),
          p_fecha_nacimiento, lower(btrim(p_email)), p_telefono, p_rut, p_rut_hmac, nullif(btrim(p_adulto_nombre), ''),
          p_adulto_parentesco, p_adulto_telefono, p_respuestas, p_recomendado_id,
          p_politica_id, p_terminos_id, v_expira, p_reserva_hash, v_cita);

  v_verificar := medios_confirmacion_vigentes() = ARRAY['PAGO_EN_CENTRO']::medio_confirmacion[] OR monto_confirmacion(v_cita) = 0;
  IF v_verificar THEN
    PERFORM emitir_token('VERIFICACION_SOLICITUD', p_token_hash, least(p_inicio, now() + interval '24 hours'),
                         NULL, NULL, NULL, p_id, NULL, lower(btrim(p_email)));
  END IF;
  RETURN QUERY SELECT v_expira, v_cita, v_verificar;
END;
$function$;

