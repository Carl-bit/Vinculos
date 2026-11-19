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
-- 134: prompt 03b-4.1 (segundo factor por correo, login por RUT, presupuesto del match); 135-136: pendientes de 03b-4.1 (retenciones ajenas, purga de codigos como dueño). 127-128: prompt 03b-3.1 (confirmacion por medio de pago; 128 como dueño). 45-67: prompt 01d. 68-78: prompt 01e. 79-84: prompt 01f. 85: prompt 01g. 101-115: prompt 03a-1 (roles por cuenta, cuentas y tokens, politicas, menores, agenda, solicitudes sin cuenta, acceso temporal (lista de espera retirada en 107 y 124), borradores, alta, reseñas, reportes, contenido publico, liquidacion por cita realizada); 03a agrega a 67 las tablas append-only nuevas y a 78 excluye imagenes_publicas (publicas, sin cifrar). 86-87: prompt 02a (sesiones, alertas). 88-89: 02f/02g (notificaciones, portal). 90-95: 02h (documentos clinicos, avisos de derivacion, videollamada y feed, cobros). 96-99: 02i (plantillas, preferencias, adjuntos de la ficha, recordatorios y SEQUENCE); 02i redefinio 88 (mensajes solo via notificar(), un canal por fila, cola con backoff) y 91 (un aviso pendiente por canal); 02h redefinio 32, 52, 53 (pagos y boletas solo via funciones, arriendos por periodo), 51 (el profesional propone tipos de atencion) y 71 (pago pendiente = saldo > 0). 01c redefinio 12, 14 y 27 (aceptar una
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

-- MVP sin cobros ni finanzas (2026-11-16): no hay modulo COBROS ni tablas de pagos.
-- La suite crea varias cuentas madre: sin maximo (el caso 167 lo prueba).
UPDATE configuracion_centro SET max_cuentas_madre = NULL;

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
-- 2026-11-08: el sitio publico solo muestra profesionales validados (registro
-- SIS verificado + titulo verificado). Dato de prueba como dueño: un registro
-- verificado y un titulo verificado "de fondo" (id md5) para los casos que
-- prueban el sitio publico sin pasar por la validacion.
CREATE FUNCTION test.validar(u uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO registros_sis (profesional_id, numero, estado, metodo, verificado_en)
  VALUES (u, '9' || (abs(hashtext(u::text)) % 100000)::text, 'VERIFICADO_AUTOMATICO', 'AUTOMATICO', now())
  ON CONFLICT (profesional_id) DO UPDATE SET estado = 'VERIFICADO_AUTOMATICO', metodo = 'AUTOMATICO', verificado_en = now();
  INSERT INTO profesional_trayectoria (id, profesional_id, tipo, titulo, institucion, anio, verificado, verificado_por_id, verificado_en)
  VALUES (md5('validar ' || u)::uuid, u, 'TITULO', 'T Titulo de fondo', 'U. de Prueba', 2010, true, test.u('a1'), now())
  ON CONFLICT (id) DO NOTHING;
$$;
CREATE FUNCTION test.quitar_titulo_de_fondo(u uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM profesional_trayectoria WHERE id = md5('validar ' || u)::uuid;
$$;
GRANT EXECUTE ON FUNCTION test.validar(uuid), test.quitar_titulo_de_fondo(uuid) TO app_user;
CREATE FUNCTION test.box_de(u uuid) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT md5('box ' || u)::uuid
$$;
-- 03b: la agenda sale de los bloques de box. Cada uno recibe un box propio
-- ("T Box agenda <id>") apartado de 2024 a +3 años: sus citas presenciales
-- usan ese box (lo fija la BD), no el espacio_id que pase el INSERT.
CREATE FUNCTION test.disponible_siempre(usuarios uuid[]) RETURNS void LANGUAGE sql AS $$
  INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
  SELECT u, d, 0, 1440, m::modalidad_atencion
  FROM unnest(usuarios) u, generate_series(1, 7) d, unnest(ARRAY['PRESENCIAL', 'ONLINE']) m;
  INSERT INTO espacios (id, nombre) SELECT test.box_de(u), 'T Box agenda ' || u FROM unnest(usuarios) u;
  -- Un bloque de años cruza dias: no cabe en el horario de un dia; dato de prueba como dueño.
  ALTER TABLE bloques_atencion DISABLE TRIGGER bloques_atencion_validos;
  INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin)
  SELECT u, test.box_de(u), '2024-01-01 00:00-03', now() + interval '3 years' FROM unnest(usuarios) u;
  ALTER TABLE bloques_atencion ENABLE TRIGGER bloques_atencion_validos;
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
-- 03a-2: todo paciente necesita RUT antes de su primera evolucion.
UPDATE pacientes SET rut = test.cif('rut ' || id), rut_hmac = sha256(convert_to('rut ' || id, 'UTF8')) WHERE rut IS NULL AND id::text LIKE '00000000-%';
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
-- Sin dias el centro esta cerrado (2026-11-05): los casos corren con el centro abierto todo el dia.
INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) SELECT d, 0, 1440 FROM generate_series(1, 7) d;
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
\echo 1  EXCLUDE box (03b): la cita presencial usa el box del bloque; otro profesional no aparta ese box a la misma hora -> 23P01
DO $$ BEGIN
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e1'), test.u('b1'), test.u('0a'), '2025-11-02 10:00-03', '2025-11-02 11:00-03');
  ASSERT (SELECT espacio_id FROM citas WHERE profesional_id = test.u('b1') AND inicio = '2025-11-02 10:00-03')
         = test.box_de(test.u('b1')), 'caso 1: box del bloque';
  BEGIN
    INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin) VALUES
      (test.u('b5'), test.box_de(test.u('b1')), '2027-01-04 10:30-03', '2027-01-04 11:30-03');
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
-- caso 25).
INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
  (test.u('e2'), test.u('c1'), test.u('0c'), '2025-11-03 10:00-03', '2025-11-03 11:00-03');

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
-- 01c: configuracion, usuarios, citas/adultos por rol, PACIENTE, ocupacion.
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
  -- 03b: la ocupacion son los bloques apartados (6 de disponible_siempre); las citas caen dentro.
  ASSERT (SELECT count(*) FROM ocupacion_espacios('2025-11-02 00:00-03', '2025-11-03 00:00-03')) = 6, 'caso 34: ocupacion';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'ocupacion_espacios') = '{desde,hasta,espacio_id,inicio,fin}',
    'caso 34: columnas expuestas';
  -- sesiones_espacios: cada sesion del box, tambien las ajenas, sin quien.
  ASSERT EXISTS (SELECT 1 FROM sesiones_espacios('2025-11-02 00:00-03', '2025-11-04 00:00-03')), 'caso 34: sesiones del box';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'sesiones_espacios') = '{desde,hasta,espacio_id,inicio,fin}',
    'caso 34: sesiones_espacios sin quien';
  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    PERFORM * FROM sesiones_espacios('2025-11-02 00:00-03', '2025-11-03 00:00-03');
    RAISE EXCEPTION 'caso 34: el paciente no ve sesiones de box';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 35 EXCLUDE detecta choque con un bloque que el contexto no ve -> 23P01
DO $$ BEGIN
  PERFORM test.ctx('b5', 'PROFESIONAL');
  -- 03b: el box de p1 esta apartado por p1 (bloque que p5 no ve).
  ASSERT NOT EXISTS (SELECT 1 FROM bloques_atencion WHERE espacio_id = test.box_de(test.u('b1'))), 'caso 35: lo ve';
  INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id) VALUES
    (test.u('b5'), test.box_de(test.u('b1')), '2027-01-04 11:15-03', '2027-01-04 11:45-03', test.u('b5'));
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
-- 03a-2: todo paciente necesita RUT antes de su primera evolucion.
UPDATE pacientes SET rut = test.cif('rut ' || id), rut_hmac = sha256(convert_to('rut ' || id, 'UTF8')) WHERE rut IS NULL AND id::text LIKE '00000000-%';
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
         -- 03b: bloques de box (liberar; el trigger impide si tienen citas o retenciones).
         -- 03b-4.2: recordatorios personales (lista de tareas del autor, no son ficha).
         -- Punto 38: contactos de emergencia (dato de contacto que el paciente agrega y elimina; no son ficha).
         -- Punto 36: perfiles de rol y sus asignaciones (configuracion del centro; ADMIN los quita).
         = 'bloqueos_agenda,bloqueos_temporales,bloques_atencion,borradores_evolucion,contactos_emergencia,disponibilidad_profesional,horario_centro,horarios_espacio,'
           || 'perfiles_rol,profesional_tipos_atencion,profesional_trayectoria,recordatorios_personales,usuario_perfiles',
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
  -- 2026-11-08: publicado pero sin validar no sale en el sitio.
  ASSERT NOT EXISTS (SELECT 1 FROM perfiles_publicos()), 'caso 49: sin validar no es publico';
  PERFORM test.validar(test.u('b1'));
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

\echo 54 espacios (B): autenticados leen; ADMIN/GESTION escriben; DELETE nunca
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM espacios WHERE nombre NOT LIKE 'T Box agenda %') = 2, 'caso 54: PACIENTE lee';
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
  -- 03b: el soft-lock presencial usa el box del bloque de p1, que ya figura ocupado (sin profesional).
  ASSERT EXISTS (SELECT 1 FROM ocupacion_espacios(test.dia(2, 0), test.dia(3, 0))
                 WHERE espacio_id = test.box_de(test.u('b1')) AND inicio <= test.dia(2, 10) AND fin >= test.dia(2, 11)),
    'caso 55: ocupacion incluye el box del bloqueo';
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
         -- 03a-2: plantilla y valores (la API entrega solo los campos visibles en supervision).
         = '{p_codigo,evolucion_id,autor_id,tipo_sesion,intervenciones,estado_avance,nivel_riesgo,notas,corrige_a_id,creado_en,'
           'plantilla_id,valores}',
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
  PERFORM responder_consentimiento(test.id('cons_fede'), true, '1', 'PACIENTE', NULL, 'doc-1');
  RAISE EXCEPTION 'caso 64: supervisor registra debio fallar';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM responder_consentimiento(test.id('cons_fede'), true, '1', 'PACIENTE', NULL, NULL);
    RAISE EXCEPTION 'caso 64: GESTION sin respaldo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- 03b-5: aceptar exige la version vigente de CONSENTIMIENTO_PRACTICANTE.
  BEGIN
    PERFORM responder_consentimiento(test.id('cons_fede'), true, 'v-vieja', 'PACIENTE', NULL, 'escaneo-firma-fede.pdf');
    RAISE EXCEPTION 'caso 64: version que no es la vigente debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM responder_consentimiento(test.id('cons_fede'), true, '1', 'PACIENTE', NULL, 'escaneo-firma-fede.pdf');
  ASSERT (SELECT version_documento FROM consentimientos WHERE id = test.id('cons_fede'))
         = (SELECT version::text FROM politica_vigente('CONSENTIMIENTO_PRACTICANTE')), 'caso 64: guarda la version vigente';
  BEGIN
    PERFORM responder_consentimiento(test.id('cons_fede'), true, '1', 'PACIENTE', NULL, 'otra');
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

\echo 68 Llaves: app_user no lee tablas de llaves ni identidad_silo (R11); llaves_vigentes sin la envoltura de recuperacion; eventos solo de verificacion
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['llaves_datos', 'custodios_llave', 'eventos_llaves', 'identidad_silo'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM %I', t);
      RAISE EXCEPTION 'caso 68: app_user lee % debio fallar', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  -- 2026-11-16: sin FINANCIERO (MVP sin cobros): IDENTIFICACION, CLINICO y HMAC.
  ASSERT (SELECT count(*) FROM llaves_vigentes()) = 3 AND (SELECT count(*) FROM llaves_vigentes() WHERE activa) = 3,
    'caso 68: 3 DEK aprovisionadas y activas, sin contexto';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'llaves_vigentes')
         = '{id,categoria,version,activa,dek_por_kek,huella_kek,canario}', 'caso 68: sin dek_por_recuperacion';
  PERFORM registrar_evento_llaves('VERIFICACION', 'canarios OK al arrancar');
  BEGIN
    PERFORM registrar_evento_llaves('ROTACION', 'x');
    RAISE EXCEPTION 'caso 68: la API registra ROTACION debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM registrar_evento_llaves('RETIRO_CATEGORIA', 'x');
    RAISE EXCEPTION 'caso 68: la API registra RETIRO_CATEGORIA debio fallar';
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
  PERFORM test.quitar_titulo_de_fondo(test.u('b1'));
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO profesional_trayectoria (id, profesional_id, tipo, titulo, institucion, anio, registro_superintendencia, verificado)
  VALUES (test.u('7a'), test.u('b1'), 'TITULO', 'T Psicologo', 'U. de Prueba', 2015, '123456', true);
  ASSERT NOT (SELECT verificado FROM profesional_trayectoria WHERE id = test.u('7a')), 'caso 70: el propio no se autoverifica';
  -- 2026-11-07: verificar exige respaldo (caso 159).
  PERFORM subir_respaldo_trayectoria(test.u('7b'), test.u('7a'), 'titulo.pdf', 'application/pdf', 10, test.cif('pdf del titulo'));
  BEGIN
    UPDATE profesional_trayectoria SET verificado = true WHERE id = test.u('7a');
    RAISE EXCEPTION 'caso 70: el propio verifica debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO profesional_datos_privados (usuario_id, rut, rut_hmac)
  VALUES (test.u('b1'), test.cif('11.111.111-1'), sha256('111111111'));
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM profesional_trayectoria) = 0 AND (SELECT count(*) FROM profesional_datos_privados) = 0,
    'caso 70: otro profesional no ve trayectoria ni datos privados ajenos';
  INSERT INTO profesional_datos_privados (usuario_id, rut, rut_hmac) VALUES (test.u('b1'), test.cif('x'), sha256('x'));
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
  -- 2026-11-08: sin titulo verificado deja de estar validado y sale del sitio.
  ASSERT NOT EXISTS (SELECT 1 FROM perfiles_publicos() WHERE id = test.u('b1')), 'caso 70: sin titulo verificado no es publico';
  PERFORM test.validar(test.u('b1'));
  ASSERT (SELECT verificado FROM perfiles_publicos() WHERE id = test.u('b1')), 'caso 70: validado de nuevo';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM profesional_trayectoria) = 0 AND (SELECT count(*) FROM profesional_datos_privados) = 0,
    'caso 70: PACIENTE no lee';
END $$;

\echo 72 Agenda por modalidad: box solo presencial; online choca por profesional y no por box; disponibilidad y bloqueos; huecos publicos sin motivos
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  -- 03b: el box lo fija la BD (el del bloque si es presencial, ninguno si es online).
  BEGIN
    INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e1'), 'ONLINE', test.u('b1'), test.u('0a'), test.dia(10, 10), test.dia(10, 11));
    ASSERT (SELECT espacio_id FROM citas WHERE profesional_id = test.u('b1') AND inicio = test.dia(10, 10)) IS NULL,
      'caso 72: online sin box';
    RAISE EXCEPTION USING ERRCODE = 'T0001';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL; END;
  BEGIN
    INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      (NULL, 'PRESENCIAL', test.u('b1'), test.u('0a'), test.dia(10, 10), test.dia(10, 11));
    ASSERT (SELECT espacio_id FROM citas WHERE profesional_id = test.u('b1') AND inicio = test.dia(10, 10))
           = test.box_de(test.u('b1')), 'caso 72: presencial con el box del bloque';
    RAISE EXCEPTION USING ERRCODE = 'T0001';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL; END;
  INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    (NULL, 'ONLINE', test.u('b1'), test.u('0a'), test.dia(10, 10), test.dia(10, 11)),
    (test.u('e1'), 'PRESENCIAL', test.u('b2'), test.u('0b'), test.dia(10, 10), test.dia(10, 11)),
    (NULL, 'ONLINE', test.u('b4'), test.u('0a'), test.dia(10, 10), test.dia(10, 11));
  BEGIN
    INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      (test.u('e2'), 'PRESENCIAL', test.u('b1'), test.u('0a'), test.dia(10, 10), test.dia(10, 11));
    RAISE EXCEPTION 'caso 72: presencial que choca con la online del mismo profesional debio fallar';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  -- b5 (03b): GESTION le aparta un box de lunes a viernes 09-13 (solo presencial: no tiene horario online).
  INSERT INTO espacios (id, nombre) VALUES (test.box_de(test.u('b5')), 'T Box agenda b5');
  INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id)
  SELECT test.u('b5'), test.box_de(test.u('b5')), test.lunes(d, 9), test.lunes(d, 13), test.u('a3') FROM generate_series(0, 4) d;
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
      (NULL, 'ONLINE', test.u('b5'), test.u('12'), test.lunes(0, 14), test.lunes(0, 15));
    RAISE EXCEPTION 'caso 72: online sin horario online debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- GESTION aparta por otro: sabado 10-12.
  INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id)
  VALUES (test.u('b5'), test.box_de(test.u('b5')), test.lunes(5, 10), test.lunes(5, 12), test.u('a3'));
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
DO $$ DECLARE n int; huecos text[]; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM bloqueos_agenda) = 0 AND (SELECT count(*) FROM disponibilidad_profesional WHERE profesional_id = test.u('b5')) = 0,
    'caso 72: agenda ajena no visible';
  BEGIN
    INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
    VALUES (test.u('b5'), 7, 600, 720, 'ONLINE');
    RAISE EXCEPTION 'caso 72: editar disponibilidad ajena debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM bloques_atencion WHERE profesional_id = test.u('b5')) = 0, 'caso 72: bloques ajenos no visibles';
  -- 2026-11-18: presencial = bloques dentro de su horario presencial (el bloque del sabado queda fuera);
  -- online = su horario online (b5 no tiene: no atiende online aunque tenga box apartado). Antes de la cita del
  -- lunes 10:00 el hueco cierra 09:50 (la sesion de 50 min de las 09:00 cierra su hora clinica).
  SELECT array_agg(modalidad::text || ' ' || to_char(inicio AT TIME ZONE 'America/Santiago', 'ID HH24:MI') || '-'
                   || to_char(fin AT TIME ZONE 'America/Santiago', 'HH24:MI') ORDER BY inicio, modalidad::text) INTO huecos
  FROM disponibilidad_publica(test.u('b5'), test.lunes(0, 0), test.lunes(7, 0));
  ASSERT huecos
         = ARRAY['PRESENCIAL 1 09:00-09:50', 'PRESENCIAL 1 11:00-13:00', 'PRESENCIAL 3 09:00-13:00',
                 'PRESENCIAL 4 09:00-13:00', 'PRESENCIAL 5 09:00-13:00'],
    format('caso 72: huecos (sin la cita del lunes, las vacaciones del martes ni el sabado fuera de horario) %s', huecos);
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'disponibilidad_publica')
         = '{p_profesional_id,desde,hasta,modalidad,inicio,fin}', 'caso 72: sin motivos';
  BEGIN
    PERFORM disponibilidad_publica(test.u('b5'), now(), now() + interval '90 days');
    RAISE EXCEPTION 'caso 72: rango largo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  n := (SELECT count(*) FROM ocupacion_espacios(test.dia(11, 0), test.dia(12, 0)));
  INSERT INTO bloqueos_temporales (modalidad, usuario_id, profesional_id, inicio, fin, expira_en) VALUES
    ('ONLINE', test.u('b1'), test.u('b1'), test.dia(11, 10), test.dia(11, 11), now() + interval '5 minutes');
  ASSERT (SELECT count(*) FROM ocupacion_espacios(test.dia(11, 0), test.dia(12, 0))) = n, 'caso 72: soft-lock online no ocupa box';
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
    PERFORM responder_consentimiento(v, true, '1', 'PACIENTE', NULL, 'doc');
    RAISE EXCEPTION 'caso 73: menor responde solo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM responder_consentimiento(v, true, '1', 'ADULTO_RESPONSABLE', v_pareja, 'doc');
    RAISE EXCEPTION 'caso 73: adulto de otro paciente debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM responder_consentimiento(v, true, '1', 'ADULTO_RESPONSABLE', v_mama, 'firma-mama.pdf');
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
  PERFORM responder_consentimiento(v, true, '1', 'PACIENTE', NULL, 'tarde');
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
-- 03a-2: todo paciente necesita RUT antes de su primera evolucion.
UPDATE pacientes SET rut = test.cif('rut ' || id), rut_hmac = sha256(convert_to('rut ' || id, 'UTF8')) WHERE rut IS NULL AND id::text LIKE '00000000-%';
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

\echo 84 Sin margen de traslado; hora clinica: online y presencial alternadas a la hora; nadie agenda en el resto de la hora; huecos; enlace online
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  -- 2026-11-18: presencial, online, presencial seguidas (sesiones de 50 min a la hora en punto): sin margen.
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    ('PRESENCIAL', test.u('b2'), test.u('0a'), test.dia(20, 10), test.dia(20, 10) + interval '50 minutes'),
    ('ONLINE', test.u('b2'), test.u('0a'), test.dia(20, 11), test.dia(20, 11) + interval '50 minutes'),
    ('PRESENCIAL', test.u('b2'), test.u('0a'), test.dia(20, 12), test.dia(20, 12) + interval '50 minutes');
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      ('ONLINE', test.u('b2'), test.u('0a'), test.dia(20, 12) + interval '55 minutes', test.dia(20, 13) + interval '45 minutes');
    RAISE EXCEPTION 'caso 84: cita dentro de la hora de otra debio fallar';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
      ('ONLINE', test.u('b2'), test.u('0a'), test.dia(20, 9) + interval '10 minutes', test.dia(20, 10));
    RAISE EXCEPTION 'caso 84: su hora clinica pisa la cita siguiente debio fallar';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
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
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b2'), test.dia(20, 0), test.dia(21, 0))
                 WHERE modalidad = 'ONLINE' AND fin = test.dia(20, 9) + interval '50 minutes'),
    'caso 84: el hueco termina 10 min antes de la sesion siguiente';
  ASSERT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b2'), test.dia(20, 0), test.dia(21, 0))
                 WHERE modalidad = 'ONLINE' AND inicio = test.dia(20, 13)),
    'caso 84: el hueco empieza al terminar la hora clinica';
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b2'), test.dia(20, 0), test.dia(21, 0))
                     WHERE tstzrange(inicio, fin) && tstzrange(test.dia(20, 10) + interval '50 minutes', test.dia(20, 11))),
    'caso 84: el resto de la hora no se ofrece';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('margen_vigente', 'citas_en_conflicto_margen', 'rango_con_margen'))
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name IN ('margen_traslado_min', 'en_centro')),
    'caso 84: el margen de traslado ya no existe';
END $$;

\echo 84b Quitar un dia del horario: sus sesiones futuras de esa modalidad pasan a por reprogramar con aviso; las de otra modalidad no
DO $$ DECLARE v_online uuid; v_presencial uuid; v_dow int := extract(isodow FROM test.dia(30, 12) AT TIME ZONE 'America/Santiago')::int; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    ('ONLINE', test.u('b2'), test.u('0a'), test.dia(30, 12), test.dia(30, 13)) RETURNING id INTO v_online;
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    ('PRESENCIAL', test.u('b2'), test.u('0a'), test.dia(30, 14), test.dia(30, 15)) RETURNING id INTO v_presencial;
  DELETE FROM disponibilidad_profesional WHERE profesional_id = test.u('b2') AND dia_semana = v_dow AND modalidad = 'ONLINE';
  ASSERT (SELECT estado FROM citas WHERE id = v_online) = 'POR_REPROGRAMAR', 'caso 84b: la online del dia quitado queda por reprogramar';
  ASSERT (SELECT estado FROM citas WHERE id = v_presencial) = 'CONFIRMADA', 'caso 84b: la presencial sigue (su horario no cambio)';
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE tipo = 'CITA_AUSENCIA_PROFESIONAL' AND referencia_id = v_online),
    'caso 84b: aviso al paciente';
  ASSERT (SELECT motivo_reprogramacion FROM citas WHERE id = v_online) = 'DIA_SIN_ATENCION', 'caso 84b: motivo dia sin atencion';
  INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
  VALUES (test.u('b2'), v_dow, 0, 1440, 'ONLINE');
  -- Apagar el dia con un clic (activo = false) conserva el horario y reprograma igual; encenderlo lo devuelve.
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    ('ONLINE', test.u('b2'), test.u('0a'), test.dia(30, 16), test.dia(30, 17)) RETURNING id INTO v_online;
  UPDATE disponibilidad_profesional SET activo = false WHERE profesional_id = test.u('b2') AND dia_semana = v_dow;
  ASSERT (SELECT estado FROM citas WHERE id = v_online) = 'POR_REPROGRAMAR', 'caso 84b: apagar el dia reprograma';
  ASSERT (SELECT estado FROM citas WHERE id = v_presencial) = 'POR_REPROGRAMAR', 'caso 84b: el dia apagado reprograma tambien la presencial';
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b2'), test.dia(30, 0), test.dia(31, 0)) WHERE modalidad = 'ONLINE'),
    'caso 84b: dia apagado sin horas online';
  UPDATE disponibilidad_profesional SET activo = true WHERE profesional_id = test.u('b2') AND dia_semana = v_dow;
  ASSERT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b2'), test.dia(30, 0), test.dia(31, 0)) WHERE modalidad = 'ONLINE'),
    'caso 84b: encender el dia devuelve sus horas';
  UPDATE citas SET estado = 'CANCELADA' WHERE id = v_online;
  ASSERT (SELECT motivo_reprogramacion FROM citas WHERE id = v_online) IS NULL, 'caso 84b: el motivo se limpia al salir de por reprogramar';
END $$;

\echo 84c Reactivar el dia: la hora original libre se avisa (HORA_DISPONIBLE) y el paciente la mantiene; con otra hora pedida, elige
DO $$ DECLARE v_orig uuid; v_otra uuid; v_dow int := extract(isodow FROM test.dia(32, 12) AT TIME ZONE 'America/Santiago')::int; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    ('ONLINE', test.u('b2'), test.u('0a'), test.dia(32, 12), test.dia(32, 13)) RETURNING id INTO v_orig;
  UPDATE disponibilidad_profesional SET activo = false WHERE profesional_id = test.u('b2') AND dia_semana = v_dow;
  ASSERT (SELECT motivo_reprogramacion FROM citas WHERE id = v_orig) = 'DIA_SIN_ATENCION', 'caso 84c: por reprogramar';
  -- Mientras tanto el paciente pidio otra hora (otro dia).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    ('ONLINE', test.u('b2'), test.u('0a'), test.dia(33, 12), test.dia(33, 13)) RETURNING id INTO v_otra;
  UPDATE disponibilidad_profesional SET activo = true WHERE profesional_id = test.u('b2') AND dia_semana = v_dow;
  ASSERT (SELECT motivo_reprogramacion FROM citas WHERE id = v_orig) = 'HORA_DISPONIBLE', 'caso 84c: hora original disponible';
  ASSERT (SELECT count(*) FROM notificaciones WHERE tipo = 'CITA_HORA_DISPONIBLE' AND referencia_id = v_orig AND canal = 'BANDEJA') = 1,
    'caso 84c: un solo aviso (dos filas del dia reactivadas)';
  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    PERFORM mantener_hora_original(v_orig, test.u('ff'));
    RAISE EXCEPTION 'caso 84c: cancelar una cita ajena debio fallar';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  ASSERT mantener_hora_original(v_orig, v_otra) = 'CONFIRMADA', 'caso 84c: mantiene la original';
  ASSERT (SELECT estado FROM citas WHERE id = v_orig) = 'CONFIRMADA'
         AND (SELECT motivo_reprogramacion FROM citas WHERE id = v_orig) IS NULL, 'caso 84c: original confirmada y sin motivo';
  ASSERT (SELECT estado FROM citas WHERE id = v_otra) = 'CANCELADA', 'caso 84c: la otra se cancela';
  BEGIN
    PERFORM mantener_hora_original(v_orig, NULL);
    RAISE EXCEPTION 'caso 84c: mantener dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;

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

\echo 141 Trazabilidad (AUD-01 E1.5) como app_user: editar datos de un paciente deja ESCRITURA con usuario, rol activo y nombres de campos (nunca valores); registro_exportaciones: cada uno inserta lo suyo, solo ADMIN lee, sin UPDATE
DO $$ DECLARE v_email text; v_detalle text; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  SELECT email INTO v_email FROM pacientes WHERE id = test.u('0a');
  UPDATE pacientes SET email = 'nuevo-141@x.cl' WHERE id = test.u('0a');
  UPDATE pacientes SET email = v_email WHERE id = test.u('0a');
  PERFORM test.ctx('a1', 'ADMIN');
  SELECT detalle INTO v_detalle FROM accesos_ficha
  WHERE paciente_id = test.u('0a') AND usuario_id = test.u('a3') AND rol = 'GESTION' AND recurso = 'pacientes' AND accion = 'ESCRITURA'
  ORDER BY ocurrido_en DESC LIMIT 1;
  ASSERT v_detalle = 'campos: email', format('caso 141: detalle %s', v_detalle);
  ASSERT NOT EXISTS (SELECT 1 FROM accesos_ficha WHERE detalle LIKE '%nuevo-141%'), 'caso 141: nunca el valor';
  -- Exportaciones sin paciente.
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO registro_exportaciones (usuario_id, rol, recurso, detalle) VALUES (test.u('a3'), 'GESTION', 'exportacion_centro', 'periodo prueba');
  BEGIN
    INSERT INTO registro_exportaciones (usuario_id, rol, recurso) VALUES (test.u('a1'), 'ADMIN', 'exportacion_centro');
    RAISE EXCEPTION 'caso 141: insertar a nombre de otro debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM registro_exportaciones) = 0, 'caso 141: GESTION no lee';
  BEGIN
    UPDATE registro_exportaciones SET detalle = 'x';
    RAISE EXCEPTION 'caso 141: UPDATE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM registro_exportaciones WHERE usuario_id = test.u('a3') AND recurso = 'exportacion_centro') = 1, 'caso 141: ADMIN lee';
