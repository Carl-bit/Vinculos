-- =============================================================================
-- 03b-4.2: protocolo del centro (pendiente 5) y comision por paciente traido
-- por el centro (pendiente 6, C-10).
--
-- Protocolo: dos politicas versionadas mas (append-only, version la fija la
-- BD, publica ADMIN): PROTOCOLO_EQUIPO, documento interno que el equipo lee y
-- marca como leido (lecturas_protocolo, A; ADMIN/GESTION ven quien lo leyo),
-- y PROTOCOLO_PACIENTE, que el paciente adulto o su adulto responsable
-- confirma en el portal (aceptaciones_politica, como el consentimiento). El
-- del equipo no es publico: ni politica_vigente() sin contexto ni el SELECT
-- de pacientes y responsables lo entregan.
--
-- Comision: pacientes.traido_por_centro marca al paciente que llego por el
-- centro (solicitud del sitio publico: Match o Pedir hora, o alta por
-- ADMIN/GESTION). El centro fija la regla de esos pacientes: GENERAL (el
-- porcentaje de siempre), PORCENTAJE o MONTO_FIJO por sesion (tope: lo
-- cobrado de la sesion). El resto de los pacientes sigue con el porcentaje
-- general. Con GENERAL la liquidacion da exactamente lo mismo que antes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Protocolo del centro
-- -----------------------------------------------------------------------------

