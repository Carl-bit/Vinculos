-- =============================================================================
-- 01c: catalogo de roles final, configuracion del centro, RLS en usuarios,
-- citas, pagos y adultos_responsables, y derivaciones con oferta secuencial.
--
-- Corre como dueño de la BD (vinculos_owner: no superusuario, BYPASSRLS,
-- CREATEROLE; ver infra/postgres/init/10-rol-owner.sh).
--
-- Enum `rol`: ALTER TYPE ... ADD VALUE no se puede USAR en la misma transaccion
-- en que se agrega (Prisma aplica cada migracion en una). Por eso aqui los
-- valores nuevos siempre se comparan como texto (rol::text = 'PACIENTE'), en
-- CHECKs, politicas y funciones. Los enums nuevos (estado_*) si se usan
-- directo: CREATE TYPE no tiene esa restriccion.
--
-- Convencion de excepciones (la API las traduce, ver requisitos 02):
--   42501 insufficient_privilege      -> 403 / 404
--   23514 check_violation             -> 422
--   23505 unique_violation            -> 409
--   55000 object_not_in_prerequisite_state (estado no permite la accion) -> 409
--   P0002 no_data_found               -> 404
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

ALTER TYPE "rol" ADD VALUE 'GESTION' BEFORE 'PROFESIONAL';
ALTER TYPE "rol" ADD VALUE 'PACIENTE';

CREATE TYPE "estado_derivacion" AS ENUM ('PENDIENTE', 'ACEPTADA', 'SIN_ASIGNAR', 'CANCELADA', 'CERRADA');
CREATE TYPE "estado_candidato" AS ENUM ('EN_ESPERA', 'OFRECIDA', 'ACEPTADA', 'RECHAZADA', 'EXPIRADA', 'OMITIDA');


-- -----------------------------------------------------------------------------
-- 2. Politicas que se reescriben y helpers de la derivacion "activa" (modelo
-- 01). El acceso por derivacion activa desaparece: ahora aceptar una
-- derivacion traspasa el paciente (seccion 9), y una oferta pendiente solo
-- expone motivo, tipo y edad via oferta_derivacion().
-- Las politicas RESTRICTIVE *_acceso_vigente de 01b se mantienen.
-- -----------------------------------------------------------------------------

DROP POLICY pacientes_select ON pacientes;
DROP POLICY pacientes_insert ON pacientes;
DROP POLICY pacientes_update ON pacientes;
DROP POLICY fichas_clinicas_select ON fichas_clinicas;
DROP POLICY fichas_clinicas_insert ON fichas_clinicas;
DROP POLICY fichas_clinicas_update ON fichas_clinicas;
DROP POLICY evoluciones_select ON evoluciones;
DROP POLICY evoluciones_insert ON evoluciones;
DROP POLICY derivaciones_select ON derivaciones;
DROP POLICY derivaciones_insert ON derivaciones;
DROP POLICY derivaciones_update ON derivaciones;

DROP FUNCTION tiene_derivacion_activa_ficha(uuid);
DROP FUNCTION tiene_derivacion_activa_paciente(uuid);

ALTER TABLE derivaciones DROP CONSTRAINT derivaciones_origen_distinto_destino;


-- -----------------------------------------------------------------------------
-- 3. DDL de tablas (identico al que genera Prisma para el schema).
-- -----------------------------------------------------------------------------

ALTER TABLE "derivaciones" DROP CONSTRAINT "derivaciones_profesional_destino_id_fkey";
DROP INDEX "derivaciones_profesional_destino_id_activa_idx";
ALTER TABLE "derivaciones" DROP COLUMN "activa",
DROP COLUMN "profesional_destino_id",
ADD COLUMN     "estado" "estado_derivacion" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "tipo_atencion" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "usuarios" ADD COLUMN     "paciente_id" UUID;

