-- =============================================================================
-- AUD-01 (E2.3a; ARCOP-01; decision D1): registro de solicitudes de derechos
-- de los titulares (Ley 21.719) con plazo en dias HABILES.
--
-- * feriados (B): dias no habiles de Chile. Los carga el operador por año
--   (sin GRANT de escritura a la API); la migracion trae los de 2026. Antes
--   de cada año: docs/cumplimiento/derechos_titulares.md.
-- * dias_habiles_desde(fecha, n): fecha + n dias habiles (sin sabados,
--   domingos ni feriados).
-- * solicitudes_derechos (A): tipo, titular (paciente si se identifico),
--   canal, estado, recibida, vence (30 dias habiles), detalle y respuesta
--   cifrados (CLINICO: pueden traer datos de salud; id lo da la API).
--   Solo ADMIN la lee y escribe, solo via funciones.
-- * Job alertar_solicitudes_por_vencer: alerta interna cuando faltan 5 dias
--   habiles o menos (una por solicitud).
-- =============================================================================

-- 1. Feriados (B)
-- CreateTable
CREATE TABLE "feriados" (
    "fecha" DATE NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "feriados_pkey" PRIMARY KEY ("fecha")
);
COMMENT ON TABLE feriados IS 'Categoria B. Feriados de Chile (dias no habiles). Los carga el operador por año.';
ALTER TABLE feriados ENABLE ROW LEVEL SECURITY;
ALTER TABLE feriados FORCE ROW LEVEL SECURITY;
CREATE POLICY feriados_select ON feriados FOR SELECT TO app_user USING (true);
CREATE POLICY feriados_acceso_vigente ON feriados AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON feriados TO app_user;

-- Feriados legales 2026 (verificar contra el calendario oficial al cargar cada año).
INSERT INTO feriados (fecha, nombre) VALUES
  ('2026-01-01', 'Año Nuevo'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-04-04', 'Sábado Santo'),
  ('2026-05-01', 'Día Nacional del Trabajo'),
  ('2026-05-21', 'Día de las Glorias Navales'),
  ('2026-06-21', 'Día Nacional de los Pueblos Indígenas'),
  ('2026-06-29', 'San Pedro y San Pablo'),
  ('2026-07-16', 'Día de la Virgen del Carmen'),
  ('2026-08-15', 'Asunción de la Virgen'),
  ('2026-09-18', 'Independencia Nacional'),
  ('2026-09-19', 'Día de las Glorias del Ejército'),
  ('2026-10-12', 'Encuentro de Dos Mundos'),
  ('2026-10-31', 'Día de las Iglesias Evangélicas y Protestantes'),
  ('2026-11-01', 'Día de Todos los Santos'),
  ('2026-12-08', 'Inmaculada Concepción'),
  ('2026-12-25', 'Navidad');

CREATE FUNCTION dias_habiles_desde(p_desde date, p_dias integer) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v date := p_desde;
  n int := 0;
BEGIN
  WHILE n < p_dias LOOP
    v := v + 1;
    IF extract(isodow FROM v) < 6 AND NOT EXISTS (SELECT 1 FROM feriados WHERE fecha = v) THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN v;
END;
$$;

-- Dias habiles entre hoy (Chile) y una fecha (0 si ya paso).
CREATE FUNCTION dias_habiles_restantes(p_hasta date) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM generate_series((now() AT TIME ZONE 'America/Santiago')::date + 1, p_hasta, interval '1 day') d
  WHERE extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM feriados f WHERE f.fecha = d::date)
$$;

