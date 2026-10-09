-- =============================================================================
-- Reglas de dominio que Prisma no expresa: CHECKs, EXCLUDE (anti-solapamiento),
-- triggers (no-delete clinico, append-only, menor de edad), rol de aplicacion
-- y politicas RLS. btree_gist ya se crea en 20261005000000_init
-- (CREATE EXTENSION IF NOT EXISTS "btree_gist"), requerido por el EXCLUDE.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. CHECKs
-- -----------------------------------------------------------------------------

-- Practicante: acceso siempre con expiracion. Otros roles: sin expiracion.
ALTER TABLE usuarios ADD CONSTRAINT usuarios_expiracion_solo_practicante
  CHECK ((rol = 'PRACTICANTE') = (fecha_expiracion_acceso IS NOT NULL));

ALTER TABLE citas ADD CONSTRAINT citas_rango_valido CHECK (fin > inicio);
ALTER TABLE bloqueos_temporales ADD CONSTRAINT bloqueos_temporales_rango_valido CHECK (fin > inicio);

ALTER TABLE derivaciones ADD CONSTRAINT derivaciones_origen_distinto_destino
  CHECK (profesional_origen_id <> profesional_destino_id);

ALTER TABLE practicantes ADD CONSTRAINT practicantes_fechas_validas
  CHECK (fecha_termino_practica >= fecha_inicio);

ALTER TABLE arriendos ADD CONSTRAINT arriendos_montos_validos
  CHECK (monto >= 0 AND porcentaje_comision BETWEEN 0 AND 100);
ALTER TABLE pagos ADD CONSTRAINT pagos_monto_positivo CHECK (monto > 0);
ALTER TABLE profesionales ADD CONSTRAINT profesionales_tarifa_valida CHECK (tarifa >= 0);


-- -----------------------------------------------------------------------------
-- 2. Agenda: fuente de verdad anti-solapamiento.
-- Rango semiabierto [inicio, fin): 09:00-10:00 y 10:00-11:00 no chocan.
-- Solo citas CONFIRMADA participan; una CANCELADA libera el horario.
-- Violacion = SQLSTATE 23P01 (exclusion_violation). El filtro global de la API
-- (prompt 02) la traduce a 409 Conflict usando el nombre del constraint.
-- -----------------------------------------------------------------------------

ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_espacio
  EXCLUDE USING gist (espacio_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado = 'CONFIRMADA');

ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_profesional
  EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado = 'CONFIRMADA');


-- -----------------------------------------------------------------------------
-- 3. Datos clinicos: nunca DELETE real (Decreto 41 / Ley 20.584, retencion
-- minima 15 años). El trigger corre incluso para superusuario; ademas el rol
-- de aplicacion no recibe GRANT DELETE sobre estas tablas (seccion 6).
-- Soft-delete de paciente = pacientes.deleted_at.
-- -----------------------------------------------------------------------------

CREATE FUNCTION bloquear_delete_clinico() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DELETE prohibido en %: dato clinico (retencion legal). Usar soft-delete o desactivar.', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER pacientes_sin_delete BEFORE DELETE ON pacientes
  FOR EACH ROW EXECUTE FUNCTION bloquear_delete_clinico();
CREATE TRIGGER adultos_responsables_sin_delete BEFORE DELETE ON adultos_responsables
  FOR EACH ROW EXECUTE FUNCTION bloquear_delete_clinico();
CREATE TRIGGER fichas_clinicas_sin_delete BEFORE DELETE ON fichas_clinicas
  FOR EACH ROW EXECUTE FUNCTION bloquear_delete_clinico();
CREATE TRIGGER evoluciones_sin_delete BEFORE DELETE ON evoluciones
  FOR EACH ROW EXECUTE FUNCTION bloquear_delete_clinico();
CREATE TRIGGER derivaciones_sin_delete BEFORE DELETE ON derivaciones
  FOR EACH ROW EXECUTE FUNCTION bloquear_delete_clinico();

-- Evoluciones append-only: correccion = fila nueva con corrige_a_id.
CREATE FUNCTION bloquear_update_evolucion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'evoluciones es append-only: insertar una correccion con corrige_a_id en vez de UPDATE'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER evoluciones_append_only BEFORE UPDATE ON evoluciones
  FOR EACH ROW EXECUTE FUNCTION bloquear_update_evolucion();


