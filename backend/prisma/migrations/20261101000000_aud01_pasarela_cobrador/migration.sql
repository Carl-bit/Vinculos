-- =============================================================================
-- AUD-01 (E1.3, contradiccion C2): la pasarela del silo es la del centro.
--
-- Decision: cada centro, o profesional con cobro directo, usa su propia cuenta
-- de pasarela; Vinculos nunca recibe dinero. Hasta que exista la pasarela por
-- cobrador (post-MVP, docs/api/integraciones.md "Pasarela por cobrador"), el
-- medio PASARELA solo cobra horas que cobra el centro:
--   * modelo DIRECTO: no se puede habilitar PASARELA (todos cobran directo);
--   * modelo MIXTO: PASARELA no se ofrece ni se acepta en horas de un
--     profesional con cobro directo (cobro_directo()).
-- Sin tablas nuevas.
-- =============================================================================

-- 1. Configuracion: PASARELA con modelo DIRECTO -> 23514 (422).
CREATE OR REPLACE FUNCTION validar_medios_pago() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF 'TRANSFERENCIA' = ANY (NEW.medios_pago_habilitados) AND NEW.modelo_cobro <> 'DIRECTO'
     AND NOT EXISTS (SELECT 1 FROM cuenta_bancaria_centro) THEN
    RAISE EXCEPTION 'Para habilitar transferencia, registre primero la cuenta bancaria del centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'configuracion_centro_transferencia_sin_cuenta';
  END IF;
  IF 'PASARELA' = ANY (NEW.medios_pago_habilitados) AND NEW.modelo_cobro = 'DIRECTO' THEN
    RAISE EXCEPTION 'Con cobro directo cada profesional necesita su propia pasarela de pago: por ahora no se puede habilitar'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'configuracion_centro_pasarela_cobro_directo';
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Medios que se ofrecen en una hora: sin PASARELA si la cobra el profesional.
CREATE FUNCTION medios_de_profesional(p_profesional_id uuid, p_medios medio_confirmacion[]) RETURNS medio_confirmacion[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_medios IS NULL OR NOT cobro_directo(p_profesional_id) THEN p_medios
              ELSE array_remove(p_medios, 'PASARELA'::medio_confirmacion) END
$$;
REVOKE EXECUTE ON FUNCTION medios_de_profesional(uuid, medio_confirmacion[]) FROM PUBLIC;

-- 3. Red de seguridad: elegir PASARELA o iniciar un cobro en una hora de cobro directo -> 23514 (422).
CREATE FUNCTION rechazar_pasarela_cobro_directo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_profesional uuid;
BEGIN
  IF TG_TABLE_NAME = 'citas' THEN
    IF 'PASARELA' IN (NEW.medio_confirmacion, NEW.medio_saldo) THEN
      v_profesional := NEW.profesional_id;
    END IF;
  ELSE
    SELECT profesional_id INTO v_profesional FROM citas WHERE id = NEW.cita_id;
  END IF;
  IF v_profesional IS NOT NULL AND cobro_directo(v_profesional) THEN
    RAISE EXCEPTION 'Esta hora la cobra directamente el profesional: elija otro medio de pago'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_pasarela_cobro_directo';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER citas_pasarela_cobro_directo BEFORE UPDATE OF medio_confirmacion, medio_saldo ON citas
  FOR EACH ROW WHEN (NEW.medio_confirmacion = 'PASARELA' OR NEW.medio_saldo = 'PASARELA')
  EXECUTE FUNCTION rechazar_pasarela_cobro_directo();
CREATE TRIGGER cobros_pasarela_cobro_directo BEFORE INSERT ON cobros_pasarela
  FOR EACH ROW EXECUTE FUNCTION rechazar_pasarela_cobro_directo();

-- 4. estado_pago_cita (03b-3.4) con los medios por profesional; el resto igual.
CREATE OR REPLACE FUNCTION estado_pago_cita(p_cita_id uuid)
 RETURNS TABLE(estado text, vence_en timestamp with time zone, siguiente text, medios medio_confirmacion[], medio medio_confirmacion, monto integer, comprobante_recibido boolean, motivo_rechazo text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    v_medios := medios_de_profesional(c.profesional_id, medios_en_linea());
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
    CASE WHEN v_pendiente THEN medios_de_profesional(c.profesional_id, medios_confirmacion_vigentes()) END,
    c.medio_confirmacion,
    CASE WHEN v_pendiente THEN monto_confirmacion(c.id) END,
    t.estado IS DISTINCT FROM 'VALIDADA' AND t.comprobante IS NOT NULL,
    CASE WHEN v_pendiente AND t.estado = 'RECHAZADA' THEN t.motivo_rechazo END;
END;
$function$;

