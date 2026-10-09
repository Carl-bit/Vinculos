-- =============================================================================
-- 01f: el paciente primero en la supervision (cambiar de supervisor no
-- invalida consentimientos: se informa y el paciente puede oponerse), cierre
-- de cuentas con periodo de gracia (incluye ADMIN y GESTION), catalogo de
-- tipos de sesion, disponibilidad en minutos, revision de retencion de fichas
-- y margen de traslado entre citas presenciales y online.
--
-- Corre como dueño (vinculos_owner). evoluciones.tipo_sesion (enum) pasa a FK
-- a tipos_sesion: la migracion exige evoluciones vacia (ningun entorno tiene
-- datos reales; ver 01e).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Guardia.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM evoluciones) THEN
    RAISE EXCEPTION '01f cambia evoluciones.tipo_sesion a catalogo: requiere evoluciones vacia (desarrollo: infra/scripts/reset_dev.sh)';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- 1. Enums.
-- -----------------------------------------------------------------------------

CREATE TYPE "estado_tipo_sesion" AS ENUM ('PROPUESTO', 'APROBADO', 'RECHAZADO');
CREATE TYPE "tipo_aviso_consentimiento" AS ENUM ('CAMBIO_SUPERVISOR');
CREATE TYPE "respuesta_aviso" AS ENUM ('SIN_RESPUESTA', 'CONFORME', 'OPOSICION');
CREATE TYPE "decision_retencion" AS ENUM ('CONSERVAR', 'PURGAR');


-- -----------------------------------------------------------------------------
-- 2. DDL (identico al que genera Prisma para el schema).
-- -----------------------------------------------------------------------------

-- supervision_evoluciones devuelve el tipo de sesion: se recrea en la seccion 8.
DROP FUNCTION supervision_evoluciones(text);

ALTER TABLE "evoluciones" DROP COLUMN "tipo_sesion",
ADD COLUMN "tipo_sesion_id" UUID NOT NULL;
DROP TYPE "tipo_sesion";

ALTER TABLE "configuracion_centro" ADD COLUMN "plazo_oposicion_horas" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN "dias_gracia_cierre" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "margen_traslado_min" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "usuarios" ADD COLUMN "desactivado_en" TIMESTAMPTZ(6);

ALTER TABLE "profesionales" ADD COLUMN "margen_traslado_min" INTEGER;

ALTER TABLE "citas" ADD COLUMN "margen_traslado_min" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN "enlace_online" TEXT;

-- Disponibilidad en minutos desde la medianoche local (0-1440): sin 24:00.
ALTER TABLE "disponibilidad_profesional" DROP CONSTRAINT "disponibilidad_profesional_valida";
ALTER TABLE "disponibilidad_profesional" ADD COLUMN "inicio_min" SMALLINT,
ADD COLUMN "fin_min" SMALLINT;
UPDATE "disponibilidad_profesional"
SET "inicio_min" = extract(epoch FROM "hora_inicio")::int / 60, "fin_min" = extract(epoch FROM "hora_fin")::int / 60;
ALTER TABLE "disponibilidad_profesional" ALTER COLUMN "inicio_min" SET NOT NULL,
ALTER COLUMN "fin_min" SET NOT NULL,
DROP COLUMN "hora_inicio",
DROP COLUMN "hora_fin";

CREATE TABLE "tipos_sesion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" "estado_tipo_sesion" NOT NULL DEFAULT 'PROPUESTO',
    "propuesto_por_id" UUID NOT NULL,
    "aprobado_por_id" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipos_sesion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "avisos_consentimiento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consentimiento_id" UUID NOT NULL,
    "tipo" "tipo_aviso_consentimiento" NOT NULL,
    "supervisor_anterior_id" UUID NOT NULL,
    "supervisor_nuevo_id" UUID NOT NULL,
    "notificado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMPTZ(6) NOT NULL,
    "respuesta" "respuesta_aviso" NOT NULL DEFAULT 'SIN_RESPUESTA',
    "respondido_en" TIMESTAMPTZ(6),
    "respondido_por_id" UUID,
    "otorgado_por_tipo" "otorgante_consentimiento",
    "adulto_responsable_id" UUID,
    "respaldo_documento_ref" TEXT,

    CONSTRAINT "avisos_consentimiento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "revisiones_retencion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ficha_id" UUID NOT NULL,
    "revisado_por_id" UUID NOT NULL,
    "revisado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "decision_retencion" NOT NULL,
    "motivo" TEXT NOT NULL,

    CONSTRAINT "revisiones_retencion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consultas_retencion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "consultado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fichas" INTEGER NOT NULL,

    CONSTRAINT "consultas_retencion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tipos_sesion_nombre_key" ON "tipos_sesion"("nombre");
CREATE INDEX "avisos_consentimiento_consentimiento_id_idx" ON "avisos_consentimiento"("consentimiento_id");
CREATE INDEX "revisiones_retencion_ficha_id_idx" ON "revisiones_retencion"("ficha_id");