CREATE TABLE "configuracion_centro" (
    "id" BOOLEAN NOT NULL DEFAULT true,
    "rol_gestion_habilitado" BOOLEAN NOT NULL DEFAULT false,
    "plazo_respuesta_derivacion_horas" INTEGER NOT NULL DEFAULT 24,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracion_centro_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "derivacion_candidatos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "derivacion_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "estado" "estado_candidato" NOT NULL DEFAULT 'EN_ESPERA',
    "ofrecida_en" TIMESTAMPTZ(6),
    "vence_en" TIMESTAMPTZ(6),
    "respondido_en" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derivacion_candidatos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "derivacion_candidatos_profesional_id_estado_idx" ON "derivacion_candidatos"("profesional_id", "estado");
CREATE UNIQUE INDEX "derivacion_candidatos_derivacion_id_orden_key" ON "derivacion_candidatos"("derivacion_id", "orden");
CREATE UNIQUE INDEX "derivacion_candidatos_derivacion_id_profesional_id_key" ON "derivacion_candidatos"("derivacion_id", "profesional_id");
CREATE INDEX "derivaciones_profesional_origen_id_idx" ON "derivaciones"("profesional_origen_id");
CREATE UNIQUE INDEX "usuarios_paciente_id_key" ON "usuarios"("paciente_id");

ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "derivacion_candidatos" ADD CONSTRAINT "derivacion_candidatos_derivacion_id_fkey" FOREIGN KEY ("derivacion_id") REFERENCES "derivaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "derivacion_candidatos" ADD CONSTRAINT "derivacion_candidatos_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- 4. Reglas que Prisma no expresa: CHECKs, unicos parciales, fila unica.
-- -----------------------------------------------------------------------------

-- PACIENTE <-> paciente_id (1:1 por el UNIQUE de arriba).
ALTER TABLE usuarios ADD CONSTRAINT usuarios_paciente_solo_rol_paciente
  CHECK ((rol::text = 'PACIENTE') = (paciente_id IS NOT NULL));

ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_fila_unica CHECK (id);
ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_plazo_valido
  CHECK (plazo_respuesta_derivacion_horas > 0);
INSERT INTO configuracion_centro DEFAULT VALUES;

ALTER TABLE derivacion_candidatos ADD CONSTRAINT derivacion_candidatos_orden_valido CHECK (orden > 0);
ALTER TABLE derivacion_candidatos ADD CONSTRAINT derivacion_candidatos_oferta_con_plazo
  CHECK (estado <> 'OFRECIDA' OR (ofrecida_en IS NOT NULL AND vence_en > ofrecida_en));

-- Maximo una OFRECIDA y una ACEPTADA por derivacion (violacion = 23505).
CREATE UNIQUE INDEX derivacion_candidatos_una_ofrecida
  ON derivacion_candidatos (derivacion_id) WHERE estado = 'OFRECIDA';
CREATE UNIQUE INDEX derivacion_candidatos_una_aceptada
  ON derivacion_candidatos (derivacion_id) WHERE estado = 'ACEPTADA';
-- Una sola derivacion abierta por ficha.
CREATE UNIQUE INDEX derivaciones_una_abierta_por_ficha
  ON derivaciones (ficha_clinica_id) WHERE estado IN ('PENDIENTE', 'SIN_ASIGNAR');


-- -----------------------------------------------------------------------------
-- 5. Helpers de contexto.
--
-- app_paciente_id(): paciente vinculado al usuario del contexto (solo rol
-- PACIENTE), o NULL. SECURITY DEFINER: lee usuarios sin depender de su RLS.
--
-- es_profesional_de_*: ahora exigen ademas rol de contexto clinico
-- (PROFESIONAL o PRACTICANTE). Asi ningun otro rol (p. ej. un PACIENTE cuyo id
-- quedara por error en pacientes.profesional_id) entra por esa via.
-- acceso_vigente() (01b) no cambia: ya exige rol de BD = rol de contexto,
-- activo y expiracion de PRACTICANTE; los CHECK/trigger nuevos garantizan que
-- un PACIENTE tiene paciente_id y que no hay GESTION activo sin habilitacion.
-- -----------------------------------------------------------------------------

CREATE FUNCTION app_paciente_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT paciente_id FROM usuarios WHERE id = app_usuario_id() AND rol::text = 'PACIENTE'
$$;

CREATE OR REPLACE FUNCTION es_profesional_de_ficha(p_ficha_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_rol() IN ('PROFESIONAL', 'PRACTICANTE') AND EXISTS (
    SELECT 1 FROM fichas_clinicas f JOIN pacientes p ON p.id = f.paciente_id
    WHERE f.id = p_ficha_id AND p.profesional_id = app_usuario_id()
  )
$$;

CREATE OR REPLACE FUNCTION es_profesional_de_paciente(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_rol() IN ('PROFESIONAL', 'PRACTICANTE') AND EXISTS (
    SELECT 1 FROM pacientes WHERE id = p_paciente_id AND profesional_id = app_usuario_id()
  )
$$;


-- -----------------------------------------------------------------------------
-- 6. Politicas.
-- "Gestion" = (SELECT app_rol()) IN ('ADMIN','GESTION'). Todas las tablas con
-- RLS llevan ademas <tabla>_acceso_vigente (RESTRICTIVE, seccion 11).
-- Sin politica = sin acceso: DELETE no tiene politica en ninguna tabla.
-- -----------------------------------------------------------------------------

-- pacientes: gestion todo; tratante (PROFESIONAL/PRACTICANTE) los suyos;
-- PACIENTE solo su registro (lectura). Crear: gestion o PROFESIONAL para si.
CREATE POLICY pacientes_select ON pacientes FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR (profesional_id = (SELECT app_usuario_id())
             AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE'))
         OR id = (SELECT app_paciente_id()));
CREATE POLICY pacientes_insert ON pacientes FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
              OR (profesional_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) = 'PROFESIONAL'));
CREATE POLICY pacientes_update ON pacientes FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR (profesional_id = (SELECT app_usuario_id())
             AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE')))
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
              OR (profesional_id = (SELECT app_usuario_id())
                  AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE')));

-- fichas_clinicas: tratante + ADMIN (solo metadata). GESTION y PACIENTE nunca.
CREATE POLICY fichas_clinicas_select ON fichas_clinicas FOR SELECT TO app_user
  USING (es_profesional_de_paciente(paciente_id) OR (SELECT app_rol()) = 'ADMIN');
CREATE POLICY fichas_clinicas_insert ON fichas_clinicas FOR INSERT TO app_user
  WITH CHECK (es_profesional_de_paciente(paciente_id) OR (SELECT app_rol()) = 'ADMIN');
CREATE POLICY fichas_clinicas_update ON fichas_clinicas FOR UPDATE TO app_user
  USING (es_profesional_de_paciente(paciente_id) OR (SELECT app_rol()) = 'ADMIN')
  WITH CHECK (es_profesional_de_paciente(paciente_id) OR (SELECT app_rol()) = 'ADMIN');

-- evoluciones: solo el tratante actual (sin excepcion ADMIN).
CREATE POLICY evoluciones_select ON evoluciones FOR SELECT TO app_user
  USING (es_profesional_de_ficha(ficha_clinica_id));
CREATE POLICY evoluciones_insert ON evoluciones FOR INSERT TO app_user
  WITH CHECK (autor_id = (SELECT app_usuario_id()) AND es_profesional_de_ficha(ficha_clinica_id));

-- derivaciones / candidatos: solo lectura directa; toda escritura via funciones
-- (seccion 9). Ven la derivacion: origen, ADMIN y el tratante actual de la
-- ficha. Un candidato ve solo su propia fila de candidato (no la derivacion).
CREATE POLICY derivaciones_select ON derivaciones FOR SELECT TO app_user
  USING (profesional_origen_id = (SELECT app_usuario_id())
         OR (SELECT app_rol()) = 'ADMIN'
         OR es_profesional_de_ficha(ficha_clinica_id));
CREATE POLICY derivacion_candidatos_select ON derivacion_candidatos FOR SELECT TO app_user
  USING (profesional_id = (SELECT app_usuario_id())
         OR derivacion_id IN (SELECT id FROM derivaciones));

-- usuarios: cada uno su fila, ADMIN todas. Solo ADMIN crea. Cambios de
-- rol/activo/expiracion/paciente_id: trigger usuarios_campos_protegidos.
CREATE POLICY usuarios_select ON usuarios FOR SELECT TO app_user
  USING (id = (SELECT app_usuario_id()) OR (SELECT app_rol()) = 'ADMIN');
CREATE POLICY usuarios_insert ON usuarios FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY usuarios_update ON usuarios FOR UPDATE TO app_user
  USING (id = (SELECT app_usuario_id()) OR (SELECT app_rol()) = 'ADMIN')
  WITH CHECK (id = (SELECT app_usuario_id()) OR (SELECT app_rol()) = 'ADMIN');

-- configuracion_centro: todo usuario autenticado (acceso vigente) lee; ADMIN actualiza.
CREATE POLICY configuracion_centro_select ON configuracion_centro FOR SELECT TO app_user
  USING (true);
CREATE POLICY configuracion_centro_update ON configuracion_centro FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');

-- citas: gestion todas; PROFESIONAL/PRACTICANTE las suyas; PACIENTE las suyas
-- (lectura). Agendar/modificar: gestion, o el profesional para su propio
-- paciente. Cancelar = UPDATE estado (sin DELETE).
CREATE POLICY citas_select ON citas FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR (profesional_id = (SELECT app_usuario_id())
             AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE'))
         OR paciente_id = (SELECT app_paciente_id()));
CREATE POLICY citas_insert ON citas FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
              OR (profesional_id = (SELECT app_usuario_id()) AND es_profesional_de_paciente(paciente_id)));
CREATE POLICY citas_update ON citas FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR (profesional_id = (SELECT app_usuario_id())
             AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE')))
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
              OR (profesional_id = (SELECT app_usuario_id()) AND es_profesional_de_paciente(paciente_id)));

-- adultos_responsables: gestion todos; tratante los de sus pacientes;
-- PACIENTE los propios (lectura).
CREATE POLICY adultos_responsables_select ON adultos_responsables FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR es_profesional_de_paciente(paciente_id)
         OR paciente_id = (SELECT app_paciente_id()));
CREATE POLICY adultos_responsables_insert ON adultos_responsables FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR es_profesional_de_paciente(paciente_id));
CREATE POLICY adultos_responsables_update ON adultos_responsables FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR es_profesional_de_paciente(paciente_id))
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR es_profesional_de_paciente(paciente_id));