-- -----------------------------------------------------------------------------
-- 4. Menor de edad sin adulto responsable.
-- Se implementa como TRIGGER (no CHECK, no solo servicio) porque:
--   - un CHECK no puede consultar otras tablas ni depende de now();
--   - dejarlo solo en el servicio permite saltarse la regla con cualquier
--     insert directo (seed, script, otro modulo). Igual que el EXCLUDE, la DB
--     es la fuente de verdad; el servicio valida antes para dar un error claro.
-- La edad se calcula a la fecha de la cita (inicio), no a hoy: un paciente que
-- cumple 18 antes de la cita no necesita adulto responsable para esa cita.
-- Solo aplica a citas que quedan CONFIRMADA (insert o reactivacion).
-- SECURITY DEFINER: debe ver pacientes/adultos aunque la RLS del usuario
-- actual no se los muestre. search_path fijo para evitar secuestro.
-- -----------------------------------------------------------------------------

CREATE FUNCTION validar_menor_con_adulto_responsable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fecha_nacimiento date;
BEGIN
  IF NEW.estado <> 'CONFIRMADA' THEN
    RETURN NEW;
  END IF;

  SELECT fecha_nacimiento INTO v_fecha_nacimiento FROM pacientes WHERE id = NEW.paciente_id;

  IF age((NEW.inicio AT TIME ZONE 'America/Santiago')::date, v_fecha_nacimiento) < interval '18 years'
     AND NOT EXISTS (SELECT 1 FROM adultos_responsables WHERE paciente_id = NEW.paciente_id) THEN
    RAISE EXCEPTION 'Paciente menor de 18 sin adulto responsable registrado'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_menor_requiere_adulto_responsable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER citas_menor_requiere_adulto_responsable
  BEFORE INSERT OR UPDATE OF estado, paciente_id, inicio ON citas
  FOR EACH ROW EXECUTE FUNCTION validar_menor_con_adulto_responsable();


-- -----------------------------------------------------------------------------
-- 5. Rol de aplicacion.
-- El usuario de conexion del silo (POSTGRES_USER) es superusuario y dueño de
-- las tablas: Postgres le salta la RLS siempre. Por eso la API NO consulta con
-- ese rol: al inicio de cada transaccion Prisma el RlsInterceptor (prompt 02)
-- ejecuta, en este orden:
--
--   SET LOCAL ROLE app_user;
--   SELECT set_config('app.current_usuario_id', '<usuario.id>', true);
--   SELECT set_config('app.current_rol', '<ADMIN|PROFESIONAL|PRACTICANTE>', true);
--
-- (set_config(..., true) = SET LOCAL parametrizable, evita interpolar strings).
-- Todo vuelve al rol original al terminar la transaccion. Migraciones y seed
-- corren con el rol dueño, sin RLS.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END;
$$;

DO $$
BEGIN
  EXECUTE format('GRANT app_user TO %I', current_user);
END;
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE ON usuarios, pacientes, adultos_responsables,
  fichas_clinicas, derivaciones, espacios, citas, bloqueos_temporales,
  profesionales, practicantes, arriendos, pagos, boletas TO app_user;
-- Evoluciones y log de accesos: append-only tambien a nivel de privilegios.
GRANT SELECT, INSERT ON evoluciones, accesos_temporales TO app_user;
-- DELETE solo en tablas no clinicas.
GRANT DELETE ON usuarios, espacios, citas, bloqueos_temporales, profesionales,
  practicantes, arriendos, pagos, boletas TO app_user;
-- Tablas de migraciones futuras: cada migracion debe dar su GRANT explicito.


-- -----------------------------------------------------------------------------
-- 6. RLS sobre pacientes, fichas_clinicas y evoluciones.
--
-- Variables de sesion (seteadas por request via SET LOCAL / set_config local,
-- ver seccion 5). Sin ellas los helpers devuelven NULL y la politica no
-- devuelve filas: falla cerrado.
--
-- Matriz de acceso:
--                     | dueño (profesional_id) | derivacion activa (destino) | ADMIN
--   pacientes   SELECT|          si            |            si               |  si (metadata para agenda)
--               INS/UPD|         si            |            no               |  si
--   fichas_cl.  SELECT|          si            |            si               |  si (solo metadata, ver schema)
--               INS/UPD|         si            |            no               |  si
--   evoluciones SELECT|          si            |            si               |  NO (contenido clinico)
--               INSERT|  si (autor = el mismo) |            no               |  NO
--   DELETE: sin politica en ninguna (y sin GRANT, y trigger).
--
-- Los helpers son SECURITY DEFINER (corren como dueño, sin RLS) para que una
-- politica pueda mirar otra tabla con RLS sin recursion infinita
-- (pacientes -> derivaciones/fichas -> pacientes ...).
-- -----------------------------------------------------------------------------