ALTER TABLE "evoluciones" ADD CONSTRAINT "evoluciones_tipo_sesion_id_fkey" FOREIGN KEY ("tipo_sesion_id") REFERENCES "tipos_sesion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tipos_sesion" ADD CONSTRAINT "tipos_sesion_propuesto_por_id_fkey" FOREIGN KEY ("propuesto_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tipos_sesion" ADD CONSTRAINT "tipos_sesion_aprobado_por_id_fkey" FOREIGN KEY ("aprobado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "avisos_consentimiento" ADD CONSTRAINT "avisos_consentimiento_consentimiento_id_fkey" FOREIGN KEY ("consentimiento_id") REFERENCES "consentimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "avisos_consentimiento" ADD CONSTRAINT "avisos_consentimiento_supervisor_anterior_id_fkey" FOREIGN KEY ("supervisor_anterior_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "avisos_consentimiento" ADD CONSTRAINT "avisos_consentimiento_supervisor_nuevo_id_fkey" FOREIGN KEY ("supervisor_nuevo_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "avisos_consentimiento" ADD CONSTRAINT "avisos_consentimiento_respondido_por_id_fkey" FOREIGN KEY ("respondido_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "avisos_consentimiento" ADD CONSTRAINT "avisos_consentimiento_adulto_responsable_id_fkey" FOREIGN KEY ("adulto_responsable_id") REFERENCES "adultos_responsables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revisiones_retencion" ADD CONSTRAINT "revisiones_retencion_ficha_id_fkey" FOREIGN KEY ("ficha_id") REFERENCES "fichas_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revisiones_retencion" ADD CONSTRAINT "revisiones_retencion_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consultas_retencion" ADD CONSTRAINT "consultas_retencion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cuentas ya inactivas: la gracia corre desde su ultima actualizacion.
UPDATE usuarios SET desactivado_en = updated_at WHERE NOT activo AND cerrada_en IS NULL;


-- -----------------------------------------------------------------------------
-- 3. Reglas que Prisma no expresa.
-- -----------------------------------------------------------------------------

ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_plazos_01f
  CHECK (plazo_oposicion_horas > 0 AND dias_gracia_cierre >= 0 AND margen_traslado_min BETWEEN 0 AND 600);
ALTER TABLE profesionales ADD CONSTRAINT profesionales_margen_traslado_valido
  CHECK (margen_traslado_min BETWEEN 0 AND 600);
ALTER TABLE citas ADD CONSTRAINT citas_margen_traslado_valido CHECK (margen_traslado_min >= 0);
-- El enlace de videollamada solo existe en citas online (lo genera la API, 02).
ALTER TABLE citas ADD CONSTRAINT citas_enlace_solo_online
  CHECK (modalidad = 'ONLINE' OR enlace_online IS NULL);

ALTER TABLE disponibilidad_profesional ADD CONSTRAINT disponibilidad_profesional_valida
  CHECK (dia_semana BETWEEN 1 AND 7 AND inicio_min >= 0 AND inicio_min < fin_min AND fin_min <= 1440);

ALTER TABLE tipos_sesion ADD CONSTRAINT tipos_sesion_valido
  CHECK (btrim(nombre) <> '' AND (estado = 'PROPUESTO') = (aprobado_por_id IS NULL));

-- Respuesta explicita (con quien respondio y como) o tacita (CONFORME por
-- vencimiento, sin respondido_por). La oposicion siempre es explicita.
ALTER TABLE avisos_consentimiento ADD CONSTRAINT avisos_consentimiento_coherente
  CHECK ((respuesta = 'SIN_RESPUESTA') = (respondido_en IS NULL)
         AND (respondido_por_id IS NULL) = (otorgado_por_tipo IS NULL)
         AND (respuesta <> 'OPOSICION' OR respondido_por_id IS NOT NULL)
         AND (otorgado_por_tipo IS DISTINCT FROM 'ADULTO_RESPONSABLE') = (adulto_responsable_id IS NULL)
         AND vence_en > notificado_en);
-- Un aviso abierto por consentimiento.
CREATE UNIQUE INDEX avisos_consentimiento_uno_abierto
  ON avisos_consentimiento (consentimiento_id) WHERE respuesta = 'SIN_RESPUESTA';

ALTER TABLE revisiones_retencion ADD CONSTRAINT revisiones_retencion_motivo CHECK (btrim(motivo) <> '');


-- -----------------------------------------------------------------------------
-- 4. Helpers.
-- -----------------------------------------------------------------------------

-- Unica conversion de "minuto del dia local" a instante: la usan el trigger de
-- citas y disponibilidad_publica(). En los dias de cambio de horario de Chile
-- el dia local dura 23 o 25 h; un minuto inexistente (00:00 del domingo de
-- septiembre) se interpreta como el primer instante valido (01:00).
CREATE FUNCTION minuto_local(p_fecha date, p_minuto int) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT (p_fecha::timestamp + make_interval(mins => p_minuto)) AT TIME ZONE 'America/Santiago'
$$;

-- Rango de una cita ampliado en medio margen por lado (minutos). Declarada
-- IMMUTABLE para poder usarla en el EXCLUDE: solo suma segundos, que no
-- dependen de la zona horaria (timestamptz +/- interval es STABLE en general
-- por los intervalos de dias/meses).
CREATE FUNCTION rango_con_margen(p_inicio timestamptz, p_fin timestamptz, p_margen_min int) RETURNS tstzrange
LANGUAGE sql IMMUTABLE AS $$
  SELECT tstzrange(p_inicio - p_margen_min * interval '30 seconds', p_fin + p_margen_min * interval '30 seconds', '[)')
$$;

-- Margen vigente del profesional: el propio o, si es nulo, el del centro.
CREATE FUNCTION margen_vigente(p_profesional_id uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT margen_traslado_min FROM profesionales WHERE usuario_id = p_profesional_id),
                  (SELECT margen_traslado_min FROM configuracion_centro))
$$;

-- El consentimiento cubre "atencion por el practicante X bajo supervision de un
-- profesional del centro": vigente = ACEPTADO y nombra a ese practicante. El
-- supervisor que figura es el de la firma; cambiarlo genera un aviso, no
-- invalida.
CREATE OR REPLACE FUNCTION consentimiento_vigente_para(p_paciente_id uuid, p_practicante_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM consentimientos
    WHERE paciente_id = p_paciente_id AND practicante_id = p_practicante_id
      AND tipo = 'ATENCION_CON_PRACTICANTE_SUPERVISADO' AND estado = 'ACEPTADO'
  )
$$;

-- Ultima atencion de una ficha: ultima evolucion o ultima cita confirmada ya
-- ocurrida; sin ninguna, la apertura.
CREATE FUNCTION ultima_atencion(p_ficha_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(greatest(
           (SELECT max(e.created_at) FROM evoluciones e WHERE e.ficha_clinica_id = f.id),
           (SELECT max(c.fin) FROM citas c WHERE c.paciente_id = f.paciente_id AND c.estado = 'CONFIRMADA' AND c.fin <= now())),
         f.fecha_apertura)
  FROM fichas_clinicas f WHERE f.id = p_ficha_id
$$;


-- -----------------------------------------------------------------------------
-- 5. Triggers.
-- -----------------------------------------------------------------------------

-- usuarios (reemplaza usuarios_sin_reactivacion de 01e):
--   - una cuenta cerrada no cambia mas (23001);
--   - activo false -> true se permite mientras no este cerrada (gracia);
--   - desactivado_en marca el inicio de la gracia;
--   - nunca se desactiva ni deja de ser ADMIN el ultimo ADMIN activo (23514).
-- Aplica a todos (incluido el dueño). El FOR UPDATE sobre configuracion_centro
-- serializa dos desactivaciones de ADMIN concurrentes.
DROP TRIGGER usuarios_sin_reactivacion ON usuarios;
DROP FUNCTION bloquear_reactivacion();

CREATE FUNCTION proteger_ciclo_cuenta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Cuenta cerrada: no se modifica (quien vuelve recibe cuenta nueva)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.activo AND NOT NEW.activo THEN
    NEW.desactivado_en := now();
  ELSIF NOT OLD.activo AND NEW.activo THEN
    NEW.desactivado_en := NULL;
  END IF;
  IF OLD.rol = 'ADMIN' AND OLD.activo AND (NOT NEW.activo OR NEW.rol <> 'ADMIN') THEN
    PERFORM 1 FROM configuracion_centro FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE rol = 'ADMIN' AND activo AND id <> OLD.id) THEN
      RAISE EXCEPTION 'No se puede desactivar al ultimo ADMIN activo'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_ultimo_admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuarios_ciclo_cuenta BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION proteger_ciclo_cuenta();

-- citas: el margen se fija al confirmar (valor vigente en ese momento) y se
-- recalcula si cambia el profesional, el horario o la modalidad.
CREATE FUNCTION fijar_margen_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'CONFIRMADA'
     AND (TG_OP = 'INSERT' OR OLD.estado <> 'CONFIRMADA'
          OR (NEW.profesional_id, NEW.inicio, NEW.fin, NEW.modalidad)
             IS DISTINCT FROM (OLD.profesional_id, OLD.inicio, OLD.fin, OLD.modalidad)) THEN
    NEW.margen_traslado_min := margen_vigente(NEW.profesional_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER citas_margen_fijado
  BEFORE INSERT OR UPDATE OF estado, profesional_id, inicio, fin, modalidad ON citas
  FOR EACH ROW EXECUTE FUNCTION fijar_margen_cita();

-- Margen de traslado: dos citas CONFIRMADA del mismo profesional en distinta
-- modalidad necesitan al menos (margen_a + margen_b) / 2 minutos entre si (con
-- el mismo margen, el margen). Ambos sentidos. Violacion = 23P01 (409).
ALTER TABLE citas ADD CONSTRAINT citas_margen_traslado
  EXCLUDE USING gist (profesional_id WITH =, modalidad WITH <>,
                      rango_con_margen(inicio, fin, margen_traslado_min) WITH &&)
  WHERE (estado = 'CONFIRMADA');

-- citas: disponibilidad en minutos via minuto_local() (reemplaza la de 01e).
CREATE OR REPLACE FUNCTION validar_agenda_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_dia date := (NEW.inicio AT TIME ZONE 'America/Santiago')::date;
BEGIN
  IF NEW.estado <> 'CONFIRMADA' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM disponibilidad_profesional d
    WHERE d.profesional_id = NEW.profesional_id AND d.modalidad = NEW.modalidad
      AND d.dia_semana = extract(isodow FROM v_dia)
      AND NEW.inicio >= minuto_local(v_dia, d.inicio_min)
      AND NEW.fin <= minuto_local(v_dia, d.fin_min)
  ) THEN
    RAISE EXCEPTION 'La cita cae fuera de la disponibilidad del profesional para esa modalidad'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_disponibilidad';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bloqueos_agenda b
    WHERE b.profesional_id = NEW.profesional_id
      AND tstzrange(b.inicio, b.fin, '[)') && tstzrange(NEW.inicio, NEW.fin, '[)')
  ) THEN
    RAISE EXCEPTION 'El profesional tiene la agenda bloqueada en ese horario'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_fuera_de_bloqueos';
  END IF;
  RETURN NEW;
END;
$$;

-- tipos_sesion: PROFESIONAL/PRACTICANTE proponen (siempre PROPUESTO); solo
-- ADMIN aprueba o rechaza (aprobado_por = quien decidio).
CREATE FUNCTION proteger_tipo_sesion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF app_rol() IS DISTINCT FROM 'ADMIN' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Solo ADMIN modifica tipos de sesion' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.estado := 'PROPUESTO';
    NEW.aprobado_por_id := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.aprobado_por_id := CASE WHEN NEW.estado = 'PROPUESTO' THEN NULL ELSE app_usuario_id() END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tipos_sesion_protegidos BEFORE INSERT OR UPDATE ON tipos_sesion
  FOR EACH ROW EXECUTE FUNCTION proteger_tipo_sesion();

-- evoluciones: solo con tipos de sesion APROBADOS y activos.
CREATE FUNCTION validar_tipo_sesion_evolucion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tipos_sesion WHERE id = NEW.tipo_sesion_id AND estado = 'APROBADO' AND activo) THEN
    RAISE EXCEPTION 'Tipo de sesion no aprobado o inactivo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'evoluciones_tipo_sesion_aprobado';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evoluciones_tipo_sesion_aprobado BEFORE INSERT ON evoluciones
  FOR EACH ROW EXECUTE FUNCTION validar_tipo_sesion_evolucion();

-- avisos_consentimiento: append-only salvo responder una vez. Incluso dueño.
CREATE FUNCTION proteger_aviso_consentimiento() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.respuesta <> 'SIN_RESPUESTA' OR NEW.respuesta = 'SIN_RESPUESTA'
     OR (NEW.id, NEW.consentimiento_id, NEW.tipo, NEW.supervisor_anterior_id, NEW.supervisor_nuevo_id, NEW.notificado_en, NEW.vence_en)
        IS DISTINCT FROM
        (OLD.id, OLD.consentimiento_id, OLD.tipo, OLD.supervisor_anterior_id, OLD.supervisor_nuevo_id, OLD.notificado_en, OLD.vence_en) THEN
    RAISE EXCEPTION 'avisos_consentimiento es append-only: solo se responde una vez'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER avisos_consentimiento_append_only BEFORE UPDATE OR DELETE ON avisos_consentimiento
  FOR EACH ROW EXECUTE FUNCTION proteger_aviso_consentimiento();

-- revisiones_retencion: PURGAR solo sobre fichas que superan los 15 años.
CREATE FUNCTION validar_revision_retencion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.decision = 'PURGAR' AND ultima_atencion(NEW.ficha_id) > now() - interval '15 years' THEN
    RAISE EXCEPTION 'PURGAR solo para fichas cuya ultima atencion supera los 15 años'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'revisiones_retencion_plazo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER revisiones_retencion_validas BEFORE INSERT ON revisiones_retencion
  FOR EACH ROW EXECUTE FUNCTION validar_revision_retencion();
CREATE TRIGGER revisiones_retencion_append_only BEFORE UPDATE OR DELETE ON revisiones_retencion
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();
CREATE TRIGGER consultas_retencion_append_only BEFORE UPDATE OR DELETE ON consultas_retencion
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();


-- -----------------------------------------------------------------------------
-- 6. Politicas y GRANTs de tablas.
-- -----------------------------------------------------------------------------

-- supervisiones: solo via cambiar_supervisor() (nunca un practicante sin supervisor).
DROP POLICY supervisiones_insert ON supervisiones;
DROP POLICY supervisiones_update ON supervisiones;
REVOKE INSERT, UPDATE ON supervisiones FROM app_user;

-- tipos_sesion (B): todos leen; proponen PROFESIONAL/PRACTICANTE (y ADMIN);
-- solo ADMIN actualiza; nunca DELETE (se desactiva).
CREATE POLICY tipos_sesion_select ON tipos_sesion FOR SELECT TO app_user USING (true);
CREATE POLICY tipos_sesion_insert ON tipos_sesion FOR INSERT TO app_user
  WITH CHECK (propuesto_por_id = (SELECT app_usuario_id())
              AND (SELECT app_rol()) IN ('ADMIN', 'PROFESIONAL', 'PRACTICANTE'));
CREATE POLICY tipos_sesion_update ON tipos_sesion FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');

-- avisos_consentimiento (A): los ve quien ve el consentimiento (la subconsulta
-- pasa por la RLS de consentimientos). Escritura via funciones.
CREATE POLICY avisos_consentimiento_select ON avisos_consentimiento FOR SELECT TO app_user
  USING (consentimiento_id IN (SELECT id FROM consentimientos));

-- revisiones_retencion y consultas_retencion (A): solo ADMIN.
CREATE POLICY revisiones_retencion_select ON revisiones_retencion FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY revisiones_retencion_insert ON revisiones_retencion FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'ADMIN' AND revisado_por_id = (SELECT app_usuario_id()));
CREATE POLICY consultas_retencion_select ON consultas_retencion FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');