END $$;

\echo 143 Soporte (AUD-01 E2.1) como app_user: solo ADMIN autoriza (1 a 72 h) y revoca; solo ADMIN lee autorizaciones y registro; la API no ejecuta funciones del soporte; sin escritura directa
DO $$ DECLARE v uuid; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM otorgar_soporte('Prueba de soporte', 'DIAGNOSTICO', 2);
    RAISE EXCEPTION 'caso 143: GESTION autoriza debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM autorizaciones_soporte) = 0, 'caso 143: GESTION no lee';
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM otorgar_soporte('Prueba de soporte', 'DIAGNOSTICO', 100);
    RAISE EXCEPTION 'caso 143: mas de 72 h debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v := otorgar_soporte('Prueba de soporte', 'CONFIGURACION', 1);
  ASSERT (SELECT otorgada_por_id = test.u('a1') AND hasta <= now() + interval '1 hour' FROM autorizaciones_soporte WHERE id = v),
    'caso 143: ADMIN otorga';
  BEGIN
    PERFORM soporte_resumen();
    RAISE EXCEPTION 'caso 143: app_user ejecuta soporte_resumen debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO autorizaciones_soporte (motivo, alcance, hasta, otorgada_por_id) VALUES ('directo', 'DIAGNOSTICO', now() + interval '1 hour', test.u('a1'));
    RAISE EXCEPTION 'caso 143: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM revocar_soporte(v);
  BEGIN
    PERFORM revocar_soporte(v);
    RAISE EXCEPTION 'caso 143: revocar dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;

\connect :owner_url
-- AUD-01 (E2.2): el contrato lo publica el operador como dueño.
INSERT INTO politicas (tipo, version, texto) VALUES ('DPA', 0, 'Anexo de tratamiento de datos de prueba (caso 144).');
\connect :app_url
\echo 144 Contrato del centro (AUD-01 E2.2) como app_user: ADMIN no publica terminos ni DPA; solo ADMIN los lee (ni GESTION ni sin contexto); pendiente hasta que un ADMIN acepta la version vigente; aceptar es idempotente y solo ADMIN
DO $$ DECLARE v timestamptz; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    INSERT INTO politicas (tipo, version, texto) VALUES ('DPA', 0, 'DPA escrito por el centro (no debe poder)');
    RAISE EXCEPTION 'caso 144: ADMIN publica DPA debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM politica_vigente('DPA')) = 1, 'caso 144: ADMIN lee el DPA';
  ASSERT EXISTS (SELECT 1 FROM contratos_pendientes() WHERE tipo = 'DPA'), 'caso 144: DPA pendiente';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM politicas WHERE tipo IN ('DPA', 'TERMINOS_SERVICIO')) = 0, 'caso 144: GESTION no lee';
  ASSERT (SELECT count(*) FROM politica_vigente('DPA')) = 0, 'caso 144: politica_vigente no lo entrega a GESTION';
  BEGIN
    PERFORM aceptar_contrato('DPA');
    RAISE EXCEPTION 'caso 144: GESTION acepta debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (SELECT count(*) FROM politica_vigente('DPA')) = 0, 'caso 144: sin contexto no lo entrega';
  PERFORM test.ctx('a1', 'ADMIN');
  v := aceptar_contrato('DPA');
  ASSERT aceptar_contrato('DPA') = v, 'caso 144: idempotente';
  ASSERT NOT EXISTS (SELECT 1 FROM contratos_pendientes() WHERE tipo = 'DPA'), 'caso 144: ya no pendiente';
  ASSERT (SELECT count(*) FROM aceptaciones_contrato a JOIN politicas p ON p.id = a.politica_id
          WHERE p.tipo = 'DPA' AND a.usuario_id = test.u('a1')) = 1, 'caso 144: una aceptacion con version y quien';
  BEGIN
    PERFORM aceptar_contrato('POLITICA_DATOS');
    RAISE EXCEPTION 'caso 144: aceptar otro tipo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

\echo 145 Solicitudes de derechos (AUD-01 E2.3a) como app_user: dias habiles sin fines de semana ni feriados; solo ADMIN registra, lee y avanza; plazo 30 dias habiles fijado por la BD; cerrar exige respuesta; cerrada no se reabre; el formulario publico no se registra por aca
DO $$ DECLARE v uuid := gen_random_uuid(); v_vence date; BEGIN
  ASSERT dias_habiles_restantes('2000-01-01') = 0, 'caso 145: fecha pasada = 0';
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM registrar_solicitud_derecho(gen_random_uuid(), 'ACCESO', test.u('0a'), 'PRESENCIAL', NULL);
    RAISE EXCEPTION 'caso 145: GESTION registra debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM registrar_solicitud_derecho(gen_random_uuid(), 'ACCESO', NULL, 'FORMULARIO_PUBLICO', NULL);
    RAISE EXCEPTION 'caso 145: formulario publico por aca debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v_vence := registrar_solicitud_derecho(v, 'RECTIFICACION', test.u('0a'), 'PRESENCIAL', test.cif('Corregir el telefono'));
  ASSERT extract(isodow FROM v_vence) < 6 AND NOT EXISTS (SELECT 1 FROM feriados WHERE fecha = v_vence), 'caso 145: vence en dia habil';
  ASSERT (SELECT count(*) FROM generate_series((now() AT TIME ZONE 'America/Santiago')::date + 1, v_vence, interval '1 day') d
          WHERE extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM feriados f WHERE f.fecha = d::date)) = 30,
    'caso 145: 30 dias habiles';
  BEGIN
    PERFORM avanzar_solicitud_derecho(v, 'RESUELTA', NULL);
    RAISE EXCEPTION 'caso 145: resolver sin respuesta debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM avanzar_solicitud_derecho(v, 'EN_CURSO', NULL);
  PERFORM avanzar_solicitud_derecho(v, 'RESUELTA', test.cif('Telefono corregido en la ficha'));
  ASSERT (SELECT estado = 'RESUELTA' AND resuelta_por_id = test.u('a1') FROM solicitudes_derechos WHERE id = v), 'caso 145: resuelta';
  BEGIN
    PERFORM avanzar_solicitud_derecho(v, 'EN_CURSO', NULL);
    RAISE EXCEPTION 'caso 145: reabrir debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    UPDATE solicitudes_derechos SET tipo = 'ACCESO' WHERE id = v;
    RAISE EXCEPTION 'caso 145: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM solicitudes_derechos) = 0, 'caso 145: GESTION no lee';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM solicitudes_derechos) = 0, 'caso 145: PACIENTE no lee';
  BEGIN
    PERFORM alertar_solicitudes_por_vencer();
    RAISE EXCEPTION 'caso 145: el job con usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
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
  PERFORM notificar('CITA_CONFIRMADA', test.u('0e'), NULL, test.u('0e'));
  PERFORM notificar('CONSENTIMIENTO_SOLICITADO', test.u('0e'), NULL, test.u('0e'));
  PERFORM notificar('DOCUMENTO_CLINICO', test.u('0e'), NULL, test.u('0e'));
  ASSERT (SELECT array_agg(canal::text) FROM notificaciones WHERE tipo = 'CITA_CONFIRMADA' AND referencia_id = test.u('0e'))
         = ARRAY['BANDEJA'], 'caso 97: operativo desactivado: solo bandeja';
  ASSERT (SELECT count(*) FROM notificaciones WHERE tipo IN ('CONSENTIMIENTO_SOLICITADO', 'DOCUMENTO_CLINICO')
          AND referencia_id = test.u('0e') AND canal = 'CORREO') = 2, 'caso 97: avisos legales siempre por correo';
  UPDATE plantillas_mensaje SET activa = false WHERE evento = 'CITA_REPROGRAMADA' AND canal = 'CORREO';
  PERFORM notificar('CITA_REPROGRAMADA', test.u('0a'), NULL, test.u('0a'));
  ASSERT (SELECT array_agg(canal::text) FROM notificaciones WHERE tipo = 'CITA_REPROGRAMADA' AND referencia_id = test.u('0a'))
         = ARRAY['BANDEJA'], 'caso 97: plantilla de correo inactiva: solo bandeja';
  UPDATE plantillas_mensaje SET activa = true WHERE evento = 'CITA_REPROGRAMADA' AND canal = 'CORREO';
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
  UPDATE configuracion_centro SET recordatorio_horas_antes = 48, plazo_aviso_cancelacion_horas = 24;
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
  ASSERT r.vigente AND r.a_tiempo AND r.plazo_aviso_horas = 24 AND r.profesional IS NOT NULL, 'caso 99: consulta antes de cancelar';
  SELECT * INTO r FROM responder_recordatorio(repeat('e', 64), 'CANCELADA');
  ASSERT r.a_tiempo, 'caso 99: cancelacion a tiempo';
  BEGIN
    PERFORM responder_recordatorio(repeat('e', 64), 'CONFIRMADA');
    RAISE EXCEPTION 'caso 99: token usado dos veces debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM registrar_recordatorio(gen_random_uuid(), v_cita2, v_ini2, repeat('9', 64), test.cif('x'));
  SELECT * INTO r FROM responder_recordatorio(repeat('9', 64), 'CANCELADA');
  ASSERT NOT r.a_tiempo, 'caso 99: cancelacion tardia';
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
  UPDATE configuracion_centro SET recordatorio_horas_antes = 48;
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
-- 2026-11-08: validado (registro SIS y titulo verificados) para salir en el sitio publico.
SELECT test.validar(test.u('b9'));
INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES
  (test.u('14'), 'Tomas', 'Teen', (now() AT TIME ZONE 'America/Santiago')::date - interval '15 years', test.u('b2')),
  (test.u('15'), 'Lia', 'Adulta', '1988-05-05', test.u('b1'));
INSERT INTO fichas_clinicas (id, paciente_id) VALUES (test.u('f4'), test.u('14')), (test.u('f5'), test.u('15'));
INSERT INTO adultos_responsables (id, paciente_id, nombre, email) VALUES (test.u('d4'), test.u('14'), 'Papa Tomas', 't-papa@x');
INSERT INTO usuarios (id, email, password_hash, nombre, rol, paciente_id)
VALUES (test.u('a8'), 't-tomas@x', 'h', 'Tomas', 'PACIENTE', test.u('14'));
-- 03a-2: todo paciente necesita RUT antes de su primera evolucion.
UPDATE pacientes SET rut = test.cif('rut ' || id), rut_hmac = sha256(convert_to('rut ' || id, 'UTF8')) WHERE rut IS NULL AND id::text LIKE '00000000-%';
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
  ASSERT (SELECT usuario_id FROM cambiar_rol_sesion(sha256('t101a'), sha256('t101b'), 'PROFESIONAL', now() + interval '1 day')) = test.u('a3'),
    'caso 101: cambia de rol';
  ASSERT NOT EXISTS (SELECT 1 FROM cambiar_rol_sesion(sha256('t101a'), sha256('t101c'), 'PROFESIONAL', now() + interval '1 day')),
    'caso 101: el token anterior quedo revocado';
  ASSERT NOT EXISTS (SELECT 1 FROM cambiar_rol_sesion(sha256('t101b'), sha256('t101d'), 'ADMIN', now() + interval '1 day')), 'caso 101: rol ajeno';
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

\echo 104 Menores (D-4): el adolescente ve sus citas y mensajes; el adulto responsable ve sus citas, no los mensajes del adolescente; nadie del portal ve la ficha
DO $$ DECLARE v_cita uuid; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b2'), test.u('14'), test.dia(40, 10), test.dia(40, 11)) RETURNING id INTO v_cita;
  PERFORM test.ctx('a8', 'PACIENTE');
  ASSERT (SELECT count(*) FROM citas WHERE id = v_cita) = 1, 'caso 104: el adolescente ve su cita';
  ASSERT (SELECT count(*) FROM fichas_clinicas) = 0 AND (SELECT count(*) FROM evoluciones) = 0, 'caso 104: nunca la ficha';
  INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido)
  VALUES (test.u('6a'), test.u('14'), test.u('b2'), test.u('a8'), test.cif('hola'));
  BEGIN
    INSERT INTO solicitudes_epicrisis (id, paciente_id) VALUES (gen_random_uuid(), test.u('14'));
    RAISE EXCEPTION 'caso 104: la epicrisis la pide el adulto responsable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('aa', 'RESPONSABLE');
  ASSERT (SELECT array_agg(id) FROM pacientes) = ARRAY[test.u('14')], 'caso 104: el responsable ve a su menor';
  ASSERT (SELECT count(*) FROM citas WHERE id = v_cita) = 1, 'caso 104: citas del menor';
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

\echo 105 SOLICITADA solo la fija el flujo (la API no la inserta); lo que agenda el equipo queda CONFIRMADA; horario del centro y del box
DO $$ DECLARE v uuid; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin, estado)
    VALUES (test.u('e1'), test.u('b1'), test.u('15'), test.dia(41, 10), test.dia(41, 11), 'SOLICITADA');
    RAISE EXCEPTION 'caso 105: SOLICITADA solo la fija el flujo';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL; END;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e1'), test.u('b1'), test.u('15'), test.dia(41, 10), test.dia(41, 11)) RETURNING id INTO v;
  ASSERT (SELECT estado = 'CONFIRMADA' AND retencion_vence_en IS NULL FROM citas WHERE id = v), 'caso 105: lo que agenda el equipo queda confirmado';
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) VALUES (1, 540, 600);
    RAISE EXCEPTION 'caso 105: el horario del centro es de ADMIN';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  DELETE FROM horario_centro;
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
  -- 03b: la cita presencial de p1 usa el box de su bloque; ese box pasa a abrir 09-12.
  INSERT INTO horarios_espacio (espacio_id, dia_semana, inicio_min, fin_min)
  SELECT test.box_de(test.u('b1')), d, 540, 720 FROM generate_series(1, 7) d;
  BEGIN
    INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
    VALUES (test.u('e2'), test.u('b1'), test.u('15'), test.lunes(29, 14), test.lunes(29, 15));
    RAISE EXCEPTION 'caso 105: fuera del horario del box';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT bloques_fuera_de_horario(test.box_de(test.u('b1'))) = 1, 'caso 105: el bloque de p1 quedo fuera del horario nuevo';
  DELETE FROM horarios_espacio WHERE espacio_id = test.box_de(test.u('b1'));
  PERFORM test.ctx('a1', 'ADMIN');
  DELETE FROM horario_centro;
  INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) SELECT d, 0, 1440 FROM generate_series(1, 7) d;
END $$;

\echo 106 Solicitud de hora sin cuenta (D-2, 03b-3.2): retiene la hora (cita RETENIDA sin paciente, EXCLUDE); el enlace del correo (un solo uso) concreta paciente, ficha, aceptaciones y la cita SOLICITADA para su profesional; la API no toca la hora retenida; limites, menor, respuestas del match y RUT antes de la primera evolucion
DO $$ DECLARE v_pol uuid := (SELECT id FROM politica_vigente('POLITICA_DATOS'));
              v_ter uuid := (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')); r record; BEGIN
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  BEGIN
    PERFORM crear_solicitud_hora(test.u('3a'), test.u('b9'), 'PRESENCIAL', test.dia(20, 10), test.dia(20, 11), 'Ema', 'Nueva',
                                 '1990-01-01', 'ema@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, gen_random_uuid(),
                                 v_ter, sha256('s106a'), NULL);
    RAISE EXCEPTION 'caso 106: version vieja de la politica';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT * INTO r FROM crear_solicitud_hora(test.u('3b'), test.u('b9'), 'PRESENCIAL', test.dia(20, 10), test.dia(20, 11), 'Ema', 'Nueva',
                               '1990-01-01', 'Ema@X', test.cif('+56900000001'), NULL, NULL, NULL, NULL, NULL,
                               test.cif('{"motivos":["ansiedad"]}'), test.u('b9'), v_pol, v_ter, sha256('s106b'), NULL);
  ASSERT r.expira > now() AND r.cita_id IS NOT NULL, 'caso 106: la hora queda retenida hasta verificar el correo';
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_publica(test.u('b9'), test.dia(20, 9), test.dia(20, 12)) d
                     WHERE d.modalidad = 'PRESENCIAL' AND d.inicio <= test.dia(20, 10) AND d.fin >= test.dia(20, 11)),
    'caso 106: la hora queda retenida';
  BEGIN
    PERFORM crear_solicitud_hora(test.u('3c'), test.u('b9'), 'PRESENCIAL', test.dia(20, 10), test.dia(20, 11), 'Otro', 'Mas',
                                 '1990-01-01', 'otro@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_pol, v_ter,
                                 sha256('s106c'), NULL);
    RAISE EXCEPTION 'caso 106: hora ya retenida';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  BEGIN
    PERFORM crear_solicitud_hora(test.u('3d'), test.u('b9'), 'PRESENCIAL', test.dia(21, 10), test.dia(21, 11), 'Nino', 'Chico',
                                 '2016-01-01', 'mama@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_pol, v_ter,
                                 sha256('s106d'), NULL);
    RAISE EXCEPTION 'caso 106: menor sin adulto responsable';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM crear_solicitud_hora(test.u('3e'), test.u('b9'), 'PRESENCIAL', test.dia(22, 10), test.dia(22, 11), 'Ema', 'Nueva',
                               '1990-01-01', 'ema@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_pol, v_ter,
                               sha256('s106e'), NULL);
  BEGIN
    PERFORM crear_solicitud_hora(test.u('3f'), test.u('b9'), 'PRESENCIAL', test.dia(23, 10), test.dia(23, 11), 'Ema', 'Nueva',
                                 '1990-01-01', 'ema@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_pol, v_ter,
                                 sha256('s106f'), NULL);
    RAISE EXCEPTION 'caso 106: maximo de reservas en curso por correo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM 1 FROM solicitudes_hora;
    RAISE EXCEPTION 'caso 106: sin SELECT directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT estado = 'RETENIDA' AND paciente_id IS NULL AND retencion_vence_en IS NOT NULL FROM citas
          WHERE profesional_id = test.u('b9') AND inicio = test.dia(20, 10)), 'caso 106: hora retenida sin paciente';
  BEGIN
    UPDATE citas SET estado = 'CANCELADA' WHERE profesional_id = test.u('b9') AND inicio = test.dia(20, 10);
    RAISE EXCEPTION 'caso 106: la API no toca la hora retenida';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, inicio, fin, estado, retencion_vence_en)
    VALUES ('ONLINE', test.u('b9'), test.dia(25, 10), test.dia(25, 11), 'RETENIDA', now() + interval '1 hour');
    RAISE EXCEPTION 'caso 106: la API no crea horas retenidas';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (SELECT nombre FROM datos_solicitud_hora(sha256('s106b'))) = 'Ema', 'caso 106: datos para la API (sin consumir)';
  SELECT * INTO r FROM concretar_reserva(sha256('s106b'), test.u('16'), test.u('d6'), test.cif('+56900000001'), NULL, NULL,
                                         NULL, sha256('inv106b'), now() + interval '3 days');
  ASSERT r.estado = 'SOLICITADA' AND r.invitacion_email = 'ema@x' AND r.invitacion_rol = 'PACIENTE',
    'caso 106: la hora pasa a su profesional e invitacion al correo verificado';
  BEGIN
    PERFORM concretar_reserva(sha256('s106b'), gen_random_uuid(), gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'caso 106: el enlace es de un solo uso';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT creado_por_solicitud AND NOT posible_duplicado AND profesional_id = test.u('b9') FROM pacientes WHERE id = test.u('16')),
    'caso 106: paciente del portal con su tratante';
  ASSERT (SELECT estado = 'SOLICITADA' AND paciente_id = test.u('16') AND aprobacion_vence_en IS NOT NULL AND retencion_vence_en IS NULL
          FROM citas WHERE profesional_id = test.u('b9') AND inicio = test.dia(20, 10)), 'caso 106: la hora retenida pasa a ser su cita por aprobar';
  ASSERT EXISTS (SELECT 1 FROM fichas_clinicas WHERE paciente_id = test.u('16')), 'caso 106: con ficha';
  ASSERT (SELECT count(*) FROM aceptaciones_politica WHERE paciente_id = test.u('16') AND canal = 'SOLICITUD') = 2,
    'caso 106: politica y terminos aceptados';
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE tipo = 'SOLICITUD_HORA' AND usuario_id = test.u('b9')), 'caso 106: aviso al profesional';
  -- Mismo correo = posible duplicado (nunca por nombre: GESTION concilia).
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM concretar_reserva(sha256('s106e'), test.u('17'), test.u('d7'), NULL, NULL, NULL, NULL, sha256('inv106e'),
                            now() + interval '3 days');
  PERFORM test.ctx('a1', 'ADMIN');
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
  -- Una solicitud mas que el job vencera (caso 115).
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM crear_solicitud_hora(test.u('3c'), test.u('b9'), 'PRESENCIAL', test.dia(24, 10), test.dia(24, 11), 'Vence', 'Pronto',
                               '1990-01-01', 'vence@x', NULL, NULL, NULL, NULL, NULL, NULL, test.cif('{"a":1}'), NULL, v_pol,
                               v_ter, sha256('s106g'), NULL);
END $$;

\echo 107 Lista de espera retirada (implementacion futura): cancelar una cita futura no genera avisos de hora liberada
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE citas SET estado = 'CANCELADA' WHERE paciente_id = test.u('16') AND estado = 'CONFIRMADA' AND inicio > now();
  ASSERT NOT EXISTS (SELECT 1 FROM notificaciones WHERE tipo = 'HORA_LIBERADA'), 'caso 107: sin aviso de hora liberada';
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
  UPDATE borradores_evolucion SET nivel_riesgo = 'ALTO' WHERE id = test.u('2a');
  ASSERT (SELECT nivel_riesgo FROM borradores_evolucion WHERE id = test.u('2a')) = 'ALTO', 'caso 109: el autor guarda el riesgo';
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

\echo 110 Alta (append-only): el tratante con fecha y motivo cifrado; borra respuestas del match; ADMIN no la lee
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

\echo 112 Reportes por rol: dashboard (ADMIN/GESTION agregados sin datos clinicos; el profesional los suyos) y estado de fichas
DO $$ DECLARE j jsonb; BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  j := reporte_dashboard();
  ASSERT j ? 'pacientes_activos' AND j ? 'pendientes' AND (j->'pendientes'->>'resenas_por_moderar') IS NULL, 'caso 112: GESTION agregados';
  -- 03b: uso de box = horas apartadas sobre horario de boxes (muestra), acotado a 0-100.
  ASSERT (j->>'ocupacion_boxes_hoy')::numeric BETWEEN 0 AND 100, 'caso 112: uso de box apartado';
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
  UPDATE contenido_publico SET hero_titulo = 'Centro de prueba', color_marca = '#8A4B1F';
  BEGIN
    UPDATE contenido_publico SET color_marca = 'rojo';
    RAISE EXCEPTION 'caso 113: color #RRGGBB';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- 03c: marca por zona con contraste exigido por la BD.
  ASSERT round(contraste_wcag('#FFFFFF', '#000000'), 2) = 21 AND round(contraste_wcag('#8A4B1F', '#F5EAD8'), 2) = 5.68, 'caso 113: contraste WCAG';
  UPDATE contenido_publico SET color_portal = '#4F6B2F', color_panel = '#8A4B1F', color_fondo_panel = '#F1EBE2',
                               color_fondo_publico = '#F5EAD8', color_fondo_portal = '#FFFDF9';
  BEGIN
    UPDATE contenido_publico SET color_panel = '#D6A15A';
    RAISE EXCEPTION 'caso 113: principal sin contraste sobre crema';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE contenido_publico SET color_fondo_portal = '#8A4B1F';
    RAISE EXCEPTION 'caso 113: fondo oscuro';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE contenido_publico SET color_portal = NULL, color_panel = NULL, color_fondo_panel = NULL, color_fondo_publico = NULL, color_fondo_portal = NULL;
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
  ASSERT jsonb_array_length(cuestionario_match()) = 9, 'caso 113: cuestionario activo (8 preguntas de ejemplo + presupuesto de 03b-4.1)';
  PERFORM registrar_resultado_match(test.u('b1'));
END $$;

\echo 116 Especialidades (B): el equipo lee, el paciente no; solo ADMIN escribe y revisa; el profesional declara solo las suyas (PROPUESTO)
DO $$ DECLARE v_psi uuid; BEGIN
  PERFORM test.ctx('b4', 'PROFESIONAL');
  v_psi := (SELECT id FROM especialidades WHERE nombre LIKE 'Psicolog_a');
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM especialidades) = 0, 'caso 116: el paciente no lee especialidades';
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM especialidades) >= 5, 'caso 116: ejemplos cargados';
  BEGIN
    INSERT INTO especialidades (nombre) VALUES ('Kinesiología');
    RAISE EXCEPTION 'caso 116: solo ADMIN crea especialidades';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO profesional_especialidades (profesional_id, especialidad_id) VALUES (test.u('b2'), v_psi);
    RAISE EXCEPTION 'caso 116: no declara por otro';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    INSERT INTO profesional_especialidades (profesional_id, especialidad_id, estado) VALUES (test.u('b1'), v_psi, 'APROBADO');
    RAISE EXCEPTION 'caso 116: no se autoaprueba';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO profesional_especialidades (profesional_id, especialidad_id) VALUES (test.u('b1'), v_psi);
  BEGIN
    PERFORM revisar_especialidad(test.u('b1'), v_psi, true);
    RAISE EXCEPTION 'caso 116: solo ADMIN revisa';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE profesional_especialidades SET estado = 'APROBADO';
    RAISE EXCEPTION 'caso 116: sin UPDATE directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b2', 'PROFESIONAL');
  INSERT INTO profesional_especialidades (profesional_id, especialidad_id) VALUES (test.u('b2'), v_psi);
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM revisar_especialidad(test.u('b1'), v_psi, true), revisar_especialidad(test.u('b2'), v_psi, true);
  BEGIN
    PERFORM revisar_especialidad(test.u('b4'), v_psi, true);
    RAISE EXCEPTION 'caso 116: no declarada';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM profesional_especialidades WHERE estado = 'APROBADO') = 2, 'caso 116: el equipo ve las aprobadas';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM profesional_especialidades) = 2, 'caso 116: GESTION ve todas';
END $$;

\echo 117 Plantillas (B): proponen ADMIN y el profesional con la especialidad; solo ADMIN publica; editar = version nueva; la anterior queda INACTIVA
DO $$ DECLARE
  v_psi uuid;
  v_def jsonb := '[{"clave":"objetivo","etiqueta":"Objetivo","tipo":"TEXTO","obligatorio":true,"orden":1,"visible_en_supervision":true,"es_texto_libre":true}]';
  v1 uuid; v2 uuid; v_evo uuid := gen_random_uuid();
BEGIN
  PERFORM test.ctx('b4', 'PROFESIONAL');
  v_psi := (SELECT id FROM especialidades WHERE nombre LIKE 'Psicolog_a');
  BEGIN
    PERFORM proponer_plantilla(v_psi, 'EVOLUCION', 'Sin especialidad', v_def);
    RAISE EXCEPTION 'caso 117: sin la especialidad aprobada no propone';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM proponer_plantilla(v_psi, 'EVOLUCION', 'Mala',
      '[{"clave":"x","etiqueta":"X","tipo":"SELECCION_UNICA","obligatorio":true,"orden":1,"visible_en_supervision":true,"es_texto_libre":false}]');
    RAISE EXCEPTION 'caso 117: seleccion sin opciones';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO plantillas_clinicas (familia_id, especialidad_id, tipo, nombre, version, definicion)
    VALUES (gen_random_uuid(), v_psi, 'EVOLUCION', 'Directa', 1, v_def);
    RAISE EXCEPTION 'caso 117: sin INSERT directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  v1 := proponer_plantilla(v_psi, 'EVOLUCION', 'Seguimiento 117', v_def);
  PERFORM editar_plantilla(v1, 'Seguimiento 117 v1', NULL);
  BEGIN
    PERFORM publicar_plantilla(v1);
    RAISE EXCEPTION 'caso 117: solo ADMIN publica';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM plantillas_clinicas WHERE id = v1) = 0, 'caso 117: el borrador ajeno no se ve';
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM publicar_plantilla(v1);
  BEGIN
    PERFORM publicar_plantilla(v1);
    RAISE EXCEPTION 'caso 117: ya publicada';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM plantillas_clinicas WHERE id = v1) = 1, 'caso 117: la publicada la ve el equipo';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM editar_plantilla(v1, 'Cambio', NULL);
    RAISE EXCEPTION 'caso 117: una publicada no se edita';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  -- Evolucion con v1 (Ana es de b2, que tiene Psicologia aprobada).
  PERFORM test.ctx('b2', 'PROFESIONAL');
  INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro, tipo_sesion_id,
                           nivel_riesgo, plantilla_id, valores)
  VALUES (v_evo, test.u('fa'), test.u('b2'), test.cif('con plantilla'), test.cif('a'), test.cif('r'), test.cif('g'), test.u('60'),
          'NINGUNO', v1, test.cif('{"objetivo":"x"}'));
  PERFORM test.ctx('b1', 'PROFESIONAL');
  v2 := nueva_version_plantilla(v1);
  BEGIN
    PERFORM nueva_version_plantilla(v1);
    RAISE EXCEPTION 'caso 117: un borrador por familia';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM publicar_plantilla(v2);
  ASSERT (SELECT estado FROM plantillas_clinicas WHERE id = v1) = 'INACTIVA'
         AND (SELECT estado = 'PUBLICADA' AND version = 2 FROM plantillas_clinicas WHERE id = v2), 'caso 117: v2 publicada, v1 inactiva';
  BEGIN
    UPDATE plantillas_clinicas SET nombre = 'x';
    RAISE EXCEPTION 'caso 117: sin UPDATE directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO test.ids VALUES ('p117v1', v1), ('p117v2', v2), ('e117', v_evo);
