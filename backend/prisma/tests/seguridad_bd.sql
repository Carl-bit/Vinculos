-- =============================================================================
-- Tests de reglas de dominio y seguridad de la BD (prompts 01 a 01e).
-- Autoverificables: cada caso hace ASSERT o espera un SQLSTATE concreto; el
-- primer fallo corta el script (ON_ERROR_STOP) con el numero de caso.
--
-- Correr con prisma/tests/correr_tests_bd.sh (cluster Postgres 18 temporal).
-- Variables psql requeridas: app_url (URI como app_user) y owner_url (URI como
-- vinculos_owner). Empieza conectado como dueño y corre despues del seed (que
-- agrega 4 usuarios y 1 paciente; los conteos de ADMIN lo consideran) y del
-- aprovisionamiento de llaves (infra/scripts/llaves/aprovisionar.sh).
--
-- Casos 1-17: los 17 del prompt 01. 18-27: prompt 01b. 28-44: prompt 01c.
-- 45-67: prompt 01d. 68-78: prompt 01e. 79-84: prompt 01f. 85: prompt 01g. 101-115: prompt 03a-1 (roles por cuenta, cuentas y tokens, politicas, menores, agenda, solicitudes sin cuenta, lista de espera, acceso temporal, borradores, alta, reseñas, reportes, contenido publico, liquidacion por cita realizada); 03a agrega a 67 las tablas append-only nuevas y a 78 excluye imagenes_publicas (publicas, sin cifrar). 86-87: prompt 02a (sesiones, alertas). 88-89: 02f/02g (notificaciones, portal). 90-95: 02h (documentos clinicos, avisos de derivacion, videollamada y feed, cobros). 96-99: 02i (plantillas, preferencias, adjuntos de la ficha, recordatorios y SEQUENCE); 02i redefinio 88 (mensajes solo via notificar(), un canal por fila, cola con backoff) y 91 (un aviso pendiente por canal); 02h redefinio 32, 52, 53 (pagos y boletas solo via funciones, arriendos por periodo), 51 (el profesional propone tipos de atencion) y 71 (pago pendiente = saldo > 0). 01c redefinio 12, 14 y 27 (aceptar una
-- derivacion traspasa el paciente); 01d redefinio 36, 37 y 42 (tipo de
-- atencion por catalogo, oferta con citas en conflicto, el origen cancela en
-- SIN_ASIGNAR); 01e redefinio 19 (tablas sin GRANT), 50 (perfil
-- autogestionado), 59, 60 y 64 (practicantes solo via derivacion con
-- consentimiento) y 46 (tablas con DELETE); 01f redefinio 61-62 (reactivacion
-- dentro de la gracia) y 76 (cambiar de supervisor no invalida consentimientos).
--
-- Cifrado (01e): la BD solo ve bytea opacos. Los tests SQL usan test.cif(t),
-- un valor con el formato y largo de un cifrado real (sin texto plano); el
-- cifrado verdadero se prueba en backend/src/common/crypto/*.spec.ts.
--
-- Las citas de los casos 1-35 tienen fechas fijas en el PASADO: la
-- reasignacion de citas futuras al aceptar una derivacion no las toca, asi el
-- resultado no depende del dia en que se corre. Las citas futuras de 01d se
-- crean relativas a now().
--
-- Helpers (schema `test`, se borra al final):
--   test.u('b1')          -> uuid fijo 00000000-0000-0000-0000-0000000000b1
--   test.ctx('b1', 'ROL') -> set_config local de app.current_usuario_id/rol
--   test.ids / test.id(k) -> ids generados (derivaciones) entre transacciones
--   test.cif('texto')     -> bytea con formato de valor cifrado (determinista)
--   test.evo(ficha, autor, texto[, corrige, id]) -> INSERT de evolucion como
--                            el contexto actual (con RLS), devuelve el id
--   test.consentir(paciente, practicante, supervisor) -> consentimiento
--                            ACEPTADO como dueño (datos de prueba)
-- Usuarios: a1 ADMIN, a2 PACIENTE (de Ana), a3 GESTION (se crea en 28),
--   b1..b5 PROFESIONAL, c1 PRACTICANTE vigente (supervisa b3), c2 PRACTICANTE
--   expirado. 01d agrega a4 PACIENTE (de Eva), b6 PROFESIONAL (baja), c3
--   PRACTICANTE (supervisa b4), c4 PRACTICANTE sin supervision, c5 PRACTICANTE
--   vencido aun activo (supervisa b4).
-- Pacientes: 0a Ana (b1), 0b Beto menor (b2), 0c Caro (c1), 0d Dani (c2);
--   01d: 0e Eva (c3), 0f Fede (b6), 10 Gabi (c4); 01e: 12 Ivan (b5).
-- Disponibilidad: todo el equipo de prueba atiende 24x7 en ambas modalidades,
--   salvo b5 (lunes a viernes 09-13, solo presencial; caso 72).
-- Tipos de atencion: 71, 72 activos; 73 inactivo. Tipos de sesion: 60 'T Individual'
--   y 61 'T Familiar' aprobados. 01f agrega a5 ADMIN, a6 GESTION y 13 Olga (b1,
--   ficha antigua para retencion).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

CREATE SCHEMA test;
CREATE FUNCTION test.u(t text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-0000-0000-0000000000' || t)::uuid
$$;
CREATE FUNCTION test.ctx(usuario text, rol text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.current_usuario_id', test.u(usuario)::text, true),
          set_config('app.current_rol', rol, true);
END;
$$;
CREATE TABLE test.ids (k text PRIMARY KEY, v uuid NOT NULL);
CREATE FUNCTION test.id(clave text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT v FROM test.ids WHERE k = clave
$$;
CREATE FUNCTION test.cif(t text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$
  SELECT '\x01'::bytea || decode(rpad(md5(t), 40, '0'), 'hex') || sha256(convert_to(t, 'UTF8'))
$$;
CREATE FUNCTION test.evo(ficha uuid, autor uuid, texto text, corrige uuid DEFAULT NULL, p_id uuid DEFAULT NULL,
                         p_tipo uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro,
                           tipo_sesion_id, nivel_riesgo, corrige_a_id)
  VALUES (coalesce(p_id, gen_random_uuid()), ficha, autor, test.cif(texto), test.cif('nombre autor'),
          test.cif('rut autor'), test.cif('registro autor'), coalesce(p_tipo, test.u('60')), 'NINGUNO', corrige)
  RETURNING id
$$;
CREATE FUNCTION test.consentir(paciente uuid, practicante uuid, supervisor uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO consentimientos (paciente_id, tipo, practicante_id, supervisor_id, estado, solicitado_por_id, vence_en,
                               version_documento, otorgado_por_tipo, respondido_por_id, respondido_en)
  VALUES (paciente, 'ATENCION_CON_PRACTICANTE_SUPERVISADO', practicante, supervisor, 'ACEPTADO', supervisor,
          now() + interval '1 day', 'v1', 'PACIENTE', supervisor, now())
$$;
CREATE FUNCTION test.disponible_siempre(usuarios uuid[]) RETURNS void LANGUAGE sql AS $$
  INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
  SELECT u, d, 0, 1440, m::modalidad_atencion
  FROM unnest(usuarios) u, generate_series(1, 7) d, unnest(ARRAY['PRESENCIAL', 'ONLINE']) m
$$;
-- Inicio de una cita relativa a now() que no cruza la medianoche de Chile en
-- su primera hora (la disponibilidad no cruza de dia): si cae despues de las
-- 22:50 locales, se adelanta 2 horas.
CREATE FUNCTION test.sin_cruzar(t timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN (t AT TIME ZONE 'America/Santiago')::time >= '22:50' OR (t AT TIME ZONE 'America/Santiago')::time < '00:10'
              THEN t - interval '2 hours' ELSE t END
$$;
GRANT USAGE ON SCHEMA test TO app_user;
GRANT SELECT, INSERT ON test.ids TO app_user;

-- Datos fijos (como dueño: BYPASSRLS, sin RLS). Una sola transaccion: un
-- paciente de practicante necesita su consentimiento al COMMIT (trigger diferido).
BEGIN;
INSERT INTO usuarios (id, email, password_hash, nombre, rol, fecha_expiracion_acceso) VALUES
  (test.u('a1'), 't-admin@x', 'h', 'Admin', 'ADMIN', NULL),
  (test.u('b1'), 't-p1@x', 'h', 'Prof 1', 'PROFESIONAL', NULL),
  (test.u('b2'), 't-p2@x', 'h', 'Prof 2', 'PROFESIONAL', NULL),
  (test.u('b3'), 't-p3@x', 'h', 'Prof 3', 'PROFESIONAL', NULL),
  (test.u('b4'), 't-p4@x', 'h', 'Prof 4', 'PROFESIONAL', NULL),
  (test.u('b5'), 't-p5@x', 'h', 'Prof 5', 'PROFESIONAL', NULL),
  (test.u('c1'), 't-prv@x', 'h', 'Practicante vigente', 'PRACTICANTE', now() + interval '30 days'),
  (test.u('c2'), 't-pre@x', 'h', 'Practicante expirado', 'PRACTICANTE', now() - interval '1 day');
INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES
  (test.u('0a'), 'Ana', 'Adulta', '1990-01-01', test.u('b1')),
  (test.u('0b'), 'Beto', 'Menor', '2015-01-01', test.u('b2')),
  (test.u('0c'), 'Caro', 'Practica', '1995-01-01', test.u('c1')),
  (test.u('0d'), 'Dani', 'Practica', '1995-01-01', test.u('c2'));
INSERT INTO usuarios (id, email, password_hash, nombre, rol, paciente_id) VALUES
  (test.u('a2'), 't-ana@x', 'h', 'Ana (paciente)', 'PACIENTE', test.u('0a'));
INSERT INTO fichas_clinicas (id, paciente_id) VALUES
  (test.u('fa'), test.u('0a')), (test.u('fb'), test.u('0b')),
  (test.u('fc'), test.u('0c')), (test.u('fd'), test.u('0d'));
INSERT INTO tipos_sesion (id, nombre, estado, propuesto_por_id, revisado_por_id, revisado_en) VALUES
  (test.u('60'), 'T Individual', 'APROBADO', test.u('a1'), test.u('a1'), now()),
  (test.u('61'), 'T Familiar', 'APROBADO', test.u('a1'), test.u('a1'), now());
DO $$ BEGIN
  PERFORM test.evo(test.u('fa'), test.u('b1'), 'sesion 1 Ana', NULL, test.u('ea')),
          test.evo(test.u('fc'), test.u('c1'), 'sesion 1 Caro', NULL, test.u('ec')),
          test.evo(test.u('fd'), test.u('c2'), 'sesion 1 Dani', NULL, test.u('ed'));
END $$;
INSERT INTO espacios (id, nombre) VALUES (test.u('e1'), 'T Box 1'), (test.u('e2'), 'T Box 2');
INSERT INTO adultos_responsables (id, paciente_id, nombre) VALUES (gen_random_uuid(), test.u('0a'), 'Pareja');
-- c2 tuvo supervision (b3) mientras atendia a Dani; se cierra despues del COMMIT.
INSERT INTO supervisiones (practicante_id, supervisor_id) VALUES (test.u('c1'), test.u('b3')), (test.u('c2'), test.u('b3'));
DO $$ BEGIN
  PERFORM test.consentir(test.u('0c'), test.u('c1'), test.u('b3')), test.consentir(test.u('0d'), test.u('c2'), test.u('b3')),
          test.disponible_siempre(ARRAY[test.u('b1'), test.u('b2'), test.u('b3'), test.u('b4'), test.u('c1'), test.u('c2')]);
END $$;
INSERT INTO tipos_atencion (id, nombre, activo) VALUES
  (test.u('71'), 'T Psicoterapia adultos', true), (test.u('72'), 'T Evaluacion', true), (test.u('73'), 'T Inactivo', false);
COMMIT;
UPDATE supervisiones SET hasta = now() WHERE practicante_id = test.u('c2');

-- -----------------------------------------------------------------------------
-- Casos 1-9 y 17: como dueño (reglas que aplican incluso sin RLS).
-- -----------------------------------------------------------------------------
\echo 1  EXCLUDE espacio: solapada en el mismo box -> 23P01
DO $$ BEGIN
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e1'), test.u('b1'), test.u('0a'), '2025-11-02 10:00-03', '2025-11-02 11:00-03');
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e1'), test.u('b2'), test.u('0a'), '2025-11-02 10:30-03', '2025-11-02 11:30-03');
    RAISE EXCEPTION 'caso 1: debio fallar';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
END $$;

\echo 2  Cita contigua [10,11) + [11,12) -> OK
INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
  (test.u('e1'), test.u('b1'), test.u('0a'), '2025-11-02 11:00-03', '2025-11-02 12:00-03');

\echo 3  CANCELADA solapada -> OK
INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin, estado) VALUES
  (test.u('e1'), test.u('b1'), test.u('0a'), '2025-11-02 10:00-03', '2025-11-02 11:00-03', 'CANCELADA');

\echo 4  Menor sin adulto responsable -> 23514
DO $$ BEGIN
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e2'), test.u('b2'), test.u('0b'), '2025-11-02 10:00-03', '2025-11-02 11:00-03');
  RAISE EXCEPTION 'caso 4: debio fallar';
EXCEPTION WHEN check_violation THEN NULL; END $$;

\echo 5  Menor con adulto responsable -> OK
INSERT INTO adultos_responsables (id, paciente_id, nombre) VALUES (gen_random_uuid(), test.u('0b'), 'Mama');
INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
  (test.u('e2'), test.u('b2'), test.u('0b'), '2025-11-02 10:00-03', '2025-11-02 11:00-03');

\echo 6  Profesional solapado en otro box -> 23P01
DO $$ BEGIN
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e2'), test.u('b1'), test.u('0a'), '2025-11-02 10:15-03', '2025-11-02 10:45-03');
  RAISE EXCEPTION 'caso 6: debio fallar';
EXCEPTION WHEN exclusion_violation THEN NULL; END $$;

\echo 7  DELETE evoluciones como dueño -> trigger 23001
DO $$ BEGIN
  DELETE FROM evoluciones;
  RAISE EXCEPTION 'caso 7: debio fallar';
EXCEPTION WHEN restrict_violation THEN NULL; END $$;

\echo 8  UPDATE evoluciones como dueño -> trigger 23001
DO $$ BEGIN
  UPDATE evoluciones SET notas = test.cif('x');
  RAISE EXCEPTION 'caso 8: debio fallar';
EXCEPTION WHEN restrict_violation THEN NULL; END $$;

\echo 9  DELETE pacientes como dueño -> trigger 23001
DO $$ BEGIN
  DELETE FROM pacientes;
  RAISE EXCEPTION 'caso 9: debio fallar';
EXCEPTION WHEN restrict_violation THEN NULL; END $$;

\echo 17 PRACTICANTE sin fecha_expiracion_acceso -> CHECK 23514
DO $$ BEGIN
  INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES (gen_random_uuid(), 't-pr@x', 'h', 'P', 'PRACTICANTE');
  RAISE EXCEPTION 'caso 17: debio fallar';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- Mas datos para 01c: cita del practicante (otro dia, no afecta el reporte del
-- caso 25) y un pago por cada profesional.
INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
  (test.u('e2'), test.u('c1'), test.u('0c'), '2025-11-03 10:00-03', '2025-11-03 11:00-03');
INSERT INTO pagos (cita_id, monto, medio_pago)
SELECT id, 30000, 'TRANSFERENCIA' FROM citas
WHERE (profesional_id = test.u('b1') AND inicio = '2025-11-02 10:00-03' AND estado = 'CONFIRMADA')
   OR profesional_id = test.u('b2');

-- -----------------------------------------------------------------------------
-- Desde aqui: conectado como app_user (el rol LOGIN real de la API), sin
-- SET ROLE. Cada DO es su propia transaccion; test.ctx = SET LOCAL.
-- -----------------------------------------------------------------------------
\connect :app_url
\set ON_ERROR_STOP 1

\echo 18 Rol de la API: no superusuario, sin BYPASSRLS, no dueño; dueño no superusuario; FORCE RLS
DO $$ BEGIN
  ASSERT current_user = 'app_user', 'caso 18: conectado como ' || current_user;
  ASSERT (SELECT NOT rolsuper AND NOT rolbypassrls AND rolcanlogin FROM pg_roles WHERE rolname = current_user), 'caso 18: atributos';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user), 'caso 18: es dueño de tablas';
  ASSERT (SELECT NOT r.rolsuper FROM pg_roles r JOIN pg_tables t ON t.tableowner = r.rolname
          WHERE t.schemaname = 'public' AND t.tablename = 'pacientes'), 'caso 18: dueño es superusuario';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'public' AND c.relrowsecurity AND NOT c.relforcerowsecurity), 'caso 18: tabla con RLS sin FORCE';
END $$;

\echo 19 Sin variables seteadas: 0 filas en toda tabla con RLS
DO $$ DECLARE t text; n int; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
             AND has_table_privilege(c.oid, 'SELECT') LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    ASSERT n = 0, format('caso 19: %s devuelve %s filas', t, n);
  END LOOP;
END $$;

\echo 20 SET ROLE a rol con mas privilegios -> 42501
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['app_reportes', 'vinculos_owner', 'postgres'] LOOP
    BEGIN
      EXECUTE format('SET ROLE %I', r);
      RAISE EXCEPTION 'caso 20: SET ROLE % debio fallar', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;

\echo 10 RLS p1: pacientes 1, fichas 1, evoluciones 1
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM pacientes) = 1, 'caso 10: pacientes';
  ASSERT (SELECT count(*) FROM fichas_clinicas) = 1, 'caso 10: fichas';
  ASSERT (SELECT count(*) FROM evoluciones) = 1, 'caso 10: evoluciones';
END $$;

\echo 11 p1 inserta paciente de p2 -> 42501
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES (gen_random_uuid(), 'X', 'Y', '1990-01-01', test.u('b2'));
  RAISE EXCEPTION 'caso 11: debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 12 p2 (sin derivacion aceptada) no ve a Ana: pacientes 1 (Beto), UPDATE de Ana = 0 filas
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM pacientes) = 1, 'caso 12: pacientes';
  UPDATE pacientes SET nombre = 'z' WHERE id = test.u('0a');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 12: update ajeno';
END $$;

\echo 14 p2 no ve evoluciones ni ficha de Ana
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM evoluciones WHERE ficha_clinica_id = test.u('fa')), 'caso 14: evoluciones';
  ASSERT NOT EXISTS (SELECT 1 FROM fichas_clinicas WHERE id = test.u('fa')), 'caso 14: ficha';
END $$;

\echo 13 ADMIN: pacientes 4, fichas 4, evoluciones 0, DELETE pacientes 42501, INSERT evolucion 42501
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM pacientes) = 5, 'caso 13: pacientes';
  ASSERT (SELECT count(*) FROM fichas_clinicas) = 4, 'caso 13: fichas';
  ASSERT (SELECT count(*) FROM evoluciones) = 0, 'caso 13: evoluciones';
  BEGIN
    DELETE FROM pacientes;
    RAISE EXCEPTION 'caso 13: DELETE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM test.evo(test.u('fa'), test.u('a1'), 'x');
    RAISE EXCEPTION 'caso 13: INSERT debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 21 ADMIN no lee evoluciones ni con consulta directa por id
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT NOT EXISTS (SELECT 1 FROM evoluciones WHERE id = test.u('ea')), 'caso 21: por id';
  ASSERT NOT EXISTS (SELECT 1 FROM evoluciones e JOIN fichas_clinicas f ON f.id = e.ficha_clinica_id), 'caso 21: via join';
END $$;

\echo 22 Practicante: vigente ve su paciente; expirado 0 filas con variables seteadas
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  ASSERT (SELECT count(*) FROM pacientes) = 1, 'caso 22: vigente pacientes';
  ASSERT (SELECT count(*) FROM evoluciones) = 1, 'caso 22: vigente evoluciones';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c2', 'PRACTICANTE');
  ASSERT (SELECT count(*) FROM pacientes) = 0, 'caso 22: expirado pacientes';
  ASSERT (SELECT count(*) FROM fichas_clinicas) = 0, 'caso 22: expirado fichas';
  ASSERT (SELECT count(*) FROM evoluciones) = 0, 'caso 22: expirado evoluciones';
  BEGIN
    PERFORM test.evo(test.u('fd'), test.u('c2'), 'x');
    RAISE EXCEPTION 'caso 22: INSERT expirado debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 23 Rol de contexto distinto al de la BD (practicante dice ser ADMIN) -> 0 filas
DO $$ BEGIN
  PERFORM test.ctx('c1', 'ADMIN');
  ASSERT (SELECT count(*) FROM pacientes) = 0, 'caso 23: pacientes';
  ASSERT (SELECT count(*) FROM usuarios) = 0, 'caso 23: usuarios';
END $$;

\echo 24 accesos_ficha: INSERT propio OK, ajeno 42501, solo ADMIN lee, UPDATE/DELETE rechazados
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, ficha_id, recurso, accion) VALUES
    (test.u('b1'), 'PROFESIONAL', test.u('0a'), test.u('fa'), 'evoluciones', 'LECTURA');
  ASSERT (SELECT count(*) FROM accesos_ficha) = 0, 'caso 24: no ADMIN no lee';
  BEGIN
    INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion) VALUES
      (test.u('b2'), 'PROFESIONAL', test.u('0a'), 'evoluciones', 'LECTURA');
    RAISE EXCEPTION 'caso 24: INSERT a nombre de otro debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM accesos_ficha) = 1, 'caso 24: ADMIN lee';
  BEGIN
    UPDATE accesos_ficha SET accion = 'x';
    RAISE EXCEPTION 'caso 24: UPDATE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM accesos_ficha;
    RAISE EXCEPTION 'caso 24: DELETE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 25 Reporte: ADMIN recibe agregados; PROFESIONAL -> 42501
DO $$ DECLARE r record; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  SELECT * INTO r FROM reporte_citas_por_profesional('2025-11-02', '2025-11-02') WHERE profesional_id = test.u('b1');
  ASSERT r.citas_confirmadas = 2 AND r.citas_canceladas = 1 AND r.minutos_confirmados = 120,
    format('caso 25: agregados p1 = %s', r);
  ASSERT (SELECT count(*) FROM reporte_citas_por_profesional('2025-11-02', '2025-11-02')) = 2, 'caso 25: filas';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM reporte_citas_por_profesional('2025-11-02', '2025-11-02');
  RAISE EXCEPTION 'caso 25: PROFESIONAL debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 27 Derivaciones: app_user no inserta ni actualiza directo (solo via funciones) -> 42501
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    INSERT INTO derivaciones (id, ficha_clinica_id, profesional_origen_id, motivo, tipo_atencion_id, creada_por_id) VALUES
      (gen_random_uuid(), test.u('fa'), test.u('b1'), test.cif('m'), test.u('71'), test.u('b1'));
    RAISE EXCEPTION 'caso 27: INSERT debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO derivacion_candidatos (derivacion_id, profesional_id, orden) VALUES (test.u('fa'), test.u('b2'), 1);
    RAISE EXCEPTION 'caso 27: INSERT candidato debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 15 p1 corrige evolucion = fila nueva con corrige_a_id (append-only via API)
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM test.evo(test.u('fa'), test.u('b1'), 'correccion', test.u('ea'));
  ASSERT (SELECT count(*) FROM evoluciones) = 2, 'caso 15';
END $$;

\echo 16 p1 no puede firmar evolucion como otro autor -> 42501
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM test.evo(test.u('fa'), test.u('b2'), 'x');
  RAISE EXCEPTION 'caso 16: debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 01c: configuracion, usuarios, citas/adultos/pagos por rol, PACIENTE, ocupacion.
-- ---------------------------------------------------------------------------
\echo 28 configuracion_centro: todos leen, solo ADMIN modifica; GESTION exige flag; no apagar con GESTION activos
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM configuracion_centro) = 1, 'caso 28: PROFESIONAL lee';
  UPDATE configuracion_centro SET plazo_respuesta_derivacion_horas = 48;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 28: PROFESIONAL no modifica';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES (test.u('a3'), 't-g@x', 'h', 'Gestion', 'GESTION');
    RAISE EXCEPTION 'caso 28: GESTION con flag false debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE configuracion_centro SET rol_gestion_habilitado = true;
  INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES (test.u('a3'), 't-g@x', 'h', 'Gestion', 'GESTION');
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET rol_gestion_habilitado = false;
  RAISE EXCEPTION 'caso 28: apagar con GESTION activo debio fallar';
EXCEPTION WHEN check_violation THEN NULL; END $$;

\echo 29 usuarios: fila propia, sin cambiar el propio rol, solo ADMIN crea, login sin contexto, PACIENTE exige paciente_id
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM usuarios) = 1, 'caso 29: lee solo su fila';
  UPDATE usuarios SET nombre = 'Prof Uno' WHERE id = test.u('b1');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'caso 29: actualiza su nombre';
  UPDATE usuarios SET nombre = 'x' WHERE id = test.u('b2');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 29: fila ajena';
  BEGIN
    UPDATE usuarios SET rol = 'ADMIN' WHERE id = test.u('b1');
    RAISE EXCEPTION 'caso 29: cambiar su rol debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE usuarios SET activo = false WHERE id = test.u('b1');
    RAISE EXCEPTION 'caso 29: cambiar su activo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES (gen_random_uuid(), 't-x@x', 'h', 'X', 'PROFESIONAL');
    RAISE EXCEPTION 'caso 29: PROFESIONAL crea usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM usuarios WHERE id = test.u('b1');
    RAISE EXCEPTION 'caso 29: DELETE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM usuarios) = 14, 'caso 29: ADMIN lee todas (10 + 4 del seed)';
  BEGIN
    UPDATE usuarios SET rol = 'GESTION' WHERE id = test.u('a1');
    RAISE EXCEPTION 'caso 29: ADMIN cambia su propio rol debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE usuarios SET activo = false WHERE id = test.u('c2');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'caso 29: ADMIN desactiva a otro';
  BEGIN
    INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES (gen_random_uuid(), 't-pac@x', 'h', 'Sin paciente', 'PACIENTE');
    RAISE EXCEPTION 'caso 29: PACIENTE sin paciente_id debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM credenciales_login('t-p1@x');
  ASSERT r.id = test.u('b1') AND r.rol = 'PROFESIONAL' AND r.password_hash = 'h' AND r.activo, 'caso 29: login';
  ASSERT NOT EXISTS (SELECT 1 FROM credenciales_login('no-existe@x')), 'caso 29: login email inexistente';
END $$;

\echo 30 citas por rol: ADMIN 5, GESTION 5, p1 3, p2 1, practicante 1, PACIENTE 3; escrituras
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');       ASSERT (SELECT count(*) FROM citas) = 5, 'caso 30: ADMIN';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');     ASSERT (SELECT count(*) FROM citas) = 5, 'caso 30: GESTION';
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e1'), test.u('b2'), test.u('0b'), '2025-11-05 10:00-03', '2025-11-05 11:00-03');
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL'); ASSERT (SELECT count(*) FROM citas) = 3, 'caso 30: p1';
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e1'), test.u('b1'), test.u('0b'), '2025-11-06 10:00-03', '2025-11-06 11:00-03');
    RAISE EXCEPTION 'caso 30: p1 agenda paciente ajeno debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e1'), test.u('b1'), test.u('0a'), '2025-11-06 10:00-03', '2025-11-06 11:00-03');
  BEGIN
    DELETE FROM citas;
    RAISE EXCEPTION 'caso 30: DELETE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL'); ASSERT (SELECT count(*) FROM citas) = 2, 'caso 30: p2 (1 + la de GESTION)';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE'); ASSERT (SELECT count(*) FROM citas) = 1, 'caso 30: practicante';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');    ASSERT (SELECT count(*) FROM citas) = 4, 'caso 30: PACIENTE (3 + la de p1)';
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e2'), test.u('b1'), test.u('0a'), '2025-11-07 10:00-03', '2025-11-07 11:00-03');
  RAISE EXCEPTION 'caso 30: PACIENTE agenda debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 31 adultos_responsables por rol: ADMIN 2, GESTION 2, p1 1, p2 1, practicante 0, PACIENTE 1
DO $$ BEGIN PERFORM test.ctx('a1', 'ADMIN');       ASSERT (SELECT count(*) FROM adultos_responsables) = 2, 'caso 31: ADMIN'; END $$;
DO $$ BEGIN PERFORM test.ctx('a3', 'GESTION');     ASSERT (SELECT count(*) FROM adultos_responsables) = 2, 'caso 31: GESTION'; END $$;
DO $$ BEGIN PERFORM test.ctx('b1', 'PROFESIONAL'); ASSERT (SELECT count(*) FROM adultos_responsables) = 1, 'caso 31: p1'; END $$;
DO $$ BEGIN PERFORM test.ctx('b2', 'PROFESIONAL'); ASSERT (SELECT count(*) FROM adultos_responsables) = 1, 'caso 31: p2'; END $$;
DO $$ BEGIN PERFORM test.ctx('c1', 'PRACTICANTE'); ASSERT (SELECT count(*) FROM adultos_responsables) = 0, 'caso 31: practicante'; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM adultos_responsables) = 1, 'caso 31: PACIENTE';
  INSERT INTO adultos_responsables (id, paciente_id, nombre) VALUES (gen_random_uuid(), test.u('0a'), 'Otro');
  RAISE EXCEPTION 'caso 31: PACIENTE escribe debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 32 pagos por rol: ADMIN 2, GESTION 2, p1 1, p2 1, practicante 0, PACIENTE 1; nadie escribe directo (02h: registrar_pago)
DO $$ BEGIN PERFORM test.ctx('a1', 'ADMIN');       ASSERT (SELECT count(*) FROM pagos) = 2, 'caso 32: ADMIN'; END $$;
DO $$ BEGIN PERFORM test.ctx('b2', 'PROFESIONAL'); ASSERT (SELECT count(*) FROM pagos) = 1, 'caso 32: p2'; END $$;
DO $$ BEGIN PERFORM test.ctx('c1', 'PRACTICANTE'); ASSERT (SELECT count(*) FROM pagos) = 0, 'caso 32: practicante'; END $$;
DO $$ BEGIN PERFORM test.ctx('a2', 'PACIENTE');    ASSERT (SELECT count(*) FROM pagos) = 1, 'caso 32: PACIENTE'; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM pagos) = 1, 'caso 32: p1';
  INSERT INTO pagos (cita_id, monto, medio_pago) SELECT id, 1000, 'EFECTIVO' FROM citas LIMIT 1;
  RAISE EXCEPTION 'caso 32: PROFESIONAL inserta pago debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM pagos) = 2, 'caso 32: GESTION';
  BEGIN
    INSERT INTO pagos (cita_id, monto, medio_pago)
    SELECT id, 25000, 'EFECTIVO' FROM citas WHERE profesional_id = test.u('c1');
    RAISE EXCEPTION 'caso 32: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- La cita del practicante no tiene tarifa (monto 0): cualquier pago es sobrepago.
  BEGIN
    PERFORM registrar_pago((SELECT id FROM citas WHERE profesional_id = test.u('c1') LIMIT 1), 25000, 'EFECTIVO');
    RAISE EXCEPTION 'caso 32: sobrepago debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

\echo 33 PACIENTE: su registro si, fichas/evoluciones/derivaciones nunca
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM pacientes) = 1 AND (SELECT id FROM pacientes) = test.u('0a'), 'caso 33: su registro';
  ASSERT (SELECT count(*) FROM fichas_clinicas) = 0, 'caso 33: fichas';
  ASSERT (SELECT count(*) FROM evoluciones) = 0, 'caso 33: evoluciones';
  ASSERT (SELECT count(*) FROM derivaciones) = 0, 'caso 33: derivaciones';
  ASSERT (SELECT count(*) FROM usuarios) = 1, 'caso 33: usuarios';
END $$;

\echo 34 ocupacion_espacios: ve toda la ocupacion, solo espacio/inicio/fin
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM citas WHERE inicio < '2025-11-03 00:00-03') = 1, 'caso 34: p2 ve 1 cita ese dia';
  ASSERT (SELECT count(*) FROM ocupacion_espacios('2025-11-02 00:00-03', '2025-11-03 00:00-03')) = 3, 'caso 34: ocupacion';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'ocupacion_espacios') = '{desde,hasta,espacio_id,inicio,fin}',
    'caso 34: columnas expuestas';
END $$;

\echo 35 EXCLUDE detecta choque con una cita que el contexto no ve -> 23P01
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  -- p2 esta libre 11:15-11:45; el box e1 lo ocupa una cita de p1 (11-12) que p2 no ve.
  ASSERT NOT EXISTS (SELECT 1 FROM citas WHERE espacio_id = test.u('e1') AND inicio = '2025-11-02 11:00-03'), 'caso 35: la ve';
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e1'), test.u('b2'), test.u('0b'), '2025-11-02 11:15-03', '2025-11-02 11:45-03');
  RAISE EXCEPTION 'caso 35: debio fallar';
EXCEPTION WHEN exclusion_violation THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- Dueño: blindaje de accesos_ficha incluso para el dueño.
-- -----------------------------------------------------------------------------
\connect :owner_url
\set ON_ERROR_STOP 1

\echo 26 accesos_ficha UPDATE/DELETE como dueño -> trigger 23001
DO $$ BEGIN
  BEGIN
    UPDATE accesos_ficha SET accion = 'x';
    RAISE EXCEPTION 'caso 26: UPDATE debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    DELETE FROM accesos_ficha;
    RAISE EXCEPTION 'caso 26: DELETE debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
END $$;

-- -----------------------------------------------------------------------------
-- 01c: derivaciones con oferta secuencial. d1: Ana (fa), origen p1,
-- candidatos [p2, p3, p4].
-- -----------------------------------------------------------------------------
\connect :app_url
\set ON_ERROR_STOP 1

\echo 36 Solo el tratante crea (ADMIN y otro profesional no); candidatos validos; oferta al primero con plazo 24h
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM crear_derivacion(gen_random_uuid(), test.u('fa'), test.cif('m'), test.u('71'), NULL, ARRAY[test.u('b2')]);
  RAISE EXCEPTION 'caso 36: ADMIN crea debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  PERFORM crear_derivacion(gen_random_uuid(), test.u('fa'), test.cif('m'), test.u('71'), NULL, ARRAY[test.u('b3')]);
  RAISE EXCEPTION 'caso 36: no tratante crea debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM crear_derivacion(gen_random_uuid(), test.u('fa'), test.cif('m'), test.u('71'), NULL, ARRAY[test.u('c1')]);
    RAISE EXCEPTION 'caso 36: candidato PRACTICANTE debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO test.ids VALUES ('d1', crear_derivacion(gen_random_uuid(), test.u('fa'), test.cif('Duelo complicado'), test.u('71'), NULL,
                                                      ARRAY[test.u('b2'), test.u('b3'), test.u('b4')]));
  ASSERT (SELECT estado FROM derivaciones WHERE id = test.id('d1')) = 'PENDIENTE', 'caso 36: PENDIENTE';
  ASSERT (SELECT string_agg(estado::text, ',' ORDER BY orden) FROM derivacion_candidatos WHERE derivacion_id = test.id('d1'))
         = 'OFRECIDA,EN_ESPERA,EN_ESPERA', 'caso 36: estados';
  ASSERT (SELECT vence_en - ofrecida_en FROM derivacion_candidatos WHERE derivacion_id = test.id('d1') AND estado = 'OFRECIDA')
         = interval '24 hours', 'caso 36: plazo 24h';
  BEGIN
    PERFORM crear_derivacion(gen_random_uuid(), test.u('fa'), test.cif('m'), test.u('71'), NULL, ARRAY[test.u('b5')]);
    RAISE EXCEPTION 'caso 36: segunda derivacion abierta debio fallar';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

\echo 37 Candidato OFRECIDO: solo motivo, tipo y edad; no lee paciente, ficha, evoluciones ni la derivacion
DO $$ DECLARE r record; BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  SELECT * INTO r FROM oferta_derivacion(test.id('d1'));
  ASSERT r.motivo = test.cif('Duelo complicado') AND r.tipo_atencion = 'T Psicoterapia adultos' AND r.citas_en_conflicto = 0, 'caso 37: motivo/tipo';
  ASSERT r.edad_paciente = extract(year FROM age((now() AT TIME ZONE 'America/Santiago')::date, date '1990-01-01')), 'caso 37: edad';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'oferta_derivacion')
         = '{p_derivacion_id,derivacion_id,motivo,tipo_atencion,detalle,edad_paciente,vence_en,citas_en_conflicto}', 'caso 37: columnas expuestas';
  ASSERT NOT EXISTS (SELECT 1 FROM pacientes WHERE id = test.u('0a')), 'caso 37: paciente';
  ASSERT NOT EXISTS (SELECT 1 FROM fichas_clinicas WHERE id = test.u('fa')), 'caso 37: ficha';
  ASSERT NOT EXISTS (SELECT 1 FROM evoluciones WHERE ficha_clinica_id = test.u('fa')), 'caso 37: evoluciones';
  ASSERT NOT EXISTS (SELECT 1 FROM derivaciones WHERE id = test.id('d1')), 'caso 37: derivacion';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b3', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM oferta_derivacion(test.id('d1'))), 'caso 37: EN_ESPERA no ve la oferta';
END $$;

\echo 38 Rechazar ofrece al siguiente; el que rechazo ya no responde
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  PERFORM responder_derivacion(test.id('d1'), false);
  BEGIN
    PERFORM responder_derivacion(test.id('d1'), true);
    RAISE EXCEPTION 'caso 38: responder de nuevo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT string_agg(estado::text, ',' ORDER BY orden) FROM derivacion_candidatos WHERE derivacion_id = test.id('d1'))
         = 'RECHAZADA,OFRECIDA,EN_ESPERA', 'caso 38: estados';
END $$;

\connect :owner_url
\set ON_ERROR_STOP 1
-- Simula que pasaron 24h desde la oferta a p3.
UPDATE derivacion_candidatos SET ofrecida_en = now() - interval '25 hours', vence_en = now() - interval '1 hour'
WHERE derivacion_id = test.id('d1') AND estado = 'OFRECIDA';
\connect :app_url
\set ON_ERROR_STOP 1

\echo 39 Expirar a las 24h ofrece al siguiente; idempotente; el expirado ya no responde
DO $$ DECLARE n int; BEGIN
  n := expirar_ofertas_derivacion();
  ASSERT n = 1, format('caso 39: expiro %s', n);
  n := expirar_ofertas_derivacion();
  ASSERT n = 0, 'caso 39: idempotente';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT string_agg(estado::text, ',' ORDER BY orden) FROM derivacion_candidatos WHERE derivacion_id = test.id('d1'))
         = 'RECHAZADA,EXPIRADA,OFRECIDA', 'caso 39: estados';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b3', 'PROFESIONAL');
  PERFORM responder_derivacion(test.id('d1'), true);
  RAISE EXCEPTION 'caso 39: expirado responde debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\connect :owner_url
\set ON_ERROR_STOP 1
-- Simula que la oferta a p4 lleva 10h.
UPDATE derivacion_candidatos SET ofrecida_en = now() - interval '10 hours', vence_en = now() + interval '14 hours'
WHERE derivacion_id = test.id('d1') AND estado = 'OFRECIDA';
\connect :app_url
\set ON_ERROR_STOP 1

\echo 40 ADMIN reordena/agrega: oferta pasa al nuevo primero con plazo reiniciado; mismo primero conserva plazo
DO $$ DECLARE v timestamptz; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM definir_candidatos_derivacion(test.id('d1'), ARRAY[test.u('b2'), test.u('b4')]);
    RAISE EXCEPTION 'caso 40: reincorporar a quien rechazo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM definir_candidatos_derivacion(test.id('d1'), ARRAY[test.u('b5'), test.u('b4')]);
  ASSERT (SELECT estado FROM derivacion_candidatos WHERE derivacion_id = test.id('d1') AND profesional_id = test.u('b5')) = 'OFRECIDA',
    'caso 40: b5 ofrecida';
  ASSERT (SELECT estado FROM derivacion_candidatos WHERE derivacion_id = test.id('d1') AND profesional_id = test.u('b4')) = 'EN_ESPERA',
    'caso 40: b4 en espera';
  SELECT vence_en INTO v FROM derivacion_candidatos WHERE derivacion_id = test.id('d1') AND estado = 'OFRECIDA';
  ASSERT v > now() + interval '23 hours', 'caso 40: plazo reiniciado';
  PERFORM definir_candidatos_derivacion(test.id('d1'), ARRAY[test.u('b5'), test.u('b4')]);
  ASSERT (SELECT vence_en FROM derivacion_candidatos WHERE derivacion_id = test.id('d1') AND estado = 'OFRECIDA') = v,
    'caso 40: mismo primero conserva plazo';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM definir_candidatos_derivacion(test.id('d1'), ARRAY[test.u('b4')]);
  RAISE EXCEPTION 'caso 40: origen redefine debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 41 Lista agotada -> SIN_ASIGNAR
DO $$ BEGIN PERFORM test.ctx('b5', 'PROFESIONAL'); PERFORM responder_derivacion(test.id('d1'), false); END $$;
DO $$ BEGIN PERFORM test.ctx('b4', 'PROFESIONAL'); PERFORM responder_derivacion(test.id('d1'), false); END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT estado FROM derivaciones WHERE id = test.id('d1')) = 'SIN_ASIGNAR', 'caso 41: SIN_ASIGNAR';
  ASSERT NOT EXISTS (SELECT 1 FROM derivacion_candidatos WHERE derivacion_id = test.id('d1') AND estado IN ('OFRECIDA', 'EN_ESPERA')),
    'caso 41: sin pendientes';
END $$;

\echo 42 Cancelar SIN_ASIGNAR: otro profesional no; origen solo con motivo -> CERRADA; ya cerrada -> 55000
DO $$ BEGIN
  PERFORM test.ctx('b5', 'PROFESIONAL');
  PERFORM cancelar_derivacion(test.id('d1'), 'x');
  RAISE EXCEPTION 'caso 42: no origen cancela debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM cancelar_derivacion(test.id('d1'), '  ');
    RAISE EXCEPTION 'caso 42: cancelar sin motivo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM cancelar_derivacion(test.id('d1'), 'Paciente prefiere esperar');
  ASSERT (SELECT estado::text || '|' || motivo_cierre FROM derivaciones WHERE id = test.id('d1')) = 'CERRADA|Paciente prefiere esperar',
    'caso 42: CERRADA con motivo';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM cancelar_derivacion(test.id('d1'), 'x');
  RAISE EXCEPTION 'caso 42: cancelar cerrada debio fallar';
EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END $$;

\echo 43 Aceptar traspasa la ficha: p2 tratante y escribe; p1 pierde acceso; autoria previa intacta; sin reasignacion directa
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO test.ids VALUES ('d2', crear_derivacion(gen_random_uuid(), test.u('fa'), test.cif('Cambio de horario'), test.u('71'), NULL,
                                                      ARRAY[test.u('b2')]));
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  PERFORM responder_derivacion(test.id('d2'), true);
  ASSERT EXISTS (SELECT 1 FROM pacientes WHERE id = test.u('0a') AND profesional_id = test.u('b2')), 'caso 43: tratante';
  ASSERT (SELECT count(*) FROM evoluciones WHERE ficha_clinica_id = test.u('fa')) = 2, 'caso 43: p2 lee la ficha completa';
  ASSERT (SELECT count(*) FROM evoluciones WHERE ficha_clinica_id = test.u('fa') AND autor_id = test.u('b1')) = 2,
    'caso 43: autoria del periodo anterior';
  PERFORM test.evo(test.u('fa'), test.u('b2'), 'sesion con p2');
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM pacientes WHERE id = test.u('0a')), 'caso 43: p1 paciente';
  ASSERT NOT EXISTS (SELECT 1 FROM fichas_clinicas WHERE id = test.u('fa')), 'caso 43: p1 ficha';
  ASSERT NOT EXISTS (SELECT 1 FROM evoluciones WHERE ficha_clinica_id = test.u('fa')), 'caso 43: p1 evoluciones';
  ASSERT EXISTS (SELECT 1 FROM derivaciones WHERE id = test.id('d2') AND estado = 'ACEPTADA'), 'caso 43: origen ve su derivacion';
  PERFORM test.evo(test.u('fa'), test.u('b1'), 'x');
  RAISE EXCEPTION 'caso 43: p1 escribe debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM accesos_ficha WHERE accion = 'DERIVACION' AND ficha_id = test.u('fa')) >= 5,
    'caso 43: auditoria de acciones de derivacion';
  ASSERT EXISTS (SELECT 1 FROM accesos_ficha WHERE accion = 'DERIVACION' AND usuario_id = test.u('b2') AND recurso = 'oferta_derivacion'),
    'caso 43: auditoria de la vista de oferta';
  UPDATE pacientes SET profesional_id = test.u('b3') WHERE id = test.u('0a');
  RAISE EXCEPTION 'caso 43: reasignacion directa debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  INSERT INTO test.ids VALUES ('d3', crear_derivacion(gen_random_uuid(), test.u('fa'), test.cif('Interconsulta'), test.u('72'), NULL, ARRAY[test.u('b3'), test.u('b4')]));
END $$;

\connect :owner_url
\set ON_ERROR_STOP 1

\echo 44 Nunca dos ACEPTADAS ni dos OFRECIDAS por derivacion -> 23505 (incluso como dueño)
DO $$ BEGIN
  INSERT INTO derivacion_candidatos (derivacion_id, profesional_id, orden, estado) VALUES
    (test.id('d2'), test.u('b3'), 99, 'ACEPTADA');
  RAISE EXCEPTION 'caso 44: segunda ACEPTADA debio fallar';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
DO $$ BEGIN
  UPDATE derivacion_candidatos SET estado = 'OFRECIDA', ofrecida_en = now(), vence_en = now() + interval '1 hour'
  WHERE derivacion_id = test.id('d3') AND profesional_id = test.u('b4');
  RAISE EXCEPTION 'caso 44: segunda OFRECIDA debio fallar';
EXCEPTION WHEN unique_violation THEN NULL; END $$;

-- =============================================================================
-- 01d. Datos (como dueño, una transaccion por el trigger diferido de
-- consentimiento). test.dia(n, h) = hoy + n dias a las h horas: citas futuras.
-- =============================================================================
CREATE FUNCTION test.dia(n int, h int) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT date_trunc('day', now()) + make_interval(days => n, hours => h)
$$;
-- test.lunes(d, h) = lunes de la proxima semana + d dias, a las h horas de Chile.
CREATE FUNCTION test.lunes(dias int, horas numeric) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (date_trunc('week', now() AT TIME ZONE 'America/Santiago') + make_interval(days => 7 + dias)
          + make_interval(secs => horas * 3600)) AT TIME ZONE 'America/Santiago'
$$;

BEGIN;
INSERT INTO usuarios (id, email, password_hash, nombre, rol, fecha_expiracion_acceso) VALUES
  (test.u('b6'), 't-p6@x', 'h', 'Prof 6 (baja)', 'PROFESIONAL', NULL),
  (test.u('c3'), 't-c3@x', 'h', 'Practicante 3', 'PRACTICANTE', now() + interval '30 days'),
  (test.u('c4'), 't-c4@x', 'h', 'Practicante sin supervision', 'PRACTICANTE', now() + interval '30 days'),
  (test.u('c5'), 't-c5@x', 'h', 'Practicante vencido', 'PRACTICANTE', now() - interval '1 minute');
UPDATE usuarios SET telefono = test.cif('+56911111111') WHERE id = test.u('b1');
-- c4 tuvo supervision (b4) al recibir a Gabi; se cierra despues del COMMIT.
INSERT INTO supervisiones (practicante_id, supervisor_id) VALUES
  (test.u('c3'), test.u('b4')), (test.u('c5'), test.u('b4')), (test.u('c4'), test.u('b4'));
INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES
  (test.u('0e'), 'Eva', 'Practica', '1992-01-01', test.u('c3')),
  (test.u('0f'), 'Fede', 'Baja', '1985-01-01', test.u('b6')),
  (test.u('10'), 'Gabi', 'Sinsuper', '1993-01-01', test.u('c4')),
  (test.u('12'), 'Ivan', 'Adulto', '1988-01-01', test.u('b5'));
INSERT INTO usuarios (id, email, password_hash, nombre, rol, paciente_id) VALUES
  (test.u('a4'), 't-eva@x', 'h', 'Eva (paciente)', 'PACIENTE', test.u('0e'));
INSERT INTO fichas_clinicas (id, paciente_id) VALUES
  (test.u('fe'), test.u('0e')), (test.u('ff'), test.u('0f')), (test.u('f0'), test.u('10')), (test.u('f2'), test.u('12'));
DO $$ BEGIN
  PERFORM test.evo(test.u('fe'), test.u('c3'), 'sesion 1 Eva'), test.evo(test.u('f0'), test.u('c4'), 'sesion 1 Gabi'),
          test.consentir(test.u('0e'), test.u('c3'), test.u('b4')), test.consentir(test.u('10'), test.u('c4'), test.u('b4')),
          test.disponible_siempre(ARRAY[test.u('b6'), test.u('c3'), test.u('c4'), test.u('c5')]);
END $$;
-- b5: lunes a viernes 09-13, solo presencial (caso 72).
INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
SELECT test.u('b5'), d, 540, 780, 'PRESENCIAL' FROM generate_series(1, 5) d;
INSERT INTO profesionales (usuario_id, especialidad, modalidad) VALUES
  (test.u('b1'), 'Psicologia clinica', 'PRESENCIAL'),
  (test.u('b2'), 'Psiquiatria', 'ONLINE'),
  (test.u('b6'), 'Psicologia clinica', 'MIXTA');
INSERT INTO practicantes (usuario_id, fecha_inicio, fecha_termino_practica) VALUES
  (test.u('c1'), '2026-03-01', '2026-12-31'), (test.u('c3'), '2026-03-01', '2026-12-31'), (test.u('c4'), '2026-03-01', '2026-12-31');
INSERT INTO profesional_tipos_atencion (profesional_id, tipo_atencion_id, estado, revisado_en) VALUES
  (test.u('b1'), test.u('71'), 'APROBADO', now()), (test.u('b1'), test.u('73'), 'APROBADO', now());
INSERT INTO arriendos (profesional_id, periodo_desde, periodo_hasta, monto) VALUES
  (test.u('b1'), '2026-01-01', '2026-02-01', 100000), (test.u('b2'), '2026-01-01', '2026-02-01', 120000);
INSERT INTO boletas (id, cita_id, numero, monto, emisor_nombre, emisor_rut)
SELECT gen_random_uuid(), cita_id, 'T-' || row_number() OVER (ORDER BY cita_id), monto, test.cif('Centro'), test.cif('76.000.000-0') FROM pagos;
INSERT INTO historial_accesos_practicante (practicante_id, actor_id, accion, fecha_expiracion) VALUES
  (test.u('c1'), test.u('a1'), 'OTORGADO', now() + interval '30 days');
-- Agenda futura: Fede con b6 a +3d y +7d; c1 ocupado a +3d (choca con 91);
-- Eva con c3 a +4d.
INSERT INTO citas (id, espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
  (test.u('91'), test.u('e1'), test.u('b6'), test.u('0f'), test.dia(3, 13), test.dia(3, 14)),
  (test.u('92'), test.u('e1'), test.u('b6'), test.u('0f'), test.dia(7, 13), test.dia(7, 14)),
  (test.u('93'), test.u('e2'), test.u('c1'), test.u('0c'), test.dia(3, 13), test.dia(3, 14)),
  (test.u('94'), test.u('e2'), test.u('c3'), test.u('0e'), test.dia(4, 13), test.dia(4, 14));
COMMIT;
UPDATE supervisiones SET hasta = now() WHERE practicante_id = test.u('c4');

\connect :app_url
\set ON_ERROR_STOP 1

\echo 45 Variable de contexto renombrada: ninguna funcion ni politica usa el nombre anterior
DO $$ DECLARE viejo text := 'current_' || 'profesional_id'; BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND (p.prosrc LIKE '%' || viejo || '%' OR p.proname = 'app_' || 'profesional_id')),
    'caso 45: funciones';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE coalesce(qual, '') || coalesce(with_check, '') LIKE '%app_' || 'profesional_id%'), 'caso 45: politicas';
  ASSERT (SELECT prosrc FROM pg_proc WHERE proname = 'app_usuario_id') LIKE '%app.current_usuario_id%', 'caso 45: app_usuario_id';
END $$;

\echo 46 Toda tabla de la app con RLS + FORCE; DELETE solo en tablas no clinicas de perfil y agenda
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
                       AND NOT (c.relrowsecurity AND c.relforcerowsecurity)), 'caso 46: tabla sin RLS';
  ASSERT (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND has_table_privilege('app_user', c.oid, 'DELETE'))
         -- 03a: borradores de evolucion (no son ficha: se descartan) y horarios del centro y de los boxes (B).
         = 'bloqueos_agenda,bloqueos_temporales,borradores_evolucion,disponibilidad_profesional,horario_centro,horarios_espacio,'
           || 'profesional_tipos_atencion,profesional_trayectoria',
    'caso 46: DELETE';
  ASSERT NOT has_table_privilege('app_user', '_prisma_migrations', 'SELECT'), 'caso 46: _prisma_migrations';
END $$;

\echo 47 directorio_interno: equipo activo; contacto solo ADMIN/GESTION; PRACTICANTE solo su supervisor; PACIENTE 42501
DO $$ DECLARE r record; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM directorio_interno()) = (SELECT count(*) FROM usuarios WHERE activo AND rol::text <> 'PACIENTE'),
    'caso 47: ADMIN ve todo el equipo activo';
  ASSERT NOT EXISTS (SELECT 1 FROM directorio_interno() WHERE id IN (test.u('a2'), test.u('c2'))), 'caso 47: sin pacientes ni inactivos';
  SELECT * INTO r FROM directorio_interno() WHERE id = test.u('b1');
  ASSERT r.email = 't-p1@x' AND r.telefono = test.cif('+56911111111'), 'caso 47: ADMIN ve contacto (telefono cifrado)';
  ASSERT r.tipos_atencion = ARRAY['T Psicoterapia adultos'], 'caso 47: solo tipos activos';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT email FROM directorio_interno() WHERE id = test.u('b1')) = 't-p1@x', 'caso 47: GESTION ve contacto';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM directorio_interno()) > 5, 'caso 47: PROFESIONAL ve el equipo';
  ASSERT NOT EXISTS (SELECT 1 FROM directorio_interno() WHERE email IS NOT NULL OR telefono IS NOT NULL), 'caso 47: PROFESIONAL sin contacto';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  ASSERT (SELECT array_agg(id) FROM directorio_interno()) = ARRAY[test.u('b3')], 'caso 47: PRACTICANTE solo su supervisor';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  PERFORM directorio_interno();
  RAISE EXCEPTION 'caso 47: PACIENTE debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 48 mi_equipo_tratante: tratante + profesionales de sus citas; PACIENTE no ve a otros profesionales
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT array_agg(id ORDER BY id) FROM mi_equipo_tratante()) = ARRAY[test.u('b1'), test.u('b2')],
    'caso 48: b2 tratante (caso 43) y b1 de sus citas';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'mi_equipo_tratante') = '{id,nombre}', 'caso 48: columnas';
  ASSERT (SELECT count(*) FROM usuarios) = 1 AND (SELECT count(*) FROM profesionales) = 0, 'caso 48: tablas directas';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM mi_equipo_tratante();
  RAISE EXCEPTION 'caso 48: PROFESIONAL debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 49 perfiles_publicos: sin contexto, solo consentidos; consentir es del propio; sin tarifa general no publica; tarifas del propio
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE profesionales SET nombre_publico = 'Dr. Dos', perfil_publico = true WHERE usuario_id = test.u('b2');
  RAISE EXCEPTION 'caso 49: ADMIN publica perfil ajeno debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    UPDATE profesionales SET nombre_publico = 'Ps. Uno', perfil_publico = true WHERE usuario_id = test.u('b1');
    RAISE EXCEPTION 'caso 49: publicar sin tarifa general debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO tarifas (profesional_id, monto) VALUES (test.u('b2'), 1);
    RAISE EXCEPTION 'caso 49: fijar tarifa ajena debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO tarifas (profesional_id, monto) VALUES (test.u('b1'), 35000);
  INSERT INTO tarifas (profesional_id, tipo_atencion_id, modalidad, monto) VALUES (test.u('b1'), test.u('71'), 'ONLINE', 30000);
  BEGIN
    UPDATE profesionales SET perfil_publico = true WHERE usuario_id = test.u('b1');
    RAISE EXCEPTION 'caso 49: perfil sin nombre publico debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE profesionales SET nombre_publico = 'Ps. Uno', bio = 'Adultos', enfoques = '{Sistemico}', perfil_publico = true
  WHERE usuario_id = test.u('b1');
  ASSERT (SELECT perfil_publico_consentido_en FROM profesionales WHERE usuario_id = test.u('b1')) IS NOT NULL, 'caso 49: fecha de consentimiento';
  BEGIN
    UPDATE tarifas SET monto = 1;
    RAISE EXCEPTION 'caso 49: editar tarifa debio fallar (historial: fila nueva)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  ASSERT app_usuario_id() IS NULL AND app_rol() IS NULL, 'caso 49: sin contexto';
  ASSERT (SELECT array_agg(id) FROM perfiles_publicos()) = ARRAY[test.u('b1')], 'caso 49: solo b1 (consintio)';
  ASSERT (SELECT nombre_publico || '|' || array_to_string(tipos_atencion, ',') FROM perfiles_publicos()) = 'Ps. Uno|T Psicoterapia adultos',
    'caso 49: campos publicos';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'perfiles_publicos')
         -- 03a agrega trayectoria, experiencia, reembolso/convenios, idiomas, cita y reseñas; nunca RUT, banco ni contacto.
         = '{id,nombre_publico,bio,foto_url,especialidad,enfoques,modalidad,tipos_atencion,verificado,titulos_verificados,tarifas,'
           'trayectoria,anios_experiencia,boleta_reembolsable,convenios,idiomas,cita_destacada,calificacion,resenas}',
    'caso 49: sin RUT, datos bancarios ni contacto';
  ASSERT (SELECT tarifas FROM perfiles_publicos())
         = '[{"monto": 35000, "modalidad": null, "tipo_atencion": null}, {"monto": 30000, "modalidad": "ONLINE", "tipo_atencion": "T Psicoterapia adultos"}]'::jsonb,
    'caso 49: tarifas vigentes';
  ASSERT (SELECT count(*) FROM profesionales) = 0, 'caso 49: tabla sin contexto';
END $$;

\echo 50 profesionales por rol: ADMIN 3, GESTION 3, propio 1, sin fila 0, PRACTICANTE 0, PACIENTE 0; nadie crea perfil ajeno
DO $$ BEGIN PERFORM test.ctx('a1', 'ADMIN');       ASSERT (SELECT count(*) FROM profesionales) = 3, 'caso 50: ADMIN'; END $$;
DO $$ BEGIN PERFORM test.ctx('a3', 'GESTION');     ASSERT (SELECT count(*) FROM profesionales) = 3, 'caso 50: GESTION'; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT array_agg(usuario_id) FROM profesionales) = ARRAY[test.u('b2')], 'caso 50: propio';
END $$;
DO $$ BEGIN PERFORM test.ctx('b3', 'PROFESIONAL'); ASSERT (SELECT count(*) FROM profesionales) = 0, 'caso 50: sin fila'; END $$;
DO $$ BEGIN PERFORM test.ctx('c1', 'PRACTICANTE'); ASSERT (SELECT count(*) FROM profesionales) = 0, 'caso 50: PRACTICANTE'; END $$;
DO $$ BEGIN PERFORM test.ctx('a2', 'PACIENTE');    ASSERT (SELECT count(*) FROM profesionales) = 0, 'caso 50: PACIENTE'; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b3', 'PROFESIONAL');
  INSERT INTO profesionales (usuario_id, especialidad, modalidad) VALUES (test.u('b4'), 'x', 'ONLINE');
  RAISE EXCEPTION 'caso 50: PROFESIONAL crea perfil ajeno debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 51 tipos_atencion (B): todos leen; solo ADMIN escribe; nunca DELETE; N:M: el profesional propone (02h), solo ADMIN aprueba, asigna o quita
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM tipos_atencion WHERE id IN (test.u('71'), test.u('72'), test.u('73'))) = 3, 'caso 51: PACIENTE lee';
END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM profesional_tipos_atencion WHERE profesional_id = test.u('b1')) = 2, 'caso 51: lee N:M';
  BEGIN
    INSERT INTO tipos_atencion (nombre) VALUES ('T Nuevo');
    RAISE EXCEPTION 'caso 51: PROFESIONAL crea tipo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- 02h: el profesional propone para si (queda PROPUESTO aunque pida APROBADO); no para otros ni decide.
  INSERT INTO profesional_tipos_atencion (profesional_id, tipo_atencion_id, estado) VALUES (test.u('b1'), test.u('72'), 'APROBADO');
  ASSERT (SELECT estado FROM profesional_tipos_atencion WHERE profesional_id = test.u('b1') AND tipo_atencion_id = test.u('72'))
         = 'PROPUESTO', 'caso 51: la propuesta queda PROPUESTO';
  BEGIN
    INSERT INTO profesional_tipos_atencion (profesional_id, tipo_atencion_id) VALUES (test.u('b2'), test.u('72'));
    RAISE EXCEPTION 'caso 51: PROFESIONAL propone por otro debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE profesional_tipos_atencion SET estado = 'APROBADO' WHERE profesional_id = test.u('b1');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 51: el profesional no aprueba (0 filas)';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT NOT (SELECT 'T Evaluacion' = ANY (tipos_atencion) FROM directorio_interno() WHERE id = test.u('b1')),
    'caso 51: una propuesta no cuenta en el directorio';
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE profesional_tipos_atencion SET estado = 'RECHAZADO' WHERE profesional_id = test.u('b1') AND tipo_atencion_id = test.u('72');
  ASSERT (SELECT revisado_por_id = test.u('a1') AND revisado_en IS NOT NULL FROM profesional_tipos_atencion
          WHERE profesional_id = test.u('b1') AND tipo_atencion_id = test.u('72')), 'caso 51: registra quien decide';
END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO tipos_atencion (nombre) VALUES ('T Pareja');
  UPDATE tipos_atencion SET activo = false WHERE nombre = 'T Pareja';
  INSERT INTO profesional_tipos_atencion (profesional_id, tipo_atencion_id) VALUES (test.u('b2'), test.u('72'));
  DELETE FROM profesional_tipos_atencion WHERE profesional_id = test.u('b2');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'caso 51: ADMIN quita tipo';
  BEGIN
    DELETE FROM tipos_atencion WHERE nombre = 'T Pareja';
    RAISE EXCEPTION 'caso 51: DELETE tipo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 52 boletas por rol: ADMIN 2, GESTION 2, p1 1, p2 1, practicante 0, PACIENTE 1; nadie escribe directo (02h: emitir_boleta)
DO $$ BEGIN PERFORM test.ctx('a1', 'ADMIN');       ASSERT (SELECT count(*) FROM boletas) = 2, 'caso 52: ADMIN'; END $$;
DO $$ BEGIN PERFORM test.ctx('a3', 'GESTION');     ASSERT (SELECT count(*) FROM boletas) = 2, 'caso 52: GESTION'; END $$;
DO $$ BEGIN PERFORM test.ctx('b1', 'PROFESIONAL'); ASSERT (SELECT count(*) FROM boletas) = 1, 'caso 52: p1'; END $$;
DO $$ BEGIN PERFORM test.ctx('b2', 'PROFESIONAL'); ASSERT (SELECT count(*) FROM boletas) = 1, 'caso 52: p2'; END $$;
DO $$ BEGIN PERFORM test.ctx('c1', 'PRACTICANTE'); ASSERT (SELECT count(*) FROM boletas) = 0, 'caso 52: practicante'; END $$;
DO $$ BEGIN PERFORM test.ctx('a2', 'PACIENTE');    ASSERT (SELECT count(*) FROM boletas) = 1, 'caso 52: PACIENTE'; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO boletas (id, cita_id, numero, monto, emisor_nombre, emisor_rut)
  SELECT gen_random_uuid(), cita_id, 'X-1', 1, test.cif('x'), test.cif('x') FROM pagos LIMIT 1;
  RAISE EXCEPTION 'caso 52: PROFESIONAL emite boleta debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO boletas (id, cita_id, numero, monto, emisor_nombre, emisor_rut)
  SELECT gen_random_uuid(), cita_id, 'X-2', 1, test.cif('x'), test.cif('x') FROM pagos LIMIT 1;
  RAISE EXCEPTION 'caso 52: GESTION inserta boleta directo debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 53 arriendos por rol: ADMIN 2, GESTION 2, p1 1, practicante 0, PACIENTE 0; solo gestion escribe
DO $$ BEGIN PERFORM test.ctx('a1', 'ADMIN');       ASSERT (SELECT count(*) FROM arriendos) = 2, 'caso 53: ADMIN'; END $$;
DO $$ BEGIN PERFORM test.ctx('a3', 'GESTION');     ASSERT (SELECT count(*) FROM arriendos) = 2, 'caso 53: GESTION'; END $$;
DO $$ BEGIN PERFORM test.ctx('c1', 'PRACTICANTE'); ASSERT (SELECT count(*) FROM arriendos) = 0, 'caso 53: practicante'; END $$;
DO $$ BEGIN PERFORM test.ctx('a2', 'PACIENTE');    ASSERT (SELECT count(*) FROM arriendos) = 0, 'caso 53: PACIENTE'; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT array_agg(profesional_id) FROM arriendos) = ARRAY[test.u('b1')], 'caso 53: p1 los suyos';
  INSERT INTO arriendos (profesional_id, periodo_desde, periodo_hasta, monto) VALUES (test.u('b1'), '2026-03-01', '2026-04-01', 1);
  RAISE EXCEPTION 'caso 53: PROFESIONAL crea arriendo debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 54 espacios (B): autenticados leen; ADMIN/GESTION escriben; DELETE nunca
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM espacios) = 2, 'caso 54: PACIENTE lee';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO espacios (nombre) VALUES ('T Box X');
  RAISE EXCEPTION 'caso 54: PROFESIONAL crea box debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO espacios (nombre) VALUES ('T Box 3');
  UPDATE espacios SET activo = false WHERE nombre = 'T Box 3';
  DELETE FROM espacios WHERE nombre = 'T Box 3';
  RAISE EXCEPTION 'caso 54: DELETE box debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 55 bloqueos_temporales (A+C): cada uno los suyos; ajenos solo anonimos en ocupacion_espacios
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO bloqueos_temporales (espacio_id, usuario_id, profesional_id, inicio, fin, expira_en) VALUES
    (test.u('e2'), test.u('b1'), test.u('b1'), test.dia(2, 10), test.dia(2, 11), now() + interval '5 minutes');
  BEGIN
    INSERT INTO bloqueos_temporales (espacio_id, usuario_id, profesional_id, inicio, fin, expira_en) VALUES
      (test.u('e2'), test.u('b2'), test.u('b2'), test.dia(2, 12), test.dia(2, 13), now() + interval '5 minutes');
    RAISE EXCEPTION 'caso 55: bloqueo a nombre de otro debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM bloqueos_temporales) = 0, 'caso 55: no ve bloqueo ajeno';
  ASSERT (SELECT array_agg(espacio_id::text || '@' || inicio::text) FROM ocupacion_espacios(test.dia(2, 0), test.dia(3, 0)))
         = ARRAY[test.u('e2')::text || '@' || test.dia(2, 10)::text], 'caso 55: ocupacion incluye el bloqueo';
  DELETE FROM bloqueos_temporales;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 55: no suelta bloqueo ajeno';
END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  DELETE FROM bloqueos_temporales;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'caso 55: suelta el suyo';
END $$;

\echo 56 practicantes por rol: ADMIN 3, propio 1, supervisor vigente 1, otro profesional 0, PACIENTE 0
DO $$ BEGIN PERFORM test.ctx('a1', 'ADMIN');       ASSERT (SELECT count(*) FROM practicantes) = 3, 'caso 56: ADMIN'; END $$;
DO $$ BEGIN PERFORM test.ctx('a3', 'GESTION');     ASSERT (SELECT count(*) FROM practicantes) = 3, 'caso 56: GESTION'; END $$;
DO $$ BEGIN PERFORM test.ctx('c1', 'PRACTICANTE'); ASSERT (SELECT array_agg(usuario_id) FROM practicantes) = ARRAY[test.u('c1')], 'caso 56: propio'; END $$;
DO $$ BEGIN PERFORM test.ctx('b3', 'PROFESIONAL'); ASSERT (SELECT array_agg(usuario_id) FROM practicantes) = ARRAY[test.u('c1')], 'caso 56: supervisor'; END $$;
DO $$ BEGIN PERFORM test.ctx('b1', 'PROFESIONAL'); ASSERT (SELECT count(*) FROM practicantes) = 0, 'caso 56: otro'; END $$;
DO $$ BEGIN PERFORM test.ctx('a2', 'PACIENTE');    ASSERT (SELECT count(*) FROM practicantes) = 0, 'caso 56: PACIENTE'; END $$;

\echo 57 Supervision: sin supervision vigente 0 filas; supervisor sin acceso directo; casos seudonimizados y estructurados; auditoria
DO $$ BEGIN
  PERFORM test.ctx('c4', 'PRACTICANTE');
  ASSERT (SELECT count(*) FROM pacientes) = 0 AND (SELECT count(*) FROM evoluciones) = 0, 'caso 57: c4 sin supervision';
  BEGIN
    PERFORM directorio_interno();
    RAISE EXCEPTION 'caso 57: c4 sin acceso vigente debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ DECLARE v text; r record; e record; BEGIN
  PERFORM test.ctx('b3', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM pacientes WHERE id = test.u('0c')), 'caso 57: supervisor lee paciente';
  ASSERT NOT EXISTS (SELECT 1 FROM fichas_clinicas WHERE id = test.u('fc')), 'caso 57: supervisor lee ficha';
  ASSERT NOT EXISTS (SELECT 1 FROM evoluciones WHERE ficha_clinica_id = test.u('fc')), 'caso 57: supervisor lee evoluciones';
  SELECT * INTO r FROM supervision_casos();
  ASSERT (SELECT count(*) FROM supervision_casos()) = 1 AND r.practicante_id = test.u('c1') AND r.edad_paciente > 18,
    'caso 57: un caso de c1';
  ASSERT (SELECT codigo FROM supervision_casos()) = r.codigo, 'caso 57: codigo estable entre llamadas';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'supervision_casos')
         = '{codigo,practicante_id,edad_paciente,tipo_atencion}', 'caso 57: columnas de casos';
  SELECT * INTO e FROM supervision_evoluciones(r.codigo);
  ASSERT e.notas = test.cif('sesion 1 Caro') AND e.tipo_sesion = 'T Individual' AND e.nivel_riesgo = 'NINGUNO'
         AND e.intervenciones = '{}' AND e.estado_avance IS NULL, format('caso 57: evolucion estructurada %s', e);
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'supervision_evoluciones')
         = '{p_codigo,evolucion_id,autor_id,tipo_sesion,intervenciones,estado_avance,nivel_riesgo,notas,corrige_a_id,creado_en}',
    'caso 57: columnas sin identificadores';
  v := r.codigo;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT v = (SELECT codigo_seudonimo FROM pacientes WHERE id = test.u('0c')), 'caso 57: codigo = pacientes.codigo_seudonimo';
  ASSERT strpos(replace(test.u('0c')::text, '-', ''), lower(substr(v, 3))) = 0
         AND v <> 'C-' || upper(substr(md5(test.u('0c')::text), 1, 10)), 'caso 57: codigo no derivado del id';
  ASSERT (SELECT count(*) FROM accesos_ficha WHERE accion = 'SUPERVISION' AND usuario_id = test.u('b3')) = 4,
    'caso 57: auditoria (3 llamadas a casos + 1 a evoluciones)';
  PERFORM set_config('test.codigo_caro', v, false);
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM supervision_casos()), 'caso 57: no supervisor sin casos';
  ASSERT NOT EXISTS (SELECT 1 FROM supervision_evoluciones(current_setting('test.codigo_caro'))), 'caso 57: no supervisor sin evoluciones';
  ASSERT NOT EXISTS (SELECT 1 FROM supervision_evoluciones('C-NOEXISTE')), 'caso 57: codigo inexistente';
END $$;

\echo 58 supervision_comentarios: comenta el supervisor vigente; lo lee el practicante tratante; ADMIN nunca; append-only
DO $$ BEGIN
  PERFORM test.ctx('b3', 'PROFESIONAL');
  INSERT INTO supervision_comentarios (id, evolucion_id, supervisor_id, texto)
  VALUES (test.u('5c'), test.u('ec'), test.u('b3'), test.cif('Revisar encuadre'));
  BEGIN
    UPDATE supervision_comentarios SET texto = test.cif('x');
    RAISE EXCEPTION 'caso 58: UPDATE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM supervision_comentarios;
    RAISE EXCEPTION 'caso 58: DELETE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM supervision_comentarios) = 0, 'caso 58: otro no lee';
  INSERT INTO supervision_comentarios (id, evolucion_id, supervisor_id, texto) VALUES (gen_random_uuid(), test.u('ec'), test.u('b1'), test.cif('x'));
  RAISE EXCEPTION 'caso 58: no supervisor comenta debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  ASSERT (SELECT texto FROM supervision_comentarios) = test.cif('Revisar encuadre'), 'caso 58: practicante tratante lee';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM supervision_comentarios) = 0, 'caso 58: ADMIN nunca lee';
END $$;

\echo 59 Practicantes solo via derivacion: nadie asigna un paciente directo a un practicante; nadie inserta consentimientos
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['a1:ADMIN', 'a3:GESTION', 'b3:PROFESIONAL'] LOOP
    BEGIN
      PERFORM test.ctx(split_part(r, ':', 1), split_part(r, ':', 2));
      INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id)
      VALUES (gen_random_uuid(), 'Hugo', 'H', '1990-01-01', test.u('c1'));
      RAISE EXCEPTION 'caso 59: % asigna directo debio fallar', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO consentimientos (paciente_id, tipo, practicante_id, supervisor_id, solicitado_por_id, vence_en)
  VALUES (test.u('0a'), 'ATENCION_CON_PRACTICANTE_SUPERVISADO', test.u('c1'), test.u('b3'), test.u('a3'), now() + interval '1 day');
  RAISE EXCEPTION 'caso 59: INSERT directo de consentimiento debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 60 Revocacion: el supervisor no registra; PACIENTE revoca; corte inmediato, citas POR_REPROGRAMAR, bandeja; supervisor deriva de oficio
DO $$ BEGIN
  PERFORM test.ctx('c3', 'PRACTICANTE');
  ASSERT (SELECT count(*) FROM pacientes) = 1 AND (SELECT count(*) FROM evoluciones) = 1, 'caso 60: c3 ve a Eva';
END $$;
DO $$ DECLARE v uuid; BEGIN
  PERFORM test.ctx('a4', 'PACIENTE');
  SELECT id INTO v FROM consentimientos;
  INSERT INTO test.ids VALUES ('cons_eva', v);
  PERFORM test.ctx('b4', 'PROFESIONAL');
  BEGIN
    PERFORM revocar_consentimiento(v, 'PACIENTE', NULL, NULL);
    RAISE EXCEPTION 'caso 60: supervisor revoca debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM revocar_consentimiento(v, 'PACIENTE', NULL, NULL);
    RAISE EXCEPTION 'caso 60: GESTION sin respaldo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a4', 'PACIENTE');
  BEGIN
    PERFORM revocar_consentimiento(v, 'ADULTO_RESPONSABLE', NULL, NULL);
    RAISE EXCEPTION 'caso 60: adulto responsable sin id debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM revocar_consentimiento(v, 'PACIENTE', NULL, NULL);
  ASSERT (SELECT estado FROM consentimientos WHERE id = v) = 'REVOCADO', 'caso 60: REVOCADO';
  BEGIN
    PERFORM revocar_consentimiento(v, 'PACIENTE', NULL, NULL);
    RAISE EXCEPTION 'caso 60: revocar dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c3', 'PRACTICANTE');
  ASSERT (SELECT count(*) FROM pacientes) = 0 AND (SELECT count(*) FROM fichas_clinicas) = 0
         AND (SELECT count(*) FROM evoluciones) = 0, 'caso 60: c3 pierde acceso al instante';
END $$;
DO $$ DECLARE r record; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT estado FROM citas WHERE id = test.u('94')) = 'POR_REPROGRAMAR', 'caso 60: cita futura por reprogramar';
  ASSERT (SELECT motivo FROM pacientes_por_reasignar() WHERE paciente_id = test.u('0e')) = 'CONSENTIMIENTO', 'caso 60: bandeja ADMIN';
  PERFORM test.ctx('b4', 'PROFESIONAL');
  SELECT * INTO r FROM pacientes_por_reasignar() WHERE paciente_id = test.u('0e');
  ASSERT r.motivo = 'CONSENTIMIENTO' AND r.nombre IS NULL AND r.apellido IS NULL AND r.codigo LIKE 'C-%',
    'caso 60: bandeja del supervisor con informacion minima';
  ASSERT (SELECT count(*) FROM pacientes_por_reasignar()) = 1, 'caso 60: supervisor solo ve a pacientes de sus practicantes';
  INSERT INTO test.ids VALUES ('d5', crear_derivacion(gen_random_uuid(), r.ficha_id, test.cif('Revoco consentimiento'), test.u('71'),
                                                      NULL, ARRAY[test.u('b5')]));
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT creada_por_id = test.u('b4') AND profesional_origen_id = test.u('c3') FROM derivaciones WHERE id = test.id('d5')),
    'caso 60: supervisor deriva de oficio en nombre del practicante';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM pacientes_por_reasignar()), 'caso 60: otro profesional no ve la bandeja';
END $$;

\echo 61 historial_accesos_practicante: sin INSERT directo; otorgar exige supervision; nadie se reactiva; visibilidad por rol
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO historial_accesos_practicante (practicante_id, actor_id, accion, fecha_expiracion)
  VALUES (test.u('c3'), test.u('a1'), 'OTORGADO', now() + interval '1 day');
  RAISE EXCEPTION 'caso 61: INSERT directo debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('b4', 'PROFESIONAL');
  PERFORM otorgar_acceso_practicante(test.u('c3'), now() + interval '60 days');
  RAISE EXCEPTION 'caso 61: supervisor otorga debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM otorgar_acceso_practicante(test.u('c4'), now() + interval '60 days');
  RAISE EXCEPTION 'caso 61: otorgar sin supervision debio fallar';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ DECLARE v timestamptz := date_trunc('second', now()) + interval '60 days'; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM otorgar_acceso_practicante(test.u('c3'), v);
  ASSERT (SELECT fecha_expiracion_acceso FROM usuarios WHERE id = test.u('c3')) = v, 'caso 61: usuarios actualizado';
  ASSERT (SELECT count(*) FROM historial_accesos_practicante
          WHERE practicante_id = test.u('c3') AND accion = 'OTORGADO' AND actor_id = test.u('a1') AND fecha_expiracion = v) = 1,
    'caso 61: OTORGADO en la bitacora';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM revocar_acceso_practicante(test.u('c3'), ' ');
    RAISE EXCEPTION 'caso 61: revocar sin motivo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM revocar_acceso_practicante(test.u('c3'), 'Termino anticipado');
  ASSERT NOT (SELECT activo FROM usuarios WHERE id = test.u('c3')), 'caso 61: c3 inactivo';
  ASSERT (SELECT accion::text || '|' || motivo FROM historial_accesos_practicante
          WHERE practicante_id = test.u('c3') ORDER BY created_at DESC LIMIT 1) = 'REVOCADO|Termino anticipado', 'caso 61: REVOCADO';
  ASSERT (SELECT motivo FROM pacientes_por_reasignar() WHERE paciente_id = test.u('0e')) = 'ACCESO_REVOCADO', 'caso 61: Eva por reasignar';
  BEGIN
    PERFORM revocar_acceso_practicante(test.u('c3'), 'otra vez');
    RAISE EXCEPTION 'caso 61: revocar dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  ASSERT (SELECT desactivado_en IS NOT NULL FROM usuarios WHERE id = test.u('c3')), 'caso 61: empieza la gracia';
END $$;
DO $$ BEGIN PERFORM test.ctx('a1', 'ADMIN');       ASSERT (SELECT count(*) FROM historial_accesos_practicante) = 3, 'caso 61: ADMIN todo'; END $$;
DO $$ BEGIN PERFORM test.ctx('a3', 'GESTION');     ASSERT (SELECT count(*) FROM historial_accesos_practicante) = 3, 'caso 61: GESTION todo'; END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  ASSERT (SELECT array_agg(DISTINCT practicante_id) FROM historial_accesos_practicante) = ARRAY[test.u('c1')], 'caso 61: propio';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b3', 'PROFESIONAL');
  ASSERT (SELECT array_agg(DISTINCT practicante_id) FROM historial_accesos_practicante) = ARRAY[test.u('c1')], 'caso 61: supervisor de c1';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM historial_accesos_practicante WHERE practicante_id = test.u('c3')) = 2, 'caso 61: supervisor de c3';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM historial_accesos_practicante) = 0, 'caso 61: otro profesional';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    UPDATE historial_accesos_practicante SET motivo = 'x';
    RAISE EXCEPTION 'caso 61: UPDATE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM historial_accesos_practicante;
    RAISE EXCEPTION 'caso 61: DELETE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 62 procesar_bajas: vencido -> inactivo + EXPIRADO sin actor; dentro de la gracia no vacia; idempotente
DO $$ DECLARE n int; BEGIN
  n := procesar_bajas();
  ASSERT n = 1, format('caso 62: desactivo %s', n);
  n := procesar_bajas();
  ASSERT n = 0, 'caso 62: idempotente';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT NOT (SELECT activo FROM usuarios WHERE id = test.u('c5')), 'caso 62: c5 inactivo';
  ASSERT (SELECT count(*) FROM historial_accesos_practicante
          WHERE practicante_id = test.u('c5') AND accion = 'EXPIRADO' AND actor_id IS NULL) = 1, 'caso 62: un EXPIRADO';
  ASSERT (SELECT count(*) FROM usuarios WHERE id IN (test.u('c2'), test.u('c3'), test.u('c5'))
          AND NOT activo AND cerrada_en IS NULL AND nombre IS NOT NULL AND email IS NOT NULL) = 3,
    'caso 62: inactivas dentro de la gracia, sin vaciar';
END $$;

\echo 63 Bajas: solo ADMIN; de oficio solo con baja; citas posteriores POR_REPROGRAMAR; la baja bloquea la agenda al instante
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM iniciar_baja_profesional(test.u('b6'), test.dia(5, 0));
  RAISE EXCEPTION 'caso 63: PROFESIONAL inicia baja debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM crear_derivacion(gen_random_uuid(), test.u('ff'), test.cif('De oficio'), test.u('71'), NULL, ARRAY[test.u('b5')]);
  RAISE EXCEPTION 'caso 63: derivacion de oficio sin baja debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT iniciar_baja_profesional(test.u('b6'), test.dia(5, 0)) = 1, 'caso 63: una cita por reprogramar';
  ASSERT (SELECT string_agg(estado::text, ',' ORDER BY inicio) FROM citas WHERE id IN (test.u('91'), test.u('92')))
         = 'CONFIRMADA,POR_REPROGRAMAR', 'caso 63: solo la posterior a la fecha efectiva';
  ASSERT (SELECT activo FROM usuarios WHERE id = test.u('b6')), 'caso 63: sigue activo hasta la fecha efectiva';
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e1'), test.u('b6'), test.u('0f'), test.dia(6, 10), test.dia(6, 11));
    RAISE EXCEPTION 'caso 63: agendar despues de la baja debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    DELETE FROM bloqueos_agenda WHERE profesional_id = test.u('b6');
    RAISE EXCEPTION 'caso 63: borrar el bloqueo BAJA debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM iniciar_baja_profesional(test.u('b6'), test.dia(6, 0));
    RAISE EXCEPTION 'caso 63: segunda baja debio fallar';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    PERFORM crear_derivacion(gen_random_uuid(), test.u('ff'), '\x00'::bytea, test.u('71'), NULL, ARRAY[test.u('b5')]);
    RAISE EXCEPTION 'caso 63: motivo sin formato cifrado debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM crear_derivacion(gen_random_uuid(), test.u('ff'), test.cif('Baja'), test.u('73'), NULL, ARRAY[test.u('b5')]);
    RAISE EXCEPTION 'caso 63: tipo inactivo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO test.ids VALUES ('d4', crear_derivacion(gen_random_uuid(), test.u('ff'), test.cif('Baja del tratante'), test.u('71'),
                                                      test.cif('Continuidad'), ARRAY[test.u('c1')]));
  ASSERT (SELECT profesional_origen_id = test.u('b6') AND creada_por_id = test.u('a1') FROM derivaciones WHERE id = test.id('d4')),
    'caso 63: origen = saliente, creada_por = ADMIN';
  ASSERT (SELECT motivo || '|' || derivacion_abierta FROM pacientes_por_reasignar() WHERE paciente_id = test.u('0f')) = 'BAJA|true',
    'caso 63: Fede por reasignar con derivacion abierta';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b6', 'PROFESIONAL');
  DELETE FROM bloqueos_agenda;
  RAISE EXCEPTION 'caso 63: el propio borra su bloqueo BAJA debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  PERFORM pacientes_por_reasignar();
  RAISE EXCEPTION 'caso 63: PACIENTE lista por reasignar debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 64 Practicante acepta: ESPERANDO_CONSENTIMIENTO; responde GESTION con respaldo (no el supervisor); ACEPTADO concreta el traspaso
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM definir_candidatos_derivacion(test.id('d4'), ARRAY[test.u('c4')]);
  RAISE EXCEPTION 'caso 64: practicante sin supervision debio fallar';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ DECLARE r record; BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  SELECT * INTO r FROM oferta_derivacion(test.id('d4'));
  ASSERT r.detalle = test.cif('Continuidad') AND r.citas_en_conflicto = 1, format('caso 64: oferta %s', r);
  PERFORM responder_derivacion(test.id('d4'), true);
END $$;
DO $$ DECLARE c record; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  SELECT * INTO c FROM consentimientos WHERE derivacion_id = test.id('d4');
  ASSERT c.estado = 'SOLICITADO' AND c.practicante_id = test.u('c1') AND c.supervisor_id = test.u('b3')
         AND c.solicitado_por_id = test.u('a1') AND c.vence_en - c.solicitado_en = interval '48 hours',
    format('caso 64: solicitud %s', c);
  INSERT INTO test.ids VALUES ('cons_fede', c.id);
  ASSERT (SELECT profesional_id FROM pacientes WHERE id = test.u('0f')) = test.u('b6'), 'caso 64: sin traspaso antes del consentimiento';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT estado FROM derivaciones WHERE id = test.id('d4')) = 'ESPERANDO_CONSENTIMIENTO', 'caso 64: ESPERANDO_CONSENTIMIENTO';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b3', 'PROFESIONAL');
  PERFORM responder_consentimiento(test.id('cons_fede'), true, 'v2', 'PACIENTE', NULL, 'doc-1');
  RAISE EXCEPTION 'caso 64: supervisor registra debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM responder_consentimiento(test.id('cons_fede'), true, 'v2', 'PACIENTE', NULL, NULL);
    RAISE EXCEPTION 'caso 64: GESTION sin respaldo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM responder_consentimiento(test.id('cons_fede'), true, 'v2', 'PACIENTE', NULL, 'escaneo-firma-fede.pdf');
  BEGIN
    PERFORM responder_consentimiento(test.id('cons_fede'), true, 'v2', 'PACIENTE', NULL, 'otra');
    RAISE EXCEPTION 'caso 64: responder dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  ASSERT EXISTS (SELECT 1 FROM pacientes WHERE id = test.u('0f') AND tipo_atencion_id = test.u('71')), 'caso 64: c1 tratante de Fede';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT estado FROM derivaciones WHERE id = test.id('d4')) = 'ACEPTADA', 'caso 64: ACEPTADA';
  ASSERT (SELECT string_agg(profesional_id::text || ':' || estado::text, ',' ORDER BY inicio) FROM citas
          WHERE id IN (test.u('91'), test.u('92')))
         = test.u('c1')::text || ':POR_REPROGRAMAR,' || test.u('c1')::text || ':CONFIRMADA',
    'caso 64: +3d choca con c1 (por reprogramar), +7d se confirma';
  ASSERT NOT EXISTS (SELECT 1 FROM pacientes_por_reasignar() WHERE paciente_id = test.u('0f')), 'caso 64: Fede ya no por reasignar';
END $$;

\connect :owner_url
\set ON_ERROR_STOP 1
-- Simula que llego la fecha efectiva de la baja de b6.
UPDATE bajas SET fecha_efectiva = now() - interval '1 minute' WHERE usuario_id = test.u('b6');
\connect :app_url
\set ON_ERROR_STOP 1

\echo 65 procesar_bajas en la fecha efectiva desactiva y cierra la cuenta; idempotente
DO $$ DECLARE n int; BEGIN
  n := procesar_bajas();
  ASSERT n = 1, format('caso 65: desactivo %s', n);
  ASSERT procesar_bajas() = 0, 'caso 65: idempotente';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT NOT activo AND cerrada_en IS NOT NULL AND nombre IS NULL FROM usuarios WHERE id = test.u('b6')), 'caso 65: b6 cerrada';
  ASSERT (SELECT procesada_en IS NOT NULL FROM bajas WHERE usuario_id = test.u('b6')), 'caso 65: procesada';
  ASSERT NOT EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = test.u('b6')), 'caso 65: perfil borrado';
END $$;

\echo 66 Derivaciones: origen no cancela PENDIENTE; ADMIN si; reintegro como fila nueva al final
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  PERFORM cancelar_derivacion(test.id('d3'), 'x');
  RAISE EXCEPTION 'caso 66: origen cancela PENDIENTE debio fallar';
EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END $$;
DO $$ BEGIN PERFORM test.ctx('b3', 'PROFESIONAL'); PERFORM responder_derivacion(test.id('d3'), false); END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM reintegrar_candidato(test.id('d3'), test.u('b3'));
  RAISE EXCEPTION 'caso 66: PROFESIONAL reintegra debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM reintegrar_candidato(test.id('d3'), test.u('b4'));
    RAISE EXCEPTION 'caso 66: reintegrar un pendiente debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM reintegrar_candidato(test.id('d3'), test.u('b3'));
  ASSERT (SELECT string_agg(estado::text, ',' ORDER BY orden) FROM derivacion_candidatos
          WHERE derivacion_id = test.id('d3') AND profesional_id = test.u('b3')) = 'RECHAZADA,EN_ESPERA', 'caso 66: fila nueva';
  ASSERT (SELECT profesional_id FROM derivacion_candidatos WHERE derivacion_id = test.id('d3') ORDER BY orden DESC LIMIT 1) = test.u('b3'),
    'caso 66: al final';
  PERFORM definir_candidatos_derivacion(test.id('d3'), ARRAY[test.u('b4'), test.u('b3')]);
  ASSERT (SELECT string_agg(estado::text, ',' ORDER BY orden) FROM derivacion_candidatos WHERE derivacion_id = test.id('d3'))
         = 'RECHAZADA,OFRECIDA,EN_ESPERA', 'caso 66: definir respeta la historia';
  PERFORM cancelar_derivacion(test.id('d3'), 'Paciente desiste');
  ASSERT (SELECT estado FROM derivaciones WHERE id = test.id('d3')) = 'CANCELADA', 'caso 66: ADMIN cancela PENDIENTE';
  ASSERT NOT EXISTS (SELECT 1 FROM derivacion_candidatos WHERE derivacion_id = test.id('d3') AND estado IN ('EN_ESPERA', 'OFRECIDA')),
    'caso 66: sin pendientes';
END $$;

-- =============================================================================
-- 01e
-- =============================================================================

\echo 68 Llaves: app_user no lee tablas de llaves; llaves_vigentes sin la envoltura de recuperacion; eventos solo de verificacion
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['llaves_datos', 'custodios_llave', 'eventos_llaves'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM %I', t);
      RAISE EXCEPTION 'caso 68: app_user lee % debio fallar', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  ASSERT (SELECT count(*) FROM llaves_vigentes()) = 4 AND (SELECT count(*) FROM llaves_vigentes() WHERE activa) = 4,
    'caso 68: 4 DEK aprovisionadas y activas, sin contexto';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'llaves_vigentes')
         = '{id,categoria,version,activa,dek_por_kek,huella_kek,canario}', 'caso 68: sin dek_por_recuperacion';
  PERFORM registrar_evento_llaves('VERIFICACION', 'canarios OK al arrancar');
  BEGIN
    PERFORM registrar_evento_llaves('ROTACION', 'x');
    RAISE EXCEPTION 'caso 68: la API registra ROTACION debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id, rut, rut_hmac) VALUES
    (gen_random_uuid(), 'Juan', 'Uno', '1980-01-01', test.u('b1'), test.cif('12345678K'), sha256('12345678K'));
  BEGIN
    INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id, rut, rut_hmac) VALUES
      (gen_random_uuid(), 'Juan', 'Duplicado', '1980-01-01', test.u('b1'), test.cif('12.345.678-k'), sha256('12345678K'));
    RAISE EXCEPTION 'caso 68: RUT duplicado (mismo indice ciego) debio fallar';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id, rut, rut_hmac) VALUES
      (gen_random_uuid(), 'Juan', 'Plano', '1980-01-01', test.u('b1'), convert_to('12.345.678-K', 'UTF8'), sha256('x'));
    RAISE EXCEPTION 'caso 68: RUT en texto plano debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

\echo 69 Reingreso: email liberado; cuenta nueva sin herencia; cuenta cerrada inmutable
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES (test.u('b7'), 't-p6@x', 'h', 'Prof 6 (vuelve)', 'PROFESIONAL');
  BEGIN
    UPDATE usuarios SET nombre = 'Prof 6' WHERE id = test.u('b6');
    RAISE EXCEPTION 'caso 69: modificar cuenta cerrada debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b7', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM pacientes) = 0 AND (SELECT count(*) FROM evoluciones) = 0
         AND (SELECT count(*) FROM derivaciones) = 0 AND (SELECT count(*) FROM citas) = 0, 'caso 69: cuenta nueva no hereda nada';
  ASSERT NOT EXISTS (SELECT 1 FROM credenciales_login('t-p6@x') WHERE id = test.u('b6')), 'caso 69: login no llega a la cuenta cerrada';
END $$;

\echo 70 Perfil: trayectoria la edita el propio y solo ADMIN verifica; datos privados solo propio y ADMIN/GESTION; publico solo lo verificado
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO profesional_trayectoria (id, profesional_id, tipo, titulo, institucion, anio, registro_superintendencia, verificado)
  VALUES (test.u('7a'), test.u('b1'), 'TITULO', 'T Psicologo', 'U. de Prueba', 2015, '123456', true);
  ASSERT NOT (SELECT verificado FROM profesional_trayectoria WHERE id = test.u('7a')), 'caso 70: el propio no se autoverifica';
  BEGIN
    UPDATE profesional_trayectoria SET verificado = true WHERE id = test.u('7a');
    RAISE EXCEPTION 'caso 70: el propio verifica debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO profesional_datos_privados (usuario_id, rut, rut_hmac, banco, tipo_cuenta, numero_cuenta, titular)
  VALUES (test.u('b1'), test.cif('11.111.111-1'), sha256('111111111'), test.cif('Banco Prueba'), test.cif('Corriente'),
          test.cif('000123'), test.cif('Prof Uno'));
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM profesional_trayectoria) = 0 AND (SELECT count(*) FROM profesional_datos_privados) = 0,
    'caso 70: otro profesional no ve trayectoria ni datos privados ajenos';
  INSERT INTO profesional_datos_privados (usuario_id, banco) VALUES (test.u('b1'), test.cif('x'));
  RAISE EXCEPTION 'caso 70: datos privados ajenos debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM profesional_trayectoria) = 1 AND (SELECT count(*) FROM profesional_datos_privados) = 1,
    'caso 70: GESTION lee';
  UPDATE profesional_trayectoria SET verificado = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 70: GESTION no verifica';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    UPDATE profesional_trayectoria SET titulo = 'Otro' WHERE id = test.u('7a');
    RAISE EXCEPTION 'caso 70: ADMIN edita trayectoria debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE profesional_trayectoria SET verificado = true WHERE id = test.u('7a');
  ASSERT (SELECT verificado_por_id = test.u('a1') AND verificado_en IS NOT NULL FROM profesional_trayectoria WHERE id = test.u('7a')),
    'caso 70: ADMIN verifica';
END $$;
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM perfiles_publicos() WHERE id = test.u('b1');
  ASSERT r.verificado AND r.titulos_verificados = ARRAY['T Psicologo'], 'caso 70: publico con titulo verificado';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  UPDATE profesional_trayectoria SET institucion = 'U. Corregida' WHERE id = test.u('7a');
  ASSERT NOT (SELECT verificado FROM profesional_trayectoria WHERE id = test.u('7a')), 'caso 70: editar quita la verificacion';
END $$;
DO $$ BEGIN
  ASSERT NOT (SELECT verificado FROM perfiles_publicos() WHERE id = test.u('b1')), 'caso 70: publico ya no verificado';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM profesional_trayectoria) = 0 AND (SELECT count(*) FROM profesional_datos_privados) = 0,
    'caso 70: PACIENTE no lee';
END $$;

\echo 71 Cobro: datos_pago_profesional solo con cobro directo, cita propia CONFIRMADA y con saldo (02h); auditado
DO $$ DECLARE v_sin_pago uuid; v_con_pago uuid; v_ajena uuid; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  -- 02h: "pago pendiente" = saldo > 0. Cita nueva de b1 (tarifa general 35000 desde el caso 49).
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b1'), test.u('0a'), test.dia(30, 10), test.dia(30, 11)) RETURNING id INTO v_sin_pago;
  ASSERT (SELECT monto FROM citas WHERE id = v_sin_pago) = 35000, 'caso 71: monto fijado con la tarifa vigente';
  SELECT id INTO v_con_pago FROM citas WHERE profesional_id = test.u('b1') AND inicio = '2025-11-02 10:00-03' AND estado = 'CONFIRMADA';
  SELECT id INTO v_ajena FROM citas WHERE paciente_id = test.u('0b') LIMIT 1;
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT NOT EXISTS (SELECT 1 FROM datos_pago_profesional(v_sin_pago)), 'caso 71: modelo CENTRO';
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET modelo_cobro = 'MIXTO';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT NOT EXISTS (SELECT 1 FROM datos_pago_profesional(v_sin_pago)), 'caso 71: MIXTO sin adhesion del profesional';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  UPDATE profesionales SET cobro_directo = true WHERE usuario_id = test.u('b1');
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT banco FROM datos_pago_profesional(v_sin_pago)) = test.cif('Banco Prueba'), 'caso 71: datos cifrados para la API';
  ASSERT NOT EXISTS (SELECT 1 FROM datos_pago_profesional(v_con_pago)), 'caso 71: cita ya pagada';
  ASSERT NOT EXISTS (SELECT 1 FROM datos_pago_profesional(v_ajena)), 'caso 71: cita ajena';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM accesos_ficha WHERE accion = 'DATOS_PAGO' AND usuario_id = test.u('a2')) = 1, 'caso 71: auditado';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM datos_pago_profesional(v_sin_pago);
  RAISE EXCEPTION 'caso 71: PROFESIONAL debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 72 Agenda por modalidad: box solo presencial; online choca por profesional y no por box; disponibilidad y bloqueos; huecos publicos sin motivos
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e1'), 'ONLINE', test.u('b1'), test.u('0a'), test.dia(10, 10), test.dia(10, 11));
    RAISE EXCEPTION 'caso 72: online con box debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      (NULL, 'PRESENCIAL', test.u('b1'), test.u('0a'), test.dia(10, 10), test.dia(10, 11));
    RAISE EXCEPTION 'caso 72: presencial sin box debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    (NULL, 'ONLINE', test.u('b1'), test.u('0a'), test.dia(10, 10), test.dia(10, 11)),
    (test.u('e1'), 'PRESENCIAL', test.u('b2'), test.u('0b'), test.dia(10, 10), test.dia(10, 11)),
    (NULL, 'ONLINE', test.u('b4'), test.u('0a'), test.dia(10, 10), test.dia(10, 11));
  BEGIN
    INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e2'), 'PRESENCIAL', test.u('b1'), test.u('0a'), test.dia(10, 10), test.dia(10, 11));
    RAISE EXCEPTION 'caso 72: presencial que choca con la online del mismo profesional debio fallar';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  -- b5: lunes a viernes 09-13 presencial.
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e1'), test.u('b5'), test.u('12'), test.lunes(0, 10), test.lunes(0, 11));
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e1'), test.u('b5'), test.u('12'), test.lunes(0, 12.5), test.lunes(0, 13.5));
    RAISE EXCEPTION 'caso 72: fuera de horario debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e1'), test.u('b5'), test.u('12'), test.lunes(5, 10), test.lunes(5, 11));
    RAISE EXCEPTION 'caso 72: sabado debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      (NULL, 'ONLINE', test.u('b5'), test.u('12'), test.lunes(0, 11), test.lunes(0, 12));
    RAISE EXCEPTION 'caso 72: online sin disponibilidad online debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- GESTION edita la disponibilidad de otro: sabado online 10-12.
  INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
  VALUES (test.u('b5'), 6, 600, 720, 'ONLINE');
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b5', 'PROFESIONAL');
  INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo) VALUES (test.u('b5'), test.lunes(1, 0), test.lunes(2, 0), 'VACACIONES');
  BEGIN
    INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo) VALUES (test.u('b5'), test.lunes(3, 0), test.lunes(4, 0), 'BAJA');
    RAISE EXCEPTION 'caso 72: crear bloqueo BAJA a mano debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e1'), test.u('b5'), test.u('12'), test.lunes(1, 10), test.lunes(1, 11));
  RAISE EXCEPTION 'caso 72: cita en vacaciones debio fallar';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM bloqueos_agenda) = 0 AND (SELECT count(*) FROM disponibilidad_profesional WHERE profesional_id = test.u('b5')) = 0,
    'caso 72: agenda ajena no visible';
  BEGIN
    INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
    VALUES (test.u('b5'), 7, 600, 720, 'ONLINE');
    RAISE EXCEPTION 'caso 72: editar disponibilidad ajena debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT array_agg(modalidad::text || ' ' || to_char(inicio AT TIME ZONE 'America/Santiago', 'ID HH24:MI') || '-'
                           || to_char(fin AT TIME ZONE 'America/Santiago', 'HH24:MI') ORDER BY inicio)
          FROM disponibilidad_publica(test.u('b5'), test.lunes(0, 0), test.lunes(7, 0)))
         = ARRAY['PRESENCIAL 1 09:00-10:00', 'PRESENCIAL 1 11:00-13:00', 'PRESENCIAL 3 09:00-13:00', 'PRESENCIAL 4 09:00-13:00',
                 'PRESENCIAL 5 09:00-13:00', 'ONLINE 6 10:00-12:00'], 'caso 72: huecos (sin la cita del lunes ni las vacaciones del martes)';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'disponibilidad_publica')
         = '{p_profesional_id,desde,hasta,modalidad,inicio,fin}', 'caso 72: sin motivos';
  BEGIN
    PERFORM disponibilidad_publica(test.u('b5'), now(), now() + interval '90 days');
    RAISE EXCEPTION 'caso 72: rango largo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO bloqueos_temporales (modalidad, usuario_id, profesional_id, inicio, fin, expira_en) VALUES
    ('ONLINE', test.u('b1'), test.u('b1'), test.dia(11, 10), test.dia(11, 11), now() + interval '5 minutes');
  ASSERT NOT EXISTS (SELECT 1 FROM ocupacion_espacios(test.dia(11, 0), test.dia(12, 0))), 'caso 72: soft-lock online no ocupa box';
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b1'), test.dia(11, 10), test.dia(11, 11))),
    'caso 72: soft-lock retiene al profesional';
END $$;
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b5'), test.lunes(0, 0), test.lunes(7, 0))),
    'caso 72: sin contexto solo perfiles publicos';
  ASSERT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b1'), test.dia(12, 0), test.dia(13, 0))),
    'caso 72: perfil publico visible sin contexto';
END $$;

\echo 73 Consentimiento de menor: la bandeja del supervisor; propone a su practicante; responde el adulto responsable
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  INSERT INTO test.ids VALUES ('d6', crear_derivacion(gen_random_uuid(), test.u('fb'), test.cif('Duelo infantil'), test.u('71'), NULL, '{}'));
END $$;
DO $$ DECLARE r record; BEGIN
  PERFORM test.ctx('b3', 'PROFESIONAL');
  SELECT * INTO r FROM derivaciones_pendientes() WHERE derivacion_id = test.id('d6');
  ASSERT r.estado = 'SIN_ASIGNAR' AND r.motivo = test.cif('Duelo infantil') AND r.edad_paciente < 18 AND r.tipo_atencion = 'T Psicoterapia adultos',
    format('caso 73: bandeja %s', r);
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'derivaciones_pendientes')
         = '{derivacion_id,estado,motivo,detalle,tipo_atencion,edad_paciente}', 'caso 73: solo informacion de oferta';
  PERFORM proponer_practicante(test.id('d6'), test.u('c1'));
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM derivaciones_pendientes();
    RAISE EXCEPTION 'caso 73: no supervisor ve la bandeja debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM proponer_practicante(test.id('d6'), test.u('c1'));
  RAISE EXCEPTION 'caso 73: no supervisor propone debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN PERFORM test.ctx('c1', 'PRACTICANTE'); PERFORM responder_derivacion(test.id('d6'), true); END $$;
DO $$ DECLARE v uuid; v_mama uuid; v_pareja uuid; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  SELECT id INTO v FROM consentimientos WHERE derivacion_id = test.id('d6');
  ASSERT (SELECT solicitado_por_id FROM consentimientos WHERE id = v) = test.u('b3'), 'caso 73: lo solicita el supervisor';
  SELECT id INTO v_mama FROM adultos_responsables WHERE paciente_id = test.u('0b');
  SELECT id INTO v_pareja FROM adultos_responsables WHERE paciente_id = test.u('0a');
  BEGIN
    PERFORM responder_consentimiento(v, true, 'v2', 'PACIENTE', NULL, 'doc');
    RAISE EXCEPTION 'caso 73: menor responde solo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM responder_consentimiento(v, true, 'v2', 'ADULTO_RESPONSABLE', v_pareja, 'doc');
    RAISE EXCEPTION 'caso 73: adulto de otro paciente debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM responder_consentimiento(v, true, 'v2', 'ADULTO_RESPONSABLE', v_mama, 'firma-mama.pdf');
  ASSERT (SELECT profesional_id FROM pacientes WHERE id = test.u('0b')) = test.u('c1'), 'caso 73: traspaso al practicante';
END $$;

\echo 74 Consentimiento RECHAZADO: el practicante queda RECHAZADO_POR_PACIENTE y la oferta pasa al siguiente
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO test.ids VALUES ('d7', crear_derivacion(gen_random_uuid(), test.u('fd'), test.cif('Tratante expiro'), test.u('71'), NULL,
                                                      ARRAY[test.u('c1'), test.u('b5')]));
END $$;
DO $$ BEGIN PERFORM test.ctx('c1', 'PRACTICANTE'); PERFORM responder_derivacion(test.id('d7'), true); END $$;
DO $$ DECLARE v uuid; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  SELECT id INTO v FROM consentimientos WHERE derivacion_id = test.id('d7');
  PERFORM responder_consentimiento(v, false, NULL, 'PACIENTE', NULL, 'llamada-registrada-dani');
  ASSERT (SELECT estado FROM consentimientos WHERE id = v) = 'RECHAZADO', 'caso 74: RECHAZADO';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT string_agg(estado::text, ',' ORDER BY orden) FROM derivacion_candidatos WHERE derivacion_id = test.id('d7'))
         = 'RECHAZADO_POR_PACIENTE,OFRECIDA', 'caso 74: oferta al siguiente';
  ASSERT (SELECT estado FROM derivaciones WHERE id = test.id('d7')) = 'PENDIENTE', 'caso 74: vuelve a PENDIENTE';
  ASSERT (SELECT profesional_id FROM pacientes WHERE id = test.u('0d')) = test.u('c2'), 'caso 74: sin traspaso';
END $$;

\echo 75 Consentimiento vencido a las 48h: VENCIDO, candidato RECHAZADO_POR_PACIENTE, siguiente (o SIN_ASIGNAR)
DO $$ BEGIN
  PERFORM test.ctx('b5', 'PROFESIONAL');
  INSERT INTO test.ids VALUES ('d8', crear_derivacion(gen_random_uuid(), test.u('f2'), test.cif('Ansiedad'), test.u('71'), NULL, '{}'));
END $$;
DO $$ BEGIN PERFORM test.ctx('b3', 'PROFESIONAL'); PERFORM proponer_practicante(test.id('d8'), test.u('c1')); END $$;
DO $$ BEGIN PERFORM test.ctx('c1', 'PRACTICANTE'); PERFORM responder_derivacion(test.id('d8'), true); END $$;
\connect :owner_url
\set ON_ERROR_STOP 1
-- Simula que pasaron 49h desde la solicitud.
UPDATE consentimientos SET solicitado_en = now() - interval '49 hours', vence_en = now() - interval '1 hour'
WHERE derivacion_id = test.id('d8');
\connect :app_url
\set ON_ERROR_STOP 1
DO $$ DECLARE v uuid; BEGIN
  ASSERT expirar_ofertas_derivacion() = 1, 'caso 75: un vencido';
  ASSERT expirar_ofertas_derivacion() = 0, 'caso 75: idempotente';
  PERFORM test.ctx('a1', 'ADMIN');
  SELECT id INTO v FROM consentimientos WHERE derivacion_id = test.id('d8');
  ASSERT (SELECT estado FROM consentimientos WHERE id = v) = 'VENCIDO', 'caso 75: VENCIDO';
  ASSERT (SELECT estado FROM derivacion_candidatos WHERE derivacion_id = test.id('d8')) = 'RECHAZADO_POR_PACIENTE', 'caso 75: candidato';
  ASSERT (SELECT estado FROM derivaciones WHERE id = test.id('d8')) = 'SIN_ASIGNAR', 'caso 75: sin mas candidatos';
  PERFORM test.ctx('a3', 'GESTION');
  PERFORM responder_consentimiento(v, true, 'v2', 'PACIENTE', NULL, 'tarde');
  RAISE EXCEPTION 'caso 75: responder vencido debio fallar';
EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END $$;

\echo 76 Cambio de supervisor: sin hueco; consentimientos vigentes; avisos; comentarios anteriores quedan; oposicion revoca; menor via adulto
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM cambiar_supervisor(test.u('c1'), test.u('b4'));
  RAISE EXCEPTION 'caso 76: PROFESIONAL cambia supervisor debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO supervisiones (practicante_id, supervisor_id) VALUES (test.u('c1'), test.u('b4'));
  RAISE EXCEPTION 'caso 76: INSERT directo de supervision debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM cambiar_supervisor(test.u('c1'), test.u('c4'));
    RAISE EXCEPTION 'caso 76: supervisor que no es PROFESIONAL debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM cambiar_supervisor(test.u('c1'), test.u('b3'));
    RAISE EXCEPTION 'caso 76: mismo supervisor debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  n := cambiar_supervisor(test.u('c1'), test.u('b4'));
  ASSERT n = 3, format('caso 76: un aviso por paciente con consentimiento (Beto, Caro, Fede), hubo %s', n);
  ASSERT supervisor_vigente(test.u('c1')) = test.u('b4'), 'caso 76: nuevo supervisor vigente';
  ASSERT (SELECT count(*) FROM supervisiones WHERE practicante_id = test.u('c1') AND (hasta IS NULL OR hasta > now())) = 1,
    'caso 76: una sola supervision abierta';
  ASSERT (SELECT hasta FROM supervisiones WHERE practicante_id = test.u('c1') AND supervisor_id = test.u('b3'))
         = (SELECT desde FROM supervisiones WHERE practicante_id = test.u('c1') AND supervisor_id = test.u('b4')),
    'caso 76: sin hueco entre supervisiones';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  ASSERT (SELECT count(*) FROM pacientes) = 3, 'caso 76: los consentimientos siguen vigentes (el practicante sigue atendiendo)';
  ASSERT (SELECT count(*) FROM avisos_consentimiento) = 3, 'caso 76: el practicante ve los avisos';
  ASSERT (SELECT texto FROM supervision_comentarios) = test.cif('Revisar encuadre'),
    'caso 76: los comentarios del supervisor anterior quedan en el registro';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b3', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM supervision_comentarios) = 0 AND NOT EXISTS (SELECT 1 FROM supervision_casos()),
    'caso 76: el supervisor anterior ya no accede';
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM supervision_casos() WHERE practicante_id = test.u('c1')) = 3,
    'caso 76: el nuevo supervisor accede (seudonimizado) desde que asume';
END $$;
DO $$ DECLARE v uuid; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  SELECT a.id INTO v FROM avisos_consentimiento a JOIN consentimientos c ON c.id = a.consentimiento_id
  WHERE c.paciente_id = test.u('0c');
  ASSERT (SELECT respuesta FROM avisos_consentimiento WHERE id = v) = 'SIN_RESPUESTA'
         AND (SELECT vence_en - notificado_en FROM avisos_consentimiento WHERE id = v) = interval '48 hours', 'caso 76: aviso con plazo';
  PERFORM test.ctx('b4', 'PROFESIONAL');
  BEGIN
    PERFORM responder_aviso_consentimiento(v, 'OPOSICION', 'PACIENTE', NULL, 'x');
    RAISE EXCEPTION 'caso 76: el supervisor responde por el paciente debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  PERFORM responder_aviso_consentimiento(v, 'OPOSICION', 'PACIENTE', NULL, 'llamada-caro.pdf');
  ASSERT (SELECT c.estado FROM consentimientos c JOIN avisos_consentimiento a ON a.consentimiento_id = c.id WHERE a.id = v) = 'REVOCADO',
    'caso 76: oposicion revoca';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  ASSERT NOT EXISTS (SELECT 1 FROM pacientes WHERE id = test.u('0c')), 'caso 76: oposicion corta el acceso';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT estado FROM citas WHERE id = test.u('93')) = 'POR_REPROGRAMAR', 'caso 76: citas futuras por reprogramar';
  ASSERT (SELECT motivo FROM pacientes_por_reasignar() WHERE paciente_id = test.u('0c')) = 'CONSENTIMIENTO', 'caso 76: bandeja';
END $$;
DO $$ DECLARE v uuid; v_mama uuid; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  SELECT a.id INTO v FROM avisos_consentimiento a JOIN consentimientos c ON c.id = a.consentimiento_id
  WHERE c.paciente_id = test.u('0b');
  SELECT id INTO v_mama FROM adultos_responsables WHERE paciente_id = test.u('0b');
  BEGIN
    PERFORM responder_aviso_consentimiento(v, 'CONFORME', 'PACIENTE', NULL, 'doc');
    RAISE EXCEPTION 'caso 76: menor responde solo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM responder_aviso_consentimiento(v, 'CONFORME', 'ADULTO_RESPONSABLE', v_mama, 'firma-mama-2.pdf');
  ASSERT (SELECT respuesta::text || '|' || respondido_por_id::text FROM avisos_consentimiento WHERE id = v)
         = 'CONFORME|' || test.u('a3')::text, 'caso 76: conforme explicito';
  BEGIN
    PERFORM responder_aviso_consentimiento(v, 'OPOSICION', 'ADULTO_RESPONSABLE', v_mama, 'doc');
    RAISE EXCEPTION 'caso 76: responder dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;

\connect :owner_url
\set ON_ERROR_STOP 1
-- Simula que vencio el plazo del aviso de Fede (el trigger append-only no
-- deja cambiar fechas ni al dueño: se desactiva solo para el test).
ALTER TABLE avisos_consentimiento DISABLE TRIGGER avisos_consentimiento_append_only;
UPDATE avisos_consentimiento a SET notificado_en = now() - interval '49 hours', vence_en = now() - interval '1 hour'
FROM consentimientos c WHERE c.id = a.consentimiento_id AND c.paciente_id = test.u('0f');
ALTER TABLE avisos_consentimiento ENABLE TRIGGER avisos_consentimiento_append_only;
\connect :app_url
\set ON_ERROR_STOP 1

DO $$ DECLARE v uuid; BEGIN
  ASSERT cerrar_avisos_vencidos() = 1, 'caso 76: un aviso vencido';
  ASSERT cerrar_avisos_vencidos() = 0, 'caso 76: idempotente';
  PERFORM test.ctx('a3', 'GESTION');
  SELECT a.id INTO v FROM avisos_consentimiento a JOIN consentimientos c ON c.id = a.consentimiento_id
  WHERE c.paciente_id = test.u('0f');
  ASSERT (SELECT respuesta = 'CONFORME' AND respondido_por_id IS NULL FROM avisos_consentimiento WHERE id = v),
    'caso 76: sin respuesta al vencer = conforme tacito';
  ASSERT (SELECT c.estado FROM consentimientos c JOIN avisos_consentimiento a ON a.consentimiento_id = c.id WHERE a.id = v) = 'ACEPTADO',
    'caso 76: el consentimiento sigue';
  PERFORM responder_aviso_consentimiento(v, 'OPOSICION', 'PACIENTE', NULL, 'tarde');
  RAISE EXCEPTION 'caso 76: responder aviso vencido debio fallar';
EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END $$;

\echo 77 Catalogos clinicos (B) sin DELETE; evolucion estructurada: intervenciones solo en la misma transaccion; estado de avance opcional
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  INSERT INTO intervenciones (nombre) VALUES ('T No');
  RAISE EXCEPTION 'caso 77: PROFESIONAL crea intervencion debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO intervenciones (id, nombre) VALUES (test.u('81'), 'T Intervencion'), (test.u('83'), 'T Otra');
  INSERT INTO estados_avance (id, nombre) VALUES (test.u('82'), 'T Estado');
  BEGIN
    DELETE FROM intervenciones WHERE id = test.u('83');
    RAISE EXCEPTION 'caso 77: DELETE intervencion debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM estados_avance WHERE id = test.u('82');
    RAISE EXCEPTION 'caso 77: DELETE estado de avance debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro,
                           tipo_sesion_id, estado_avance_id, nivel_riesgo)
  VALUES (test.u('e7'), test.u('ff'), test.u('c1'), test.cif('sesion estructurada'), test.cif('Practicante'), test.cif('rut'),
          test.cif('sin registro'), test.u('61'), test.u('82'), 'MEDIO');
  INSERT INTO evolucion_intervenciones (evolucion_id, intervencion_id) VALUES (test.u('e7'), test.u('81'));
  PERFORM test.evo(test.u('ff'), test.u('c1'), 'sin estado de avance');
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  INSERT INTO evolucion_intervenciones (evolucion_id, intervencion_id) VALUES (test.u('e7'), test.u('83'));
  RAISE EXCEPTION 'caso 77: agregar intervencion despues debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ DECLARE v text; e record; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  SELECT codigo_seudonimo INTO v FROM pacientes WHERE id = test.u('0f');
  PERFORM test.ctx('b4', 'PROFESIONAL');
  SELECT * INTO e FROM supervision_evoluciones(v) WHERE evolucion_id = test.u('e7');
  ASSERT e.tipo_sesion = 'T Familiar' AND e.nivel_riesgo = 'MEDIO' AND e.estado_avance = 'T Estado'
         AND e.intervenciones = ARRAY['T Intervencion'] AND e.notas = test.cif('sesion estructurada'),
    format('caso 77: supervision ve campos estructurados %s', e);
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM evolucion_intervenciones) = 0, 'caso 77: ADMIN no ve intervenciones clinicas';
END $$;

-- =============================================================================
-- 01f. Datos (dueño): otro ADMIN y otro GESTION; el ADMIN del seed se
-- desactiva para que a1 sea el ultimo ADMIN activo al final; Olga con ficha
-- de 2008 (ultima atencion 2009) para retencion.
-- =============================================================================
\connect :owner_url
\set ON_ERROR_STOP 1
INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES
  (test.u('a5'), 't-admin2@x', 'h', 'Admin 2', 'ADMIN'),
  (test.u('a6'), 't-g2@x', 'h', 'Gestion 2', 'GESTION');
UPDATE usuarios SET activo = false WHERE email = 'admin@centro-prueba.cl';
INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES
  (test.u('13'), 'Olga', 'Antigua', '1950-01-01', test.u('b1'));
INSERT INTO fichas_clinicas (id, paciente_id, fecha_apertura) VALUES (test.u('f3'), test.u('13'), '2008-06-01');
INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro,
                         tipo_sesion_id, nivel_riesgo, created_at)
VALUES (gen_random_uuid(), test.u('f3'), test.u('b1'), test.cif('sesion 2009'), test.cif('Prof 1'), test.cif('rut'),
        test.cif('registro'), test.u('60'), 'NINGUNO', '2009-01-01');
\connect :app_url
\set ON_ERROR_STOP 1

\echo 79 Cierre: ADMIN no se da de baja a si mismo ni al ultimo ADMIN; GESTION como profesional; supervisor con practicantes no
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM iniciar_baja_profesional(test.u('a1'), now());
    RAISE EXCEPTION 'caso 79: baja propia debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM iniciar_baja_profesional(test.u('b4'), now() + interval '1 day');
    RAISE EXCEPTION 'caso 79: baja de supervisor con practicantes debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM iniciar_baja_profesional(test.u('a5'), now());
  PERFORM iniciar_baja_profesional(test.u('a6'), now());
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a5', 'ADMIN');
  PERFORM iniciar_baja_profesional(test.u('a1'), now());
  RAISE EXCEPTION 'caso 79: baja del ultimo ADMIN debio fallar';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ DECLARE n int; BEGIN
  n := procesar_bajas();
  ASSERT n = 2, format('caso 79: desactivo %s (esperado a5 y a6)', n);
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM usuarios WHERE id IN (test.u('a5'), test.u('a6')) AND cerrada_en IS NOT NULL AND nombre IS NULL) = 2,
    'caso 79: ADMIN y GESTION con baja cumplida: cerradas';
  ASSERT (SELECT count(*) FROM usuarios WHERE id IN (test.u('c2'), test.u('c3'), test.u('c5')) AND cerrada_en IS NULL) = 3,
    'caso 79: inactivas sin baja siguen en gracia';
END $$;

\connect :owner_url
\set ON_ERROR_STOP 1
DO $$ BEGIN
  UPDATE usuarios SET activo = false WHERE id = test.u('a1');
  RAISE EXCEPTION 'caso 79: desactivar al ultimo ADMIN debio fallar (incluso dueño)';
EXCEPTION WHEN check_violation THEN NULL; END $$;
-- Simula que c3 y c5 llevan 31 dias inactivas (gracia de 30).
UPDATE usuarios SET desactivado_en = now() - interval '31 days' WHERE id IN (test.u('c3'), test.u('c5'));
\connect :app_url
\set ON_ERROR_STOP 1

\echo 80 Gracia: se vacia despues de la gracia y no antes; dentro de la gracia se reactiva sin perder datos; cerrada no vuelve
DO $$ BEGIN
  ASSERT procesar_bajas() = 0, 'caso 80: no desactiva a nadie nuevo';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM usuarios WHERE id IN (test.u('c3'), test.u('c5')) AND cerrada_en IS NOT NULL AND nombre IS NULL) = 2,
    'caso 80: vencida la gracia, vaciadas';
  ASSERT (SELECT cerrada_en IS NULL AND nombre = 'Practicante expirado' FROM usuarios WHERE id = test.u('c2')), 'caso 80: c2 sigue en gracia';
  ASSERT cambiar_supervisor(test.u('c2'), test.u('b3')) = 0, 'caso 80: nuevo supervisor (sin supervision previa: sin avisos)';
  PERFORM otorgar_acceso_practicante(test.u('c2'), now() + interval '30 days');
  ASSERT (SELECT activo AND desactivado_en IS NULL AND email = 't-pre@x' FROM usuarios WHERE id = test.u('c2')),
    'caso 80: reactivada con sus datos';
  BEGIN
    PERFORM otorgar_acceso_practicante(test.u('c3'), now() + interval '30 days');
    RAISE EXCEPTION 'caso 80: reactivar cuenta cerrada debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    UPDATE usuarios SET activo = true WHERE id = test.u('c3');
    RAISE EXCEPTION 'caso 80: UPDATE de cuenta cerrada debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c2', 'PRACTICANTE');
  ASSERT (SELECT array_agg(id) FROM pacientes) = ARRAY[test.u('0d')], 'caso 80: c2 reactivada vuelve a ver a Dani (consentimiento vigente)';
END $$;

\echo 81 tipos_sesion: proponen PROFESIONAL/PRACTICANTE; solo ADMIN aprueba; evolucion solo con tipo aprobado y activo; sin DELETE
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  INSERT INTO tipos_sesion (id, nombre, estado, propuesto_por_id) VALUES (test.u('62'), 'T Pareja', 'APROBADO', test.u('b2'));
  ASSERT (SELECT estado = 'PROPUESTO' AND revisado_por_id IS NULL AND revisado_en IS NULL FROM tipos_sesion WHERE id = test.u('62')),
    'caso 81: una propuesta queda PROPUESTO aunque diga otra cosa';
  UPDATE tipos_sesion SET estado = 'APROBADO' WHERE id = test.u('62');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 81: el profesional no aprueba';
  BEGIN
    PERFORM test.evo(test.u('fa'), test.u('b2'), 'con tipo propuesto', p_tipo => test.u('62'));
    RAISE EXCEPTION 'caso 81: evolucion con tipo no aprobado debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO tipos_sesion (nombre, propuesto_por_id) VALUES ('T Otro', test.u('b1'));
    RAISE EXCEPTION 'caso 81: proponer a nombre de otro debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('c1', 'PRACTICANTE');
  INSERT INTO tipos_sesion (id, nombre, propuesto_por_id) VALUES (test.u('63'), 'T Grupal', test.u('c1'));
  PERFORM test.ctx('a2', 'PACIENTE');
  INSERT INTO tipos_sesion (nombre, propuesto_por_id) VALUES ('T Paciente', test.u('a2'));
  RAISE EXCEPTION 'caso 81: PACIENTE propone debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE tipos_sesion SET estado = 'APROBADO' WHERE id = test.u('62');
  ASSERT (SELECT revisado_por_id = test.u('a1') AND revisado_en IS NOT NULL FROM tipos_sesion WHERE id = test.u('62')),
    'caso 81: ADMIN aprueba (revisado_por/revisado_en)';
  BEGIN
    DELETE FROM tipos_sesion WHERE id = test.u('62');
    RAISE EXCEPTION 'caso 81: DELETE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b2', 'PROFESIONAL');
  PERFORM test.evo(test.u('fa'), test.u('b2'), 'con tipo aprobado', p_tipo => test.u('62'));
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE tipos_sesion SET activo = false WHERE id = test.u('62');
  PERFORM test.ctx('b2', 'PROFESIONAL');
  PERFORM test.evo(test.u('fa'), test.u('b2'), 'con tipo inactivo', p_tipo => test.u('62'));
  RAISE EXCEPTION 'caso 81: evolucion con tipo inactivo debio fallar';
EXCEPTION WHEN check_violation THEN NULL; END $$;

\echo 82 Disponibilidad en minutos (0-1440) y dias de cambio de horario de Chile (sabado 3-abr-2027 25 h; domingo 5-sep-2027 23 h)
DO $$ BEGIN
  ASSERT minuto_local('2027-04-03', 1440) - minuto_local('2027-04-03', 0) = interval '25 hours', 'caso 82: abril, dia de 25 h';
  ASSERT minuto_local('2027-09-05', 1440) - minuto_local('2027-09-05', 0) = interval '23 hours', 'caso 82: septiembre, dia de 23 h';
  ASSERT minuto_local('2027-09-05', 0) = '2027-09-05 01:00-03', 'caso 82: medianoche inexistente = 01:00';
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
    VALUES (test.u('b5'), 1, 600, 1441, 'PRESENCIAL');
    RAISE EXCEPTION 'caso 82: minuto > 1440 debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
    VALUES (test.u('b5'), 1, 700, 700, 'PRESENCIAL');
    RAISE EXCEPTION 'caso 82: rango vacio debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- La hora repetida de abril (segundo 23:30 del sabado) y la 01:00 del domingo
  -- de septiembre caben en una disponibilidad 0-1440.
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e1'), test.u('b1'), test.u('0a'), '2027-04-04 03:30+00', '2027-04-04 04:00+00'),
    (test.u('e1'), test.u('b1'), test.u('0a'), '2027-09-05 01:00-03', '2027-09-05 02:00-03');
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT array_agg(fin - inicio) FROM disponibilidad_publica(test.u('b4'), minuto_local('2027-04-03', 0), minuto_local('2027-04-04', 0))
          WHERE modalidad = 'PRESENCIAL') = ARRAY[interval '25 hours'], 'caso 82: hueco de 25 h en abril';
  ASSERT (SELECT array_agg(fin - inicio) FROM disponibilidad_publica(test.u('b4'), minuto_local('2027-09-05', 0), minuto_local('2027-09-06', 0))
          WHERE modalidad = 'PRESENCIAL') = ARRAY[interval '23 hours'], 'caso 82: hueco de 23 h en septiembre';
END $$;

\echo 83 Retencion: fichas_sobre_retencion solo ADMIN y auditada; revisiones append-only con motivo; PURGAR solo pasados 15 años
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM fichas_sobre_retencion();
  RAISE EXCEPTION 'caso 83: PROFESIONAL debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  n := (SELECT count(*) FROM consultas_retencion);
  ASSERT (SELECT array_agg(ficha_id) FROM fichas_sobre_retencion()) = ARRAY[test.u('f3')], 'caso 83: solo la ficha antigua';
  ASSERT (SELECT count(*) FROM consultas_retencion) = n + 1, 'caso 83: la consulta queda registrada';
  ASSERT EXISTS (SELECT 1 FROM accesos_ficha WHERE accion = 'RETENCION' AND ficha_id = test.u('f3')), 'caso 83: acceso auditado';
  BEGIN
    INSERT INTO revisiones_retencion (ficha_id, revisado_por_id, decision, motivo) VALUES (test.u('f3'), test.u('a1'), 'CONSERVAR', ' ');
    RAISE EXCEPTION 'caso 83: sin motivo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO revisiones_retencion (ficha_id, revisado_por_id, decision, motivo) VALUES (test.u('fa'), test.u('a1'), 'PURGAR', 'x');
    RAISE EXCEPTION 'caso 83: PURGAR ficha reciente debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO revisiones_retencion (ficha_id, revisado_por_id, decision, motivo) VALUES (test.u('f3'), test.u('b1'), 'CONSERVAR', 'x');
    RAISE EXCEPTION 'caso 83: revision a nombre de otro debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO revisiones_retencion (ficha_id, revisado_por_id, decision, motivo) VALUES (test.u('f3'), test.u('a1'), 'CONSERVAR', 'Causa judicial vigente');
  INSERT INTO revisiones_retencion (ficha_id, revisado_por_id, revisado_en, decision, motivo)
  VALUES (test.u('f3'), test.u('a1'), now() + interval '1 second', 'PURGAR', 'Sin causas pendientes');
  ASSERT (SELECT ultima_decision FROM fichas_sobre_retencion()) = 'PURGAR', 'caso 83: ultima decision';
  ASSERT (SELECT count(*) FROM consultas_retencion) = n + 2, 'caso 83: cada consulta registrada';
  BEGIN
    UPDATE revisiones_retencion SET motivo = 'x';
    RAISE EXCEPTION 'caso 83: UPDATE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM revisiones_retencion) = 0, 'caso 83: PROFESIONAL no lee revisiones';
  INSERT INTO revisiones_retencion (ficha_id, revisado_por_id, decision, motivo) VALUES (test.u('f3'), test.u('b1'), 'CONSERVAR', 'x');
  RAISE EXCEPTION 'caso 83: PROFESIONAL revisa debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\echo 84 Margen de traslado (30 min): presencial y online del mismo profesional; ambos sentidos; margen 0; huecos; subir el margen; enlace online
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e2'), 'PRESENCIAL', test.u('b2'), test.u('0a'), test.dia(20, 10), test.dia(20, 11));
  ASSERT (SELECT margen_traslado_min FROM citas WHERE profesional_id = test.u('b2') AND inicio = test.dia(20, 10)) = 30,
    'caso 84: margen fijado al confirmar';
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      ('ONLINE', test.u('b2'), test.u('0a'), test.dia(20, 11), test.dia(20, 12));
    RAISE EXCEPTION 'caso 84: online pegada a presencial debio fallar';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    ('ONLINE', test.u('b2'), test.u('0a'), test.dia(20, 11) + interval '30 minutes', test.dia(20, 12) + interval '30 minutes'),
    ('ONLINE', test.u('b2'), test.u('0a'), test.dia(20, 12) + interval '30 minutes', test.dia(20, 13) + interval '30 minutes');
  BEGIN
    INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e2'), 'PRESENCIAL', test.u('b2'), test.u('0a'), test.dia(20, 13) + interval '30 minutes', test.dia(20, 14) + interval '30 minutes');
    RAISE EXCEPTION 'caso 84: presencial pegada a online debio fallar';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e2'), 'PRESENCIAL', test.u('b2'), test.u('0a'), test.dia(20, 14), test.dia(20, 15));
  BEGIN
    INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin, enlace_online) VALUES
      (test.u('e1'), 'PRESENCIAL', test.u('b4'), test.u('0a'), test.dia(21, 10), test.dia(21, 11), test.cif('https://meet.example/x'));
    RAISE EXCEPTION 'caso 84: enlace en presencial debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, enlace_online) VALUES
      ('ONLINE', test.u('b4'), test.u('0a'), test.dia(21, 10), test.dia(21, 11), convert_to('https://meet.example/x', 'UTF8'));
    RAISE EXCEPTION 'caso 84: enlace en texto plano debio fallar (01g: cifrado)';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, enlace_online) VALUES
    ('ONLINE', test.u('b4'), test.u('0a'), test.dia(21, 10), test.dia(21, 11), test.cif('https://meet.example/x'));
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  UPDATE profesionales SET margen_traslado_min = 0 WHERE usuario_id = test.u('b1');
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e1'), 'PRESENCIAL', test.u('b1'), test.u('0a'), test.dia(22, 10), test.dia(22, 11));
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    ('ONLINE', test.u('b1'), test.u('0a'), test.dia(22, 11), test.dia(22, 12));
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b2'), test.dia(20, 0), test.dia(21, 0))
                 WHERE modalidad = 'ONLINE' AND fin = test.dia(20, 9) + interval '30 minutes'),
    'caso 84: el hueco online termina 30 min antes de la presencial';
  ASSERT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b2'), test.dia(20, 0), test.dia(21, 0))
                 WHERE modalidad = 'ONLINE' AND inicio = test.dia(20, 15) + interval '30 minutes'),
    'caso 84: el hueco online empieza 30 min despues de la presencial';
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b2'), test.dia(20, 0), test.dia(21, 0))
                     WHERE modalidad = 'PRESENCIAL' AND tstzrange(inicio, fin) && tstzrange(test.dia(20, 13), test.dia(20, 14))),
    'caso 84: tras una online, presencial recien a los 30 min';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET margen_traslado_min = 90;
  ASSERT (SELECT count(*) FROM citas WHERE profesional_id = test.u('b2') AND inicio >= test.dia(20, 0) AND estado = 'CONFIRMADA') = 4,
    'caso 84: subir el margen no rompe ni mueve citas';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM citas_en_conflicto_margen(test.u('b2'))) = 2, 'caso 84: dos pares bajo el margen nuevo';
  ASSERT (SELECT array_agg(separacion_min || '/' || margen_min ORDER BY inicio) FROM citas_en_conflicto_margen(test.u('b2')))
         = ARRAY['30/90', '30/90'], 'caso 84: separacion y margen';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM citas_en_conflicto_margen(test.u('b2'));
  RAISE EXCEPTION 'caso 84: otro profesional debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

\connect :owner_url
\set ON_ERROR_STOP 1
INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES (test.u('a7'), 't-admin3@x', 'h', 'Admin 3', 'ADMIN');
\connect :app_url
\set ON_ERROR_STOP 1

\echo 85 Un ADMIN nunca se desactiva a si mismo (aunque haya otro ADMIN activo); otro ADMIN si puede desactivarlo
DO $$ BEGIN
  PERFORM test.ctx('a7', 'ADMIN');
  UPDATE usuarios SET activo = false WHERE id = test.u('a7');
  RAISE EXCEPTION 'caso 85: ADMIN se desactiva a si mismo debio fallar';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE usuarios SET activo = false WHERE id = test.u('a7');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'caso 85: otro ADMIN si lo desactiva';
  ASSERT (SELECT desactivado_en IS NOT NULL FROM usuarios WHERE id = test.u('a7')), 'caso 85: empieza su gracia';
END $$;

\echo 86 sesiones: sin GRANT; crear sin contexto solo con cuenta habilitada (activa, rol de la BD); rotacion; reuso revoca la familia; cambio de cuenta revoca
DO $$ DECLARE r record; BEGIN
  BEGIN
    PERFORM 1 FROM sesiones;
    RAISE EXCEPTION 'caso 86: SELECT directo a sesiones debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM crear_sesion(test.u('b1'), 'PROFESIONAL', sha256('s1'), now() + interval '1 day');
  BEGIN
    PERFORM crear_sesion(test.u('a7'), 'ADMIN', sha256('s2'), now() + interval '1 day');
    RAISE EXCEPTION 'caso 86: cuenta desactivada (caso 85) no abre sesion';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM crear_sesion(test.u('b1'), 'ADMIN', sha256('s3'), now() + interval '1 day');
    RAISE EXCEPTION 'caso 86: rol distinto al de la BD no abre sesion';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT * INTO r FROM rotar_sesion(sha256('s1'), sha256('s1b'), now() + interval '1 day');
  ASSERT r.usuario_id = test.u('b1') AND r.rol = 'PROFESIONAL', 'caso 86: rota';
  ASSERT NOT EXISTS (SELECT 1 FROM rotar_sesion(sha256('s1'), sha256('s1c'), now() + interval '1 day')),
    'caso 86: reusar el token rotado -> 0 filas';
  ASSERT NOT EXISTS (SELECT 1 FROM rotar_sesion(sha256('s1b'), sha256('s1d'), now() + interval '1 day')),
    'caso 86: el reuso revoco la familia';
  PERFORM crear_sesion(test.u('b1'), 'PROFESIONAL', sha256('s5'), now() + interval '1 day');
  PERFORM test.ctx('b1', 'PROFESIONAL');
  UPDATE usuarios SET password_hash = 'h-nueva' WHERE id = test.u('b1');
  ASSERT NOT EXISTS (SELECT 1 FROM rotar_sesion(sha256('s5'), sha256('s5b'), now() + interval '1 day')),
    'caso 86: cambiar la contraseña revoca las sesiones';
END $$;

\echo 87 alertas_internas: solo ADMIN lee y atiende (una vez); escritura solo via funciones
DO $$ DECLARE v uuid; BEGIN
  PERFORM alertar_fallo_canario('prueba caso 87');
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM alertas_internas) = 0, 'caso 87: PROFESIONAL no ve alertas';
  BEGIN
    INSERT INTO alertas_internas (tipo, detalle) VALUES ('FALLO_CANARIO', 'x');
    RAISE EXCEPTION 'caso 87: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  SELECT id INTO v FROM alertas_internas WHERE detalle = 'prueba caso 87';
  ASSERT v IS NOT NULL, 'caso 87: ADMIN ve la alerta';
  BEGIN
    UPDATE alertas_internas SET detalle = 'y' WHERE id = v;
    RAISE EXCEPTION 'caso 87: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM test.ctx('b1', 'PROFESIONAL');
    PERFORM atender_alerta(v);
    RAISE EXCEPTION 'caso 87: PROFESIONAL no atiende alertas';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM atender_alerta(v);
  ASSERT (SELECT atendida_por_id FROM alertas_internas WHERE id = v) = test.u('a1'), 'caso 87: registra quien atiende';
  BEGIN
    PERFORM atender_alerta(v);
    RAISE EXCEPTION 'caso 87: atender dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  ASSERT alertar_bajas_sin_admin() = 0, 'caso 87: sin bajas bloqueadas por falta de ADMIN';
END $$;

\echo 88 notificaciones (02i): solo via notificar() (BANDEJA siempre + CORREO); lee el destinatario y ADMIN/GESTION; el job arma una vez y cierra; el correo reintenta con backoff hasta FALLIDO
DO $$ DECLARE v uuid; vc uuid; r record; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    INSERT INTO notificaciones (tipo, canal, paciente_id, referencia_id, creada_por_id)
    VALUES ('CITA_CONFIRMADA', 'BANDEJA', test.u('0a'), test.u('0a'), test.u('b1'));
    RAISE EXCEPTION 'caso 88: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM notificar('CITA_CONFIRMADA', test.u('0a'), NULL, test.u('0a'));
  BEGIN
    PERFORM notificar('DERIVACION_OFRECIDA', NULL, test.u('b2'), test.u('0a'));
    RAISE EXCEPTION 'caso 88: un aviso que origina la BD no se pide desde la API';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM notificaciones WHERE tipo = 'CITA_CONFIRMADA') = 0, 'caso 88: el actor no es destinatario: no la lee';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT array_agg(canal::text ORDER BY canal) FROM notificaciones WHERE tipo = 'CITA_CONFIRMADA' AND referencia_id = test.u('0a'))
         = ARRAY['BANDEJA', 'CORREO'], 'caso 88: una fila por canal; el paciente destinatario las ve';
  SELECT id INTO v FROM notificaciones WHERE tipo = 'CITA_CONFIRMADA' AND referencia_id = test.u('0a') AND canal = 'BANDEJA';
  SELECT id INTO vc FROM notificaciones WHERE tipo = 'CITA_CONFIRMADA' AND referencia_id = test.u('0a') AND canal = 'CORREO';
  BEGIN
    UPDATE notificaciones SET estado = 'ENVIADO' WHERE id = v;
    RAISE EXCEPTION 'caso 88: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM marcar_notificacion(v, true, NULL, false);
    RAISE EXCEPTION 'caso 88: funciones del job con contexto de usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM notificaciones WHERE id IN (v, vc)) = 2, 'caso 88: ADMIN las ve';
  -- Job (sin contexto): plantilla vigente y email solo para el correo.
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  SELECT * INTO r FROM notificaciones_por_enviar(1000) WHERE id = vc;
  ASSERT r.email IS NOT NULL AND r.plantilla_asunto = 'Cita confirmada', 'caso 88: el correo trae email y plantilla';
  SELECT * INTO r FROM notificaciones_por_enviar(1000) WHERE id = v;
  ASSERT r.email IS NULL AND r.plantilla_cuerpo LIKE '%{{nombre_paciente}}%', 'caso 88: la bandeja no lleva email';
  -- Bandeja: se arma una vez (cifrado) y queda ENVIADO.
  PERFORM guardar_contenido_notificacion(v, test.cif('asunto'), test.cif('cuerpo'));
  BEGIN
    PERFORM guardar_contenido_notificacion(v, test.cif('otro'), test.cif('otro'));
    RAISE EXCEPTION 'caso 88: armar dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    PERFORM guardar_contenido_notificacion(vc, '\x00', '\x00');
    RAISE EXCEPTION 'caso 88: contenido sin cifrar debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM marcar_notificacion(v, true, NULL, false);
  BEGIN
    PERFORM marcar_notificacion(v, false, 'x', true);
    RAISE EXCEPTION 'caso 88: cerrar dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  -- Correo: fallo reintentable -> PENDIENTE con backoff (no sale antes de tiempo); al quinto intento FALLIDO.
  PERFORM marcar_notificacion(vc, false, 'fallo el envio', true);
  ASSERT NOT EXISTS (SELECT 1 FROM notificaciones_por_enviar(1000) WHERE id = vc), 'caso 88: no se reintenta antes de tiempo';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT estado = 'PENDIENTE' AND intentos = 1 AND proximo_intento >= now() + interval '1 minute' FROM notificaciones WHERE id = vc),
    'caso 88: reintento con backoff';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM marcar_notificacion(vc, false, 'fallo el envio', true);
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT proximo_intento >= now() + interval '2 minutes' FROM notificaciones WHERE id = vc), 'caso 88: backoff exponencial';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM marcar_notificacion(vc, false, 'fallo el envio', true);
  PERFORM marcar_notificacion(vc, false, 'fallo el envio', true);
  PERFORM marcar_notificacion(vc, false, 'fallo el envio', true);
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT estado = 'FALLIDO' AND intentos = 5 FROM notificaciones WHERE id = vc), 'caso 88: FALLIDO al quinto intento';
  ASSERT (SELECT estado FROM notificaciones WHERE id = v) = 'ENVIADO', 'caso 88: la bandeja no depende del correo';
END $$;

\echo 89 Portal: mensajes solo a su equipo tratante y los lee el destinatario; epicrisis la crea el paciente y la resuelve el tratante o ADMIN
DO $$ DECLARE v_prof uuid; v_m uuid := gen_random_uuid(); v_s uuid := gen_random_uuid(); BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  SELECT id INTO v_prof FROM mi_equipo_tratante() LIMIT 1;
  INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido) VALUES (v_m, test.u('0a'), v_prof, app_usuario_id(), test.cif('hola'));
  BEGIN
    INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido)
    VALUES (gen_random_uuid(), test.u('0a'), test.u('a1'), app_usuario_id(), test.cif('hola'));
    RAISE EXCEPTION 'caso 89: mensaje fuera del equipo tratante debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido) VALUES (gen_random_uuid(), test.u('0a'), v_prof, app_usuario_id(), '\x00');
    RAISE EXCEPTION 'caso 89: contenido sin cifrar debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO solicitudes_epicrisis (id, paciente_id, motivo) VALUES (v_s, test.u('0a'), test.cif('motivo'));
  ASSERT (SELECT count(*) FROM mensajes_paciente WHERE id = v_m) = 1, 'caso 89: el paciente ve su mensaje';

  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM mensajes_paciente) = 0, 'caso 89: ADMIN no lee mensajes';
  ASSERT (SELECT count(*) FROM solicitudes_epicrisis WHERE id = v_s) = 1, 'caso 89: ADMIN ve la solicitud';
  BEGIN
    PERFORM resolver_solicitud_epicrisis(v_s, 'ENTREGADA', NULL);
    RAISE EXCEPTION 'caso 89: ENTREGADA sin documento debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM resolver_solicitud_epicrisis(v_s, 'ENTREGADA', 'doc.pdf');
  BEGIN
    PERFORM resolver_solicitud_epicrisis(v_s, 'RECHAZADA', NULL);
    RAISE EXCEPTION 'caso 89: resolver una entregada debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  PERFORM set_config('app.current_usuario_id', v_prof::text, true), set_config('app.current_rol', rol_usuario(v_prof), true);
  ASSERT (SELECT count(*) FROM mensajes_paciente WHERE id = v_m) = 1, 'caso 89: el destinatario lee el mensaje';
  BEGIN
    UPDATE mensajes_paciente SET leido_en = now() WHERE id = v_m;
    RAISE EXCEPTION 'caso 89: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM marcar_mensaje_leido(v_m);
  BEGIN
    PERFORM marcar_mensaje_leido(v_m);
    RAISE EXCEPTION 'caso 89: marcar dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM test.ctx('b5', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM mensajes_paciente) = 0, 'caso 89: otro profesional no lee mensajes ajenos';
END $$;

\echo 90 Documentos clinicos: emite y envia el tratante; el paciente ve, pide adjunto y descarga con enlace vigente; ADMIN audita envios sin ver documentos; GESTION nada
DO $$ DECLARE v_prof uuid; v_tipo uuid := gen_random_uuid(); v_doc uuid := gen_random_uuid(); r record; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  SELECT profesional_id INTO v_prof FROM pacientes WHERE id = test.u('0a');
  INSERT INTO tipos_documento_clinico (id, nombre) VALUES (v_tipo, 'T Epicrisis');
  PERFORM set_config('app.current_usuario_id', v_prof::text, true), set_config('app.current_rol', rol_usuario(v_prof), true);
  BEGIN
    INSERT INTO tipos_documento_clinico (nombre) VALUES ('T Receta');
    RAISE EXCEPTION 'caso 90: el tratante crea tipos debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO documentos_clinicos (id, paciente_id, tipo_documento_id, emitido_por_id, nombre_archivo, tipo_mime, contenido)
  VALUES (v_doc, test.u('0a'), v_tipo, v_prof, 'epicrisis.pdf', 'application/pdf', test.cif('pdf'));
  BEGIN
    INSERT INTO documentos_clinicos (id, paciente_id, tipo_documento_id, emitido_por_id, nombre_archivo, tipo_mime, contenido)
    VALUES (gen_random_uuid(), test.u('0b'), v_tipo, v_prof, 'x.pdf', 'application/pdf', test.cif('pdf'));
    RAISE EXCEPTION 'caso 90: documento de paciente ajeno debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO envios_documento (id, documento_id, modo, enviado_por_id) VALUES (gen_random_uuid(), v_doc, 'ADJUNTO', v_prof);
    RAISE EXCEPTION 'caso 90: adjunto sin solicitud del paciente debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO envios_documento (id, documento_id, modo, token_hash, enlace, expira_en, enviado_por_id)
  VALUES (gen_random_uuid(), v_doc, 'ENLACE', repeat('a', 64), test.cif('url'), now() + interval '1 day', v_prof),
         (gen_random_uuid(), v_doc, 'ENLACE', repeat('b', 64), test.cif('url2'), now() - interval '1 minute', v_prof);
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM documentos_clinicos) = 0, 'caso 90: ADMIN no lee documentos';
  ASSERT (SELECT count(*) FROM envios_documento WHERE documento_id = v_doc) = 2, 'caso 90: ADMIN audita envios';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM documentos_clinicos) + (SELECT count(*) FROM envios_documento) = 0, 'caso 90: GESTION no ve';
  PERFORM test.ctx('a4', 'PACIENTE');
  ASSERT (SELECT count(*) FROM documentos_clinicos) = 0, 'caso 90: otro paciente no ve';
  BEGIN
    PERFORM registrar_descarga_documento(repeat('a', 64));
    RAISE EXCEPTION 'caso 90: otro paciente descarga debio fallar';
  EXCEPTION WHEN no_data_found OR insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM documentos_clinicos WHERE id = v_doc) = 1, 'caso 90: el paciente ve su documento';
  SELECT * INTO r FROM registrar_descarga_documento(repeat('a', 64));
  ASSERT r.documento_id = v_doc AND NOT r.vencido, 'caso 90: descarga con enlace vigente';
  SELECT * INTO r FROM registrar_descarga_documento(repeat('b', 64));
  ASSERT r.vencido, 'caso 90: enlace vencido';
  ASSERT (SELECT count(*) FROM descargas_documento WHERE documento_id = v_doc) = 1, 'caso 90: solo la descarga vigente queda registrada';
  PERFORM solicitar_adjunto_documento(v_doc);
  BEGIN
    PERFORM solicitar_adjunto_documento(v_doc);
    RAISE EXCEPTION 'caso 90: pedir el adjunto dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', v_prof::text, true), set_config('app.current_rol', rol_usuario(v_prof), true);
  INSERT INTO envios_documento (id, documento_id, modo, enviado_por_id) VALUES (gen_random_uuid(), v_doc, 'ADJUNTO', v_prof);
  BEGIN
    UPDATE documentos_clinicos SET nombre_archivo = 'x' WHERE id = v_doc;
    RAISE EXCEPTION 'caso 90: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 91 Avisos de derivacion desde la BD: toda oferta notifica al candidato (tambien via job o rechazo) sin decir quien la origino; el origen recibe un aviso pendiente por derivacion
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT EXISTS (SELECT 1 FROM derivacion_candidatos WHERE estado IN ('RECHAZADA', 'EXPIRADA')), 'caso 91: hubo ofertas que pasaron al siguiente';
  ASSERT NOT EXISTS (SELECT 1 FROM derivacion_candidatos c WHERE c.ofrecida_en IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM notificaciones n WHERE n.tipo = 'DERIVACION_OFRECIDA' AND n.usuario_id = c.profesional_id
             AND n.referencia_id = c.derivacion_id)), 'caso 91: toda oferta notifica al candidato';
  ASSERT NOT EXISTS (SELECT 1 FROM notificaciones WHERE tipo IN ('DERIVACION_OFRECIDA', 'DERIVACION_ACTUALIZADA')
                     AND creada_por_id IS NOT NULL), 'caso 91: el aviso no dice quien lo origino';
  ASSERT EXISTS (SELECT 1 FROM notificaciones n JOIN derivaciones d ON d.id = n.referencia_id
                 WHERE n.tipo = 'DERIVACION_ACTUALIZADA' AND n.usuario_id = d.profesional_origen_id), 'caso 91: el origen recibe avisos';
  ASSERT NOT EXISTS (SELECT 1 FROM notificaciones WHERE tipo = 'DERIVACION_ACTUALIZADA' AND estado = 'PENDIENTE'
                     GROUP BY usuario_id, referencia_id, canal HAVING count(*) > 1), 'caso 91: un aviso pendiente por derivacion (por canal)';
END $$;

\echo 92 Videollamada y feed iCal: sala propia cifrada (ADMIN/GESTION la leen); token del feed solo del propio; feed sin contexto solo con token vigente y sin datos del paciente
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO salas_videollamada (usuario_id, modo, enlace) VALUES (test.u('b1'), 'ENLACE_PROPIO', test.cif('https://sala'));
  BEGIN
    INSERT INTO salas_videollamada (usuario_id, enlace) VALUES (test.u('b2'), test.cif('x'));
    RAISE EXCEPTION 'caso 92: sala ajena debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE salas_videollamada SET enlace = '\x00' WHERE usuario_id = test.u('b1');
    RAISE EXCEPTION 'caso 92: enlace sin cifrar debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO feeds_calendario (usuario_id, token_hash) VALUES (test.u('b1'), repeat('c', 64));
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM salas_videollamada) + (SELECT count(*) FROM feeds_calendario) = 0, 'caso 92: otro profesional no ve';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM salas_videollamada WHERE usuario_id = test.u('b1')) = 1, 'caso 92: GESTION lee la sala';
  ASSERT (SELECT count(*) FROM feeds_calendario) = 0, 'caso 92: GESTION no ve tokens';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  SELECT count(*) INTO n FROM feed_calendario(repeat('c', 64));
  ASSERT n > 0, 'caso 92: feed con token vigente';
  ASSERT pg_get_function_result('feed_calendario(text)'::regprocedure) NOT LIKE '%paciente%', 'caso 92: el feed no devuelve pacientes';
  BEGIN
    PERFORM * FROM feed_calendario(repeat('d', 64));
    RAISE EXCEPTION 'caso 92: token invalido debio fallar';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

\echo 93 Cobros: monto fijado al confirmar e inmutable; pagos solo via funciones (sobrepago 23514, parcial, anulacion con motivo); boleta unica al quedar pagada
DO $$ DECLARE v_cita uuid; v_cita2 uuid; v_pago uuid; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET modelo_cobro = 'CENTRO';
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b1'), test.u('0a'), test.dia(31, 10), test.dia(31, 11)) RETURNING id INTO v_cita;
  ASSERT (SELECT monto FROM citas WHERE id = v_cita) = 35000, 'caso 93: monto con la tarifa vigente';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO tarifas (profesional_id, monto) VALUES (test.u('b1'), 50000);
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT monto FROM citas WHERE id = v_cita) = 35000, 'caso 93: la tarifa nueva no cambia la cita confirmada';
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b1'), test.u('0a'), test.dia(32, 10), test.dia(32, 11)) RETURNING id INTO v_cita2;
  ASSERT (SELECT monto FROM citas WHERE id = v_cita2) = 50000, 'caso 93: cita nueva con la tarifa nueva';

  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM registrar_pago(v_cita, 40000, 'EFECTIVO');
    RAISE EXCEPTION 'caso 93: sobrepago debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v_pago := registrar_pago(v_cita, 10000, 'EFECTIVO');
  ASSERT (SELECT estado_pago || ':' || saldo FROM estado_pago_citas WHERE cita_id = v_cita) = 'PARCIAL:25000', 'caso 93: pago parcial';
  ASSERT emitir_boleta(gen_random_uuid(), v_cita, test.cif('Centro'), test.cif('rut')) IS NULL, 'caso 93: sin boleta si no esta pagada';
  BEGIN
    PERFORM anular_pago(v_pago, ' ');
    RAISE EXCEPTION 'caso 93: anular sin motivo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM anular_pago(v_pago, 'error de digitacion');
  ASSERT (SELECT saldo FROM estado_pago_citas WHERE cita_id = v_cita) = 35000, 'caso 93: un pago anulado no cuenta';
  BEGIN
    PERFORM anular_pago(v_pago, 'otra vez');
    RAISE EXCEPTION 'caso 93: anular dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM registrar_pago(v_cita, 35000, 'TRANSFERENCIA');
  ASSERT (SELECT estado_pago FROM estado_pago_citas WHERE cita_id = v_cita) = 'PAGADO', 'caso 93: pagado';
  ASSERT emitir_boleta(gen_random_uuid(), v_cita, test.cif('Centro'), test.cif('rut')) LIKE 'SIM-%', 'caso 93: boleta al quedar pagada';
  ASSERT emitir_boleta(gen_random_uuid(), v_cita, test.cif('Centro'), test.cif('rut')) IS NULL, 'caso 93: una sola boleta';
  BEGIN
    PERFORM anular_pago((SELECT id FROM pagos WHERE cita_id = v_cita AND estado = 'REGISTRADO'), 'con boleta');
    RAISE EXCEPTION 'caso 93: anular con boleta debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    UPDATE pagos SET monto = 1 WHERE cita_id = v_cita;
    RAISE EXCEPTION 'caso 93: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM estado_pago_citas WHERE cita_id = v_cita) = 1, 'caso 93: el profesional ve el estado de su cita';
  BEGIN
    PERFORM registrar_pago(v_cita2, 1000, 'EFECTIVO');
    RAISE EXCEPTION 'caso 93: profesional sin cobro directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('c1', 'PRACTICANTE');
  ASSERT (SELECT count(*) FROM estado_pago_citas) = 0, 'caso 93: el practicante no ve cobros';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM boletas WHERE cita_id = v_cita) = 1, 'caso 93: el paciente ve su boleta';
  ASSERT (SELECT saldo FROM estado_pago_citas WHERE cita_id = v_cita2) = 50000, 'caso 93: el paciente ve su saldo';
END $$;

\echo 94 Politica de cancelacion: a tiempo sin cobro; tardia devuelve menos la penalizacion o traslada el pago; inasistencia cobra el porcentaje; una decision por cita
DO $$ DECLARE v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_nueva uuid; v_monto int; r record; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET plazo_aviso_cancelacion_horas = 24, penalizacion_cancelacion_porcentaje = 50,
                                  cobro_inasistencia_porcentaje = 100;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b1'), test.u('0a'), test.dia(33, 10), test.dia(33, 11)) RETURNING id INTO v_a;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e2'), test.u('b1'), test.u('0a'), date_trunc('hour', now()) + interval '3 hours',
          date_trunc('hour', now()) + interval '4 hours') RETURNING id, monto INTO v_b, v_monto;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e2'), test.u('b1'), test.u('0a'), date_trunc('hour', now()) + interval '5 hours',
          date_trunc('hour', now()) + interval '6 hours') RETURNING id INTO v_c;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b1'), test.u('0a'), test.dia(34, 10), test.dia(34, 11)) RETURNING id INTO v_nueva;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e2'), test.u('b1'), test.u('0a'), date_trunc('hour', now()) - interval '3 hours',
          date_trunc('hour', now()) - interval '2 hours') RETURNING id INTO v_d;

  PERFORM test.ctx('a3', 'GESTION');
  PERFORM registrar_pago(v_a, 20000, 'EFECTIVO');
  PERFORM registrar_pago(v_b, v_monto, 'EFECTIVO');
  PERFORM registrar_pago(v_c, 10000, 'TRANSFERENCIA');
  UPDATE citas SET estado = 'CANCELADA' WHERE id IN (v_a, v_b, v_c);
  BEGIN
    PERFORM resolver_cita(v_nueva, 'DEVOLUCION', NULL, NULL);
    RAISE EXCEPTION 'caso 94: decidir sobre una cita no cancelada debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  PERFORM resolver_cita(v_a, 'DEVOLUCION', NULL, 'aviso con tiempo');
  SELECT * INTO r FROM resoluciones_cita WHERE cita_id = v_a;
  ASSERT r.a_tiempo AND r.monto_exigible = 0 AND r.monto_devolucion = 20000, 'caso 94: a tiempo devuelve todo';
  ASSERT (SELECT estado_pago FROM estado_pago_citas WHERE cita_id = v_a) = 'SIN_COBRO', 'caso 94: a tiempo sin cobro';
  BEGIN
    PERFORM resolver_cita(v_a, 'DEVOLUCION', NULL, NULL);
    RAISE EXCEPTION 'caso 94: segunda decision debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  PERFORM resolver_cita(v_b, 'DEVOLUCION', NULL, NULL);
  SELECT * INTO r FROM resoluciones_cita WHERE cita_id = v_b;
  ASSERT NOT r.a_tiempo AND r.porcentaje = 50 AND r.monto_exigible = v_monto / 2 AND r.monto_devolucion = v_monto - v_monto / 2,
    'caso 94: tardia devuelve lo pagado menos la penalizacion';
  ASSERT (SELECT estado_pago FROM estado_pago_citas WHERE cita_id = v_b) = 'PAGADO', 'caso 94: la penalizacion queda cubierta';

  BEGIN
    PERFORM resolver_cita(v_c, 'TRASLADO', NULL, NULL);
    RAISE EXCEPTION 'caso 94: traslado sin cita nueva debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM resolver_cita(v_c, 'TRASLADO', v_nueva, 'reprograma');
  ASSERT (SELECT pagado FROM estado_pago_citas WHERE cita_id = v_c) = 0
     AND (SELECT pagado FROM estado_pago_citas WHERE cita_id = v_nueva) = 10000, 'caso 94: el pago pasa a la cita nueva';
  ASSERT (SELECT origen = 'TRASLADO' AND traslado_de_id IS NOT NULL FROM pagos WHERE cita_id = v_nueva), 'caso 94: traslado trazable';

  BEGIN
    PERFORM resolver_cita(v_nueva, 'INASISTENCIA', NULL, NULL);
    RAISE EXCEPTION 'caso 94: inasistencia de una cita futura debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM resolver_cita(v_d, 'INASISTENCIA', NULL, 'no llego');
  ASSERT (SELECT estado_pago || ':' || saldo FROM estado_pago_citas WHERE cita_id = v_d) = 'PENDIENTE:' || v_monto,
    'caso 94: inasistencia cobra el porcentaje configurado';
  BEGIN
    UPDATE resoluciones_cita SET monto_exigible = 0;
    RAISE EXCEPTION 'caso 94: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM resolver_cita(v_d, 'DEVOLUCION', NULL, NULL);
    RAISE EXCEPTION 'caso 94: PROFESIONAL decide debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM resoluciones_cita WHERE cita_id IN (v_a, v_b, v_c, v_d)) = 4, 'caso 94: el profesional ve las decisiones';
END $$;

\echo 95 Liquidacion: cobrado por el centro - comision - arriendos; BORRADOR/EMITIDA/PAGADA solo ADMIN/GESTION; sin solape; el profesional ve las suyas emitidas
DO $$ DECLARE v_id uuid; r record;
  v_hoy date := (now() AT TIME ZONE 'America/Santiago')::date;
BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET comision_centro_porcentaje = 10;
  INSERT INTO arriendos (profesional_id, espacio_id, periodo_desde, periodo_hasta, monto) VALUES (test.u('b1'), test.u('e1'), v_hoy, v_hoy + 1, 5000);
  PERFORM test.ctx('a3', 'GESTION');
  v_id := generar_liquidacion(test.u('b1'), v_hoy - 1, v_hoy + 1);
  SELECT * INTO r FROM liquidaciones WHERE id = v_id;
  -- C-11 (03a): solo pagos cobrados por el centro de citas REALIZADAS del periodo (por la fecha de la cita);
  -- las canceladas y las inasistencias (93 y 94) no se liquidan.
  ASSERT r.total_cobrado = (SELECT coalesce(sum(p.monto), 0) FROM pagos p JOIN citas c ON c.id = p.cita_id
                            WHERE c.profesional_id = test.u('b1') AND p.estado = 'REGISTRADO' AND p.cobrado_por = 'CENTRO'
                              AND (c.inicio AT TIME ZONE 'America/Santiago')::date BETWEEN v_hoy - 1 AND v_hoy
                              AND cita_realizada(c.id)), 'caso 95: cobrado de citas realizadas';
  ASSERT r.comision = round(r.total_cobrado * 0.10) AND r.arriendos = 5000 AND r.total = r.total_cobrado - r.comision - 5000
         AND r.estado = 'BORRADOR', 'caso 95: comision y arriendo';
  ASSERT generar_liquidacion(test.u('b1'), v_hoy - 1, v_hoy + 1) = v_id, 'caso 95: un BORRADOR se recalcula';
  BEGIN
    PERFORM generar_liquidacion(test.u('b1'), v_hoy, v_hoy + 2);
    RAISE EXCEPTION 'caso 95: periodo solapado debio fallar';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM liquidaciones) = 0, 'caso 95: el profesional no ve borradores';
  BEGIN
    PERFORM avanzar_liquidacion(v_id, 'EMITIDA');
    RAISE EXCEPTION 'caso 95: PROFESIONAL emite debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  PERFORM avanzar_liquidacion(v_id, 'EMITIDA');
  BEGIN
    PERFORM generar_liquidacion(test.u('b1'), v_hoy - 1, v_hoy + 1);
    RAISE EXCEPTION 'caso 95: recalcular una emitida debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    PERFORM anular_pago((SELECT p.id FROM pagos p JOIN citas c ON c.id = p.cita_id
                         WHERE c.profesional_id = test.u('b1') AND p.estado = 'REGISTRADO'
                           AND (c.inicio AT TIME ZONE 'America/Santiago')::date BETWEEN v_hoy - 1 AND v_hoy
                           AND NOT EXISTS (SELECT 1 FROM boletas b WHERE b.cita_id = c.id) LIMIT 1), 'tarde');
    RAISE EXCEPTION 'caso 95: anular un pago liquidado debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    PERFORM avanzar_liquidacion(v_id, 'EMITIDA');
    RAISE EXCEPTION 'caso 95: emitir dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM avanzar_liquidacion(v_id, 'PAGADA');
  BEGIN
    UPDATE liquidaciones SET total = 0;
    RAISE EXCEPTION 'caso 95: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT estado FROM liquidaciones WHERE id = v_id) = 'PAGADA', 'caso 95: el profesional ve la suya';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM liquidaciones) = 0, 'caso 95: otro profesional no la ve';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM liquidaciones) + (SELECT count(*) FROM arriendos) = 0, 'caso 95: PACIENTE no ve';
END $$;

\echo 96 Plantillas de mensaje: ejemplos cargados; solo ADMIN personaliza; variable no permitida 23514; la bandeja no se desactiva; se restaura el ejemplo; sin INSERT ni DELETE; plantilla de documento validada
DO $$ DECLARE v uuid; n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM plantillas_mensaje WHERE canal = 'BANDEJA') = (SELECT count(*) FROM plantillas_mensaje WHERE canal = 'CORREO')
         AND (SELECT count(*) FROM plantillas_mensaje) >= 28, 'caso 96: ejemplos en BANDEJA y CORREO';
  ASSERT NOT EXISTS (SELECT 1 FROM plantillas_mensaje WHERE asunto <> asunto_ejemplo OR cuerpo <> cuerpo_ejemplo OR canal = 'WHATSAPP'),
    'caso 96: cargadas con el ejemplo';
  SELECT id INTO v FROM plantillas_mensaje WHERE evento = 'RECORDATORIO_CITA' AND destinatario = 'PACIENTE' AND canal = 'CORREO';
  UPDATE plantillas_mensaje SET cuerpo = 'Hola {{ nombre_paciente }}, nos vemos el {{fecha}} a las {{hora}}' WHERE id = v;
  BEGIN
    UPDATE plantillas_mensaje SET cuerpo = 'Motivo: {{motivo}}' WHERE id = v;
    RAISE EXCEPTION 'caso 96: variable no permitida debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE plantillas_mensaje SET asunto = 'Diagnostico {{diagnostico}}' WHERE id = v;
    RAISE EXCEPTION 'caso 96: variable no permitida en el asunto debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE plantillas_mensaje SET cuerpo = 'Hola {{nombre_paciente}' WHERE id = v;
    RAISE EXCEPTION 'caso 96: llaves sueltas debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE plantillas_mensaje SET activa = false WHERE evento = 'RECORDATORIO_CITA' AND canal = 'BANDEJA';
    RAISE EXCEPTION 'caso 96: desactivar la bandeja debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE plantillas_mensaje SET cuerpo_ejemplo = 'x' WHERE id = v;
    RAISE EXCEPTION 'caso 96: cambiar el ejemplo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
    VALUES ('ENLACE_ONLINE', 'PACIENTE', 'BANDEJA', 'a', 'b', 'a', 'b');
    RAISE EXCEPTION 'caso 96: INSERT debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM plantillas_mensaje WHERE id = v;
    RAISE EXCEPTION 'caso 96: DELETE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE plantillas_mensaje SET asunto = asunto_ejemplo, cuerpo = cuerpo_ejemplo WHERE id = v;
  ASSERT (SELECT cuerpo = cuerpo_ejemplo FROM plantillas_mensaje WHERE id = v), 'caso 96: restaurada';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  UPDATE plantillas_mensaje SET asunto = 'x';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0 AND (SELECT count(*) FROM plantillas_mensaje) = 0, 'caso 96: solo ADMIN';
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    INSERT INTO tipos_documento_clinico (nombre, plantilla) VALUES ('Tipo 96', 'Diagnostico: {{diagnostico}}');
    RAISE EXCEPTION 'caso 96: plantilla de documento con variable no permitida debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO tipos_documento_clinico (nombre, plantilla)
  VALUES ('Certificado 96', 'Certifico que {{nombre_paciente}} asistio. {{contenido}} {{nombre_profesional}}, {{fecha}}, {{nombre_centro}}');
END $$;

\echo 97 Preferencias: el paciente desactiva recordatorios y avisos operativos (solo afecta el correo: la bandeja siempre); los avisos legales no se desactivan; correo con plantilla inactiva no sale
DO $$ BEGIN
  PERFORM test.ctx('a4', 'PACIENTE');
  INSERT INTO preferencias_notificacion (paciente_id, recordatorios, avisos_operativos) VALUES (test.u('0e'), false, false);
  BEGIN
    INSERT INTO preferencias_notificacion (paciente_id) VALUES (test.u('0a'));
    RAISE EXCEPTION 'caso 97: preferencias ajenas debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM preferencias_notificacion) = 0, 'caso 97: no ve las ajenas';
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM notificar('PAGO_REGISTRADO', test.u('0e'), NULL, test.u('0e'));
  PERFORM notificar('CONSENTIMIENTO_SOLICITADO', test.u('0e'), NULL, test.u('0e'));
  PERFORM notificar('DOCUMENTO_CLINICO', test.u('0e'), NULL, test.u('0e'));
  ASSERT (SELECT array_agg(canal::text) FROM notificaciones WHERE tipo = 'PAGO_REGISTRADO' AND referencia_id = test.u('0e'))
         = ARRAY['BANDEJA'], 'caso 97: operativo desactivado: solo bandeja';
  ASSERT (SELECT count(*) FROM notificaciones WHERE tipo IN ('CONSENTIMIENTO_SOLICITADO', 'DOCUMENTO_CLINICO')
          AND referencia_id = test.u('0e') AND canal = 'CORREO') = 2, 'caso 97: avisos legales siempre por correo';
  UPDATE plantillas_mensaje SET activa = false WHERE evento = 'BOLETA_EMITIDA' AND canal = 'CORREO';
  PERFORM notificar('BOLETA_EMITIDA', test.u('0a'), NULL, test.u('0a'));
  ASSERT (SELECT array_agg(canal::text) FROM notificaciones WHERE tipo = 'BOLETA_EMITIDA' AND referencia_id = test.u('0a'))
         = ARRAY['BANDEJA'], 'caso 97: plantilla de correo inactiva: solo bandeja';
  UPDATE plantillas_mensaje SET activa = true WHERE evento = 'BOLETA_EMITIDA' AND canal = 'CORREO';
  PERFORM test.ctx('a4', 'PACIENTE');
  UPDATE preferencias_notificacion SET recordatorios = true WHERE paciente_id = test.u('0e');
  ASSERT (SELECT recordatorios AND NOT avisos_operativos FROM preferencias_notificacion), 'caso 97: el paciente cambia las suyas';
END $$;

\echo 98 Adjuntos de la ficha: el tratante sube y lee (cifrado; PDF, PNG o JPEG); ADMIN, GESTION, el paciente y otro profesional no; append-only
DO $$ DECLARE v uuid := gen_random_uuid(); v_prof uuid; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  SELECT profesional_id INTO v_prof FROM pacientes WHERE id = test.u('0a');
  PERFORM set_config('app.current_usuario_id', v_prof::text, true), set_config('app.current_rol', rol_usuario(v_prof), true);
  INSERT INTO adjuntos_ficha (id, paciente_id, subido_por_id, nombre_archivo, tipo_mime, tamano_bytes, contenido)
  VALUES (v, test.u('0a'), v_prof, 'informe.pdf', 'application/pdf', 10, test.cif('informe'));
  BEGIN
    INSERT INTO adjuntos_ficha (id, paciente_id, subido_por_id, nombre_archivo, tipo_mime, tamano_bytes, contenido)
    VALUES (gen_random_uuid(), test.u('0a'), v_prof, 'x.txt', 'text/plain', 10, test.cif('x'));
    RAISE EXCEPTION 'caso 98: tipo no permitido debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO adjuntos_ficha (id, paciente_id, subido_por_id, nombre_archivo, tipo_mime, tamano_bytes, contenido)
    VALUES (gen_random_uuid(), test.u('0a'), v_prof, 'x.pdf', 'application/pdf', 10, '\x00');
    RAISE EXCEPTION 'caso 98: contenido sin cifrar debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE adjuntos_ficha SET nombre_archivo = 'y' WHERE id = v;
    RAISE EXCEPTION 'caso 98: UPDATE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM adjuntos_ficha WHERE id = v) = 1, 'caso 98: el tratante lo lee';
  PERFORM test.ctx('b5', 'PROFESIONAL');
  BEGIN
    INSERT INTO adjuntos_ficha (id, paciente_id, subido_por_id, nombre_archivo, tipo_mime, tamano_bytes, contenido)
    VALUES (gen_random_uuid(), test.u('0a'), test.u('b5'), 'x.pdf', 'application/pdf', 10, test.cif('x'));
    RAISE EXCEPTION 'caso 98: subir a ficha ajena debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM adjuntos_ficha) = 0, 'caso 98: otro profesional no lo ve';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM adjuntos_ficha) = 0, 'caso 98: ADMIN no lo ve';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM adjuntos_ficha) = 0, 'caso 98: GESTION no lo ve';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM adjuntos_ficha) = 0, 'caso 98: el paciente no lo ve (como la ficha)';
  -- El paciente lee solo los tipos de documento de sus documentos (titulo del PDF).
  ASSERT (SELECT count(*) FROM tipos_documento_clinico) = (SELECT count(DISTINCT tipo_documento_id) FROM documentos_clinicos)
         AND (SELECT count(*) FROM tipos_documento_clinico) > 0, 'caso 98: el paciente ve los tipos de sus documentos';
  PERFORM test.ctx('a4', 'PACIENTE');
  ASSERT (SELECT count(*) FROM tipos_documento_clinico) = 0, 'caso 98: sin documentos no ve tipos';
END $$;

\echo 99 Recordatorios: una vez por cita y horario (job); token de un solo uso; la cancelacion informa a tiempo o tardia y avisa; SEQUENCE sube y el feed muestra la cancelada
DO $$ DECLARE v_cita uuid; v_cita2 uuid; v_ini timestamptz; v_ini2 timestamptz; v_r uuid := gen_random_uuid(); r record; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET recordatorio_horas_antes = 48, plazo_aviso_cancelacion_horas = 24, penalizacion_cancelacion_porcentaje = 50;
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin)
  VALUES ('ONLINE', test.u('b1'), test.u('0a'), test.sin_cruzar(date_trunc('minute', now()) + interval '30 hours 7 minutes'),
          test.sin_cruzar(date_trunc('minute', now()) + interval '30 hours 7 minutes') + interval '1 hour') RETURNING id, inicio INTO v_cita, v_ini;
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin)
  VALUES ('ONLINE', test.u('b1'), test.u('0a'), test.sin_cruzar(date_trunc('minute', now()) + interval '5 hours 7 minutes'),
          test.sin_cruzar(date_trunc('minute', now()) + interval '5 hours 7 minutes') + interval '1 hour') RETURNING id, inicio INTO v_cita2, v_ini2;
  ASSERT (SELECT secuencia FROM citas WHERE id = v_cita) = 0, 'caso 99: SEQUENCE inicial';
  BEGIN
    PERFORM citas_por_recordar(10);
    RAISE EXCEPTION 'caso 99: funcion del job con contexto debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (SELECT count(*) FROM citas_por_recordar(1000) WHERE cita_id IN (v_cita, v_cita2)) = 2, 'caso 99: ambas en la ventana';
  ASSERT registrar_recordatorio(v_r, v_cita, v_ini, repeat('e', 64), test.cif('https://x')),
    'caso 99: recordatorio registrado';
  ASSERT NOT registrar_recordatorio(gen_random_uuid(), v_cita, v_ini, repeat('f', 64), test.cif('x')),
    'caso 99: una sola vez por cita y horario';
  ASSERT NOT EXISTS (SELECT 1 FROM citas_por_recordar(1000) WHERE cita_id = v_cita), 'caso 99: ya recordada';
  SELECT * INTO r FROM consultar_recordatorio(repeat('e', 64));
  ASSERT r.vigente AND r.a_tiempo AND r.penalizacion_porcentaje = 50 AND r.profesional IS NOT NULL, 'caso 99: consulta antes de cancelar';
  SELECT * INTO r FROM responder_recordatorio(repeat('e', 64), 'CANCELADA');
  ASSERT r.a_tiempo AND r.penalizacion_porcentaje = 0, 'caso 99: cancelacion a tiempo sin penalizacion';
  BEGIN
    PERFORM responder_recordatorio(repeat('e', 64), 'CONFIRMADA');
    RAISE EXCEPTION 'caso 99: token usado dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM registrar_recordatorio(gen_random_uuid(), v_cita2, v_ini2, repeat('9', 64), test.cif('x'));
  SELECT * INTO r FROM responder_recordatorio(repeat('9', 64), 'CANCELADA');
  ASSERT NOT r.a_tiempo AND r.penalizacion_porcentaje = 50, 'caso 99: cancelacion tardia con la penalizacion vigente';
  BEGIN
    PERFORM consultar_recordatorio(repeat('8', 64));
    RAISE EXCEPTION 'caso 99: token inexistente debio fallar';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  ASSERT EXISTS (SELECT 1 FROM feed_calendario(repeat('c', 64)) WHERE id = v_cita AND estado = 'CANCELADA' AND secuencia = 1),
    'caso 99: el feed incluye la cancelada con su SEQUENCE';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM notificaciones WHERE tipo = 'RECORDATORIO_CITA' AND referencia_id = v_r) = 2, 'caso 99: bandeja y correo';
  ASSERT (SELECT estado = 'CANCELADA' AND cancelada_en IS NOT NULL AND secuencia = 1 FROM citas WHERE id = v_cita), 'caso 99: cancelada; SEQUENCE sube';
  ASSERT (SELECT count(*) FROM notificaciones WHERE tipo = 'CITA_CANCELADA' AND referencia_id = v_cita AND canal = 'BANDEJA') = 2,
    'caso 99: avisa al paciente y al profesional';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    UPDATE recordatorios_cita SET respuesta = NULL;
    RAISE EXCEPTION 'caso 99: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM recordatorios_cita WHERE cita_id IN (v_cita, v_cita2)) = 2, 'caso 99: el profesional ve los de sus citas';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM recordatorios_cita WHERE cita_id IN (v_cita, v_cita2)) = 0, 'caso 99: otro profesional no';
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET recordatorio_horas_antes = 48, penalizacion_cancelacion_porcentaje = 0;
END $$;

\echo 100 Recordatorio activo antes del plazo de aviso de cancelacion (CHECK sobre la fila); 0 lo desactiva; default 48
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT column_default FROM information_schema.columns
          WHERE table_name = 'configuracion_centro' AND column_name = 'recordatorio_horas_antes') = '48', 'caso 100: default 48';
  UPDATE configuracion_centro SET recordatorio_horas_antes = 48, plazo_aviso_cancelacion_horas = 24;
  BEGIN
    UPDATE configuracion_centro SET recordatorio_horas_antes = 24;
    RAISE EXCEPTION 'caso 100: recordatorio igual al plazo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE configuracion_centro SET plazo_aviso_cancelacion_horas = 48;
    RAISE EXCEPTION 'caso 100: plazo que alcanza al recordatorio debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE configuracion_centro SET recordatorio_horas_antes = 0, plazo_aviso_cancelacion_horas = 72;
  UPDATE configuracion_centro SET recordatorio_horas_antes = 48, plazo_aviso_cancelacion_horas = 24;
END $$;


-- =============================================================================
-- 03a-1 (alineacion con el diseño). Datos fijos como dueño:
--   b9 PROFESIONAL con perfil publico (solicitudes de hora), ba PROFESIONAL
--   (baja con borradores); 14 Tomas (15 años, de b2) con adulto responsable
--   d4 (correo) y cuenta PACIENTE a8; 15 Lia (adulta, de b1, sin cuenta).
-- =============================================================================
\connect :owner_url
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES
  (test.u('b9'), 't-p9@x', 'h', 'Prof 9', 'PROFESIONAL'),
  (test.u('ba'), 't-pa@x', 'h', 'Prof A', 'PROFESIONAL');
SELECT test.disponible_siempre(ARRAY[test.u('b9'), test.u('ba')]);
INSERT INTO tarifas (profesional_id, monto) VALUES (test.u('b9'), 30000);
INSERT INTO profesionales (usuario_id, especialidad, modalidad, nombre_publico, perfil_publico)
VALUES (test.u('b9'), 'Psicologia', 'MIXTA', 'Ps. Nueve', true);
INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES
  (test.u('14'), 'Tomas', 'Teen', (now() AT TIME ZONE 'America/Santiago')::date - interval '15 years', test.u('b2')),
  (test.u('15'), 'Lia', 'Adulta', '1988-05-05', test.u('b1'));
INSERT INTO fichas_clinicas (id, paciente_id) VALUES (test.u('f4'), test.u('14')), (test.u('f5'), test.u('15'));
INSERT INTO adultos_responsables (id, paciente_id, nombre, email) VALUES (test.u('d4'), test.u('14'), 'Papa Tomas', 't-papa@x');
INSERT INTO usuarios (id, email, password_hash, nombre, rol, paciente_id)
VALUES (test.u('a8'), 't-tomas@x', 'h', 'Tomas', 'PACIENTE', test.u('14'));
COMMIT;

\connect :app_url
\set ON_ERROR_STOP 1

\echo 101 Varios roles por cuenta (C-1): ADMIN o GESTION + PROFESIONAL, un rol por sesion, cambio de rol con token nuevo, baja por rol
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM otorgar_rol_adicional(test.u('a3'), 'PROFESIONAL');
    RAISE EXCEPTION 'caso 101: GESTION no otorga roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM otorgar_rol_adicional(test.u('a3'), 'PROFESIONAL');
  BEGIN
    PERFORM otorgar_rol_adicional(test.u('b1'), 'PROFESIONAL');
    RAISE EXCEPTION 'caso 101: un PROFESIONAL no suma otro rol';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM otorgar_rol_adicional(test.u('c1'), 'PROFESIONAL');
    RAISE EXCEPTION 'caso 101: PRACTICANTE es exclusivo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO roles_adicionales (usuario_id, rol, otorgado_por_id) VALUES (test.u('a1'), 'PROFESIONAL', test.u('a1'));
    RAISE EXCEPTION 'caso 101: sin INSERT directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT roles_cuenta(test.u('a3')) = ARRAY['GESTION', 'PROFESIONAL'], 'caso 101: roles de la cuenta (principal primero)';
  ASSERT roles_cuenta(test.u('b2')) = ARRAY['PROFESIONAL'], 'caso 101: cuenta de un rol';
  PERFORM test.ctx('a3', 'PROFESIONAL');
  ASSERT acceso_vigente(), 'caso 101: sesion con el rol adicional';
  ASSERT (SELECT count(*) FROM pacientes) = 0 AND (SELECT count(*) FROM fichas_clinicas) = 0,
    'caso 101: como PROFESIONAL solo sus pacientes (ninguno)';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM pacientes) > 0 AND (SELECT count(*) FROM evoluciones) = 0,
    'caso 101: como GESTION datos administrativos, nunca evoluciones';
  PERFORM test.ctx('a3', 'ADMIN');
  ASSERT NOT acceso_vigente(), 'caso 101: un rol que la cuenta no tiene';
  -- Cambio de rol sin cerrar sesion: familia nueva; la anterior queda revocada.
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM crear_sesion(test.u('a3'), 'GESTION', sha256('t101a'), now() + interval '1 day');
  ASSERT cambiar_rol_sesion(sha256('t101a'), sha256('t101b'), 'PROFESIONAL', now() + interval '1 day') = test.u('a3'),
    'caso 101: cambia de rol';
  ASSERT cambiar_rol_sesion(sha256('t101a'), sha256('t101c'), 'PROFESIONAL', now() + interval '1 day') IS NULL,
    'caso 101: el token anterior quedo revocado';
  ASSERT cambiar_rol_sesion(sha256('t101b'), sha256('t101d'), 'ADMIN', now() + interval '1 day') IS NULL, 'caso 101: rol ajeno';
  ASSERT (SELECT rol FROM rotar_sesion(sha256('t101b'), sha256('t101e'), now() + interval '1 day')) = 'PROFESIONAL',
    'caso 101: la sesion nueva trabaja como PROFESIONAL';
  -- Baja del rol adicional: al cumplirse, rol inactivo y sus sesiones cortadas; la cuenta sigue como GESTION.
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM iniciar_baja_rol(test.u('a3'), 'PROFESIONAL', now() - interval '1 minute');
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM procesar_bajas();
  ASSERT roles_cuenta(test.u('a3')) = ARRAY['GESTION'], 'caso 101: baja del rol adicional';
  ASSERT (SELECT count(*) FROM rotar_sesion(sha256('t101e'), sha256('t101f'), now() + interval '1 day')) = 0,
    'caso 101: la baja corta las sesiones de ese rol';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT acceso_vigente(), 'caso 101: el rol principal sigue';
END $$;

\echo 102 Cuentas: tokens por correo de un solo uso (sin acceso directo), recuperacion, acceso del paciente, invitaciones, cambio de correo, TOTP
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM 1 FROM tokens_correo;
    RAISE EXCEPTION 'caso 102: tokens sin SELECT directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT crear_token_recuperacion('t-p3@x', sha256('r102a'), now() + interval '1 hour'), 'caso 102: recuperacion de una cuenta';
  ASSERT NOT crear_token_recuperacion('nadie@x', sha256('r102b'), now() + interval '1 hour'), 'caso 102: sin cuenta no se emite';
  ASSERT usar_token_recuperacion(sha256('r102a'), 'hash-nuevo') = test.u('b3'), 'caso 102: cambia la contraseña';
  BEGIN
    PERFORM usar_token_recuperacion(sha256('r102a'), 'otro');
    RAISE EXCEPTION 'caso 102: un solo uso';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    PERFORM usar_token_recuperacion(sha256('r102z'), 'otro');
    RAISE EXCEPTION 'caso 102: token inexistente';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  ASSERT crear_token_acceso('t-ana@x', sha256('a102a'), now() + interval '15 minutes'), 'caso 102: enlace de acceso del paciente';
  ASSERT NOT crear_token_acceso('t-p2@x', sha256('a102b'), now() + interval '15 minutes'), 'caso 102: el equipo no entra por enlace';
  ASSERT (SELECT usuario_id FROM usar_token_acceso(sha256('a102a'))) = test.u('a2'), 'caso 102: el enlace abre la cuenta';
  -- Invitaciones: ADMIN/GESTION; paciente desde los 14 y sin cuenta; adulto responsable de un menor.
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM crear_invitacion_paciente(test.u('15'), 'lia@x', sha256('i102a'), now() + interval '1 day');
    RAISE EXCEPTION 'caso 102: el profesional no invita';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM crear_invitacion_paciente(test.u('0b'), 'beto@x', sha256('i102b'), now() + interval '1 day');
    RAISE EXCEPTION 'caso 102: menor de 14 sin cuenta propia';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM crear_invitacion_paciente(test.u('0a'), 'ana2@x', sha256('i102c'), now() + interval '1 day');
    RAISE EXCEPTION 'caso 102: Ana ya tiene cuenta';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  ASSERT crear_invitacion_paciente(test.u('15'), 'lia@x', sha256('i102d'), now() + interval '1 day') = 'lia@x',
    'caso 102: invitacion de la paciente adulta';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT crear_invitacion_responsable(test.u('d4'), NULL, sha256('i102e'), now() + interval '1 day') = 't-papa@x',
    'caso 102: invitacion del adulto responsable';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (SELECT rol FROM activar_invitacion(sha256('i102d'), 'h', test.u('a9'))) = 'PACIENTE', 'caso 102: la cuenta se crea al activar';
  ASSERT (SELECT paciente_id FROM credenciales_login('lia@x')) = test.u('15'), 'caso 102: vinculada al paciente';
  ASSERT (SELECT rol FROM activar_invitacion(sha256('i102e'), 'h', test.u('aa'))) = 'RESPONSABLE', 'caso 102: cuenta RESPONSABLE';
  BEGIN
    PERFORM activar_invitacion(sha256('i102d'), 'h', gen_random_uuid());
    RAISE EXCEPTION 'caso 102: la invitacion es de un solo uso';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  -- C-9: el paciente cambia su correo (verificado) y su telefono; nada mas.
  PERFORM test.ctx('a9', 'PACIENTE');
  PERFORM crear_token_cambio_correo('lia.nueva@x', sha256('c102a'), now() + interval '1 day');
  PERFORM actualizar_telefono_paciente(test.cif('+56911112222'));
  UPDATE pacientes SET fecha_nacimiento = '2015-01-01' WHERE id = test.u('15');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 102: el paciente no edita su fecha de nacimiento';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM usar_token_cambio_correo(sha256('c102a'));
  ASSERT (SELECT id FROM credenciales_login('lia.nueva@x')) = test.u('a9'), 'caso 102: correo nuevo verificado';
  PERFORM test.ctx('a9', 'PACIENTE');
  ASSERT (SELECT email = 'lia.nueva@x' AND telefono IS NOT NULL FROM pacientes WHERE id = test.u('15')), 'caso 102: datos de contacto';
  -- TOTP: obligatorio con rol clinico; enrolamiento una vez; solo ADMIN lo reinicia.
  ASSERT (SELECT requerido FROM segundo_factor(test.u('b1'))), 'caso 102: TOTP obligatorio para PROFESIONAL';
  ASSERT NOT (SELECT requerido FROM segundo_factor(test.u('a2'))), 'caso 102: opcional para el paciente';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM guardar_totp(test.u('b3'), test.cif('secreto totp'));
  PERFORM activar_totp(test.u('b3'));
  BEGIN
    PERFORM guardar_totp(test.u('b3'), test.cif('otro secreto'));
    RAISE EXCEPTION 'caso 102: no se reemplaza un TOTP activo';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM reiniciar_totp(test.u('b3'));
    RAISE EXCEPTION 'caso 102: solo ADMIN reinicia el TOTP';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM reiniciar_totp(test.u('b3'));
  ASSERT NOT (SELECT activo FROM segundo_factor(test.u('b3'))), 'caso 102: reiniciado';
END $$;
-- Token vencido: now() no avanza dentro de una transaccion; se crea, se espera y se usa en transacciones separadas.
DO $$ BEGIN ASSERT crear_token_acceso('t-ana@x', sha256('a102c'), now() + interval '1 second'), 'caso 102: token de vida corta'; END $$;
DO $$ BEGIN PERFORM pg_sleep(1.2); END $$;
DO $$ BEGIN
  BEGIN
    PERFORM usar_token_acceso(sha256('a102c'));
    RAISE EXCEPTION 'caso 102: token vencido';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;

\echo 103 Politicas versionadas (append-only) y aceptaciones: portal (adulto o responsable), presencial con respaldo, enlace de un solo uso
DO $$ DECLARE v int; t text; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  v := (SELECT max(version) FROM politicas WHERE tipo = 'POLITICA_DATOS');
  INSERT INTO politicas (tipo, version, texto) VALUES ('POLITICA_DATOS', 99, 'Texto nuevo de la politica de datos del centro');
  ASSERT (SELECT max(version) FROM politicas WHERE tipo = 'POLITICA_DATOS') = v + 1, 'caso 103: la BD fija la version';
  BEGIN
    UPDATE politicas SET texto = 'cambiado';
    RAISE EXCEPTION 'caso 103: una version no se edita';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    INSERT INTO politicas (tipo, version, texto) VALUES ('POLITICA_DATOS', 1, 'Texto de GESTION para la politica');
    RAISE EXCEPTION 'caso 103: solo ADMIN publica';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a2', 'PACIENTE');
  PERFORM registrar_aceptacion('CONSENTIMIENTO_ATENCION', test.u('0a'), NULL, NULL);
  BEGIN
    PERFORM registrar_aceptacion('CONSENTIMIENTO_ATENCION', test.u('15'), NULL, NULL);
    RAISE EXCEPTION 'caso 103: no acepta por otro paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a8', 'PACIENTE');
  BEGIN
    PERFORM registrar_aceptacion('CONSENTIMIENTO_ATENCION', test.u('14'), NULL, NULL);
    RAISE EXCEPTION 'caso 103: el adolescente no acepta por si mismo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('aa', 'RESPONSABLE');
  PERFORM registrar_aceptacion('CONSENTIMIENTO_ATENCION', test.u('14'), test.u('d4'), NULL);
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM registrar_aceptacion('CONSENTIMIENTO_ATENCION', test.u('15'), NULL, NULL);
    RAISE EXCEPTION 'caso 103: presencial exige respaldo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM registrar_aceptacion('CONSENTIMIENTO_ATENCION', test.u('15'), NULL, 'escaneo-15.pdf');
  ASSERT (SELECT count(*) FROM aceptaciones_politica WHERE paciente_id IN (test.u('0a'), test.u('14'), test.u('15'))) = 3,
    'caso 103: GESTION ve todas';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM aceptaciones_politica) = 1, 'caso 103: el paciente las suyas';
  PERFORM test.ctx('a8', 'PACIENTE');
  ASSERT (SELECT count(*) FROM aceptaciones_politica) = 0, 'caso 103: el adolescente no (cuenta restringida)';
  -- Ana (traspasada en 43) y Tomas son de b2; Lia de b1.
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM aceptaciones_politica WHERE paciente_id IN (test.u('0a'), test.u('14'))) = 2
     AND (SELECT count(*) FROM aceptaciones_politica WHERE paciente_id = test.u('15')) = 0, 'caso 103: el tratante las de sus pacientes';
  -- Enlace de un solo uso: al paciente adulto o al adulto responsable del menor.
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT crear_token_consentimiento(test.u('15'), sha256('k103a'), now() + interval '1 day') = 'lia.nueva@x', 'caso 103: al paciente';
  ASSERT crear_token_consentimiento(test.u('14'), sha256('k103b'), now() + interval '1 day') = 't-papa@x', 'caso 103: al adulto responsable';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  SELECT politica_version::text INTO t FROM consultar_token_consentimiento(sha256('k103b'));
  ASSERT (SELECT menor FROM consultar_token_consentimiento(sha256('k103b'))), 'caso 103: lo responde el adulto responsable';
  ASSERT responder_token_consentimiento(sha256('k103b'), true, t) = 'ATENCION', 'caso 103: aceptado por enlace';
  BEGIN
    PERFORM responder_token_consentimiento(sha256('k103b'), true, t);
    RAISE EXCEPTION 'caso 103: un solo uso';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    PERFORM responder_token_consentimiento(sha256('k103a'), true, '0');
    RAISE EXCEPTION 'caso 103: version no vigente';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT EXISTS (SELECT 1 FROM aceptaciones_politica WHERE paciente_id = test.u('14') AND canal = 'TOKEN'
                 AND otorgado_por = 'ADULTO_RESPONSABLE' AND adulto_responsable_id = test.u('d4')), 'caso 103: registro por enlace';
END $$;

\echo 104 Menores (D-4): el adolescente ve sus citas y mensajes, no montos; el adulto responsable ve citas y pagos, no los mensajes del adolescente; nadie del portal ve la ficha
DO $$ DECLARE v_cita uuid; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b2'), test.u('14'), test.dia(40, 10), test.dia(40, 11)) RETURNING id INTO v_cita;
  PERFORM test.ctx('a8', 'PACIENTE');
  ASSERT (SELECT count(*) FROM citas WHERE id = v_cita) = 1, 'caso 104: el adolescente ve su cita';
  ASSERT (SELECT count(*) FROM estado_pago_citas) = 0, 'caso 104: no ve montos ni saldos';
  ASSERT (SELECT count(*) FROM fichas_clinicas) = 0 AND (SELECT count(*) FROM evoluciones) = 0, 'caso 104: nunca la ficha';
  INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido)
  VALUES (test.u('6a'), test.u('14'), test.u('b2'), test.u('a8'), test.cif('hola'));
  BEGIN
    INSERT INTO solicitudes_epicrisis (id, paciente_id) VALUES (gen_random_uuid(), test.u('14'));
    RAISE EXCEPTION 'caso 104: la epicrisis la pide el adulto responsable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('aa', 'RESPONSABLE');
  ASSERT (SELECT array_agg(id) FROM pacientes) = ARRAY[test.u('14')], 'caso 104: el responsable ve a su menor';
  ASSERT (SELECT count(*) FROM citas WHERE id = v_cita) = 1 AND (SELECT count(*) FROM estado_pago_citas WHERE cita_id = v_cita) = 1,
    'caso 104: citas y estado de pago';
  ASSERT (SELECT count(*) FROM mensajes_paciente) = 0, 'caso 104: no ve los mensajes del adolescente';
  INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido)
  VALUES (test.u('6b'), test.u('14'), test.u('b2'), test.u('aa'), test.cif('mensaje del adulto'));
  ASSERT (SELECT count(*) FROM mensajes_paciente) = 1, 'caso 104: los suyos';
  BEGIN
    INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido)
    VALUES (gen_random_uuid(), test.u('0a'), test.u('b1'), test.u('aa'), test.cif('x'));
    RAISE EXCEPTION 'caso 104: no escribe por un paciente ajeno';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM fichas_clinicas) = 0, 'caso 104: el responsable nunca ve la ficha';
  ASSERT (SELECT count(*) FROM mi_equipo_tratante()) >= 1, 'caso 104: equipo tratante del menor';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM mensajes_paciente WHERE paciente_id = test.u('14')) = 2, 'caso 104: el profesional recibe ambos';
END $$;

\echo 105 Cita SOLICITADA (C-15): retiene el horario y la aprueba el tratante, ADMIN o GESTION; horario del centro y del box
DO $$ DECLARE v uuid; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin, estado)
  VALUES (test.u('e1'), test.u('b1'), test.u('15'), test.dia(41, 10), test.dia(41, 11), 'SOLICITADA') RETURNING id INTO v;
  ASSERT (SELECT monto FROM citas WHERE id = v) IS NULL, 'caso 105: sin monto hasta confirmar';
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
    VALUES (test.u('e2'), test.u('b1'), test.u('0a'), test.dia(41, 10), test.dia(41, 11));
    RAISE EXCEPTION 'caso 105: la SOLICITADA retiene el horario';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b1'), test.dia(41, 9), test.dia(41, 12)) d
                     WHERE d.inicio <= test.dia(41, 10) AND d.fin >= test.dia(41, 11)), 'caso 105: no se ofrece';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  BEGIN
    PERFORM aprobar_cita_solicitada(v);
    RAISE EXCEPTION 'caso 105: otro profesional no aprueba';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM aprobar_cita_solicitada(v);
  ASSERT (SELECT estado = 'CONFIRMADA' AND monto IS NOT NULL FROM citas WHERE id = v), 'caso 105: confirmada con monto';
  BEGIN
    PERFORM aprobar_cita_solicitada(v);
    RAISE EXCEPTION 'caso 105: ya aprobada';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) VALUES (1, 540, 600);
    RAISE EXCEPTION 'caso 105: el horario del centro es de ADMIN';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) SELECT d, 540, 1080 FROM generate_series(1, 7) d;
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
    VALUES (test.u('e1'), test.u('b1'), test.u('15'), test.lunes(28, 19), test.lunes(28, 20));
    RAISE EXCEPTION 'caso 105: fuera del horario del centro';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b1'), test.u('15'), test.lunes(28, 15), test.lunes(28, 16));
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b1'), test.lunes(28, 0), test.lunes(29, 0)) d
                     WHERE d.fin > test.lunes(28, 18)), 'caso 105: la disponibilidad publica respeta el horario del centro';
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO horarios_espacio (espacio_id, dia_semana, inicio_min, fin_min) SELECT test.u('e2'), d, 540, 720 FROM generate_series(1, 7) d;
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
    VALUES (test.u('e2'), test.u('b1'), test.u('15'), test.lunes(29, 14), test.lunes(29, 15));
    RAISE EXCEPTION 'caso 105: fuera del horario del box';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT espacio_libre(test.lunes(29, 14), test.lunes(29, 15)) IS DISTINCT FROM test.u('e2'), 'caso 105: box libre segun su horario';
  DELETE FROM horarios_espacio WHERE espacio_id = test.u('e2');
  PERFORM test.ctx('a1', 'ADMIN');
  DELETE FROM horario_centro;
END $$;

\echo 106 Solicitud de hora sin cuenta (D-2, C-15): retiene la hora, verifica el correo (un solo uso) y concreta paciente, ficha, cita y aceptaciones; limites, menor, respuestas del match y RUT antes de la primera evolucion
DO $$ DECLARE v_pol uuid := (SELECT id FROM politica_vigente('POLITICA_DATOS'));
              v_ter uuid := (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')); r record; BEGIN
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  BEGIN
    PERFORM crear_solicitud_hora(test.u('3a'), test.u('b9'), 'PRESENCIAL', test.dia(20, 10), test.dia(20, 11), 'Ema', 'Nueva',
                                 '1990-01-01', 'ema@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, gen_random_uuid(),
                                 v_ter, sha256('s106a'));
    RAISE EXCEPTION 'caso 106: version vieja de la politica';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM crear_solicitud_hora(test.u('3b'), test.u('b9'), 'PRESENCIAL', test.dia(20, 10), test.dia(20, 11), 'Ema', 'Nueva',
                               '1990-01-01', 'Ema@X', test.cif('+56900000001'), NULL, NULL, NULL, NULL, NULL,
                               test.cif('{"motivos":["ansiedad"]}'), test.u('b9'), true, v_pol, v_ter, sha256('s106b'));
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b9'), test.dia(20, 9), test.dia(20, 12)) d
                     WHERE d.modalidad = 'PRESENCIAL' AND d.inicio <= test.dia(20, 10) AND d.fin >= test.dia(20, 11)),
    'caso 106: la hora queda retenida';
  BEGIN
    PERFORM crear_solicitud_hora(test.u('3c'), test.u('b9'), 'PRESENCIAL', test.dia(20, 10), test.dia(20, 11), 'Otro', 'Mas',
                                 '1990-01-01', 'otro@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, v_pol, v_ter,
                                 sha256('s106c'));
    RAISE EXCEPTION 'caso 106: hora ya retenida';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  BEGIN
    PERFORM crear_solicitud_hora(test.u('3d'), test.u('b9'), 'PRESENCIAL', test.dia(21, 10), test.dia(21, 11), 'Nino', 'Chico',
                                 '2016-01-01', 'mama@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, v_pol, v_ter,
                                 sha256('s106d'));
    RAISE EXCEPTION 'caso 106: menor sin adulto responsable';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM crear_solicitud_hora(test.u('3e'), test.u('b9'), 'PRESENCIAL', test.dia(22, 10), test.dia(22, 11), 'Ema', 'Nueva',
                               '1990-01-01', 'ema@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, v_pol, v_ter,
                               sha256('s106e'));
  BEGIN
    PERFORM crear_solicitud_hora(test.u('3f'), test.u('b9'), 'PRESENCIAL', test.dia(23, 10), test.dia(23, 11), 'Ema', 'Nueva',
                                 '1990-01-01', 'ema@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, v_pol, v_ter,
                                 sha256('s106f'));
    RAISE EXCEPTION 'caso 106: maximo de pendientes por correo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM 1 FROM solicitudes_hora;
    RAISE EXCEPTION 'caso 106: sin SELECT directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (SELECT nombre FROM datos_solicitud_hora(sha256('s106b'))) = 'Ema', 'caso 106: datos para la API (sin consumir)';
  SELECT * INTO r FROM concretar_solicitud_hora(sha256('s106b'), test.u('16'), test.u('d6'), test.cif('+56900000001'), NULL, NULL,
                                                NULL, sha256('inv106b'), now() + interval '3 days');
  ASSERT r.estado = 'CONFIRMADA' AND r.invitacion_email = 'ema@x' AND r.invitacion_rol = 'PACIENTE',
    'caso 106: cita confirmada e invitacion al correo verificado';
  BEGIN
    PERFORM concretar_solicitud_hora(sha256('s106b'), gen_random_uuid(), gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'caso 106: el enlace es de un solo uso';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT creado_por_solicitud AND NOT posible_duplicado AND profesional_id = test.u('b9') FROM pacientes WHERE id = test.u('16')),
    'caso 106: paciente del portal con su tratante';
  ASSERT EXISTS (SELECT 1 FROM fichas_clinicas WHERE paciente_id = test.u('16')), 'caso 106: con ficha';
  ASSERT (SELECT count(*) FROM aceptaciones_politica WHERE paciente_id = test.u('16') AND canal = 'SOLICITUD') = 2,
    'caso 106: politica y terminos aceptados';
  ASSERT (SELECT count(*) FROM lista_espera WHERE paciente_id = test.u('16')) = 1, 'caso 106: avisarme si se libera una hora';
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE tipo = 'CITA_CONFIRMADA' AND paciente_id = test.u('16')), 'caso 106: aviso de cita';
  -- Profesional que aprueba pacientes nuevos: SOLICITADA y aviso al profesional; mismo correo = posible duplicado.
  PERFORM test.ctx('b9', 'PROFESIONAL');
  UPDATE profesionales SET requiere_aprobacion_nuevos = true WHERE usuario_id = test.u('b9');
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  SELECT * INTO r FROM concretar_solicitud_hora(sha256('s106e'), test.u('17'), test.u('d7'), NULL, NULL, NULL, NULL,
                                                sha256('inv106e'), now() + interval '3 days');
  ASSERT r.estado = 'SOLICITADA' AND r.invitacion_email IS NULL, 'caso 106: por aprobar, sin invitacion aun';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE tipo = 'SOLICITUD_HORA' AND usuario_id = test.u('b9') AND referencia_id = r.cita_id),
    'caso 106: aviso al profesional';
  ASSERT (SELECT posible_duplicado FROM pacientes WHERE id = test.u('17')), 'caso 106: GESTION concilia (nunca por nombre)';
  -- Respuestas del match: solo el tratante; auditado.
  PERFORM test.ctx('b9', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM respuestas_match_paciente(test.u('16'))) = 1, 'caso 106: el tratante lee las respuestas';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM respuestas_match_paciente(test.u('16'));
    RAISE EXCEPTION 'caso 106: otro profesional no';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM respuestas_match_paciente(test.u('16'));
    RAISE EXCEPTION 'caso 106: ADMIN no (clinico)';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  ASSERT EXISTS (SELECT 1 FROM accesos_ficha WHERE paciente_id = test.u('16') AND recurso = 'respuestas_match'), 'caso 106: auditado';
  -- RUT del paciente del portal antes de su primera evolucion.
  PERFORM test.ctx('b9', 'PROFESIONAL');
  BEGIN
    PERFORM test.evo((SELECT id FROM fichas_clinicas WHERE paciente_id = test.u('16')), test.u('b9'), 'primera');
    RAISE EXCEPTION 'caso 106: falta el RUT';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE pacientes SET rut = test.cif('rut 16'), rut_hmac = sha256('rut 16') WHERE id = test.u('16');
  PERFORM test.evo((SELECT id FROM fichas_clinicas WHERE paciente_id = test.u('16')), test.u('b9'), 'primera');
  UPDATE profesionales SET requiere_aprobacion_nuevos = false WHERE usuario_id = test.u('b9');
  -- Una solicitud mas que el job vencera (caso 115).
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM crear_solicitud_hora(test.u('3c'), test.u('b9'), 'PRESENCIAL', test.dia(24, 10), test.dia(24, 11), 'Vence', 'Pronto',
                               '1990-01-01', 'vence@x', NULL, NULL, NULL, NULL, NULL, NULL, test.cif('{"a":1}'), NULL, false, v_pol,
                               v_ter, sha256('s106g'));
END $$;

\echo 107 Lista de espera: el paciente se anota, ADMIN/GESTION ven todo, el profesional las suyas; al liberarse una hora la BD avisa
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  INSERT INTO lista_espera (paciente_id, profesional_id, creada_por_id) VALUES (test.u('0a'), test.u('b9'), test.u('a2'));
  BEGIN
    INSERT INTO lista_espera (paciente_id, profesional_id, creada_por_id) VALUES (test.u('15'), test.u('b9'), test.u('a2'));
    RAISE EXCEPTION 'caso 107: no anota a otro paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO lista_espera (paciente_id, creada_por_id) VALUES (test.u('0a'), test.u('a2'));
    RAISE EXCEPTION 'caso 107: profesional o tipo de atencion';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM lista_espera WHERE profesional_id = test.u('b9')) = 2, 'caso 107: GESTION ve todas';
  PERFORM test.ctx('b5', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM lista_espera WHERE profesional_id = test.u('b9')) = 0, 'caso 107: otro profesional no';
  PERFORM test.ctx('b9', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM lista_espera WHERE profesional_id = test.u('b9')) = 2, 'caso 107: el profesional las suyas';
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE citas SET estado = 'CANCELADA' WHERE paciente_id = test.u('16') AND estado = 'CONFIRMADA' AND inicio > now();
  ASSERT EXISTS (SELECT 1 FROM notificaciones n JOIN lista_espera l ON l.id = n.referencia_id
                 WHERE n.tipo = 'HORA_LIBERADA' AND n.paciente_id = test.u('0a')), 'caso 107: aviso de hora liberada';
  ASSERT NOT EXISTS (SELECT 1 FROM notificaciones WHERE tipo = 'HORA_LIBERADA' AND paciente_id = test.u('16')),
    'caso 107: no a quien la libero';
END $$;

\echo 108 Acceso clinico temporal (C-4, C-5): ADMIN o el tratante; lectura o escritura hasta el termino; aviso y auditoria; mover una cita solo a quien tiene acceso
-- Ana (0a) es de b2 desde el traspaso del caso 43.
DO $$ DECLARE v_cita uuid; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM otorgar_acceso_temporal(test.u('0a'), test.u('b1'), 'REEMPLAZO', 'LECTURA', NULL, now() + interval '1 day');
    RAISE EXCEPTION 'caso 108: GESTION no otorga';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('b3', 'PROFESIONAL');
  BEGIN
    PERFORM otorgar_acceso_temporal(test.u('0a'), test.u('b1'), 'REEMPLAZO', 'LECTURA', NULL, now() + interval '1 day');
    RAISE EXCEPTION 'caso 108: solo el tratante';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM pacientes WHERE id = test.u('0a')) = 0, 'caso 108: sin acceso antes';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  PERFORM otorgar_acceso_temporal(test.u('0a'), test.u('b1'), 'INTERCONSULTA', 'LECTURA', NULL, now() + interval '1 day');
  BEGIN
    PERFORM otorgar_acceso_temporal(test.u('0a'), test.u('b2'), 'REEMPLAZO', 'LECTURA', NULL, now() + interval '1 day');
    RAISE EXCEPTION 'caso 108: no a si mismo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM pacientes WHERE id = test.u('0a')) = 1 AND (SELECT count(*) FROM fichas_clinicas WHERE id = test.u('fa')) = 1,
    'caso 108: lectura con acceso temporal';
  BEGIN
    PERFORM test.evo(test.u('fa'), test.u('b1'), 'intento');
    RAISE EXCEPTION 'caso 108: LECTURA no escribe';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE accesos_clinicos_temporales SET hasta = now();
    RAISE EXCEPTION 'caso 108: append-only (se corta solo al vencer)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM otorgar_acceso_temporal(test.u('0a'), test.u('b3'), 'REEMPLAZO', 'LECTURA_ESCRITURA', NULL, now() + interval '60 days');
  PERFORM test.ctx('b3', 'PROFESIONAL');
  PERFORM test.evo(test.u('fa'), test.u('b3'), 'reemplazo');
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM pacientes WHERE id = test.u('0a')) = 0, 'caso 108: otro profesional sigue sin acceso';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM notificaciones WHERE tipo = 'ACCESO_CLINICO_TEMPORAL' AND paciente_id = test.u('0a') AND canal = 'BANDEJA') = 2,
    'caso 108: aviso legal al paciente';
  ASSERT (SELECT count(*) FROM accesos_ficha WHERE paciente_id = test.u('0a') AND accion = 'ACCESO_TEMPORAL') = 2, 'caso 108: auditado';
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e2'), test.u('b2'), test.u('0a'), test.dia(44, 10), test.dia(44, 11)) RETURNING id INTO v_cita;
  BEGIN
    UPDATE citas SET profesional_id = test.u('b4') WHERE id = v_cita;
    RAISE EXCEPTION 'caso 108: mover a un no tratante sin acceso';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE citas SET profesional_id = test.u('b3') WHERE id = v_cita;
END $$;

\echo 109 Borradores (C-8): solo su autor los ve y edita; se descartan (no son ficha); la baja no se completa con borradores pendientes
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  INSERT INTO borradores_evolucion (id, autor_id, ficha_clinica_id, contenido) VALUES (test.u('2a'), test.u('b2'), test.u('fa'), test.cif('borrador'));
  UPDATE borradores_evolucion SET contenido = test.cif('borrador 2') WHERE id = test.u('2a');
  ASSERT (SELECT count(*) FROM borradores_evolucion) = 1, 'caso 109: el autor lo ve';
  BEGIN
    INSERT INTO borradores_evolucion (id, autor_id, ficha_clinica_id, contenido) VALUES (gen_random_uuid(), test.u('b2'), test.u('fb'), test.cif('x'));
    RAISE EXCEPTION 'caso 109: no en una ficha ajena';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM borradores_evolucion) = 0, 'caso 109: otro profesional no (aun con acceso temporal)';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM borradores_evolucion) = 0, 'caso 109: ADMIN no';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  DELETE FROM borradores_evolucion WHERE id = test.u('2a');
  ASSERT (SELECT count(*) FROM borradores_evolucion) = 0, 'caso 109: descartado';
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES (test.u('18'), 'Bea', 'Baja', '1980-01-01', test.u('ba'));
  INSERT INTO fichas_clinicas (id, paciente_id) VALUES (test.u('f8'), test.u('18'));
  PERFORM test.ctx('ba', 'PROFESIONAL');
  INSERT INTO borradores_evolucion (id, autor_id, ficha_clinica_id, contenido) VALUES (test.u('2b'), test.u('ba'), test.u('f8'), test.cif('pendiente'));
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM iniciar_baja_profesional(test.u('ba'), now() - interval '1 minute');
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM procesar_bajas();
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT procesada_en IS NULL FROM bajas WHERE usuario_id = test.u('ba')), 'caso 109: la baja queda pendiente';
  ASSERT EXISTS (SELECT 1 FROM alertas_internas WHERE tipo = 'BAJA_CON_BORRADORES' AND atendida_en IS NULL), 'caso 109: alerta a ADMIN';
  PERFORM test.ctx('ba', 'PROFESIONAL');
  DELETE FROM borradores_evolucion WHERE id = test.u('2b');
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM procesar_bajas();
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT procesada_en IS NOT NULL FROM bajas WHERE usuario_id = test.u('ba')), 'caso 109: sin borradores se completa';
END $$;

\echo 110 Alta (append-only): el tratante con fecha y motivo cifrado; borra respuestas del match y cierra la lista de espera; ADMIN no la lee
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  BEGIN
    PERFORM registrar_alta(gen_random_uuid(), test.u('16'), current_date, test.cif('m'));
    RAISE EXCEPTION 'caso 110: solo el tratante';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('b9', 'PROFESIONAL');
  BEGIN
    PERFORM registrar_alta(gen_random_uuid(), test.u('16'), current_date + 5, test.cif('m'));
    RAISE EXCEPTION 'caso 110: fecha futura';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM registrar_alta(test.u('2c'), test.u('16'), (now() AT TIME ZONE 'America/Santiago')::date, test.cif('objetivos cumplidos'));
  ASSERT (SELECT count(*) FROM respuestas_match_paciente(test.u('16'))) = 0, 'caso 110: respuestas del match borradas';
  ASSERT (SELECT count(*) FROM altas_paciente WHERE paciente_id = test.u('16')) = 1, 'caso 110: el tratante la ve';
  BEGIN
    UPDATE altas_paciente SET fecha = current_date - 1;
    RAISE EXCEPTION 'caso 110: append-only';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM altas_paciente) = 0, 'caso 110: ADMIN no (motivo clinico)';
  ASSERT (SELECT estado FROM lista_espera WHERE paciente_id = test.u('16')) = 'CANCELADA', 'caso 110: lista de espera cerrada';
END $$;

\echo 111 Reseñas (D-1): una por paciente y profesional con sesion realizada; moderacion de ADMIN; editar vuelve a moderacion; retirar; feedback privado solo del profesional; reporte publico; auditoria
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    PERFORM crear_resena(gen_random_uuid(), test.u('0a'), test.u('b9'), 5, NULL, NULL, 'ANONIMO');
    RAISE EXCEPTION 'caso 111: sin sesion realizada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM crear_resena(test.u('2d'), test.u('0a'), test.u('b1'), 5, test.cif('muy buena'), test.cif('privado'), 'NOMBRE_INICIAL');
  BEGIN
    PERFORM crear_resena(gen_random_uuid(), test.u('0a'), test.u('b1'), 4, NULL, NULL, NULL);
    RAISE EXCEPTION 'caso 111: una por paciente y profesional';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  ASSERT (SELECT count(*) FROM resenas_publicas(test.u('b1'))) = 0, 'caso 111: pendiente de moderacion';
  PERFORM test.ctx('a8', 'PACIENTE');
  BEGIN
    PERFORM crear_resena(gen_random_uuid(), test.u('14'), test.u('b2'), 5, NULL, NULL, NULL);
    RAISE EXCEPTION 'caso 111: el adolescente no reseña';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM moderar_resena(test.u('2d'), true, NULL);
    RAISE EXCEPTION 'caso 111: solo ADMIN modera';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM resenas) = 0, 'caso 111: ADMIN no lee la tabla (feedback privado)';
  ASSERT (SELECT count(*) FROM resenas_para_moderar() WHERE id = test.u('2d')) = 1, 'caso 111: cola de moderacion';
  BEGIN
    PERFORM moderar_resena(test.u('2d'), false, NULL);
    RAISE EXCEPTION 'caso 111: ocultar exige motivo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM moderar_resena(test.u('2d'), true, NULL);
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (SELECT autor FROM resenas_publicas(test.u('b1'))) = 'Ana A.', 'caso 111: nombre + inicial';
  ASSERT (SELECT resenas FROM perfiles_publicos() WHERE id = test.u('b1')) = 1, 'caso 111: cantidad en el perfil publico';
  PERFORM reportar_resena(test.u('2d'), 'contenido ofensivo');
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT feedback_privado IS NOT NULL FROM resenas WHERE id = test.u('2d')), 'caso 111: el profesional lee su feedback';
  PERFORM test.ctx('a2', 'PACIENTE');
  PERFORM editar_resena(test.u('2d'), 4, test.cif('editada'), NULL, NULL);
  ASSERT (SELECT estado FROM resenas WHERE id = test.u('2d')) = 'PENDIENTE', 'caso 111: editar vuelve a moderacion';
  PERFORM retirar_resena(test.u('2d'));
  ASSERT (SELECT estado FROM resenas WHERE id = test.u('2d')) = 'RETIRADA', 'caso 111: retirada';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT array_agg(accion) FROM resenas_eventos WHERE resena_id = test.u('2d'))
         @> ARRAY['CREADA', 'PUBLICADA', 'REPORTADA', 'EDITADA', 'RETIRADA'], 'caso 111: auditoria completa';
  BEGIN
    UPDATE resenas_eventos SET motivo = 'x';
    RAISE EXCEPTION 'caso 111: auditoria append-only';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 112 Reportes por rol: dashboard (ADMIN/GESTION agregados sin datos clinicos; el profesional los suyos), cobros y estado de fichas
DO $$ DECLARE j jsonb; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  j := reporte_dashboard();
  ASSERT j ? 'pacientes_activos' AND j ? 'pendientes' AND (j->'pendientes'->>'resenas_por_moderar') IS NULL, 'caso 112: GESTION agregados';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (reporte_dashboard()->'pendientes') ? 'resenas_por_moderar', 'caso 112: ADMIN con moderacion';
  PERFORM test.ctx('b9', 'PROFESIONAL');
  j := reporte_dashboard();
  ASSERT j->>'rol' = 'PROFESIONAL' AND j ? 'fichas_sin_cerrar' AND NOT j ? 'pendientes', 'caso 112: el profesional los suyos';
  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    j := reporte_dashboard();
    RAISE EXCEPTION 'caso 112: el paciente no';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT bool_and(x->>'profesional_id' = test.u('b1')::text)
          FROM jsonb_array_elements(reporte_cobros(current_date - 300, current_date + 60)->'profesionales') x) IS NOT FALSE,
    'caso 112: cobros, el profesional solo los suyos';
  BEGIN
    PERFORM reporte_cobros(current_date, current_date - 1);
    RAISE EXCEPTION 'caso 112: periodo invalido';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('b2', 'PROFESIONAL');
  BEGIN
    PERFORM estado_fichas_profesional(test.u('b1'));
    RAISE EXCEPTION 'caso 112: estado de fichas de otro';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM estado_fichas_profesional(test.u('b1'))) > 0, 'caso 112: GESTION ve el estado (metadata)';
  BEGIN
    PERFORM metricas_match(30);
    RAISE EXCEPTION 'caso 112: metricas del match solo ADMIN';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT metricas_match(30) ? 'completados', 'caso 112: metricas';
END $$;

\echo 113 Contenido publico (ADMIN), modulos (solo el operador), imagenes publicas (append-only) y cuestionario del match (ADMIN, nunca DELETE)
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE contenido_publico SET hero_titulo = 'Centro de prueba', color_marca = '#AA5500';
  BEGIN
    UPDATE contenido_publico SET color_marca = 'rojo';
    RAISE EXCEPTION 'caso 113: color #RRGGBB';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE configuracion_centro SET modulos_activos = ARRAY['FICHAS']::modulo_centro[];
    RAISE EXCEPTION 'caso 113: los modulos los cambia el operador';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  UPDATE contenido_publico SET hero_titulo = 'x';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 113: GESTION no edita el contenido publico';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (contenido_publico_centro()->>'hero_titulo') = 'Centro de prueba' AND 'MATCH' = ANY (modulos_activos()), 'caso 113: lectura publica';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO imagenes_publicas (id, tipo, usuario_id, tipo_mime, ancho, alto, tamano_bytes, contenido)
  VALUES (test.u('2e'), 'FOTO_PERFIL', test.u('b1'), 'image/webp', 10, 10, 3, '\x010203');
  BEGIN
    INSERT INTO imagenes_publicas (tipo, usuario_id, tipo_mime, ancho, alto, tamano_bytes, contenido)
    VALUES ('FOTO_PERFIL', test.u('b2'), 'image/webp', 10, 10, 3, '\x010203');
    RAISE EXCEPTION 'caso 113: foto de otro';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE imagenes_publicas SET ancho = 20;
    RAISE EXCEPTION 'caso 113: imagenes append-only';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (SELECT tipo_mime FROM imagen_publica(test.u('2e'))) = 'image/webp', 'caso 113: se sirve sin sesion';
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    INSERT INTO match_preguntas (clave, texto, tipo, orden) VALUES ('nueva', 'Pregunta', 'UNICA', 9);
    RAISE EXCEPTION 'caso 113: solo ADMIN configura el match';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO match_preguntas (clave, texto, tipo, orden, propia_centro) VALUES ('seguro', '¿Tienes seguro complementario?', 'UNICA', 9, true);
  BEGIN
    DELETE FROM match_preguntas WHERE clave = 'seguro';
    RAISE EXCEPTION 'caso 113: nunca DELETE';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE match_preguntas SET activa = false WHERE clave = 'seguro';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT jsonb_array_length(cuestionario_match()) = 8, 'caso 113: cuestionario activo (8 preguntas de ejemplo)';
  PERFORM registrar_resultado_match(test.u('b1'));
END $$;

\echo 114 Liquidacion (C-11): solo citas realizadas del periodo; opcional exigir evolucion registrada (dato si/no)
DO $$ DECLARE v_pasada uuid; v_futura uuid; v_liq uuid; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET comision_centro_porcentaje = 0, modelo_cobro = 'CENTRO';
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b9'), test.u('16'), date_trunc('hour', now()) - interval '50 hours', date_trunc('hour', now()) - interval '49 hours')
  RETURNING id INTO v_pasada;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b9'), test.u('16'), date_trunc('hour', now()) + interval '50 hours', date_trunc('hour', now()) + interval '51 hours')
  RETURNING id INTO v_futura;
  PERFORM registrar_pago(v_pasada, 30000, 'EFECTIVO');
  PERFORM registrar_pago(v_futura, 30000, 'EFECTIVO');
  v_liq := generar_liquidacion(test.u('b9'), current_date - 5, current_date + 5);
  ASSERT (SELECT total_cobrado FROM liquidaciones WHERE id = v_liq) = 30000, 'caso 114: solo la cita realizada';
  UPDATE configuracion_centro SET liquidar_exige_evolucion = true;
  v_liq := generar_liquidacion(test.u('b9'), current_date - 5, current_date + 5);
  ASSERT (SELECT total_cobrado FROM liquidaciones WHERE id = v_liq) = 0, 'caso 114: exige evolucion registrada';
  PERFORM test.ctx('b9', 'PROFESIONAL');
  INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro, tipo_sesion_id, nivel_riesgo, cita_id)
  VALUES (gen_random_uuid(), (SELECT id FROM fichas_clinicas WHERE paciente_id = test.u('16')), test.u('b9'), test.cif('cierre'),
          test.cif('nombre'), test.cif('rut'), test.cif('registro'), test.u('60'), 'NINGUNO', v_pasada);
  BEGIN
    INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro, tipo_sesion_id, nivel_riesgo, cita_id)
    VALUES (gen_random_uuid(), (SELECT id FROM fichas_clinicas WHERE paciente_id = test.u('16')), test.u('b9'), test.cif('x'),
            test.cif('nombre'), test.cif('rut'), test.cif('registro'), test.u('60'), 'NINGUNO',
            (SELECT id FROM citas WHERE paciente_id = test.u('17') LIMIT 1));
    RAISE EXCEPTION 'caso 114: la sesion es de otro paciente';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  v_liq := generar_liquidacion(test.u('b9'), current_date - 5, current_date + 5);
  ASSERT (SELECT total_cobrado FROM liquidaciones WHERE id = v_liq) = 30000, 'caso 114: con evolucion vinculada se liquida';
  UPDATE configuracion_centro SET liquidar_exige_evolucion = false;
END $$;

\connect :owner_url
\set ON_ERROR_STOP 1

\echo 115 Job de solicitudes: vence la retencion (libera la hora) y elimina solicitudes vencidas antiguas (minimizacion)
DO $$ BEGIN
  UPDATE solicitudes_hora SET expira_en = now() - interval '1 minute' WHERE id = test.u('3c');
  PERFORM limpiar_solicitudes();
  ASSERT (SELECT estado FROM solicitudes_hora WHERE id = test.u('3c')) = 'EXPIRADA', 'caso 115: vencida';
  ASSERT NOT EXISTS (SELECT 1 FROM bloqueos_temporales WHERE solicitud_id = test.u('3c')), 'caso 115: la hora se libera';
  UPDATE solicitudes_hora SET creada_en = now() - interval '40 days' WHERE id = test.u('3c');
  PERFORM limpiar_solicitudes();
  ASSERT NOT EXISTS (SELECT 1 FROM solicitudes_hora WHERE id = test.u('3c')), 'caso 115: eliminada pasado el plazo';
  BEGIN
    UPDATE contenido_publico SET id = false;
    RAISE EXCEPTION 'caso 115: una sola fila de contenido publico';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE configuracion_centro SET modulos_activos = ARRAY['MATCH']::modulo_centro[];
    RAISE EXCEPTION 'caso 115: Match requiere Equipo';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

\echo 67 Append-only incluso como dueño: historial, comentarios, eventos de llaves, intervenciones; sin DELETE en consentimientos ni llaves
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['historial_accesos_practicante', 'supervision_comentarios', 'consentimientos', 'eventos_llaves',
                           'llaves_datos', 'evolucion_intervenciones', 'avisos_consentimiento', 'revisiones_retencion',
                           'consultas_retencion', 'alertas_internas', 'notificaciones', 'mensajes_paciente',
                           'solicitudes_epicrisis', 'documentos_clinicos', 'envios_documento', 'descargas_documento',
                           'pagos', 'boletas', 'resoluciones_cita', 'liquidaciones', 'preferencias_notificacion',
                           'recordatorios_cita', 'adjuntos_ficha', 'politicas', 'aceptaciones_politica', 'resenas_eventos',
                           'altas_paciente', 'accesos_clinicos_temporales', 'imagenes_publicas'] LOOP
    BEGIN
      EXECUTE format('DELETE FROM %I', t);
      RAISE EXCEPTION 'caso 67: DELETE % debio fallar', t;
    EXCEPTION WHEN restrict_violation THEN NULL; END;
  END LOOP;
  BEGIN
    UPDATE historial_accesos_practicante SET motivo = 'x';
    RAISE EXCEPTION 'caso 67: UPDATE historial debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    UPDATE supervision_comentarios SET texto = test.cif('x');
    RAISE EXCEPTION 'caso 67: UPDATE comentarios debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    UPDATE eventos_llaves SET detalle = 'x';
    RAISE EXCEPTION 'caso 67: UPDATE eventos de llaves debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    UPDATE llaves_datos SET canario = '\x00';
    RAISE EXCEPTION 'caso 67: UPDATE canario debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    UPDATE llaves_datos SET version = version + 10;
    RAISE EXCEPTION 'caso 67: UPDATE version debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  -- 02h: monto de la cita, pagos (solo anular) y liquidaciones emitidas, incluso dueño.
  BEGIN
    UPDATE citas SET monto = monto + 1 WHERE monto IS NOT NULL;
    RAISE EXCEPTION 'caso 67: cambiar el monto de una cita debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    UPDATE pagos SET monto = monto + 1;
    RAISE EXCEPTION 'caso 67: UPDATE pagos debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    UPDATE liquidaciones SET total_cobrado = 0, comision = 0, arriendos = 0, total = 0 WHERE estado <> 'BORRADOR';
    RAISE EXCEPTION 'caso 67: UPDATE liquidacion emitida debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
END $$;

\echo 78 Sin texto plano: toda columna bytea cifrada tiene el formato; seed sin datos sensibles; copia de autoria intacta tras cerrar cuentas
DO $$ DECLARE c record; n int; BEGIN
  FOR c IN SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND data_type = 'bytea' AND column_name NOT LIKE '%hmac'
             -- sesiones y tokens_correo guardan SHA-256 de tokens (bytea sin cifrar, como las sesiones).
             AND table_name NOT IN ('llaves_datos', 'sesiones', 'tokens_correo', 'imagenes_publicas') LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I IS NOT NULL AND (get_byte(%I, 0) <> 1 OR octet_length(%I) < 49)',
                   c.table_name, c.column_name, c.column_name, c.column_name) INTO n;
    ASSERT n = 0, format('caso 78: %s.%s con valores sin formato cifrado', c.table_name, c.column_name);
    EXECUTE format('SELECT count(*) FROM %I WHERE position(convert_to(''11111111'', ''UTF8'') IN %I) > 0', c.table_name, c.column_name) INTO n;
    ASSERT n = 0, format('caso 78: %s.%s contiene un RUT en claro', c.table_name, c.column_name);
  END LOOP;
  ASSERT (SELECT count(*) FROM pacientes p JOIN usuarios u ON u.paciente_id = p.id
          WHERE u.email = 'paciente@centro-prueba.cl' AND (p.rut IS NOT NULL OR p.telefono IS NOT NULL)) = 0,
    'caso 78: el seed no guarda RUT ni telefono';
  ASSERT (SELECT bool_and(octet_length(autor_nombre) >= 49 AND octet_length(autor_rut) >= 49 AND octet_length(autor_registro) >= 49)
          FROM evoluciones WHERE autor_id IN (test.u('c2'), test.u('c3'))), 'caso 78: copia de autoria de cuentas cerradas';
  ASSERT (SELECT count(*) FROM custodios_llave WHERE hasta IS NULL) = 3, 'caso 78: tres custodios vigentes';
  ASSERT EXISTS (SELECT 1 FROM eventos_llaves WHERE tipo = 'APROVISIONAMIENTO'), 'caso 78: aprovisionamiento registrado';
END $$;

DROP SCHEMA test CASCADE;
\echo TODOS LOS CASOS OK