GRANT SELECT, INSERT, UPDATE ON tipos_sesion TO app_user;
GRANT SELECT ON avisos_consentimiento, consultas_retencion TO app_user;
GRANT SELECT, INSERT ON revisiones_retencion TO app_user;
GRANT UPDATE (plazo_oposicion_horas, dias_gracia_cierre, margen_traslado_min) ON configuracion_centro TO app_user;

ALTER TABLE tipos_sesion ENABLE ROW LEVEL SECURITY;
ALTER TABLE avisos_consentimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisiones_retencion ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultas_retencion ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_sesion FORCE ROW LEVEL SECURITY;
ALTER TABLE avisos_consentimiento FORCE ROW LEVEL SECURITY;
ALTER TABLE revisiones_retencion FORCE ROW LEVEL SECURITY;
ALTER TABLE consultas_retencion FORCE ROW LEVEL SECURITY;

CREATE POLICY tipos_sesion_acceso_vigente ON tipos_sesion AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY avisos_consentimiento_acceso_vigente ON avisos_consentimiento AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY revisiones_retencion_acceso_vigente ON revisiones_retencion AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY consultas_retencion_acceso_vigente ON consultas_retencion AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));


-- -----------------------------------------------------------------------------
-- 7. Supervision: cambio de supervisor y avisos al paciente.
-- Principio: el objetivo es el paciente. Se consiente quien atiende (el
-- practicante); se informa quien supervisa. El supervisor siempre existe y
-- cambiarlo no afecta las sesiones.
-- -----------------------------------------------------------------------------