END $$;

\echo 118 Registros con plantilla: version publicada del tipo y la especialidad correctos; correccion con la misma version; ingreso append-only solo del equipo tratante
DO $$ DECLARE
  v_psi_evo uuid; v_psi_ing uuid; v_nut_evo uuid;
  v_ing uuid := gen_random_uuid();
BEGIN
  PERFORM test.ctx('b2', 'PROFESIONAL');
  v_psi_evo := (SELECT id FROM plantillas_clinicas WHERE nombre LIKE 'Sesi_n de psicoterapia');
  v_psi_ing := (SELECT id FROM plantillas_clinicas WHERE nombre LIKE 'Anamnesis psicol_gica');
  v_nut_evo := (SELECT id FROM plantillas_clinicas WHERE nombre = 'Control nutricional');
  BEGIN
    INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro, tipo_sesion_id,
                             nivel_riesgo, plantilla_id, valores)
    VALUES (gen_random_uuid(), test.u('fa'), test.u('b2'), test.cif('n'), test.cif('a'), test.cif('r'), test.cif('g'), test.u('60'),
            'NINGUNO', v_nut_evo, test.cif('{}'));
    RAISE EXCEPTION 'caso 118: especialidad no aprobada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro, tipo_sesion_id,
                             nivel_riesgo, plantilla_id, valores)
    VALUES (gen_random_uuid(), test.u('fa'), test.u('b2'), test.cif('n'), test.cif('a'), test.cif('r'), test.cif('g'), test.u('60'),
            'NINGUNO', v_psi_ing, test.cif('{}'));
    RAISE EXCEPTION 'caso 118: plantilla INGRESO en una evolucion';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro, tipo_sesion_id,
                             nivel_riesgo, plantilla_id, valores)
    VALUES (gen_random_uuid(), test.u('fa'), test.u('b2'), test.cif('n'), test.cif('a'), test.cif('r'), test.cif('g'), test.u('60'),
            'NINGUNO', v_psi_evo, '\x00');
    RAISE EXCEPTION 'caso 118: valores sin cifrar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro, tipo_sesion_id,
                             nivel_riesgo, plantilla_id, valores)
    VALUES (gen_random_uuid(), test.u('fa'), test.u('b2'), test.cif('n'), test.cif('a'), test.cif('r'), test.cif('g'), test.u('60'),
            'NINGUNO', test.id('p117v1'), test.cif('{}'));
    RAISE EXCEPTION 'caso 118: registro nuevo con version inactiva';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro, tipo_sesion_id,
                             nivel_riesgo, corrige_a_id, plantilla_id, valores)
    VALUES (gen_random_uuid(), test.u('fa'), test.u('b2'), test.cif('n'), test.cif('a'), test.cif('r'), test.cif('g'), test.u('60'),
            'NINGUNO', test.id('e117'), test.id('p117v2'), test.cif('{}'));
    RAISE EXCEPTION 'caso 118: correccion con otra version';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO evoluciones (id, ficha_clinica_id, autor_id, notas, autor_nombre, autor_rut, autor_registro, tipo_sesion_id,
                           nivel_riesgo, corrige_a_id, plantilla_id, valores)
  VALUES (gen_random_uuid(), test.u('fa'), test.u('b2'), test.cif('n'), test.cif('a'), test.cif('r'), test.cif('g'), test.u('60'),
          'NINGUNO', test.id('e117'), test.id('p117v1'), test.cif('{"objetivo":"corregido"}'));
  -- Ficha de ingreso.
  BEGIN
    INSERT INTO ingresos_ficha (id, ficha_clinica_id, autor_id, plantilla_id, valores)
    VALUES (gen_random_uuid(), test.u('fa'), test.u('b2'), v_psi_evo, test.cif('{}'));
    RAISE EXCEPTION 'caso 118: ingreso con plantilla de evolucion';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO ingresos_ficha (id, ficha_clinica_id, autor_id, plantilla_id, valores)
  VALUES (v_ing, test.u('fa'), test.u('b2'), v_psi_ing, test.cif('{"motivo_consulta":"m","tratamiento_previo":false}'));
  BEGIN
    UPDATE ingresos_ficha SET valores = test.cif('x');
    RAISE EXCEPTION 'caso 118: ingreso sin UPDATE';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO borradores_evolucion (id, autor_id, ficha_clinica_id, contenido, plantilla_id, valores)
    VALUES (gen_random_uuid(), test.u('b2'), test.u('fa'), test.cif('b'), v_psi_ing, test.cif('{}'));
    RAISE EXCEPTION 'caso 118: borrador con plantilla de ingreso';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('b3', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM ingresos_ficha WHERE id = v_ing) = 1, 'caso 118: acceso temporal lee el ingreso';
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM ingresos_ficha) = 0, 'caso 118: otro profesional no';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM ingresos_ficha) = 0, 'caso 118: ADMIN no lee ingresos';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM ingresos_ficha) = 0, 'caso 118: GESTION no';
END $$;

\echo 119 Hilo CASO: solo con acceso clinico vigente (tratante o acceso temporal); ADMIN/GESTION nunca; mensajes sin edicion; retiro del autor; aviso sin contenido
DO $$ DECLARE v_h uuid := gen_random_uuid(); v_m uuid := gen_random_uuid(); BEGIN
  FOREACH v_m IN ARRAY ARRAY[test.u('a1'), test.u('a3'), test.u('b4')] LOOP
    BEGIN
      PERFORM test.ctx(right(v_m::text, 2), rol_usuario(v_m));
      PERFORM crear_hilo_interno(gen_random_uuid(), 'CASO', test.cif('asunto'), test.u('0a'), NULL);
      RAISE EXCEPTION 'caso 119: % crea hilo de caso sin acceso clinico', v_m;
    EXCEPTION WHEN no_data_found THEN NULL; END;
  END LOOP;
  v_m := gen_random_uuid();
  PERFORM test.ctx('b2', 'PROFESIONAL');
  BEGIN
    INSERT INTO hilos_internos (id, tipo, asunto, paciente_id, creado_por_id) VALUES (gen_random_uuid(), 'CASO', test.cif('a'), test.u('0a'), test.u('b2'));
    RAISE EXCEPTION 'caso 119: sin INSERT directo de hilos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM crear_hilo_interno(v_h, 'CASO', test.cif('Coordinacion Ana'), test.u('0a'), NULL);
  INSERT INTO mensajes_internos (id, hilo_id, autor_id, rol_autor, contenido) VALUES (v_m, v_h, test.u('b2'), 'PROFESIONAL', test.cif('hola'));
  BEGIN
    INSERT INTO mensajes_internos (id, hilo_id, autor_id, rol_autor, contenido) VALUES (gen_random_uuid(), v_h, test.u('b2'), 'ADMIN', test.cif('x'));
    RAISE EXCEPTION 'caso 119: rol del autor = rol activo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO mensajes_internos (id, hilo_id, autor_id, rol_autor, contenido) VALUES (gen_random_uuid(), v_h, test.u('b1'), 'PROFESIONAL', test.cif('x'));
    RAISE EXCEPTION 'caso 119: no a nombre de otro';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE mensajes_internos SET contenido = test.cif('editado');
    RAISE EXCEPTION 'caso 119: sin edicion';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO lecturas_hilo (hilo_id, usuario_id) VALUES (v_h, test.u('b2'));
  BEGIN
    INSERT INTO lecturas_hilo (hilo_id, usuario_id) VALUES (v_h, test.u('b1'));
    RAISE EXCEPTION 'caso 119: lectura ajena';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- b1 tiene acceso temporal de lectura a Ana (108): ve y escribe; avisa al tratante.
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM mensajes_internos WHERE hilo_id = v_h) = 1, 'caso 119: acceso temporal lee el hilo';
  INSERT INTO mensajes_internos (id, hilo_id, autor_id, rol_autor, contenido) VALUES (gen_random_uuid(), v_h, test.u('b1'), 'PROFESIONAL', test.cif('ok'));
  BEGIN
    PERFORM retirar_mensaje_interno(v_m);
    RAISE EXCEPTION 'caso 119: solo el autor retira';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE tipo = 'MENSAJE_INTERNO' AND usuario_id = test.u('b2') AND referencia_id = v_h
                   AND canal = 'BANDEJA'), 'caso 119: aviso al tratante';
  PERFORM retirar_mensaje_interno(v_m);
  ASSERT (SELECT contenido IS NULL AND retirado_en IS NOT NULL FROM mensajes_internos WHERE id = v_m), 'caso 119: queda retirado';
  BEGIN
    PERFORM retirar_mensaje_interno(v_m);
    RAISE EXCEPTION 'caso 119: ya retirado';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  FOREACH v_m IN ARRAY ARRAY[test.u('a1'), test.u('a3'), test.u('b4'), test.u('a2')] LOOP
    PERFORM test.ctx(right(v_m::text, 2), rol_usuario(v_m));
    ASSERT (SELECT count(*) FROM hilos_internos WHERE id = v_h) + (SELECT count(*) FROM mensajes_internos WHERE hilo_id = v_h)
           + (SELECT count(*) FROM lecturas_hilo WHERE hilo_id = v_h) = 0, format('caso 119: %s no ve el hilo de caso', v_m);
  END LOOP;
  -- Acceso temporal de 1 segundo para b4: lo ve ahora y deja de verlo al vencer (siguiente bloque).
  PERFORM test.ctx('b2', 'PROFESIONAL');
  PERFORM otorgar_acceso_temporal(test.u('0a'), test.u('b4'), 'INTERCONSULTA', 'LECTURA', NULL, now() + interval '1 second');
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM hilos_internos WHERE id = v_h) = 1, 'caso 119: con acceso temporal vigente lo ve';
  INSERT INTO test.ids VALUES ('h119', v_h);
END $$;
DO $$ BEGIN PERFORM pg_sleep(1.2); END $$;
DO $$ BEGIN
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM hilos_internos WHERE id = test.id('h119')) + (SELECT count(*) FROM mensajes_internos WHERE hilo_id = test.id('h119')) = 0,
    'caso 119: al vencer el acceso deja de ver el hilo';
END $$;

\echo 120 Hilo GENERAL: participantes del equipo (nunca pacientes); sin paciente; quien no participa no lo ve
DO $$ DECLARE v_g uuid := gen_random_uuid(); BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    PERFORM crear_hilo_interno(gen_random_uuid(), 'GENERAL', test.cif('a'), NULL, NULL);
    RAISE EXCEPTION 'caso 120: el paciente no usa la mensajeria interna';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM crear_hilo_interno(gen_random_uuid(), 'GENERAL', test.cif('a'), NULL, ARRAY[test.u('b1'), test.u('a2')]);
    RAISE EXCEPTION 'caso 120: un paciente no participa';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM crear_hilo_interno(gen_random_uuid(), 'GENERAL', test.cif('a'), NULL, ARRAY[test.u('c5')]);
    RAISE EXCEPTION 'caso 120: practicante expirado no participa';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM crear_hilo_interno(gen_random_uuid(), 'GENERAL', test.cif('a'), test.u('0a'), NULL);
    RAISE EXCEPTION 'caso 120: hilo general sin paciente';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM crear_hilo_interno(v_g, 'GENERAL', test.cif('Turnos'), NULL, ARRAY[test.u('b1')]);
  ASSERT (SELECT count(*) FROM participantes_hilo WHERE hilo_id = v_g) = 2, 'caso 120: el creador participa';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO mensajes_internos (id, hilo_id, autor_id, rol_autor, contenido) VALUES (gen_random_uuid(), v_g, test.u('b1'), 'PROFESIONAL', test.cif('cubro'));
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM hilos_internos WHERE id = v_g) = 0, 'caso 120: ADMIN que no participa no lo ve';
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM mensajes_internos WHERE hilo_id = v_g) = 0, 'caso 120: no participante';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM agregar_participantes_hilo(v_g, ARRAY[test.u('b4')]);
  BEGIN
    PERFORM agregar_participantes_hilo(test.id('h119'), ARRAY[test.u('b4')]);
    RAISE EXCEPTION 'caso 120: un hilo de caso no tiene participantes';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('b4', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM mensajes_internos WHERE hilo_id = v_g) = 1, 'caso 120: agregado, ve el hilo';
  ASSERT EXISTS (SELECT 1 FROM nombres_hilo(v_g) WHERE usuario_id = test.u('b1') AND nombre = 'Prof Uno'), 'caso 120: nombres del hilo';
  INSERT INTO test.ids VALUES ('g120', v_g);
END $$;

\echo 121 Duplicados solo por administracion; RUT antes de la primera evolucion; edad minima de cuenta configurable; correos de cuenta solo via funciones sin contexto
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    UPDATE pacientes SET posible_duplicado = true WHERE id = test.u('15');
    RAISE EXCEPTION 'caso 121: el tratante no marca ni limpia duplicados';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES (test.u('19'), 'Rut', 'Pendiente', '1980-01-01', test.u('b1'));
  INSERT INTO fichas_clinicas (id, paciente_id) VALUES (test.u('f9'), test.u('19'));
  BEGIN
    PERFORM test.evo(test.u('f9'), test.u('b1'), 'primera sin rut');
    RAISE EXCEPTION 'caso 121: sin RUT no hay primera evolucion';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    UPDATE pacientes SET posible_duplicado = false WHERE id = test.u('15');
    RAISE EXCEPTION 'caso 121: solo via resolver_posible_duplicado';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM correos_cuenta_pendientes;
    RAISE EXCEPTION 'caso 121: correos de cuenta sin acceso directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM encolar_correo_cuenta(gen_random_uuid(), test.cif('e'), 'a', test.cif('c'), now() + interval '1 hour');
    RAISE EXCEPTION 'caso 121: encolar solo sin contexto';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    UPDATE configuracion_centro SET edad_minima_cuenta = 13;
    RAISE EXCEPTION 'caso 121: edad minima de 14 a 18';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE configuracion_centro SET edad_minima_cuenta = 16;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM crear_invitacion_paciente(test.u('14'), 't-tomas-nuevo@x', sha256('i121'), now() + interval '1 day');
    RAISE EXCEPTION 'caso 121: bajo la edad minima configurada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE configuracion_centro SET edad_minima_cuenta = 14;
END $$;

\echo 123 Bloques de box (03b, A+C): el profesional aparta los suyos dentro del horario del box (por periodo); ADMIN/GESTION por otros; nadie mas; sin choques; no se liberan con citas
DO $$ BEGIN
  PERFORM test.ctx('b5', 'PROFESIONAL');
  INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id) VALUES
    (test.u('b5'), test.u('e1'), test.lunes(14, 9), test.lunes(14, 11), test.u('b5'));
  BEGIN
    INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id) VALUES
      (test.u('b1'), test.u('e1'), test.lunes(15, 9), test.lunes(15, 10), test.u('b5'));
    RAISE EXCEPTION 'caso 123: apartar a nombre de otro';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id) VALUES
      (test.u('b5'), test.u('e1'), test.lunes(15, 9), test.lunes(15, 10), test.u('a1'));
    RAISE EXCEPTION 'caso 123: autor ajeno';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b4', 'PROFESIONAL');
  BEGIN
    INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id) VALUES
      (test.u('b4'), test.u('e1'), test.lunes(14, 10), test.lunes(14, 12), test.u('b4'));
    RAISE EXCEPTION 'caso 123: box ya apartado';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM bloques_atencion WHERE profesional_id = test.u('b5')) = 0, 'caso 123: no ve bloques ajenos';
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_espacios(test.lunes(14, 0), test.lunes(15, 0)) d
                     WHERE d.espacio_id = test.u('e1') AND d.inicio < test.lunes(14, 11) AND d.fin > test.lunes(14, 9)),
    'caso 123: el box apartado no aparece libre';
  ASSERT EXISTS (SELECT 1 FROM disponibilidad_espacios(test.lunes(14, 0), test.lunes(15, 0)) d
                 WHERE d.espacio_id = test.u('e1') AND d.inicio <= test.lunes(14, 11) AND d.fin >= test.lunes(14, 12)),
    'caso 123: el resto del dia sigue libre';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'disponibilidad_espacios') = '{desde,hasta,espacio_id,inicio,fin}',
    'caso 123: sin profesionales';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM bloques_atencion) = 0, 'caso 123: PACIENTE no ve bloques';
  BEGIN
    PERFORM disponibilidad_espacios(test.lunes(14, 0), test.lunes(15, 0));
    RAISE EXCEPTION 'caso 123: PACIENTE no consulta boxes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Horario del box por periodo: e1 abre los lunes 09-13 solo en las semanas 14 a 20.
  PERFORM test.ctx('a3', 'GESTION');
  INSERT INTO horarios_espacio (espacio_id, dia_semana, inicio_min, fin_min, vigente_desde, vigente_hasta)
  VALUES (test.u('e1'), 1, 540, 780, (test.lunes(14, 0) AT TIME ZONE 'America/Santiago')::date,
          (test.lunes(20, 0) AT TIME ZONE 'America/Santiago')::date);
  BEGIN
    INSERT INTO horarios_espacio (espacio_id, dia_semana, inicio_min, fin_min, vigente_desde, vigente_hasta)
    VALUES (test.u('e1'), 2, 540, 780, '2027-02-01', '2027-01-01');
    RAISE EXCEPTION 'caso 123: periodo invertido';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id) VALUES
    (test.u('b5'), test.u('e1'), test.lunes(14, 11), test.lunes(14, 13), test.u('a3'));
  BEGIN
    INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id) VALUES
      (test.u('b5'), test.u('e1'), test.lunes(14, 13), test.lunes(14, 14), test.u('a3'));
    RAISE EXCEPTION 'caso 123: fuera del horario del box';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id) VALUES
      (test.u('b5'), test.u('e1'), test.lunes(28, 9), test.lunes(28, 10), test.u('a3'));
    RAISE EXCEPTION 'caso 123: fuera del periodo vigente';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id) VALUES
      (test.u('a3'), test.u('e2'), test.lunes(14, 9), test.lunes(14, 10), test.u('a3'));
    RAISE EXCEPTION 'caso 123: solo profesionales o practicantes';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Una cita presencial usa el box del bloque; con ella dentro el bloque no se libera.
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin) VALUES
    (test.u('e2'), test.u('b5'), test.u('12'), test.lunes(14, 9), test.lunes(14, 10));
  ASSERT (SELECT espacio_id FROM citas WHERE profesional_id = test.u('b5') AND inicio = test.lunes(14, 9)) = test.u('e1'),
    'caso 123: box del bloque';
  BEGIN
    DELETE FROM bloques_atencion WHERE profesional_id = test.u('b5') AND inicio = test.lunes(14, 9);
    RAISE EXCEPTION 'caso 123: liberar con cita dentro';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  UPDATE citas SET estado = 'CANCELADA' WHERE profesional_id = test.u('b5') AND inicio = test.lunes(14, 9);
  PERFORM test.ctx('b5', 'PROFESIONAL');
  DELETE FROM bloques_atencion WHERE profesional_id = test.u('b5') AND espacio_id = test.u('e1');
  ASSERT NOT EXISTS (SELECT 1 FROM bloques_atencion WHERE espacio_id = test.u('e1')), 'caso 123: liberados';
  PERFORM test.ctx('a3', 'GESTION');
  DELETE FROM horarios_espacio WHERE espacio_id = test.u('e1');
END $$;

\echo 124 Lista de espera retirada (implementacion futura): sin tablas ni funciones; apartar un bloque o cancelar una cita no avisa a nadie
DO $$ BEGIN
  ASSERT to_regclass('public.lista_espera') IS NULL AND to_regclass('public.lista_espera_publica') IS NULL, 'caso 124: sin tablas';
  ASSERT to_regtype('estado_lista_espera') IS NULL, 'caso 124: sin enum de estado';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname ~ 'lista_espera|hora_liberada|avisar_bloques_nuevos'), 'caso 124: sin funciones';
  ASSERT NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE (table_name, column_name) IN (('solicitudes_hora', 'lista_espera'),
                                                         ('configuracion_centro', 'dias_lista_espera_publica'))),
    'caso 124: sin columnas';
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin) VALUES
    ('ONLINE', test.u('b9'), test.u('16'), test.dia(33, 10), test.dia(33, 11));
  UPDATE citas SET estado = 'CANCELADA' WHERE profesional_id = test.u('b9') AND inicio = test.dia(33, 10);
  ASSERT NOT EXISTS (SELECT 1 FROM notificaciones WHERE tipo = 'HORA_LIBERADA'), 'caso 124: sin aviso';
END $$;

\echo 125 Portal (03b-3): supervisores_portal solo para PACIENTE/RESPONSABLE, solo id y nombre de quien supervisa sus consentimientos
DO $$ BEGIN
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT NOT EXISTS (SELECT 1 FROM supervisores_portal() s
                     WHERE s.id NOT IN (SELECT supervisor_id FROM consentimientos
                                        UNION SELECT supervisor_anterior_id FROM avisos_consentimiento
                                        UNION SELECT supervisor_nuevo_id FROM avisos_consentimiento)),
    'caso 125: solo supervisores de sus consentimientos (RLS del paciente)';
  ASSERT (SELECT pg_get_function_result('supervisores_portal()'::regprocedure)) = 'TABLE(id uuid, nombre text)', 'caso 125: solo id y nombre';
END $$;
DO $$ DECLARE v_ctx text[]; BEGIN
  FOREACH v_ctx SLICE 1 IN ARRAY ARRAY[['a1', 'ADMIN'], ['a3', 'GESTION'], ['b1', 'PROFESIONAL'], ['c1', 'PRACTICANTE']] LOOP
    PERFORM test.ctx(v_ctx[1], v_ctx[2]);
    BEGIN
      PERFORM supervisores_portal();
      RAISE EXCEPTION 'caso 125: % no', v_ctx[2];
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;

\echo 126 Antes de 03b-4: reserva desde el portal y descarga con sesion solo para PACIENTE/RESPONSABLE; el adolescente no reserva
DO $$ DECLARE v_ctx text[]; BEGIN
  FOREACH v_ctx SLICE 1 IN ARRAY ARRAY[['a1', 'ADMIN'], ['a3', 'GESTION'], ['b1', 'PROFESIONAL'], ['c1', 'PRACTICANTE']] LOOP
    PERFORM test.ctx(v_ctx[1], v_ctx[2]);
    BEGIN
      PERFORM reservar_cita_portal(test.u('0a'), 'ONLINE', now() + interval '3 days', now() + interval '3 days 50 minutes', NULL, NULL);
      RAISE EXCEPTION 'caso 126: % no reserva', v_ctx[2];
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM registrar_descarga_portal(gen_random_uuid());
      RAISE EXCEPTION 'caso 126: % no descarga', v_ctx[2];
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  -- Paciente: solo por si mismo (otro paciente: no existe para el).
  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    PERFORM reservar_cita_portal(test.u('0b'), 'ONLINE', now() + interval '3 days', now() + interval '3 days 50 minutes', NULL, NULL);
    RAISE EXCEPTION 'caso 126: reserva por otro paciente';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN
    PERFORM registrar_descarga_portal(gen_random_uuid());
    RAISE EXCEPTION 'caso 126: documento ajeno o inexistente';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN
    PERFORM guardar_enlace_portal(gen_random_uuid(), '\x00'::bytea);
    RAISE EXCEPTION 'caso 126: enlace de una cita que no reservo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 134 Segundo factor por correo y match con presupuesto (03b-4.1) como app_user: codigos solo via funciones (sin GRANT); obligatorio para el equipo; reenvio con espera; 5 intentos; un uso; respaldo de un uso y solo para la propia cuenta; el equipo no lo desactiva; login por RUT; tope numerico del presupuesto
DO $$ DECLARE h1 bytea := sha256(convert_to('t134-uno', 'UTF8')); h2 bytea := sha256(convert_to('t134-dos', 'UTF8'));
              v_mal bytea := sha256(convert_to('t134-mal', 'UTF8')); v_hashes bytea[]; i int; BEGIN
  BEGIN
    PERFORM count(*) FROM codigos_verificacion;
    RAISE EXCEPTION 'caso 134: codigos_verificacion sin GRANT';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO codigos_respaldo (usuario_id, codigo_hash) VALUES (test.u('a1'), h1);
    RAISE EXCEPTION 'caso 134: codigos_respaldo sin GRANT';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT requerido AND NOT correo FROM segundo_factor(test.u('a1'))), 'caso 134: ADMIN lo requiere (aun sin activar)';
  ASSERT (SELECT requerido FROM segundo_factor(test.u('c1'))), 'caso 134: PRACTICANTE lo requiere';
  ASSERT (SELECT NOT requerido AND NOT correo FROM segundo_factor(test.u('a2'))), 'caso 134: el paciente no lo requiere';

  ASSERT emitir_codigo_verificacion(test.u('a1'), h1, 60) = 't-admin@x', 'caso 134: devuelve el correo de destino';
  BEGIN
    PERFORM emitir_codigo_verificacion(test.u('a1'), h2, 60);
    RAISE EXCEPTION 'caso 134: reenvio antes de la espera';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  -- El login emite sin espera y anula el anterior.
  PERFORM emitir_codigo_verificacion(test.u('a1'), h2, 0);
  ASSERT NOT verificar_codigo_verificacion(test.u('a1'), h1), 'caso 134: el codigo anterior queda anulado';
  FOR i IN 1..3 LOOP
    ASSERT NOT verificar_codigo_verificacion(test.u('a1'), v_mal), 'caso 134: codigo incorrecto';
  END LOOP;
  -- 4 errores (probar el anulado cuenta como intento contra el vigente) y el correcto entra; despues ya no sirve.
  ASSERT verificar_codigo_verificacion(test.u('a1'), h2), 'caso 134: el codigo vigente entra';
  ASSERT NOT verificar_codigo_verificacion(test.u('a1'), h2), 'caso 134: un solo uso';
  PERFORM emitir_codigo_verificacion(test.u('a1'), h1, 0);
  FOR i IN 1..5 LOOP
    PERFORM verificar_codigo_verificacion(test.u('a1'), v_mal);
  END LOOP;
  ASSERT NOT verificar_codigo_verificacion(test.u('a1'), h1), 'caso 134: tras 5 intentos ni el correcto entra';

  ASSERT activar_verificacion_correo(test.u('a1')), 'caso 134: primera activacion';
  ASSERT NOT activar_verificacion_correo(test.u('a1')), 'caso 134: la segunda ya no es la primera';
  SELECT array_agg(sha256(convert_to('t134-r' || g, 'UTF8'))) INTO v_hashes FROM generate_series(1, 10) g;
  PERFORM generar_codigos_respaldo(test.u('a1'), v_hashes);
  ASSERT usar_codigo_respaldo(test.u('a1'), v_hashes[2]), 'caso 134: respaldo valido';
  ASSERT NOT usar_codigo_respaldo(test.u('a1'), v_hashes[2]), 'caso 134: respaldo de un solo uso';
  ASSERT NOT usar_codigo_respaldo(test.u('a2'), v_hashes[3]), 'caso 134: el respaldo es de su cuenta';
  BEGIN
    PERFORM generar_codigos_respaldo(test.u('a1'), v_hashes[1:9]);
    RAISE EXCEPTION 'caso 134: son 10 codigos';
  EXCEPTION WHEN check_violation THEN NULL; END;

  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    PERFORM generar_codigos_respaldo(test.u('a1'), v_hashes);
    RAISE EXCEPTION 'caso 134: con contexto, solo para la propia cuenta';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM cambiar_verificacion_correo(true);
  ASSERT (SELECT activo AND NOT obligatorio FROM estado_segundo_factor()), 'caso 134: el paciente lo activa';
  PERFORM cambiar_verificacion_correo(false);
  ASSERT (SELECT NOT activo FROM estado_segundo_factor()), 'caso 134: y lo desactiva';
  ASSERT (SELECT count(*) = 1 AND bool_and(rol = 'PACIENTE')
          FROM credenciales_login_rut(sha256(convert_to('rut ' || test.u('0a'), 'UTF8')))), 'caso 134: login por RUT del paciente';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT activo AND obligatorio AND codigos_respaldo_restantes = 9 FROM estado_segundo_factor()), 'caso 134: estado del ADMIN';
  BEGIN
    PERFORM cambiar_verificacion_correo(false);
    RAISE EXCEPTION 'caso 134: el equipo no lo desactiva';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE match_opciones SET objetivo = 'mucho' WHERE valor = 'hasta_35000';
    RAISE EXCEPTION 'caso 134: el tope del presupuesto es un monto';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE match_opciones SET etiqueta = 'Hasta $36.000', objetivo = '36000' WHERE valor = 'hasta_35000';
  UPDATE match_opciones SET etiqueta = 'Hasta $35.000', objetivo = '35000' WHERE valor = 'hasta_35000';