-- pagos: gestion todo; PROFESIONAL y PACIENTE leen los de sus citas (la
-- subconsulta a citas pasa por la RLS de citas del mismo contexto).
-- PRACTICANTE nunca.
CREATE POLICY pagos_select ON pagos FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PACIENTE') AND cita_id IN (SELECT id FROM citas)));
CREATE POLICY pagos_insert ON pagos FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY pagos_update ON pagos FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION'))
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));


-- -----------------------------------------------------------------------------
-- 7. Triggers.
--
-- Los que protegen privilegios solo aplican cuando consulta app_user: el dueño
-- (migraciones, seed, funciones SECURITY DEFINER como responder_derivacion)
-- queda exento. Las reglas de negocio (GESTION habilitado) aplican a todos.
-- -----------------------------------------------------------------------------

-- usuarios: rol, activo, fecha_expiracion_acceso y paciente_id solo con
-- contexto ADMIN; nadie (ni ADMIN) cambia su propio rol.
CREATE FUNCTION proteger_campos_usuario() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF (NEW.rol, NEW.activo, NEW.fecha_expiracion_acceso, NEW.paciente_id)
       IS DISTINCT FROM (OLD.rol, OLD.activo, OLD.fecha_expiracion_acceso, OLD.paciente_id)
     AND app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN cambia rol, activo, expiracion o paciente vinculado'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.rol IS DISTINCT FROM OLD.rol AND NEW.id = app_usuario_id() THEN
    RAISE EXCEPTION 'Nadie cambia su propio rol' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuarios_campos_protegidos BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION proteger_campos_usuario();