-- Cierra la supervision vigente y abre la nueva en la misma transaccion. Por
-- cada paciente del practicante con consentimiento ACEPTADO crea un aviso
-- (plazo de oposicion). Devuelve cuantos avisos creo.
CREATE FUNCTION cambiar_supervisor(p_practicante_id uuid, p_nuevo_supervisor_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_anterior uuid;
  v_avisos int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN cambia supervisores' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM usuarios WHERE id = p_practicante_id AND rol = 'PRACTICANTE' AND cerrada_en IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Practicante inexistente o con cuenta cerrada' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT supervisor_id INTO v_anterior FROM supervisiones
  WHERE practicante_id = p_practicante_id AND desde <= now() AND (hasta IS NULL OR hasta > now());
  IF v_anterior = p_nuevo_supervisor_id THEN
    RAISE EXCEPTION 'El practicante ya esta supervisado por ese profesional'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE supervisiones SET hasta = now()
  WHERE practicante_id = p_practicante_id AND desde < now() AND (hasta IS NULL OR hasta > now());
  -- Supervisor invalido -> trigger supervisiones_roles_validos (23514).
  INSERT INTO supervisiones (practicante_id, supervisor_id, desde) VALUES (p_practicante_id, p_nuevo_supervisor_id, now());

  IF v_anterior IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO avisos_consentimiento (consentimiento_id, tipo, supervisor_anterior_id, supervisor_nuevo_id, vence_en)
  SELECT c.id, 'CAMBIO_SUPERVISOR', v_anterior, p_nuevo_supervisor_id,
         now() + make_interval(hours => (SELECT plazo_oposicion_horas FROM configuracion_centro))
  FROM consentimientos c JOIN pacientes p ON p.id = c.paciente_id
  WHERE c.practicante_id = p_practicante_id AND c.estado = 'ACEPTADO'
    AND p.profesional_id = p_practicante_id AND p.deleted_at IS NULL;
  GET DIAGNOSTICS v_avisos = ROW_COUNT;
  RETURN v_avisos;
END;
$$;

-- Respuesta al aviso: PACIENTE (el propio o su adulto responsable si es menor)
-- o ADMIN/GESTION con respaldo. OPOSICION = revocacion del consentimiento.
CREATE FUNCTION responder_aviso_consentimiento(p_aviso_id uuid, p_respuesta respuesta_aviso,
                                               p_otorgado_por_tipo otorgante_consentimiento,
                                               p_adulto_responsable_id uuid, p_respaldo_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_aviso avisos_consentimiento%ROWTYPE;
  v_paciente uuid;
BEGIN
  SELECT * INTO v_aviso FROM avisos_consentimiento WHERE id = p_aviso_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aviso inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT paciente_id INTO v_paciente FROM consentimientos WHERE id = v_aviso.consentimiento_id;
  PERFORM validar_otorgante(v_paciente, p_otorgado_por_tipo, p_adulto_responsable_id, p_respaldo_ref);
  IF v_aviso.respuesta <> 'SIN_RESPUESTA' OR v_aviso.vence_en <= now() THEN
    RAISE EXCEPTION 'El aviso ya fue respondido o vencio' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_respuesta IS NULL OR p_respuesta = 'SIN_RESPUESTA' THEN
    RAISE EXCEPTION 'Respuesta invalida: CONFORME u OPOSICION'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'avisos_consentimiento_coherente';
  END IF;

  UPDATE avisos_consentimiento
  SET respuesta = p_respuesta, respondido_en = now(), respondido_por_id = app_usuario_id(),
      otorgado_por_tipo = p_otorgado_por_tipo, adulto_responsable_id = p_adulto_responsable_id,
      respaldo_documento_ref = p_respaldo_ref
  WHERE id = p_aviso_id;

  IF p_respuesta = 'OPOSICION' THEN
    PERFORM revocar_consentimiento(v_aviso.consentimiento_id, p_otorgado_por_tipo, p_adulto_responsable_id, p_respaldo_ref);
  END IF;
END;
$$;

-- Job: avisos sin respuesta al vencer = CONFORME (tacito: sin respondido_por).
-- Idempotente; devuelve cuantos cerro.
CREATE FUNCTION cerrar_avisos_vencidos() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total int;
BEGIN
  UPDATE avisos_consentimiento SET respuesta = 'CONFORME', respondido_en = now()
  WHERE respuesta = 'SIN_RESPUESTA' AND vence_en <= now();
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

-- Ademas de 01e: tipo de sesion como nombre del catalogo.
CREATE FUNCTION supervision_evoluciones(p_codigo text)
RETURNS TABLE (evolucion_id uuid, autor_id uuid, tipo_sesion text, intervenciones text[], estado_avance text,
               nivel_riesgo nivel_riesgo, notas bytea, corrige_a_id uuid, creado_en timestamptz)
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
         ea.nombre, e.nivel_riesgo, e.notas, e.corrige_a_id, e.created_at
  FROM evoluciones e
  JOIN tipos_sesion ts ON ts.id = e.tipo_sesion_id
  LEFT JOIN estados_avance ea ON ea.id = e.estado_avance_id
  WHERE e.ficha_clinica_id = v_ficha AND e.autor_id = v_practicante
  ORDER BY e.created_at;
END;
$$;


-- -----------------------------------------------------------------------------
-- 8. Bajas y cierre de cuentas (reemplaza 01e).
-- -----------------------------------------------------------------------------

-- Baja de cualquier cuenta de equipo. GESTION sigue el flujo de PROFESIONAL.
-- ADMIN: solo la inicia otro ADMIN, nunca la propia y nunca la del ultimo ADMIN
-- activo sin baja. No se da de baja a quien supervisa practicantes vigentes:
-- primero cambiar_supervisor (nunca un practicante sin supervisor).
CREATE OR REPLACE FUNCTION iniciar_baja_profesional(p_usuario_id uuid, p_fecha_efectiva timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol text;
  v_activo boolean;
  v_citas int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN inicia bajas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_usuario_id = app_usuario_id() THEN
    RAISE EXCEPTION 'Nadie inicia su propia baja' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT rol::text, activo INTO v_rol, v_activo FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_rol = 'PACIENTE' OR p_fecha_efectiva IS NULL THEN
    RAISE EXCEPTION 'Baja solo para cuentas de equipo, con fecha efectiva'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bajas_validas';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'El usuario ya esta inactivo' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_rol = 'ADMIN' THEN
    PERFORM 1 FROM configuracion_centro FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.rol = 'ADMIN' AND u.activo AND u.id <> p_usuario_id
                   AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)) THEN
      RAISE EXCEPTION 'No se da de baja al ultimo ADMIN activo'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_ultimo_admin';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM supervisiones s JOIN usuarios u ON u.id = s.practicante_id
             WHERE s.supervisor_id = p_usuario_id AND u.activo
               AND s.desde <= now() AND (s.hasta IS NULL OR s.hasta > now())) THEN
    RAISE EXCEPTION 'Supervisa practicantes activos: cambiar su supervisor antes de la baja'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO bajas (usuario_id, fecha_efectiva, iniciada_por_id)
  VALUES (p_usuario_id, p_fecha_efectiva, app_usuario_id());
  IF v_rol IN ('PROFESIONAL', 'PRACTICANTE') THEN
    INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo)
    VALUES (p_usuario_id, p_fecha_efectiva, NULL, 'BAJA');
  END IF;

  UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
  WHERE profesional_id = p_usuario_id AND estado = 'CONFIRMADA' AND inicio >= p_fecha_efectiva;
  GET DIAGNOSTICS v_citas = ROW_COUNT;
  RETURN v_citas;