END $$;

\echo 135 retenciones_en_curso (03b-4.1, categoria C): soft-locks ajenos solo con box y rango; ADMIN/GESTION todos o los de un profesional; el profesional solo los de su agenda; los propios no; paciente sin acceso; rango maximo 62 dias
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO bloqueos_temporales (espacio_id, usuario_id, profesional_id, inicio, fin, expira_en) VALUES
    (test.u('e2'), test.u('a1'), test.u('b1'), test.dia(2, 14), test.dia(2, 15), now() + interval '5 minutes');
  ASSERT NOT EXISTS (SELECT 1 FROM retenciones_en_curso(test.dia(2, 0), test.dia(3, 0))), 'caso 135: los propios no figuran';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'retenciones_en_curso') = '{desde,hasta,p_profesional,espacio_id,inicio,fin}',
    'caso 135: solo box y rango (sin quien ni profesional)';
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) = 1 AND bool_and(inicio = test.dia(2, 14) AND fin = test.dia(2, 15))
          FROM retenciones_en_curso(test.dia(2, 0), test.dia(3, 0))), 'caso 135: el profesional ve la de su agenda';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM retenciones_en_curso(test.dia(2, 0), test.dia(3, 0))), 'caso 135: no ve agendas ajenas';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM retenciones_en_curso(test.dia(2, 0), test.dia(3, 0))) = 1, 'caso 135: GESTION ve todas';
  ASSERT (SELECT count(*) FROM retenciones_en_curso(test.dia(2, 0), test.dia(3, 0), test.u('b1'))) = 1, 'caso 135: filtro por profesional';
  ASSERT NOT EXISTS (SELECT 1 FROM retenciones_en_curso(test.dia(2, 0), test.dia(3, 0), test.u('b2'))), 'caso 135: otro profesional';
  BEGIN
    PERFORM count(*) FROM retenciones_en_curso(test.dia(0, 0), test.dia(70, 0));
    RAISE EXCEPTION 'caso 135: rango mayor a 62 dias';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    PERFORM count(*) FROM retenciones_en_curso(test.dia(2, 0), test.dia(3, 0));
    RAISE EXCEPTION 'caso 135: el paciente no ve retenciones';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM purgar_codigos_verificacion();
    RAISE EXCEPTION 'caso 135: la purga de codigos es solo del job';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  DELETE FROM bloqueos_temporales;
END $$;

\echo 137 Protocolo del centro (03b-4.2) como app_user: el protocolo interno solo lo ve el equipo (ni el paciente ni sin contexto); leido idempotente y solo via funcion; ADMIN/GESTION ven las lecturas, el profesional la suya; el paciente adulto acusa el protocolo de paciente
DO $$ DECLARE v_t timestamptz; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT EXISTS (SELECT 1 FROM politica_vigente('PROTOCOLO_EQUIPO')), 'caso 137: el equipo ve el protocolo interno';
  v_t := marcar_protocolo_leido();
  ASSERT v_t IS NOT NULL AND marcar_protocolo_leido() = v_t, 'caso 137: leido idempotente';
  ASSERT (SELECT count(*) FROM lecturas_protocolo) = 1, 'caso 137: el profesional ve su lectura';
  BEGIN
    INSERT INTO lecturas_protocolo (politica_id, usuario_id, rol)
    VALUES ((SELECT id FROM politica_vigente('PROTOCOLO_EQUIPO')), test.u('b2'), 'PROFESIONAL');
    RAISE EXCEPTION 'caso 137: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM lecturas_protocolo), 'caso 137: no ve lecturas ajenas';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT EXISTS (SELECT 1 FROM lecturas_protocolo WHERE usuario_id = test.u('b1')), 'caso 137: GESTION ve quien lo leyo';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT NOT EXISTS (SELECT 1 FROM politica_vigente('PROTOCOLO_EQUIPO')), 'caso 137: el paciente no ve el protocolo interno';
  ASSERT NOT EXISTS (SELECT 1 FROM politicas WHERE tipo = 'PROTOCOLO_EQUIPO'), 'caso 137: ni por la tabla';
  BEGIN
    PERFORM marcar_protocolo_leido();
    RAISE EXCEPTION 'caso 137: el paciente no marca el protocolo interno';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM registrar_aceptacion('PROTOCOLO_EQUIPO', test.u('0a'), NULL, NULL);
    RAISE EXCEPTION 'caso 137: el paciente no acusa el protocolo interno';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM registrar_aceptacion('PROTOCOLO_PACIENTE', test.u('0a'), NULL, NULL);
  ASSERT EXISTS (SELECT 1 FROM aceptaciones_politica a JOIN politicas p ON p.id = a.politica_id
                 WHERE p.tipo = 'PROTOCOLO_PACIENTE' AND a.paciente_id = test.u('0a') AND a.canal = 'PORTAL'),
    'caso 137: acuse del protocolo del paciente';
  PERFORM test.ctx('b2', 'PROFESIONAL');  -- tratante de Ana desde el caso 43
  ASSERT EXISTS (SELECT 1 FROM aceptaciones_politica a JOIN politicas p ON p.id = a.politica_id
                 WHERE p.tipo = 'PROTOCOLO_PACIENTE' AND a.paciente_id = test.u('0a')), 'caso 137: el tratante ve el acuse';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT NOT EXISTS (SELECT 1 FROM politica_vigente('PROTOCOLO_EQUIPO')), 'caso 137: sin contexto no hay protocolo interno';
  ASSERT EXISTS (SELECT 1 FROM politica_vigente('PROTOCOLO_PACIENTE')), 'caso 137: el del paciente es publico';
END $$;
\connect :owner_url
\set ON_ERROR_STOP 1

\echo 128 Vencimientos (03b-3.2, job): la retencion vencida figura liberada y el job la libera (sin paciente, sin aviso); verificacion tardia con la hora libre continua (SOLICITADA) y tomada da 23P01
DO $$ DECLARE v_pol uuid := (SELECT id FROM politica_vigente('POLITICA_DATOS'));
              v_ter uuid := (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')); r record;
              v_tea uuid; v_tom uuid; BEGIN
  SELECT cita_id INTO v_tea FROM crear_solicitud_hora(test.u('7e'), test.u('b9'), 'PRESENCIAL', test.dia(43, 10), test.dia(43, 11),
                               'Tea', 'Tarde', '1990-01-01', 'tea@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_pol, v_ter,
                               sha256('t128a'), sha256('r128a'));
  SELECT cita_id INTO v_tom FROM crear_solicitud_hora(test.u('8a'), test.u('b9'), 'PRESENCIAL', test.dia(44, 10), test.dia(44, 11),
                               'Tom', 'Tomada', '1990-01-01', 'tom@x', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, v_pol, v_ter,
                               sha256('t128b'), sha256('r128b'));
  ASSERT (SELECT estado = 'RETENIDA' AND siguiente = 'VERIFICAR_CORREO' AND vence_en > now() FROM estado_reserva(sha256('r128a'))),
    'caso 128: retenida, falta verificar el correo';
  UPDATE citas SET retencion_vence_en = now() - interval '1 minute' WHERE id IN (v_tea, v_tom);
  ASSERT (SELECT estado = 'LIBERADA' AND siguiente = 'ELEGIR_OTRA_HORA' FROM estado_reserva(sha256('r128a'))),
    'caso 128: vencida por hora del servidor aunque el job aun no corra';
  ASSERT liberar_reservas_vencidas() = 2, 'caso 128: dos retenciones liberadas';
  ASSERT liberar_reservas_vencidas() = 0, 'caso 128: idempotente';
  ASSERT (SELECT count(*) FROM solicitudes_hora WHERE id IN (test.u('7e'), test.u('8a')) AND estado = 'EXPIRADA') = 2,
    'caso 128: reservas vencidas';
  ASSERT NOT EXISTS (SELECT 1 FROM notificaciones WHERE referencia_id IN (v_tea, v_tom)), 'caso 128: sin paciente no hay a quien avisar';
  -- Verificacion tardia con la hora libre: continua y la hora pasa al profesional.
  SELECT * INTO r FROM concretar_reserva(sha256('t128a'), test.u('1d'), test.u('d4'), NULL, NULL, NULL, NULL, NULL, NULL);
  ASSERT r.estado = 'SOLICITADA' AND r.paciente_id = test.u('1d'), 'caso 128: verificacion tardia con la hora libre';
  ASSERT (SELECT estado = 'SOLICITADA' AND siguiente = 'NINGUNO' AND vence_en IS NOT NULL FROM estado_reserva(sha256('r128a'))),
    'caso 128: la reserva queda por aprobar';
  -- Verificacion tardia con la hora tomada: 23P01 (la API responde con alternativas).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin)
  VALUES ('ONLINE', test.u('b9'), test.u('16'), test.dia(44, 10), test.dia(44, 11));
  BEGIN
    PERFORM concretar_reserva(sha256('t128b'), test.u('1e'), test.u('d5'), NULL, NULL, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'caso 128: la hora ya estaba tomada';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  ASSERT NOT EXISTS (SELECT 1 FROM pacientes WHERE id = test.u('1e')), 'caso 128: con la hora tomada no nace el paciente';
END $$;
\echo 115 Job de solicitudes: la retencion vence con su cita (liberar_reservas_vencidas) y se eliminan solicitudes vencidas antiguas (minimizacion)
DO $$ BEGIN
  UPDATE citas SET retencion_vence_en = now() - interval '1 minute' WHERE id = (SELECT cita_id FROM solicitudes_hora WHERE id = test.u('3c'));
  PERFORM liberar_reservas_vencidas();
  ASSERT (SELECT s.estado = 'EXPIRADA' AND c.estado = 'LIBERADA' FROM solicitudes_hora s JOIN citas c ON c.id = s.cita_id
          WHERE s.id = test.u('3c')), 'caso 115: vencida y la hora se libera';
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

\echo 136 Job de codigos (03b-4.1): borra codigos de correo vencidos o usados hace mas de 24 h y respaldo usados o anulados hace mas de 90 dias; los vigentes quedan
DO $$ DECLARE h text := 't136-'; n int; BEGIN
  INSERT INTO codigos_verificacion (usuario_id, codigo_hash, expira_en, creado_en) VALUES
    (test.u('b1'), sha256(convert_to(h || 'viejo', 'UTF8')), now() - interval '2 days', now() - interval '2 days 10 minutes'),
    (test.u('b1'), sha256(convert_to(h || 'vigente', 'UTF8')), now() + interval '10 minutes', now());
  INSERT INTO codigos_respaldo (usuario_id, codigo_hash, usado_en, anulado_en) VALUES
    (test.u('b1'), sha256(convert_to(h || 'r-usado', 'UTF8')), now() - interval '100 days', NULL),
    (test.u('b1'), sha256(convert_to(h || 'r-anulado', 'UTF8')), NULL, now() - interval '100 days'),
    (test.u('b1'), sha256(convert_to(h || 'r-reciente', 'UTF8')), NULL, now() - interval '10 days'),
    (test.u('b1'), sha256(convert_to(h || 'r-vigente', 'UTF8')), NULL, NULL);
  n := purgar_codigos_verificacion();
  ASSERT n >= 3, 'caso 136: borra los vencidos';
  ASSERT NOT EXISTS (SELECT 1 FROM codigos_verificacion WHERE codigo_hash = sha256(convert_to(h || 'viejo', 'UTF8'))), 'caso 136: codigo viejo';
  ASSERT EXISTS (SELECT 1 FROM codigos_verificacion WHERE codigo_hash = sha256(convert_to(h || 'vigente', 'UTF8'))), 'caso 136: codigo vigente';
  ASSERT (SELECT count(*) FROM codigos_respaldo
          WHERE codigo_hash IN (sha256(convert_to(h || 'r-usado', 'UTF8')), sha256(convert_to(h || 'r-anulado', 'UTF8')))) = 0,
    'caso 136: respaldo antiguos';
  ASSERT (SELECT count(*) FROM codigos_respaldo
          WHERE codigo_hash IN (sha256(convert_to(h || 'r-reciente', 'UTF8')), sha256(convert_to(h || 'r-vigente', 'UTF8')))) = 2,
    'caso 136: respaldo recientes y vigentes';
  ASSERT purgar_codigos_verificacion() = 0, 'caso 136: idempotente';
  DELETE FROM codigos_verificacion WHERE usuario_id = test.u('b1');
  DELETE FROM codigos_respaldo WHERE usuario_id = test.u('b1');
END $$;

\echo 122 03a-2 como dueño: plantilla publicada e ingreso inmutables; mensajes sin edicion; duplicado con alerta y aviso; purga y reintento de correos (jobs)
DO $$ DECLARE v_old uuid := gen_random_uuid(); v_hv uuid := gen_random_uuid(); v_c uuid := gen_random_uuid(); n int; BEGIN
  BEGIN
    UPDATE plantillas_clinicas SET nombre = 'x' WHERE id = test.id('p117v2');
    RAISE EXCEPTION 'caso 122: publicada inmutable';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    DELETE FROM plantillas_clinicas WHERE id = test.id('p117v1');
    RAISE EXCEPTION 'caso 122: plantillas no se borran';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    DELETE FROM ingresos_ficha;
    RAISE EXCEPTION 'caso 122: ingreso append-only';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    UPDATE mensajes_internos SET contenido = NULL, retirado_en = now();
    RAISE EXCEPTION 'caso 122: sin edicion ni retiro fuera de la funcion';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
  BEGIN
    DELETE FROM mensajes_internos;
    RAISE EXCEPTION 'caso 122: mensajes solo se borran por retencion';
  EXCEPTION WHEN restrict_violation THEN NULL; END;

  -- Cuenta cerrada: su nombre en el hilo se minimiza.
  INSERT INTO participantes_hilo (hilo_id, usuario_id) VALUES (test.id('g120'), test.u('b6'));
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT EXISTS (SELECT 1 FROM nombres_hilo(test.id('g120')) WHERE usuario_id = test.u('b6') AND nombre = 'Ex integrante del equipo'),
    'caso 122: nombre minimizado tras cerrar la cuenta';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);

  -- Duplicado: alerta a ADMIN y aviso a ADMIN/GESTION; resuelve administracion.
  UPDATE pacientes SET posible_duplicado = true WHERE id = test.u('15');
  ASSERT (SELECT count(*) FROM alertas_internas WHERE tipo = 'POSIBLE_DUPLICADO' AND referencia_id = test.u('15') AND atendida_en IS NULL) = 1,
    'caso 122: alerta de duplicado';
  ASSERT (SELECT count(DISTINCT usuario_id) FROM notificaciones WHERE tipo = 'POSIBLE_DUPLICADO' AND referencia_id = test.u('15')
            AND usuario_id IN (test.u('a1'), test.u('a3'))) = 2, 'caso 122: aviso a ADMIN y GESTION';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM resolver_posible_duplicado(test.u('15'), 'DISTINTO');
    RAISE EXCEPTION 'caso 122: el tratante no resuelve';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM resolver_posible_duplicado(test.u('15'), 'FUSIONAR');
    RAISE EXCEPTION 'caso 122: resolucion invalida';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM resolver_posible_duplicado(test.u('15'), 'DISTINTO');
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (SELECT NOT posible_duplicado FROM pacientes WHERE id = test.u('15'))
         AND NOT EXISTS (SELECT 1 FROM alertas_internas WHERE tipo = 'POSIBLE_DUPLICADO' AND referencia_id = test.u('15') AND atendida_en IS NULL)
         AND EXISTS (SELECT 1 FROM accesos_ficha WHERE paciente_id = test.u('15') AND accion = 'DUPLICADO_DISTINTO'), 'caso 122: resuelto y auditado';

  -- Purga por retencion: mensaje antiguo y el hilo que queda vacio; el hilo reciente se conserva.
  INSERT INTO hilos_internos (id, tipo, asunto, creado_por_id, creado_en, ultimo_mensaje_en)
  VALUES (v_hv, 'GENERAL', test.cif('viejo'), test.u('b1'), now() - interval '400 days', now() - interval '400 days');
  INSERT INTO participantes_hilo (hilo_id, usuario_id) VALUES (v_hv, test.u('b1'));
  INSERT INTO mensajes_internos (id, hilo_id, autor_id, rol_autor, contenido, creado_en)
  VALUES (v_old, v_hv, test.u('b1'), 'PROFESIONAL', test.cif('viejo'), now() - interval '400 days');
  UPDATE hilos_internos SET ultimo_mensaje_en = now() - interval '400 days' WHERE id = v_hv;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM purgar_mensajes_internos();
    RAISE EXCEPTION 'caso 122: purga solo del job';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  n := purgar_mensajes_internos();
  ASSERT n >= 1 AND NOT EXISTS (SELECT 1 FROM mensajes_internos WHERE id = v_old) AND NOT EXISTS (SELECT 1 FROM hilos_internos WHERE id = v_hv)
         AND EXISTS (SELECT 1 FROM hilos_internos WHERE id = test.id('g120')), 'caso 122: purga por retencion';

  -- Correo de cuenta: se encola, sale con backoff y se borra al enviarse.
  PERFORM encolar_correo_cuenta(v_c, test.cif('e@x'), 'Active su cuenta', test.cif('cuerpo con enlace'), now() + interval '1 day');
  ASSERT (SELECT count(*) FROM correos_cuenta_por_enviar(10)) = 0, 'caso 122: espera el primer reintento';
  UPDATE correos_cuenta_pendientes SET proximo_intento = now() WHERE id = v_c;
  ASSERT (SELECT count(*) FROM correos_cuenta_por_enviar(10)) = 1, 'caso 122: pendiente vencido sale';
  PERFORM resultado_correo_cuenta(v_c, false);
  ASSERT (SELECT intentos = 2 AND proximo_intento > now() FROM correos_cuenta_pendientes WHERE id = v_c), 'caso 122: backoff';
  PERFORM resultado_correo_cuenta(v_c, true);
  ASSERT NOT EXISTS (SELECT 1 FROM correos_cuenta_pendientes WHERE id = v_c), 'caso 122: enviado se borra';
END $$;

\echo 67 Append-only incluso como dueño: historial, comentarios, eventos de llaves, intervenciones; sin DELETE en consentimientos ni llaves
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['historial_accesos_practicante', 'supervision_comentarios', 'consentimientos', 'eventos_llaves',
                           'llaves_datos', 'evolucion_intervenciones', 'avisos_consentimiento', 'revisiones_retencion',
                           'consultas_retencion', 'alertas_internas', 'notificaciones', 'mensajes_paciente',
                           'solicitudes_epicrisis', 'documentos_clinicos', 'envios_documento', 'descargas_documento',
                           'preferencias_notificacion', 'recordatorios_cita', 'adjuntos_ficha', 'politicas',
                           'aceptaciones_politica', 'resenas_eventos', 'altas_paciente', 'accesos_clinicos_temporales',
                           'imagenes_publicas'] LOOP
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
END $$;

\echo 142 Soporte (AUD-01 E2.1, dueño con SET ROLE soporte_vinculos): sin autorizacion del centro nada; ninguna tabla legible (tampoco pacientes ni evoluciones); con autorizacion DIAGNOSTICO solo agregados y queda registrado; CONFIGURACION exige su alcance; revocada vuelve a cerrar
DO $$ DECLARE v uuid; r jsonb; BEGIN
  EXECUTE 'SET ROLE soporte_vinculos';
  BEGIN
    PERFORM soporte_resumen();
    RAISE EXCEPTION 'caso 142: sin autorizacion debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM count(*) FROM pacientes;
    RAISE EXCEPTION 'caso 142: leer pacientes debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM count(*) FROM evoluciones;
    RAISE EXCEPTION 'caso 142: leer evoluciones debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM count(*) FROM autorizaciones_soporte;
    RAISE EXCEPTION 'caso 142: leer sus autorizaciones debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  PERFORM test.ctx('a1', 'ADMIN');
  v := otorgar_soporte('Revisar correos que no salen', 'DIAGNOSTICO', 2);
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);

  EXECUTE 'SET ROLE soporte_vinculos';
  r := soporte_resumen();
  ASSERT r ? 'migracion' AND r ? 'usuarios_activos_por_rol', format('caso 142: resumen %s', r);
  ASSERT r::text NOT LIKE '%@%', 'caso 142: el resumen no trae correos';
  PERFORM * FROM soporte_notificaciones_con_error(7);
  BEGIN
    PERFORM soporte_configuracion();
    RAISE EXCEPTION 'caso 142: CONFIGURACION con alcance DIAGNOSTICO debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  ASSERT (SELECT count(*) FROM registro_soporte WHERE autorizacion_id = v) = 2, 'caso 142: dos diagnosticos registrados';
  ASSERT (SELECT bool_and(rol_bd = session_user) FROM registro_soporte WHERE autorizacion_id = v), 'caso 142: rol de la sesion';

  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM revocar_soporte(v);
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  EXECUTE 'SET ROLE soporte_vinculos';
  BEGIN
    PERFORM soporte_resumen();
    RAISE EXCEPTION 'caso 142: revocada debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  BEGIN
    UPDATE registro_soporte SET funcion = 'x' WHERE autorizacion_id = v;
    RAISE EXCEPTION 'caso 142: registro append-only debio fallar';
  EXCEPTION WHEN restrict_violation THEN NULL; END;
END $$;

\echo 146 Dias habiles y alerta de plazo (AUD-01 E2.3a, dueño): viernes 30-10-2026 + 1 = lunes 2-11 (sabado 31 feriado y domingo); 7-12 + 1 = 9-12 (8 feriado); el job alerta una vez por solicitud a 5 dias habiles o menos
DO $$ DECLARE v uuid := gen_random_uuid(); BEGIN
  ASSERT dias_habiles_desde('2026-10-30', 1) = '2026-11-02', 'caso 146: fin de semana con feriado';
  ASSERT dias_habiles_desde('2026-12-07', 1) = '2026-12-09', 'caso 146: feriado entre semana';
  INSERT INTO solicitudes_derechos (id, tipo, canal, vence_el)
  VALUES (v, 'ACCESO', 'CORREO', dias_habiles_desde((now() AT TIME ZONE 'America/Santiago')::date, 3));
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT alertar_solicitudes_por_vencer() >= 1, 'caso 146: alerta creada';
  ASSERT alertar_solicitudes_por_vencer() = 0, 'caso 146: una sola vez';
  ASSERT EXISTS (SELECT 1 FROM alertas_internas WHERE tipo = 'SOLICITUD_DERECHO_POR_VENCER' AND referencia_id = v AND atendida_en IS NULL),
    'caso 146: alerta de la solicitud';
END $$;

\echo 147 Bloqueo, cancelacion y WhatsApp (AUD-01 E2.3c, dueño con contexto): solo ADMIN bloquea (con motivo); bloqueado: sin citas, derivaciones ni ediciones nuevas, lo ya agendado sigue; levantar; cancelacion solo con solicitud abierta, borra lo periferico y conserva identificacion y ficha; WhatsApp: la fecha la fija la BD
DO $$ DECLARE v_sol uuid := gen_random_uuid(); v_cita uuid; v_msg text; BEGIN
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin)
  VALUES ('ONLINE', test.u('b1'), test.u('15'), test.dia(70, 9), test.dia(70, 10)) RETURNING id INTO v_cita;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM bloquear_tratamiento(test.u('15'), 'Solicitud de bloqueo', NULL);
    RAISE EXCEPTION 'caso 147: GESTION bloquea debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM bloquear_tratamiento(test.u('15'), ' ', NULL);
    RAISE EXCEPTION 'caso 147: sin motivo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM bloquear_tratamiento(test.u('15'), 'Titular pidio bloqueo mientras revisamos su solicitud', NULL);
  ASSERT (SELECT bloqueo_desde IS NOT NULL AND bloqueado_por_id = test.u('a1') FROM pacientes WHERE id = test.u('15')), 'caso 147: bloqueado';
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin)
    VALUES ('ONLINE', test.u('b1'), test.u('15'), test.dia(71, 9), test.dia(71, 10));
    RAISE EXCEPTION 'caso 147: cita nueva bloqueada debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    UPDATE pacientes SET nombre = 'Otra' WHERE id = test.u('15');
    RAISE EXCEPTION 'caso 147: editar bloqueado debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  ASSERT (SELECT estado FROM citas WHERE id = v_cita) = 'CONFIRMADA', 'caso 147: lo agendado se mantiene';
  PERFORM levantar_bloqueo(test.u('15'));
  UPDATE pacientes SET email = 'lia-147@x.cl', contacto_emergencia = NULL WHERE id = test.u('15');
  -- Cancelacion de datos perifericos.
  BEGIN
    PERFORM cancelar_datos_perifericos(test.u('15'), gen_random_uuid());
    RAISE EXCEPTION 'caso 147: cancelar sin solicitud debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO solicitudes_derechos (id, tipo, paciente_id, canal, vence_el) VALUES (v_sol, 'CANCELACION', test.u('15'), 'CORREO', current_date + 40);
  -- 2026-11-03: el consentimiento exige el modulo WHATSAPP (caso 156).
  UPDATE configuracion_centro SET modulos_activos = modulos_activos || 'WHATSAPP'::modulo_centro;
  INSERT INTO preferencias_notificacion (paciente_id, whatsapp) VALUES (test.u('15'), true);
  UPDATE configuracion_centro SET modulos_activos = array_remove(modulos_activos, 'WHATSAPP');
  ASSERT (SELECT whatsapp_consentido_en IS NOT NULL FROM preferencias_notificacion WHERE paciente_id = test.u('15')), 'caso 147: fecha del consentimiento';
  v_msg := cancelar_datos_perifericos(test.u('15'), v_sol);
  ASSERT v_msg LIKE '%15 años%', 'caso 147: explica el motivo legal';
  ASSERT (SELECT email IS NULL AND telefono IS NULL AND nombre = 'Lia' AND fecha_nacimiento IS NOT NULL FROM pacientes WHERE id = test.u('15')),
    'caso 147: borra contacto y conserva identificacion';
  ASSERT (SELECT NOT whatsapp AND whatsapp_consentido_en IS NULL AND NOT recordatorios FROM preferencias_notificacion WHERE paciente_id = test.u('15')),
    'caso 147: preferencias apagadas';
  ASSERT EXISTS (SELECT 1 FROM fichas_clinicas WHERE paciente_id = test.u('15')) OR NOT EXISTS (SELECT 1 FROM evoluciones e JOIN fichas_clinicas f ON f.id = e.ficha_clinica_id WHERE f.paciente_id = test.u('15')),
    'caso 147: la ficha no se toca';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;

\echo 148 Deteccion (AUD-01 E2.4, dueño): lecturas de mas de 40 pacientes en una hora por una cuenta y 10 ingresos fallidos con un mismo identificador generan una alerta (una sola, sin nombres); el login fallido solo sin contexto y solo el HMAC
DO $$ DECLARE i int; v_h bytea := sha256('identificador-148'); BEGIN
  FOR i IN 1..41 LOOP
    INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id)
    VALUES (gen_random_uuid(), 'P148', 'N' || i, '1990-01-01', test.u('b1'));
  END LOOP;
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  SELECT test.u('b1'), 'PROFESIONAL', id, 'fichas_clinicas', 'LECTURA' FROM pacientes WHERE nombre = 'P148';
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM registrar_login_fallido(v_h);
    RAISE EXCEPTION 'caso 148: con contexto debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM detectar_anomalias();
    RAISE EXCEPTION 'caso 148: el job con usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  FOR i IN 1..10 LOOP PERFORM registrar_login_fallido(v_h); END LOOP;
  ASSERT detectar_anomalias() >= 2, 'caso 148: dos alertas';
  ASSERT detectar_anomalias() = 0, 'caso 148: una sola vez';
  ASSERT EXISTS (SELECT 1 FROM alertas_internas WHERE tipo = 'ACCESO_ANOMALO' AND referencia_id = test.u('b1') AND detalle NOT LIKE '%P148%'),
    'caso 148: alerta de lecturas masivas sin nombres';
  ASSERT EXISTS (SELECT 1 FROM alertas_internas WHERE tipo = 'LOGIN_FALLIDO_REPETIDO' AND referencia_id = md5(v_h)::uuid),
    'caso 148: alerta de ingresos fallidos';
END $$;

