-- =============================================================================
-- AUD-01 (E2.3a): feriados calculados por la ley, sin carga manual por año.
--
-- * feriados_legales(año): los feriados nacionales que fija la ley con una
--   regla, para cualquier año:
--     - fechas fijas (Ley 2.977 y modificaciones);
--     - Viernes y Sabado Santo (Pascua de Resurreccion);
--     - Dia de los Pueblos Indigenas: el dia del solsticio de invierno en
--       Chile (Ley 21.357), calculado con el algoritmo de Meeus;
--     - San Pedro y San Pablo (29-06) y Encuentro de Dos Mundos (12-10):
--       martes a jueves al lunes de esa semana, viernes al lunes siguiente
--       (Ley 19.668);
--     - Iglesias Evangelicas (31-10): martes al viernes 27, miercoles al
--       viernes 2-11 (Ley 20.299);
--     - 2 de enero si el 1 cae domingo, y 17 de septiembre si cae viernes
--       (Ley 20.983);
--     - 17 de septiembre si cae lunes y 20 de septiembre si cae viernes
--       (Ley 20.215, art. 35 ter del Codigo del Trabajo).
--   No calcula los que crea una ley puntual ni los regionales: esos los
--   agrega el ADMIN del centro (las elecciones caen en domingo y no cambian
--   los dias habiles).
-- * generar_feriados(año): job sin contexto, idempotente; inserta los que
--   falten (origen LEY). Nunca revive uno que el centro quito.
-- * agregar_feriado / quitar_feriado: ADMIN, solo fechas de hoy en adelante
--   (los plazos ya fijados no cambian). Quitar es logico (queda quien y cuando).
-- * dias_habiles_desde / dias_habiles_restantes ignoran los quitados.
-- =============================================================================

ALTER TABLE "feriados" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'LEY',
  ADD COLUMN "creado_por_id" UUID,
  ADD COLUMN "quitado_en" TIMESTAMPTZ(6),
  ADD COLUMN "quitado_por_id" UUID;