-- 2. Solicitudes de derechos (A)
CREATE TYPE "tipo_derecho" AS ENUM ('ACCESO', 'RECTIFICACION', 'CANCELACION', 'OPOSICION', 'PORTABILIDAD', 'BLOQUEO');
CREATE TYPE "canal_solicitud_derecho" AS ENUM ('PRESENCIAL', 'CORREO', 'PORTAL', 'FORMULARIO_PUBLICO');
CREATE TYPE "estado_solicitud_derecho" AS ENUM ('RECIBIDA', 'EN_CURSO', 'RESUELTA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "solicitudes_derechos" (
    "id" UUID NOT NULL,
    "tipo" "tipo_derecho" NOT NULL,
    "paciente_id" UUID,
    "canal" "canal_solicitud_derecho" NOT NULL,
    "estado" "estado_solicitud_derecho" NOT NULL DEFAULT 'RECIBIDA',
    "recibida_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_el" DATE NOT NULL,
    "detalle" BYTEA,
    "respuesta" BYTEA,
    "registrada_por_id" UUID,
    "resuelta_en" TIMESTAMPTZ(6),
    "resuelta_por_id" UUID,

    CONSTRAINT "solicitudes_derechos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "solicitudes_derechos_estado_vence_el_idx" ON "solicitudes_derechos"("estado", "vence_el");
CREATE INDEX "solicitudes_derechos_paciente_id_idx" ON "solicitudes_derechos"("paciente_id");
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "solicitudes_derechos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "solicitudes_derechos_registrada_por_id_fkey" FOREIGN KEY ("registrada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "solicitudes_derechos" ADD CONSTRAINT "solicitudes_derechos_resuelta_por_id_fkey" FOREIGN KEY ("resuelta_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE solicitudes_derechos ADD CONSTRAINT solicitudes_derechos_cifrado
  CHECK ((detalle IS NULL OR octet_length(detalle) >= 49) AND (respuesta IS NULL OR octet_length(respuesta) >= 49));
ALTER TABLE solicitudes_derechos ADD CONSTRAINT solicitudes_derechos_estado_coherente
  CHECK ((estado IN ('RESUELTA', 'RECHAZADA')) = (resuelta_en IS NOT NULL AND resuelta_por_id IS NOT NULL)
         AND (estado NOT IN ('RESUELTA', 'RECHAZADA') OR respuesta IS NOT NULL));
COMMENT ON TABLE solicitudes_derechos IS
  'Categoria A. Solicitudes de derechos de titulares (Ley 21.719): tipo, titular, canal, estado y plazo en dias habiles. Detalle y respuesta cifrados. Solo ADMIN.';

-- Append-only salvo el avance de estado (via funcion).
CREATE FUNCTION proteger_solicitud_derecho() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.estado IN ('RESUELTA', 'RECHAZADA')
     OR (NEW.id, NEW.tipo, NEW.paciente_id, NEW.canal, NEW.recibida_en, NEW.vence_el, NEW.detalle, NEW.registrada_por_id)
        IS DISTINCT FROM (OLD.id, OLD.tipo, OLD.paciente_id, OLD.canal, OLD.recibida_en, OLD.vence_el, OLD.detalle, OLD.registrada_por_id) THEN
    RAISE EXCEPTION 'solicitudes_derechos: solo avanza el estado' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER solicitudes_derechos_append_only BEFORE UPDATE OR DELETE ON solicitudes_derechos
  FOR EACH ROW EXECUTE FUNCTION proteger_solicitud_derecho();

ALTER TABLE solicitudes_derechos ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_derechos FORCE ROW LEVEL SECURITY;
CREATE POLICY solicitudes_derechos_select ON solicitudes_derechos FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY solicitudes_derechos_acceso_vigente ON solicitudes_derechos AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON solicitudes_derechos TO app_user;

-- Registra (ADMIN): el plazo lo fija la BD (30 dias habiles desde la recepcion).
CREATE FUNCTION registrar_solicitud_derecho(p_id uuid, p_tipo tipo_derecho, p_paciente_id uuid, p_canal canal_solicitud_derecho,
                                            p_detalle bytea) RETURNS date
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_vence date := dias_habiles_desde((now() AT TIME ZONE 'America/Santiago')::date, 30);
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Registra la solicitud un ADMIN del centro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_canal = 'FORMULARIO_PUBLICO' THEN
    RAISE EXCEPTION 'El formulario publico registra por su propia via' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'solicitudes_derechos_canal';
  END IF;
  IF p_paciente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pacientes WHERE id = p_paciente_id) THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO solicitudes_derechos (id, tipo, paciente_id, canal, vence_el, detalle, registrada_por_id)
  VALUES (p_id, p_tipo, p_paciente_id, p_canal, v_vence, p_detalle, app_usuario_id());
  RETURN v_vence;
END;
$$;

-- Avanza (ADMIN): RECIBIDA -> EN_CURSO -> RESUELTA o RECHAZADA (con respuesta).
CREATE FUNCTION avanzar_solicitud_derecho(p_id uuid, p_estado estado_solicitud_derecho, p_respuesta bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s solicitudes_derechos%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Gestiona la solicitud un ADMIN del centro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM solicitudes_derechos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF s.estado IN ('RESUELTA', 'RECHAZADA') OR p_estado = 'RECIBIDA' OR (p_estado = 'EN_CURSO' AND s.estado <> 'RECIBIDA') THEN
    RAISE EXCEPTION 'La solicitud no puede pasar de % a %', s.estado, p_estado USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_estado IN ('RESUELTA', 'RECHAZADA') AND p_respuesta IS NULL THEN
    RAISE EXCEPTION 'Cerrar la solicitud exige la respuesta al titular'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_derechos_estado_coherente';
  END IF;
  UPDATE solicitudes_derechos SET estado = p_estado, respuesta = coalesce(p_respuesta, respuesta),
         resuelta_en = CASE WHEN p_estado IN ('RESUELTA', 'RECHAZADA') THEN now() END,
         resuelta_por_id = CASE WHEN p_estado IN ('RESUELTA', 'RECHAZADA') THEN app_usuario_id() END
  WHERE id = p_id;
  -- La alerta de plazo deja de tener sentido al cerrar.
  IF p_estado IN ('RESUELTA', 'RECHAZADA') THEN
    UPDATE alertas_internas SET atendida_en = now(), atendida_por_id = app_usuario_id()
    WHERE tipo = 'SOLICITUD_DERECHO_POR_VENCER' AND referencia_id = p_id AND atendida_en IS NULL;
  END IF;
END;
$$;

-- Job (sin contexto): alerta cuando faltan 5 dias habiles o menos. Idempotente.
CREATE FUNCTION alertar_solicitudes_por_vencer() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n int;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de alertas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO alertas_internas (tipo, referencia_id, detalle)
  SELECT 'SOLICITUD_DERECHO_POR_VENCER', s.id,
         format('Solicitud de %s vence el %s (%s dias habiles).', lower(s.tipo::text), to_char(s.vence_el, 'DD-MM-YYYY'),
                dias_habiles_restantes(s.vence_el))
  FROM solicitudes_derechos s
  WHERE s.estado IN ('RECIBIDA', 'EN_CURSO') AND dias_habiles_restantes(s.vence_el) <= 5
  ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION dias_habiles_desde(date, integer), dias_habiles_restantes(date),
  registrar_solicitud_derecho(uuid, tipo_derecho, uuid, canal_solicitud_derecho, bytea),
  avanzar_solicitud_derecho(uuid, estado_solicitud_derecho, bytea), alertar_solicitudes_por_vencer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dias_habiles_restantes(date),
  registrar_solicitud_derecho(uuid, tipo_derecho, uuid, canal_solicitud_derecho, bytea),
  avanzar_solicitud_derecho(uuid, estado_solicitud_derecho, bytea), alertar_solicitudes_por_vencer() TO app_user;