\echo 149 Formulario publico de derechos (AUD-01 E2.3b, dueño): sin contexto registra solo si el RUT es de un paciente y devuelve su correo registrado; RUT desconocido no guarda nada; maximo 3 en 24 h por paciente; con contexto 42501
DO $$ DECLARE v_correo text; n int; BEGIN
  UPDATE pacientes SET rut_hmac = sha256('rut-149'), email = 'lia-149@x.cl' WHERE id = test.u('15');
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT registrar_solicitud_publica(gen_random_uuid(), 'ACCESO', sha256('no-existe-149'), NULL, false) IS NULL, 'caso 149: RUT desconocido';
  v_correo := registrar_solicitud_publica(gen_random_uuid(), 'ACCESO', sha256('rut-149'), NULL, true);
  ASSERT v_correo = 'lia-149@x.cl', 'caso 149: correo registrado';
  ASSERT EXISTS (SELECT 1 FROM solicitudes_derechos WHERE paciente_id = test.u('15') AND canal = 'FORMULARIO_PUBLICO' AND pide_cambio_correo),
    'caso 149: registrada con pedido de cambio de correo';
  PERFORM registrar_solicitud_publica(gen_random_uuid(), 'ACCESO', sha256('rut-149'), NULL, false);
  PERFORM registrar_solicitud_publica(gen_random_uuid(), 'ACCESO', sha256('rut-149'), NULL, false);
  ASSERT registrar_solicitud_publica(gen_random_uuid(), 'ACCESO', sha256('rut-149'), NULL, false) IS NULL, 'caso 149: cuarta descartada';
  SELECT count(*) INTO n FROM solicitudes_derechos WHERE paciente_id = test.u('15') AND canal = 'FORMULARIO_PUBLICO';
  ASSERT n = 3, format('caso 149: tres registradas (%s)', n);
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM registrar_solicitud_publica(gen_random_uuid(), 'ACCESO', sha256('rut-149'), NULL, false);
    RAISE EXCEPTION 'caso 149: con contexto debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;

\echo 150 Exportaciones (AUD-01 Fase 3, dueño con contexto): parte administrativa solo ADMIN, clinica solo el tratante; sin hashes ni HMAC; la del centro excluye llaves y sesiones; descarga sin cuenta exige el codigo; vencida se purga
DO $$ DECLARE v jsonb; v_sol uuid := gen_random_uuid(); v_exp uuid := gen_random_uuid(); BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM exportar_datos_paciente(test.u('15'), 'ADMINISTRATIVA');
    RAISE EXCEPTION 'caso 150: GESTION exporta debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM exportar_datos_paciente(test.u('15'), 'CLINICA');
    RAISE EXCEPTION 'caso 150: ADMIN exporta lo clinico debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  v := exportar_datos_paciente(test.u('15'), 'ADMINISTRATIVA');
  ASSERT v ? 'pacientes' AND NOT (v -> 'pacientes' -> 0) ? 'rut_hmac', 'caso 150: administrativa sin rut_hmac';
  BEGIN
    PERFORM * FROM exportar_tabla_centro_lote('llaves_datos', NULL, 10);
    RAISE EXCEPTION 'caso 150: exportar llaves debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT NOT EXISTS (SELECT 1 FROM tablas_exportacion_centro() t WHERE t IN ('llaves_datos', 'sesiones', 'tokens_correo')), 'caso 150: sin llaves ni sesiones';
  ASSERT NOT EXISTS (SELECT 1 FROM exportar_tabla_centro_lote('usuarios', NULL, 1000) l WHERE l.fila ? 'password_hash'), 'caso 150: sin contraseñas';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  v := exportar_datos_paciente(test.u('15'), 'CLINICA');
  ASSERT v ? 'evoluciones', 'caso 150: el tratante exporta lo clinico';
  -- Descarga sin cuenta: exige el codigo; vencida se purga.
  INSERT INTO solicitudes_derechos (id, tipo, paciente_id, canal, vence_el) VALUES (v_sol, 'ACCESO', test.u('15'), 'CORREO', current_date + 40);
  INSERT INTO exportaciones_paciente (id, paciente_id, solicitud_id, datos_administrativos, requiere_clinica, creada_por_id, enviada_en, vence_en)
  VALUES (v_exp, test.u('15'), v_sol, test.cif('{}'), false, test.u('a1'), now(), now() + interval '72 hours');
  INSERT INTO destinatarios_exportacion (exportacion_id, token_hash, codigo_hash) VALUES (v_exp, sha256('tok-150'), sha256('cod-150'));
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  BEGIN
    PERFORM * FROM entregar_exportacion(sha256('tok-150'), sha256('otro'));
    RAISE EXCEPTION 'caso 150: codigo incorrecto debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT id FROM entregar_exportacion(sha256('tok-150'), sha256('cod-150'))) = v_exp, 'caso 150: entrega con codigo';
  UPDATE exportaciones_paciente SET vence_en = now() - interval '1 minute' WHERE id = v_exp;
  ASSERT purgar_exportaciones_vencidas() >= 1, 'caso 150: purga';
  ASSERT (SELECT datos_administrativos IS NULL AND purgada_en IS NOT NULL FROM exportaciones_paciente WHERE id = v_exp), 'caso 150: purgada';
END $$;

\echo 151 Copia de datos segun la edad (AUD-01 Fase 3, dueño): menor de 14 solo sus adultos responsables; 14 a 17 ambos; mayor solo el paciente; un enlace por destinatario; la cuenta RESPONSABLE descarga con su sesion y otra cuenta no
DO $$ DECLARE v_sol uuid := gen_random_uuid(); v_exp uuid := gen_random_uuid(); v_adulto uuid := gen_random_uuid();
  v_nac date; v_correo text; n int; BEGIN
  SELECT fecha_nacimiento, email INTO v_nac, v_correo FROM pacientes WHERE id = test.u('15');
  UPDATE pacientes SET email = 'pac-151@x.cl' WHERE id = test.u('15');
  INSERT INTO adultos_responsables (id, paciente_id, nombre, email, usuario_id) VALUES (v_adulto, test.u('15'), 'Madre 151', 'madre-151@x.cl', test.u('aa'));
  UPDATE pacientes SET fecha_nacimiento = current_date - interval '10 years' WHERE id = test.u('15');
  ASSERT (SELECT array_agg(correo ORDER BY orden) FROM destinatarios_por_edad(test.u('15'))) = ARRAY['madre-151@x.cl'], 'caso 151: menor de 14 solo el adulto';
  UPDATE pacientes SET fecha_nacimiento = current_date - interval '15 years' WHERE id = test.u('15');
  ASSERT (SELECT array_agg(correo ORDER BY orden) FROM destinatarios_por_edad(test.u('15'))) = ARRAY['pac-151@x.cl', 'madre-151@x.cl'], 'caso 151: 14 a 17 ambos';
  UPDATE pacientes SET fecha_nacimiento = current_date - interval '14 years' WHERE id = test.u('15');
  ASSERT (SELECT count(*) FROM destinatarios_por_edad(test.u('15'))) = 2, 'caso 151: el dia que cumple 14 ya recibe';
  UPDATE pacientes SET fecha_nacimiento = current_date - interval '18 years' WHERE id = test.u('15');
  ASSERT (SELECT array_agg(correo ORDER BY orden) FROM destinatarios_por_edad(test.u('15'))) = ARRAY['pac-151@x.cl'], 'caso 151: mayor solo el paciente';
  -- 15 años: dos enlaces; el adulto con cuenta va sin codigo.
  UPDATE pacientes SET fecha_nacimiento = current_date - interval '15 years' WHERE id = test.u('15');
  INSERT INTO solicitudes_derechos (id, tipo, paciente_id, canal, vence_el) VALUES (v_sol, 'ACCESO', test.u('15'), 'CORREO', current_date + 40);
  INSERT INTO exportaciones_paciente (id, paciente_id, solicitud_id, datos_administrativos, requiere_clinica, creada_por_id)
  VALUES (v_exp, test.u('15'), v_sol, test.cif('{}'), false, test.u('a1'));
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM destinatarios_pendientes_exportacion(v_exp);
    RAISE EXCEPTION 'caso 151: GESTION envia debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT destinatarios_pendientes_exportacion(v_exp) = 2, 'caso 151: dos destinatarios';
  BEGIN
    PERFORM * FROM enviar_exportacion(v_exp, ARRAY[sha256('t1')], ARRAY[sha256('c1')]);
    RAISE EXCEPTION 'caso 151: enlaces de menos debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  SELECT count(*) INTO n FROM enviar_exportacion(v_exp, ARRAY[sha256('t-pac-151'), sha256('t-adulto-151')], ARRAY[sha256('c-pac-151'), sha256('c-adulto-151')]) d
  WHERE (d.es_adulto AND d.con_cuenta AND d.correo = 'madre-151@x.cl') OR (NOT d.es_adulto AND d.correo = 'pac-151@x.cl');
  ASSERT n = 2, 'caso 151: enviados a ambos';
  ASSERT (SELECT codigo_hash IS NULL AND usuario_id = test.u('aa') FROM destinatarios_exportacion WHERE adulto_responsable_id = v_adulto),
    'caso 151: el adulto con cuenta no lleva codigo';
  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    PERFORM * FROM entregar_exportacion(sha256('t-adulto-151'), NULL);
    RAISE EXCEPTION 'caso 151: otra cuenta descarga el enlace del adulto debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('aa', 'RESPONSABLE');
  ASSERT (SELECT id FROM entregar_exportacion(sha256('t-adulto-151'), NULL)) = v_exp, 'caso 151: el adulto descarga con su sesion';
  ASSERT EXISTS (SELECT 1 FROM accesos_ficha WHERE usuario_id = test.u('aa') AND rol = 'RESPONSABLE' AND recurso = 'exportacion_paciente' AND accion = 'DESCARGA'),
    'caso 151: descarga del adulto auditada';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  UPDATE pacientes SET fecha_nacimiento = v_nac, email = v_correo WHERE id = test.u('15');
END $$;

\echo 152 Feriados por ley (AUD-01 E2.3a): reglas de traslado y Pascua; el job no corre con usuario; ADMIN agrega y quita solo de hoy en adelante; quitado no cuenta y el job no lo revive
DO $$ DECLARE v date := (now() AT TIME ZONE 'America/Santiago')::date + 400; BEGIN
  -- Dia habil: ni fin de semana ni feriado (hoy + 400 cayo en 8-12-2027, Inmaculada Concepcion).
  WHILE extract(isodow FROM v) >= 6 OR EXISTS (SELECT 1 FROM feriados WHERE fecha = v)
        OR EXISTS (SELECT 1 FROM feriados_legales(extract(year FROM v)::int) WHERE fecha = v) LOOP
    v := v + 1;
  END LOOP;
  ASSERT (SELECT array_agg(fecha ORDER BY fecha) FROM feriados_legales(2023) WHERE fecha IN ('2023-01-02', '2023-04-07', '2023-06-21', '2023-06-26', '2023-10-09', '2023-10-27'))
         = ARRAY['2023-01-02', '2023-04-07', '2023-06-21', '2023-06-26', '2023-10-09', '2023-10-27']::date[], 'caso 152: 2023 (2 de enero, Pascua, traslados, 27 de octubre)';
  ASSERT (SELECT count(*) FROM feriados_legales(2024) WHERE fecha IN ('2024-06-20', '2024-09-20')) = 2, 'caso 152: 2024 solsticio 20-06 y 20 de septiembre viernes';
  ASSERT (SELECT count(*) FROM feriados_legales(2018) WHERE fecha IN ('2018-07-02', '2018-09-17', '2018-10-15', '2018-11-02')) = 4, 'caso 152: 2018 traslados y 17 de septiembre lunes';
  ASSERT (SELECT count(*) FROM feriados_legales(2027) WHERE fecha IN ('2027-06-21', '2027-06-28', '2027-09-17', '2027-10-11')) = 4, 'caso 152: 2027';
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM generar_feriados(2030);
    RAISE EXCEPTION 'caso 152: generar con usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM agregar_feriado('2020-03-02', 'Pasado');
    RAISE EXCEPTION 'caso 152: feriado pasado debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM agregar_feriado(v, 'Feriado regional 152');
  ASSERT dias_habiles_desde(v - 1, 1) > v, 'caso 152: el agregado no es habil';
  PERFORM quitar_feriado(v);
  ASSERT (SELECT quitado_por_id = test.u('a1') FROM feriados WHERE fecha = v), 'caso 152: quitado con autor';
  ASSERT dias_habiles_desde(v - 1, 1) = v, 'caso 152: el quitado es habil';
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM agregar_feriado(v, 'Otro');
    RAISE EXCEPTION 'caso 152: GESTION agrega debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  -- El job no revive un feriado de ley quitado.
  UPDATE feriados SET quitado_en = now(), quitado_por_id = test.u('a1') WHERE fecha = '2027-09-17';
  PERFORM generar_feriados(2027);
  ASSERT (SELECT quitado_en IS NOT NULL FROM feriados WHERE fecha = '2027-09-17'), 'caso 152: no revive el quitado';
  UPDATE feriados SET quitado_en = NULL, quitado_por_id = NULL WHERE fecha = '2027-09-17';
  DELETE FROM feriados WHERE fecha = v;
END $$;

-- 153 corre como app_user (RLS real); luego de vuelta al dueño para el caso 78.
\connect :app_url
\set ON_ERROR_STOP 1
\echo 153 03b-4.2: recordatorios personales solo de su autor (ni ADMIN los ve); registro SIS: lo informa el profesional, verifica ADMIN (manual) o la API/job (automatico), publico solo verificado
DO $$ DECLARE r uuid := gen_random_uuid(); n int; BEGIN
  -- Recordatorios (A): el autor crea, marca hecho y borra; nadie mas lo ve ni lo toca.
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO recordatorios_personales (id, autor_id, texto) VALUES (r, test.u('b1'), test.cif('llamar al colegio'));
  BEGIN
    INSERT INTO recordatorios_personales (id, autor_id, texto) VALUES (gen_random_uuid(), test.u('b2'), test.cif('ajeno'));
    RAISE EXCEPTION 'caso 153: recordatorio a nombre de otro debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE recordatorios_personales SET hecho_en = now() WHERE id = r;
  BEGIN
    UPDATE recordatorios_personales SET texto = test.cif('otro') WHERE id = r;
    RAISE EXCEPTION 'caso 153: editar texto debio fallar (solo hecho_en)';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO recordatorios_personales (id, autor_id, texto) VALUES (gen_random_uuid(), test.u('b1'), convert_to('claro', 'UTF8'));
    RAISE EXCEPTION 'caso 153: texto sin cifrar debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM recordatorios_personales WHERE id = r) = 0, 'caso 153: ADMIN ve un recordatorio ajeno';
  DELETE FROM recordatorios_personales WHERE id = r;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 153: ADMIN borra un recordatorio ajeno';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM recordatorios_personales WHERE id = r) = 0, 'caso 153: otro profesional ve un recordatorio ajeno';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM recordatorios_personales) = 0, 'caso 153: el paciente ve recordatorios';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  DELETE FROM recordatorios_personales WHERE id = r;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'caso 153: el autor borra el suyo';

  -- Registro SIS (A+C): sin escritura directa; el profesional informa el suyo.
  BEGIN
    INSERT INTO registros_sis (profesional_id, numero, estado) VALUES (test.u('b1'), '1', 'VERIFICADO_MANUAL');
    RAISE EXCEPTION 'caso 153: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM informar_registro_sis('153153');
  ASSERT (SELECT estado FROM registros_sis WHERE profesional_id = test.u('b1')) = 'PENDIENTE', 'caso 153: informado queda PENDIENTE';
  BEGIN
    PERFORM registrar_verificacion_sis(test.u('b1'), '153153', 'VERIFICADO_MANUAL', 'MANUAL', 'Psicólogo', 'U');
    RAISE EXCEPTION 'caso 153: el profesional verifica a mano debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM registrar_verificacion_sis(test.u('b2'), '1', 'VERIFICADO_AUTOMATICO', 'AUTOMATICO', 'Psicólogo', 'U');
    RAISE EXCEPTION 'caso 153: verificar el registro de otro debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM datos_verificacion_sis(NULL);
    RAISE EXCEPTION 'caso 153: listar todos con usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM registros_sis_publicos() WHERE profesional_id = test.u('b1')) = 0, 'caso 153: pendiente no es publico';
  PERFORM registrar_verificacion_sis(test.u('b1'), '153153', 'VERIFICADO_AUTOMATICO', 'AUTOMATICO', 'Psicólogo', 'U. de Chile');
  BEGIN
    PERFORM registrar_verificacion_sis(test.u('b1'), '999', 'NO_COINCIDE', 'AUTOMATICO', NULL, NULL);
    RAISE EXCEPTION 'caso 153: numero cambiado debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT estado FROM registros_sis WHERE profesional_id = test.u('b1')) = 'VERIFICADO_AUTOMATICO', 'caso 153: GESTION lo ve';
  BEGIN
    PERFORM registrar_verificacion_sis(test.u('b1'), '153153', 'VERIFICADO_MANUAL', 'MANUAL', 'Psicólogo', 'U');
    RAISE EXCEPTION 'caso 153: GESTION verifica debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM registrar_verificacion_sis(test.u('b1'), '153153', 'VERIFICADO_MANUAL', 'MANUAL', 'Psicólogo', 'U. de Chile');
  ASSERT (SELECT verificado_por_id = test.u('a1') AND metodo = 'MANUAL' FROM registros_sis WHERE profesional_id = test.u('b1')),
    'caso 153: manual queda con quien verifico';
  ASSERT (SELECT count(*) FROM datos_verificacion_sis(test.u('b1'))) = 1, 'caso 153: ADMIN lee los datos para verificar uno';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT (SELECT count(*) FROM registros_sis) = 0, 'caso 153: el paciente ve la tabla';
  -- Job (sin contexto): lista todos menos los verificados por el centro.
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT (SELECT count(*) FROM datos_verificacion_sis(NULL) WHERE profesional_id = test.u('b1')) = 0, 'caso 153: el job no toca lo manual';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'registros_sis_publicos') = '{profesional_id,numero,estado,verificado_en}',
    'caso 153: columnas publicas';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'datos_verificacion_sis') = '{p_profesional,profesional_id,numero,nombre,especialidad,rut}',
    'caso 153: columnas para verificar';
  -- Limpieza: el profesional quita su registro.
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM informar_registro_sis(NULL);
  ASSERT NOT EXISTS (SELECT 1 FROM registros_sis WHERE profesional_id = test.u('b1')), 'caso 153: quitado';
END $$;

\echo 154 Revocar acceso temporal: ADMIN o el tratante, el receptor pierde la ficha al instante, una sola vez, append-only, aviso y auditoria; preferencias del equipo solo propias
DO $$ DECLARE v uuid; v_trat uuid; n int; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  v_trat := (SELECT profesional_id FROM pacientes WHERE id = test.u('0a'));
  v := otorgar_acceso_temporal(test.u('0a'), test.u('b5'), 'INTERCONSULTA', 'LECTURA', NULL, now() + interval '1 day');
  PERFORM test.ctx('b5', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM pacientes WHERE id = test.u('0a')) = 1, 'caso 154: con acceso ve al paciente';
  BEGIN
    PERFORM revocar_acceso_temporal(v, 'ERROR');
    RAISE EXCEPTION 'caso 154: el receptor no revoca';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN
    INSERT INTO revocaciones_acceso_temporal (acceso_id, motivo, revocado_por_id) VALUES (v, 'ERROR', test.u('b5'));
    RAISE EXCEPTION 'caso 154: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM revocar_acceso_temporal(v, 'ERROR');
    RAISE EXCEPTION 'caso 154: GESTION no revoca';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM revocar_acceso_temporal(v, 'TERMINO_ANTICIPADO');
  BEGIN
    PERFORM revocar_acceso_temporal(v, 'ERROR');
    RAISE EXCEPTION 'caso 154: se revoca una sola vez';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  ASSERT (SELECT count(*) FROM notificaciones WHERE tipo = 'ACCESO_CLINICO_REVOCADO' AND referencia_id = v AND canal = 'BANDEJA') = 2,
    'caso 154: aviso al paciente y al profesional';
  ASSERT (SELECT count(*) FROM accesos_ficha WHERE paciente_id = test.u('0a') AND accion = 'ACCESO_TEMPORAL' AND detalle = 'revocado') = 1, 'caso 154: auditado';
  PERFORM test.ctx('b5', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM pacientes WHERE id = test.u('0a')) = 0, 'caso 154: revocado no ve al paciente';
  ASSERT (SELECT count(*) FROM revocaciones_acceso_temporal WHERE acceso_id = v) = 1, 'caso 154: el receptor ve la revocacion';
  BEGIN
    DELETE FROM revocaciones_acceso_temporal WHERE acceso_id = v;
    RAISE EXCEPTION 'caso 154: DELETE debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Preferencias del equipo: solo las propias, sin borrar.
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO preferencias_aviso_equipo (usuario_id, mensajes) VALUES (test.u('b1'), false);
  BEGIN
    INSERT INTO preferencias_aviso_equipo (usuario_id) VALUES (test.u('b2'));
    RAISE EXCEPTION 'caso 154: preferencia de otro debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM preferencias_aviso_equipo;
    RAISE EXCEPTION 'caso 154: DELETE de preferencias debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM preferencias_aviso_equipo) = 0, 'caso 154: ADMIN no ve preferencias ajenas';
END $$;
\connect :owner_url
\set ON_ERROR_STOP 1

\echo 155 Revocar con sesiones por cubrir: 422 hasta resolverlas y la cita ya no se mueve a ese profesional; correo del equipo por grupo
DO $$ DECLARE v uuid; v_cita uuid; v_otra uuid; v_trat uuid; r uuid := gen_random_uuid(); BEGIN
  -- Bloque de dos dias (dato de prueba como dueño): no cabe en el horario de un dia.
  ALTER TABLE bloques_atencion DISABLE TRIGGER bloques_atencion_validos;
  INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin)
  VALUES (test.u('b5'), test.box_de(test.u('b5')), test.dia(46, 0), test.dia(48, 0));
  ALTER TABLE bloques_atencion ENABLE TRIGGER bloques_atencion_validos;
  -- 2026-11-18: el horario presencial de b5 (L-V 09-13) tambien decide; esos dias, todo el dia (se retira al final).
  INSERT INTO disponibilidad_profesional (profesional_id, dia_semana, inicio_min, fin_min, modalidad)
  SELECT test.u('b5'), extract(isodow FROM test.dia(d, 12))::int, 0, 1440, 'PRESENCIAL' FROM generate_series(46, 47) d;
  PERFORM test.ctx('a1', 'ADMIN');
  v_trat := (SELECT profesional_id FROM pacientes WHERE id = test.u('0a'));
  v := otorgar_acceso_temporal(test.u('0a'), test.u('b5'), 'REEMPLAZO', 'LECTURA_ESCRITURA', NULL, now() + interval '60 days');
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e2'), v_trat, test.u('0a'), test.dia(46, 10), test.dia(46, 11)) RETURNING id INTO v_cita;
  INSERT INTO citas (espacio_id, profesional_id, paciente_id, inicio, fin)
  VALUES (test.u('e2'), v_trat, test.u('0a'), test.dia(47, 10), test.dia(47, 11)) RETURNING id INTO v_otra;
  UPDATE citas SET profesional_id = test.u('b5') WHERE id = v_cita;
  BEGIN
    PERFORM revocar_acceso_temporal(v, 'ERROR');
    RAISE EXCEPTION 'caso 155: con sesiones por cubrir debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE citas SET estado = 'CANCELADA' WHERE id = v_cita;
  PERFORM revocar_acceso_temporal(v, 'ERROR');
  BEGIN
    UPDATE citas SET profesional_id = test.u('b5') WHERE id = v_otra;
    RAISE EXCEPTION 'caso 155: acceso revocado no cubre sesiones';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE citas SET estado = 'CANCELADA' WHERE id = v_otra;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  DELETE FROM disponibilidad_profesional WHERE profesional_id = test.u('b5') AND inicio_min = 0 AND fin_min = 1440;

  -- Correo por grupo: apagado no llega, la bandeja si; lo que no tiene grupo llega siempre.
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM encolar_notificacion('MENSAJE_INTERNO', NULL, test.u('b1'), r, NULL);
  ASSERT (SELECT count(*) FROM notificaciones WHERE referencia_id = r AND canal = 'BANDEJA') = 1, 'caso 155: la bandeja registra siempre';
  ASSERT (SELECT count(*) FROM notificaciones WHERE referencia_id = r AND canal = 'CORREO') = 0, 'caso 155: mensajes apagado sin correo';
  PERFORM encolar_notificacion('CIERRE_REQUERIDO', NULL, test.u('b1'), r, NULL);
  ASSERT (SELECT count(*) FROM notificaciones WHERE referencia_id = r AND canal = 'CORREO') = 1, 'caso 155: sin grupo llega siempre';
  PERFORM encolar_notificacion('MENSAJE_INTERNO', NULL, test.u('b2'), r, NULL);
  ASSERT (SELECT count(*) FROM notificaciones WHERE referencia_id = r AND canal = 'CORREO') = 2, 'caso 155: sin fila llega todo';
END $$;

\echo 156 Modulo WHATSAPP (2026-11-03, dueño con contexto): desactivado por defecto; sin el modulo el paciente no da el consentimiento nuevo (23514); uno ya dado se conserva y se puede retirar
DO $$ DECLARE v_conf configuracion_centro; v_p uuid := gen_random_uuid(); BEGIN
  SELECT * INTO v_conf FROM configuracion_centro;
  ASSERT NOT 'WHATSAPP' = ANY (v_conf.modulos_activos), 'caso 156: desactivado por defecto';
  ASSERT NOT whatsapp_contratado(), 'caso 156: whatsapp_contratado() sin el modulo';
  INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES (v_p, 'P156', 'W', '1990-01-01', test.u('b1'));
  BEGIN
    INSERT INTO preferencias_notificacion (paciente_id, whatsapp) VALUES (v_p, true);
    RAISE EXCEPTION 'caso 156: consentir sin el modulo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO preferencias_notificacion (paciente_id, recordatorios) VALUES (v_p, false);
  BEGIN
    UPDATE preferencias_notificacion SET whatsapp = true WHERE paciente_id = v_p;
    RAISE EXCEPTION 'caso 156: activar sin el modulo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE configuracion_centro SET modulos_activos = modulos_activos || 'WHATSAPP'::modulo_centro;
  ASSERT whatsapp_contratado(), 'caso 156: con el modulo';
  UPDATE preferencias_notificacion SET whatsapp = true WHERE paciente_id = v_p;
  UPDATE configuracion_centro SET modulos_activos = v_conf.modulos_activos;
  -- Ya dado: se conserva al editar otra preferencia y se puede retirar.
  UPDATE preferencias_notificacion SET recordatorios = true WHERE paciente_id = v_p;
  ASSERT (SELECT whatsapp AND whatsapp_consentido_en IS NOT NULL FROM preferencias_notificacion WHERE paciente_id = v_p), 'caso 156: se conserva';
  UPDATE preferencias_notificacion SET whatsapp = false WHERE paciente_id = v_p;
  ASSERT (SELECT NOT whatsapp FROM preferencias_notificacion WHERE paciente_id = v_p), 'caso 156: se retira';
END $$;

\connect :app_url
\echo 157 Horario cerrado (2026-11-05): sin dias el centro esta cerrado (no se aparta box ni hay horas libres)
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  DELETE FROM horario_centro;
  ASSERT NOT en_horario_centro(test.lunes(30, 10), test.lunes(30, 11)), 'caso 157: sin dias = cerrado';
  ASSERT NOT EXISTS (SELECT 1 FROM disponibilidad_espacios(test.lunes(30, 0), test.lunes(31, 0))), 'caso 157: sin horas libres de box';
  PERFORM test.ctx('b5', 'PROFESIONAL');
  BEGIN
    INSERT INTO bloques_atencion (profesional_id, espacio_id, inicio, fin, creado_por_id)
    VALUES (test.u('b5'), test.u('e2'), test.lunes(30, 10), test.lunes(30, 11), test.u('b5'));
    RAISE EXCEPTION 'caso 157: apartar box con el centro cerrado debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) SELECT d, 0, 1440 FROM generate_series(1, 7) d;
  ASSERT en_horario_centro(test.lunes(30, 10), test.lunes(30, 11)), 'caso 157: abierto otra vez';
END $$;
\connect :owner_url

\echo 158 Pendientes de las fichas (2026-11-06): ADMIN/GESTION ven los de todos (solo metadata y codigo seudonimo); el profesional solo los suyos; PACIENTE no; las sesiones sin evolucion cuadran con estado_fichas_profesional
\connect :app_url
DO $$ DECLARE v_total int; v_estado int; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM pendientes_fichas() WHERE profesional_id <> test.u('b1')), 'caso 158: el profesional ve solo lo suyo';
  BEGIN
    PERFORM pendientes_fichas(test.u('b2'));
    RAISE EXCEPTION 'caso 158: pendientes de otro profesional';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO v_total FROM pendientes_fichas() WHERE tipo = 'SIN_EVOLUCION';
  SELECT coalesce(sum(sesiones_sin_cerrar), 0) INTO v_estado FROM estado_fichas_profesional(test.u('b1'));
  ASSERT v_total >= v_estado, 'caso 158: toda sesion sin cerrar de sus pacientes aparece como pendiente';
  ASSERT NOT EXISTS (SELECT 1 FROM pendientes_fichas() WHERE tipo = 'SIN_EVOLUCION' AND (vence IS NULL OR vence <= fecha)),
    'caso 158: la sesion sin evolucion trae su plazo';
  PERFORM test.ctx('a2', 'PACIENTE');
  BEGIN
    PERFORM pendientes_fichas();
    RAISE EXCEPTION 'caso 158: PACIENTE no ve pendientes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(DISTINCT profesional_id) FROM pendientes_fichas()) >= (SELECT count(DISTINCT profesional_id) FROM pendientes_fichas(test.u('b1'))),
    'caso 158: GESTION ve todos o uno';
  ASSERT NOT EXISTS (SELECT 1 FROM pendientes_fichas() WHERE codigo IS NULL), 'caso 158: siempre con codigo seudonimo';
