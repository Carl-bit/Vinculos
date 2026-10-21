-- =============================================================================
-- 03b-3.4: la deuda se paga en linea, enlace de pago sin cuenta y cobro
-- presencial por el profesional.
--
-- Deuda pagable (deuda_pagable): sesion CONFIRMADA o CANCELADA del paciente,
-- ya terminada, con saldo > 0 y el modulo COBROS activo. Se paga con los
-- medios en linea del centro (TRANSFERENCIA, PASARELA), igual que el pago
-- para confirmar: mismas funciones (estado_pago_cita, elegir_medio_cita,
-- datos_transferencia, guardar_comprobante, validar/rechazar_transferencia,
-- iniciar/confirmar_cobro_pasarela), con el estado SALDO_PENDIENTE y el
-- monto = saldo. El medio elegido queda en citas.medio_saldo (no toca el
-- medio con que se confirmo). Pago registrado: aviso PAGO_REGISTRADO.
--
-- Transferencias: una cita puede tener mas de una (la de confirmacion ya
-- validada y despues la del saldo). Indice unico parcial: a lo mas una
-- abierta (no VALIDADA) por cita. transferencias.de_saldo marca la del saldo.
--
-- Enlace de pago sin cuenta (tokens_correo PAGO_CITA): el job de mensajes lo
-- emite al armar un correo de pago (PAGO_PENDIENTE, DEUDA_PENDIENTE,
-- PAGO_RECHAZADO, INSTRUCCIONES_TRANSFERENCIA) para un paciente sin cuenta
-- activa (ni la suya ni la de su adulto responsable). Varios usos hasta
-- vencer (30 dias); solo autoriza ver el estado y pagar ESA cita, sin datos
-- personales. Funciones *_enlace como las de la reserva sin cuenta.
--
-- Cobro presencial (decision del usuario, 2026-10-20): en la consulta el
-- paciente suele pagarle al profesional, que lleva el dinero y registra el
-- pago. El profesional de la cita puede registrar pagos de sus citas y
-- cobrar en caja su hora retenida en cualquier modelo de cobro; cobrado_por
-- sigue el modelo (CENTRO: el dinero es del centro y el profesional lo
-- entrega). Anular sigue siendo de ADMIN/GESTION.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas e indices
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "citas" ADD COLUMN "medio_saldo" "medio_confirmacion";

-- AlterTable
ALTER TABLE "transferencias" ADD COLUMN "de_saldo" BOOLEAN NOT NULL DEFAULT false;

-- DropIndex
DROP INDEX "transferencias_cita_id_key";

-- CreateIndex
CREATE INDEX "transferencias_cita_id_idx" ON "transferencias"("cita_id");

-- A lo mas una transferencia abierta por cita (la validada queda como historial).
CREATE UNIQUE INDEX transferencias_una_abierta ON transferencias (cita_id) WHERE estado <> 'VALIDADA';