-- politicas (B): el protocolo interno solo lo lee el equipo.
DROP POLICY politicas_select ON politicas;
CREATE POLICY politicas_select ON politicas FOR SELECT TO app_user
  USING (tipo <> 'PROTOCOLO_EQUIPO' OR (SELECT app_rol()) IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'));

-- Sin contexto (portal publico) o con un rol de paciente, el protocolo
-- interno no existe.
CREATE OR REPLACE FUNCTION politica_vigente(p_tipo tipo_politica)
RETURNS TABLE (id uuid, version int, texto text, vigente_desde timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.version, p.texto, p.vigente_desde FROM politicas p
  WHERE p.tipo = p_tipo
    AND (p_tipo <> 'PROTOCOLO_EQUIPO' OR coalesce(app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'), false))
  ORDER BY p.version DESC LIMIT 1
$$;

-- Textos iniciales (el centro los reemplaza publicando una version nueva).
INSERT INTO politicas (tipo, texto) VALUES
  ('PROTOCOLO_EQUIPO', 'Protocolo interno del centro. 1) Registre la evolucion de cada sesion dentro de las 48 horas siguientes. 2) Ante riesgo vital, siga el plan de crisis del centro y avise a la direccion el mismo dia. 3) La ficha clinica es confidencial: no comparta datos de pacientes por canales personales. 4) Informe cancelaciones con al menos 24 horas de anticipacion para reagendar a sus pacientes. 5) Las derivaciones se hacen por la plataforma, nunca por cambio de profesional informal.'),
  ('PROTOCOLO_PACIENTE', 'Protocolo de atencion para pacientes. 1) Llegue 5 minutos antes de su hora; si llega tarde, la sesion termina a la hora agendada. 2) Si no puede asistir, avise dentro del plazo que fija el centro para no perder el valor de la sesion. 3) Las sesiones online requieren un lugar privado y una conexion estable. 4) El contacto con su profesional fuera de la sesion es por el formulario del portal. 5) En una emergencia, llame al 131 (SAMU) o acuda al servicio de urgencia mas cercano.');

-- lecturas_protocolo (A): quien del equipo leyo que version del protocolo
-- interno. Append-only; una lectura por persona y version.
CREATE TABLE "lecturas_protocolo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "politica_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "rol" "rol" NOT NULL,
    "leido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lecturas_protocolo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lecturas_protocolo_politica_id_usuario_id_key" ON "lecturas_protocolo"("politica_id", "usuario_id");
CREATE INDEX "lecturas_protocolo_usuario_id_idx" ON "lecturas_protocolo"("usuario_id");
ALTER TABLE "lecturas_protocolo" ADD CONSTRAINT "lecturas_protocolo_politica_id_fkey" FOREIGN KEY ("politica_id") REFERENCES "politicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lecturas_protocolo" ADD CONSTRAINT "lecturas_protocolo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER lecturas_protocolo_append_only BEFORE UPDATE OR DELETE ON lecturas_protocolo
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();

ALTER TABLE lecturas_protocolo ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecturas_protocolo FORCE ROW LEVEL SECURITY;
CREATE POLICY lecturas_protocolo_select ON lecturas_protocolo FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR usuario_id = (SELECT app_usuario_id()));
CREATE POLICY lecturas_protocolo_acceso_vigente ON lecturas_protocolo AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON lecturas_protocolo TO app_user;

-- Marca como leida la version vigente del protocolo interno (idempotente).
-- Devuelve cuando la leyo (la primera vez).
CREATE FUNCTION marcar_protocolo_leido() RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_politica uuid;
  v_leido timestamptz;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'El protocolo interno es del equipo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id INTO v_politica FROM politica_vigente('PROTOCOLO_EQUIPO');
  IF v_politica IS NULL THEN
    RAISE EXCEPTION 'El centro no tiene protocolo publicado' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO lecturas_protocolo (politica_id, usuario_id, rol)
  VALUES (v_politica, app_usuario_id(), app_rol()::rol)
  ON CONFLICT (politica_id, usuario_id) DO NOTHING;
  SELECT leido_en INTO v_leido FROM lecturas_protocolo WHERE politica_id = v_politica AND usuario_id = app_usuario_id();
  RETURN v_leido;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Paciente traido por el centro
-- -----------------------------------------------------------------------------
ALTER TABLE "pacientes" ADD COLUMN "traido_por_centro" BOOLEAN NOT NULL DEFAULT false;
UPDATE pacientes SET traido_por_centro = creado_por_solicitud WHERE creado_por_solicitud;

-- Lo fija la BD al crear: solicitud del sitio publico o alta por
-- ADMIN/GESTION. Sin contexto (dueño: seed, migraciones) respeta el valor.
-- Despues solo lo cambia ADMIN/GESTION (marcar_origen_paciente): sin GRANT
-- UPDATE de la columna.
CREATE FUNCTION fijar_origen_paciente() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.traido_por_centro := NEW.creado_por_solicitud
                           OR coalesce(app_rol() IN ('ADMIN', 'GESTION'), false)
                           OR (app_rol() IS NULL AND NEW.traido_por_centro);
  RETURN NEW;
END;
$$;
CREATE TRIGGER pacientes_origen BEFORE INSERT ON pacientes
  FOR EACH ROW EXECUTE FUNCTION fijar_origen_paciente();

CREATE FUNCTION marcar_origen_paciente(p_paciente_id uuid, p_traido boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION marcan el origen del paciente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_traido IS NULL THEN
    RAISE EXCEPTION 'Origen del paciente: si o no' USING ERRCODE = 'check_violation', CONSTRAINT = 'pacientes_origen';
  END IF;
  UPDATE pacientes SET traido_por_centro = p_traido WHERE id = p_paciente_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Regla de comision por derivacion del centro
-- -----------------------------------------------------------------------------
CREATE TYPE "tipo_comision_derivacion" AS ENUM ('GENERAL', 'PORCENTAJE', 'MONTO_FIJO');

ALTER TABLE "configuracion_centro"
ADD COLUMN "comision_derivacion_tipo" "tipo_comision_derivacion" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "comision_derivacion_valor" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_comision_derivacion
  CHECK (comision_derivacion_valor >= 0
         AND (comision_derivacion_tipo <> 'PORCENTAJE' OR comision_derivacion_valor <= 100)
         AND (comision_derivacion_tipo <> 'MONTO_FIJO'
              OR (comision_derivacion_valor = trunc(comision_derivacion_valor) AND comision_derivacion_valor <= 1000000)));
-- ADMIN (politica configuracion_centro_update).
GRANT UPDATE (comision_derivacion_tipo, comision_derivacion_valor) ON configuracion_centro TO app_user;

-- Comision del centro por una sesion de un paciente traido por el centro,
-- segun lo cobrado de esa sesion (interna: la usan liquidacion y reporte).
CREATE FUNCTION comision_derivacion_cita(p_cobrado numeric) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE cc.comision_derivacion_tipo
           WHEN 'PORCENTAJE' THEN greatest(p_cobrado, 0) * cc.comision_derivacion_valor / 100
           WHEN 'MONTO_FIJO' THEN least(cc.comision_derivacion_valor, greatest(p_cobrado, 0))
           ELSE greatest(p_cobrado, 0) * cc.comision_centro_porcentaje / 100
         END
  FROM configuracion_centro cc
$$;

-- liquidaciones: parte de la comision que viene de la regla de derivacion y
-- cuantas sesiones de pacientes traidos por el centro la generaron (0 con
-- GENERAL). `comision` sigue siendo el total (general + derivacion).
ALTER TABLE "liquidaciones"
ADD COLUMN "comision_derivacion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sesiones_derivadas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE liquidaciones ADD CONSTRAINT liquidaciones_comision_derivacion
  CHECK (comision_derivacion BETWEEN 0 AND comision AND sesiones_derivadas >= 0);

CREATE OR REPLACE FUNCTION proteger_liquidacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (OLD.estado <> 'BORRADOR' AND NOT (OLD.estado = 'EMITIDA' AND NEW.estado = 'PAGADA'
         AND (NEW.total_cobrado, NEW.comision, NEW.comision_derivacion, NEW.sesiones_derivadas, NEW.arriendos, NEW.total, NEW.emitida_en)
             IS NOT DISTINCT FROM (OLD.total_cobrado, OLD.comision, OLD.comision_derivacion, OLD.sesiones_derivadas, OLD.arriendos, OLD.total, OLD.emitida_en)))
     OR (NEW.id, NEW.profesional_id, NEW.periodo_desde, NEW.periodo_hasta, NEW.creada_en)
        IS DISTINCT FROM (OLD.id, OLD.profesional_id, OLD.periodo_desde, OLD.periodo_hasta, OLD.creada_en) THEN
    RAISE EXCEPTION 'Una liquidacion emitida no se modifica ni se borra' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Igual que 03a (pagos cobrados por el centro de citas liquidables del
-- periodo), con la comision separada por origen del paciente.
CREATE OR REPLACE FUNCTION generar_liquidacion(p_profesional_id uuid, p_desde date, p_hasta date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cobrado int;
  v_propio int;
  v_derivadas int;
  v_der numeric;
  v_pct numeric(5,2);
  v_tipo tipo_comision_derivacion;
  v_comision int;
  v_comision_der int;
  v_arriendos int;
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
  SELECT coalesce(sum(x.cobrado), 0), coalesce(sum(x.cobrado) FILTER (WHERE NOT x.traido), 0),
         count(*) FILTER (WHERE x.traido), coalesce(sum(comision_derivacion_cita(x.cobrado)) FILTER (WHERE x.traido), 0)
  INTO v_cobrado, v_propio, v_derivadas, v_der
  FROM (SELECT c.id, coalesce(pa.traido_por_centro, false) AS traido, sum(p.monto)::int AS cobrado
        FROM pagos p JOIN citas c ON c.id = p.cita_id
        LEFT JOIN pacientes pa ON pa.id = c.paciente_id
        WHERE c.profesional_id = p_profesional_id AND p.estado = 'REGISTRADO' AND p.cobrado_por = 'CENTRO'
          AND (c.inicio AT TIME ZONE 'America/Santiago')::date >= p_desde
          AND (c.inicio AT TIME ZONE 'America/Santiago')::date < p_hasta
          AND cita_liquidable(c.id)
        GROUP BY c.id, pa.traido_por_centro) x;
  SELECT comision_centro_porcentaje, comision_derivacion_tipo INTO v_pct, v_tipo FROM configuracion_centro;
  v_comision := round(greatest(v_propio, 0) * v_pct / 100 + v_der);
  IF v_tipo = 'GENERAL' THEN
    v_comision_der := 0;
    v_derivadas := 0;
  ELSE
    v_comision_der := least(round(v_der), v_comision);
  END IF;
  SELECT coalesce(sum(monto), 0) INTO v_arriendos FROM arriendos
  WHERE profesional_id = p_profesional_id AND periodo_desde >= p_desde AND periodo_desde < p_hasta;

  SELECT id, estado INTO v_id, v_estado FROM liquidaciones
  WHERE profesional_id = p_profesional_id AND periodo_desde = p_desde AND periodo_hasta = p_hasta FOR UPDATE;
  IF v_estado IS NOT NULL AND v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La liquidacion del periodo ya fue emitida' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO liquidaciones (profesional_id, periodo_desde, periodo_hasta, total_cobrado, comision_porcentaje, comision,
                               comision_derivacion, sesiones_derivadas, arriendos, total, creada_por_id)
    VALUES (p_profesional_id, p_desde, p_hasta, v_cobrado, v_pct, v_comision, v_comision_der, v_derivadas, v_arriendos,
            v_cobrado - v_comision - v_arriendos, app_usuario_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE liquidaciones SET total_cobrado = v_cobrado, comision_porcentaje = v_pct, comision = v_comision,
                             comision_derivacion = v_comision_der, sesiones_derivadas = v_derivadas,
                             arriendos = v_arriendos, total = v_cobrado - v_comision - v_arriendos
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- reporte_cobros (03a) con la comision estimada por origen del paciente.
-- Mismas columnas de salida.
CREATE OR REPLACE FUNCTION reporte_cobros(p_desde date, p_hasta date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ini timestamptz := p_desde::timestamp AT TIME ZONE 'America/Santiago';
  v_fin timestamptz := p_hasta::timestamp AT TIME ZONE 'America/Santiago';
  v_solo uuid := CASE WHEN app_rol() = 'PROFESIONAL' THEN app_usuario_id() END;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
    RAISE EXCEPTION 'reporte_cobros: ADMIN, GESTION o el propio profesional' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta <= p_desde OR p_hasta - p_desde > 366 THEN
    RAISE EXCEPTION 'Periodo invalido (maximo un año)' USING ERRCODE = 'check_violation', CONSTRAINT = 'reporte_cobros_periodo';
  END IF;
  RETURN jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'profesionales', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'profesional_id', x.profesional_id, 'nombre', x.nombre, 'sesiones', x.sesiones, 'cobrado', x.cobrado,
               'pendiente', x.pendiente,
               'comision_estimada', round(x.cobrado_propio * cc.comision_centro_porcentaje / 100 + x.comision_derivacion))
             ORDER BY x.nombre), '[]'::jsonb)
      FROM (SELECT c.profesional_id, coalesce(pf.nombre_publico, u.nombre) AS nombre,
                   count(*) FILTER (WHERE cita_realizada(c.id)) AS sesiones,
                   coalesce(sum(e.pagado), 0) AS cobrado,
                   coalesce(sum(e.pagado) FILTER (WHERE NOT coalesce(pa.traido_por_centro, false)), 0) AS cobrado_propio,
                   coalesce(sum(comision_derivacion_cita(e.pagado)) FILTER (WHERE pa.traido_por_centro), 0) AS comision_derivacion,
                   coalesce(sum(e.saldo) FILTER (WHERE cita_realizada(c.id)), 0) AS pendiente
            FROM citas c
            JOIN usuarios u ON u.id = c.profesional_id
            LEFT JOIN profesionales pf ON pf.usuario_id = u.id
            LEFT JOIN pacientes pa ON pa.id = c.paciente_id
            CROSS JOIN LATERAL (
              SELECT coalesce((SELECT sum(p.monto) FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO'), 0) AS pagado,
                     greatest(coalesce(r.monto_exigible, CASE WHEN c.estado = 'CANCELADA' THEN 0 ELSE coalesce(c.monto, 0) END)
                              - coalesce((SELECT sum(p.monto) FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO'), 0)
                              + coalesce(r.monto_devolucion, 0), 0) AS saldo
              FROM (SELECT 1) z LEFT JOIN resoluciones_cita r ON r.cita_id = c.id) e
            WHERE c.inicio >= v_ini AND c.inicio < v_fin AND (v_solo IS NULL OR c.profesional_id = v_solo)
            GROUP BY 1, 2) x
      CROSS JOIN configuracion_centro cc),
    'medios', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('medio', y.medio, 'pagos', y.n, 'monto', y.monto) ORDER BY y.n DESC), '[]'::jsonb)
      FROM (SELECT p.medio_pago AS medio, count(*) AS n, sum(p.monto) AS monto FROM pagos p JOIN citas c ON c.id = p.cita_id
            WHERE p.estado = 'REGISTRADO' AND c.inicio >= v_ini AND c.inicio < v_fin
              AND (v_solo IS NULL OR c.profesional_id = v_solo)
            GROUP BY 1) y));
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Permisos de funciones
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION comision_derivacion_cita(numeric), fijar_origen_paciente() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION marcar_protocolo_leido(), marcar_origen_paciente(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marcar_protocolo_leido(), marcar_origen_paciente(uuid, boolean) TO app_user;