END;
$$;

-- Job. El vaciado (cerrar_cuenta) es irreversible y solo ocurre:
--   - con baja explicita, al llegar su fecha efectiva; o
--   - sin baja, si la cuenta lleva inactiva mas de dias_gracia_cierre.
-- Dentro de la gracia una cuenta revocada, expirada o desactivada se puede
-- reactivar sin perder datos. Si desactivar una baja dejaria al centro sin
-- ADMIN, esa baja queda pendiente (se reintenta en la proxima corrida).
-- Idempotente; devuelve cuantos usuarios desactivo.
CREATE OR REPLACE FUNCTION procesar_bajas() RETURNS integer
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
    BEGIN
      PERFORM desactivar_tratante(r.usuario_id, r.fecha_efectiva);
      UPDATE bajas SET procesada_en = now() WHERE id = r.id;
      PERFORM cerrar_cuenta(r.usuario_id);
      v_total := v_total + 1;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  UPDATE citas c SET estado = 'POR_REPROGRAMAR', updated_at = now()
  FROM bajas b
  WHERE c.profesional_id = b.usuario_id AND c.estado = 'CONFIRMADA' AND c.inicio >= b.fecha_efectiva;

  FOR r IN
    SELECT u.id FROM usuarios u
    WHERE u.rol::text <> 'PACIENTE' AND NOT u.activo AND u.cerrada_en IS NULL
      AND u.desactivado_en <= now() - make_interval(days => (SELECT dias_gracia_cierre FROM configuracion_centro))
      AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM cerrar_cuenta(r.id);
  END LOOP;

  RETURN v_total;
