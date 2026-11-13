-- =============================================================================
-- Configuracion (Opcion A submenu agrupado): horario del centro cerrado sin
-- dias, acuerdos por profesional y liquidacion segun el acuerdo.
--
-- 1. Horario del centro: sin filas = CERRADO (antes: sin restriccion). Los
--    boxes son espacios fisicos: sin dias de atencion nadie aparta box y, como
--    toda cita cae dentro de un bloque de box, nadie agenda. Un silo con
--    agenda ya en uso y sin horario recibe 7 dias de 00:00 a 24:00 (mismo
--    comportamiento que tenia); un silo nuevo parte cerrado y la cuenta madre
--    define sus dias en Configuracion. reporte_dashboard no cambia (la
--    capacidad de box del indicador solo difiere con el centro cerrado).
--
-- 2. acuerdos_profesional (A: dinero de una persona del equipo). Modelo por
--    profesional: A = DIRECTO (cobra el profesional y paga al centro por box,
--    cuota o captados), B = CENTRO (cobra el centro y liquida descontando su
--    comision), C = MIXTO (combina cuota fija, cargo por box y comisiones;
--    `cobra` dice quien cobra al paciente). Versionado y append-only: un
--    cambio rige desde su fecha y nunca dentro de un periodo ya liquidado
--    (EMITIDA o PAGADA). Sin acuerdo propio rige el del centro
--    (configuracion_centro: modelo_cobro, comisiones). Escritura solo via
--    registrar_acuerdo_profesional (ADMIN). Lee ADMIN/GESTION; el profesional
--    los suyos.
--
-- 3. cobro_directo(profesional): con acuerdo vigente decide su `cobra`; sin
--    acuerdo, la regla anterior (modelo del centro y adhesion en MIXTO).
--
-- 4. generar_liquidacion: comision y regla de captados del acuerdo vigente al
--    inicio del periodo; cuota fija (una por cada dia 1 de mes dentro del
--    periodo), uso de box (cargo por hora x horas de bloques apartados en el
--    periodo) y comision de captados cobrados por el profesional (modelo A o
--    C con cobro propio). total negativo = el profesional le debe al centro.
--    El IVA del arriendo de box lo factura el centro en su sistema (solo se
--    informa).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Horario del centro: sin filas = cerrado
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM horario_centro)
     AND (EXISTS (SELECT 1 FROM bloques_atencion) OR EXISTS (SELECT 1 FROM citas)) THEN
    INSERT INTO horario_centro (dia_semana, inicio_min, fin_min) SELECT d, 0, 1440 FROM generate_series(1, 7) d;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION en_horario_centro(p_inicio timestamptz, p_fin timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM horario_centro h, (SELECT (p_inicio AT TIME ZONE 'America/Santiago')::date AS dia) d
                 WHERE h.dia_semana = extract(isodow FROM d.dia)
                   AND p_inicio >= minuto_local(d.dia, h.inicio_min) AND p_fin <= minuto_local(d.dia, h.fin_min))
$$;

-- Horas libres de box y disponibilidad publica: sobre la definicion vigente
-- (03b31/03b32 ya las reescribieron), sin horario del centro no hay horas
-- (antes: todo el rango). Si el texto esperado no esta, la migracion falla.
DO $$
DECLARE
  f text;
  def text;
  nuevo text;
BEGIN
  FOREACH f IN ARRAY ARRAY['disponibilidad_espacios(timestamptz, timestamptz)', 'disponibilidad_publica(uuid, timestamptz, timestamptz)'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def, $q$ELSE tstzmultirange(tstzrange(desde, hasta, '[)')) END AS r$q$, $q$ELSE '{}'::tstzmultirange END AS r$q$);
    IF nuevo = def THEN
      RAISE EXCEPTION 'La funcion % no trae el horario del centro esperado', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Acuerdos por profesional (A)
-- -----------------------------------------------------------------------------
CREATE TYPE "cobrador_acuerdo" AS ENUM ('CENTRO', 'PROFESIONAL');

