-- =============================================================================
-- 03b-3.3: pago tardio, morosidad y caja de la hora retenida.
--
-- Hora que agenda el equipo sin pago al vencer su plazo (horas configurables,
-- 12 por defecto): ya no se libera. Queda CONFIRMADA con pago en el centro:
-- la sesion ocurre y, si nadie paga, queda deuda.
--
-- Morosidad (la decide la BD): paciente con una sesion ya terminada (pasados
-- los dias de gracia del centro, 0 por defecto) con saldo > 0. Solo cuenta
-- con el modulo COBROS activo y para sesiones terminadas despues de
-- configuracion_centro.morosidad_desde (no vuelve morosos a pacientes por
-- sesiones anteriores a esta regla, que nunca se registraron en caja).
--   - Bloqueo: con bloquear_agenda_morosos, ninguna cita nueva para un
--     paciente moroso (equipo o portal): 23514 citas_paciente_moroso -> 422.
--     ADMIN/GESTION pueden autorizar una cita con motivo
--     (autorizar_cita_con_deuda: excepciones_morosidad, de un solo uso y en
--     la misma transaccion del INSERT). Reprogramar no crea cita: no se bloquea.
--   - Avisos (job avisar_deudas): una vez por sesion con saldo, al paciente
--     (bandeja y correo, tambien sin cuenta si tiene correo) y al profesional.
--   - Lista para el equipo: deudas_pacientes() y el conteo del inicio.
--
-- Inasistencia justificada: resolver_cita sobre una cita CONFIRMADA ya
-- terminada con TRASLADO (se reagenda, sin penalizacion) o DEVOLUCION (con la
-- penalizacion de la cancelacion tardia). Exige motivo. La no justificada
-- sigue siendo INASISTENCIA (cobro configurado, cuenta como deuda).
--
-- Hora retenida (reserva sin cuenta) desde el panel:
--   - cobrar_reserva_en_caja: solo presencial; el pago en caja que cubre lo
--     exigido la concreta (la API llama concretar_reserva en la misma
--     transaccion: paciente, ficha, cita CONFIRMADA). Cobra quien valida
--     transferencias de esa cita (GESTION/ADMIN o el profesional con cobro
--     directo).
--   - liberar_hora_retenida: ADMIN/GESTION con motivo; la reserva ya no se
--     concreta (ni por el enlace del correo ni por un pago tardio: queda para
--     devolucion).
--
-- Categorias: excepciones_morosidad = A (decision sobre el dinero de un
-- paciente; motivo administrativo en claro, como resoluciones_cita.motivo).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configuracion del centro
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "configuracion_centro" ADD COLUMN "horas_plazo_pago_equipo" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN "dias_gracia_morosidad" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bloquear_agenda_morosos" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "morosidad_desde" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_morosidad_valida
  CHECK (horas_plazo_pago_equipo BETWEEN 0 AND 168 AND dias_gracia_morosidad BETWEEN 0 AND 90);
-- morosidad_desde: sin GRANT (lo fija la migracion; el operador lo ajusta).
GRANT UPDATE (horas_plazo_pago_equipo, dias_gracia_morosidad, bloquear_agenda_morosos) ON configuracion_centro TO app_user;