END;
$$;

-- Reactiva dentro de la gracia (cuenta no cerrada) o ajusta la expiracion.
CREATE OR REPLACE FUNCTION otorgar_acceso_practicante(p_practicante_id uuid, p_fecha_expiracion timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cerrada timestamptz;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN otorga acceso a practicantes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT cerrada_en INTO v_cerrada FROM usuarios WHERE id = p_practicante_id AND rol::text = 'PRACTICANTE' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Practicante inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_cerrada IS NOT NULL THEN
    RAISE EXCEPTION 'Cuenta cerrada: quien vuelve recibe cuenta nueva' USING ERRCODE = 'object_not_in_prerequisite_state';
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


-- -----------------------------------------------------------------------------
-- 9. Retencion de fichas: sin purga automatica. 15 años es el minimo legal
-- (Decreto 41, Ley 20.584), no una fecha de borrado.
-- -----------------------------------------------------------------------------

-- Solo ADMIN. Cada consulta queda registrada (consultas_retencion, aun sin
-- resultados) y cada ficha listada en accesos_ficha (RETENCION).
CREATE FUNCTION fichas_sobre_retencion()
RETURNS TABLE (ficha_id uuid, paciente_id uuid, ultima_atencion_en timestamptz,
               ultima_decision decision_retencion, ultima_revision_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'fichas_sobre_retencion: solo ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH fichas AS (
    SELECT f.id, f.paciente_id, ultima_atencion(f.id) AS ultima
    FROM fichas_clinicas f
    WHERE ultima_atencion(f.id) <= now() - interval '15 years'
  ), consulta AS (
    INSERT INTO consultas_retencion (usuario_id, fichas) SELECT app_usuario_id(), count(*) FROM fichas
  ), accesos AS (
    INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, ficha_id, recurso, accion)
    SELECT app_usuario_id(), 'ADMIN', x.paciente_id, x.id, 'fichas_sobre_retencion', 'RETENCION' FROM fichas x
  )
  SELECT x.id, x.paciente_id, x.ultima, r.decision, r.revisado_en
  FROM fichas x
  LEFT JOIN LATERAL (SELECT decision, revisado_en FROM revisiones_retencion rr
                     WHERE rr.ficha_id = x.id ORDER BY rr.revisado_en DESC LIMIT 1) r ON true
  ORDER BY x.ultima;