END $$;
\connect :owner_url

\echo 159 Respaldo de titulos (2026-11-07): solo el propio sube (version nueva, el titulo vuelve a revision); leen el propio y ADMIN/GESTION; sin escritura directa; verificar exige respaldo; eliminar el titulo se lleva sus respaldos
\connect :app_url
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO profesional_trayectoria (id, profesional_id, tipo, titulo, institucion, anio)
  VALUES (test.u('e5'), test.u('b1'), 'MAGISTER', 'T Magister 159', 'U. de Prueba', 2019);
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    UPDATE profesional_trayectoria SET verificado = true WHERE id = test.u('e5');
    RAISE EXCEPTION 'caso 159: verificar sin respaldo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM subir_respaldo_trayectoria(test.u('e6'), test.u('e5'), 'x.pdf', 'application/pdf', 10, test.cif('pdf'));
    RAISE EXCEPTION 'caso 159: ADMIN no sube respaldos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b3', 'PROFESIONAL');
  BEGIN
    PERFORM subir_respaldo_trayectoria(test.u('e6'), test.u('e5'), 'x.pdf', 'application/pdf', 10, test.cif('pdf'));
    RAISE EXCEPTION 'caso 159: respaldo en titulo ajeno debio fallar';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    INSERT INTO trayectoria_respaldos (id, trayectoria_id, profesional_id, nombre_archivo, tipo_mime, tamano_bytes, contenido)
    VALUES (test.u('e8'), test.u('e5'), test.u('b1'), 'x.pdf', 'application/pdf', 10, test.cif('pdf'));
    RAISE EXCEPTION 'caso 159: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM subir_respaldo_trayectoria(test.u('e6'), test.u('e5'), 'x.exe', 'application/x-msdownload', 10, test.cif('exe'));
    RAISE EXCEPTION 'caso 159: tipo no permitido debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM subir_respaldo_trayectoria(test.u('e6'), test.u('e5'), 'magister.pdf', 'application/pdf', 10, test.cif('pdf v1'));
  ASSERT (SELECT count(*) FROM trayectoria_respaldos WHERE trayectoria_id = test.u('e5')) = 1, 'caso 159: el propio ve su respaldo';
  PERFORM test.ctx('b3', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM trayectoria_respaldos WHERE trayectoria_id = test.u('e5')), 'caso 159: otro profesional no lo ve';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT NOT EXISTS (SELECT 1 FROM trayectoria_respaldos), 'caso 159: PACIENTE no ve respaldos';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM trayectoria_respaldos WHERE trayectoria_id = test.u('e5')) = 1, 'caso 159: GESTION lee';
  BEGIN
    DELETE FROM trayectoria_respaldos WHERE trayectoria_id = test.u('e5');
    RAISE EXCEPTION 'caso 159: DELETE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE profesional_trayectoria SET verificado = true WHERE id = test.u('e5');
  ASSERT (SELECT verificado FROM profesional_trayectoria WHERE id = test.u('e5')), 'caso 159: con respaldo se verifica';
  BEGIN
    UPDATE trayectoria_respaldos SET nombre_archivo = 'otro.pdf' WHERE trayectoria_id = test.u('e5');
    RAISE EXCEPTION 'caso 159: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM subir_respaldo_trayectoria(test.u('e9'), test.u('e5'), 'magister-v2.pdf', 'application/pdf', 12, test.cif('pdf v2'));
  ASSERT (SELECT count(*) FROM trayectoria_respaldos WHERE trayectoria_id = test.u('e5')) = 2, 'caso 159: version nueva, la anterior se conserva';
  ASSERT NOT (SELECT verificado FROM profesional_trayectoria WHERE id = test.u('e5')), 'caso 159: archivo nuevo vuelve a revision';
  DELETE FROM profesional_trayectoria WHERE id = test.u('e5');
  ASSERT NOT EXISTS (SELECT 1 FROM trayectoria_respaldos WHERE trayectoria_id = test.u('e5')), 'caso 159: eliminar el titulo se lleva sus respaldos';
END $$;
\connect :owner_url

\echo 160 Sesion unica y conexiones (2026-11-07): un login nuevo cierra la sesion anterior (NUEVA_SESION); sesion_vigente por request; mis_conexiones solo propias; motivo del cierre
\connect :app_url
DO $$ DECLARE v_f1 uuid; v_f2 uuid; r record; BEGIN
  BEGIN
    PERFORM 1 FROM sesiones;
    RAISE EXCEPTION 'caso 160: sesiones sigue sin GRANT';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  v_f1 := crear_sesion(test.u('b1'), 'PROFESIONAL', sha256('t160a'), now() + interval '1 day', 'Chrome en Windows');
  v_f2 := crear_sesion(test.u('b1'), 'PROFESIONAL', sha256('t160b'), now() + interval '1 day', 'Firefox en macOS');
  ASSERT motivo_fin_sesion(sha256('t160a')) = 'NUEVA_SESION', 'caso 160: el login nuevo cierra la sesion anterior';
  ASSERT motivo_fin_sesion(sha256('t160b')) IS NULL, 'caso 160: la nueva sigue abierta';
  ASSERT NOT EXISTS (SELECT 1 FROM rotar_sesion(sha256('t160a'), sha256('t160c'), now() + interval '1 day')),
    'caso 160: la sesion anterior ya no renueva';
  SELECT * INTO r FROM rotar_sesion(sha256('t160b'), sha256('t160d'), now() + interval '1 day');
  ASSERT r.usuario_id = test.u('b1') AND r.familia_id = v_f2, 'caso 160: la rotacion conserva la familia';
  BEGIN
    PERFORM mis_conexiones();
    RAISE EXCEPTION 'caso 160: sin contexto no hay conexiones';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT sesion_vigente(v_f2) AND NOT sesion_vigente(v_f1), 'caso 160: solo la sesion nueva sirve por request';
  SELECT * INTO r FROM mis_conexiones() WHERE familia_id = v_f2;
  ASSERT r.activa AND r.fin IS NULL AND r.motivo IS NULL AND r.dispositivo = 'Firefox en macOS' AND r.rol = 'PROFESIONAL',
    format('caso 160: conexion activa %s', row_to_json(r));
  SELECT * INTO r FROM mis_conexiones() WHERE familia_id = v_f1;
  ASSERT NOT r.activa AND r.motivo = 'NUEVA_SESION' AND r.fin IS NOT NULL AND r.dispositivo = 'Chrome en Windows',
    format('caso 160: conexion cerrada %s', row_to_json(r));
  ASSERT (SELECT count(*) FROM mis_conexiones() WHERE activa) = 1, 'caso 160: una sola conexion activa';
  ASSERT (SELECT count(*) FROM mis_conexiones(1)) = 1, 'caso 160: limite';
  PERFORM test.ctx('b3', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM mis_conexiones() WHERE familia_id IN (v_f1, v_f2)), 'caso 160: no ve conexiones ajenas';
  ASSERT NOT sesion_vigente(v_f2), 'caso 160: la familia de otro usuario no sirve';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM revocar_sesion(sha256('t160d'));
  ASSERT motivo_fin_sesion(sha256('t160d')) = 'LOGOUT', 'caso 160: cerrar sesion';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT NOT sesion_vigente(v_f2), 'caso 160: tras cerrar sesion el access token deja de servir';
END $$;
\connect :owner_url

\echo 161 Equipo v1 (2026-11-08): el sitio publico solo con profesionales validados; ADMIN observa un titulo (vuelve a revision; la limpia un respaldo nuevo o verificar); documentos del practicante (propio o ADMIN, versionados, no habilitan); correcciones del perfil (ADMIN corrige a la segunda solicitud sin cambios)
\connect :app_url
DO $$ DECLARE r record; BEGIN
  -- Validacion: b1 tiene titulo verificado pero ya no registro SIS (caso 153 lo quito).
  ASSERT NOT profesional_validado(test.u('b1')), 'caso 161: sin registro SIS no esta validado';
  ASSERT NOT EXISTS (SELECT 1 FROM perfiles_publicos() WHERE id = test.u('b1')), 'caso 161: sin validar no sale en el sitio';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM informar_registro_sis('161161');
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM registrar_verificacion_sis(test.u('b1'), '161161', 'VERIFICADO_MANUAL', 'MANUAL', 'Psicólogo', 'U. de Prueba');
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT EXISTS (SELECT 1 FROM perfiles_publicos() WHERE id = test.u('b1')), 'caso 161: validado sale en el sitio';
  ASSERT EXISTS (SELECT 1 FROM registros_sis_publicos() WHERE profesional_id = test.u('b1')), 'caso 161: registro publico del validado';

  -- Observacion de un titulo.
  PERFORM test.ctx('b1', 'PROFESIONAL');
  INSERT INTO profesional_trayectoria (id, profesional_id, tipo, titulo, institucion, anio)
  VALUES (test.u('e3'), test.u('b1'), 'DIPLOMADO', 'T Diplomado 161', 'U. de Prueba', 2020);
  PERFORM subir_respaldo_trayectoria(test.u('e4'), test.u('e3'), 'diplomado.pdf', 'application/pdf', 10, test.cif('pdf 161'));
  PERFORM test.ctx('a1', 'ADMIN');
  UPDATE profesional_trayectoria SET verificado = true WHERE id = test.u('e3');
  BEGIN
    UPDATE profesional_trayectoria SET observacion = 'directo' WHERE id = test.u('e3');
    RAISE EXCEPTION 'caso 161: observar por UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM observar_trayectoria(test.u('e3'), '   ');
    RAISE EXCEPTION 'caso 161: observacion vacia debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM observar_trayectoria(test.u('ee'), 'No existe');
    RAISE EXCEPTION 'caso 161: titulo inexistente debio fallar';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM observar_trayectoria(test.u('e3'), 'El respaldo esta ilegible');
  SELECT * INTO r FROM profesional_trayectoria WHERE id = test.u('e3');
  ASSERT NOT r.verificado AND r.observacion = 'El respaldo esta ilegible' AND r.observada_por_id = test.u('a1') AND r.observada_en IS NOT NULL,
    'caso 161: observar deja el titulo en revision con la observacion';
  FOR r IN SELECT * FROM (VALUES ('a3', 'GESTION'), ('b1', 'PROFESIONAL')) v(u, rol) LOOP
    PERFORM test.ctx(r.u, r.rol);
    BEGIN
      PERFORM observar_trayectoria(test.u('e3'), 'Otra');
      RAISE EXCEPTION 'caso 161: % observa debio fallar', r.rol;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  UPDATE profesional_trayectoria SET observacion = NULL, anio = 2021 WHERE id = test.u('e3');
  ASSERT (SELECT observacion FROM profesional_trayectoria WHERE id = test.u('e3')) = 'El respaldo esta ilegible',
    'caso 161: el propio no borra la observacion';
  PERFORM subir_respaldo_trayectoria(test.u('eb'), test.u('e3'), 'diplomado-v2.pdf', 'application/pdf', 10, test.cif('pdf 161 v2'));
  ASSERT (SELECT observacion IS NULL AND observada_en IS NULL FROM profesional_trayectoria WHERE id = test.u('e3')),
    'caso 161: un respaldo nuevo limpia la observacion';
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM observar_trayectoria(test.u('e3'), 'Falta la fecha');
  UPDATE profesional_trayectoria SET verificado = true WHERE id = test.u('e3');
  ASSERT (SELECT verificado AND observacion IS NULL FROM profesional_trayectoria WHERE id = test.u('e3')),
    'caso 161: verificar limpia la observacion';

  -- Documentos del practicante.
  PERFORM test.ctx('c1', 'PRACTICANTE');
  PERFORM subir_documento_practicante(test.u('f6'), test.u('c1'), 'CERTIFICADO_ALUMNO_REGULAR', 'certificado.pdf', 'application/pdf', 10,
                                      test.cif('certificado 161'), '2027-03-31');
  BEGIN
    PERFORM subir_documento_practicante(test.u('f7'), test.u('c3'), 'CERTIFICADO_ALUMNO_REGULAR', 'x.pdf', 'application/pdf', 10, test.cif('x'), NULL);
    RAISE EXCEPTION 'caso 161: documento de otro practicante debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO practicante_documentos (id, practicante_id, tipo, nombre_archivo, tipo_mime, tamano_bytes, contenido, subido_por_id)
    VALUES (test.u('f7'), test.u('c1'), 'CONVENIO_PRACTICA', 'x.pdf', 'application/pdf', 10, test.cif('x'), test.u('c1'));
    RAISE EXCEPTION 'caso 161: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM subir_documento_practicante(test.u('f7'), test.u('c1'), 'CONVENIO_PRACTICA', 'x.exe', 'application/x-msdownload', 10, test.cif('x'), NULL);
    RAISE EXCEPTION 'caso 161: tipo no permitido debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  FOR r IN SELECT * FROM (VALUES ('a3', 'GESTION'), ('b1', 'PROFESIONAL')) v(u, rol) LOOP
    PERFORM test.ctx(r.u, r.rol);
    BEGIN
      PERFORM subir_documento_practicante(test.u('f7'), test.u('c1'), 'CONVENIO_PRACTICA', 'x.pdf', 'application/pdf', 10, test.cif('x'), NULL);
      RAISE EXCEPTION 'caso 161: % sube documentos de practicante debio fallar', r.rol;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM subir_documento_practicante(test.u('f7'), test.u('c1'), 'CONVENIO_PRACTICA', 'convenio.pdf', 'application/pdf', 10, test.cif('convenio 161'), NULL);
  BEGIN
    PERFORM subir_documento_practicante(test.u('f8'), test.u('b1'), 'CONVENIO_PRACTICA', 'x.pdf', 'application/pdf', 10, test.cif('x'), NULL);
    RAISE EXCEPTION 'caso 161: documento de quien no es practicante debio fallar';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  ASSERT (SELECT subido_por_id FROM practicante_documentos WHERE id = test.u('f7')) = test.u('a1'), 'caso 161: queda quien subio';
  PERFORM test.ctx('c1', 'PRACTICANTE');
  ASSERT (SELECT count(*) FROM practicante_documentos) = 2, 'caso 161: el practicante ve los suyos';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT (SELECT count(*) FROM practicante_documentos WHERE practicante_id = test.u('c1')) = 2, 'caso 161: GESTION lee';
  BEGIN
    DELETE FROM practicante_documentos;
    RAISE EXCEPTION 'caso 161: DELETE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM practicante_documentos), 'caso 161: un profesional no ve documentos de practicantes';
  PERFORM test.ctx('a2', 'PACIENTE');
  ASSERT NOT EXISTS (SELECT 1 FROM practicante_documentos), 'caso 161: PACIENTE no ve documentos';

  -- Correcciones del perfil publico.
  FOR r IN SELECT * FROM (VALUES ('a1', 'ADMIN'), ('a3', 'GESTION')) v(u, rol) LOOP
    PERFORM test.ctx(r.u, r.rol);
    BEGIN
      UPDATE profesionales SET bio = 'Editada' WHERE usuario_id = test.u('b1');
      RAISE EXCEPTION 'caso 161: % edita el texto publico ajeno debio fallar', r.rol;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM pedir_correccion_perfil(test.u('b1'), ARRAY['bio'], 'Tiene un telefono');
    RAISE EXCEPTION 'caso 161: GESTION pide correccion debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM pedir_correccion_perfil(test.u('b1'), ARRAY['telefono'], 'Campo que no existe');
    RAISE EXCEPTION 'caso 161: campo desconocido debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT (SELECT solicitudes FROM pedir_correccion_perfil(test.u('b1'), ARRAY['bio'], 'Tiene un telefono')) = 1, 'caso 161: primera solicitud';
  BEGIN
    PERFORM corregir_campo_perfil(test.u('b1'), 'bio', 'Corregida', 'Quitamos el telefono');
    RAISE EXCEPTION 'caso 161: corregir a la primera solicitud debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT (SELECT solicitudes FROM pedir_correccion_perfil(test.u('b1'), ARRAY['bio'], 'Sigue el telefono')) = 2, 'caso 161: segunda sin cambios';
  BEGIN
    PERFORM corregir_campo_perfil(test.u('b1'), 'foto_url', '/x.jpg', 'Foto');
    RAISE EXCEPTION 'caso 161: la foto no la corrige la cuenta madre';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM corregir_campo_perfil(test.u('b1'), 'bio', 'Corregida por el centro', 'Quitamos el telefono');
  ASSERT (SELECT bio FROM profesionales WHERE usuario_id = test.u('b1')) = 'Corregida por el centro', 'caso 161: ADMIN corrige a la segunda';
  BEGIN
    PERFORM corregir_campo_perfil(test.u('b1'), 'bio', 'Otra vez', 'x de nuevo');
    RAISE EXCEPTION 'caso 161: tras corregir, la cuenta vuelve a cero';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Si el profesional cambia el campo entre solicitudes, la cuenta parte de nuevo.
  PERFORM pedir_correccion_perfil(test.u('b1'), ARRAY['cita_destacada'], 'Frase con errores');
  PERFORM test.ctx('b1', 'PROFESIONAL');
  UPDATE profesionales SET cita_destacada = 'Frase revisada' WHERE usuario_id = test.u('b1');
  ASSERT (SELECT count(*) FROM correcciones_perfil) = 4, 'caso 161: el profesional ve las suyas';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT solicitudes FROM pedir_correccion_perfil(test.u('b1'), ARRAY['cita_destacada'], 'Todavia con errores')) = 1,
    'caso 161: cambio entre solicitudes reinicia la cuenta';
  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT NOT EXISTS (SELECT 1 FROM correcciones_perfil), 'caso 161: otro profesional no ve correcciones ajenas';
  BEGIN
    INSERT INTO correcciones_perfil (profesional_id, campo, accion, motivo, huella, autor_id)
    VALUES (test.u('b2'), 'bio', 'PEDIDA', 'directo', 'x', test.u('b2'));
    RAISE EXCEPTION 'caso 161: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
\connect :owner_url

\echo 162 Exportacion del centro como job (AUD-02): solo ADMIN la pide con llave publica y la ve; una pedida sin terminar a la vez (55000); sin INSERT/UPDATE directo; lectura por lotes sin llaves ni contraseñas; programada en la ventana nocturna o ya si es urgente; el job la toma a su hora, reintenta hasta 3 veces y retoma las interrumpidas; terminar registra y descargar es de una vez
\connect :app_url
DO $$ DECLARE r record; v_id uuid; v_id2 uuid; v_pos tid; v_n int; v_pub bytea := decode(repeat('ab', 32), 'hex'); v_sal bytea := decode(repeat('cd', 16), 'hex'); BEGIN
  FOR r IN SELECT * FROM (VALUES ('a3', 'GESTION'), ('b1', 'PROFESIONAL')) v(u, rol) LOOP
    PERFORM test.ctx(r.u, r.rol);
    BEGIN
      PERFORM iniciar_exportacion_centro(v_pub, v_sal, true);
      RAISE EXCEPTION 'caso 162: % pide debio fallar', r.rol;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM * FROM exportar_tabla_centro_lote('pacientes', NULL, 10);
      RAISE EXCEPTION 'caso 162: % lee lotes debio fallar', r.rol;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM iniciar_exportacion_centro(decode('00', 'hex'), v_sal, true);
    RAISE EXCEPTION 'caso 162: llave publica de otro largo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Sin urgencia: ventana nocturna (dentro de 24 h).
  v_id := iniciar_exportacion_centro(v_pub, v_sal, false);
  ASSERT (SELECT estado = 'PENDIENTE' AND NOT urgente AND programada_para > now() AND programada_para <= now() + interval '24 hours'
          FROM exportaciones_centro WHERE id = v_id), 'caso 162: programada en la ventana';
  BEGIN
    PERFORM iniciar_exportacion_centro(v_pub, v_sal, true);
    RAISE EXCEPTION 'caso 162: segunda pedida debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    INSERT INTO exportaciones_centro (solicitada_por_id, tablas_total, clave_publica, sal) VALUES (test.u('a1'), 1, v_pub, v_sal);
    RAISE EXCEPTION 'caso 162: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE exportaciones_centro SET programada_para = now() WHERE id = v_id;
    RAISE EXCEPTION 'caso 162: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT EXISTS (SELECT 1 FROM exportaciones_centro WHERE id = v_id), 'caso 162: ADMIN la ve';
  PERFORM test.ctx('a3', 'GESTION');
  ASSERT NOT EXISTS (SELECT 1 FROM exportaciones_centro), 'caso 162: GESTION no ve exportaciones';
  BEGIN
    PERFORM * FROM tomar_exportacion_centro();
    RAISE EXCEPTION 'caso 162: tomar con contexto debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- El job no la toma antes de su hora.
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  ASSERT NOT EXISTS (SELECT 1 FROM tomar_exportacion_centro()), 'caso 162: antes de su hora no se toma';

  -- Lectura por lotes (cursor por ctid), sin llaves ni contraseñas.
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM * FROM exportar_tabla_centro_lote('llaves_datos', NULL, 10);
    RAISE EXCEPTION 'caso 162: exportar llaves debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT NOT EXISTS (SELECT 1 FROM exportar_tabla_centro_lote('usuarios', NULL, 1000) l WHERE l.fila ? 'password_hash' OR l.fila ? 'totp_secreto'),
    'caso 162: sin contraseñas ni secretos';
  SELECT pos INTO v_pos FROM exportar_tabla_centro_lote('pacientes', NULL, 1);
  SELECT count(*) INTO v_n FROM exportar_tabla_centro_lote('pacientes', v_pos, 1000);
  ASSERT v_n = (SELECT count(*) FROM exportar_tabla_centro_lote('pacientes', NULL, 1000)) - 1, 'caso 162: el siguiente lote sigue despues del cursor';
  ASSERT (SELECT exportar_ficha_centro(p) ? 'evoluciones' FROM pacientes_con_ficha_exportacion() p LIMIT 1), 'caso 162: ficha para el PDF';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\connect :owner_url
-- La hora de la programada llega (el dueño la adelanta: simula el paso del tiempo).
UPDATE exportaciones_centro SET programada_para = now() - interval '1 second' WHERE estado = 'PENDIENTE';
\connect :app_url
DO $$ DECLARE t record; v_id2 uuid; v_pub bytea := decode(repeat('ab', 32), 'hex'); v_sal bytea := decode(repeat('cd', 16), 'hex'); BEGIN
  -- El job la toma (una a la vez) con su llave publica; el total de tablas se recalcula.
  SELECT * INTO t FROM tomar_exportacion_centro();
  ASSERT t.id IS NOT NULL AND t.intentos = 1 AND t.clave_publica = v_pub AND t.sal = v_sal, 'caso 162: tomada con su llave publica';
  ASSERT NOT EXISTS (SELECT 1 FROM tomar_exportacion_centro()), 'caso 162: una a la vez';
  -- Un fallo la devuelve a PENDIENTE (reintento), hasta el tercero.
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT fallar_exportacion_centro(t.id, 'error de prueba') = 'PENDIENTE', 'caso 162: primer fallo reintenta';
  ASSERT (SELECT programada_para > now() FROM exportaciones_centro WHERE id = t.id), 'caso 162: reintento en unos minutos';
  -- Reinicio a mitad: EN_PROCESO vuelve a PENDIENTE (la llave publica sigue en la fila).
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  BEGIN
    PERFORM test.ctx('a1', 'ADMIN');
    PERFORM cerrar_exportaciones_centro(true);
    RAISE EXCEPTION 'caso 162: cerrar con contexto debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\connect :owner_url
UPDATE exportaciones_centro SET programada_para = now() - interval '1 second' WHERE estado = 'PENDIENTE';
\connect :app_url
DO $$ DECLARE t record; BEGIN
  SELECT * INTO t FROM tomar_exportacion_centro();
  ASSERT t.intentos = 2, 'caso 162: segundo intento';
  ASSERT EXISTS (SELECT 1 FROM cerrar_exportaciones_centro(true) c WHERE c = t.id), 'caso 162: interrumpida devuelta (borrar archivo parcial)';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT estado = 'PENDIENTE' FROM exportaciones_centro WHERE id = t.id), 'caso 162: interrumpida vuelve a PENDIENTE';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  SELECT * INTO t FROM tomar_exportacion_centro();
  ASSERT t.intentos = 3, 'caso 162: tercer intento';
  -- Termino, registro y descarga de una vez.
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM avance_exportacion_centro(t.id, 1, 0, 0);
  PERFORM terminar_exportacion_centro(t.id, 1234, repeat('a', 64));
  ASSERT (SELECT estado = 'LISTA' AND vence_en > now() FROM exportaciones_centro WHERE id = t.id), 'caso 162: lista por 24 h';
  ASSERT EXISTS (SELECT 1 FROM registro_exportaciones WHERE referencia_id = t.id AND recurso = 'exportacion_centro'), 'caso 162: registrada';
  PERFORM descargar_exportacion_centro(t.id);
  BEGIN
    PERFORM descargar_exportacion_centro(t.id);
    RAISE EXCEPTION 'caso 162: segunda descarga debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\connect :owner_url
-- Tercer fallo: FALLIDA. Una urgente queda para ya; se toma y falla con 3 intentos.
DO $$ DECLARE v uuid := gen_random_uuid(); BEGIN
  INSERT INTO exportaciones_centro (id, solicitada_por_id, tablas_total, clave_publica, sal, estado, intentos, iniciada_en)
  VALUES (v, test.u('a1'), 1, decode(repeat('ab', 32), 'hex'), decode(repeat('cd', 16), 'hex'), 'EN_PROCESO', 3, now());
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT fallar_exportacion_centro(v, 'error de prueba') = 'FALLIDA', 'caso 162: tercer fallo queda FALLIDA';
  ASSERT (SELECT motivo_fallo = 'error de prueba' FROM exportaciones_centro WHERE id = v), 'caso 162: con su motivo';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;

\echo 163 Ventana nocturna de la exportacion (AUD-02): 1 h antes de la apertura del proximo dia con atencion, al menos 3 h despues del cierre anterior y dentro de 24 h; si no, la proxima 03:00 de Chile
BEGIN;
CREATE TEMP TABLE horario_respaldo AS SELECT * FROM horario_centro;
DELETE FROM horario_centro;
-- Lunes a viernes 08:00 a 21:00; sabado 09:00 a 14:00; domingo cerrado.
INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) SELECT d, 480, 1260 FROM generate_series(1, 5) d;
INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) VALUES (6, 540, 840);
DO $$ BEGIN
  -- Viernes 2026-11-06 23:59: el sabado abre 09:00 -> 08:00.
  ASSERT proxima_ventana_exportacion('2026-11-06 23:59-03') = '2026-11-07 08:00-03', 'caso 163: viernes noche -> sabado 08:00';
  -- Sabado 22:00: el domingo cierra y el lunes 07:00 queda a mas de 24 h -> domingo 03:00.
  ASSERT proxima_ventana_exportacion('2026-11-07 22:00-03') = '2026-11-08 03:00-03', 'caso 163: sabado noche -> domingo 03:00';
  -- Lunes 05:00: el mismo lunes 07:00.
  ASSERT proxima_ventana_exportacion('2026-11-09 05:00-03') = '2026-11-09 07:00-03', 'caso 163: madrugada -> 1 h antes de abrir';
  -- Lunes 10:00 (en atencion): el martes 07:00.
  ASSERT proxima_ventana_exportacion('2026-11-09 10:00-03') = '2026-11-10 07:00-03', 'caso 163: en horario -> mañana 07:00';
END $$;
-- Cierre tarde (23:30) y apertura temprana (01:00 del dia siguiente): 00:00 no deja 3 h -> 03:00.
DELETE FROM horario_centro;
INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) SELECT d, 60, 1410 FROM generate_series(1, 7) d;
DO $$ BEGIN
  ASSERT proxima_ventana_exportacion('2026-11-09 23:45-03') = '2026-11-10 03:00-03', 'caso 163: sin 3 h tras el cierre -> 03:00';
END $$;
-- Sin horario: la proxima 03:00.
DELETE FROM horario_centro;
DO $$ BEGIN
  ASSERT proxima_ventana_exportacion('2026-11-09 10:00-03') = '2026-11-10 03:00-03', 'caso 163: sin horario -> 03:00';
END $$;
ROLLBACK;
\connect :owner_url

\echo 164 MVP sin cobros (2026-11-11): la hora del paciente queda SOLICITADA (ocupa la hora); solo su profesional la aprueba o rechaza; el job vence las solicitudes; la API no fija SOLICITADA
DO $$ DECLARE v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid(); v3 uuid := gen_random_uuid(); BEGIN
  INSERT INTO citas (id, modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en) VALUES
    (v1, 'ONLINE', test.u('b1'), test.u('15'), test.dia(60, 10), test.dia(60, 11), 'SOLICITADA', test.dia(59, 10)),
    (v2, 'ONLINE', test.u('b1'), test.u('15'), test.dia(60, 12), test.dia(60, 13), 'SOLICITADA', test.dia(59, 12)),
    (v3, 'ONLINE', test.u('b1'), test.u('15'), test.dia(60, 14), test.dia(60, 15), 'SOLICITADA', now() + interval '1 hour');
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado)
    VALUES ('ONLINE', test.u('b1'), test.u('15'), test.dia(60, 10), test.dia(60, 11), 'SOLICITADA');
    RAISE EXCEPTION 'caso 164: SOLICITADA exige plazo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado)
    VALUES ('ONLINE', test.u('b1'), test.u('15'), test.dia(60, 10) + interval '30 minutes', test.dia(60, 11), 'CONFIRMADA');
    RAISE EXCEPTION 'caso 164: la hora SOLICITADA esta ocupada';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  INSERT INTO test.ids VALUES ('164a', v1), ('164b', v2), ('164c', v3);
