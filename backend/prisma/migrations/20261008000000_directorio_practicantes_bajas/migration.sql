-- =============================================================================
-- 01d: directorio y perfiles publicos, catalogo de tipos de atencion, RLS en
-- las tablas restantes, practicantes con supervision, bitacora de accesos de
-- practicantes, consentimiento informado, bajas y ajustes a derivaciones.
--
-- Corre como dueño (vinculos_owner). La variable de contexto de identidad es
-- app.current_usuario_id (renombrada en 01d directamente en las migraciones
-- anteriores, que no estaban aplicadas en ningun entorno).
--
-- Enums: ALTER TYPE ... ADD VALUE (EXPIRADO, POR_REPROGRAMAR) no se puede usar
-- en la misma transaccion. Por eso los CHECK comparan como texto y las
-- funciones que usan esos valores son plpgsql (el cuerpo se analiza al
-- ejecutar, no al crear).
--
-- Categoria de cada tabla: docs/seguridad/criterio_clasificacion.md.
-- Excepciones -> HTTP: igual que 01c (42501, 23514, 23505, 55000, P0002, 23001).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

ALTER TYPE "accion_acceso" ADD VALUE 'EXPIRADO';
-- POR_REPROGRAMAR no participa del EXCLUDE (solo CONFIRMADA) ni del trigger de
-- menor de edad: libera el box y el horario hasta que alguien la reprograme.
ALTER TYPE "estado_cita" ADD VALUE 'POR_REPROGRAMAR';

CREATE TYPE "tipo_consentimiento" AS ENUM ('ATENCION_CON_PRACTICANTE_SUPERVISADO');
CREATE TYPE "otorgante_consentimiento" AS ENUM ('PACIENTE', 'ADULTO_RESPONSABLE');


-- -----------------------------------------------------------------------------
-- 2. DDL (identico al que genera Prisma para el schema).
-- -----------------------------------------------------------------------------

-- Codigo seudonimo del paciente para supervision: aleatorio (no derivable del
-- id), estable (se fija al crear el paciente y la API no puede cambiarlo).
CREATE FUNCTION generar_codigo_seudonimo() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'C-' || upper(substr(md5(gen_random_uuid()::text), 1, 10))
$$;

ALTER TABLE "usuarios" ADD COLUMN "telefono" TEXT;

ALTER TABLE "pacientes" ADD COLUMN "codigo_seudonimo" TEXT NOT NULL DEFAULT generar_codigo_seudonimo(),
ADD COLUMN "tipo_atencion_id" UUID;

ALTER TABLE "profesionales" ADD COLUMN "nombre_publico" TEXT,
ADD COLUMN "bio" TEXT,
ADD COLUMN "foto_url" TEXT,
ADD COLUMN "perfil_publico" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "perfil_publico_consentido_en" TIMESTAMPTZ(6);

ALTER TABLE "derivaciones" ADD COLUMN "tipo_atencion_id" UUID,
ADD COLUMN "detalle" TEXT,
ADD COLUMN "creada_por_id" UUID,
ADD COLUMN "motivo_cierre" TEXT;

-- Bitacora de accesos de practicantes: pertenece al Nucleo. actor_id nulo =
-- evento del sistema (EXPIRADO por procesar_bajas).
ALTER TABLE "accesos_temporales" RENAME TO "historial_accesos_practicante";
ALTER TABLE "historial_accesos_practicante" RENAME CONSTRAINT "accesos_temporales_pkey" TO "historial_accesos_practicante_pkey";
ALTER INDEX "accesos_temporales_practicante_id_created_at_idx" RENAME TO "historial_accesos_practicante_practicante_id_created_at_idx";
ALTER TABLE "historial_accesos_practicante" RENAME CONSTRAINT "accesos_temporales_practicante_id_fkey" TO "historial_accesos_practicante_practicante_id_fkey";
ALTER TABLE "historial_accesos_practicante" RENAME CONSTRAINT "accesos_temporales_otorgado_por_id_fkey" TO "historial_accesos_practicante_actor_id_fkey";
ALTER TABLE "historial_accesos_practicante" RENAME COLUMN "otorgado_por_id" TO "actor_id";
ALTER TABLE "historial_accesos_practicante" ALTER COLUMN "actor_id" DROP NOT NULL,
ADD COLUMN "motivo" TEXT;

CREATE TABLE "tipos_atencion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipos_atencion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profesional_tipos_atencion" (
    "profesional_id" UUID NOT NULL,
    "tipo_atencion_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profesional_tipos_atencion_pkey" PRIMARY KEY ("profesional_id","tipo_atencion_id")
);

CREATE TABLE "supervisiones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "practicante_id" UUID NOT NULL,
    "supervisor_id" UUID NOT NULL,
    "desde" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasta" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisiones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supervision_comentarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evolucion_id" UUID NOT NULL,
    "supervisor_id" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervision_comentarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consentimientos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "tipo" "tipo_consentimiento" NOT NULL,
    "version_documento" TEXT NOT NULL,
    "otorgado_por_tipo" "otorgante_consentimiento" NOT NULL,
    "adulto_responsable_id" UUID,
    "otorgado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocado_en" TIMESTAMPTZ(6),

    CONSTRAINT "consentimientos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bajas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "fecha_efectiva" TIMESTAMPTZ(6) NOT NULL,
    "iniciada_por_id" UUID NOT NULL,
    "iniciada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesada_en" TIMESTAMPTZ(6),

    CONSTRAINT "bajas_pkey" PRIMARY KEY ("id")
);

-- Un profesional puede volver a ser candidato (reintegro) como fila nueva: el
-- unico total se reemplaza por uno parcial (seccion 4).
DROP INDEX "derivacion_candidatos_derivacion_id_profesional_id_key";

CREATE UNIQUE INDEX "pacientes_codigo_seudonimo_key" ON "pacientes"("codigo_seudonimo");
CREATE UNIQUE INDEX "tipos_atencion_nombre_key" ON "tipos_atencion"("nombre");
CREATE INDEX "profesional_tipos_atencion_tipo_atencion_id_idx" ON "profesional_tipos_atencion"("tipo_atencion_id");
CREATE INDEX "supervisiones_practicante_id_idx" ON "supervisiones"("practicante_id");
CREATE INDEX "supervisiones_supervisor_id_idx" ON "supervisiones"("supervisor_id");
CREATE INDEX "supervision_comentarios_evolucion_id_idx" ON "supervision_comentarios"("evolucion_id");
CREATE INDEX "consentimientos_paciente_id_idx" ON "consentimientos"("paciente_id");
CREATE UNIQUE INDEX "bajas_usuario_id_key" ON "bajas"("usuario_id");
CREATE INDEX "derivacion_candidatos_derivacion_id_profesional_id_idx" ON "derivacion_candidatos"("derivacion_id", "profesional_id");

ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_tipo_atencion_id_fkey" FOREIGN KEY ("tipo_atencion_id") REFERENCES "tipos_atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_tipo_atencion_id_fkey" FOREIGN KEY ("tipo_atencion_id") REFERENCES "tipos_atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profesional_tipos_atencion" ADD CONSTRAINT "profesional_tipos_atencion_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profesional_tipos_atencion" ADD CONSTRAINT "profesional_tipos_atencion_tipo_atencion_id_fkey" FOREIGN KEY ("tipo_atencion_id") REFERENCES "tipos_atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supervisiones" ADD CONSTRAINT "supervisiones_practicante_id_fkey" FOREIGN KEY ("practicante_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supervisiones" ADD CONSTRAINT "supervisiones_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supervision_comentarios" ADD CONSTRAINT "supervision_comentarios_evolucion_id_fkey" FOREIGN KEY ("evolucion_id") REFERENCES "evoluciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supervision_comentarios" ADD CONSTRAINT "supervision_comentarios_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_adulto_responsable_id_fkey" FOREIGN KEY ("adulto_responsable_id") REFERENCES "adultos_responsables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bajas" ADD CONSTRAINT "bajas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bajas" ADD CONSTRAINT "bajas_iniciada_por_id_fkey" FOREIGN KEY ("iniciada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- 3. Migracion de datos: derivaciones.tipo_atencion (texto libre) -> catalogo.
-- Cada texto distinto pasa a ser un tipo activo; ADMIN despues fusiona o
-- desactiva los que sobren. creada_por = origen en las derivaciones previas.
-- -----------------------------------------------------------------------------