CREATE TABLE "acuerdos_profesional" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID NOT NULL,
    "modelo" "modelo_cobro" NOT NULL,
    "cobra" "cobrador_acuerdo" NOT NULL,
    "comision_porcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "comision_derivacion_tipo" "tipo_comision_derivacion" NOT NULL DEFAULT 'GENERAL',
    "comision_derivacion_valor" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cuota_mensual" INTEGER NOT NULL DEFAULT 0,
    "cargo_box_hora" INTEGER NOT NULL DEFAULT 0,
    "iva_box" BOOLEAN NOT NULL DEFAULT false,
    "vigente_desde" DATE NOT NULL,
    "creado_por_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acuerdos_profesional_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "acuerdos_profesional_profesional_id_vigente_desde_key" ON "acuerdos_profesional"("profesional_id", "vigente_desde");
ALTER TABLE "acuerdos_profesional" ADD CONSTRAINT "acuerdos_profesional_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "acuerdos_profesional" ADD CONSTRAINT "acuerdos_profesional_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A cobra el profesional, B el centro; C elige. Montos en pesos enteros.
ALTER TABLE acuerdos_profesional ADD CONSTRAINT acuerdos_profesional_validos CHECK (
  (modelo <> 'DIRECTO' OR cobra = 'PROFESIONAL') AND (modelo <> 'CENTRO' OR cobra = 'CENTRO')
  AND comision_porcentaje BETWEEN 0 AND 100
  AND comision_derivacion_valor >= 0
  AND (comision_derivacion_tipo <> 'PORCENTAJE' OR comision_derivacion_valor <= 100)
  AND (comision_derivacion_tipo <> 'MONTO_FIJO' OR comision_derivacion_valor = round(comision_derivacion_valor))
  AND (comision_derivacion_tipo <> 'GENERAL' OR comision_derivacion_valor = 0)
  AND cuota_mensual BETWEEN 0 AND 100000000 AND cargo_box_hora BETWEEN 0 AND 10000000);

CREATE TRIGGER acuerdos_profesional_append_only BEFORE UPDATE OR DELETE ON acuerdos_profesional
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();

ALTER TABLE acuerdos_profesional ENABLE ROW LEVEL SECURITY;
ALTER TABLE acuerdos_profesional FORCE ROW LEVEL SECURITY;
CREATE POLICY acuerdos_profesional_select ON acuerdos_profesional FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR (profesional_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) = 'PROFESIONAL'));
CREATE POLICY acuerdos_profesional_acceso_vigente ON acuerdos_profesional AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON acuerdos_profesional TO app_user;

-- Acuerdo que rige para un profesional en una fecha (el ultimo con
-- vigente_desde <= fecha). Sin fila = el del centro.
CREATE FUNCTION acuerdo_vigente(p_profesional_id uuid, p_fecha date) RETURNS acuerdos_profesional
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM acuerdos_profesional
  WHERE profesional_id = p_profesional_id AND vigente_desde <= p_fecha
  ORDER BY vigente_desde DESC LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION acuerdo_vigente(uuid, date) FROM PUBLIC;