-- Identidad del actor (cualquier rol). El rol viaja en app.current_rol.
CREATE FUNCTION app_usuario_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_usuario_id', true), '')::uuid
$$;

CREATE FUNCTION app_rol() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_rol', true), '')
$$;

CREATE FUNCTION es_profesional_de_ficha(p_ficha_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM fichas_clinicas f JOIN pacientes p ON p.id = f.paciente_id
    WHERE f.id = p_ficha_id AND p.profesional_id = app_usuario_id()
  )
$$;

CREATE FUNCTION es_profesional_de_paciente(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM pacientes WHERE id = p_paciente_id AND profesional_id = app_usuario_id()
  )
$$;

CREATE FUNCTION tiene_derivacion_activa_ficha(p_ficha_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM derivaciones
    WHERE ficha_clinica_id = p_ficha_id AND activa AND profesional_destino_id = app_usuario_id()
  )
$$;

CREATE FUNCTION tiene_derivacion_activa_paciente(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM derivaciones d JOIN fichas_clinicas f ON f.id = d.ficha_clinica_id
    WHERE f.paciente_id = p_paciente_id AND d.activa AND d.profesional_destino_id = app_usuario_id()
  )
$$;

ALTER TABLE pacientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fichas_clinicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE evoluciones ENABLE ROW LEVEL SECURITY;

-- pacientes
CREATE POLICY pacientes_select ON pacientes FOR SELECT TO app_user
  USING (profesional_id = app_usuario_id()
         OR app_rol() = 'ADMIN'
         OR tiene_derivacion_activa_paciente(id));
CREATE POLICY pacientes_insert ON pacientes FOR INSERT TO app_user
  WITH CHECK (profesional_id = app_usuario_id() OR app_rol() = 'ADMIN');
CREATE POLICY pacientes_update ON pacientes FOR UPDATE TO app_user
  USING (profesional_id = app_usuario_id() OR app_rol() = 'ADMIN')
  WITH CHECK (profesional_id = app_usuario_id() OR app_rol() = 'ADMIN');

-- fichas_clinicas (solo metadata; contenido en evoluciones)
CREATE POLICY fichas_clinicas_select ON fichas_clinicas FOR SELECT TO app_user
  USING (es_profesional_de_paciente(paciente_id)
         OR app_rol() = 'ADMIN'
         OR tiene_derivacion_activa_ficha(id));
CREATE POLICY fichas_clinicas_insert ON fichas_clinicas FOR INSERT TO app_user
  WITH CHECK (es_profesional_de_paciente(paciente_id) OR app_rol() = 'ADMIN');
CREATE POLICY fichas_clinicas_update ON fichas_clinicas FOR UPDATE TO app_user
  USING (es_profesional_de_paciente(paciente_id) OR app_rol() = 'ADMIN')
  WITH CHECK (es_profesional_de_paciente(paciente_id) OR app_rol() = 'ADMIN');

-- evoluciones: SIN excepcion para ADMIN. Solo dueño del paciente o derivacion activa.
CREATE POLICY evoluciones_select ON evoluciones FOR SELECT TO app_user
  USING (es_profesional_de_ficha(ficha_clinica_id)
         OR tiene_derivacion_activa_ficha(ficha_clinica_id));
CREATE POLICY evoluciones_insert ON evoluciones FOR INSERT TO app_user
  WITH CHECK (autor_id = app_usuario_id() AND es_profesional_de_ficha(ficha_clinica_id));


-- -----------------------------------------------------------------------------
-- Prueba manual rapida (psql, despues de `prisma migrate dev` + seed):
--
--   BEGIN;
--   SET LOCAL ROLE app_user;
--   SELECT set_config('app.current_usuario_id', '<id profesional 1>', true);
--   SELECT set_config('app.current_rol', 'PROFESIONAL', true);
--   SELECT * FROM pacientes;   -- solo los de profesional 1
--   ROLLBACK;
-- -----------------------------------------------------------------------------