INSERT INTO tipos_atencion (nombre)
SELECT DISTINCT coalesce(nullif(btrim(tipo_atencion), ''), 'Sin especificar') FROM derivaciones
ON CONFLICT (nombre) DO NOTHING;

UPDATE derivaciones d
SET tipo_atencion_id = t.id, creada_por_id = d.profesional_origen_id
FROM tipos_atencion t
WHERE t.nombre = coalesce(nullif(btrim(d.tipo_atencion), ''), 'Sin especificar');

ALTER TABLE "derivaciones" ALTER COLUMN "tipo_atencion_id" SET NOT NULL,
ALTER COLUMN "creada_por_id" SET NOT NULL,
DROP COLUMN "tipo_atencion";


-- -----------------------------------------------------------------------------
-- 4. Reglas que Prisma no expresa.
-- -----------------------------------------------------------------------------

ALTER TABLE tipos_atencion ADD CONSTRAINT tipos_atencion_nombre_no_vacio CHECK (btrim(nombre) <> '');
ALTER TABLE derivaciones ADD CONSTRAINT derivaciones_motivo_no_vacio CHECK (btrim(motivo) <> '');

-- Perfil publico solo con nombre publico y consentimiento registrado.
ALTER TABLE profesionales ADD CONSTRAINT profesionales_perfil_publico_completo
  CHECK (NOT perfil_publico OR (nombre_publico IS NOT NULL AND perfil_publico_consentido_en IS NOT NULL));

-- OTORGADO/REVOCADO los registra un ADMIN; EXPIRADO, el job (sin actor).
ALTER TABLE historial_accesos_practicante ADD CONSTRAINT historial_accesos_practicante_coherente
  CHECK ((accion::text = 'EXPIRADO') = (actor_id IS NULL)
         AND (accion::text <> 'OTORGADO' OR fecha_expiracion IS NOT NULL)
         AND (accion::text <> 'REVOCADO' OR coalesce(btrim(motivo), '') <> ''));

-- Maximo una supervision vigente por practicante: los rangos [desde, hasta) del
-- mismo practicante no se solapan (hasta nulo = abierta). Violacion = 23P01.
ALTER TABLE supervisiones ADD CONSTRAINT supervisiones_rango_valido CHECK (hasta IS NULL OR hasta > desde);
ALTER TABLE supervisiones ADD CONSTRAINT supervisiones_una_vigente
  EXCLUDE USING gist (practicante_id WITH =, tstzrange(desde, hasta, '[)') WITH &&);

ALTER TABLE consentimientos ADD CONSTRAINT consentimientos_otorgante_coherente
  CHECK ((otorgado_por_tipo = 'ADULTO_RESPONSABLE') = (adulto_responsable_id IS NOT NULL));
ALTER TABLE consentimientos ADD CONSTRAINT consentimientos_revocacion_valida
  CHECK (revocado_en IS NULL OR revocado_en >= otorgado_en);

-- Un profesional tiene a lo sumo una fila pendiente o aceptada por derivacion;
-- las filas ya respondidas (RECHAZADA/EXPIRADA/OMITIDA) quedan como historia.
CREATE UNIQUE INDEX derivacion_candidatos_una_fila_activa
  ON derivacion_candidatos (derivacion_id, profesional_id) WHERE estado IN ('EN_ESPERA', 'OFRECIDA', 'ACEPTADA');


-- -----------------------------------------------------------------------------
-- 5. Helpers (SECURITY DEFINER: leen tablas con RLS sin recursion).
-- -----------------------------------------------------------------------------

CREATE FUNCTION rol_usuario(p_usuario_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT rol::text FROM usuarios WHERE id = p_usuario_id
$$;

-- Supervisor de la supervision vigente del practicante (o NULL). Un supervisor
-- desactivado no cuenta: su practicante queda sin supervision.
CREATE FUNCTION supervisor_vigente(p_practicante_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.supervisor_id
  FROM supervisiones s JOIN usuarios u ON u.id = s.supervisor_id
  WHERE s.practicante_id = p_practicante_id AND u.activo
    AND s.desde <= now() AND (s.hasta IS NULL OR s.hasta > now())
$$;

CREATE FUNCTION es_supervisor_vigente_de(p_practicante_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(app_rol() = 'PROFESIONAL' AND supervisor_vigente(p_practicante_id) = app_usuario_id(), false)
$$;

CREATE FUNCTION consentimiento_practicante_vigente(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM consentimientos
    WHERE paciente_id = p_paciente_id AND tipo = 'ATENCION_CON_PRACTICANTE_SUPERVISADO' AND revocado_en IS NULL
  )
$$;

-- Evolucion escrita por un practicante que yo superviso hoy, sobre un paciente
-- que sigue siendo suyo y con consentimiento vigente (= lo que expone
-- supervision_evoluciones).
CREATE FUNCTION evolucion_supervisable(p_evolucion_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM evoluciones e
    JOIN fichas_clinicas f ON f.id = e.ficha_clinica_id
    JOIN pacientes p ON p.id = f.paciente_id
    WHERE e.id = p_evolucion_id AND p.profesional_id = e.autor_id AND p.deleted_at IS NULL
      AND es_supervisor_vigente_de(e.autor_id) AND consentimiento_practicante_vigente(p.id)
  )
$$;

-- acceso_vigente(): ademas de 01b, un PRACTICANTE necesita supervision vigente.
CREATE OR REPLACE FUNCTION acceso_vigente() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = app_usuario_id()
      AND u.activo
      AND u.rol::text = app_rol()
      AND (u.rol::text <> 'PRACTICANTE'
           OR (u.fecha_expiracion_acceso > now() AND supervisor_vigente(u.id) IS NOT NULL))
  )
$$;

-- Por que un paciente necesita nuevo tratante (NULL = no necesita). Fuente unica
-- de pacientes_por_reasignar() y de la derivacion de oficio.
CREATE FUNCTION motivo_reasignacion(p_paciente_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = t.id) THEN 'BAJA'
    WHEN t.rol::text = 'PRACTICANTE' AND (NOT t.activo OR t.fecha_expiracion_acceso <= now()) THEN
      coalesce((SELECT CASE WHEN h.accion::text = 'REVOCADO' THEN 'ACCESO_REVOCADO' ELSE 'ACCESO_EXPIRADO' END
                FROM historial_accesos_practicante h WHERE h.practicante_id = t.id
                ORDER BY h.created_at DESC LIMIT 1), 'ACCESO_EXPIRADO')
    WHEN t.rol::text = 'PRACTICANTE' AND supervisor_vigente(t.id) IS NULL THEN 'SIN_SUPERVISION'
    WHEN t.rol::text = 'PRACTICANTE' AND NOT consentimiento_practicante_vigente(p.id) THEN 'SIN_CONSENTIMIENTO_VIGENTE'
    WHEN NOT t.activo THEN 'TRATANTE_INACTIVO'
  END
  FROM pacientes p JOIN usuarios t ON t.id = p.profesional_id
  WHERE p.id = p_paciente_id AND p.deleted_at IS NULL
$$;


-- -----------------------------------------------------------------------------
-- 6. Triggers.
-- Como en 01c: los de privilegio solo aplican a app_user (el dueño y las
-- funciones SECURITY DEFINER quedan exentos); las reglas de negocio, a todos.
-- -----------------------------------------------------------------------------

-- pacientes: asignar un paciente nuevo a un practicante = ADMIN o su supervisor
-- vigente, y el practicante debe tener supervision vigente. Pacientes
-- existentes llegan a un practicante solo por derivacion.
CREATE FUNCTION validar_asignacion_practicante() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_user' AND rol_usuario(NEW.profesional_id) = 'PRACTICANTE' THEN
    IF NOT (coalesce(app_rol() = 'ADMIN', false) OR es_supervisor_vigente_de(NEW.profesional_id)) THEN
      RAISE EXCEPTION 'Solo ADMIN o el supervisor vigente asignan pacientes a un practicante'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF supervisor_vigente(NEW.profesional_id) IS NULL THEN
      RAISE EXCEPTION 'El practicante no tiene supervision vigente'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'practicante_requiere_supervision';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pacientes_asignacion_practicante BEFORE INSERT ON pacientes
  FOR EACH ROW EXECUTE FUNCTION validar_asignacion_practicante();

-- pacientes: un paciente cuyo tratante es PRACTICANTE necesita consentimiento
-- vigente (asignacion inicial o aceptacion de derivacion). Diferido al COMMIT:
-- el consentimiento referencia al paciente, asi que se crean en la misma
-- transaccion (paciente -> adulto responsable si es menor -> consentimiento).
CREATE FUNCTION validar_consentimiento_practicante() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT u.rol::text FROM pacientes p JOIN usuarios u ON u.id = p.profesional_id WHERE p.id = NEW.id) = 'PRACTICANTE'
     AND NOT consentimiento_practicante_vigente(NEW.id) THEN
    RAISE EXCEPTION 'Atencion con practicante requiere consentimiento informado vigente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pacientes_practicante_requiere_consentimiento';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER pacientes_practicante_requiere_consentimiento
  AFTER INSERT OR UPDATE OF profesional_id ON pacientes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validar_consentimiento_practicante();

-- profesionales: publicar el perfil es un consentimiento personal (solo el
-- propio profesional lo enciende; se registra la fecha). La tarifa no la
-- cambia el propio profesional.
CREATE FUNCTION proteger_perfil_profesional() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.perfil_publico AND (TG_OP = 'INSERT' OR NOT OLD.perfil_publico) THEN
    IF current_user = 'app_user' AND NEW.usuario_id IS DISTINCT FROM app_usuario_id() THEN
      RAISE EXCEPTION 'Solo el propio profesional consiente publicar su perfil'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.perfil_publico_consentido_en := now();
  END IF;
  IF TG_OP = 'UPDATE' AND current_user = 'app_user' AND NEW.tarifa IS DISTINCT FROM OLD.tarifa
     AND app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'La tarifa la fija ADMIN o GESTION' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profesionales_perfil_protegido BEFORE INSERT OR UPDATE ON profesionales
  FOR EACH ROW EXECUTE FUNCTION proteger_perfil_profesional();

-- supervisiones: practicante con rol PRACTICANTE; supervisor PROFESIONAL activo.
CREATE FUNCTION validar_supervision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF rol_usuario(NEW.practicante_id) IS DISTINCT FROM 'PRACTICANTE'
     OR NOT EXISTS (SELECT 1 FROM usuarios WHERE id = NEW.supervisor_id AND rol::text = 'PROFESIONAL' AND activo) THEN
    RAISE EXCEPTION 'Supervision invalida: practicante PRACTICANTE y supervisor PROFESIONAL activo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'supervisiones_roles_validos';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER supervisiones_roles_validos BEFORE INSERT OR UPDATE OF practicante_id, supervisor_id ON supervisiones
  FOR EACH ROW EXECUTE FUNCTION validar_supervision();

-- consentimientos: el adulto responsable es del mismo paciente; un menor (edad
-- a la fecha de otorgamiento, hora de Chile) solo consiente via adulto responsable.
CREATE FUNCTION validar_consentimiento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.adulto_responsable_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM adultos_responsables WHERE id = NEW.adulto_responsable_id AND paciente_id = NEW.paciente_id) THEN
    RAISE EXCEPTION 'El adulto responsable no pertenece al paciente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_adulto_del_paciente';
  END IF;
  IF NEW.otorgado_por_tipo <> 'ADULTO_RESPONSABLE'
     AND (SELECT age((NEW.otorgado_en AT TIME ZONE 'America/Santiago')::date, fecha_nacimiento)
          FROM pacientes WHERE id = NEW.paciente_id) < interval '18 years' THEN
    RAISE EXCEPTION 'Paciente menor de 18: el consentimiento lo otorga un adulto responsable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_menor_requiere_adulto_responsable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consentimientos_validos BEFORE INSERT ON consentimientos
  FOR EACH ROW EXECUTE FUNCTION validar_consentimiento();