END $$;
\connect :app_url
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado)
    VALUES ('ONLINE', test.u('b1'), test.u('15'), test.dia(61, 10), test.dia(61, 11), 'SOLICITADA');
    RAISE EXCEPTION 'caso 164: la API no inserta SOLICITADA';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE citas SET estado = 'CONFIRMADA' WHERE id = test.id('164a');
    RAISE EXCEPTION 'caso 164: la API no aprueba por UPDATE';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b2', 'PROFESIONAL');
  BEGIN
    PERFORM aprobar_cita(test.id('164a'));
    RAISE EXCEPTION 'caso 164: otro profesional no aprueba';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM rechazar_cita(test.id('164a'));
    RAISE EXCEPTION 'caso 164: ADMIN no aprueba ni rechaza';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT aprobar_cita(test.id('164a')) = 'CONFIRMADA', 'caso 164: aprobada';
  ASSERT (SELECT aprobacion_vence_en IS NULL FROM citas WHERE id = test.id('164a')), 'caso 164: sin plazo al aprobar';
  BEGIN
    PERFORM aprobar_cita(test.id('164a'));
    RAISE EXCEPTION 'caso 164: ya no esta por aprobar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  ASSERT rechazar_cita(test.id('164b')) = 'CANCELADA', 'caso 164: rechazada';
  -- La cancela el paciente o el equipo (la API si puede pasarla a CANCELADA).
  UPDATE citas SET estado = 'CANCELADA', cancelada_en = now() WHERE id = test.id('164c');
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\connect :owner_url
DO $$ DECLARE v uuid := gen_random_uuid(); BEGIN
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE referencia_id = test.id('164b') AND tipo = 'CITA_CANCELADA'), 'caso 164: aviso de rechazada';
  INSERT INTO citas (id, modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en)
  VALUES (v, 'ONLINE', test.u('b1'), test.u('15'), test.dia(62, 10), test.dia(62, 11), 'SOLICITADA', now() + interval '1 hour');
  UPDATE citas SET aprobacion_vence_en = now() - interval '1 minute' WHERE id = v;
  INSERT INTO test.ids VALUES ('164d', v);
END $$;
\connect :app_url
DO $$ BEGIN
  ASSERT vencer_solicitudes() >= 1, 'caso 164: el job vence la solicitud';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT estado = 'CANCELADA' FROM citas WHERE id = test.id('164d')), 'caso 164: vencida queda CANCELADA';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM vencer_solicitudes();
    RAISE EXCEPTION 'caso 164: vencer solo el job';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\connect :owner_url

\echo 165 Punto 7 (2026-11-11): el profesional no acepta la solicitud y propone otras horas (PROPUESTA, ocupan la hora); el paciente elige una o rechaza todas; el job vence las propuestas; la API no fija PROPUESTA
-- Paciente y cuenta propios del caso (las cuentas de paciente anteriores pueden estar cerradas a esta altura).
INSERT INTO pacientes (id, nombre, apellido, fecha_nacimiento, profesional_id) VALUES (test.u('ef'), 'Pia', 'Propuesta', '1990-01-01', test.u('b1'));
INSERT INTO fichas_clinicas (paciente_id) VALUES (test.u('ef'));
INSERT INTO usuarios (id, email, password_hash, nombre, rol, paciente_id) VALUES (test.u('9f'), 't-pia@x', 'h', 'Pia (paciente)', 'PACIENTE', test.u('ef'));
DO $$ DECLARE v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid(); BEGIN
  INSERT INTO citas (id, modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en) VALUES
    (v1, 'ONLINE', test.u('b1'), test.u('ef'), test.dia(63, 10), test.dia(63, 11), 'SOLICITADA', now() + interval '1 hour'),
    (v2, 'ONLINE', test.u('b1'), test.u('ef'), test.dia(63, 16), test.dia(63, 17), 'SOLICITADA', now() + interval '1 hour');
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en)
    VALUES ('ONLINE', test.u('b1'), test.u('ef'), test.dia(64, 10), test.dia(64, 11), 'PROPUESTA', now() + interval '1 hour');
    RAISE EXCEPTION 'caso 165: PROPUESTA exige la solicitud original';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO test.ids VALUES ('165a', v1), ('165b', v2);
END $$;
\connect :app_url
DO $$ DECLARE n int; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en, propuesta_de_id)
    VALUES ('ONLINE', test.u('b1'), test.u('ef'), test.dia(64, 10), test.dia(64, 11), 'PROPUESTA', now() + interval '1 hour', test.id('165a'));
    RAISE EXCEPTION 'caso 165: la API no inserta PROPUESTA';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM proponer_cambio_hora(test.id('165a'), '[]'::jsonb);
    RAISE EXCEPTION 'caso 165: al menos una hora';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('b2', 'PROFESIONAL');
  BEGIN
    PERFORM proponer_cambio_hora(test.id('165a'), jsonb_build_array(jsonb_build_object('modalidad', 'ONLINE', 'inicio', test.dia(64, 10), 'fin', test.dia(64, 11))));
    RAISE EXCEPTION 'caso 165: otro profesional no propone';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  SELECT count(*) INTO n FROM proponer_cambio_hora(test.id('165a'), jsonb_build_array(
    jsonb_build_object('modalidad', 'ONLINE', 'inicio', test.dia(64, 10), 'fin', test.dia(64, 11)),
    jsonb_build_object('modalidad', 'ONLINE', 'inicio', test.dia(64, 12), 'fin', test.dia(64, 13))));
  ASSERT n = 2, 'caso 165: dos propuestas';
  ASSERT (SELECT estado = 'CANCELADA' FROM citas WHERE id = test.id('165a')), 'caso 165: la solicitud se cancela';
  ASSERT (SELECT count(*) FROM citas WHERE propuesta_de_id = test.id('165a') AND estado = 'PROPUESTA' AND aprobacion_vence_en IS NOT NULL) = 2,
    'caso 165: propuestas con plazo';
  BEGIN
    UPDATE citas SET estado = 'CONFIRMADA' WHERE propuesta_de_id = test.id('165a');
    RAISE EXCEPTION 'caso 165: la API no confirma una propuesta por UPDATE';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin)
    VALUES ('ONLINE', test.u('b1'), test.u('ef'), test.dia(64, 10), test.dia(64, 11));
    RAISE EXCEPTION 'caso 165: la hora propuesta esta ocupada';
  EXCEPTION WHEN exclusion_violation THEN NULL; END;
  BEGIN
    PERFORM aceptar_propuesta((SELECT id FROM citas WHERE propuesta_de_id = test.id('165a') LIMIT 1));
    RAISE EXCEPTION 'caso 165: el profesional no acepta por el paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Segunda solicitud: propuesta que el paciente rechaza.
  PERFORM proponer_cambio_hora(test.id('165b'), jsonb_build_array(jsonb_build_object('modalidad', 'ONLINE', 'inicio', test.dia(64, 16), 'fin', test.dia(64, 17))));
  PERFORM test.ctx('9f', 'PACIENTE');
  ASSERT aceptar_propuesta((SELECT id FROM citas WHERE propuesta_de_id = test.id('165a') AND inicio = test.dia(64, 12))) = 'CONFIRMADA',
    'caso 165: el paciente acepta una';
  ASSERT (SELECT estado = 'CANCELADA' FROM citas WHERE propuesta_de_id = test.id('165a') AND inicio = test.dia(64, 10)),
    'caso 165: la otra se suelta';
  BEGIN
    PERFORM aceptar_propuesta((SELECT id FROM citas WHERE propuesta_de_id = test.id('165a') AND inicio = test.dia(64, 10)));
    RAISE EXCEPTION 'caso 165: la soltada ya no se acepta';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  ASSERT rechazar_propuestas((SELECT id FROM citas WHERE propuesta_de_id = test.id('165b'))) = 1, 'caso 165: rechaza todas';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\connect :owner_url
DO $$ DECLARE v uuid := gen_random_uuid(); p uuid := gen_random_uuid(); BEGIN
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE referencia_id = test.id('165a') AND tipo = 'CAMBIO_HORA_PROPUESTO' AND paciente_id = test.u('ef')),
    'caso 165: aviso al paciente';
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE referencia_id = test.id('165b') AND tipo = 'CITA_CANCELADA' AND usuario_id = test.u('b1')),
    'caso 165: aviso al profesional cuando no acomoda ninguna';
  ASSERT EXISTS (SELECT 1 FROM notificaciones n JOIN citas c ON c.id = n.referencia_id
                 WHERE c.propuesta_de_id = test.id('165a') AND n.tipo = 'PROPUESTA_ACEPTADA' AND n.usuario_id = test.u('b1')),
    'caso 165: aviso al profesional cuando el paciente elige';
  INSERT INTO citas (id, modalidad, profesional_id, paciente_id, inicio, fin, estado, cancelada_en)
  VALUES (v, 'ONLINE', test.u('b1'), test.u('ef'), test.dia(65, 8), test.dia(65, 9), 'CANCELADA', now());
  INSERT INTO citas (id, modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en, propuesta_de_id)
  VALUES (p, 'ONLINE', test.u('b1'), test.u('ef'), test.dia(65, 10), test.dia(65, 11), 'PROPUESTA', now() + interval '1 hour', v);
  UPDATE citas SET aprobacion_vence_en = now() - interval '1 minute' WHERE id = p;
  INSERT INTO test.ids VALUES ('165c', v), ('165d', p);
END $$;
\connect :app_url
DO $$ BEGIN
  ASSERT vencer_solicitudes() >= 1, 'caso 165: el job vence la propuesta';
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT estado = 'CANCELADA' FROM citas WHERE id = test.id('165d')), 'caso 165: vencida queda CANCELADA';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\connect :owner_url
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE referencia_id = test.id('165c') AND tipo = 'CITA_CANCELADA' AND paciente_id = test.u('ef')),
    'caso 165: aviso al paciente cuando vencen las propuestas';
END $$;

\echo 166 Roles flexibles (2026-11-11): una cuenta del equipo suma cuenta madre, gestion o profesional; PRACTICANTE sigue exclusivo; ADMIN/GESTION adicional se quita al instante, nunca el propio
\connect :app_url
DO $$ BEGIN
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM otorgar_rol_adicional(test.u('b1'), 'GESTION');
    RAISE EXCEPTION 'caso 166: GESTION no otorga roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM otorgar_rol_adicional(test.u('b1'), 'GESTION');
  PERFORM otorgar_rol_adicional(test.u('b1'), 'ADMIN');
  ASSERT roles_cuenta(test.u('b1')) @> ARRAY['PROFESIONAL', 'GESTION', 'ADMIN'], 'caso 166: profesional con gestion y cuenta madre';
  BEGIN
    PERFORM otorgar_rol_adicional(test.u('b1'), 'PROFESIONAL');
    RAISE EXCEPTION 'caso 166: el principal no se suma como adicional';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM otorgar_rol_adicional(test.u('c1'), 'GESTION');
    RAISE EXCEPTION 'caso 166: PRACTICANTE es exclusivo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM quitar_rol_adicional(test.u('b1'), 'PROFESIONAL');
    RAISE EXCEPTION 'caso 166: el profesional se da de baja con fecha';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM quitar_rol_adicional(test.u('a1'), 'ADMIN');
    RAISE EXCEPTION 'caso 166: nadie se quita un rol a si mismo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM test.ctx('a3', 'GESTION');
  BEGIN
    PERFORM quitar_rol_adicional(test.u('b1'), 'GESTION');
    RAISE EXCEPTION 'caso 166: GESTION no quita roles';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  PERFORM quitar_rol_adicional(test.u('b1'), 'GESTION');
  PERFORM quitar_rol_adicional(test.u('b1'), 'ADMIN');
  ASSERT NOT roles_cuenta(test.u('b1')) && ARRAY['GESTION', 'ADMIN'], 'caso 166: roles quitados';
  BEGIN
    PERFORM quitar_rol_adicional(test.u('b1'), 'ADMIN');
    RAISE EXCEPTION 'caso 166: ya no lo tiene';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\echo 168 La baja cancela las horas PROPUESTA desde la fecha efectiva (con aviso al paciente); se revierte al final
\connect :owner_url
DO $$ DECLARE v uuid := gen_random_uuid(); BEGIN
  BEGIN
    INSERT INTO citas (id, modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en) VALUES
      (v, 'ONLINE', test.u('b1'), test.u('ef'), test.dia(70, 10), test.dia(70, 11), 'SOLICITADA', now() + interval '1 hour');
    INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, aprobacion_vence_en, propuesta_de_id) VALUES
      ('ONLINE', test.u('b1'), test.u('ef'), test.dia(71, 10), test.dia(71, 11), 'PROPUESTA', now() + interval '1 hour', v),
      ('ONLINE', test.u('b1'), test.u('ef'), test.dia(71, 12), test.dia(71, 13), 'PROPUESTA', now() + interval '1 hour', v);
    PERFORM cancelar_propuestas_baja(test.u('b1'), test.dia(71, 0));
    ASSERT (SELECT count(*) FROM citas WHERE propuesta_de_id = v AND estado = 'CANCELADA') = 2, 'caso 168: propuestas canceladas';
    ASSERT (SELECT count(*) FROM notificaciones WHERE referencia_id = v AND tipo = 'CITA_CANCELADA' AND canal = 'BANDEJA' AND paciente_id = test.u('ef')) = 1,
      'caso 168: un aviso por grupo';
    ASSERT pg_get_functiondef('iniciar_baja_profesional(uuid, timestamptz)'::regprocedure) LIKE '%cancelar_propuestas_baja%'
       AND pg_get_functiondef('iniciar_baja_rol(uuid, rol, timestamptz)'::regprocedure) LIKE '%cancelar_propuestas_baja%',
      'caso 168: ambas bajas la llaman';
    RAISE EXCEPTION 'revertir 168';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'revertir 168' THEN RAISE; END IF;
  END;
END $$;

\echo 169 Punto 38: contactos de emergencia: los escribe el paciente; el tratante ve existencia y parentesco y abre los datos solo con motivo (auditado); ADMIN y otro profesional no
\connect :app_url
DO $$ DECLARE n int; v uuid := gen_random_uuid(); x bytea := decode(repeat('01', 60), 'hex'); BEGIN
  PERFORM test.ctx('9f', 'PACIENTE');
  INSERT INTO contactos_emergencia (id, paciente_id, nombre, parentesco, telefono) VALUES (v, test.u('ef'), x, 'Hermana', x);
  ASSERT (SELECT parentesco FROM contactos_emergencia WHERE id = v) = 'Hermana', 'caso 169: el paciente lo ve';
  BEGIN
    PERFORM nombre FROM contactos_emergencia WHERE id = v;
    RAISE EXCEPTION 'caso 169: nadie lee nombre por la tabla';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM datos_contactos_emergencia(test.u('ef'), NULL);
  ASSERT n = 1, 'caso 169: el paciente lee sus datos sin motivo';
  UPDATE contactos_emergencia SET parentesco = 'Madre' WHERE id = v;
  ASSERT (SELECT parentesco FROM contactos_emergencia WHERE id = v) = 'Madre', 'caso 169: el paciente edita';

  PERFORM test.ctx('b2', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM contactos_emergencia WHERE paciente_id = test.u('ef')) = 0, 'caso 169: otro profesional no ve';
  BEGIN
    PERFORM * FROM datos_contactos_emergencia(test.u('ef'), 'urgencia en sesion');
    RAISE EXCEPTION 'caso 169: otro profesional no abre datos';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT count(*) FROM contactos_emergencia WHERE paciente_id = test.u('ef')) = 0, 'caso 169: la cuenta madre no ve';
  BEGIN
    PERFORM * FROM datos_contactos_emergencia(test.u('ef'), 'urgencia en sesion');
    RAISE EXCEPTION 'caso 169: la cuenta madre no abre datos';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM contactos_emergencia WHERE paciente_id = test.u('ef')) = 1, 'caso 169: el tratante ve que existe';
  BEGIN
    PERFORM * FROM datos_contactos_emergencia(test.u('ef'), NULL);
    RAISE EXCEPTION 'caso 169: sin motivo no se abren';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT count(*) INTO n FROM datos_contactos_emergencia(test.u('ef'), 'crisis en la sesion de hoy');
  ASSERT n = 1, 'caso 169: con motivo, el tratante abre los datos';
  BEGIN
    INSERT INTO contactos_emergencia (id, paciente_id, nombre, parentesco, telefono) VALUES (gen_random_uuid(), test.u('ef'), x, 'Padre', x);
    RAISE EXCEPTION 'caso 169: el tratante no agrega contactos';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM contactos_emergencia WHERE id = v;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'caso 169: el tratante no elimina';
  BEGIN
    PERFORM pedir_contacto_emergencia(test.u('ef'));
    RAISE EXCEPTION 'caso 169: ya tiene contacto';
  EXCEPTION WHEN check_violation THEN NULL; END;

  PERFORM test.ctx('9f', 'PACIENTE');
  DELETE FROM contactos_emergencia WHERE id = v;
  PERFORM test.ctx('b1', 'PROFESIONAL');
  PERFORM pedir_contacto_emergencia(test.u('ef'));
  BEGIN
    PERFORM pedir_contacto_emergencia(test.u('ef'));
    RAISE EXCEPTION 'caso 169: una vez por semana';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\connect :owner_url
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM accesos_ficha WHERE paciente_id = test.u('ef') AND recurso = 'contactos_emergencia' AND accion = 'EMERGENCIA'
                 AND usuario_id = test.u('b1')), 'caso 169: la emergencia queda auditada';
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE paciente_id = test.u('ef') AND tipo = 'CONTACTO_EMERGENCIA_PENDIENTE' AND canal = 'BANDEJA'),
    'caso 169: aviso al paciente';
END $$;

\echo 170 Punto 9: el bloqueo reprograma las citas del rango y avisa; el paciente cancela o pide atencion temporal; sin fin = no recibe pacientes (se revierte)
\connect :owner_url
DO $$ DECLARE v uuid := gen_random_uuid(); w uuid := gen_random_uuid(); BEGIN
  BEGIN
    INSERT INTO citas (id, modalidad, profesional_id, paciente_id, inicio, fin, estado) VALUES
      (v, 'ONLINE', test.u('b1'), test.u('ef'), test.dia(80, 10), test.dia(80, 11), 'CONFIRMADA'),
      (w, 'ONLINE', test.u('b1'), test.u('ef'), test.dia(90, 10), test.dia(90, 11), 'CONFIRMADA');
    INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo) VALUES (test.u('b1'), test.dia(80, 0), test.dia(81, 0), 'LICENCIA');
    ASSERT (SELECT estado::text FROM citas WHERE id = v) = 'POR_REPROGRAMAR', 'caso 170: la cita del rango se reprograma';
    ASSERT (SELECT estado::text FROM citas WHERE id = w) = 'CONFIRMADA', 'caso 170: la de fuera del rango sigue';
    ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE referencia_id = v AND tipo = 'CITA_AUSENCIA_PROFESIONAL' AND paciente_id = test.u('ef')),
      'caso 170: aviso al paciente';
    PERFORM test.ctx('b2', 'PROFESIONAL');
    ASSERT avisar_horas_por_reprogramar(ARRAY[v]) = 0, 'caso 170: otro profesional no avisa horas ajenas';
    PERFORM test.ctx('a1', 'ADMIN');
    ASSERT avisar_horas_por_reprogramar(ARRAY[v, w]) = 1, 'caso 170: la cuenta madre avisa solo las por reprogramar';
    PERFORM test.ctx('9f', 'PACIENTE');
    BEGIN
      PERFORM avisar_horas_por_reprogramar(ARRAY[v]);
      RAISE EXCEPTION 'caso 170: el paciente no usa el aviso del equipo';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;

    PERFORM test.ctx('b2', 'PROFESIONAL');
    BEGIN
      PERFORM responder_ausencia(v, 'CANCELAR');
      RAISE EXCEPTION 'caso 170: el equipo no responde por el paciente';
    EXCEPTION WHEN no_data_found THEN NULL; END;
    PERFORM test.ctx('9f', 'PACIENTE');
    BEGIN
      PERFORM responder_ausencia(v, 'OTRA');
      RAISE EXCEPTION 'caso 170: opcion invalida';
    EXCEPTION WHEN check_violation THEN NULL; END;
    PERFORM responder_ausencia(v, 'ATENCION_TEMPORAL');
    ASSERT EXISTS (SELECT 1 FROM alertas_internas WHERE tipo = 'ATENCION_TEMPORAL' AND referencia_id = test.u('ef') AND atendida_en IS NULL),
      'caso 170: alerta para la cuenta madre';
    ASSERT motivo_reasignacion(test.u('ef')) = 'ATENCION_TEMPORAL', 'caso 170: aparece en por reasignar';
    PERFORM responder_ausencia(v, 'CANCELAR');
    ASSERT (SELECT estado::text FROM citas WHERE id = v) = 'CANCELADA', 'caso 170: el paciente cancela';
    BEGIN
      PERFORM responder_ausencia(v, 'CANCELAR');
      RAISE EXCEPTION 'caso 170: ya no esta por reprogramar';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

    ASSERT (SELECT recibe FROM estado_atencion_publica() WHERE profesional_id = test.u('b1')), 'caso 170: recibe con un bloqueo con fin';
    INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo) VALUES (test.u('b1'), now() - interval '1 minute', NULL, 'PERSONAL');
    ASSERT NOT (SELECT recibe FROM estado_atencion_publica() WHERE profesional_id = test.u('b1')), 'caso 170: sin fin no recibe pacientes';
    ASSERT (SELECT estado::text FROM citas WHERE id = w) = 'POR_REPROGRAMAR', 'caso 170: sin fin reprograma todo lo que viene';
    ASSERT motivo_reasignacion(test.u('ef')) = 'NO_ATIENDE', 'caso 170: sus pacientes por reasignar';
    RAISE EXCEPTION 'revertir 170';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'revertir 170' THEN RAISE; END IF;
  END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;

\echo 171 Punto 9: atencion temporal recuerda al principal; en la siguiente asignacion se pregunta si esta disponible; volver cierra sola (se revierte)
\connect :owner_url
DO $$ DECLARE v uuid := gen_random_uuid(); b uuid; BEGIN
  BEGIN
    INSERT INTO citas (id, modalidad, profesional_id, paciente_id, inicio, fin, estado) VALUES
      (v, 'ONLINE', test.u('b1'), test.u('ef'), test.dia(85, 10), test.dia(85, 11), 'CONFIRMADA');
    INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo) VALUES (test.u('b1'), now() - interval '1 minute', test.dia(86, 0), 'LICENCIA')
      RETURNING id INTO b;
    PERFORM test.ctx('9f', 'PACIENTE');
    PERFORM responder_ausencia(v, 'ATENCION_TEMPORAL');
    ASSERT (SELECT profesional_principal_id FROM atenciones_temporales WHERE paciente_id = test.u('ef') AND cerrada_en IS NULL) = test.u('b1'),
      'caso 171: recuerda al principal';
    ASSERT NOT (SELECT principal_disponible FROM retorno_atencion_temporal(test.u('ef'))), 'caso 171: en licencia no esta disponible';
    BEGIN
      PERFORM pedir_volver_con_principal(test.u('ef'));
      RAISE EXCEPTION 'caso 171: no pide volver si no esta disponible';
    EXCEPTION WHEN check_violation THEN NULL; END;
    PERFORM test.ctx('b2', 'PROFESIONAL');
    EXECUTE 'SET LOCAL ROLE app_user';
    ASSERT NOT EXISTS (SELECT 1 FROM retorno_atencion_temporal(test.u('ef'))), 'caso 171: otro profesional no lo ve';
    EXECUTE 'RESET ROLE';
    -- Derivado temporalmente a b2; el principal vuelve (termina la licencia).
    PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
    UPDATE pacientes SET profesional_id = test.u('b2') WHERE id = test.u('ef');
    DELETE FROM bloqueos_agenda WHERE id = b;
    PERFORM test.ctx('9f', 'PACIENTE');
    ASSERT (SELECT principal_disponible FROM retorno_atencion_temporal(test.u('ef'))), 'caso 171: el principal ya esta disponible';
    PERFORM pedir_volver_con_principal(test.u('ef'));
    PERFORM test.ctx('a1', 'ADMIN');
    ASSERT (SELECT pide_volver FROM retornos_disponibles() WHERE paciente_id = test.u('ef')), 'caso 171: la cuenta madre lo ve primero';
    PERFORM test.ctx('b2', 'PROFESIONAL');
    BEGIN
      PERFORM * FROM retornos_disponibles();
      RAISE EXCEPTION 'caso 171: solo la cuenta madre';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
      PERFORM mantener_atencion_temporal(test.u('ef'));
      RAISE EXCEPTION 'caso 171: el profesional no cierra';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
    UPDATE pacientes SET profesional_id = test.u('b1') WHERE id = test.u('ef');
    ASSERT (SELECT cierre FROM atenciones_temporales WHERE paciente_id = test.u('ef') ORDER BY solicitada_en DESC LIMIT 1) = 'VOLVIO',
      'caso 171: volver con el principal la cierra';
    RAISE EXCEPTION 'revertir 171';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'revertir 171' THEN RAISE; END IF;
  END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;

\echo 172 Puntos 40/44: chat profesional <-> paciente: el tratante responde a la cuenta que escribio; otros no; el destinatario marca leido; ADMIN no lee
\connect :app_url
DO $$ DECLARE m uuid := gen_random_uuid(); r uuid := gen_random_uuid(); x bytea := decode(repeat('01', 60), 'hex'); n int; BEGIN
  PERFORM test.ctx('9f', 'PACIENTE');
  INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido) VALUES (m, test.u('ef'), test.u('b1'), test.u('9f'), x);
  BEGIN
    INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido, de_profesional, destinatario_id)
    VALUES (gen_random_uuid(), test.u('ef'), test.u('b1'), test.u('9f'), x, true, test.u('9f'));
    RAISE EXCEPTION 'caso 172: el paciente no escribe como profesional';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM test.ctx('b2', 'PROFESIONAL');
  BEGIN
    INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido, de_profesional, destinatario_id)
    VALUES (gen_random_uuid(), test.u('ef'), test.u('b2'), test.u('b2'), x, true, test.u('9f'));
    RAISE EXCEPTION 'caso 172: otro profesional no responde';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido, de_profesional, destinatario_id)
    VALUES (gen_random_uuid(), test.u('ef'), test.u('b1'), test.u('b1'), x, true, test.u('a1'));
    RAISE EXCEPTION 'caso 172: solo a una cuenta del portal del paciente';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  INSERT INTO mensajes_paciente (id, paciente_id, profesional_id, autor_id, contenido, de_profesional, destinatario_id)
  VALUES (r, test.u('ef'), test.u('b1'), test.u('b1'), x, true, test.u('9f'));
  BEGIN
    PERFORM marcar_mensaje_leido(r);
    RAISE EXCEPTION 'caso 172: la respuesta la marca el destinatario';
  EXCEPTION WHEN no_data_found THEN NULL; END;

  PERFORM test.ctx('a1', 'ADMIN');
  SELECT count(*) INTO n FROM mensajes_paciente WHERE id IN (m, r);
  ASSERT n = 0, 'caso 172: la cuenta madre no lee el chat';

  PERFORM test.ctx('9f', 'PACIENTE');
  ASSERT EXISTS (SELECT 1 FROM mensajes_paciente WHERE id = r AND de_profesional), 'caso 172: el paciente ve la respuesta';
  PERFORM marcar_mensaje_leido(r);
  ASSERT (SELECT leido_en IS NOT NULL FROM mensajes_paciente WHERE id = r), 'caso 172: el destinatario marca leida';
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
  INSERT INTO test.ids VALUES ('172r', r);
END $$;
\connect :owner_url
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM notificaciones WHERE referencia_id = test.id('172r') AND tipo = 'MENSAJE_PROFESIONAL' AND paciente_id = test.u('ef')),
    'caso 172: aviso al paciente sin contenido';
END $$;