-- Plazo del equipo: las horas configuradas antes de la sesion.
CREATE OR REPLACE FUNCTION plazo_pago_equipo(p_inicio timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_inicio - make_interval(hours => horas_plazo_pago_equipo) FROM configuracion_centro
$$;

-- -----------------------------------------------------------------------------
-- 2. Citas: columnas nuevas (las fija la BD)
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "citas" ADD COLUMN "aviso_deuda_en" TIMESTAMPTZ(6),
ADD COLUMN "liberada_por_id" UUID,
ADD COLUMN "motivo_liberacion" TEXT;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_liberada_por_id_fkey" FOREIGN KEY ("liberada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE citas ADD CONSTRAINT citas_liberacion_coherente
  CHECK ((liberada_por_id IS NULL) = (motivo_liberacion IS NULL)
         AND (liberada_por_id IS NULL OR (estado = 'LIBERADA' AND length(btrim(motivo_liberacion)) BETWEEN 3 AND 500)));

-- La API tampoco fija el aviso de deuda ni la liberacion manual.
CREATE OR REPLACE FUNCTION proteger_estado_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA') OR NEW.medio_confirmacion IS NOT NULL
       OR NEW.pago_vence_en IS NOT NULL OR NEW.ultimo_aviso_pago IS NOT NULL
       OR NEW.aviso_deuda_en IS NOT NULL OR NEW.liberada_por_id IS NOT NULL OR NEW.motivo_liberacion IS NOT NULL THEN
      RAISE EXCEPTION 'El estado de pago de la cita solo lo fija el flujo de confirmacion' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.estado = 'RETENIDA'
        OR NEW.medio_confirmacion IS DISTINCT FROM OLD.medio_confirmacion OR NEW.pago_vence_en IS DISTINCT FROM OLD.pago_vence_en
        OR NEW.ultimo_aviso_pago IS DISTINCT FROM OLD.ultimo_aviso_pago
        OR NEW.agendada_por_equipo IS DISTINCT FROM OLD.agendada_por_equipo
        OR NEW.aviso_deuda_en IS DISTINCT FROM OLD.aviso_deuda_en
        OR (NEW.liberada_por_id, NEW.motivo_liberacion) IS DISTINCT FROM (OLD.liberada_por_id, OLD.motivo_liberacion)
        OR (NEW.estado IS DISTINCT FROM OLD.estado
            AND (NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA') OR OLD.estado = 'LIBERADA'
                 OR (OLD.estado = 'PENDIENTE_PAGO' AND NEW.estado <> 'CANCELADA'))) THEN
    RAISE EXCEPTION 'El estado de pago de la cita solo lo fija el flujo de confirmacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Plazo vencido: la hora del equipo se mantiene (pago en el centro)
-- -----------------------------------------------------------------------------
-- Pendientes o retenidas con el plazo vencido. La del equipo (con paciente)
-- queda CONFIRMADA con pago en el centro (transferencia por validar: sigue
-- por validar). Si la agenda cambio y ya no cabe (bloqueo, box), se libera
-- con aviso como antes. El resto -> LIBERADA (la reserva sin paciente queda
-- EXPIRADA). Idempotente; SKIP LOCKED.
CREATE OR REPLACE FUNCTION liberar_reservas_vencidas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  v_n int := 0;
  v_liberar boolean;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    SELECT x.id, x.paciente_id, x.agendada_por_equipo, x.medio_confirmacion FROM citas x
    WHERE x.estado IN ('PENDIENTE_PAGO', 'RETENIDA') AND x.pago_vence_en <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    v_liberar := true;
    IF c.agendada_por_equipo AND c.paciente_id IS NOT NULL THEN
      BEGIN
        UPDATE citas SET estado = 'CONFIRMADA',
                         medio_confirmacion = CASE
                           WHEN c.medio_confirmacion = 'TRANSFERENCIA' AND EXISTS (
                                  SELECT 1 FROM transferencias t WHERE t.cita_id = c.id AND t.estado = 'POR_VALIDAR')
                             THEN 'TRANSFERENCIA'::medio_confirmacion
                           ELSE 'PAGO_EN_CENTRO' END,
                         updated_at = now()
        WHERE id = c.id;
        v_liberar := false;
      EXCEPTION WHEN check_violation OR exclusion_violation THEN
        RAISE NOTICE 'Cita % sin pago ya no cabe en la agenda: se libera', c.id;
      END;
    END IF;
    IF v_liberar THEN
      UPDATE citas SET estado = 'LIBERADA', updated_at = now() WHERE id = c.id;
      IF c.paciente_id IS NOT NULL THEN
        PERFORM encolar_notificacion('HORA_LIBERADA', c.paciente_id, NULL, c.id, NULL);
      END IF;
      UPDATE solicitudes_hora SET estado = 'EXPIRADA' WHERE cita_id = c.id AND estado = 'PENDIENTE_VERIFICACION';
    END IF;
    v_n := v_n + 1;
  END LOOP;
  -- Reservas anteriores a 03b-3.2 (retenidas con soft-lock, sin cita).
  WITH vencidas AS (
    UPDATE solicitudes_hora SET estado = 'EXPIRADA'
    WHERE estado = 'PENDIENTE_VERIFICACION' AND cita_id IS NULL AND expira_en <= now() RETURNING id
  )
  DELETE FROM bloqueos_temporales b USING vencidas v WHERE b.solicitud_id = v.id;
  RETURN v_n;
END;
$$;

-- El comprobante subido a tiempo en una hora del equipo sigue validandose
-- aunque la cita ya haya quedado confirmada por el vencimiento.
CREATE OR REPLACE FUNCTION validar_transferencia(p_cita_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  t transferencias%ROWTYPE;
  v_monto int;
  v_pago uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  SELECT * INTO t FROM transferencias WHERE cita_id = p_cita_id FOR UPDATE;
  IF t.id IS NULL OR NOT puede_validar_transferencia(c.profesional_id) THEN
    IF t.id IS NOT NULL AND acceso_vigente() AND app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
      RAISE EXCEPTION 'Valida GESTION/ADMIN (cobro del centro) o el profesional de la cita (cobro directo)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'Transferencia inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (c.estado IN ('PENDIENTE_PAGO', 'RETENIDA') OR (c.estado = 'CONFIRMADA' AND c.agendada_por_equipo AND t.estado = 'POR_VALIDAR'))
     OR t.estado = 'VALIDADA' THEN
    RAISE EXCEPTION 'La cita ya no espera esta transferencia' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  v_monto := monto_confirmacion(c.id);
  IF v_monto > 0 THEN
    INSERT INTO pagos (cita_id, monto, medio_pago, registrado_por_id, cobrado_por)
    VALUES (c.id, v_monto, 'TRANSFERENCIA', app_usuario_id(),
            CASE WHEN cobro_directo(c.profesional_id) THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO' END)
    RETURNING id INTO v_pago;
  END IF;
  UPDATE transferencias SET estado = 'VALIDADA', pago_id = v_pago, resuelta_por_id = app_usuario_id(), resuelta_en = now()
  WHERE id = t.id;
  IF c.estado = 'PENDIENTE_PAGO' THEN
    UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('PAGO_VALIDADO', c.paciente_id, NULL, c.id, NULL);
    PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
  ELSIF c.estado = 'CONFIRMADA' THEN
    PERFORM encolar_notificacion('PAGO_VALIDADO', c.paciente_id, NULL, c.id, NULL);
  END IF;
  RETURN v_pago;
END;
$$;

CREATE OR REPLACE FUNCTION rechazar_transferencia(p_cita_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  t transferencias%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  SELECT * INTO t FROM transferencias WHERE cita_id = p_cita_id FOR UPDATE;
  IF t.id IS NULL OR NOT puede_validar_transferencia(c.profesional_id) THEN
    IF t.id IS NOT NULL AND acceso_vigente() AND app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
      RAISE EXCEPTION 'Valida GESTION/ADMIN (cobro del centro) o el profesional de la cita (cobro directo)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'Transferencia inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (c.estado IN ('PENDIENTE_PAGO', 'RETENIDA') OR (c.estado = 'CONFIRMADA' AND c.agendada_por_equipo))
     OR t.estado <> 'POR_VALIDAR' THEN
    RAISE EXCEPTION 'La transferencia no esta por validar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE transferencias SET estado = 'RECHAZADA', motivo_rechazo = btrim(p_motivo), resuelta_por_id = app_usuario_id(),
                            resuelta_en = now()
  WHERE id = t.id;
  -- Pendiente: vuelve a correr el plazo (corto o el del equipo). Ya confirmada: se paga en el centro.
  IF c.estado <> 'CONFIRMADA' THEN
    UPDATE citas SET pago_vence_en = least(c.inicio, greatest(plazo_pago(c.inicio),
                                                              CASE WHEN c.agendada_por_equipo THEN plazo_pago_equipo(c.inicio) END)),
                     updated_at = now()
    WHERE id = c.id;
  ELSE
    UPDATE citas SET medio_confirmacion = 'PAGO_EN_CENTRO', updated_at = now() WHERE id = c.id;
  END IF;
  IF c.paciente_id IS NOT NULL THEN
    PERFORM encolar_notificacion('PAGO_RECHAZADO', c.paciente_id, NULL, c.id, NULL);
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Morosidad
-- -----------------------------------------------------------------------------
-- Sesiones terminadas con saldo (interna, sin RLS: la usan las reglas de la
-- BD). Mismo saldo que estado_pago_citas: exigible (resolucion o monto; la
-- cancelada sin decision no se cobra) menos lo pagado neto de devolucion.
CREATE FUNCTION deudas_vencidas(p_paciente_id uuid DEFAULT NULL)
RETURNS TABLE (cita_id uuid, paciente_id uuid, profesional_id uuid, fin timestamptz, saldo integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.paciente_id, c.profesional_id, c.fin, (x.exigible - (x.pagado - x.devolucion))::int
  FROM configuracion_centro cc
  JOIN citas c ON c.paciente_id IS NOT NULL AND c.estado IN ('CONFIRMADA', 'CANCELADA')
              AND c.fin > cc.morosidad_desde AND c.fin <= now() - make_interval(days => cc.dias_gracia_morosidad)
              AND (p_paciente_id IS NULL OR c.paciente_id = p_paciente_id)
  LEFT JOIN resoluciones_cita r ON r.cita_id = c.id
  CROSS JOIN LATERAL (
    SELECT coalesce(r.monto_exigible, CASE WHEN c.estado = 'CANCELADA' THEN 0 ELSE coalesce(c.monto, 0) END) AS exigible,
           coalesce((SELECT sum(p.monto) FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO'), 0)::int AS pagado,
           coalesce(r.monto_devolucion, 0) AS devolucion
  ) x
  WHERE 'COBROS' = ANY (cc.modulos_activos) AND x.exigible - (x.pagado - x.devolucion) > 0
$$;

CREATE FUNCTION paciente_moroso(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM deudas_vencidas(p_paciente_id))
$$;

-- Deudas por paciente para el equipo (C: solo agregados e ids; los nombres
-- los pone el panel con lo que su RLS ya le deja ver). ADMIN/GESTION todas;
-- PROFESIONAL las de sus citas.
CREATE FUNCTION deudas_pacientes()
RETURNS TABLE (paciente_id uuid, sesiones integer, saldo integer, desde timestamptz, citas uuid[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
    RAISE EXCEPTION 'deudas_pacientes: ADMIN, GESTION o PROFESIONAL' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT d.paciente_id, count(*)::int, sum(d.saldo)::int, min(d.fin), array_agg(d.cita_id ORDER BY d.fin)
  FROM deudas_vencidas() d
  WHERE app_rol() IN ('ADMIN', 'GESTION') OR d.profesional_id = app_usuario_id()
  GROUP BY d.paciente_id
  ORDER BY min(d.fin);
END;
$$;

-- CreateTable
CREATE TABLE "excepciones_morosidad" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "cita_id" UUID,
    "saldo" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "otorgada_por_id" UUID NOT NULL,
    "otorgada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "transaccion" BIGINT NOT NULL DEFAULT txid_current(),

    CONSTRAINT "excepciones_morosidad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "excepciones_morosidad_cita_id_key" ON "excepciones_morosidad"("cita_id");

-- CreateIndex
CREATE INDEX "excepciones_morosidad_paciente_id_idx" ON "excepciones_morosidad"("paciente_id");

-- AddForeignKey
ALTER TABLE "excepciones_morosidad" ADD CONSTRAINT "excepciones_morosidad_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey (diferida: el trigger BEFORE INSERT de citas la marca antes de que exista la fila)
ALTER TABLE "excepciones_morosidad" ADD CONSTRAINT "excepciones_morosidad_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE "excepciones_morosidad" ADD CONSTRAINT "excepciones_morosidad_otorgada_por_id_fkey" FOREIGN KEY ("otorgada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE excepciones_morosidad ADD CONSTRAINT excepciones_morosidad_coherente
  CHECK (saldo > 0 AND length(btrim(motivo)) BETWEEN 3 AND 500);

-- Append-only incluso dueño: solo se marca una vez la cita que la uso.
CREATE FUNCTION proteger_excepcion_morosidad() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.cita_id IS NOT NULL
     OR (NEW.id, NEW.paciente_id, NEW.saldo, NEW.motivo, NEW.otorgada_por_id, NEW.otorgada_en, NEW.transaccion)
        IS DISTINCT FROM (OLD.id, OLD.paciente_id, OLD.saldo, OLD.motivo, OLD.otorgada_por_id, OLD.otorgada_en, OLD.transaccion) THEN
    RAISE EXCEPTION 'excepciones_morosidad es append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER excepciones_morosidad_append_only BEFORE UPDATE OR DELETE ON excepciones_morosidad
  FOR EACH ROW EXECUTE FUNCTION proteger_excepcion_morosidad();

ALTER TABLE excepciones_morosidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE excepciones_morosidad FORCE ROW LEVEL SECURITY;
CREATE POLICY excepciones_morosidad_select ON excepciones_morosidad FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY excepciones_morosidad_acceso_vigente ON excepciones_morosidad AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON excepciones_morosidad TO app_user;

-- Autoriza (ADMIN/GESTION, con motivo) la proxima cita de un paciente moroso
-- en esta misma transaccion. Paciente sin deuda: no hace falta (nulo).
CREATE FUNCTION autorizar_cita_con_deuda(p_paciente_id uuid, p_motivo text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_saldo int;
  v_id uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION autorizan agendar con deuda' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pacientes WHERE id = p_paciente_id) THEN
    RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Autorizar con deuda exige motivo' USING ERRCODE = 'check_violation', CONSTRAINT = 'excepciones_morosidad_coherente';
  END IF;
  SELECT sum(saldo) INTO v_saldo FROM deudas_vencidas(p_paciente_id);
  IF coalesce(v_saldo, 0) = 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO excepciones_morosidad (paciente_id, saldo, motivo, otorgada_por_id)
  VALUES (p_paciente_id, v_saldo, btrim(p_motivo), app_usuario_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Cita nueva de un paciente moroso (con usuario: equipo o portal; el dueño,
-- el seed y los jobs no pasan por aqui). Usa la excepcion de esta transaccion
-- si la hay.
CREATE FUNCTION bloquear_cita_moroso() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.paciente_id IS NULL OR NEW.estado NOT IN ('CONFIRMADA', 'PENDIENTE_PAGO') OR app_usuario_id() IS NULL
     OR NOT EXISTS (SELECT 1 FROM configuracion_centro WHERE bloquear_agenda_morosos)
     OR NOT paciente_moroso(NEW.paciente_id) THEN
    RETURN NEW;
  END IF;
  UPDATE excepciones_morosidad SET cita_id = NEW.id
  WHERE id = (SELECT e.id FROM excepciones_morosidad e
              WHERE e.paciente_id = NEW.paciente_id AND e.transaccion = txid_current() AND e.cita_id IS NULL
              ORDER BY e.otorgada_en LIMIT 1);
  IF FOUND THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'El paciente tiene sesiones anteriores con pago pendiente: regularice en el centro antes de agendar'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_paciente_moroso';
END;
$$;
CREATE TRIGGER citas_paciente_moroso BEFORE INSERT ON citas
  FOR EACH ROW EXECUTE FUNCTION bloquear_cita_moroso();

-- Aviso de deuda: una vez por sesion con saldo, al paciente y al profesional
-- de la cita. Idempotente (aviso_deuda_en); SKIP LOCKED.
CREATE FUNCTION avisar_deudas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  v_n int := 0;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    SELECT x.id, x.paciente_id, x.profesional_id FROM citas x
    WHERE x.aviso_deuda_en IS NULL AND x.id IN (SELECT d.cita_id FROM deudas_vencidas() d)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE citas SET aviso_deuda_en = now() WHERE id = c.id;
    PERFORM encolar_notificacion('DEUDA_PENDIENTE', c.paciente_id, NULL, c.id, NULL);
    PERFORM encolar_notificacion('DEUDA_PENDIENTE', NULL, c.profesional_id, c.id, NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Inasistencia justificada
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "resoluciones_cita" ADD COLUMN "inasistencia_justificada" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE resoluciones_cita ADD CONSTRAINT resoluciones_cita_justificada
  CHECK (NOT inasistencia_justificada OR (decision <> 'INASISTENCIA' AND a_tiempo IS FALSE AND motivo IS NOT NULL));

-- Como 02h, mas:
--   - inasistencia justificada (cita CONFIRMADA ya terminada, con motivo):
--     TRASLADO se reagenda sin penalizacion; DEVOLUCION devuelve lo pagado
--     menos la penalizacion de la cancelacion tardia.
--   - TRASLADO tambien a una cita nueva pendiente de pago (la agenda el
--     equipo): si lo trasladado cubre lo exigido para confirmar, se confirma.
CREATE OR REPLACE FUNCTION resolver_cita(p_cita_id uuid, p_decision decision_cita, p_cita_nueva_id uuid, p_motivo text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cita citas%ROWTYPE;
  v_nueva citas%ROWTYPE;
  v_conf configuracion_centro%ROWTYPE;
  v_a_tiempo boolean;
  v_justificada boolean := false;
  v_porcentaje numeric(5,2) := 0;
  v_exigible int := 0;
  v_pagado int;
  v_saldo_nueva int;
  v_pago pagos%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION registran la decision de cobro' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_cita FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM resoluciones_cita WHERE cita_id = p_cita_id) THEN
    RAISE EXCEPTION 'La cita ya tiene una decision de cobro' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT * INTO v_conf FROM configuracion_centro;

  IF p_decision = 'INASISTENCIA' THEN
    IF v_cita.estado <> 'CONFIRMADA' OR v_cita.fin > now() THEN
      RAISE EXCEPTION 'Inasistencia solo de una cita confirmada ya terminada' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    v_porcentaje := v_conf.cobro_inasistencia_porcentaje;
  ELSIF v_cita.estado = 'CONFIRMADA' AND v_cita.fin <= now() THEN
    -- Inasistencia justificada: se trata como cancelacion tardia.
    IF btrim(coalesce(p_motivo, '')) = '' THEN
      RAISE EXCEPTION 'La inasistencia justificada exige motivo'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'resoluciones_cita_justificada';
    END IF;
    v_justificada := true;
    v_a_tiempo := false;
    IF p_decision = 'DEVOLUCION' THEN
      v_porcentaje := v_conf.penalizacion_cancelacion_porcentaje;
    END IF;
  ELSE
    IF v_cita.estado <> 'CANCELADA' THEN
      RAISE EXCEPTION 'La cita no esta cancelada' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    v_a_tiempo := v_cita.inicio - coalesce(v_cita.cancelada_en, v_cita.updated_at)
                  >= make_interval(hours => v_conf.plazo_aviso_cancelacion_horas);
    IF p_decision = 'DEVOLUCION' AND NOT v_a_tiempo THEN
      v_porcentaje := v_conf.penalizacion_cancelacion_porcentaje;
    END IF;
  END IF;
  v_exigible := round(coalesce(v_cita.monto, 0) * v_porcentaje / 100);

  IF p_decision = 'TRASLADO' THEN
    SELECT * INTO v_nueva FROM citas WHERE id = p_cita_nueva_id FOR UPDATE;
    IF NOT FOUND OR v_nueva.id = v_cita.id OR v_nueva.paciente_id <> v_cita.paciente_id
       OR v_nueva.estado NOT IN ('CONFIRMADA', 'PENDIENTE_PAGO') THEN
      RAISE EXCEPTION 'Traslado: indicar una cita nueva confirmada (o pendiente de pago) del mismo paciente'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'resoluciones_cita_coherente';
    END IF;
    SELECT saldo INTO v_saldo_nueva FROM estado_pago_citas WHERE cita_id = v_nueva.id;
    IF (SELECT coalesce(sum(monto), 0) FROM pagos WHERE cita_id = v_cita.id AND estado = 'REGISTRADO') > v_saldo_nueva THEN
      RAISE EXCEPTION 'Lo pagado supera el saldo de la cita nueva'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_sin_sobrepago';
    END IF;
    FOR v_pago IN SELECT * FROM pagos WHERE cita_id = v_cita.id AND estado = 'REGISTRADO' ORDER BY fecha LOOP
      UPDATE pagos SET estado = 'ANULADO', anulado_en = now(), anulado_por_id = app_usuario_id(),
                       motivo_anulacion = 'Traslado a la cita ' || v_nueva.id
      WHERE id = v_pago.id;
      INSERT INTO pagos (cita_id, monto, medio_pago, fecha, origen, cobrado_por, traslado_de_id, registrado_por_id)
      VALUES (v_nueva.id, v_pago.monto, v_pago.medio_pago, v_pago.fecha, 'TRASLADO', v_pago.cobrado_por, v_pago.id,
              app_usuario_id());
    END LOOP;
    IF v_nueva.estado = 'PENDIENTE_PAGO' AND monto_confirmacion(v_nueva.id) = 0 THEN
      UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = v_nueva.id;
      PERFORM encolar_notificacion('CITA_CONFIRMADA', v_nueva.paciente_id, NULL, v_nueva.id, NULL);
    END IF;
  END IF;

  SELECT coalesce(sum(monto), 0) INTO v_pagado FROM pagos WHERE cita_id = v_cita.id AND estado = 'REGISTRADO';
  INSERT INTO resoluciones_cita (cita_id, decision, a_tiempo, porcentaje, monto_exigible, monto_devolucion,
                                 cita_nueva_id, motivo, decidido_por_id, inasistencia_justificada)
  VALUES (v_cita.id, p_decision, v_a_tiempo, v_porcentaje, v_exigible, greatest(v_pagado - v_exigible, 0),
          CASE WHEN p_decision = 'TRASLADO' THEN v_nueva.id END, nullif(btrim(p_motivo), ''), app_usuario_id(), v_justificada)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Hora retenida desde el panel: caja (presencial) y liberacion manual
-- -----------------------------------------------------------------------------
-- Pago en caja de la hora retenida: cubre al menos lo exigido para confirmar
-- y no supera el monto. Deja el medio PAGO_EN_CENTRO; la API concreta la
-- reserva en la misma transaccion (concretar_reserva sin token).
CREATE FUNCTION cobrar_reserva_en_caja(p_cita_id uuid, p_monto integer, p_medio medio_pago) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  v_exigido int;
  v_pagado int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND OR NOT puede_validar_transferencia(c.profesional_id) THEN
    IF FOUND AND acceso_vigente() AND app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
      RAISE EXCEPTION 'Cobra GESTION/ADMIN (cobro del centro) o el profesional de la cita (cobro directo)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'RETENIDA' OR c.paciente_id IS NOT NULL OR c.pago_vence_en <= now() THEN
    RAISE EXCEPTION 'La hora ya no esta retenida por una reserva en curso' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF c.modalidad <> 'PRESENCIAL' THEN
    RAISE EXCEPTION 'La hora online se paga en linea o por transferencia, no en caja'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_caja_solo_presencial';
  END IF;
  v_exigido := monto_confirmacion(c.id);
  IF v_exigido = 0 THEN
    RAISE EXCEPTION 'No hay nada que cobrar: la reserva se confirma con el enlace del correo'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT coalesce(sum(monto), 0) INTO v_pagado FROM pagos WHERE cita_id = c.id AND estado = 'REGISTRADO';
  IF p_monto IS NULL OR p_monto < v_exigido OR p_monto > coalesce(c.monto, 0) - v_pagado THEN
    RAISE EXCEPTION 'El pago en caja debe cubrir lo exigido para confirmar (%) sin superar el monto (%)', v_exigido, coalesce(c.monto, 0) - v_pagado
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_caja_monto';
  END IF;
  INSERT INTO pagos (cita_id, monto, medio_pago, registrado_por_id, cobrado_por)
  VALUES (c.id, p_monto, p_medio, app_usuario_id(),
          CASE WHEN cobro_directo(c.profesional_id) THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO' END)
  RETURNING id INTO v_id;
  UPDATE citas SET medio_confirmacion = 'PAGO_EN_CENTRO', updated_at = now() WHERE id = c.id;
  RETURN v_id;
END;
$$;

-- Liberar a mano la hora retenida (ADMIN/GESTION, con motivo). No con un
-- comprobante por validar (primero se valida o rechaza).
CREATE FUNCTION liberar_hora_retenida(p_cita_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION liberan una hora retenida' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'RETENIDA' OR c.paciente_id IS NOT NULL THEN
    RAISE EXCEPTION 'La cita no es una hora retenida' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Liberar exige motivo' USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_liberacion_coherente';
  END IF;
  IF EXISTS (SELECT 1 FROM transferencias t WHERE t.cita_id = c.id AND t.estado = 'POR_VALIDAR' AND t.comprobante IS NOT NULL) THEN
    RAISE EXCEPTION 'Hay un comprobante por validar: valide o rechace la transferencia antes de liberar'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE citas SET estado = 'LIBERADA', liberada_por_id = app_usuario_id(), motivo_liberacion = btrim(p_motivo), updated_at = now()
  WHERE id = c.id;
  UPDATE solicitudes_hora SET estado = 'EXPIRADA' WHERE cita_id = c.id AND estado = 'PENDIENTE_VERIFICACION';
END;
$$;

-- La reserva liberada a mano ya no se concreta: ni por el enlace del correo
-- (verificacion tardia) ni por un pago tardio (queda para devolucion,
-- CONTACTAR_CENTRO). Se reescribe solo la condicion; si no aparece, falla.
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('concretar_reserva(uuid, bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz)'::regprocedure);
  nuevo := replace(def,
    $q$OR c.paciente_id IS NOT NULL OR c.estado NOT IN ('RETENIDA', 'LIBERADA') THEN$q$,
    $q$OR c.paciente_id IS NOT NULL OR c.estado NOT IN ('RETENIDA', 'LIBERADA') OR c.liberada_por_id IS NOT NULL THEN$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'concretar_reserva no trae la condicion esperada';
  END IF;
  EXECUTE nuevo;

  def := pg_get_functiondef('reserva_por_concretar(uuid)'::regprocedure);
  nuevo := replace(def,
    $q$IF c.paciente_id IS NOT NULL OR c.estado NOT IN ('RETENIDA', 'LIBERADA') OR monto_confirmacion(c.id) > 0$q$,
    $q$IF c.paciente_id IS NOT NULL OR c.estado NOT IN ('RETENIDA', 'LIBERADA') OR c.liberada_por_id IS NOT NULL OR monto_confirmacion(c.id) > 0$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'reserva_por_concretar no trae la condicion esperada';
  END IF;
  EXECUTE nuevo;

  -- Panel de inicio: pacientes con deuda (equipo: del centro; profesional: de sus citas).
  def := pg_get_functiondef('reporte_dashboard()'::regprocedure);
  nuevo := replace(def,
    $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'PENDIENTE_PAGO'),$q$,
    $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'PENDIENTE_PAGO'),
      'pacientes_con_deuda', CASE WHEN v_rol = 'PROFESIONAL'
                                  THEN (SELECT count(DISTINCT d.paciente_id) FROM deudas_vencidas() d WHERE d.profesional_id = v_yo) END,$q$);
  nuevo := replace(nuevo,
    $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE estado = 'PENDIENTE_PAGO'),$q$,
    $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE estado = 'PENDIENTE_PAGO'),
      'pacientes_con_deuda', (SELECT count(DISTINCT d.paciente_id) FROM deudas_vencidas() d),$q$);
  IF nuevo NOT LIKE '%pacientes_con_deuda%pacientes_con_deuda%' THEN
    RAISE EXCEPTION 'reporte_dashboard no trae las condiciones esperadas';
  END IF;
  EXECUTE nuevo;

  -- Mensajeria: el aviso de deuda va referido a su cita (fecha, hora, profesional).
  def := pg_get_functiondef('notificaciones_por_enviar(integer)'::regprocedure);
  nuevo := replace(def, $q$'PAGO_VALIDADO', 'PAGO_RECHAZADO', 'PAGO_PENDIENTE') THEN t.referencia_id$q$,
                        $q$'PAGO_VALIDADO', 'PAGO_RECHAZADO', 'PAGO_PENDIENTE', 'DEUDA_PENDIENTE') THEN t.referencia_id$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'notificaciones_por_enviar no trae la lista esperada';
  END IF;
  EXECUTE nuevo;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Mensajeria: aviso de deuda y texto del pago pendiente
-- -----------------------------------------------------------------------------
INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'DEUDA_PENDIENTE'::tipo_notificacion, e.destinatario::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('PACIENTE', 'Sesión con pago pendiente',
   'Hola {{nombre_paciente}}: su sesión del {{fecha}} a las {{hora}} con {{nombre_profesional}} tiene un saldo pendiente. Regularícelo en el centro para poder agendar su próxima hora. Detalle: {{enlace}}'),
  ('EQUIPO', 'Sesión con pago pendiente',
   'Hola {{nombre_profesional}}: la sesión del {{fecha}} a las {{hora}} quedó con saldo pendiente. Mientras no se regularice, el paciente no puede agendar una nueva hora: {{enlace}}')
) AS e(destinatario, asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);

-- El pago pendiente ya no libera la hora (solo se cambia la frase; un texto
-- personalizado por el centro no se toca).
UPDATE plantillas_mensaje
SET cuerpo = replace(cuerpo, 'Pague hasta 12 horas antes de la sesion para confirmarla; si no, la hora se libera.',
                     'Puede pagarla antes de la sesion; si no alcanza, pague en el centro el dia de la atencion.'),
    cuerpo_ejemplo = replace(cuerpo_ejemplo, 'Pague hasta 12 horas antes de la sesion para confirmarla; si no, la hora se libera.',
                             'Puede pagarla antes de la sesion; si no alcanza, pague en el centro el dia de la atencion.')
WHERE evento = 'PAGO_PENDIENTE';

-- -----------------------------------------------------------------------------
-- 8. Permisos de funciones
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  deudas_vencidas(uuid), paciente_moroso(uuid), bloquear_cita_moroso(), proteger_excepcion_morosidad()
FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION
  deudas_pacientes(), autorizar_cita_con_deuda(uuid, text), avisar_deudas(),
  cobrar_reserva_en_caja(uuid, integer, medio_pago), liberar_hora_retenida(uuid, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  deudas_pacientes(), autorizar_cita_con_deuda(uuid, text), avisar_deudas(),
  cobrar_reserva_en_caja(uuid, integer, medio_pago), liberar_hora_retenida(uuid, text)
TO app_user;