-- consentimientos: append-only salvo fijar revocado_en una vez. Incluso dueño.
CREATE FUNCTION solo_revocar_consentimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR OLD.revocado_en IS NOT NULL OR NEW.revocado_en IS NULL
     OR (NEW.id, NEW.paciente_id, NEW.tipo, NEW.version_documento, NEW.otorgado_por_tipo, NEW.adulto_responsable_id, NEW.otorgado_en)
        IS DISTINCT FROM
        (OLD.id, OLD.paciente_id, OLD.tipo, OLD.version_documento, OLD.otorgado_por_tipo, OLD.adulto_responsable_id, OLD.otorgado_en) THEN
    RAISE EXCEPTION 'consentimientos es append-only: solo se puede fijar revocado_en una vez'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consentimientos_append_only BEFORE UPDATE OR DELETE ON consentimientos
  FOR EACH ROW EXECUTE FUNCTION solo_revocar_consentimiento();

-- Bitacora de practicantes y comentarios de supervision: append-only, incluso
-- dueño (misma funcion que accesos_ficha, 01b).
CREATE TRIGGER historial_accesos_practicante_append_only BEFORE UPDATE OR DELETE ON historial_accesos_practicante
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();
CREATE TRIGGER supervision_comentarios_append_only BEFORE UPDATE OR DELETE ON supervision_comentarios
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();


-- -----------------------------------------------------------------------------
-- 7. Politicas.
-- -----------------------------------------------------------------------------

-- pacientes: el supervisor vigente tambien puede dar de alta un paciente para
-- su practicante (sin verlo despues: no hay rama SELECT para el; la API no
-- puede usar RETURNING en ese INSERT). El trigger de asignacion afina.
DROP POLICY pacientes_insert ON pacientes;
CREATE POLICY pacientes_insert ON pacientes FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
              OR (profesional_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) = 'PROFESIONAL')
              OR es_supervisor_vigente_de(profesional_id));

-- Consentimiento revocado: el practicante pierde acceso al paciente y a todo lo
-- clinico que cuelga de el (RESTRICTIVE, se suma a acceso_vigente).
CREATE POLICY pacientes_consentimiento_practicante ON pacientes AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(id))
  WITH CHECK ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(id));
CREATE POLICY fichas_clinicas_consentimiento_practicante ON fichas_clinicas AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id))
  WITH CHECK ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id));
CREATE POLICY adultos_responsables_consentimiento_practicante ON adultos_responsables AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id))
  WITH CHECK ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id));
-- evoluciones: la subconsulta pasa por la RLS de fichas_clinicas (incluida la
-- de consentimiento) en el mismo contexto.
CREATE POLICY evoluciones_consentimiento_practicante ON evoluciones AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR ficha_clinica_id IN (SELECT id FROM fichas_clinicas))
  WITH CHECK ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR ficha_clinica_id IN (SELECT id FROM fichas_clinicas));

-- tipos_atencion (B): todo autenticado lee; solo ADMIN escribe; nunca DELETE.
CREATE POLICY tipos_atencion_select ON tipos_atencion FOR SELECT TO app_user USING (true);
CREATE POLICY tipos_atencion_insert ON tipos_atencion FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY tipos_atencion_update ON tipos_atencion FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');

-- profesional_tipos_atencion (B): todo autenticado lee; ADMIN asigna y quita.
CREATE POLICY profesional_tipos_atencion_select ON profesional_tipos_atencion FOR SELECT TO app_user USING (true);
CREATE POLICY profesional_tipos_atencion_insert ON profesional_tipos_atencion FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY profesional_tipos_atencion_delete ON profesional_tipos_atencion FOR DELETE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');

-- espacios (B): todo autenticado lee; ADMIN/GESTION escriben. Baja = activo=false.
CREATE POLICY espacios_select ON espacios FOR SELECT TO app_user USING (true);
CREATE POLICY espacios_insert ON espacios FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY espacios_update ON espacios FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')) WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));