-- usuarios: crear, asignar o reactivar un GESTION exige rol_gestion_habilitado.
-- FOR SHARE sobre la fila de configuracion serializa contra un apagado
-- concurrente del flag (ver trigger siguiente).
CREATE FUNCTION validar_rol_gestion_habilitado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.rol::text = 'GESTION'
     AND (TG_OP = 'INSERT' OR OLD.rol IS DISTINCT FROM NEW.rol OR (NEW.activo AND NOT OLD.activo))
     AND NOT (SELECT rol_gestion_habilitado FROM configuracion_centro FOR SHARE) THEN
    RAISE EXCEPTION 'Rol GESTION no habilitado en configuracion_centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_gestion_requiere_habilitacion';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuarios_gestion_requiere_habilitacion BEFORE INSERT OR UPDATE OF rol, activo ON usuarios
  FOR EACH ROW EXECUTE FUNCTION validar_rol_gestion_habilitado();

-- configuracion_centro: no apagar GESTION con usuarios GESTION activos.
CREATE FUNCTION validar_desactivacion_gestion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.rol_gestion_habilitado AND NOT NEW.rol_gestion_habilitado
     AND EXISTS (SELECT 1 FROM usuarios WHERE rol::text = 'GESTION' AND activo) THEN
    RAISE EXCEPTION 'Hay usuarios GESTION activos: desactivarlos antes de deshabilitar el rol'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'configuracion_centro_gestion_activos';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER configuracion_centro_gestion_activos BEFORE UPDATE ON configuracion_centro
  FOR EACH ROW EXECUTE FUNCTION validar_desactivacion_gestion();