-- La API tampoco fija el medio del saldo.
CREATE OR REPLACE FUNCTION proteger_estado_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA') OR NEW.medio_confirmacion IS NOT NULL
       OR NEW.pago_vence_en IS NOT NULL OR NEW.ultimo_aviso_pago IS NOT NULL OR NEW.medio_saldo IS NOT NULL
       OR NEW.aviso_deuda_en IS NOT NULL OR NEW.liberada_por_id IS NOT NULL OR NEW.motivo_liberacion IS NOT NULL THEN
      RAISE EXCEPTION 'El estado de pago de la cita solo lo fija el flujo de confirmacion' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.estado = 'RETENIDA'
        OR NEW.medio_confirmacion IS DISTINCT FROM OLD.medio_confirmacion OR NEW.pago_vence_en IS DISTINCT FROM OLD.pago_vence_en
        OR NEW.ultimo_aviso_pago IS DISTINCT FROM OLD.ultimo_aviso_pago
        OR NEW.agendada_por_equipo IS DISTINCT FROM OLD.agendada_por_equipo
        OR NEW.aviso_deuda_en IS DISTINCT FROM OLD.aviso_deuda_en
        OR NEW.medio_saldo IS DISTINCT FROM OLD.medio_saldo
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
-- 2. Saldo y deuda pagable (internas)
-- -----------------------------------------------------------------------------
-- Saldo de una cita sin RLS (mismo calculo que estado_pago_citas).
CREATE FUNCTION saldo_cita(p_cita_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT greatest(coalesce(r.monto_exigible, CASE WHEN c.estado IN ('CANCELADA', 'LIBERADA') THEN 0 ELSE coalesce(c.monto, 0) END)
                  - (coalesce((SELECT sum(p.monto) FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO'), 0)
                     - coalesce(r.monto_devolucion, 0)), 0)::int
  FROM citas c LEFT JOIN resoluciones_cita r ON r.cita_id = c.id
  WHERE c.id = p_cita_id
$$;

-- Sesion ya terminada con saldo, que se puede pagar en linea.
CREATE FUNCTION deuda_pagable(p_cita_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT c.paciente_id IS NOT NULL AND c.estado IN ('CONFIRMADA', 'CANCELADA') AND c.fin <= now()
                          AND 'COBROS' = ANY (cc.modulos_activos) AND saldo_cita(c.id) > 0
                   FROM citas c CROSS JOIN configuracion_centro cc WHERE c.id = p_cita_id), false)
$$;

-- Medios habilitados que se pagan en linea (sin pago en el centro).
CREATE FUNCTION medios_en_linea() RETURNS medio_confirmacion[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(m ORDER BY m), ARRAY[]::medio_confirmacion[])
  FROM unnest(medios_confirmacion_vigentes()) m WHERE m <> 'PAGO_EN_CENTRO'
$$;

-- Registra pagos presenciales: ADMIN/GESTION o el profesional de la cita.
CREATE FUNCTION puede_cobrar_presencial(p_profesional_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT acceso_vigente() AND (app_rol() IN ('ADMIN', 'GESTION')
                               OR (app_rol() = 'PROFESIONAL' AND app_usuario_id() = p_profesional_id))
$$;

-- -----------------------------------------------------------------------------
-- 3. Flujo de pago: confirmacion (como 03b-3.2/3.3) y saldo de la deuda
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION estado_pago_cita(p_cita_id uuid)
RETURNS TABLE (estado text, vence_en timestamptz, siguiente text, medios medio_confirmacion[], medio medio_confirmacion,
               monto integer, comprobante_recibido boolean, motivo_rechazo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
  t transferencias%ROWTYPE;
  v_estado text;
  v_pendiente boolean;
  v_medios medio_confirmacion[];
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id;
  -- La transferencia abierta (si la hay); si no, la ultima.
  SELECT * INTO t FROM transferencias x WHERE x.cita_id = p_cita_id ORDER BY (x.estado = 'VALIDADA'), x.creada_en DESC LIMIT 1;
  IF deuda_pagable(c.id) THEN
    v_medios := medios_en_linea();
    RETURN QUERY SELECT
      'SALDO_PENDIENTE'::text,
      NULL::timestamptz,
      CASE
        WHEN cardinality(v_medios) = 0 THEN 'PAGAR_EN_CENTRO'
        WHEN c.medio_saldo IS NULL OR NOT c.medio_saldo = ANY (v_medios) THEN 'ELEGIR_MEDIO'
        WHEN c.medio_saldo = 'TRANSFERENCIA' AND t.estado = 'RECHAZADA' THEN 'TRANSFERENCIA_RECHAZADA'
        WHEN c.medio_saldo = 'TRANSFERENCIA' THEN 'ESPERAR_VALIDACION'
        ELSE 'PAGAR_EN_LINEA'
      END,
      v_medios,
      c.medio_saldo,
      saldo_cita(c.id),
      t.estado IS DISTINCT FROM 'VALIDADA' AND t.comprobante IS NOT NULL,
      CASE WHEN t.estado = 'RECHAZADA' THEN t.motivo_rechazo END;
    RETURN;
  END IF;
  v_estado := CASE WHEN c.estado = 'RETENIDA' AND c.pago_vence_en <= now() THEN 'LIBERADA' ELSE c.estado::text END;
  v_pendiente := v_estado IN ('PENDIENTE_PAGO', 'RETENIDA');
  RETURN QUERY SELECT
    v_estado,
    CASE WHEN v_pendiente THEN c.pago_vence_en END,
    CASE
      WHEN v_estado = 'CONFIRMADA' THEN 'NINGUNO'
      WHEN v_estado = 'RETENIDA' AND confirma_con_correo(c.id) THEN 'VERIFICAR_CORREO'
      WHEN v_pendiente AND c.medio_confirmacion IS NULL THEN 'ELEGIR_MEDIO'
      WHEN v_pendiente AND c.medio_confirmacion = 'TRANSFERENCIA' AND t.estado = 'RECHAZADA' THEN 'TRANSFERENCIA_RECHAZADA'
      WHEN v_pendiente AND c.medio_confirmacion = 'TRANSFERENCIA' THEN 'ESPERAR_VALIDACION'
      WHEN v_pendiente THEN 'PAGAR_EN_LINEA'
      -- Pago que llego cuando la hora ya no estaba: el centro lo devuelve.
      WHEN EXISTS (SELECT 1 FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO') THEN 'CONTACTAR_CENTRO'
      ELSE 'ELEGIR_OTRA_HORA'
    END,
    CASE WHEN v_pendiente THEN medios_confirmacion_vigentes() END,
    c.medio_confirmacion,
    CASE WHEN v_pendiente THEN monto_confirmacion(c.id) END,
    t.estado IS DISTINCT FROM 'VALIDADA' AND t.comprobante IS NOT NULL,
    CASE WHEN v_pendiente AND t.estado = 'RECHAZADA' THEN t.motivo_rechazo END;
END;
$$;

CREATE OR REPLACE FUNCTION elegir_medio_cita(p_cita_id uuid, p_medio medio_confirmacion, p_transferencia_id uuid) RETURNS estado_cita
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  -- Saldo de una sesion ya realizada: solo medios en linea.
  IF deuda_pagable(c.id) THEN
    IF p_medio IS NULL OR NOT p_medio = ANY (medios_en_linea()) THEN
      RAISE EXCEPTION 'Ese medio de pago no esta habilitado en el centro'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_medio_no_habilitado';
    END IF;
    IF p_medio = 'TRANSFERENCIA' THEN
      IF NOT cuenta_transferencia_existe(c.profesional_id) THEN
        RAISE EXCEPTION 'No hay una cuenta registrada para transferir: elija otro medio'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_transferencia_sin_cuenta';
      END IF;
      UPDATE transferencias SET de_saldo = true WHERE cita_id = c.id AND estado <> 'VALIDADA';
      IF NOT FOUND THEN
        INSERT INTO transferencias (id, cita_id, de_saldo) VALUES (p_transferencia_id, c.id, true);
      END IF;
    END IF;
    UPDATE citas SET medio_saldo = p_medio, updated_at = now() WHERE id = c.id;
    RETURN c.estado;
  END IF;
  IF c.estado IS DISTINCT FROM 'PENDIENTE_PAGO' AND (c.estado IS DISTINCT FROM 'RETENIDA' OR c.pago_vence_en <= now()) THEN
    RAISE EXCEPTION 'La cita no esta pendiente de pago' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_medio IS NULL OR NOT p_medio = ANY (medios_confirmacion_vigentes()) THEN
    RAISE EXCEPTION 'Ese medio de pago no esta habilitado en el centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_medio_no_habilitado';
  END IF;
  IF p_medio = 'PAGO_EN_CENTRO' AND c.estado = 'PENDIENTE_PAGO' THEN
    UPDATE citas SET estado = 'CONFIRMADA', medio_confirmacion = 'PAGO_EN_CENTRO', updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
    RETURN 'CONFIRMADA';
  END IF;
  IF p_medio = 'TRANSFERENCIA' THEN
    IF NOT cuenta_transferencia_existe(c.profesional_id) THEN
      RAISE EXCEPTION 'No hay una cuenta registrada para transferir: elija otro medio'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_transferencia_sin_cuenta';
    END IF;
    INSERT INTO transferencias (id, cita_id) VALUES (p_transferencia_id, c.id) ON CONFLICT (cita_id) WHERE estado <> 'VALIDADA' DO NOTHING;
    IF c.medio_confirmacion IS DISTINCT FROM 'TRANSFERENCIA' AND c.paciente_id IS NOT NULL THEN
      PERFORM encolar_notificacion('INSTRUCCIONES_TRANSFERENCIA', c.paciente_id, NULL, c.id, NULL);
    END IF;
  END IF;
  UPDATE citas SET medio_confirmacion = p_medio, updated_at = now() WHERE id = c.id;
  RETURN c.estado;
END;
$$;

CREATE OR REPLACE FUNCTION datos_transferencia(p_cita_id uuid)
RETURNS TABLE (origen text, cuenta_id uuid, rut bytea, banco bytea, tipo_cuenta bytea, numero_cuenta bytea, titular bytea,
               monto integer, vence_en timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
  v_monto int;
  v_vence timestamptz;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id;
  IF deuda_pagable(c.id) AND c.medio_saldo = 'TRANSFERENCIA' THEN
    v_monto := saldo_cita(c.id);
  ELSIF c.estado NOT IN ('PENDIENTE_PAGO', 'RETENIDA') OR c.medio_confirmacion IS DISTINCT FROM 'TRANSFERENCIA' THEN
    RAISE EXCEPTION 'La cita no espera una transferencia' USING ERRCODE = 'object_not_in_prerequisite_state';
  ELSE
    v_monto := monto_confirmacion(c.id);
    v_vence := c.pago_vence_en;
  END IF;
  IF cobro_directo(c.profesional_id) THEN
    RETURN QUERY SELECT 'PROFESIONAL', d.usuario_id, d.rut, d.banco, d.tipo_cuenta, d.numero_cuenta, d.titular, v_monto, v_vence
    FROM profesional_datos_privados d WHERE d.usuario_id = c.profesional_id;
  ELSE
    RETURN QUERY SELECT 'CENTRO', k.id, k.rut, k.banco, k.tipo_cuenta, k.numero_cuenta, k.titular, v_monto, v_vence
    FROM cuenta_bancaria_centro k;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION transferencia_de_cita(p_cita_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  SELECT t.id INTO v FROM transferencias t JOIN citas c ON c.id = t.cita_id
  WHERE t.cita_id = p_cita_id AND t.estado <> 'VALIDADA'
    AND ((c.estado IN ('PENDIENTE_PAGO', 'RETENIDA') AND c.pago_vence_en > now() AND c.medio_confirmacion = 'TRANSFERENCIA')
         OR (t.de_saldo AND c.medio_saldo = 'TRANSFERENCIA' AND deuda_pagable(c.id)));
  IF v IS NULL THEN
    RAISE EXCEPTION 'La cita no espera una transferencia' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN v;
END;
$$;

-- Comprobante: en la hora pendiente mantiene la hora hasta validar (como
-- antes); en el saldo solo queda por validar.
CREATE OR REPLACE FUNCTION guardar_comprobante(p_cita_id uuid, p_contenido bytea, p_tipo text, p_nombre text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid := transferencia_de_cita(p_cita_id);
  c citas%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  UPDATE transferencias SET comprobante = p_contenido, comprobante_tipo = p_tipo, comprobante_nombre = left(p_nombre, 200),
                            comprobante_subido_en = now(), estado = 'POR_VALIDAR', resuelta_en = NULL, resuelta_por_id = NULL
  WHERE id = v_id;
  IF c.estado IN ('PENDIENTE_PAGO', 'RETENIDA') THEN
    UPDATE citas SET pago_vence_en = greatest(c.pago_vence_en, least(c.inicio, now() + make_interval(
                       hours => (SELECT plazo_validacion_transferencia_horas FROM configuracion_centro)))),
                     updated_at = now()
    WHERE id = c.id;
  END IF;
  IF c.paciente_id IS NOT NULL THEN
    PERFORM encolar_notificacion('COMPROBANTE_RECIBIDO', c.paciente_id, NULL, c.id, NULL);
  END IF;
END;
$$;

-- Validar: la transferencia abierta de la cita. La del saldo registra el
-- saldo del momento (aviso PAGO_REGISTRADO); la de confirmacion, como 03b-3.3.
CREATE OR REPLACE FUNCTION validar_transferencia(p_cita_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  t transferencias%ROWTYPE;
  v_monto int;
  v_pago uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  SELECT * INTO t FROM transferencias x WHERE x.cita_id = p_cita_id ORDER BY (x.estado = 'VALIDADA'), x.creada_en DESC LIMIT 1 FOR UPDATE;
  IF t.id IS NULL OR NOT puede_validar_transferencia(c.profesional_id) THEN
    IF t.id IS NOT NULL AND acceso_vigente() AND app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
      RAISE EXCEPTION 'Valida GESTION/ADMIN (cobro del centro) o el profesional de la cita (cobro directo)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'Transferencia inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.estado = 'VALIDADA' THEN
    RAISE EXCEPTION 'La cita ya no espera esta transferencia' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF t.de_saldo THEN
    v_monto := saldo_cita(c.id);
    IF v_monto <= 0 THEN
      RAISE EXCEPTION 'La sesion ya no tiene saldo pendiente' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    INSERT INTO pagos (cita_id, monto, medio_pago, registrado_por_id, cobrado_por)
    VALUES (c.id, v_monto, 'TRANSFERENCIA', app_usuario_id(),
            CASE WHEN cobro_directo(c.profesional_id) THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO' END)
    RETURNING id INTO v_pago;
    UPDATE transferencias SET estado = 'VALIDADA', pago_id = v_pago, resuelta_por_id = app_usuario_id(), resuelta_en = now()
    WHERE id = t.id;
    UPDATE citas SET medio_saldo = NULL, updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('PAGO_REGISTRADO', c.paciente_id, NULL, v_pago, NULL);
    RETURN v_pago;
  END IF;
  IF NOT (c.estado IN ('PENDIENTE_PAGO', 'RETENIDA') OR (c.estado = 'CONFIRMADA' AND c.agendada_por_equipo AND t.estado = 'POR_VALIDAR')) THEN
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
  SELECT * INTO t FROM transferencias x WHERE x.cita_id = p_cita_id ORDER BY (x.estado = 'VALIDADA'), x.creada_en DESC LIMIT 1 FOR UPDATE;
  IF t.id IS NULL OR NOT puede_validar_transferencia(c.profesional_id) THEN
    IF t.id IS NOT NULL AND acceso_vigente() AND app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
      RAISE EXCEPTION 'Valida GESTION/ADMIN (cobro del centro) o el profesional de la cita (cobro directo)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'Transferencia inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.estado <> 'POR_VALIDAR'
     OR NOT (t.de_saldo OR c.estado IN ('PENDIENTE_PAGO', 'RETENIDA') OR (c.estado = 'CONFIRMADA' AND c.agendada_por_equipo)) THEN
    RAISE EXCEPTION 'La transferencia no esta por validar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE transferencias SET estado = 'RECHAZADA', motivo_rechazo = btrim(p_motivo), resuelta_por_id = app_usuario_id(),
                            resuelta_en = now()
  WHERE id = t.id;
  -- Pendiente: vuelve a correr el plazo (corto o el del equipo). Confirmada por vencimiento: se paga en el centro.
  -- Saldo: queda para volver a transferir.
  IF c.estado IN ('PENDIENTE_PAGO', 'RETENIDA') THEN
    UPDATE citas SET pago_vence_en = least(c.inicio, greatest(plazo_pago(c.inicio),
                                                              CASE WHEN c.agendada_por_equipo THEN plazo_pago_equipo(c.inicio) END)),
                     updated_at = now()
    WHERE id = c.id;
  ELSIF NOT t.de_saldo THEN
    UPDATE citas SET medio_confirmacion = 'PAGO_EN_CENTRO', updated_at = now() WHERE id = c.id;
  END IF;
  IF c.paciente_id IS NOT NULL THEN
    PERFORM encolar_notificacion('PAGO_RECHAZADO', c.paciente_id, NULL, c.id, NULL);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION iniciar_cobro_pasarela(p_cita_id uuid) RETURNS TABLE (cobro_id uuid, monto integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
  v_monto int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF deuda_pagable(c.id) AND c.medio_saldo = 'PASARELA' THEN
    v_monto := saldo_cita(c.id);
  ELSIF c.estado NOT IN ('PENDIENTE_PAGO', 'RETENIDA') OR c.pago_vence_en <= now() OR c.medio_confirmacion IS DISTINCT FROM 'PASARELA' THEN
    RAISE EXCEPTION 'La cita no espera un pago en linea' USING ERRCODE = 'object_not_in_prerequisite_state';
  ELSE
    v_monto := monto_confirmacion(c.id);
  END IF;
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'No hay monto que cobrar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  INSERT INTO cobros_pasarela (cita_id, monto) VALUES (c.id, v_monto) RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, v_monto;
END;
$$;

-- Webhook: como 03b-3.2; el pago del saldo avisa PAGO_REGISTRADO.
CREATE OR REPLACE FUNCTION confirmar_cobro_pasarela(p_cobro_id uuid, p_evento_id text, p_pagado boolean)
RETURNS TABLE (estado estado_cobro_pasarela, cita_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  k cobros_pasarela%ROWTYPE;
  c citas%ROWTYPE;
  v_pago uuid;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el webhook de la pasarela' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO k FROM cobros_pasarela WHERE id = p_cobro_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF k.estado <> 'PENDIENTE' OR EXISTS (SELECT 1 FROM cobros_pasarela x WHERE x.evento_id = p_evento_id) THEN
    RETURN QUERY SELECT k.estado, k.cita_id;
    RETURN;
  END IF;
  IF NOT p_pagado THEN
    UPDATE cobros_pasarela SET estado = 'FALLIDO', evento_id = p_evento_id, procesado_en = now() WHERE id = k.id;
    RETURN QUERY SELECT 'FALLIDO'::estado_cobro_pasarela, k.cita_id;
    RETURN;
  END IF;
  SELECT * INTO c FROM citas WHERE id = k.cita_id FOR UPDATE;
  INSERT INTO pagos (cita_id, monto, medio_pago, origen, cobrado_por)
  VALUES (c.id, k.monto, 'PASARELA', 'PASARELA',
          CASE WHEN cobro_directo(c.profesional_id) THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO' END)
  RETURNING id INTO v_pago;
  UPDATE cobros_pasarela SET estado = 'PAGADO', pago_id = v_pago, evento_id = p_evento_id, procesado_en = now() WHERE id = k.id;
  IF c.estado = 'PENDIENTE_PAGO' THEN
    UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('PAGO_VALIDADO', c.paciente_id, NULL, c.id, NULL);
    PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
  ELSIF c.paciente_id IS NOT NULL AND c.estado IN ('CONFIRMADA', 'CANCELADA') THEN
    UPDATE citas SET medio_saldo = NULL, updated_at = now() WHERE id = c.id AND medio_saldo IS NOT NULL;
    PERFORM encolar_notificacion('PAGO_REGISTRADO', c.paciente_id, NULL, v_pago, NULL);
  END IF;
  RETURN QUERY SELECT 'PAGADO'::estado_cobro_pasarela, c.id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Cobro presencial: tambien el profesional de la cita
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_pago(p_cita_id uuid, p_monto integer, p_medio medio_pago) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  v_saldo int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT puede_cobrar_presencial(c.profesional_id) THEN
    RAISE EXCEPTION 'Registran ADMIN/GESTION o el profesional de la cita' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF c.profesional_id IS NULL THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  -- La hora retenida (sin paciente) se cobra con cobrar_reserva_en_caja.
  IF c.paciente_id IS NULL THEN
    RAISE EXCEPTION 'La hora esta retenida por una reserva en curso' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser positivo' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_monto_positivo';
  END IF;
  v_saldo := saldo_cita(p_cita_id);
  IF p_monto > v_saldo THEN
    RAISE EXCEPTION 'El pago supera el saldo de la cita (%)', v_saldo
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_sin_sobrepago';
  END IF;
  INSERT INTO pagos (cita_id, monto, medio_pago, registrado_por_id, cobrado_por)
  VALUES (p_cita_id, p_monto, p_medio, app_usuario_id(),
          CASE WHEN cobro_directo(c.profesional_id) THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO' END)
  RETURNING id INTO v_id;
  IF c.estado = 'PENDIENTE_PAGO' AND monto_confirmacion(c.id) = 0 THEN
    UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION cobrar_reserva_en_caja(p_cita_id uuid, p_monto integer, p_medio medio_pago) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  v_exigido int;
  v_pagado int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND OR NOT puede_cobrar_presencial(c.profesional_id) THEN
    IF FOUND AND acceso_vigente() AND app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
      RAISE EXCEPTION 'Cobra GESTION/ADMIN o el profesional de la cita' USING ERRCODE = 'insufficient_privilege';
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

-- Quien cobro en caja (el profesional de la cita incluido) concreta la reserva.
DO $$
DECLARE
  f text;
  def text;
  nuevo text;
BEGIN
  FOREACH f IN ARRAY ARRAY['reserva_por_concretar(uuid)',
                           'concretar_reserva(uuid, bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz)'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def, $q$OR puede_validar_transferencia(c.profesional_id))$q$,
                          $q$OR puede_validar_transferencia(c.profesional_id) OR puede_cobrar_presencial(c.profesional_id))$q$);
    IF nuevo = def THEN
      RAISE EXCEPTION 'La funcion % no trae la condicion esperada', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;

  -- La boleta sale sola al quedar pagada: tambien cuando el pago lo registra el profesional de la cita.
  def := pg_get_functiondef('emitir_boleta(uuid, uuid, bytea, bytea)'::regprocedure);
  nuevo := replace(def, $q$OR (app_rol() = 'PROFESIONAL' AND v_profesional = app_usuario_id() AND cobro_directo(v_profesional))) THEN$q$,
                        $q$OR (app_rol() = 'PROFESIONAL' AND v_profesional = app_usuario_id())) THEN$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'emitir_boleta no trae la condicion esperada';
  END IF;
  EXECUTE nuevo;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Enlace de pago sin cuenta
-- -----------------------------------------------------------------------------
-- Lo emite el job de mensajes (sin contexto) al armar un correo de pago. Sin
-- token si el paciente (o su adulto responsable) tiene cuenta activa: ese
-- correo lleva al portal.
CREATE FUNCTION emitir_enlace_pago(p_cita_id uuid, p_hash bytea) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de mensajes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM citas WHERE id = p_cita_id;
  IF c.paciente_id IS NULL
     OR EXISTS (SELECT 1 FROM usuarios u WHERE u.paciente_id = c.paciente_id AND u.activo)
     OR EXISTS (SELECT 1 FROM adultos_responsables a JOIN usuarios u ON u.id = a.usuario_id
                WHERE a.paciente_id = c.paciente_id AND u.activo) THEN
    RETURN false;
  END IF;
  INSERT INTO tokens_correo (tipo, token_hash, paciente_id, referencia_id, expira_en)
  VALUES ('PAGO_CITA', p_hash, c.paciente_id, c.id, now() + interval '30 days');
  RETURN true;
END;
$$;

-- Cita del enlace (sin contexto; rate limit en la API). No se consume.
CREATE FUNCTION cita_de_enlace_pago(p_hash bytea) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tokens_correo%ROWTYPE;
BEGIN
  SELECT * INTO t FROM tokens_correo WHERE token_hash = p_hash AND tipo = 'PAGO_CITA';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enlace de pago inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.expira_en <= now() THEN
    RAISE EXCEPTION 'El enlace de pago vencio: pide uno nuevo al centro' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN t.referencia_id;
END;
$$;

-- Lo que muestra la pagina del enlace: la sesion (sin datos personales del paciente).
CREATE FUNCTION resumen_enlace_pago(p_hash bytea)
RETURNS TABLE (inicio timestamptz, fin timestamptz, modalidad modalidad_atencion, profesional text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.inicio, c.fin, c.modalidad, coalesce(pf.nombre_publico, u.nombre)
  FROM citas c JOIN usuarios u ON u.id = c.profesional_id LEFT JOIN profesionales pf ON pf.usuario_id = c.profesional_id
  WHERE c.id = cita_de_enlace_pago(p_hash)
$$;

CREATE FUNCTION estado_pago_enlace(p_hash bytea)
RETURNS TABLE (estado text, vence_en timestamptz, siguiente text, medios medio_confirmacion[], medio medio_confirmacion,
               monto integer, comprobante_recibido boolean, motivo_rechazo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM estado_pago_cita(cita_de_enlace_pago(p_hash))
$$;

CREATE FUNCTION elegir_medio_enlace(p_hash bytea, p_medio medio_confirmacion, p_transferencia_id uuid) RETURNS estado_cita
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT elegir_medio_cita(cita_de_enlace_pago(p_hash), p_medio, p_transferencia_id)
$$;

CREATE FUNCTION datos_transferencia_enlace(p_hash bytea)
RETURNS TABLE (origen text, cuenta_id uuid, rut bytea, banco bytea, tipo_cuenta bytea, numero_cuenta bytea, titular bytea,
               monto integer, vence_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM datos_transferencia(cita_de_enlace_pago(p_hash))
$$;

CREATE FUNCTION transferencia_de_enlace(p_hash bytea) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT transferencia_de_cita(cita_de_enlace_pago(p_hash))
$$;

CREATE FUNCTION subir_comprobante_enlace(p_hash bytea, p_contenido bytea, p_tipo text, p_nombre text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT guardar_comprobante(cita_de_enlace_pago(p_hash), p_contenido, p_tipo, p_nombre)
$$;

CREATE FUNCTION iniciar_cobro_enlace(p_hash bytea) RETURNS TABLE (cobro_id uuid, monto integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM iniciar_cobro_pasarela(cita_de_enlace_pago(p_hash))
$$;

-- El aviso de deuda al paciente ya ofrece pagar en linea (solo la frase; un
-- texto personalizado por el centro no se toca).
UPDATE plantillas_mensaje
SET cuerpo = replace(cuerpo, 'Regularícelo en el centro para poder agendar su próxima hora.',
                     'Puede pagarlo en línea o en el centro; mientras tanto no podrá agendar su próxima hora.'),
    cuerpo_ejemplo = replace(cuerpo_ejemplo, 'Regularícelo en el centro para poder agendar su próxima hora.',
                             'Puede pagarlo en línea o en el centro; mientras tanto no podrá agendar su próxima hora.')
WHERE evento = 'DEUDA_PENDIENTE' AND destinatario = 'PACIENTE';

-- -----------------------------------------------------------------------------
-- 6. Permisos de funciones
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  saldo_cita(uuid), deuda_pagable(uuid), medios_en_linea(), puede_cobrar_presencial(uuid), cita_de_enlace_pago(bytea)
FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION
  emitir_enlace_pago(uuid, bytea), resumen_enlace_pago(bytea), estado_pago_enlace(bytea),
  elegir_medio_enlace(bytea, medio_confirmacion, uuid), datos_transferencia_enlace(bytea), transferencia_de_enlace(bytea),
  subir_comprobante_enlace(bytea, bytea, text, text), iniciar_cobro_enlace(bytea)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  emitir_enlace_pago(uuid, bytea), resumen_enlace_pago(bytea), estado_pago_enlace(bytea),
  elegir_medio_enlace(bytea, medio_confirmacion, uuid), datos_transferencia_enlace(bytea), transferencia_de_enlace(bytea),
  subir_comprobante_enlace(bytea, bytea, text, text), iniciar_cobro_enlace(bytea)
TO app_user;