-- bloqueos_temporales (A+C): cada uno los suyos (crear, extender, soltar). Los
-- ajenos solo se ven anonimos en ocupacion_espacios().
CREATE POLICY bloqueos_temporales_propios ON bloqueos_temporales FOR ALL TO app_user
  USING (usuario_id = (SELECT app_usuario_id())) WITH CHECK (usuario_id = (SELECT app_usuario_id()));

-- profesionales (A+C): fila completa (tarifa, datos privados) solo ADMIN/GESTION
-- y el propio. Lo publico sale por directorio_interno() / perfiles_publicos().
CREATE POLICY profesionales_select ON profesionales FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR usuario_id = (SELECT app_usuario_id()));
CREATE POLICY profesionales_insert ON profesionales FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY profesionales_update ON profesionales FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR usuario_id = (SELECT app_usuario_id()))
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR usuario_id = (SELECT app_usuario_id()));

-- practicantes (A): ADMIN/GESTION, el propio y su supervisor vigente (lectura).
CREATE POLICY practicantes_select ON practicantes FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR usuario_id = (SELECT app_usuario_id())
         OR es_supervisor_vigente_de(usuario_id));
CREATE POLICY practicantes_insert ON practicantes FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY practicantes_update ON practicantes FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')) WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));

-- arriendos (A): ADMIN/GESTION todos; PROFESIONAL los suyos (lectura).
CREATE POLICY arriendos_select ON arriendos FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR (profesional_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) = 'PROFESIONAL'));
CREATE POLICY arriendos_insert ON arriendos FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY arriendos_update ON arriendos FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')) WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));

-- boletas (A): como pagos (la subconsulta pasa por la RLS de pagos).
CREATE POLICY boletas_select ON boletas FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PACIENTE') AND pago_id IN (SELECT id FROM pagos)));
CREATE POLICY boletas_insert ON boletas FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY boletas_update ON boletas FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')) WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));

-- historial_accesos_practicante (A): solo lectura directa; escritura via funciones.
CREATE POLICY historial_accesos_practicante_select ON historial_accesos_practicante FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR practicante_id = (SELECT app_usuario_id())
         OR es_supervisor_vigente_de(practicante_id));

-- supervisiones (A): ADMIN/GESTION leen todas; practicante y supervisor las
-- suyas. Solo ADMIN crea y cierra (UPDATE solo de hasta).
CREATE POLICY supervisiones_select ON supervisiones FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR practicante_id = (SELECT app_usuario_id())
         OR supervisor_id = (SELECT app_usuario_id()));
CREATE POLICY supervisiones_insert ON supervisiones FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY supervisiones_update ON supervisiones FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');

-- supervision_comentarios (A): el supervisor que comento y el practicante
-- autor de la evolucion (si todavia la ve). Comenta el supervisor vigente.
CREATE POLICY supervision_comentarios_select ON supervision_comentarios FOR SELECT TO app_user
  USING (supervisor_id = (SELECT app_usuario_id())
         OR evolucion_id IN (SELECT id FROM evoluciones WHERE autor_id = (SELECT app_usuario_id())));
CREATE POLICY supervision_comentarios_insert ON supervision_comentarios FOR INSERT TO app_user
  WITH CHECK (supervisor_id = (SELECT app_usuario_id()) AND evolucion_supervisable(evolucion_id));

-- consentimientos (A): ADMIN/GESTION registran; el paciente ve y revoca los
-- suyos; el tratante los ve.
CREATE POLICY consentimientos_select ON consentimientos FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR paciente_id = (SELECT app_paciente_id())
         OR es_profesional_de_paciente(paciente_id));
CREATE POLICY consentimientos_insert ON consentimientos FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY consentimientos_update ON consentimientos FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR paciente_id = (SELECT app_paciente_id()))
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR paciente_id = (SELECT app_paciente_id()));

-- bajas (A): ADMIN/GESTION leen; escritura via funciones.
CREATE POLICY bajas_select ON bajas FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));


-- -----------------------------------------------------------------------------
-- 8. Directorio (categoria C: lo minimo para saber quien es quien).
-- -----------------------------------------------------------------------------