-- pacientes: el profesional tratante solo cambia aceptando una derivacion
-- (responder_derivacion corre como dueño). Ni ADMIN ni GESTION reasignan con un
-- UPDATE directo: seria acceso a ficha ajena fuera del protocolo formal.
CREATE FUNCTION bloquear_cambio_tratante() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_user' AND NEW.profesional_id IS DISTINCT FROM OLD.profesional_id THEN
    RAISE EXCEPTION 'El profesional tratante solo cambia aceptando una derivacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pacientes_tratante_via_derivacion BEFORE UPDATE OF profesional_id ON pacientes
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambio_tratante();


-- -----------------------------------------------------------------------------
-- 8. Funciones de lectura controlada.
-- -----------------------------------------------------------------------------

-- Login: unica lectura de usuarios sin contexto. Devuelve la fila del email
-- (o nada); la API compara el hash y decide (activo, expiracion).
CREATE FUNCTION credenciales_login(p_email text)
RETURNS TABLE (
  id uuid,
  password_hash text,
  rol rol,
  activo boolean,
  fecha_expiracion_acceso timestamptz,
  paciente_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.password_hash, u.rol, u.activo, u.fecha_expiracion_acceso, u.paciente_id
  FROM usuarios u
  WHERE u.email = p_email
$$;

-- Ocupacion de boxes para agendar sin ver citas ajenas: solo espacio y rango
-- de citas CONFIRMADA que se cruzan con [desde, hasta).
CREATE FUNCTION ocupacion_espacios(desde timestamptz, hasta timestamptz)
RETURNS TABLE (espacio_id uuid, inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'ocupacion_espacios: requiere acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT c.espacio_id, c.inicio, c.fin
  FROM citas c
  WHERE c.estado = 'CONFIRMADA'
    AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(desde, hasta, '[)')
  ORDER BY c.espacio_id, c.inicio;
END;
$$;


-- -----------------------------------------------------------------------------
-- 9. Derivaciones con oferta secuencial.
--
-- Flujo: PENDIENTE con un candidato OFRECIDA a la vez (orden ascendente).
--   aceptar  -> candidato ACEPTADA, resto EN_ESPERA -> OMITIDA, derivacion
--               ACEPTADA, pacientes.profesional_id = aceptante (traspaso).
--   rechazar -> RECHAZADA, se ofrece al siguiente EN_ESPERA.
--   vencer   -> EXPIRADA (expirar_ofertas_derivacion), se ofrece al siguiente.
--   sin mas candidatos -> SIN_ASIGNAR (ADMIN puede redefinir candidatos).
-- vence_en = ofrecida_en + configuracion_centro.plazo_respuesta_derivacion_horas
-- leido al momento de ofrecer.
--
-- Funciones internas (sin EXECUTE para app_user): ofrecer_siguiente_candidato,
-- agregar_candidatos, registrar_accion_derivacion. Las publicas son SECURITY
-- DEFINER, validan rol/contexto dentro y bloquean la fila de la derivacion
-- (FOR UPDATE) para serializar respuestas, cambios de ADMIN y el job.
-- -----------------------------------------------------------------------------

CREATE FUNCTION ofrecer_siguiente_candidato(p_derivacion_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_candidato uuid;
BEGIN
  SELECT id INTO v_candidato FROM derivacion_candidatos
  WHERE derivacion_id = p_derivacion_id AND estado = 'EN_ESPERA'
  ORDER BY orden LIMIT 1;

  IF v_candidato IS NULL THEN
    UPDATE derivaciones SET estado = 'SIN_ASIGNAR', updated_at = now() WHERE id = p_derivacion_id;
  ELSE
    UPDATE derivacion_candidatos
    SET estado = 'OFRECIDA', ofrecida_en = now(),
        vence_en = now() + make_interval(hours => (SELECT plazo_respuesta_derivacion_horas FROM configuracion_centro))
    WHERE id = v_candidato;
    UPDATE derivaciones SET estado = 'PENDIENTE', updated_at = now()
    WHERE id = p_derivacion_id AND estado <> 'PENDIENTE';
  END IF;
END;
$$;

-- Agrega candidatos al final de la lista, en el orden dado. Solo PROFESIONAL
-- activos distintos del origen; un profesional aparece una sola vez por
-- derivacion (unique -> 23505 si ya estuvo, incluso si rechazo).
CREATE FUNCTION agregar_candidatos(p_derivacion_id uuid, p_candidatos uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_max int;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(p_candidatos) AS c(id)
    JOIN derivaciones d ON d.id = p_derivacion_id
    LEFT JOIN usuarios u ON u.id = c.id
    WHERE c.id IS NULL OR c.id = d.profesional_origen_id OR u.id IS NULL
       OR u.rol::text <> 'PROFESIONAL' OR NOT u.activo
  ) THEN
    RAISE EXCEPTION 'Candidatos invalidos: deben ser PROFESIONAL activos distintos del origen'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'derivacion_candidatos_validos';
  END IF;

  SELECT coalesce(max(orden), 0) INTO v_max FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id;
  INSERT INTO derivacion_candidatos (derivacion_id, profesional_id, orden)
  SELECT p_derivacion_id, c.id, v_max + c.n::int
  FROM unnest(p_candidatos) WITH ORDINALITY AS c(id, n);
END;
$$;

-- Auditoria: cada accion de derivacion queda en accesos_ficha (accion
-- DERIVACION) a nombre del usuario del contexto.
CREATE FUNCTION registrar_accion_derivacion(p_derivacion_id uuid, p_recurso text) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, ficha_id, recurso, accion)
  SELECT u.id, u.rol, f.paciente_id, f.id, p_recurso, 'DERIVACION'
  FROM derivaciones d
  JOIN fichas_clinicas f ON f.id = d.ficha_clinica_id
  JOIN usuarios u ON u.id = app_usuario_id()
  WHERE d.id = p_derivacion_id
$$;

-- Solo el PROFESIONAL tratante de la ficha crea. Lista vacia = SIN_ASIGNAR
-- (ADMIN asigna despues con definir_candidatos_derivacion).
CREATE FUNCTION crear_derivacion(p_ficha_id uuid, p_motivo text, p_tipo_atencion text, p_candidatos uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' OR NOT es_profesional_de_ficha(p_ficha_id) THEN
    RAISE EXCEPTION 'Solo el profesional tratante de la ficha crea derivaciones'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO derivaciones (ficha_clinica_id, profesional_origen_id, motivo, tipo_atencion)
  VALUES (p_ficha_id, app_usuario_id(), p_motivo, p_tipo_atencion)
  RETURNING id INTO v_id;

  PERFORM agregar_candidatos(v_id, coalesce(p_candidatos, '{}'));
  PERFORM ofrecer_siguiente_candidato(v_id);
  PERFORM registrar_accion_derivacion(v_id, 'derivaciones');
  RETURN v_id;
END;
$$;

-- ADMIN reemplaza, agrega o reordena los candidatos pendientes (PENDIENTE o
-- SIN_ASIGNAR). p_candidatos = lista pendiente completa en el orden deseado:
--   - pendientes que no vienen -> OMITIDA;
--   - los que vienen se renumeran al final, en ese orden (los nuevos se crean);
--   - si el OFRECIDO sigue primero conserva su plazo; si no, vuelve a EN_ESPERA
--     (o queda OMITIDA) y la oferta pasa al nuevo primero con plazo reiniciado.
-- Un profesional que ya respondio (RECHAZADA/EXPIRADA/OMITIDA) no vuelve.
CREATE FUNCTION definir_candidatos_derivacion(p_derivacion_id uuid, p_candidatos uuid[]) RETURNS void
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
    SELECT 1 FROM derivacion_candidatos
    WHERE derivacion_id = p_derivacion_id AND profesional_id = ANY (p_candidatos)
      AND estado NOT IN ('EN_ESPERA', 'OFRECIDA')
  ) THEN
    RAISE EXCEPTION 'Un candidato que ya respondio no puede volver a la lista'
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

  -- Renumerar toda la lista pendiente sobre el maximo actual: los valores
  -- nuevos no chocan con el unique (derivacion_id, orden).
  SELECT max(orden) INTO v_max FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id;
  UPDATE derivacion_candidatos dc
  SET orden = v_max + c.n::int,
      estado = CASE WHEN c.n = 1 AND dc.estado = 'OFRECIDA' THEN 'OFRECIDA'::estado_candidato ELSE 'EN_ESPERA' END,
      ofrecida_en = CASE WHEN c.n = 1 AND dc.estado = 'OFRECIDA' THEN dc.ofrecida_en END,
      vence_en = CASE WHEN c.n = 1 AND dc.estado = 'OFRECIDA' THEN dc.vence_en END
  FROM unnest(p_candidatos) WITH ORDINALITY AS c(id, n)
  WHERE dc.derivacion_id = p_derivacion_id AND dc.profesional_id = c.id;

  IF NOT EXISTS (SELECT 1 FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id AND estado = 'OFRECIDA') THEN
    PERFORM ofrecer_siguiente_candidato(p_derivacion_id);
  END IF;
  PERFORM registrar_accion_derivacion(p_derivacion_id, 'derivacion_candidatos');
END;
$$;

-- ADMIN: PENDIENTE -> CANCELADA; SIN_ASIGNAR -> CERRADA. Pendientes -> OMITIDA.
CREATE FUNCTION cancelar_derivacion(p_derivacion_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado estado_derivacion;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN cancela derivaciones' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT estado INTO v_estado FROM derivaciones WHERE id = p_derivacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Derivacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado NOT IN ('PENDIENTE', 'SIN_ASIGNAR') THEN
    RAISE EXCEPTION 'La derivacion no se puede cancelar en estado %', v_estado
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE derivacion_candidatos SET estado = 'OMITIDA', ofrecida_en = NULL, vence_en = NULL
  WHERE derivacion_id = p_derivacion_id AND estado IN ('EN_ESPERA', 'OFRECIDA');
  UPDATE derivaciones
  SET estado = CASE WHEN v_estado = 'PENDIENTE' THEN 'CANCELADA'::estado_derivacion ELSE 'CERRADA' END,
      updated_at = now()
  WHERE id = p_derivacion_id;
  PERFORM registrar_accion_derivacion(p_derivacion_id, 'derivaciones');
END;
$$;

-- Lo unico que ve el candidato OFRECIDO: motivo, tipo de atencion y edad
-- (calculada hoy, hora de Chile). Nunca nombre, fecha de nacimiento, ficha ni
-- evoluciones. Sin oferta vigente para el usuario del contexto: 0 filas.
CREATE FUNCTION oferta_derivacion(p_derivacion_id uuid)
RETURNS TABLE (derivacion_id uuid, motivo text, tipo_atencion text, edad_paciente int, vence_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'oferta_derivacion: requiere acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT d.id, d.motivo, d.tipo_atencion,
         extract(year FROM age((now() AT TIME ZONE 'America/Santiago')::date, p.fecha_nacimiento))::int,
         c.vence_en
  FROM derivaciones d
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

-- Solo el candidato OFRECIDO (PROFESIONAL) y antes de vence_en.
CREATE FUNCTION responder_derivacion(p_derivacion_id uuid, p_acepta boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_candidato derivacion_candidatos%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' OR p_acepta IS NULL THEN
    RAISE EXCEPTION 'Solo un PROFESIONAL con acceso vigente responde derivaciones'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM derivaciones WHERE id = p_derivacion_id AND estado = 'PENDIENTE' FOR UPDATE;
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
    UPDATE derivacion_candidatos SET estado = 'ACEPTADA', respondido_en = now() WHERE id = v_candidato.id;
    UPDATE derivacion_candidatos SET estado = 'OMITIDA'
    WHERE derivacion_id = p_derivacion_id AND estado = 'EN_ESPERA';
    UPDATE derivaciones SET estado = 'ACEPTADA', updated_at = now() WHERE id = p_derivacion_id;
    -- Traspaso: el aceptante pasa a ser el tratante; el origen pierde acceso
    -- por las politicas. Las evoluciones previas conservan su autor_id.
    UPDATE pacientes p SET profesional_id = v_candidato.profesional_id, updated_at = now()
    FROM fichas_clinicas f JOIN derivaciones d ON d.ficha_clinica_id = f.id
    WHERE d.id = p_derivacion_id AND p.id = f.paciente_id;
  ELSE
    UPDATE derivacion_candidatos SET estado = 'RECHAZADA', respondido_en = now() WHERE id = v_candidato.id;
    PERFORM ofrecer_siguiente_candidato(p_derivacion_id);
  END IF;
  PERFORM registrar_accion_derivacion(p_derivacion_id, 'derivaciones');
END;
$$;

-- Job: marca EXPIRADA las ofertas vencidas y ofrece al siguiente. Idempotente
-- (una segunda corrida no encuentra nada vencido). No requiere contexto: lo
-- llama un job de la API sin usuario. SKIP LOCKED: si alguien esta
-- respondiendo esa derivacion, queda para la proxima corrida. Devuelve cuantas
-- ofertas expiro. No escribe en accesos_ficha (no hay usuario); el rastro queda
-- en derivacion_candidatos (estado EXPIRADA + vence_en).
CREATE FUNCTION expirar_ofertas_derivacion() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_total int := 0;
BEGIN
  FOR v_id IN
    SELECT d.id FROM derivaciones d
    WHERE d.estado = 'PENDIENTE'
      AND EXISTS (SELECT 1 FROM derivacion_candidatos c
                  WHERE c.derivacion_id = d.id AND c.estado = 'OFRECIDA' AND c.vence_en <= now())
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE derivacion_candidatos SET estado = 'EXPIRADA'
    WHERE derivacion_id = v_id AND estado = 'OFRECIDA' AND vence_en <= now();
    IF FOUND THEN
      PERFORM ofrecer_siguiente_candidato(v_id);
      v_total := v_total + 1;
    END IF;
  END LOOP;
  RETURN v_total;
END;
$$;


-- -----------------------------------------------------------------------------
-- 10. GRANTs.
-- -----------------------------------------------------------------------------

-- usuarios: UPDATE por columna (nunca id ni created_at). Como todos los roles
-- de aplicacion comparten app_user, el GRANT por columna no distingue ADMIN:
-- quien puede tocar rol/activo/expiracion/paciente_id lo decide el trigger
-- usuarios_campos_protegidos. Sin DELETE: revocar = activo=false.
REVOKE UPDATE, DELETE ON usuarios FROM app_user;
GRANT UPDATE (email, password_hash, nombre, rol, activo, fecha_expiracion_acceso, paciente_id, updated_at)
  ON usuarios TO app_user;

GRANT SELECT ON configuracion_centro TO app_user;
GRANT UPDATE (rol_gestion_habilitado, plazo_respuesta_derivacion_horas, updated_at)
  ON configuracion_centro TO app_user;

-- Derivaciones: solo lectura directa; escritura via funciones.
REVOKE INSERT, UPDATE ON derivaciones FROM app_user;
GRANT SELECT ON derivacion_candidatos TO app_user;

-- Cancelar cita = UPDATE estado; pagos nunca se borran.
REVOKE DELETE ON citas, pagos FROM app_user;

-- Funciones publicas: solo app_user. Internas: nadie salvo el dueño.
REVOKE EXECUTE ON FUNCTION
  credenciales_login(text),
  ocupacion_espacios(timestamptz, timestamptz),
  crear_derivacion(uuid, text, text, uuid[]),
  definir_candidatos_derivacion(uuid, uuid[]),
  cancelar_derivacion(uuid),
  oferta_derivacion(uuid),
  responder_derivacion(uuid, boolean),
  expirar_ofertas_derivacion(),
  ofrecer_siguiente_candidato(uuid),
  agregar_candidatos(uuid, uuid[]),
  registrar_accion_derivacion(uuid, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  credenciales_login(text),
  ocupacion_espacios(timestamptz, timestamptz),
  crear_derivacion(uuid, text, text, uuid[]),
  definir_candidatos_derivacion(uuid, uuid[]),
  cancelar_derivacion(uuid),
  oferta_derivacion(uuid),
  responder_derivacion(uuid, boolean),
  expirar_ofertas_derivacion()
TO app_user;


-- -----------------------------------------------------------------------------
-- 11. ENABLE + FORCE RLS y acceso vigente (RESTRICTIVE) en las tablas nuevas.
-- -----------------------------------------------------------------------------

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_centro ENABLE ROW LEVEL SECURITY;
ALTER TABLE citas ENABLE ROW LEVEL SECURITY;
ALTER TABLE adultos_responsables ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE derivacion_candidatos ENABLE ROW LEVEL SECURITY;

ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
ALTER TABLE configuracion_centro FORCE ROW LEVEL SECURITY;
ALTER TABLE citas FORCE ROW LEVEL SECURITY;
ALTER TABLE adultos_responsables FORCE ROW LEVEL SECURITY;
ALTER TABLE pagos FORCE ROW LEVEL SECURITY;
ALTER TABLE derivacion_candidatos FORCE ROW LEVEL SECURITY;

CREATE POLICY usuarios_acceso_vigente ON usuarios AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY configuracion_centro_acceso_vigente ON configuracion_centro AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY citas_acceso_vigente ON citas AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY adultos_responsables_acceso_vigente ON adultos_responsables AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY pagos_acceso_vigente ON pagos AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY derivacion_candidatos_acceso_vigente ON derivacion_candidatos AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