ALTER TABLE "feriados" ALTER COLUMN "origen" DROP DEFAULT;
ALTER TABLE "feriados" ADD CONSTRAINT "feriados_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feriados" ADD CONSTRAINT "feriados_quitado_por_id_fkey" FOREIGN KEY ("quitado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE feriados ADD CONSTRAINT feriados_origen CHECK (origen IN ('LEY', 'CENTRO'));
ALTER TABLE feriados ADD CONSTRAINT feriados_coherente
  CHECK ((origen = 'CENTRO') = (creado_por_id IS NOT NULL) AND (quitado_en IS NULL) = (quitado_por_id IS NULL)
         AND length(btrim(nombre)) BETWEEN 2 AND 120);
COMMENT ON TABLE feriados IS
  'Categoria B. Feriados de Chile (dias no habiles): los de la ley los calcula generar_feriados; el ADMIN agrega los puntuales o regionales y puede quitar uno.';

-- Pascua de Resurreccion (algoritmo gregoriano anonimo).
CREATE FUNCTION pascua(p_anio int) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  a int := p_anio % 19; b int := p_anio / 100; c int := p_anio % 100;
  d int; e int; f int; g int; h int; i int; k int; l int; m int;
BEGIN
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  RETURN make_date(p_anio, (h + l - 7 * m + 114) / 31, (h + l - 7 * m + 114) % 31 + 1);
END;
$$;

-- Dia (hora de Chile) del solsticio de junio: Meeus, Astronomical Algorithms
-- cap. 27 (años 2000 a 3000, error de pocos minutos).
CREATE FUNCTION solsticio_invierno(p_anio int) RETURNS date
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  y float8 := (p_anio - 2000) / 1000.0;
  jde0 float8 := 2451716.56767 + 365241.62603 * y + 0.00325 * y ^ 2 + 0.00888 * y ^ 3 - 0.00030 * y ^ 4;
  t float8 := (jde0 - 2451545.0) / 36525;
  w float8 := radians(35999.373 * t - 2.47);
  dl float8 := 1 + 0.0334 * cos(w) + 0.0007 * cos(2 * w);
  s float8;
  jd float8;
BEGIN
  SELECT sum(a * cos(radians(b + c * t))) INTO s FROM (VALUES
    (485, 324.96, 1934.136), (203, 337.23, 32964.467), (199, 342.08, 20.186), (182, 27.85, 445267.112),
    (156, 73.14, 45036.886), (136, 171.52, 22518.443), (77, 222.54, 65928.934), (74, 296.72, 3034.906),
    (70, 243.58, 9037.513), (58, 119.81, 33718.147), (52, 297.17, 150.678), (50, 21.02, 2281.226),
    (45, 247.54, 29929.562), (44, 325.15, 31555.956), (29, 60.93, 4443.417), (18, 155.12, 67555.328),
    (17, 288.79, 4562.452), (16, 198.04, 62894.029), (14, 199.76, 31436.921), (12, 95.39, 14577.848),
    (12, 287.11, 31931.756), (12, 320.81, 34777.259), (9, 227.73, 1222.114), (8, 15.45, 16859.074)) AS v(a, b, c);
  -- JDE (tiempo terrestre) a UTC: menos ~70 s.
  jd := jde0 + 0.00001 * s / dl - 70 / 86400.0;
  RETURN (to_timestamp((jd - 2440587.5) * 86400) AT TIME ZONE 'America/Santiago')::date;
END;
$$;

-- Traslado de la Ley 19.668: martes a jueves al lunes de esa semana; viernes al lunes siguiente.
CREATE FUNCTION trasladar_al_lunes(p date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE extract(isodow FROM p)::int WHEN 2 THEN p - 1 WHEN 3 THEN p - 2 WHEN 4 THEN p - 3 WHEN 5 THEN p + 3 ELSE p END
$$;

CREATE FUNCTION feriados_legales(p_anio int) RETURNS TABLE (fecha date, nombre text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH f(fecha, nombre) AS (
    VALUES
      (make_date(p_anio, 1, 1), 'Año Nuevo'),
      (CASE WHEN extract(isodow FROM make_date(p_anio, 1, 1)) = 7 THEN make_date(p_anio, 1, 2) END, 'Feriado de Año Nuevo'),
      (pascua(p_anio) - 2, 'Viernes Santo'),
      (pascua(p_anio) - 1, 'Sábado Santo'),
      (make_date(p_anio, 5, 1), 'Día Nacional del Trabajo'),
      (make_date(p_anio, 5, 21), 'Día de las Glorias Navales'),
      (solsticio_invierno(p_anio), 'Día Nacional de los Pueblos Indígenas'),
      (trasladar_al_lunes(make_date(p_anio, 6, 29)), 'San Pedro y San Pablo'),
      (make_date(p_anio, 7, 16), 'Día de la Virgen del Carmen'),
      (make_date(p_anio, 8, 15), 'Asunción de la Virgen'),
      (CASE WHEN extract(isodow FROM make_date(p_anio, 9, 17)) IN (1, 5) THEN make_date(p_anio, 9, 17) END, 'Feriado adicional de Fiestas Patrias'),
      (make_date(p_anio, 9, 18), 'Independencia Nacional'),
      (make_date(p_anio, 9, 19), 'Día de las Glorias del Ejército'),
      (CASE WHEN extract(isodow FROM make_date(p_anio, 9, 20)) = 5 THEN make_date(p_anio, 9, 20) END, 'Feriado adicional de Fiestas Patrias'),
      (trasladar_al_lunes(make_date(p_anio, 10, 12)), 'Encuentro de Dos Mundos'),
      (CASE extract(isodow FROM make_date(p_anio, 10, 31))::int WHEN 2 THEN make_date(p_anio, 10, 27)
                                                                 WHEN 3 THEN make_date(p_anio, 11, 2)
                                                                 ELSE make_date(p_anio, 10, 31) END,
       'Día de las Iglesias Evangélicas y Protestantes'),
      (make_date(p_anio, 11, 1), 'Día de Todos los Santos'),
      (make_date(p_anio, 12, 8), 'Inmaculada Concepción'),
      (make_date(p_anio, 12, 25), 'Navidad')
  )
  SELECT fecha, nombre FROM f WHERE fecha IS NOT NULL ORDER BY fecha
$$;

-- Job (sin contexto): inserta los feriados de ley que falten. Idempotente;
-- un feriado quitado por el centro sigue en la tabla y no se revive.
CREATE FUNCTION generar_feriados(p_anio int) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n int;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de feriados' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO feriados (fecha, nombre, origen)
  SELECT fecha, nombre, 'LEY' FROM feriados_legales(p_anio)
  ON CONFLICT (fecha) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ADMIN: agrega un feriado puntual o regional (o repone uno quitado).
CREATE FUNCTION agregar_feriado(p_fecha date, p_nombre text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  f feriados%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Los feriados los administra un ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_fecha < (now() AT TIME ZONE 'America/Santiago')::date THEN
    RAISE EXCEPTION 'Solo se cambian feriados de hoy en adelante' USING ERRCODE = 'check_violation', CONSTRAINT = 'feriados_futuros';
  END IF;
  SELECT * INTO f FROM feriados WHERE fecha = p_fecha FOR UPDATE;
  IF FOUND AND f.quitado_en IS NULL THEN
    RAISE EXCEPTION 'Ese dia ya es feriado' USING ERRCODE = 'unique_violation', CONSTRAINT = 'feriados_pkey';
  ELSIF FOUND THEN
    UPDATE feriados SET quitado_en = NULL, quitado_por_id = NULL, nombre = btrim(p_nombre) WHERE fecha = p_fecha;
  ELSE
    INSERT INTO feriados (fecha, nombre, origen, creado_por_id) VALUES (p_fecha, btrim(p_nombre), 'CENTRO', app_usuario_id());
  END IF;
END;
$$;

-- ADMIN: quita un feriado (logico). El job no lo vuelve a poner.
CREATE FUNCTION quitar_feriado(p_fecha date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Los feriados los administra un ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_fecha < (now() AT TIME ZONE 'America/Santiago')::date THEN
    RAISE EXCEPTION 'Solo se cambian feriados de hoy en adelante' USING ERRCODE = 'check_violation', CONSTRAINT = 'feriados_futuros';
  END IF;
  UPDATE feriados SET quitado_en = now(), quitado_por_id = app_usuario_id() WHERE fecha = p_fecha AND quitado_en IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese dia no es feriado' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION dias_habiles_desde(p_desde date, p_dias integer) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v date := p_desde;
  n int := 0;
BEGIN
  WHILE n < p_dias LOOP
    v := v + 1;
    IF extract(isodow FROM v) < 6 AND NOT EXISTS (SELECT 1 FROM feriados WHERE fecha = v AND quitado_en IS NULL) THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION dias_habiles_restantes(p_hasta date) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM generate_series((now() AT TIME ZONE 'America/Santiago')::date + 1, p_hasta, interval '1 day') d
  WHERE extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM feriados f WHERE f.fecha = d::date AND f.quitado_en IS NULL)
$$;

REVOKE EXECUTE ON FUNCTION pascua(int), solsticio_invierno(int), trasladar_al_lunes(date), feriados_legales(int),
  generar_feriados(int), agregar_feriado(date, text), quitar_feriado(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION feriados_legales(int), generar_feriados(int), agregar_feriado(date, text), quitar_feriado(date) TO app_user;
-- feriados_legales es SECURITY INVOKER y llama a estas tres.
GRANT EXECUTE ON FUNCTION pascua(int), solsticio_invierno(int), trasladar_al_lunes(date) TO app_user;

-- Este año y el siguiente (los de 2026 ya cargados se mantienen).
SELECT generar_feriados(extract(year FROM now() AT TIME ZONE 'America/Santiago')::int);
SELECT generar_feriados(extract(year FROM now() AT TIME ZONE 'America/Santiago')::int + 1);