END;
$$;


-- -----------------------------------------------------------------------------
-- 10. Agenda: huecos con margen de traslado y citas que no cumplen el margen.
-- -----------------------------------------------------------------------------

-- Como 01e, con disponibilidad en minutos (minuto_local) y descontando el
-- margen: para una modalidad, una cita de la otra modalidad ocupa ademas su
-- margen de traslado (el de la cita y el vigente del profesional, medio y
-- medio, igual que el EXCLUDE).
CREATE OR REPLACE FUNCTION disponibilidad_publica(p_profesional_id uuid, desde timestamptz, hasta timestamptz)
RETURNS TABLE (modalidad modalidad_atencion, inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_margen int := margen_vigente(p_profesional_id);
BEGIN
  IF desde IS NULL OR hasta IS NULL OR hasta <= desde OR hasta - desde > interval '62 days' THEN
    RAISE EXCEPTION 'Rango invalido (maximo 62 dias)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'disponibilidad_publica_rango';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = p_profesional_id AND u.activo
                 AND u.rol::text IN ('PROFESIONAL', 'PRACTICANTE'))
     OR NOT (acceso_vigente() OR EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH ventanas AS (
    SELECT d.modalidad AS m,
           tstzrange(minuto_local(g.dia::date, d.inicio_min), minuto_local(g.dia::date, d.fin_min), '[)') AS r
    FROM generate_series((desde AT TIME ZONE 'America/Santiago')::date::timestamp,
                         (hasta AT TIME ZONE 'America/Santiago')::date::timestamp, interval '1 day') AS g(dia)
    JOIN disponibilidad_profesional d ON d.profesional_id = p_profesional_id AND d.dia_semana = extract(isodow FROM g.dia)
  ), ocupado AS (
    SELECT mm.m,
           CASE WHEN c.modalidad = mm.m THEN tstzrange(c.inicio, c.fin, '[)')
                ELSE rango_con_margen(c.inicio, c.fin, c.margen_traslado_min + v_margen) END AS r
    FROM citas c CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE c.profesional_id = p_profesional_id AND c.estado = 'CONFIRMADA'
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
                  * tstzmultirange(tstzrange(desde, hasta, '[)'))) AS r
    FROM ventanas v GROUP BY v.m
  )
  SELECT l.m, lower(l.r), upper(l.r) FROM libres l ORDER BY 2, 1;