-- Registra una version del acuerdo (ADMIN). Nunca dentro de un periodo ya
-- liquidado (emitido o pagado): lo liquidado no cambia.
CREATE FUNCTION registrar_acuerdo_profesional(
  p_profesional_id uuid, p_modelo modelo_cobro, p_cobra cobrador_acuerdo, p_comision_porcentaje numeric,
  p_derivacion_tipo tipo_comision_derivacion, p_derivacion_valor numeric, p_cuota_mensual int, p_cargo_box_hora int,
  p_iva_box boolean, p_vigente_desde date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() <> 'ADMIN' THEN
    RAISE EXCEPTION 'Solo la cuenta madre define acuerdos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT tiene_rol(p_profesional_id, 'PROFESIONAL') OR EXISTS (SELECT 1 FROM bajas WHERE usuario_id = p_profesional_id) THEN
    RAISE EXCEPTION 'El acuerdo es de un profesional vigente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'acuerdos_profesional_profesional';
  END IF;
  IF EXISTS (SELECT 1 FROM liquidaciones WHERE profesional_id = p_profesional_id AND estado <> 'BORRADOR'
             AND periodo_hasta > p_vigente_desde) THEN
    RAISE EXCEPTION 'Esa fecha cae en un periodo ya liquidado'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'acuerdos_profesional_periodo_liquidado';
  END IF;
  INSERT INTO acuerdos_profesional (profesional_id, modelo, cobra, comision_porcentaje, comision_derivacion_tipo,
                                    comision_derivacion_valor, cuota_mensual, cargo_box_hora, iva_box, vigente_desde, creado_por_id)
  VALUES (p_profesional_id, p_modelo, p_cobra, p_comision_porcentaje, p_derivacion_tipo,
          CASE WHEN p_derivacion_tipo = 'GENERAL' THEN 0 ELSE p_derivacion_valor END,
          p_cuota_mensual, p_cargo_box_hora, p_iva_box, p_vigente_desde, app_usuario_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION registrar_acuerdo_profesional(uuid, modelo_cobro, cobrador_acuerdo, numeric, tipo_comision_derivacion, numeric, int, int, boolean, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_acuerdo_profesional(uuid, modelo_cobro, cobrador_acuerdo, numeric, tipo_comision_derivacion, numeric, int, int, boolean, date) TO app_user;

-- -----------------------------------------------------------------------------
-- 3. Cobro directo: manda el acuerdo vigente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cobro_directo(p_profesional_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT a.cobra = 'PROFESIONAL' FROM acuerdo_vigente(p_profesional_id, (now() AT TIME ZONE 'America/Santiago')::date) a
     WHERE a.id IS NOT NULL),
    CASE (SELECT modelo_cobro FROM configuracion_centro)
      WHEN 'DIRECTO' THEN true
      WHEN 'MIXTO' THEN coalesce((SELECT cobro_directo FROM profesionales WHERE usuario_id = p_profesional_id), false)
      ELSE false
    END)
$$;

-- -----------------------------------------------------------------------------
-- 4. Liquidacion segun el acuerdo
-- -----------------------------------------------------------------------------
ALTER TABLE "liquidaciones" ADD COLUMN "acuerdo_id" UUID,
ADD COLUMN "cuota_fija" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "horas_box" DECIMAL(8,2) NOT NULL DEFAULT 0,
ADD COLUMN "uso_box" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "comision_cobro_propio" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_acuerdo_id_fkey" FOREIGN KEY ("acuerdo_id") REFERENCES "acuerdos_profesional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE liquidaciones DROP CONSTRAINT liquidaciones_coherente;
ALTER TABLE liquidaciones ADD CONSTRAINT liquidaciones_coherente
  CHECK (periodo_hasta > periodo_desde AND comision_porcentaje BETWEEN 0 AND 100
         AND cuota_fija >= 0 AND uso_box >= 0 AND horas_box >= 0 AND comision_cobro_propio >= 0
         AND total = total_cobrado - comision - arriendos - cuota_fija - uso_box - comision_cobro_propio
         AND (estado = 'BORRADOR') = (emitida_en IS NULL)
         AND (estado = 'PAGADA') = (pagada_en IS NOT NULL));

CREATE OR REPLACE FUNCTION proteger_liquidacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (OLD.estado <> 'BORRADOR' AND NOT (OLD.estado = 'EMITIDA' AND NEW.estado = 'PAGADA'
         AND (NEW.total_cobrado, NEW.cargos_liquidados, NEW.comision, NEW.comision_derivacion, NEW.sesiones_derivadas, NEW.arriendos,
              NEW.cuota_fija, NEW.horas_box, NEW.uso_box, NEW.comision_cobro_propio, NEW.acuerdo_id, NEW.total, NEW.emitida_en)
             IS NOT DISTINCT FROM (OLD.total_cobrado, OLD.cargos_liquidados, OLD.comision, OLD.comision_derivacion, OLD.sesiones_derivadas, OLD.arriendos,
              OLD.cuota_fija, OLD.horas_box, OLD.uso_box, OLD.comision_cobro_propio, OLD.acuerdo_id, OLD.total, OLD.emitida_en)))
     OR (NEW.id, NEW.profesional_id, NEW.periodo_desde, NEW.periodo_hasta, NEW.creada_en)
        IS DISTINCT FROM (OLD.id, OLD.profesional_id, OLD.periodo_desde, OLD.periodo_hasta, OLD.creada_en) THEN
    RAISE EXCEPTION 'Una liquidacion emitida no se modifica ni se borra' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Comision de una sesion de paciente captado segun una regla (tipo, valor y
-- comision general). Misma formula que comision_derivacion_cita.
CREATE FUNCTION comision_captado(p_cobrado numeric, p_tipo tipo_comision_derivacion, p_valor numeric, p_pct numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_tipo
           WHEN 'PORCENTAJE' THEN greatest(p_cobrado, 0) * p_valor / 100
           WHEN 'MONTO_FIJO' THEN least(p_valor, greatest(p_cobrado, 0))
           ELSE greatest(p_cobrado, 0) * p_pct / 100
         END
$$;
REVOKE EXECUTE ON FUNCTION comision_captado(numeric, tipo_comision_derivacion, numeric, numeric) FROM PUBLIC;

-- Igual que la version anterior (cargos, captados, arriendos), con la regla
-- del acuerdo vigente al inicio del periodo y sus cargos fijos.
CREATE OR REPLACE FUNCTION generar_liquidacion(p_profesional_id uuid, p_desde date, p_hasta date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_acuerdo acuerdos_profesional;
  v_cobrado int;
  v_cargos int;
  v_propio int;
  v_derivadas int;
  v_der numeric;
  v_pct numeric(5,2);
  v_tipo tipo_comision_derivacion;
  v_valor numeric;
  v_comision int;
  v_comision_der int;
  v_arriendos int;
  v_cuota int := 0;
  v_horas numeric := 0;
  v_box int := 0;
  v_cobro_propio int := 0;
  v_total int;
  v_id uuid;
  v_estado estado_liquidacion;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION liquidan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT tiene_rol(p_profesional_id, 'PROFESIONAL') OR p_hasta <= p_desde THEN
    RAISE EXCEPTION 'Liquidacion: un PROFESIONAL y un periodo valido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidaciones_coherente';
  END IF;
  v_acuerdo := acuerdo_vigente(p_profesional_id, p_desde);
  IF v_acuerdo.id IS NOT NULL THEN
    v_pct := v_acuerdo.comision_porcentaje;
    v_tipo := v_acuerdo.comision_derivacion_tipo;
    v_valor := v_acuerdo.comision_derivacion_valor;
  ELSE
    SELECT comision_centro_porcentaje, comision_derivacion_tipo, comision_derivacion_valor INTO v_pct, v_tipo, v_valor FROM configuracion_centro;
  END IF;

  SELECT coalesce(sum(x.cobrado), 0), coalesce(sum(x.cobrado) FILTER (WHERE x.es_cargo), 0),
         coalesce(sum(x.cobrado) FILTER (WHERE NOT x.traido), 0),
         count(*) FILTER (WHERE x.traido), coalesce(sum(comision_captado(x.cobrado, v_tipo, v_valor, v_pct)) FILTER (WHERE x.traido), 0)
  INTO v_cobrado, v_cargos, v_propio, v_derivadas, v_der
  FROM (SELECT c.id, coalesce(pa.traido_por_centro, false) AS traido, NOT cita_liquidable(c.id) AS es_cargo,
               CASE WHEN cita_liquidable(c.id) THEN sum(p.monto)::int ELSE cargo_cita(c.id) END AS cobrado
        FROM pagos p JOIN citas c ON c.id = p.cita_id
        LEFT JOIN pacientes pa ON pa.id = c.paciente_id
        WHERE c.profesional_id = p_profesional_id AND p.estado = 'REGISTRADO' AND p.cobrado_por = 'CENTRO'
          AND (c.inicio AT TIME ZONE 'America/Santiago')::date >= p_desde
          AND (c.inicio AT TIME ZONE 'America/Santiago')::date < p_hasta
          AND (cita_liquidable(c.id) OR cargo_cita(c.id) > 0)
        GROUP BY c.id, pa.traido_por_centro) x;
  v_comision := round(greatest(v_propio, 0) * v_pct / 100 + v_der);
  IF v_tipo = 'GENERAL' THEN
    v_comision_der := 0;
  ELSE
    v_comision_der := least(round(v_der), v_comision);
  END IF;
  SELECT coalesce(sum(monto), 0) INTO v_arriendos FROM arriendos
  WHERE profesional_id = p_profesional_id AND periodo_desde >= p_desde AND periodo_desde < p_hasta;

  IF v_acuerdo.id IS NOT NULL THEN
    -- Una cuota por cada dia 1 de mes dentro del periodo.
    SELECT v_acuerdo.cuota_mensual * count(*) INTO v_cuota
    FROM generate_series(date_trunc('month', p_desde::timestamp), p_hasta::timestamp - interval '1 day', interval '1 month') AS m(d)
    WHERE m.d::date >= p_desde AND m.d::date < p_hasta;
    -- Horas de box apartadas en el periodo (dias de Chile).
    SELECT coalesce(sum(extract(epoch FROM (least(b.fin, minuto_local(p_hasta, 0)) - greatest(b.inicio, minuto_local(p_desde, 0)))) / 3600), 0)
    INTO v_horas
    FROM bloques_atencion b
    WHERE b.profesional_id = p_profesional_id AND b.fin > minuto_local(p_desde, 0) AND b.inicio < minuto_local(p_hasta, 0);
    v_horas := round(v_horas, 2);
    v_box := round(v_horas * v_acuerdo.cargo_box_hora);
    -- Captados que cobro el propio profesional: le debe al centro la comision de captados.
    IF v_tipo <> 'GENERAL' THEN
      SELECT coalesce(round(sum(comision_captado(x.cobrado, v_tipo, v_valor, v_pct))), 0) INTO v_cobro_propio
      FROM (SELECT sum(p.monto)::int AS cobrado
            FROM pagos p JOIN citas c ON c.id = p.cita_id JOIN pacientes pa ON pa.id = c.paciente_id
            WHERE c.profesional_id = p_profesional_id AND p.estado = 'REGISTRADO' AND p.cobrado_por = 'PROFESIONAL'
              AND pa.traido_por_centro
              AND (c.inicio AT TIME ZONE 'America/Santiago')::date >= p_desde
              AND (c.inicio AT TIME ZONE 'America/Santiago')::date < p_hasta
              AND cita_liquidable(c.id)
            GROUP BY c.id) x;
    END IF;
  END IF;
  IF v_tipo = 'GENERAL' THEN
    v_derivadas := 0;
  END IF;
  v_total := v_cobrado - v_comision - v_arriendos - v_cuota - v_box - v_cobro_propio;

  SELECT id, estado INTO v_id, v_estado FROM liquidaciones
  WHERE profesional_id = p_profesional_id AND periodo_desde = p_desde AND periodo_hasta = p_hasta FOR UPDATE;
  IF v_estado IS NOT NULL AND v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La liquidacion del periodo ya fue emitida' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO liquidaciones (profesional_id, periodo_desde, periodo_hasta, total_cobrado, cargos_liquidados, comision_porcentaje, comision,
                               comision_derivacion, sesiones_derivadas, arriendos, acuerdo_id, cuota_fija, horas_box, uso_box,
                               comision_cobro_propio, total, creada_por_id)
    VALUES (p_profesional_id, p_desde, p_hasta, v_cobrado, v_cargos, v_pct, v_comision, v_comision_der, v_derivadas, v_arriendos,
            v_acuerdo.id, v_cuota, v_horas, v_box, v_cobro_propio, v_total, app_usuario_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE liquidaciones SET total_cobrado = v_cobrado, cargos_liquidados = v_cargos, comision_porcentaje = v_pct, comision = v_comision,
                             comision_derivacion = v_comision_der, sesiones_derivadas = v_derivadas, arriendos = v_arriendos,
                             acuerdo_id = v_acuerdo.id, cuota_fija = v_cuota, horas_box = v_horas, uso_box = v_box,
                             comision_cobro_propio = v_cobro_propio, total = v_total
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;