\echo 173 Portal con el tratante no disponible: lo sabe, pide otro profesional o cancela sus horas con el; con el tratante disponible no cancela en bloque (se revierte)
\connect :owner_url
DO $$ DECLARE v uuid := gen_random_uuid(); BEGIN
  BEGIN
    INSERT INTO citas (id, modalidad, profesional_id, paciente_id, inicio, fin, estado) VALUES
      (v, 'ONLINE', test.u('b1'), test.u('ef'), test.dia(95, 10), test.dia(95, 11), 'CONFIRMADA');
    PERFORM test.ctx('9f', 'PACIENTE');
    ASSERT (SELECT disponible FROM estado_tratante_portal(test.u('ef'))), 'caso 173: disponible';
    BEGIN
      PERFORM cancelar_horas_tratante_ausente(test.u('ef'));
      RAISE EXCEPTION 'caso 173: disponible no cancela en bloque';
    EXCEPTION WHEN check_violation THEN NULL; END;
    PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
    UPDATE usuarios SET activo = false WHERE id = test.u('b1');
    PERFORM test.ctx('9f', 'PACIENTE');
    ASSERT NOT (SELECT disponible FROM estado_tratante_portal(test.u('ef'))), 'caso 173: desactivado no esta disponible';
    ASSERT (SELECT horas_con_tratante FROM estado_tratante_portal(test.u('ef'))) >= 1, 'caso 173: cuenta sus horas';
    PERFORM test.ctx('b2', 'PROFESIONAL');
    BEGIN
      PERFORM solicitar_otro_profesional(test.u('ef'));
      RAISE EXCEPTION 'caso 173: el equipo no pide por el paciente';
    EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN
      PERFORM * FROM estado_tratante_portal(test.u('ef'));
      RAISE EXCEPTION 'caso 173: solo el portal del paciente';
    EXCEPTION WHEN no_data_found THEN NULL; END;
    PERFORM test.ctx('9f', 'PACIENTE');
    PERFORM solicitar_otro_profesional(test.u('ef'));
    ASSERT (SELECT solicitud_pendiente FROM estado_tratante_portal(test.u('ef'))), 'caso 173: queda pedido';
    ASSERT cancelar_horas_tratante_ausente(test.u('ef')) >= 1, 'caso 173: cancela sus horas';
    ASSERT (SELECT estado::text FROM citas WHERE id = v) = 'CANCELADA', 'caso 173: la hora quedo cancelada';
    RAISE EXCEPTION 'revertir 173';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'revertir 173' THEN RAISE; END IF;
  END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;

\echo 174 Punto 36: perfiles de rol: ADMIN los crea y asigna; solo restringen modulos (sin finanzas); solo a quien tiene el rol base, uno por rol; con asignados no se cambia la base (se revierte)
\connect :owner_url
DO $$ DECLARE p uuid; q uuid; BEGIN
  BEGIN
    PERFORM test.ctx('a3', 'GESTION');
    BEGIN
      EXECUTE 'SET LOCAL ROLE app_user';
      INSERT INTO perfiles_rol (nombre, rol_base) VALUES ('No vale', 'GESTION');
      RAISE EXCEPTION 'caso 174: GESTION no crea perfiles';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    EXECUTE 'RESET ROLE';
    BEGIN
      INSERT INTO perfiles_rol (nombre, rol_base, restricciones) VALUES ('Mensajeria', 'GESTION', ARRAY['WHATSAPP']::modulo_centro[]);
      RAISE EXCEPTION 'caso 174: no restringe modulos fuera del MVP';
    EXCEPTION WHEN check_violation THEN NULL; END;
    INSERT INTO perfiles_rol (nombre, rol_base, restricciones) VALUES ('Recepcion', 'GESTION', ARRAY['FICHAS']::modulo_centro[]) RETURNING id INTO p;
    INSERT INTO perfiles_rol (nombre, rol_base) VALUES ('Coordinacion', 'GESTION') RETURNING id INTO q;
    BEGIN
      INSERT INTO usuario_perfiles (usuario_id, perfil_id) VALUES (test.u('b1'), p);
      RAISE EXCEPTION 'caso 174: sin el rol base no se asigna';
    EXCEPTION WHEN check_violation THEN NULL; END;
    INSERT INTO usuario_perfiles (usuario_id, perfil_id) VALUES (test.u('a3'), p);
    BEGIN
      INSERT INTO usuario_perfiles (usuario_id, perfil_id) VALUES (test.u('a3'), q);
      RAISE EXCEPTION 'caso 174: un perfil por rol base';
    EXCEPTION WHEN check_violation THEN NULL; END;
    ASSERT modulos_restringidos(test.u('a3'), 'GESTION') = ARRAY['FICHAS']::modulo_centro[], 'caso 174: restringe en su rol';
    ASSERT modulos_restringidos(test.u('a3'), 'ADMIN') = '{}'::modulo_centro[], 'caso 174: no afecta otros roles';
    BEGIN
      UPDATE perfiles_rol SET rol_base = 'PROFESIONAL' WHERE id = p;
      RAISE EXCEPTION 'caso 174: con asignados no se cambia la base';
    EXCEPTION WHEN check_violation THEN NULL; END;
    RAISE EXCEPTION 'revertir 174';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'revertir 174' THEN RAISE; END IF;
  END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;

\echo 175 Puntos 27/28: match: ADMIN elimina preguntas propias (las del sistema no) y opciones (no la ultima de una pregunta de seleccion); otros roles no (se revierte)
\connect :owner_url
DO $$ DECLARE q uuid; o1 uuid; o2 uuid; sis uuid; BEGIN
  BEGIN
    INSERT INTO match_preguntas (clave, texto, tipo, orden, propia_centro) VALUES ('t175', 'Propia', 'UNICA', 99, true) RETURNING id INTO q;
    INSERT INTO match_opciones (pregunta_id, valor, etiqueta, orden) VALUES (q, 'a', 'A', 1) RETURNING id INTO o1;
    INSERT INTO match_opciones (pregunta_id, valor, etiqueta, orden) VALUES (q, 'b', 'B', 2) RETURNING id INTO o2;
    SELECT id INTO sis FROM match_preguntas WHERE NOT propia_centro LIMIT 1;
    PERFORM test.ctx('a3', 'GESTION');
    BEGIN
      PERFORM eliminar_opcion_match(o1);
      RAISE EXCEPTION 'caso 175: GESTION no edita el match';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM test.ctx('a1', 'ADMIN');
    PERFORM eliminar_opcion_match(o1);
    BEGIN
      PERFORM eliminar_opcion_match(o2);
      RAISE EXCEPTION 'caso 175: no la ultima opcion';
    EXCEPTION WHEN check_violation THEN NULL; END;
    IF sis IS NOT NULL THEN
      BEGIN
        PERFORM eliminar_pregunta_match(sis);
        RAISE EXCEPTION 'caso 175: las del sistema no se eliminan';
      EXCEPTION WHEN check_violation THEN NULL; END;
    END IF;
    PERFORM eliminar_pregunta_match(q);
    ASSERT NOT EXISTS (SELECT 1 FROM match_preguntas WHERE id = q) AND NOT EXISTS (SELECT 1 FROM match_opciones WHERE pregunta_id = q),
      'caso 175: la propia se elimina con sus opciones';
    RAISE EXCEPTION 'revertir 175';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'revertir 175' THEN RAISE; END IF;
  END;
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;

\echo 167 Maximo de cuentas madre: regla del centro (principal + adicional); bajarlo exige quitar roles antes
\connect :owner_url
DO $$ DECLARE n int := cuentas_madre_activas(); BEGIN
  UPDATE configuracion_centro SET max_cuentas_madre = n;
  BEGIN
    UPDATE configuracion_centro SET max_cuentas_madre = n - 1;
    RAISE EXCEPTION 'caso 167: no se baja el maximo bajo las cuentas activas';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
\connect :app_url
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM otorgar_rol_adicional(test.u('b1'), 'ADMIN');
    RAISE EXCEPTION 'caso 167: adicional sobre el maximo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- Gestion no cuenta: se suma igual con el cupo lleno.
  PERFORM otorgar_rol_adicional(test.u('b1'), 'GESTION');
  PERFORM quitar_rol_adicional(test.u('b1'), 'GESTION');
  PERFORM set_config('app.current_usuario_id', '', true), set_config('app.current_rol', '', true);
END $$;
\connect :owner_url
DO $$ BEGIN
  BEGIN
    INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES (gen_random_uuid(), 't-cm167@x', 'x', 'Cuenta madre 167', 'ADMIN');
    RAISE EXCEPTION 'caso 167: principal sobre el maximo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE configuracion_centro SET max_cuentas_madre = max_cuentas_madre + 1;
  INSERT INTO usuarios (id, email, password_hash, nombre, rol) VALUES (gen_random_uuid(), 't-cm167@x', 'x', 'Cuenta madre 167', 'ADMIN');
  UPDATE usuarios SET activo = false WHERE email = 't-cm167@x';
END $$;
UPDATE configuracion_centro SET max_cuentas_madre = NULL;

\echo 78 Sin texto plano: toda columna bytea cifrada tiene el formato; seed sin datos sensibles; copia de autoria intacta tras cerrar cuentas
DO $$ DECLARE c record; n int; BEGIN
  FOR c IN SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND data_type = 'bytea' AND column_name NOT LIKE '%hmac'
             -- sesiones y tokens_correo guardan SHA-256 de tokens (bytea sin cifrar, como las sesiones).
             -- 03b-4.1: codigos de verificacion y de respaldo guardan HMAC-SHA256 (como tokens_correo).
             AND table_name NOT IN ('llaves_datos', 'sesiones', 'tokens_correo', 'imagenes_publicas', 'codigos_verificacion', 'codigos_respaldo')
             -- 03b-3.1: SHA-256 del token opaco de la reserva (como tokens_correo).
             AND table_name || '.' || column_name NOT IN ('solicitudes_hora.reserva_hash',
             -- AUD-01: SHA-256 del enlace y del codigo de una exportacion (como tokens_correo).
                                                          'destinatarios_exportacion.token_hash', 'destinatarios_exportacion.codigo_hash',
             -- AUD-02: llave PUBLICA X25519 y sal de la exportacion del centro (publicas por diseño; la privada no se guarda).
                                                          'exportaciones_centro.clave_publica', 'exportaciones_centro.sal') LOOP
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

-- =============================================================================
-- Tarea 31 / R2-R3 (Vinculos Control, 2026-11-13)
-- =============================================================================

\echo 176 Solicitudes de modulos: solo ADMIN, estado y dependencias, una abierta por modulo, sin escritura directa; R2/R3 solo con el token del silo y sin contexto de usuario
UPDATE configuracion_centro SET modulos_activos = ARRAY['FICHAS', 'AGENDA', 'EQUIPO', 'PAGINA_PUBLICA']::modulo_centro[];
\connect :app_url
DO $$ DECLARE v uuid; BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  BEGIN
    PERFORM solicitar_modulo('MATCH', 'ACTIVAR', NULL);
    RAISE EXCEPTION 'caso 176: PROFESIONAL solicita debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM solicitar_modulo('WHATSAPP', 'ACTIVAR', NULL);
    RAISE EXCEPTION 'caso 176: WHATSAPP (fuera de esta version) debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM solicitar_modulo('FICHAS', 'ACTIVAR', NULL);
    RAISE EXCEPTION 'caso 176: activar un modulo activo debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM solicitar_modulo('EQUIPO', 'DESACTIVAR', NULL);
    RAISE EXCEPTION 'caso 176: desactivar EQUIPO con PAGINA_PUBLICA activa debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  v := solicitar_modulo('MATCH', 'ACTIVAR', '  Queremos ofrecer el match  ');
  ASSERT (SELECT count(*) FROM solicitudes_modulo
          WHERE id = v AND estado = 'PENDIENTE' AND pedida_por = test.u('a1') AND motivo = 'Queremos ofrecer el match') = 1,
    'caso 176: solicitud registrada';
  BEGIN
    PERFORM solicitar_modulo('MATCH', 'ACTIVAR', NULL);
    RAISE EXCEPTION 'caso 176: segunda solicitud abierta del mismo modulo debio fallar';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO solicitudes_modulo (modulo, accion, pedida_por, pedida_por_rol) VALUES ('MATCH', 'DESACTIVAR', test.u('a1'), 'ADMIN');
    RAISE EXCEPTION 'caso 176: INSERT directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE solicitudes_modulo SET estado = 'APLICADA' WHERE id = v;
    RAISE EXCEPTION 'caso 176: UPDATE directo debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM solicitudes_modulo_internas('token-interno-de-prueba-de-32-caracteres-o-mas', NULL);
    RAISE EXCEPTION 'caso 176: R2 con contexto de usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) FROM solicitudes_modulo) = 0, 'caso 176: PROFESIONAL no ve solicitudes';
END $$;
DO $$ DECLARE
  t text := 'token-interno-de-prueba-de-32-caracteres-o-mas';
  v uuid;
BEGIN
  BEGIN
    PERFORM * FROM solicitudes_modulo_internas('otro-token-de-prueba-de-32-caracteres-o-mas', NULL);
    RAISE EXCEPTION 'caso 176: R2 con otro token debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT id INTO v FROM solicitudes_modulo_internas(t, NULL) WHERE modulo = 'MATCH' AND estado = 'PENDIENTE' AND pedida_por_rol = 'ADMIN';
  ASSERT v IS NOT NULL, 'caso 176: R2 entrega la solicitud';
  ASSERT (SELECT proargnames FROM pg_proc WHERE proname = 'solicitudes_modulo_internas')
         = '{p_token,p_desde,id,modulo,accion,pedida_por_rol,pedida_en,estado,respondida_en,actualizada_en}',
    'caso 176: R2 sin motivo ni pedida_por';
  BEGIN
    PERFORM responder_solicitud_modulo(t, v, 'APLICADA', NULL);
    RAISE EXCEPTION 'caso 176: PENDIENTE -> APLICADA debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM responder_solicitud_modulo('otro-token-de-prueba-de-32-caracteres-o-mas', v, 'APROBADA', NULL);
    RAISE EXCEPTION 'caso 176: R3 con otro token debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT responder_solicitud_modulo(t, v, 'APROBADA', 'Se activa esta semana') = 'APROBADA', 'caso 176: aprobada';
  ASSERT responder_solicitud_modulo(t, v, 'APROBADA', NULL) = 'APROBADA', 'caso 176: repetir es idempotente';
  BEGIN
    PERFORM responder_solicitud_modulo(t, v, 'APLICADA', NULL);
    RAISE EXCEPTION 'caso 176: APLICADA sin modulos_activos debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT (SELECT count(*) FROM solicitudes_modulo_internas(t, now() - interval '1 hour') WHERE id = v AND estado = 'APROBADA') = 1,
    'caso 176: R2 desde una fecha entrega las actualizadas';
END $$;
\connect :owner_url
-- El operador aplica (hoy a mano; con R4, el job reconfigurar).
UPDATE configuracion_centro SET modulos_activos = modulos_activos || 'MATCH'::modulo_centro;
\connect :app_url
DO $$ DECLARE
  t text := 'token-interno-de-prueba-de-32-caracteres-o-mas';
  v uuid;
BEGIN
  SELECT id INTO v FROM solicitudes_modulo_internas(t, NULL) WHERE modulo = 'MATCH' AND accion = 'ACTIVAR';
  ASSERT responder_solicitud_modulo(t, v, 'APLICADA', 'Activado') = 'APLICADA', 'caso 176: aplicada';
  BEGIN
    PERFORM responder_solicitud_modulo(t, v, 'RECHAZADA', NULL);
    RAISE EXCEPTION 'caso 176: APLICADA -> RECHAZADA debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
DO $$ BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  -- Cerrada la anterior, se puede abrir otra del mismo modulo.
  PERFORM solicitar_modulo('MATCH', 'DESACTIVAR', NULL);
  ASSERT (SELECT count(*) FROM solicitudes_modulo WHERE modulo = 'MATCH') = 2, 'caso 176: dos solicitudes de MATCH';
END $$;
\connect :owner_url

\echo 177 R5 admin inicial: solo con el token del silo y sin contexto; nunca si ya hay cuenta madre activa; crea ADMIN sin contraseña + invitacion; repetir con el mismo correo reemite; otro correo 55000
\connect :app_url
DO $$ DECLARE t text := 'token-interno-de-prueba-de-32-caracteres-o-mas'; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM invitar_admin_inicial(t, 'nueva@centro.cl', 'Nueva Admin', gen_random_uuid(), sha256('x'), now() + interval '72 hours');
    RAISE EXCEPTION 'caso 177: con contexto de usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM invitar_admin_inicial('otro-token-de-prueba-de-32-caracteres-o-mas', 'nueva@centro.cl', 'Nueva Admin', gen_random_uuid(), sha256('x'), now() + interval '72 hours');
    RAISE EXCEPTION 'caso 177: con otro token debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM invitar_admin_inicial('token-interno-de-prueba-de-32-caracteres-o-mas', 'nueva@centro.cl', 'Nueva Admin', gen_random_uuid(), sha256('x'), now() + interval '72 hours');
    RAISE EXCEPTION 'caso 177: con cuenta madre activa debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
\connect :owner_url
-- Camino feliz en una subtransaccion que se deshace: el silo "nuevo" no tiene
-- contraseñas fijadas (como recien aprovisionado).
DO $$ DECLARE
  t text := 'token-interno-de-prueba-de-32-caracteres-o-mas';
  v1 uuid; v2 uuid; n int;
BEGIN
  BEGIN
    UPDATE usuarios SET password_hash = NULL WHERE cerrada_en IS NULL;
    BEGIN
      PERFORM invitar_admin_inicial(t, 'no-es-correo', 'Nueva Admin', gen_random_uuid(), sha256('x'), now() + interval '72 hours');
      RAISE EXCEPTION 'caso 177: correo invalido debio fallar';
    EXCEPTION WHEN check_violation THEN NULL; END;
    -- Silo recien creado: sin cuentas madre. usuarios_ciclo_cuenta impide desactivar al
    -- ultimo ADMIN; se apaga solo dentro de esta subtransaccion (se deshace al final).
    ALTER TABLE usuarios DISABLE TRIGGER usuarios_ciclo_cuenta;
    UPDATE usuarios SET activo = false WHERE rol = 'ADMIN' AND cerrada_en IS NULL;
    ALTER TABLE usuarios ENABLE TRIGGER usuarios_ciclo_cuenta;
    SELECT usuario_id INTO v1 FROM invitar_admin_inicial(t, ' Nueva@Centro.cl ', 'Nueva Admin', gen_random_uuid(), sha256('a'), now() + interval '72 hours');
    ASSERT (SELECT count(*) FROM usuarios WHERE id = v1 AND rol = 'ADMIN' AND email = 'nueva@centro.cl' AND password_hash IS NULL AND activo) = 1,
      'caso 177: ADMIN creado sin contraseña, correo normalizado';
    ASSERT (SELECT count(*) FROM tokens_correo WHERE usuario_id = v1 AND tipo = 'INVITACION' AND usado_en IS NULL AND expira_en > now()) = 1,
      'caso 177: invitacion vigente';
    SELECT usuario_id INTO v2 FROM invitar_admin_inicial(t, 'nueva@centro.cl', 'Nueva Admin', gen_random_uuid(), sha256('b'), now() + interval '72 hours');
    ASSERT v1 = v2, 'caso 177: repetir no crea otra cuenta';
    -- emitir_token anula la anterior (vence en max(creada + 1 s, now()); en la misma
    -- transaccion now() no avanza): solo una queda con su plazo de 72 h.
    SELECT count(*) INTO n FROM tokens_correo WHERE usuario_id = v1 AND tipo = 'INVITACION' AND usado_en IS NULL AND expira_en > now() + interval '1 hour';
    ASSERT n = 1, format('caso 177: una sola invitacion vigente (hay %s)', n);
    BEGIN
      PERFORM invitar_admin_inicial(t, 'otra@centro.cl', 'Otra', gen_random_uuid(), sha256('c'), now() + interval '72 hours');
      RAISE EXCEPTION 'caso 177: pendiente con otro correo debio fallar';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'caso 177 ok: deshacer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'caso 177 ok: deshacer' THEN RAISE; END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'nueva@centro.cl'), 'caso 177: la prueba no deja datos';
END $$;

\echo 178 R4 config interna: token del silo y sin contexto; lista cerrada de reglas; dependencias; idempotente; nunca hacia atras; atomico
\connect :app_url
DO $$ DECLARE t text := 'token-interno-de-prueba-de-32-caracteres-o-mas'; BEGIN
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM aplicar_config_interna(t, 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ARRAY['FICHAS']::modulo_centro[], '{}');
    RAISE EXCEPTION 'caso 178: con contexto de usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
DO $$ DECLARE
  t text := 'token-interno-de-prueba-de-32-caracteres-o-mas';
  m modulo_centro[] := ARRAY['FICHAS', 'AGENDA', 'EQUIPO', 'MATCH']::modulo_centro[];
BEGIN
  BEGIN
    PERFORM aplicar_config_interna('otro-token-de-prueba-de-32-caracteres-o-mas', 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', m, '{}');
    RAISE EXCEPTION 'caso 178: con otro token debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM aplicar_config_interna(t, 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', m, '{"nombre_centro": "Otro"}');
    RAISE EXCEPTION 'caso 178: regla fuera de la lista debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM aplicar_config_interna(t, 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ARRAY['FICHAS', 'MATCH']::modulo_centro[], '{}');
    RAISE EXCEPTION 'caso 178: MATCH sin EQUIPO debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT aplicar_config_interna(t, 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', m, '{"recordatorio_horas_antes": 24, "plazo_aviso_cancelacion_horas": 12, "match_filtro_directo": true}') = 'APLICADA', 'caso 178: aplicada';
  ASSERT aplicar_config_interna(t, 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', m, '{}') = 'SIN_CAMBIOS', 'caso 178: misma revision y hash no cambia nada';
  ASSERT (SELECT revision = 1 AND hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' AND modulos @> m AND m @> modulos FROM config_interna(t)), 'caso 178: config_interna refleja lo aplicado';
  BEGIN
    PERFORM aplicar_config_interna(t, 1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', m, '{}');
    RAISE EXCEPTION 'caso 178: misma revision con otro hash debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    PERFORM aplicar_config_interna(t, 2, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', ARRAY['FICHAS', 'AGENDA', 'EQUIPO']::modulo_centro[], '{"plazo_aviso_cancelacion_horas": 99999}');
    RAISE EXCEPTION 'caso 178: regla fuera de rango debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT (SELECT revision = 1 AND 'MATCH' = ANY (modulos) FROM config_interna(t)), 'caso 178: un fallo no deja cambios a medias';
  ASSERT aplicar_config_interna(t, 2, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', ARRAY['FICHAS', 'AGENDA', 'EQUIPO']::modulo_centro[], '{}') = 'APLICADA', 'caso 178: revision 2';
  ASSERT (SELECT revision = 2 AND NOT 'MATCH' = ANY (modulos) FROM config_interna(t)), 'caso 178: MATCH apagado';
  BEGIN
    PERFORM aplicar_config_interna(t, 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', m, '{}');
    RAISE EXCEPTION 'caso 178: volver a la revision 1 debio fallar';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
\connect :owner_url
DO $$ BEGIN
  -- Las dos reglas cruzadas (recordatorio antes del plazo) en un mismo UPDATE: valen juntas.
  ASSERT (SELECT plazo_aviso_cancelacion_horas = 12 AND recordatorio_horas_antes = 24 AND match_filtro_directo FROM configuracion_centro),
    'caso 178: reglas aplicadas con su tipo';
END $$;

\echo 179 R13 exportaciones internas: token del silo y sin contexto; solo metadatos, sin clave ni quien la pidio
\connect :owner_url
INSERT INTO exportaciones_centro (solicitada_por_id, estado, tablas_total, bytes, huella, clave_publica, sal, iniciada_en)
SELECT id, 'EN_PROCESO', 10, 2048, repeat('e', 64), decode(repeat('01', 32), 'hex'), decode(repeat('02', 16), 'hex'), now() FROM usuarios ORDER BY created_at LIMIT 1;
\connect :app_url
DO $$ DECLARE t text := 'token-interno-de-prueba-de-32-caracteres-o-mas'; BEGIN
  BEGIN
    PERFORM * FROM exportaciones_internas('otro-token-de-prueba-de-32-caracteres-o-mas');
    RAISE EXCEPTION 'caso 179: con otro token debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) = 1 FROM exportaciones_internas(t) WHERE estado = 'EN_PROCESO' AND bytes = 2048 AND huella = repeat('e', 64)),
    'caso 179: entrega estado, tamano y huella';
  -- Solo las columnas acordadas: nada de clave_publica, sal ni solicitada_por_id.
  ASSERT (SELECT array_agg(a ORDER BY a) FROM unnest(ARRAY(
            SELECT unnest(proargnames) FROM pg_proc WHERE proname = 'exportaciones_internas')) a)
         = ARRAY['bytes', 'creada_en', 'estado', 'huella', 'id', 'p_token', 'terminada_en', 'vence_en'],
    'caso 179: columnas de salida cerradas';
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM * FROM exportaciones_internas(t);
    RAISE EXCEPTION 'caso 179: con contexto de usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
\connect :owner_url
DELETE FROM exportaciones_centro WHERE huella = repeat('e', 64);

\echo 180 R12 salida: solo lectura solo con el token del silo y sin contexto; idempotente; bitacora que solo se agrega
\connect :app_url
DO $$ DECLARE t text := 'token-interno-de-prueba-de-32-caracteres-o-mas'; r record; BEGIN
  ASSERT (SELECT NOT solo_lectura FROM estado_salida_silo()), 'caso 180: parte sin solo lectura';
  BEGIN
    PERFORM * FROM salida_interna('otro-token-de-prueba-de-32-caracteres-o-mas', true, '2026-12-31');
    RAISE EXCEPTION 'caso 180: con otro token debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM salida_interna(t, true, NULL);
    RAISE EXCEPTION 'caso 180: solo lectura sin fecha de corte debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT * INTO r FROM salida_interna(t, true, '2026-12-31');
  ASSERT r.resultado = 'APLICADA' AND r.solo_lectura AND r.desde IS NOT NULL, 'caso 180: aplicada';
  ASSERT (SELECT resultado FROM salida_interna(t, true, '2026-12-31')) = 'SIN_CAMBIOS', 'caso 180: idempotente';
  ASSERT (SELECT solo_lectura AND fecha_corte = '2026-12-31' FROM estado_salida_silo()), 'caso 180: estado visible para la API';
  BEGIN
    PERFORM * FROM eventos_salida;
    RAISE EXCEPTION 'caso 180: app_user no lee la bitacora directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM test.ctx('a1', 'ADMIN');
  BEGIN
    PERFORM * FROM salida_interna(t, false, NULL);
    RAISE EXCEPTION 'caso 180: con contexto de usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
\connect :app_url
DO $$ DECLARE t text := 'token-interno-de-prueba-de-32-caracteres-o-mas'; BEGIN
  ASSERT (SELECT resultado FROM salida_interna(t, false, NULL)) = 'APLICADA', 'caso 180: reversion';
  ASSERT (SELECT NOT solo_lectura AND desde IS NULL AND fecha_corte IS NULL FROM estado_salida_silo()), 'caso 180: vuelve a normal';
END $$;
\connect :owner_url
DO $$ BEGIN
  ASSERT (SELECT count(*) = 2 FROM eventos_salida), 'caso 180: dos eventos (entrar y salir; el repetido no cuenta)';
  BEGIN
    DELETE FROM eventos_salida;
    RAISE EXCEPTION 'caso 180: la bitacora no se borra';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

\echo 181 R6 notas de version: solo el token del silo y sin contexto; idempotente; solo ADMIN las lee
\connect :app_url
DO $$ DECLARE t text := 'token-interno-de-prueba-de-32-caracteres-o-mas'; BEGIN
  BEGIN
    PERFORM registrar_notas_version('otro-token-de-prueba-de-32-caracteres-o-mas', '0.1.1', 'Notas');
    RAISE EXCEPTION 'caso 181: con otro token debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM registrar_notas_version(t, 'v1', 'Notas');
    RAISE EXCEPTION 'caso 181: version invalida debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM registrar_notas_version(t, '0.1.1', '   ');
    RAISE EXCEPTION 'caso 181: notas vacias debio fallar';
  EXCEPTION WHEN check_violation THEN NULL; END;
  ASSERT registrar_notas_version(t, '0.1.1', ' Agenda: filtro por box. ') = 'REGISTRADA', 'caso 181: registrada';
  ASSERT registrar_notas_version(t, '0.1.1', 'Agenda: filtro por box.') = 'SIN_CAMBIOS', 'caso 181: idempotente';
  ASSERT registrar_notas_version(t, '0.1.1', 'Agenda: filtro por box y sala.') = 'REGISTRADA', 'caso 181: corregidas';
  PERFORM test.ctx('a1', 'ADMIN');
  ASSERT (SELECT notas FROM notas_version WHERE version = '0.1.1') = 'Agenda: filtro por box y sala.', 'caso 181: ADMIN las lee';
  BEGIN
    PERFORM registrar_notas_version(t, '0.1.2', 'Notas');
    RAISE EXCEPTION 'caso 181: con contexto de usuario debio fallar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO notas_version (version, notas) VALUES ('0.1.3', 'x');
    RAISE EXCEPTION 'caso 181: la API no escribe directo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
\connect :app_url
DO $$ BEGIN
  PERFORM test.ctx('b1', 'PROFESIONAL');
  ASSERT (SELECT count(*) = 0 FROM notas_version), 'caso 181: PROFESIONAL no las ve';
END $$;
\connect :owner_url
DELETE FROM notas_version;

\echo 182 R10 marca de demo: la API no la lee ni la cambia (solo el dueno con ES_DEMO)
\connect :app_url
DO $$ BEGIN
  ASSERT NOT has_column_privilege('app_user', 'identidad_silo', 'es_demo', 'UPDATE'), 'caso 182: app_user no cambia es_demo';
  ASSERT NOT has_column_privilege('app_user', 'identidad_silo', 'es_demo', 'SELECT'), 'caso 182: app_user no lee es_demo';
END $$;
\connect :owner_url

DROP SCHEMA test CASCADE;
\echo TODOS LOS CASOS OK
