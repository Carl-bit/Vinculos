-- =============================================================================
-- 03a-2: campos clinicos por especialidad (especialidades, plantillas
-- versionadas, ficha de ingreso, valores en evoluciones y borradores) y
-- mensajeria interna del equipo (hilos GENERAL y CASO). Ademas, decisiones
-- de brechas.md seccion 7: edad minima de la cuenta configurable, duplicados
-- solo por administracion (alerta y aviso), RUT antes de la primera evolucion
-- para todo paciente y reintento de correos de cuenta.
-- Seccion 1: diff de Prisma. Secciones siguientes: reglas, RLS y funciones.
-- =============================================================================

-- CreateEnum
CREATE TYPE "tipo_plantilla_clinica" AS ENUM ('INGRESO', 'EVOLUCION');

-- CreateEnum
CREATE TYPE "estado_plantilla_clinica" AS ENUM ('BORRADOR', 'PUBLICADA', 'INACTIVA');

-- CreateEnum
CREATE TYPE "tipo_hilo_interno" AS ENUM ('GENERAL', 'CASO');

-- AlterTable
ALTER TABLE "borradores_evolucion" ADD COLUMN     "plantilla_id" UUID,
ADD COLUMN     "valores" BYTEA;

-- AlterTable
ALTER TABLE "configuracion_centro" ADD COLUMN     "edad_minima_cuenta" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "retencion_mensajes_dias" INTEGER NOT NULL DEFAULT 365;

-- AlterTable
ALTER TABLE "evoluciones" ADD COLUMN     "plantilla_id" UUID,
ADD COLUMN     "valores" BYTEA;

-- CreateTable
CREATE TABLE "especialidades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "especialidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profesional_especialidades" (
    "profesional_id" UUID NOT NULL,
    "especialidad_id" UUID NOT NULL,
    "estado" "estado_tipo_sesion" NOT NULL DEFAULT 'PROPUESTO',
    "revisado_por_id" UUID,
    "revisado_en" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profesional_especialidades_pkey" PRIMARY KEY ("profesional_id","especialidad_id")
);

-- CreateTable
CREATE TABLE "plantillas_clinicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "familia_id" UUID NOT NULL,
    "especialidad_id" UUID NOT NULL,
    "tipo" "tipo_plantilla_clinica" NOT NULL,
    "nombre" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "estado" "estado_plantilla_clinica" NOT NULL DEFAULT 'BORRADOR',
    "definicion" JSONB NOT NULL,
    "propuesta_por_id" UUID,
    "publicada_por_id" UUID,
    "publicada_en" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plantillas_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingresos_ficha" (
    "id" UUID NOT NULL,
    "ficha_clinica_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "plantilla_id" UUID NOT NULL,
    "valores" BYTEA NOT NULL,
    "corrige_a_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "ingresos_ficha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hilos_internos" (
    "id" UUID NOT NULL,
    "tipo" "tipo_hilo_interno" NOT NULL,
    "asunto" BYTEA NOT NULL,
    "paciente_id" UUID,
    "creado_por_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_mensaje_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hilos_internos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participantes_hilo" (
    "hilo_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "agregado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participantes_hilo_pkey" PRIMARY KEY ("hilo_id","usuario_id")
);