END;
$$;

-- Citas futuras CONFIRMADA del profesional que no cumplen el margen VIGENTE
-- (p. ej. despues de subirlo): no se mueven solas; ADMIN/GESTION las
-- reprograman y avisan al paciente. Cada par aparece una vez.
CREATE FUNCTION citas_en_conflicto_margen(p_profesional_id uuid)
RETURNS TABLE (cita_id uuid, cita_conflicto_id uuid, inicio timestamptz, separacion_min int, margen_min int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_margen int := margen_vigente(p_profesional_id);
BEGIN
  IF NOT acceso_vigente() OR NOT (app_rol() IN ('ADMIN', 'GESTION') OR app_usuario_id() = p_profesional_id) THEN
    RAISE EXCEPTION 'citas_en_conflicto_margen: ADMIN, GESTION o el propio profesional' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT a.id, b.id, a.inicio, (extract(epoch FROM b.inicio - a.fin) / 60)::int, v_margen
  FROM citas a
  JOIN citas b ON b.profesional_id = a.profesional_id AND b.modalidad <> a.modalidad
              AND b.estado = 'CONFIRMADA' AND b.inicio >= a.fin
              AND b.inicio < a.fin + v_margen * interval '1 minute'
  WHERE a.profesional_id = p_profesional_id AND a.estado = 'CONFIRMADA' AND a.inicio > now()
  ORDER BY a.inicio;
END;
$$;


-- -----------------------------------------------------------------------------
-- 11. EXECUTE de funciones.
-- -----------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION
  margen_vigente(uuid),
  ultima_atencion(uuid),
  cambiar_supervisor(uuid, uuid),
  responder_aviso_consentimiento(uuid, respuesta_aviso, otorgante_consentimiento, uuid, text),
  cerrar_avisos_vencidos(),
  supervision_evoluciones(text),
  fichas_sobre_retencion(),
  citas_en_conflicto_margen(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  cambiar_supervisor(uuid, uuid),
  responder_aviso_consentimiento(uuid, respuesta_aviso, otorgante_consentimiento, uuid, text),
  cerrar_avisos_vencidos(),
  supervision_evoluciones(text),
  fichas_sobre_retencion(),
  citas_en_conflicto_margen(uuid)
TO app_user;