-- Equipo activo (sin pacientes). Email/telefono solo para ADMIN/GESTION. Un
-- PRACTICANTE solo ve a su supervisor vigente.
CREATE FUNCTION directorio_interno()
RETURNS TABLE (id uuid, nombre text, rol rol, tipos_atencion text[], email text, telefono text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_rol text := app_rol();
  v_contacto boolean := app_rol() IN ('ADMIN', 'GESTION');
BEGIN
  IF NOT acceso_vigente() OR v_rol NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'directorio_interno: solo equipo con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT u.id, u.nombre, u.rol,
         ARRAY(SELECT t.nombre FROM profesional_tipos_atencion pt JOIN tipos_atencion t ON t.id = pt.tipo_atencion_id
               WHERE pt.profesional_id = u.id AND t.activo ORDER BY t.nombre),
         CASE WHEN v_contacto THEN u.email END,
         CASE WHEN v_contacto THEN u.telefono END
  FROM usuarios u
  WHERE u.activo AND u.rol::text <> 'PACIENTE'
    AND (v_rol <> 'PRACTICANTE' OR u.id = supervisor_vigente(app_usuario_id()))
  ORDER BY u.nombre;
END;
$$;

-- PACIENTE: su tratante y los profesionales con los que tiene o tuvo citas.
CREATE FUNCTION mi_equipo_tratante()
RETURNS TABLE (id uuid, nombre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PACIENTE' THEN
    RAISE EXCEPTION 'mi_equipo_tratante: solo PACIENTE con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT u.id, u.nombre FROM usuarios u
  WHERE u.id IN (SELECT profesional_id FROM pacientes WHERE id = app_paciente_id()
                 UNION
                 SELECT profesional_id FROM citas WHERE paciente_id = app_paciente_id())
  ORDER BY u.nombre;
END;
$$;

-- Portal publico, sin contexto: solo campos publicos de PROFESIONAL activos,
-- sin baja iniciada y con perfil publico consentido. Nunca tarifa ni contacto.
CREATE FUNCTION perfiles_publicos()
RETURNS TABLE (id uuid, nombre_publico text, bio text, foto_url text, especialidad text,
               enfoque_terapeutico text, modalidad modalidad, tipos_atencion text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.usuario_id, p.nombre_publico, p.bio, p.foto_url, p.especialidad, p.enfoque_terapeutico, p.modalidad,
         ARRAY(SELECT t.nombre FROM profesional_tipos_atencion pt JOIN tipos_atencion t ON t.id = pt.tipo_atencion_id
               WHERE pt.profesional_id = p.usuario_id AND t.activo ORDER BY t.nombre)
  FROM profesionales p JOIN usuarios u ON u.id = p.usuario_id
  WHERE p.perfil_publico AND u.activo AND u.rol::text = 'PROFESIONAL'
    AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
  ORDER BY p.nombre_publico
$$;

-- Ocupacion: citas CONFIRMADA + bloqueos temporales activos de cualquiera,
-- anonimos (solo espacio y rango).
CREATE OR REPLACE FUNCTION ocupacion_espacios(desde timestamptz, hasta timestamptz)
RETURNS TABLE (espacio_id uuid, inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'ocupacion_espacios: requiere acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT o.espacio_id, o.inicio, o.fin FROM (
    SELECT c.espacio_id, c.inicio, c.fin FROM citas c
    WHERE c.estado = 'CONFIRMADA' AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(desde, hasta, '[)')
    UNION ALL
    SELECT b.espacio_id, b.inicio, b.fin FROM bloqueos_temporales b
    WHERE b.expira_en > now() AND tstzrange(b.inicio, b.fin, '[)') && tstzrange(desde, hasta, '[)')
  ) o
  ORDER BY o.espacio_id, o.inicio;
END;
$$;


-- -----------------------------------------------------------------------------
-- 9. Supervision de practicantes.
-- El supervisor no tiene rama en las politicas de pacientes/fichas/evoluciones:
-- solo ve casos por codigo seudonimo y las evoluciones del practicante. Limite
-- conocido: el texto libre de las evoluciones NO se seudonimiza; si el
-- practicante escribe un nombre o un dato identificatorio, el supervisor lo lee.
-- Cada lectura queda en accesos_ficha (accion SUPERVISION).
-- -----------------------------------------------------------------------------

CREATE FUNCTION supervision_casos()
RETURNS TABLE (codigo text, practicante_id uuid, edad_paciente int, tipo_atencion text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' THEN
    RAISE EXCEPTION 'supervision_casos: solo PROFESIONAL con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- El INSERT del CTE se ejecuta siempre (una fila de auditoria por caso).
  RETURN QUERY
  WITH casos AS (
    SELECT p.id, f.id AS ficha_id, p.codigo_seudonimo, p.profesional_id, p.fecha_nacimiento, p.tipo_atencion_id
    FROM pacientes p LEFT JOIN fichas_clinicas f ON f.paciente_id = p.id
    WHERE p.deleted_at IS NULL AND es_supervisor_vigente_de(p.profesional_id) AND consentimiento_practicante_vigente(p.id)
  ), auditoria AS (
    INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, ficha_id, recurso, accion)
    SELECT app_usuario_id(), 'PROFESIONAL', c.id, c.ficha_id, 'supervision_casos', 'SUPERVISION' FROM casos c
  )
  SELECT c.codigo_seudonimo, c.profesional_id,
         extract(year FROM age((now() AT TIME ZONE 'America/Santiago')::date, c.fecha_nacimiento))::int,
         t.nombre
  FROM casos c LEFT JOIN tipos_atencion t ON t.id = c.tipo_atencion_id
  ORDER BY c.codigo_seudonimo;
END;
$$;

-- Evoluciones escritas por el practicante en ese caso. 0 filas si el codigo no
-- es de un caso supervisado hoy por el usuario.
CREATE FUNCTION supervision_evoluciones(p_codigo text)
RETURNS TABLE (evolucion_id uuid, autor_id uuid, contenido text, corrige_a_id uuid, creado_en timestamptz)
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
  SELECT e.id, e.autor_id, e.contenido, e.corrige_a_id, e.created_at
  FROM evoluciones e
  WHERE e.ficha_clinica_id = v_ficha AND e.autor_id = v_practicante
  ORDER BY e.created_at;
END;
$$;


-- -----------------------------------------------------------------------------
-- 10. Accesos de practicantes y bajas.
-- Toda escritura en usuarios + historial_accesos_practicante ocurre en la misma
-- funcion (misma transaccion): nunca quedan desalineados.
-- -----------------------------------------------------------------------------

-- Interno: desactiva al usuario y deja POR_REPROGRAMAR sus citas confirmadas
-- desde p_desde. Idempotente.
CREATE FUNCTION desactivar_tratante(p_usuario_id uuid, p_desde timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE usuarios SET activo = false, updated_at = now() WHERE id = p_usuario_id AND activo;
  UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
  WHERE profesional_id = p_usuario_id AND estado = 'CONFIRMADA' AND inicio >= p_desde;
END;
$$;

CREATE FUNCTION otorgar_acceso_practicante(p_practicante_id uuid, p_fecha_expiracion timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN otorga acceso a practicantes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM usuarios WHERE id = p_practicante_id AND rol::text = 'PRACTICANTE' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Practicante inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_fecha_expiracion IS NULL OR p_fecha_expiracion <= now() THEN
    RAISE EXCEPTION 'La fecha de expiracion debe ser futura'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'historial_accesos_practicante_expiracion_futura';
  END IF;
  IF supervisor_vigente(p_practicante_id) IS NULL THEN
    RAISE EXCEPTION 'El practicante no tiene supervision vigente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'practicante_requiere_supervision';
  END IF;

  UPDATE usuarios SET activo = true, fecha_expiracion_acceso = p_fecha_expiracion, updated_at = now()
  WHERE id = p_practicante_id;
  INSERT INTO historial_accesos_practicante (practicante_id, actor_id, accion, fecha_expiracion)
  VALUES (p_practicante_id, app_usuario_id(), 'OTORGADO', p_fecha_expiracion);
END;
$$;

-- Sus pacientes pasan a pacientes_por_reasignar(); sus citas futuras, a POR_REPROGRAMAR.
CREATE FUNCTION revocar_acceso_practicante(p_practicante_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_activo boolean;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN revoca acceso a practicantes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT activo INTO v_activo FROM usuarios WHERE id = p_practicante_id AND rol::text = 'PRACTICANTE' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Practicante inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'El practicante ya no tiene acceso' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  PERFORM desactivar_tratante(p_practicante_id, now());
  -- motivo vacio -> CHECK historial_accesos_practicante_coherente (23514).
  INSERT INTO historial_accesos_practicante (practicante_id, actor_id, accion, motivo)
  VALUES (p_practicante_id, app_usuario_id(), 'REVOCADO', p_motivo);
END;
$$;

-- Devuelve cuantas citas quedaron POR_REPROGRAMAR. El usuario sigue activo
-- hasta la fecha efectiva (procesar_bajas lo desactiva).
CREATE FUNCTION iniciar_baja_profesional(p_usuario_id uuid, p_fecha_efectiva timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol text;
  v_activo boolean;
  v_citas int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN inicia bajas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT rol::text, activo INTO v_rol, v_activo FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_rol NOT IN ('PROFESIONAL', 'PRACTICANTE') OR p_fecha_efectiva IS NULL THEN
    RAISE EXCEPTION 'Baja solo para PROFESIONAL o PRACTICANTE, con fecha efectiva'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bajas_validas';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'El usuario ya esta inactivo' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- Segunda baja del mismo usuario -> bajas_usuario_id_key (23505).
  INSERT INTO bajas (usuario_id, fecha_efectiva, iniciada_por_id)
  VALUES (p_usuario_id, p_fecha_efectiva, app_usuario_id());

  UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
  WHERE profesional_id = p_usuario_id AND estado = 'CONFIRMADA' AND inicio >= p_fecha_efectiva;
  GET DIAGNOSTICS v_citas = ROW_COUNT;
  RETURN v_citas;
END;
$$;

-- Job sin contexto (la API lo llama periodicamente). Idempotente: una segunda
-- corrida no desactiva a nadie ni registra eventos nuevos. Devuelve cuantos
-- usuarios desactivo.
--   1. practicantes activos con fecha_expiracion_acceso vencida -> inactivos,
--      citas futuras POR_REPROGRAMAR, evento EXPIRADO;
--   2. bajas con fecha efectiva cumplida -> usuario inactivo, citas desde la
--      fecha efectiva POR_REPROGRAMAR, procesada_en;
--   3. barrido: citas CONFIRMADA agendadas despues de iniciar una baja y
--      posteriores a su fecha efectiva -> POR_REPROGRAMAR.
CREATE FUNCTION procesar_bajas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_total int := 0;
BEGIN
  FOR r IN
    SELECT id, fecha_expiracion_acceso FROM usuarios
    WHERE rol::text = 'PRACTICANTE' AND activo AND fecha_expiracion_acceso <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM desactivar_tratante(r.id, now());
    INSERT INTO historial_accesos_practicante (practicante_id, accion, fecha_expiracion)
    VALUES (r.id, 'EXPIRADO', r.fecha_expiracion_acceso);
    v_total := v_total + 1;
  END LOOP;

  FOR r IN
    SELECT id, usuario_id, fecha_efectiva FROM bajas
    WHERE procesada_en IS NULL AND fecha_efectiva <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM desactivar_tratante(r.usuario_id, r.fecha_efectiva);
    UPDATE bajas SET procesada_en = now() WHERE id = r.id;
    v_total := v_total + 1;
  END LOOP;

  UPDATE citas c SET estado = 'POR_REPROGRAMAR', updated_at = now()
  FROM bajas b
  WHERE c.profesional_id = b.usuario_id AND c.estado = 'CONFIRMADA' AND c.inicio >= b.fecha_efectiva;

  RETURN v_total;
END;
$$;

-- Pacientes cuyo tratante se va (baja), perdio el acceso (practicante revocado,
-- expirado o sin supervision) o ya no tiene consentimiento vigente para
-- atenderlos. Salen de la lista cuando una derivacion aceptada cambia el tratante.
-- ponytail: evalua motivo_reasignacion() por paciente; con miles de pacientes, reescribir como un solo JOIN.
CREATE FUNCTION pacientes_por_reasignar()
RETURNS TABLE (paciente_id uuid, nombre text, apellido text, tratante_id uuid, motivo text, derivacion_abierta boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'pacientes_por_reasignar: solo ADMIN o GESTION' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT p.id, p.nombre, p.apellido, p.profesional_id, m.motivo,
         EXISTS (SELECT 1 FROM derivaciones d JOIN fichas_clinicas f ON f.id = d.ficha_clinica_id
                 WHERE f.paciente_id = p.id AND d.estado IN ('PENDIENTE', 'SIN_ASIGNAR'))
  FROM pacientes p
  CROSS JOIN LATERAL (SELECT motivo_reasignacion(p.id) AS motivo) m
  WHERE m.motivo IS NOT NULL
  ORDER BY p.apellido, p.nombre;
END;
$$;


-- -----------------------------------------------------------------------------
-- 11. Derivaciones (reemplaza funciones de 01c).
-- -----------------------------------------------------------------------------

DROP FUNCTION crear_derivacion(uuid, text, text, uuid[]);
DROP FUNCTION cancelar_derivacion(uuid);
DROP FUNCTION oferta_derivacion(uuid);

-- Candidatos validos: activos, sin baja, distintos del origen; PROFESIONAL, o
-- PRACTICANTE solo si lo agrega ADMIN y tiene acceso y supervision vigentes.
CREATE OR REPLACE FUNCTION agregar_candidatos(p_derivacion_id uuid, p_candidatos uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_max int;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(p_candidatos) AS c(id)
    JOIN derivaciones d ON d.id = p_derivacion_id
    LEFT JOIN usuarios u ON u.id = c.id
    WHERE c.id IS NULL OR c.id = d.profesional_origen_id OR u.id IS NULL OR NOT u.activo
       OR EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
       OR NOT coalesce(u.rol::text = 'PROFESIONAL'
                       OR (u.rol::text = 'PRACTICANTE' AND app_rol() = 'ADMIN'
                           AND u.fecha_expiracion_acceso > now() AND supervisor_vigente(u.id) IS NOT NULL), false)
  ) THEN
    RAISE EXCEPTION 'Candidatos invalidos: PROFESIONAL activos distintos del origen (PRACTICANTE solo via ADMIN y con supervision vigente)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'derivacion_candidatos_validos';
  END IF;

  SELECT coalesce(max(orden), 0) INTO v_max FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id;
  INSERT INTO derivacion_candidatos (derivacion_id, profesional_id, orden)
  SELECT p_derivacion_id, c.id, v_max + c.n::int
  FROM unnest(p_candidatos) WITH ORDINALITY AS c(id, n);
END;
$$;

-- Origen = tratante actual. Lo crea el PROFESIONAL tratante, o ADMIN "de
-- oficio" en nombre del tratante solo si el paciente necesita reasignacion
-- (baja iniciada, practicante sin acceso, consentimiento revocado...).
-- creada_por registra quien la creo.
CREATE FUNCTION crear_derivacion(p_ficha_id uuid, p_motivo text, p_tipo_atencion_id uuid, p_detalle text, p_candidatos uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_paciente uuid;
  v_tratante uuid;
BEGIN
  SELECT p.id, p.profesional_id INTO v_paciente, v_tratante
  FROM fichas_clinicas f JOIN pacientes p ON p.id = f.paciente_id
  WHERE f.id = p_ficha_id;

  IF NOT acceso_vigente()
     OR NOT ((app_rol() = 'PROFESIONAL' AND v_tratante = app_usuario_id())
             OR (app_rol() = 'ADMIN' AND motivo_reasignacion(v_paciente) IS NOT NULL)) THEN
    RAISE EXCEPTION 'Deriva el profesional tratante, o ADMIN de oficio si el tratante se va o perdio el acceso'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tipos_atencion WHERE id = p_tipo_atencion_id AND activo) THEN
    RAISE EXCEPTION 'Tipo de atencion inexistente o inactivo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'derivaciones_tipo_atencion_activo';
  END IF;

  INSERT INTO derivaciones (ficha_clinica_id, profesional_origen_id, motivo, tipo_atencion_id, detalle, creada_por_id)
  VALUES (p_ficha_id, v_tratante, p_motivo, p_tipo_atencion_id, p_detalle, app_usuario_id())
  RETURNING id INTO v_id;

  PERFORM agregar_candidatos(v_id, coalesce(p_candidatos, '{}'));
  PERFORM ofrecer_siguiente_candidato(v_id);
  PERFORM registrar_accion_derivacion(v_id, 'derivaciones');
  RETURN v_id;
END;
$$;

-- Como 01c, pero consciente del reintegro: un candidato con fila pendiente se
-- reordena aunque tenga filas viejas ya respondidas; uno sin fila pendiente que
-- ya respondio no vuelve por aqui (reintegrar_candidato).
CREATE OR REPLACE FUNCTION definir_candidatos_derivacion(p_derivacion_id uuid, p_candidatos uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado estado_derivacion;
  v_max int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN redefine candidatos' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT estado INTO v_estado FROM derivaciones WHERE id = p_derivacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Derivacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado NOT IN ('PENDIENTE', 'SIN_ASIGNAR') THEN
    RAISE EXCEPTION 'La derivacion no admite cambios en estado %', v_estado
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  p_candidatos := coalesce(p_candidatos, '{}');
  IF EXISTS (
    SELECT 1 FROM unnest(p_candidatos) AS c(id)
    WHERE EXISTS (SELECT 1 FROM derivacion_candidatos dc WHERE dc.derivacion_id = p_derivacion_id AND dc.profesional_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM derivacion_candidatos dc WHERE dc.derivacion_id = p_derivacion_id AND dc.profesional_id = c.id
                      AND dc.estado IN ('EN_ESPERA', 'OFRECIDA'))
  ) THEN
    RAISE EXCEPTION 'Un candidato que ya respondio vuelve solo con reintegrar_candidato'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'derivacion_candidatos_validos';
  END IF;

  UPDATE derivacion_candidatos SET estado = 'OMITIDA', ofrecida_en = NULL, vence_en = NULL
  WHERE derivacion_id = p_derivacion_id AND estado IN ('EN_ESPERA', 'OFRECIDA')
    AND NOT (profesional_id = ANY (p_candidatos));

  PERFORM agregar_candidatos(p_derivacion_id, ARRAY(
    SELECT c.id FROM unnest(p_candidatos) WITH ORDINALITY AS c(id, n)
    WHERE NOT EXISTS (SELECT 1 FROM derivacion_candidatos dc
                      WHERE dc.derivacion_id = p_derivacion_id AND dc.profesional_id = c.id)
    ORDER BY c.n));

  SELECT max(orden) INTO v_max FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id;
  UPDATE derivacion_candidatos dc
  SET orden = v_max + c.n::int,
      estado = CASE WHEN c.n = 1 AND dc.estado = 'OFRECIDA' THEN 'OFRECIDA'::estado_candidato ELSE 'EN_ESPERA' END,
      ofrecida_en = CASE WHEN c.n = 1 AND dc.estado = 'OFRECIDA' THEN dc.ofrecida_en END,
      vence_en = CASE WHEN c.n = 1 AND dc.estado = 'OFRECIDA' THEN dc.vence_en END
  FROM unnest(p_candidatos) WITH ORDINALITY AS c(id, n)
  WHERE dc.derivacion_id = p_derivacion_id AND dc.profesional_id = c.id AND dc.estado IN ('EN_ESPERA', 'OFRECIDA');

  IF NOT EXISTS (SELECT 1 FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id AND estado = 'OFRECIDA') THEN
    PERFORM ofrecer_siguiente_candidato(p_derivacion_id);
  END IF;
  PERFORM registrar_accion_derivacion(p_derivacion_id, 'derivacion_candidatos');
END;
$$;

-- ADMIN vuelve a poner al final de la lista a un candidato RECHAZADA, EXPIRADA u
-- OMITIDA, como fila nueva (la respuesta anterior queda en el historial).
CREATE FUNCTION reintegrar_candidato(p_derivacion_id uuid, p_profesional_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado estado_derivacion;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN reintegra candidatos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT estado INTO v_estado FROM derivaciones WHERE id = p_derivacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Derivacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado NOT IN ('PENDIENTE', 'SIN_ASIGNAR') THEN
    RAISE EXCEPTION 'La derivacion no admite cambios en estado %', v_estado
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id
                 AND profesional_id = p_profesional_id AND estado IN ('RECHAZADA', 'EXPIRADA', 'OMITIDA'))
     OR EXISTS (SELECT 1 FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id
                AND profesional_id = p_profesional_id AND estado IN ('EN_ESPERA', 'OFRECIDA', 'ACEPTADA')) THEN
    RAISE EXCEPTION 'Solo se reintegra un candidato que ya respondio y no esta pendiente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'derivacion_candidatos_validos';
  END IF;

  PERFORM agregar_candidatos(p_derivacion_id, ARRAY[p_profesional_id]);
  IF NOT EXISTS (SELECT 1 FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id AND estado = 'OFRECIDA') THEN
    PERFORM ofrecer_siguiente_candidato(p_derivacion_id);
  END IF;
  PERFORM registrar_accion_derivacion(p_derivacion_id, 'derivacion_candidatos');
END;
$$;

-- ADMIN cancela en cualquier estado pendiente; el origen solo SIN_ASIGNAR.
-- Motivo obligatorio. PENDIENTE -> CANCELADA; SIN_ASIGNAR -> CERRADA.
CREATE FUNCTION cancelar_derivacion(p_derivacion_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado estado_derivacion;
  v_origen uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'PROFESIONAL') THEN
    RAISE EXCEPTION 'Cancela ADMIN o el profesional de origen' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT estado, profesional_origen_id INTO v_estado, v_origen FROM derivaciones WHERE id = p_derivacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Derivacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF app_rol() = 'PROFESIONAL' AND v_origen <> app_usuario_id() THEN
    RAISE EXCEPTION 'Cancela ADMIN o el profesional de origen' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_estado NOT IN ('PENDIENTE', 'SIN_ASIGNAR') OR (app_rol() = 'PROFESIONAL' AND v_estado <> 'SIN_ASIGNAR') THEN
    RAISE EXCEPTION 'La derivacion no se puede cancelar en estado %', v_estado
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Motivo de cancelacion obligatorio'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'derivaciones_motivo_cierre';
  END IF;

  UPDATE derivacion_candidatos SET estado = 'OMITIDA', ofrecida_en = NULL, vence_en = NULL
  WHERE derivacion_id = p_derivacion_id AND estado IN ('EN_ESPERA', 'OFRECIDA');
  UPDATE derivaciones
  SET estado = CASE WHEN v_estado = 'PENDIENTE' THEN 'CANCELADA'::estado_derivacion ELSE 'CERRADA' END,
      motivo_cierre = p_motivo, updated_at = now()
  WHERE id = p_derivacion_id;
  PERFORM registrar_accion_derivacion(p_derivacion_id, 'derivaciones');
END;
$$;

-- Lo que ve el candidato OFRECIDO: motivo, tipo, detalle, edad, plazo y
-- cuantas citas futuras del paciente con el origen chocarian con su agenda
-- (o, si estan POR_REPROGRAMAR, con la ocupacion del box).
CREATE FUNCTION oferta_derivacion(p_derivacion_id uuid)
RETURNS TABLE (derivacion_id uuid, motivo text, tipo_atencion text, detalle text, edad_paciente int,
               vence_en timestamptz, citas_en_conflicto int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'oferta_derivacion: requiere acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT d.id, d.motivo, t.nombre, d.detalle,
         extract(year FROM age((now() AT TIME ZONE 'America/Santiago')::date, p.fecha_nacimiento))::int,
         c.vence_en,
         (SELECT count(*)::int FROM citas x
          WHERE x.paciente_id = p.id AND x.profesional_id = d.profesional_origen_id
            AND x.estado IN ('CONFIRMADA', 'POR_REPROGRAMAR') AND x.inicio > now()
            AND (EXISTS (SELECT 1 FROM citas y
                         WHERE y.profesional_id = c.profesional_id AND y.estado = 'CONFIRMADA'
                           AND tstzrange(y.inicio, y.fin, '[)') && tstzrange(x.inicio, x.fin, '[)'))
                 OR (x.estado = 'POR_REPROGRAMAR' AND EXISTS (
                         SELECT 1 FROM citas y
                         WHERE y.espacio_id = x.espacio_id AND y.estado = 'CONFIRMADA'
                           AND tstzrange(y.inicio, y.fin, '[)') && tstzrange(x.inicio, x.fin, '[)')))))
  FROM derivaciones d
  JOIN tipos_atencion t ON t.id = d.tipo_atencion_id
  JOIN derivacion_candidatos c ON c.derivacion_id = d.id
  JOIN fichas_clinicas f ON f.id = d.ficha_clinica_id
  JOIN pacientes p ON p.id = f.paciente_id
  WHERE d.id = p_derivacion_id AND d.estado = 'PENDIENTE'
    AND c.estado = 'OFRECIDA' AND c.profesional_id = app_usuario_id();

  IF FOUND THEN
    PERFORM registrar_accion_derivacion(p_derivacion_id, 'oferta_derivacion');
  END IF;
END;
$$;

-- Interno: al aceptar, las citas futuras del paciente con el origen
-- (CONFIRMADA o POR_REPROGRAMAR) pasan al nuevo tratante y se intentan
-- confirmar; si chocan (profesional o box) o falta adulto responsable quedan
-- POR_REPROGRAMAR con el nuevo tratante.
CREATE FUNCTION reasignar_citas_derivacion(p_paciente_id uuid, p_origen uuid, p_destino uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_cita uuid;
BEGIN
  FOR v_cita IN
    SELECT id FROM citas
    WHERE paciente_id = p_paciente_id AND profesional_id = p_origen
      AND estado IN ('CONFIRMADA', 'POR_REPROGRAMAR') AND inicio > now()
    ORDER BY inicio
  LOOP
    BEGIN
      UPDATE citas SET profesional_id = p_destino, estado = 'CONFIRMADA', updated_at = now() WHERE id = v_cita;
    EXCEPTION WHEN exclusion_violation OR check_violation THEN
      UPDATE citas SET profesional_id = p_destino, estado = 'POR_REPROGRAMAR', updated_at = now() WHERE id = v_cita;
    END;
  END LOOP;
END;
$$;

-- Responde el candidato OFRECIDO (PROFESIONAL o PRACTICANTE). Un PRACTICANTE
-- solo acepta si el paciente tiene consentimiento vigente (ademas lo exige el
-- trigger diferido pacientes_practicante_requiere_consentimiento).
CREATE OR REPLACE FUNCTION responder_derivacion(p_derivacion_id uuid, p_acepta boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_candidato derivacion_candidatos%ROWTYPE;
  v_derivacion derivaciones%ROWTYPE;
  v_paciente uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PROFESIONAL', 'PRACTICANTE') OR p_acepta IS NULL THEN
    RAISE EXCEPTION 'Solo un PROFESIONAL o PRACTICANTE con acceso vigente responde derivaciones'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_derivacion FROM derivaciones WHERE id = p_derivacion_id AND estado = 'PENDIENTE' FOR UPDATE;
  SELECT * INTO v_candidato FROM derivacion_candidatos
  WHERE derivacion_id = p_derivacion_id AND estado = 'OFRECIDA' AND profesional_id = app_usuario_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una oferta de esta derivacion para el usuario'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_candidato.vence_en <= now() THEN
    RAISE EXCEPTION 'La oferta vencio' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF p_acepta THEN
    SELECT paciente_id INTO v_paciente FROM fichas_clinicas WHERE id = v_derivacion.ficha_clinica_id;
    IF app_rol() = 'PRACTICANTE' AND NOT consentimiento_practicante_vigente(v_paciente) THEN
      RAISE EXCEPTION 'Atencion con practicante requiere consentimiento informado vigente'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'pacientes_practicante_requiere_consentimiento';
    END IF;

    UPDATE derivacion_candidatos SET estado = 'ACEPTADA', respondido_en = now() WHERE id = v_candidato.id;
    UPDATE derivacion_candidatos SET estado = 'OMITIDA'
    WHERE derivacion_id = p_derivacion_id AND estado = 'EN_ESPERA';
    UPDATE derivaciones SET estado = 'ACEPTADA', updated_at = now() WHERE id = p_derivacion_id;
    -- Traspaso: el aceptante pasa a ser el tratante (y el tipo de atencion del
    -- paciente, el de la derivacion); el origen pierde acceso por las
    -- politicas. Las evoluciones previas conservan su autor_id.
    UPDATE pacientes SET profesional_id = v_candidato.profesional_id,
                         tipo_atencion_id = v_derivacion.tipo_atencion_id, updated_at = now()
    WHERE id = v_paciente;
    PERFORM reasignar_citas_derivacion(v_paciente, v_derivacion.profesional_origen_id, v_candidato.profesional_id);
  ELSE
    UPDATE derivacion_candidatos SET estado = 'RECHAZADA', respondido_en = now() WHERE id = v_candidato.id;
    PERFORM ofrecer_siguiente_candidato(p_derivacion_id);
  END IF;
  PERFORM registrar_accion_derivacion(p_derivacion_id, 'derivaciones');
END;
$$;


-- -----------------------------------------------------------------------------
-- 12. GRANTs (minimo por tabla; ninguna tabla clinica ni de auditoria con
-- UPDATE/DELETE salvo columnas puntuales).
-- -----------------------------------------------------------------------------

-- usuarios: telefono se suma a las columnas editables.
GRANT UPDATE (telefono) ON usuarios TO app_user;

-- pacientes: UPDATE por columna; nunca id, codigo_seudonimo ni created_at.
-- profesional_id lo sigue cuidando el trigger pacientes_tratante_via_derivacion.
REVOKE UPDATE ON pacientes FROM app_user;
GRANT UPDATE (nombre, apellido, rut, fecha_nacimiento, email, telefono, profesional_id, tipo_atencion_id,
              updated_at, deleted_at)
  ON pacientes TO app_user;

-- Tablas que en 01 tenian GRANT amplio sin RLS: se rehacen al minimo.
REVOKE ALL ON espacios, bloqueos_temporales, profesionales, practicantes, arriendos, boletas,
  historial_accesos_practicante FROM app_user;
GRANT SELECT, INSERT, UPDATE ON espacios, profesionales, practicantes, arriendos, boletas TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON bloqueos_temporales TO app_user;
GRANT SELECT ON historial_accesos_practicante, bajas TO app_user;

GRANT SELECT, INSERT, UPDATE ON tipos_atencion TO app_user;
GRANT SELECT, INSERT, DELETE ON profesional_tipos_atencion TO app_user;
GRANT SELECT, INSERT ON supervisiones, supervision_comentarios, consentimientos TO app_user;
GRANT UPDATE (hasta) ON supervisiones TO app_user;
GRANT UPDATE (revocado_en) ON consentimientos TO app_user;

-- Funciones: publicas solo para app_user; internas para nadie salvo el dueño.
-- Los helpers que usan politicas o triggers de app_user necesitan EXECUTE.
REVOKE EXECUTE ON FUNCTION
  rol_usuario(uuid),
  supervisor_vigente(uuid),
  es_supervisor_vigente_de(uuid),
  consentimiento_practicante_vigente(uuid),
  evolucion_supervisable(uuid),
  motivo_reasignacion(uuid),
  directorio_interno(),
  mi_equipo_tratante(),
  perfiles_publicos(),
  supervision_casos(),
  supervision_evoluciones(text),
  desactivar_tratante(uuid, timestamptz),
  otorgar_acceso_practicante(uuid, timestamptz),
  revocar_acceso_practicante(uuid, text),
  iniciar_baja_profesional(uuid, timestamptz),
  procesar_bajas(),
  pacientes_por_reasignar(),
  crear_derivacion(uuid, text, uuid, text, uuid[]),
  reintegrar_candidato(uuid, uuid),
  cancelar_derivacion(uuid, text),
  oferta_derivacion(uuid),
  reasignar_citas_derivacion(uuid, uuid, uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  rol_usuario(uuid),
  supervisor_vigente(uuid),
  es_supervisor_vigente_de(uuid),
  consentimiento_practicante_vigente(uuid),
  evolucion_supervisable(uuid),
  directorio_interno(),
  mi_equipo_tratante(),
  perfiles_publicos(),
  supervision_casos(),
  supervision_evoluciones(text),
  otorgar_acceso_practicante(uuid, timestamptz),
  revocar_acceso_practicante(uuid, text),
  iniciar_baja_profesional(uuid, timestamptz),
  procesar_bajas(),
  pacientes_por_reasignar(),
  crear_derivacion(uuid, text, uuid, text, uuid[]),
  reintegrar_candidato(uuid, uuid),
  cancelar_derivacion(uuid, text),
  oferta_derivacion(uuid)
TO app_user;


-- -----------------------------------------------------------------------------
-- 13. ENABLE + FORCE RLS y acceso vigente (RESTRICTIVE). Con esto toda tabla
-- de la app tiene RLS (solo _prisma_migrations queda fuera, sin GRANT).
-- -----------------------------------------------------------------------------

ALTER TABLE tipos_atencion ENABLE ROW LEVEL SECURITY;
ALTER TABLE profesional_tipos_atencion ENABLE ROW LEVEL SECURITY;
ALTER TABLE espacios ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloqueos_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE profesionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE practicantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE arriendos ENABLE ROW LEVEL SECURITY;
ALTER TABLE boletas ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_accesos_practicante ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervisiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_comentarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE consentimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE bajas ENABLE ROW LEVEL SECURITY;

ALTER TABLE tipos_atencion FORCE ROW LEVEL SECURITY;
ALTER TABLE profesional_tipos_atencion FORCE ROW LEVEL SECURITY;
ALTER TABLE espacios FORCE ROW LEVEL SECURITY;
ALTER TABLE bloqueos_temporales FORCE ROW LEVEL SECURITY;
ALTER TABLE profesionales FORCE ROW LEVEL SECURITY;
ALTER TABLE practicantes FORCE ROW LEVEL SECURITY;
ALTER TABLE arriendos FORCE ROW LEVEL SECURITY;
ALTER TABLE boletas FORCE ROW LEVEL SECURITY;
ALTER TABLE historial_accesos_practicante FORCE ROW LEVEL SECURITY;
ALTER TABLE supervisiones FORCE ROW LEVEL SECURITY;
ALTER TABLE supervision_comentarios FORCE ROW LEVEL SECURITY;
ALTER TABLE consentimientos FORCE ROW LEVEL SECURITY;
ALTER TABLE bajas FORCE ROW LEVEL SECURITY;

CREATE POLICY tipos_atencion_acceso_vigente ON tipos_atencion AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY profesional_tipos_atencion_acceso_vigente ON profesional_tipos_atencion AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY espacios_acceso_vigente ON espacios AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY bloqueos_temporales_acceso_vigente ON bloqueos_temporales AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY profesionales_acceso_vigente ON profesionales AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY practicantes_acceso_vigente ON practicantes AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY arriendos_acceso_vigente ON arriendos AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY boletas_acceso_vigente ON boletas AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY historial_accesos_practicante_acceso_vigente ON historial_accesos_practicante AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY supervisiones_acceso_vigente ON supervisiones AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY supervision_comentarios_acceso_vigente ON supervision_comentarios AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY consentimientos_acceso_vigente ON consentimientos AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY bajas_acceso_vigente ON bajas AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