-- CreateTable
CREATE TABLE "mensajes_internos" (
    "id" UUID NOT NULL,
    "hilo_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "rol_autor" "rol" NOT NULL,
    "contenido" BYTEA,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retirado_en" TIMESTAMPTZ(6),

    CONSTRAINT "mensajes_internos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lecturas_hilo" (
    "hilo_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "leido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lecturas_hilo_pkey" PRIMARY KEY ("hilo_id","usuario_id")
);

-- CreateTable
CREATE TABLE "correos_cuenta_pendientes" (
    "id" UUID NOT NULL,
    "email" BYTEA NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" BYTEA NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 1,
    "proximo_intento" TIMESTAMPTZ(6) NOT NULL,
    "vence_en" TIMESTAMPTZ(6) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correos_cuenta_pendientes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "especialidades_nombre_key" ON "especialidades"("nombre");

-- CreateIndex
CREATE INDEX "profesional_especialidades_especialidad_id_idx" ON "profesional_especialidades"("especialidad_id");

-- CreateIndex
CREATE INDEX "plantillas_clinicas_especialidad_id_tipo_idx" ON "plantillas_clinicas"("especialidad_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_clinicas_familia_id_version_key" ON "plantillas_clinicas"("familia_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ingresos_ficha_corrige_a_id_key" ON "ingresos_ficha"("corrige_a_id");

-- CreateIndex
CREATE INDEX "ingresos_ficha_ficha_clinica_id_created_at_idx" ON "ingresos_ficha"("ficha_clinica_id", "created_at");

-- CreateIndex
CREATE INDEX "hilos_internos_paciente_id_idx" ON "hilos_internos"("paciente_id");

-- CreateIndex
CREATE INDEX "hilos_internos_ultimo_mensaje_en_idx" ON "hilos_internos"("ultimo_mensaje_en");

-- CreateIndex
CREATE INDEX "participantes_hilo_usuario_id_idx" ON "participantes_hilo"("usuario_id");

-- CreateIndex
CREATE INDEX "mensajes_internos_hilo_id_creado_en_idx" ON "mensajes_internos"("hilo_id", "creado_en");

-- CreateIndex
CREATE INDEX "mensajes_internos_creado_en_idx" ON "mensajes_internos"("creado_en");

-- CreateIndex
CREATE INDEX "correos_cuenta_pendientes_proximo_intento_idx" ON "correos_cuenta_pendientes"("proximo_intento");

-- AddForeignKey
ALTER TABLE "evoluciones" ADD CONSTRAINT "evoluciones_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantillas_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borradores_evolucion" ADD CONSTRAINT "borradores_evolucion_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantillas_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesional_especialidades" ADD CONSTRAINT "profesional_especialidades_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesional_especialidades" ADD CONSTRAINT "profesional_especialidades_especialidad_id_fkey" FOREIGN KEY ("especialidad_id") REFERENCES "especialidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesional_especialidades" ADD CONSTRAINT "profesional_especialidades_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantillas_clinicas" ADD CONSTRAINT "plantillas_clinicas_especialidad_id_fkey" FOREIGN KEY ("especialidad_id") REFERENCES "especialidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantillas_clinicas" ADD CONSTRAINT "plantillas_clinicas_propuesta_por_id_fkey" FOREIGN KEY ("propuesta_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantillas_clinicas" ADD CONSTRAINT "plantillas_clinicas_publicada_por_id_fkey" FOREIGN KEY ("publicada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_ficha" ADD CONSTRAINT "ingresos_ficha_ficha_clinica_id_fkey" FOREIGN KEY ("ficha_clinica_id") REFERENCES "fichas_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_ficha" ADD CONSTRAINT "ingresos_ficha_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_ficha" ADD CONSTRAINT "ingresos_ficha_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantillas_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_ficha" ADD CONSTRAINT "ingresos_ficha_corrige_a_id_fkey" FOREIGN KEY ("corrige_a_id") REFERENCES "ingresos_ficha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hilos_internos" ADD CONSTRAINT "hilos_internos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hilos_internos" ADD CONSTRAINT "hilos_internos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participantes_hilo" ADD CONSTRAINT "participantes_hilo_hilo_id_fkey" FOREIGN KEY ("hilo_id") REFERENCES "hilos_internos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participantes_hilo" ADD CONSTRAINT "participantes_hilo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_internos" ADD CONSTRAINT "mensajes_internos_hilo_id_fkey" FOREIGN KEY ("hilo_id") REFERENCES "hilos_internos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_internos" ADD CONSTRAINT "mensajes_internos_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecturas_hilo" ADD CONSTRAINT "lecturas_hilo_hilo_id_fkey" FOREIGN KEY ("hilo_id") REFERENCES "hilos_internos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecturas_hilo" ADD CONSTRAINT "lecturas_hilo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 2. Especialidades (B) y especialidades del profesional (B)
-- =============================================================================
ALTER TABLE especialidades ADD CONSTRAINT especialidades_nombre_valido CHECK (length(btrim(nombre)) BETWEEN 2 AND 80);
INSERT INTO especialidades (nombre) VALUES
  ('Psicología'), ('Psiquiatría'), ('Fonoaudiología'), ('Terapia ocupacional'), ('Nutrición');

ALTER TABLE especialidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE especialidades FORCE ROW LEVEL SECURITY;
CREATE POLICY especialidades_select ON especialidades FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'));
CREATE POLICY especialidades_insert ON especialidades FOR INSERT TO app_user WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY especialidades_update ON especialidades FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
GRANT SELECT, INSERT ON especialidades TO app_user;
GRANT UPDATE (nombre, activo, updated_at) ON especialidades TO app_user;

-- El profesional declara (PROPUESTO); solo ADMIN revisa (revisar_especialidad).
ALTER TABLE profesional_especialidades ADD CONSTRAINT profesional_especialidades_revision_coherente
  CHECK ((estado = 'PROPUESTO') = (revisado_por_id IS NULL AND revisado_en IS NULL));
ALTER TABLE profesional_especialidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE profesional_especialidades FORCE ROW LEVEL SECURITY;
CREATE POLICY profesional_especialidades_select ON profesional_especialidades FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR profesional_id = (SELECT app_usuario_id())
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE') AND estado = 'APROBADO'));
CREATE POLICY profesional_especialidades_insert ON profesional_especialidades FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'PROFESIONAL' AND profesional_id = (SELECT app_usuario_id()) AND estado = 'PROPUESTO'
              AND especialidad_id IN (SELECT id FROM especialidades WHERE activo));
GRANT SELECT, INSERT ON profesional_especialidades TO app_user;

CREATE FUNCTION revisar_especialidad(p_profesional_id uuid, p_especialidad_id uuid, p_aprobar boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN revisa especialidades' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE profesional_especialidades
  SET estado = CASE WHEN p_aprobar THEN 'APROBADO' ELSE 'RECHAZADO' END::estado_tipo_sesion,
      revisado_por_id = app_usuario_id(), revisado_en = now()
  WHERE profesional_id = p_profesional_id AND especialidad_id = p_especialidad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Especialidad no declarada' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

CREATE FUNCTION tiene_especialidad(p_usuario_id uuid, p_especialidad_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM profesional_especialidades
                 WHERE profesional_id = p_usuario_id AND especialidad_id = p_especialidad_id AND estado = 'APROBADO')
$$;

-- =============================================================================
-- 3. Plantillas clinicas (B), versionadas
-- =============================================================================
-- Definicion: arreglo de campos {clave, etiqueta, tipo, obligatorio, opciones,
-- orden, visible_en_supervision, es_texto_libre}; claves unicas; opciones
-- solo (y obligatorias) en las selecciones.
CREATE FUNCTION definicion_plantilla_valida(d jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c jsonb;
  v_claves text[] := '{}';
  v_sel boolean;
BEGIN
  IF jsonb_typeof(d) IS DISTINCT FROM 'array' OR jsonb_array_length(d) NOT BETWEEN 1 AND 60 THEN
    RETURN false;
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(d) LOOP
    IF jsonb_typeof(c) <> 'object'
       OR NOT (c ?& ARRAY['clave', 'etiqueta', 'tipo', 'obligatorio', 'orden', 'visible_en_supervision', 'es_texto_libre'])
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(c) k
                  WHERE k NOT IN ('clave', 'etiqueta', 'tipo', 'obligatorio', 'opciones', 'orden', 'visible_en_supervision',
                                  'es_texto_libre'))
       OR jsonb_typeof(c->'clave') <> 'string' OR (c->>'clave') !~ '^[a-z][a-z0-9_]{0,39}$'
       OR jsonb_typeof(c->'etiqueta') <> 'string' OR length(btrim(c->>'etiqueta')) NOT BETWEEN 1 AND 120
       OR (c->>'tipo') NOT IN ('TEXTO', 'TEXTO_LARGO', 'NUMERO', 'FECHA', 'SELECCION_UNICA', 'SELECCION_MULTIPLE', 'SI_NO')
       OR jsonb_typeof(c->'obligatorio') <> 'boolean' OR jsonb_typeof(c->'orden') <> 'number'
       OR jsonb_typeof(c->'visible_en_supervision') <> 'boolean' OR jsonb_typeof(c->'es_texto_libre') <> 'boolean'
       OR (c->>'clave') = ANY (v_claves) THEN
      RETURN false;
    END IF;
    v_sel := (c->>'tipo') IN ('SELECCION_UNICA', 'SELECCION_MULTIPLE');
    IF v_sel AND (jsonb_typeof(c->'opciones') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'opciones') NOT BETWEEN 1 AND 50
                  OR EXISTS (SELECT 1 FROM jsonb_array_elements(c->'opciones') o WHERE jsonb_typeof(o) <> 'string')
                  OR (SELECT count(DISTINCT o) FROM jsonb_array_elements_text(c->'opciones') o) <> jsonb_array_length(c->'opciones'))
       OR (NOT v_sel AND c ? 'opciones') THEN
      RETURN false;
    END IF;
    v_claves := v_claves || (c->>'clave');
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE plantillas_clinicas ADD CONSTRAINT plantillas_clinicas_validas
  CHECK (version >= 1 AND length(btrim(nombre)) BETWEEN 2 AND 120 AND definicion_plantilla_valida(definicion)
         AND ((estado = 'BORRADOR') = (publicada_en IS NULL)));
-- Una version publicada y a lo mas un borrador por familia.
CREATE UNIQUE INDEX plantillas_clinicas_una_publicada ON plantillas_clinicas (familia_id) WHERE estado = 'PUBLICADA';
CREATE UNIQUE INDEX plantillas_clinicas_un_borrador ON plantillas_clinicas (familia_id) WHERE estado = 'BORRADOR';

-- Inmutable una vez publicada: solo PUBLICADA -> INACTIVA. Nunca DELETE.
CREATE FUNCTION proteger_plantilla_clinica() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'plantillas_clinicas no se borran (se desactivan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.familia_id <> OLD.familia_id OR NEW.version <> OLD.version
     OR NEW.especialidad_id <> OLD.especialidad_id OR NEW.tipo <> OLD.tipo
     OR NEW.propuesta_por_id IS DISTINCT FROM OLD.propuesta_por_id THEN
    RAISE EXCEPTION 'Identidad de la plantilla inmutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.estado <> 'BORRADOR' AND (NEW.nombre <> OLD.nombre OR NEW.definicion <> OLD.definicion
                                   OR NEW.publicada_en IS DISTINCT FROM OLD.publicada_en
                                   OR NEW.publicada_por_id IS DISTINCT FROM OLD.publicada_por_id
                                   OR NOT (NEW.estado = OLD.estado OR (OLD.estado = 'PUBLICADA' AND NEW.estado = 'INACTIVA'))) THEN
    RAISE EXCEPTION 'Una version publicada es inmutable: cree una version nueva' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER plantillas_clinicas_protegidas BEFORE UPDATE OR DELETE ON plantillas_clinicas
  FOR EACH ROW EXECUTE FUNCTION proteger_plantilla_clinica();

ALTER TABLE plantillas_clinicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantillas_clinicas FORCE ROW LEVEL SECURITY;
-- Publicadas e inactivas: todo el equipo (los registros antiguos se muestran con su version).
-- Borradores: ADMIN y quien los propuso.
CREATE POLICY plantillas_clinicas_select ON plantillas_clinicas FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
         AND (estado <> 'BORRADOR' OR (SELECT app_rol()) = 'ADMIN' OR propuesta_por_id = (SELECT app_usuario_id())));
GRANT SELECT ON plantillas_clinicas TO app_user;

-- Quien puede proponer o editar: ADMIN, o PROFESIONAL con la especialidad aprobada.
CREATE FUNCTION puede_proponer_plantilla(p_especialidad_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT acceso_vigente() AND (app_rol() = 'ADMIN'
                               OR (app_rol() = 'PROFESIONAL' AND tiene_especialidad(app_usuario_id(), p_especialidad_id)))
$$;

CREATE FUNCTION proponer_plantilla(p_especialidad_id uuid, p_tipo tipo_plantilla_clinica, p_nombre text, p_definicion jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT puede_proponer_plantilla(p_especialidad_id) THEN
    RAISE EXCEPTION 'Proponen ADMIN o un profesional con esa especialidad aprobada' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM especialidades WHERE id = p_especialidad_id AND activo) THEN
    RAISE EXCEPTION 'Especialidad inexistente o inactiva' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO plantillas_clinicas (id, familia_id, especialidad_id, tipo, nombre, version, definicion, propuesta_por_id)
  VALUES (v_id, v_id, p_especialidad_id, p_tipo, btrim(p_nombre), 1, p_definicion, app_usuario_id());
  RETURN v_id;
END;
$$;

-- Editar = nueva version (BORRADOR) de una familia, desde cualquier version.
CREATE FUNCTION nueva_version_plantilla(p_plantilla_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b plantillas_clinicas%ROWTYPE;
  v_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO b FROM plantillas_clinicas WHERE id = p_plantilla_id;
  IF NOT FOUND OR NOT puede_proponer_plantilla(b.especialidad_id) THEN
    RAISE EXCEPTION 'Plantilla inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM plantillas_clinicas WHERE familia_id = b.familia_id AND estado = 'BORRADOR') THEN
    RAISE EXCEPTION 'Ya hay una version en borrador de esta plantilla' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO plantillas_clinicas (id, familia_id, especialidad_id, tipo, nombre, version, definicion, propuesta_por_id)
  SELECT v_id, b.familia_id, b.especialidad_id, b.tipo, b.nombre, max(version) + 1, b.definicion, app_usuario_id()
  FROM plantillas_clinicas WHERE familia_id = b.familia_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION editar_plantilla(p_plantilla_id uuid, p_nombre text, p_definicion jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b plantillas_clinicas%ROWTYPE;
BEGIN
  SELECT * INTO b FROM plantillas_clinicas WHERE id = p_plantilla_id FOR UPDATE;
  IF NOT FOUND OR NOT acceso_vigente()
     OR NOT (app_rol() = 'ADMIN' OR (b.propuesta_por_id = app_usuario_id() AND puede_proponer_plantilla(b.especialidad_id))) THEN
    RAISE EXCEPTION 'Plantilla inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF b.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'Solo se edita un borrador: cree una version nueva' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE plantillas_clinicas SET nombre = coalesce(btrim(p_nombre), nombre), definicion = coalesce(p_definicion, definicion)
  WHERE id = p_plantilla_id;
END;
$$;

-- Solo ADMIN publica; la publicada anterior de la familia queda INACTIVA.
CREATE FUNCTION publicar_plantilla(p_plantilla_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b plantillas_clinicas%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN publica plantillas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO b FROM plantillas_clinicas WHERE id = p_plantilla_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plantilla inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF b.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'Solo se publica un borrador' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE plantillas_clinicas SET estado = 'INACTIVA' WHERE familia_id = b.familia_id AND estado = 'PUBLICADA';
  UPDATE plantillas_clinicas SET estado = 'PUBLICADA', publicada_en = now(), publicada_por_id = app_usuario_id()
  WHERE id = p_plantilla_id;
END;
$$;

-- Desactivar una publicada (deja de usarse para registros nuevos). Un borrador no se desactiva: se edita o se publica.
CREATE FUNCTION desactivar_plantilla(p_plantilla_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN desactiva plantillas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE plantillas_clinicas SET estado = 'INACTIVA' WHERE id = p_plantilla_id AND estado = 'PUBLICADA';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo se desactiva una version publicada' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END;
$$;

-- Ejemplos por especialidad (sin autor; publicados). El centro los desactiva o crea versiones.
INSERT INTO plantillas_clinicas (id, familia_id, especialidad_id, tipo, nombre, version, estado, definicion, publicada_en)
SELECT x.id, x.id, e.id, x.tipo::tipo_plantilla_clinica, x.nombre, 1, 'PUBLICADA', x.definicion::jsonb, now()
FROM (SELECT gen_random_uuid() AS id, v.*
      FROM (VALUES
  ('Psicología', 'INGRESO', 'Anamnesis psicológica', '[
    {"clave":"motivo_consulta","etiqueta":"Motivo de consulta","tipo":"TEXTO_LARGO","obligatorio":true,"orden":1,"visible_en_supervision":true,"es_texto_libre":true},
    {"clave":"antecedentes_salud_mental","etiqueta":"Antecedentes de salud mental","tipo":"TEXTO_LARGO","obligatorio":false,"orden":2,"visible_en_supervision":true,"es_texto_libre":true},
    {"clave":"tratamiento_previo","etiqueta":"Tratamiento psicológico previo","tipo":"SI_NO","obligatorio":true,"orden":3,"visible_en_supervision":true,"es_texto_libre":false},
    {"clave":"red_apoyo","etiqueta":"Red de apoyo","tipo":"SELECCION_UNICA","obligatorio":false,"opciones":["Suficiente","Parcial","Insuficiente"],"orden":4,"visible_en_supervision":true,"es_texto_libre":false}
  ]'),
  ('Psicología', 'EVOLUCION', 'Sesión de psicoterapia', '[
    {"clave":"objetivo_sesion","etiqueta":"Objetivo de la sesión","tipo":"TEXTO","obligatorio":true,"orden":1,"visible_en_supervision":true,"es_texto_libre":true},
    {"clave":"tareas","etiqueta":"Tareas acordadas","tipo":"TEXTO_LARGO","obligatorio":false,"orden":2,"visible_en_supervision":true,"es_texto_libre":true},
    {"clave":"adherencia","etiqueta":"Adherencia","tipo":"SELECCION_UNICA","obligatorio":false,"opciones":["Alta","Media","Baja"],"orden":3,"visible_en_supervision":true,"es_texto_libre":false}
  ]'),
  ('Psiquiatría', 'INGRESO', 'Evaluación psiquiátrica', '[
    {"clave":"motivo_consulta","etiqueta":"Motivo de consulta","tipo":"TEXTO_LARGO","obligatorio":true,"orden":1,"visible_en_supervision":false,"es_texto_libre":true},
    {"clave":"farmacos_actuales","etiqueta":"Fármacos actuales","tipo":"TEXTO_LARGO","obligatorio":false,"orden":2,"visible_en_supervision":false,"es_texto_libre":true},
    {"clave":"hospitalizaciones_previas","etiqueta":"Hospitalizaciones psiquiátricas previas","tipo":"SI_NO","obligatorio":true,"orden":3,"visible_en_supervision":false,"es_texto_libre":false}
  ]'),
  ('Psiquiatría', 'EVOLUCION', 'Control psiquiátrico', '[
    {"clave":"ajuste_farmacologico","etiqueta":"Ajuste farmacológico","tipo":"SI_NO","obligatorio":true,"orden":1,"visible_en_supervision":false,"es_texto_libre":false},
    {"clave":"indicaciones","etiqueta":"Indicaciones","tipo":"TEXTO_LARGO","obligatorio":false,"orden":2,"visible_en_supervision":false,"es_texto_libre":true},
    {"clave":"proximo_control","etiqueta":"Próximo control","tipo":"FECHA","obligatorio":false,"orden":3,"visible_en_supervision":false,"es_texto_libre":false}
  ]'),
  ('Fonoaudiología', 'INGRESO', 'Evaluación fonoaudiológica', '[
    {"clave":"area_consulta","etiqueta":"Área de consulta","tipo":"SELECCION_MULTIPLE","obligatorio":true,"opciones":["Lenguaje","Habla","Voz","Deglución","Audición"],"orden":1,"visible_en_supervision":true,"es_texto_libre":false},
    {"clave":"observaciones","etiqueta":"Observaciones","tipo":"TEXTO_LARGO","obligatorio":false,"orden":2,"visible_en_supervision":true,"es_texto_libre":true}
  ]'),
  ('Fonoaudiología', 'EVOLUCION', 'Sesión de fonoaudiología', '[
    {"clave":"actividades","etiqueta":"Actividades realizadas","tipo":"TEXTO_LARGO","obligatorio":true,"orden":1,"visible_en_supervision":true,"es_texto_libre":true},
    {"clave":"logro","etiqueta":"Logro del objetivo (%)","tipo":"NUMERO","obligatorio":false,"orden":2,"visible_en_supervision":true,"es_texto_libre":false}
  ]'),
  ('Terapia ocupacional', 'INGRESO', 'Evaluación de terapia ocupacional', '[
    {"clave":"desempeno_ocupacional","etiqueta":"Desempeño ocupacional","tipo":"TEXTO_LARGO","obligatorio":true,"orden":1,"visible_en_supervision":true,"es_texto_libre":true},
    {"clave":"nivel_autonomia","etiqueta":"Nivel de autonomía","tipo":"SELECCION_UNICA","obligatorio":true,"opciones":["Independiente","Asistencia parcial","Dependiente"],"orden":2,"visible_en_supervision":true,"es_texto_libre":false}
  ]'),
  ('Terapia ocupacional', 'EVOLUCION', 'Sesión de terapia ocupacional', '[
    {"clave":"actividades","etiqueta":"Actividades realizadas","tipo":"TEXTO_LARGO","obligatorio":true,"orden":1,"visible_en_supervision":true,"es_texto_libre":true}
  ]'),
  ('Nutrición', 'INGRESO', 'Evaluación nutricional', '[
    {"clave":"peso_kg","etiqueta":"Peso (kg)","tipo":"NUMERO","obligatorio":true,"orden":1,"visible_en_supervision":true,"es_texto_libre":false},
    {"clave":"talla_cm","etiqueta":"Talla (cm)","tipo":"NUMERO","obligatorio":true,"orden":2,"visible_en_supervision":true,"es_texto_libre":false},
    {"clave":"habitos","etiqueta":"Hábitos alimentarios","tipo":"TEXTO_LARGO","obligatorio":false,"orden":3,"visible_en_supervision":true,"es_texto_libre":true}
  ]'),
  ('Nutrición', 'EVOLUCION', 'Control nutricional', '[
    {"clave":"peso_kg","etiqueta":"Peso (kg)","tipo":"NUMERO","obligatorio":true,"orden":1,"visible_en_supervision":true,"es_texto_libre":false},
    {"clave":"indicaciones","etiqueta":"Indicaciones","tipo":"TEXTO_LARGO","obligatorio":false,"orden":2,"visible_en_supervision":true,"es_texto_libre":true}
  ]')
      ) AS v(especialidad, tipo, nombre, definicion)) x
JOIN especialidades e ON e.nombre = x.especialidad;

-- =============================================================================
-- 4. Uso de plantillas: ficha de ingreso (A), evoluciones y borradores
-- =============================================================================
ALTER TABLE evoluciones ADD CONSTRAINT evoluciones_plantilla_coherente
  CHECK ((plantilla_id IS NULL) = (valores IS NULL) AND (valores IS NULL OR octet_length(valores) >= 49));
ALTER TABLE borradores_evolucion ADD CONSTRAINT borradores_evolucion_plantilla_coherente
  CHECK ((plantilla_id IS NULL) = (valores IS NULL) AND (valores IS NULL OR octet_length(valores) >= 49));
ALTER TABLE ingresos_ficha ADD CONSTRAINT ingresos_ficha_cifrado CHECK (octet_length(valores) >= 49);
GRANT UPDATE (plantilla_id, valores) ON borradores_evolucion TO app_user;

-- Registro nuevo: version PUBLICADA del tipo correcto (y, si escribe un
-- PROFESIONAL, de una especialidad suya aprobada). Correccion: la misma
-- version que el registro que corrige (aunque ya este INACTIVA).
CREATE FUNCTION validar_plantilla_registro() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tipo tipo_plantilla_clinica := CASE WHEN TG_TABLE_NAME = 'ingresos_ficha' THEN 'INGRESO' ELSE 'EVOLUCION' END;
  v_corregida uuid;
  p plantillas_clinicas%ROWTYPE;
BEGIN
  -- PL/pgSQL no corta el AND: borradores_evolucion no tiene corrige_a_id.
  IF TG_TABLE_NAME <> 'borradores_evolucion' THEN
    IF to_jsonb(NEW)->>'corrige_a_id' IS NOT NULL THEN
      EXECUTE format('SELECT plantilla_id FROM %I WHERE id = $1', TG_TABLE_NAME) INTO v_corregida
        USING (to_jsonb(NEW)->>'corrige_a_id')::uuid;
      IF NEW.plantilla_id IS DISTINCT FROM v_corregida THEN
        RAISE EXCEPTION 'La correccion usa la misma version de plantilla que el registro que corrige'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'registro_plantilla_valida';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.plantilla_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.plantilla_id IS NOT DISTINCT FROM OLD.plantilla_id) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO p FROM plantillas_clinicas WHERE id = NEW.plantilla_id;
  IF NOT FOUND OR p.estado <> 'PUBLICADA' OR p.tipo <> v_tipo THEN
    RAISE EXCEPTION 'Use una plantilla publicada de tipo %', v_tipo
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registro_plantilla_valida';
  END IF;
  IF app_rol() = 'PROFESIONAL' AND NOT tiene_especialidad(NEW.autor_id, p.especialidad_id) THEN
    RAISE EXCEPTION 'La plantilla es de una especialidad que no tiene aprobada'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'registro_plantilla_especialidad';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evoluciones_plantilla_valida BEFORE INSERT ON evoluciones
  FOR EACH ROW EXECUTE FUNCTION validar_plantilla_registro();
CREATE TRIGGER borradores_evolucion_plantilla_valida BEFORE INSERT OR UPDATE OF plantilla_id ON borradores_evolucion
  FOR EACH ROW EXECUTE FUNCTION validar_plantilla_registro();
CREATE TRIGGER ingresos_ficha_plantilla_valida BEFORE INSERT ON ingresos_ficha
  FOR EACH ROW EXECUTE FUNCTION validar_plantilla_registro();

-- Ficha de ingreso: append-only (retencion de 15 años, como evoluciones).
CREATE TRIGGER ingresos_ficha_append_only BEFORE UPDATE OR DELETE ON ingresos_ficha
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();
ALTER TABLE ingresos_ficha ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingresos_ficha FORCE ROW LEVEL SECURITY;
CREATE POLICY ingresos_ficha_select ON ingresos_ficha FOR SELECT TO app_user
  USING (es_profesional_de_ficha(ficha_clinica_id) OR acceso_temporal_ficha(ficha_clinica_id, false));
CREATE POLICY ingresos_ficha_insert ON ingresos_ficha FOR INSERT TO app_user
  WITH CHECK (autor_id = (SELECT app_usuario_id())
              AND (es_profesional_de_ficha(ficha_clinica_id) OR acceso_temporal_ficha(ficha_clinica_id, true)));
CREATE POLICY ingresos_ficha_consentimiento_practicante ON ingresos_ficha AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR ficha_clinica_id IN (SELECT id FROM fichas_clinicas))
  WITH CHECK ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR ficha_clinica_id IN (SELECT id FROM fichas_clinicas));
GRANT SELECT, INSERT ON ingresos_ficha TO app_user;

-- Supervision seudonimizada: ademas de los campos estructurados, la
-- plantilla y los valores (la API entrega solo los campos visibles en supervision).
DROP FUNCTION supervision_evoluciones(text);
CREATE FUNCTION supervision_evoluciones(p_codigo text)
RETURNS TABLE (evolucion_id uuid, autor_id uuid, tipo_sesion text, intervenciones text[], estado_avance text,
               nivel_riesgo nivel_riesgo, notas bytea, corrige_a_id uuid, creado_en timestamptz,
               plantilla_id uuid, valores bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_paciente uuid;
  v_ficha uuid;
  v_practicante uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' THEN
    RAISE EXCEPTION 'supervision_evoluciones: solo PROFESIONAL con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.id, f.id, p.profesional_id INTO v_paciente, v_ficha, v_practicante
  FROM pacientes p JOIN fichas_clinicas f ON f.paciente_id = p.id
  WHERE p.codigo_seudonimo = p_codigo AND p.deleted_at IS NULL
    AND es_supervisor_vigente_de(p.profesional_id) AND consentimiento_practicante_vigente(p.id);
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, ficha_id, recurso, accion)
  VALUES (app_usuario_id(), 'PROFESIONAL', v_paciente, v_ficha, 'supervision_evoluciones', 'SUPERVISION');

  RETURN QUERY
  SELECT e.id, e.autor_id, ts.nombre,
         ARRAY(SELECT i.nombre FROM evolucion_intervenciones ei JOIN intervenciones i ON i.id = ei.intervencion_id
               WHERE ei.evolucion_id = e.id ORDER BY i.nombre),
         ea.nombre, e.nivel_riesgo, e.notas, e.corrige_a_id, e.created_at, e.plantilla_id, e.valores
  FROM evoluciones e
  JOIN tipos_sesion ts ON ts.id = e.tipo_sesion_id
  LEFT JOIN estados_avance ea ON ea.id = e.estado_avance_id
  WHERE e.ficha_clinica_id = v_ficha AND e.autor_id = v_practicante
  ORDER BY e.created_at;
END;
$$;
REVOKE EXECUTE ON FUNCTION supervision_evoluciones(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supervision_evoluciones(text) TO app_user;

-- RUT obligatorio antes de la primera evolucion para todo paciente (brechas.md 7).
CREATE OR REPLACE FUNCTION validar_evolucion_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_paciente uuid := (SELECT paciente_id FROM fichas_clinicas WHERE id = NEW.ficha_clinica_id);
BEGIN
  IF NEW.cita_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM citas WHERE id = NEW.cita_id AND paciente_id = v_paciente) THEN
    RAISE EXCEPTION 'La sesion no es de este paciente' USING ERRCODE = 'check_violation', CONSTRAINT = 'evoluciones_cita_del_paciente';
  END IF;
  IF NEW.corrige_a_id IS NULL AND EXISTS (SELECT 1 FROM pacientes WHERE id = v_paciente AND rut IS NULL) THEN
    RAISE EXCEPTION 'Registre el RUT del paciente antes de su primera evolucion'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'evoluciones_paciente_requiere_rut';
  END IF;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 5. Mensajeria interna del equipo (A)
-- =============================================================================
-- Acceso clinico vigente del contexto a un paciente: tratante (PROFESIONAL,
-- o PRACTICANTE con consentimiento vigente) o acceso temporal vigente.
-- ADMIN, GESTION y la supervision no.
CREATE FUNCTION acceso_clinico_paciente(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE app_rol()
    WHEN 'PROFESIONAL' THEN EXISTS (SELECT 1 FROM pacientes WHERE id = p_paciente_id AND profesional_id = app_usuario_id())
                            OR acceso_temporal_vigente(p_paciente_id, false)
    WHEN 'PRACTICANTE' THEN EXISTS (SELECT 1 FROM pacientes WHERE id = p_paciente_id AND profesional_id = app_usuario_id())
                            AND consentimiento_practicante_vigente(p_paciente_id)
    ELSE false
  END
$$;

-- Visibilidad de un hilo segun el rol activo, verificada en cada consulta.
CREATE FUNCTION hilo_visible(p_hilo_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM hilos_internos h
    WHERE h.id = p_hilo_id
      AND CASE h.tipo
            WHEN 'CASO' THEN acceso_clinico_paciente(h.paciente_id)
            ELSE app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
                 AND EXISTS (SELECT 1 FROM participantes_hilo ph WHERE ph.hilo_id = h.id AND ph.usuario_id = app_usuario_id())
          END)
$$;

-- Integrantes vigentes del equipo (destinatarios posibles de un hilo GENERAL).
CREATE FUNCTION es_integrante_equipo(p_usuario_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = p_usuario_id AND u.activo AND u.cerrada_en IS NULL
                   AND (u.rol::text IN ('ADMIN', 'GESTION', 'PROFESIONAL')
                        OR (u.rol = 'PRACTICANTE' AND u.fecha_expiracion_acceso > now())))
$$;

ALTER TABLE hilos_internos ADD CONSTRAINT hilos_internos_coherentes
  CHECK ((tipo = 'CASO') = (paciente_id IS NOT NULL) AND octet_length(asunto) BETWEEN 49 AND 1200);
ALTER TABLE mensajes_internos ADD CONSTRAINT mensajes_internos_coherentes
  CHECK ((retirado_en IS NULL) = (contenido IS NOT NULL) AND (contenido IS NULL OR octet_length(contenido) BETWEEN 49 AND 16200)
         AND rol_autor::text IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'));

-- Crear un hilo (con sus participantes si es GENERAL; el creador siempre participa).
CREATE FUNCTION crear_hilo_interno(p_id uuid, p_tipo tipo_hilo_interno, p_asunto bytea, p_paciente_id uuid, p_participantes uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'Mensajeria interna: solo el equipo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_tipo = 'CASO' AND (p_paciente_id IS NULL OR NOT acceso_clinico_paciente(p_paciente_id)) THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_tipo = 'GENERAL' AND (p_paciente_id IS NOT NULL
                             OR EXISTS (SELECT 1 FROM unnest(coalesce(p_participantes, '{}')) u(id) WHERE NOT es_integrante_equipo(u.id))) THEN
    RAISE EXCEPTION 'Hilo general: sin paciente y solo integrantes vigentes del equipo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hilos_internos_coherentes';
  END IF;
  INSERT INTO hilos_internos (id, tipo, asunto, paciente_id, creado_por_id)
  VALUES (p_id, p_tipo, p_asunto, p_paciente_id, app_usuario_id());
  IF p_tipo = 'GENERAL' THEN
    INSERT INTO participantes_hilo (hilo_id, usuario_id)
    SELECT p_id, u FROM (SELECT app_usuario_id() UNION SELECT unnest(coalesce(p_participantes, '{}'))) x(u);
  END IF;
  RETURN p_id;
END;
$$;

-- Agregar participantes a un hilo GENERAL: cualquier participante.
CREATE FUNCTION agregar_participantes_hilo(p_hilo_id uuid, p_participantes uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR NOT hilo_visible(p_hilo_id) THEN
    RAISE EXCEPTION 'Hilo inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF (SELECT tipo FROM hilos_internos WHERE id = p_hilo_id) <> 'GENERAL'
     OR EXISTS (SELECT 1 FROM unnest(p_participantes) u(id) WHERE NOT es_integrante_equipo(u.id)) THEN
    RAISE EXCEPTION 'Solo hilos generales y solo integrantes vigentes del equipo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hilos_internos_coherentes';
  END IF;
  INSERT INTO participantes_hilo (hilo_id, usuario_id) SELECT p_hilo_id, unnest(p_participantes) ON CONFLICT DO NOTHING;
END;
$$;

-- Retiro del propio mensaje dentro de 5 minutos: queda "mensaje retirado" (sin contenido).
CREATE FUNCTION retirar_mensaje_interno(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m mensajes_internos%ROWTYPE;
BEGIN
  SELECT * INTO m FROM mensajes_internos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT acceso_vigente() OR m.autor_id <> app_usuario_id() OR NOT hilo_visible(m.hilo_id) THEN
    RAISE EXCEPTION 'Mensaje inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF m.retirado_en IS NOT NULL OR m.creado_en <= now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'Un mensaje solo se retira dentro de 5 minutos' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM set_config('vinculos.retiro_mensaje', p_id::text, true);
  UPDATE mensajes_internos SET contenido = NULL, retirado_en = now() WHERE id = p_id;
  PERFORM set_config('vinculos.retiro_mensaje', '', true);
END;
$$;

-- Sin edicion: solo el retiro (via funcion) y la purga por retencion.
CREATE FUNCTION proteger_mensaje_interno() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('vinculos.purga_mensajes', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'mensajes_internos solo se borran por retencion' USING ERRCODE = 'restrict_violation';
  END IF;
  IF current_setting('vinculos.retiro_mensaje', true) IS DISTINCT FROM OLD.id::text
     OR NEW.id <> OLD.id OR NEW.hilo_id <> OLD.hilo_id OR NEW.autor_id <> OLD.autor_id OR NEW.rol_autor <> OLD.rol_autor
     OR NEW.creado_en <> OLD.creado_en OR NEW.contenido IS NOT NULL OR NEW.retirado_en IS NULL THEN
    RAISE EXCEPTION 'Los mensajes internos no se editan' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mensajes_internos_protegidos BEFORE UPDATE OR DELETE ON mensajes_internos
  FOR EACH ROW EXECUTE FUNCTION proteger_mensaje_interno();

-- Mensaje nuevo: actualiza el hilo y avisa (bandeja + correo, sin contenido) a
-- los demas participantes; a lo mas un aviso por hilo y persona cada 15 minutos.
CREATE FUNCTION avisar_mensaje_interno() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  h hilos_internos%ROWTYPE;
  v_destino uuid;
BEGIN
  UPDATE hilos_internos SET ultimo_mensaje_en = NEW.creado_en WHERE id = NEW.hilo_id RETURNING * INTO h;
  FOR v_destino IN
    SELECT d FROM (
      SELECT ph.usuario_id AS d FROM participantes_hilo ph WHERE h.tipo = 'GENERAL' AND ph.hilo_id = h.id
      UNION SELECT p.profesional_id FROM pacientes p WHERE h.tipo = 'CASO' AND p.id = h.paciente_id
      UNION SELECT a.profesional_id FROM accesos_clinicos_temporales a
            WHERE h.tipo = 'CASO' AND a.paciente_id = h.paciente_id AND a.desde <= now() AND a.hasta > now()) x
    WHERE d <> NEW.autor_id AND es_integrante_equipo(d)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM notificaciones n WHERE n.tipo = 'MENSAJE_INTERNO' AND n.usuario_id = v_destino
                     AND n.referencia_id = h.id AND n.creada_en > now() - interval '15 minutes') THEN
      PERFORM encolar_notificacion('MENSAJE_INTERNO', NULL, v_destino, h.id, NEW.autor_id);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mensajes_internos_aviso AFTER INSERT ON mensajes_internos
  FOR EACH ROW EXECUTE FUNCTION avisar_mensaje_interno();

ALTER TABLE hilos_internos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hilos_internos FORCE ROW LEVEL SECURITY;
CREATE POLICY hilos_internos_select ON hilos_internos FOR SELECT TO app_user USING (hilo_visible(id));
GRANT SELECT ON hilos_internos TO app_user;

ALTER TABLE participantes_hilo ENABLE ROW LEVEL SECURITY;
ALTER TABLE participantes_hilo FORCE ROW LEVEL SECURITY;
CREATE POLICY participantes_hilo_select ON participantes_hilo FOR SELECT TO app_user USING (hilo_visible(hilo_id));
GRANT SELECT ON participantes_hilo TO app_user;

ALTER TABLE mensajes_internos ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes_internos FORCE ROW LEVEL SECURITY;
CREATE POLICY mensajes_internos_select ON mensajes_internos FOR SELECT TO app_user USING (hilo_visible(hilo_id));
CREATE POLICY mensajes_internos_insert ON mensajes_internos FOR INSERT TO app_user
  WITH CHECK (autor_id = (SELECT app_usuario_id()) AND rol_autor::text = (SELECT app_rol()) AND retirado_en IS NULL
              AND hilo_visible(hilo_id));
GRANT SELECT, INSERT ON mensajes_internos TO app_user;

ALTER TABLE lecturas_hilo ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecturas_hilo FORCE ROW LEVEL SECURITY;
CREATE POLICY lecturas_hilo_select ON lecturas_hilo FOR SELECT TO app_user USING (hilo_visible(hilo_id));
CREATE POLICY lecturas_hilo_insert ON lecturas_hilo FOR INSERT TO app_user
  WITH CHECK (usuario_id = (SELECT app_usuario_id()) AND hilo_visible(hilo_id));
CREATE POLICY lecturas_hilo_update ON lecturas_hilo FOR UPDATE TO app_user
  USING (usuario_id = (SELECT app_usuario_id()) AND hilo_visible(hilo_id))
  WITH CHECK (usuario_id = (SELECT app_usuario_id()) AND hilo_visible(hilo_id));
GRANT SELECT, INSERT ON lecturas_hilo TO app_user;
GRANT UPDATE (leido_en) ON lecturas_hilo TO app_user;

-- Nombres de autores y participantes de un hilo visible. Cuenta cerrada (o
-- dada de baja): "Ex integrante del equipo" (minimizacion).
CREATE FUNCTION nombres_hilo(p_hilo_id uuid) RETURNS TABLE (usuario_id uuid, nombre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR NOT hilo_visible(p_hilo_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT u.id, CASE WHEN u.activo AND u.cerrada_en IS NULL THEN u.nombre ELSE 'Ex integrante del equipo' END
  FROM usuarios u
  WHERE u.id IN (SELECT m.autor_id FROM mensajes_internos m WHERE m.hilo_id = p_hilo_id
                 UNION SELECT ph.usuario_id FROM participantes_hilo ph WHERE ph.hilo_id = p_hilo_id
                 UNION SELECT h.creado_por_id FROM hilos_internos h WHERE h.id = p_hilo_id);
END;
$$;

-- Purga por retencion (job, sin contexto): mensajes mas antiguos que
-- configuracion_centro.retencion_mensajes_dias y los hilos que quedan vacios.
ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_retencion_mensajes
  CHECK (retencion_mensajes_dias BETWEEN 30 AND 3650);
CREATE FUNCTION purgar_mensajes_internos() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_corte timestamptz := now() - make_interval(days => (SELECT retencion_mensajes_dias FROM configuracion_centro));
  n int;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de retencion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('vinculos.purga_mensajes', 'on', true);
  DELETE FROM mensajes_internos WHERE creado_en < v_corte;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('vinculos.purga_mensajes', '', true);
  WITH vacios AS (
    SELECT h.id FROM hilos_internos h
    WHERE h.ultimo_mensaje_en < v_corte AND NOT EXISTS (SELECT 1 FROM mensajes_internos m WHERE m.hilo_id = h.id)
  ), l AS (DELETE FROM lecturas_hilo WHERE hilo_id IN (SELECT id FROM vacios)),
     p AS (DELETE FROM participantes_hilo WHERE hilo_id IN (SELECT id FROM vacios))
  DELETE FROM hilos_internos WHERE id IN (SELECT id FROM vacios);
  RETURN n;
END;
$$;

-- =============================================================================
-- 6. Avisos nuevos: mensaje interno y posible duplicado (sin datos del paciente)
-- =============================================================================
INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT e.evento::tipo_notificacion, 'EQUIPO', c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('MENSAJE_INTERNO', 'Mensaje nuevo del equipo',
   'Tienes un mensaje nuevo en un hilo del equipo. Revísalo en el sistema: {{enlace}}'),
  ('POSIBLE_DUPLICADO', 'Posible paciente duplicado',
   'Se registró un paciente con el RUT o el correo de otro ya existente. Revíselo en el sistema: {{enlace}}')
) AS e(evento, asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);

-- =============================================================================
-- 7. Duplicados: solo los resuelve administracion (alerta y aviso)
-- =============================================================================
REVOKE UPDATE (posible_duplicado) ON pacientes FROM app_user;

CREATE FUNCTION alertar_posible_duplicado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_destino uuid;
BEGIN
  INSERT INTO alertas_internas (tipo, referencia_id, detalle)
  VALUES ('POSIBLE_DUPLICADO', NEW.id, 'Paciente registrado con el RUT o el correo de otro paciente: revisar (no se fusiona solo).')
  ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
  FOR v_destino IN
    SELECT u.id FROM usuarios u
    WHERE u.activo AND u.cerrada_en IS NULL
      AND (u.rol::text IN ('ADMIN', 'GESTION')
           OR EXISTS (SELECT 1 FROM roles_adicionales r WHERE r.usuario_id = u.id AND r.activo AND r.rol::text IN ('ADMIN', 'GESTION')))
  LOOP
    PERFORM encolar_notificacion('POSIBLE_DUPLICADO', NULL, v_destino, NEW.id, NULL);
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pacientes_alerta_duplicado AFTER INSERT OR UPDATE OF posible_duplicado ON pacientes
  FOR EACH ROW WHEN (NEW.posible_duplicado) EXECUTE FUNCTION alertar_posible_duplicado();

-- Resolver: ADMIN/GESTION; DISTINTO (son personas distintas) o MISMO_PACIENTE
-- (la fusion de fichas no es automatica: queda registrada para hacerla a mano).
CREATE FUNCTION resolver_posible_duplicado(p_paciente_id uuid, p_resolucion text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo administracion resuelve duplicados' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_resolucion NOT IN ('DISTINTO', 'MISMO_PACIENTE') THEN
    RAISE EXCEPTION 'Resolucion: DISTINTO o MISMO_PACIENTE' USING ERRCODE = 'check_violation', CONSTRAINT = 'pacientes_duplicado_resolucion';
  END IF;
  UPDATE pacientes SET posible_duplicado = false WHERE id = p_paciente_id AND posible_duplicado;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente sin duplicado pendiente' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE alertas_internas SET atendida_en = now(), atendida_por_id = app_usuario_id()
  WHERE tipo = 'POSIBLE_DUPLICADO' AND referencia_id = p_paciente_id AND atendida_en IS NULL;
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), app_rol()::rol, p_paciente_id, 'pacientes', 'DUPLICADO_' || p_resolucion);
END;
$$;

-- =============================================================================
-- 8. Edad minima de la cuenta del paciente, configurable (D-4, brechas.md 7)
-- =============================================================================
ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_edad_minima_cuenta
  CHECK (edad_minima_cuenta BETWEEN 14 AND 18);
GRANT UPDATE (edad_minima_cuenta, retencion_mensajes_dias) ON configuracion_centro TO app_user;

CREATE FUNCTION edad_minima_cuenta() RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT edad_minima_cuenta FROM configuracion_centro
$$;

CREATE OR REPLACE FUNCTION crear_invitacion_paciente(p_paciente_id uuid, p_email text, p_hash bytea, p_expira timestamptz)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION invitan pacientes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(p_email, email) INTO v_email FROM pacientes WHERE id = p_paciente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_email IS NULL OR edad_paciente(p_paciente_id) < edad_minima_cuenta() THEN
    RAISE EXCEPTION 'Cuenta de paciente: correo y al menos % años (menores: opera el adulto responsable)', edad_minima_cuenta()
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_paciente_edad_minima';
  END IF;
  IF EXISTS (SELECT 1 FROM usuarios WHERE paciente_id = p_paciente_id) THEN
    RAISE EXCEPTION 'El paciente ya tiene cuenta' USING ERRCODE = 'unique_violation';
  END IF;
  PERFORM emitir_token('INVITACION', p_hash, p_expira, NULL, p_paciente_id, NULL, NULL, 'PACIENTE', v_email);
  RETURN v_email;
END;
$$;

CREATE OR REPLACE FUNCTION activar_invitacion(p_hash bytea, p_password_hash text, p_nuevo_usuario_id uuid)
RETURNS TABLE (usuario_id uuid, rol rol)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_hash, 'INVITACION');
  v_id uuid;
  v_nombre text;
BEGIN
  IF t.usuario_id IS NOT NULL THEN
    UPDATE usuarios SET password_hash = p_password_hash, updated_at = now()
    WHERE id = t.usuario_id AND activo AND cerrada_en IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cuenta sin acceso' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    v_id := t.usuario_id;
  ELSIF t.rol = 'PACIENTE' THEN
    IF edad_paciente(t.paciente_id) < edad_minima_cuenta() THEN
      RAISE EXCEPTION 'Cuenta de paciente desde los % años', edad_minima_cuenta()
        USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_paciente_edad_minima';
    END IF;
    SELECT nombre || ' ' || apellido INTO v_nombre FROM pacientes WHERE id = t.paciente_id;
    INSERT INTO usuarios (id, email, password_hash, nombre, rol, paciente_id)
    VALUES (p_nuevo_usuario_id, t.email, p_password_hash, v_nombre, 'PACIENTE', t.paciente_id);
    v_id := p_nuevo_usuario_id;
  ELSE
    SELECT id INTO v_id FROM usuarios WHERE email = t.email AND rol = 'RESPONSABLE' AND activo AND cerrada_en IS NULL;
    IF v_id IS NULL THEN
      SELECT nombre INTO v_nombre FROM adultos_responsables WHERE id = t.adulto_responsable_id;
      INSERT INTO usuarios (id, email, password_hash, nombre, rol)
      VALUES (p_nuevo_usuario_id, t.email, p_password_hash, v_nombre, 'RESPONSABLE');
      v_id := p_nuevo_usuario_id;
    END IF;
    UPDATE adultos_responsables SET usuario_id = v_id WHERE id = t.adulto_responsable_id;
  END IF;
  RETURN QUERY SELECT u.id, u.rol FROM usuarios u WHERE u.id = v_id;
END;
$$;

-- =============================================================================
-- 9. Correos de cuenta con reintento (A): solo funciones sin contexto (la API
-- encola tras un envio fallido; el job reintenta con backoff).
-- =============================================================================
ALTER TABLE correos_cuenta_pendientes ADD CONSTRAINT correos_cuenta_pendientes_validos
  CHECK (octet_length(email) >= 49 AND octet_length(cuerpo) >= 49 AND intentos BETWEEN 1 AND 5
         AND length(asunto) BETWEEN 1 AND 300);
ALTER TABLE correos_cuenta_pendientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE correos_cuenta_pendientes FORCE ROW LEVEL SECURITY;

CREATE FUNCTION encolar_correo_cuenta(p_id uuid, p_email bytea, p_asunto text, p_cuerpo bytea, p_vence timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo sin contexto (correo de cuenta fallido)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_vence > now() THEN
    INSERT INTO correos_cuenta_pendientes (id, email, asunto, cuerpo, proximo_intento, vence_en)
    VALUES (p_id, p_email, p_asunto, p_cuerpo, now() + interval '1 minute', p_vence);
  END IF;
END;
$$;

CREATE FUNCTION correos_cuenta_por_enviar(p_limite int)
RETURNS TABLE (id uuid, email bytea, asunto text, cuerpo bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de correos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM correos_cuenta_pendientes WHERE vence_en <= now();
  RETURN QUERY
  SELECT c.id, c.email, c.asunto, c.cuerpo FROM correos_cuenta_pendientes c
  WHERE c.proximo_intento <= now()
  ORDER BY c.proximo_intento
  LIMIT greatest(coalesce(p_limite, 20), 1)
  FOR UPDATE SKIP LOCKED;
END;
$$;

-- Enviado o quinto intento fallido: se borra (el enlace no queda guardado).
-- Si no, backoff: 1, 5, 15 y 60 minutos.
CREATE FUNCTION resultado_correo_cuenta(p_id uuid, p_enviado boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de correos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_enviado OR (SELECT intentos FROM correos_cuenta_pendientes WHERE id = p_id) >= 5 THEN
    DELETE FROM correos_cuenta_pendientes WHERE id = p_id;
  ELSE
    UPDATE correos_cuenta_pendientes
    SET intentos = intentos + 1,
        proximo_intento = now() + (ARRAY[interval '5 minutes', interval '15 minutes', interval '60 minutes', interval '60 minutes'])[intentos]
    WHERE id = p_id;
  END IF;
END;
$$;

-- =============================================================================
-- 10. Acceso vigente (RESTRICTIVE) en toda tabla nueva
-- =============================================================================
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['especialidades', 'profesional_especialidades', 'plantillas_clinicas', 'ingresos_ficha',
                           'hilos_internos', 'participantes_hilo', 'mensajes_internos', 'lecturas_hilo',
                           'correos_cuenta_pendientes'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO app_user
                    USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()))', t || '_acceso_vigente', t);
  END LOOP;
END $$;

-- =============================================================================
-- 11. Permisos de funciones (como 03a-1)
-- =============================================================================
-- Internas (triggers y validaciones): sin EXECUTE para app_user.
REVOKE EXECUTE ON FUNCTION
  validar_plantilla_registro(), proteger_plantilla_clinica(), proteger_mensaje_interno(), avisar_mensaje_interno(),
  alertar_posible_duplicado(), definicion_plantilla_valida(jsonb)
FROM PUBLIC;

-- Llamadas desde la API o usadas por politicas (cada una valida su contexto).
REVOKE EXECUTE ON FUNCTION
  revisar_especialidad(uuid, uuid, boolean), tiene_especialidad(uuid, uuid), puede_proponer_plantilla(uuid),
  proponer_plantilla(uuid, tipo_plantilla_clinica, text, jsonb), nueva_version_plantilla(uuid), editar_plantilla(uuid, text, jsonb),
  publicar_plantilla(uuid), desactivar_plantilla(uuid), acceso_clinico_paciente(uuid), hilo_visible(uuid), es_integrante_equipo(uuid),
  crear_hilo_interno(uuid, tipo_hilo_interno, bytea, uuid, uuid[]), agregar_participantes_hilo(uuid, uuid[]),
  retirar_mensaje_interno(uuid), nombres_hilo(uuid), purgar_mensajes_internos(), resolver_posible_duplicado(uuid, text),
  edad_minima_cuenta(), encolar_correo_cuenta(uuid, bytea, text, bytea, timestamptz), correos_cuenta_por_enviar(int),
  resultado_correo_cuenta(uuid, boolean)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  revisar_especialidad(uuid, uuid, boolean), tiene_especialidad(uuid, uuid), puede_proponer_plantilla(uuid),
  proponer_plantilla(uuid, tipo_plantilla_clinica, text, jsonb), nueva_version_plantilla(uuid), editar_plantilla(uuid, text, jsonb),
  publicar_plantilla(uuid), desactivar_plantilla(uuid), acceso_clinico_paciente(uuid), hilo_visible(uuid), es_integrante_equipo(uuid),
  crear_hilo_interno(uuid, tipo_hilo_interno, bytea, uuid, uuid[]), agregar_participantes_hilo(uuid, uuid[]),
  retirar_mensaje_interno(uuid), nombres_hilo(uuid), purgar_mensajes_internos(), resolver_posible_duplicado(uuid, text),
  edad_minima_cuenta(), encolar_correo_cuenta(uuid, bytea, text, bytea, timestamptz), correos_cuenta_por_enviar(int),
  resultado_correo_cuenta(uuid, boolean)
TO app_user;
