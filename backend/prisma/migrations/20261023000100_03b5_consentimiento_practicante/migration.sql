-- =============================================================================
-- 03b-5: consentimiento de practicante versionado (pendiente de 03b-3).
--
-- Antes el texto que aceptaba el paciente era fijo en el front
-- ("practicante-portal-v1") y la BD guardaba cualquier version_documento.
-- Ahora es una politica versionada (B) como las demas:
--
-- 1. Texto inicial (v1) de CONSENTIMIENTO_PRACTICANTE; ADMIN publica versiones
--    nuevas en Configuracion (politicas append-only, version = max + 1).
-- 2. responder_consentimiento: aceptar exige la version VIGENTE de esa
--    politica (si no, 23514 aceptaciones_politica_version_vigente, la misma
--    regla que el consentimiento de atencion). Las respuestas ya registradas
--    conservan la version con que se aceptaron (append-only: no se tocan).
-- 3. consultar_token_consentimiento: la pagina del enlace muestra el texto y
--    la version de la politica que corresponde (practicante o aviso de cambio
--    de supervisor: CONSENTIMIENTO_PRACTICANTE; atencion: la de siempre).
--
-- Categoria: politicas (B), sin tablas nuevas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Texto inicial
-- -----------------------------------------------------------------------------
INSERT INTO politicas (tipo, texto) VALUES
  ('CONSENTIMIENTO_PRACTICANTE', 'Acepto ser atendido por un psicologo en practica profesional, bajo la supervision de un psicologo titulado del centro. Entiendo que el supervisor revisa los registros de mis sesiones sin conocer mi nombre ni mis datos de contacto (supervision seudonimizada), que puedo preguntar por la formacion del practicante y que puedo retirar este consentimiento cuando lo estime: en ese caso el centro me asignara otro profesional.');

-- -----------------------------------------------------------------------------
-- 2. Aceptar exige la version vigente
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION responder_consentimiento(p_consentimiento_id uuid, p_acepta boolean, p_version_documento text,
                                                    p_otorgado_por_tipo otorgante_consentimiento, p_adulto_responsable_id uuid,
                                                    p_respaldo_documento_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c consentimientos%ROWTYPE;
  v_candidato uuid;
  v_vigente int;
BEGIN
  SELECT * INTO v_c FROM consentimientos WHERE id = p_consentimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consentimiento inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM validar_otorgante(v_c.paciente_id, p_otorgado_por_tipo, p_adulto_responsable_id, p_respaldo_documento_ref);
  IF v_c.estado <> 'SOLICITADO' OR v_c.vence_en <= now() THEN
    RAISE EXCEPTION 'La solicitud ya fue respondida o vencio' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_acepta IS NULL OR (p_acepta AND coalesce(btrim(p_version_documento), '') = '') THEN
    RAISE EXCEPTION 'Aceptar exige la version del documento'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_coherente';
  END IF;
  IF p_acepta THEN
    SELECT pv.version INTO v_vigente FROM politica_vigente('CONSENTIMIENTO_PRACTICANTE') pv;
    IF v_vigente IS NULL OR v_vigente::text IS DISTINCT FROM btrim(p_version_documento) THEN
      RAISE EXCEPTION 'La version aceptada no es la vigente'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
    END IF;
  END IF;

  UPDATE consentimientos
  SET estado = CASE WHEN p_acepta THEN 'ACEPTADO'::estado_consentimiento ELSE 'RECHAZADO' END,
      version_documento = CASE WHEN p_acepta THEN btrim(p_version_documento) ELSE p_version_documento END,
      otorgado_por_tipo = p_otorgado_por_tipo,
      adulto_responsable_id = p_adulto_responsable_id, respondido_por_id = app_usuario_id(),
      respondido_en = now(), respaldo_documento_ref = p_respaldo_documento_ref
  WHERE id = p_consentimiento_id;

  IF NOT p_acepta THEN
    PERFORM consentimiento_no_otorgado(p_consentimiento_id);
  ELSIF v_c.derivacion_id IS NOT NULL THEN
    SELECT c.id INTO v_candidato FROM derivacion_candidatos c JOIN derivaciones d ON d.id = c.derivacion_id
    WHERE c.derivacion_id = v_c.derivacion_id AND c.profesional_id = v_c.practicante_id
      AND c.estado = 'ACEPTADA' AND d.estado = 'ESPERANDO_CONSENTIMIENTO';
    IF v_candidato IS NOT NULL THEN
      PERFORM concretar_traspaso(v_c.derivacion_id, v_candidato);
    END IF;
  END IF;
  IF v_c.derivacion_id IS NOT NULL THEN
    PERFORM registrar_accion_derivacion(v_c.derivacion_id, 'consentimientos');
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Pagina del enlace: texto de la politica que corresponde
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION consultar_token_consentimiento(p_hash bytea)
RETURNS TABLE (tipo text, politica_version int, politica_texto text, vence_en timestamptz, menor boolean,
               practicante text, supervisor text, supervisor_anterior text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE;
BEGIN
  SELECT * INTO t FROM tokens_correo WHERE token_hash = p_hash AND tipo = 'CONSENTIMIENTO'
    AND usado_en IS NULL AND expira_en > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enlace inexistente, usado o vencido' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN QUERY
  SELECT CASE WHEN c.id IS NOT NULL THEN 'PRACTICANTE'
              WHEN a.id IS NOT NULL THEN 'AVISO_SUPERVISOR'
              ELSE 'ATENCION' END,
         v.version, v.texto, t.expira_en, t.adulto_responsable_id IS NOT NULL,
         (SELECT u.nombre FROM usuarios u WHERE u.id = coalesce(c.practicante_id, ca.practicante_id)),
         (SELECT u.nombre FROM usuarios u WHERE u.id = coalesce(c.supervisor_id, a.supervisor_nuevo_id)),
         (SELECT u.nombre FROM usuarios u WHERE u.id = a.supervisor_anterior_id)
  FROM (SELECT 1) uno
  LEFT JOIN consentimientos c ON c.id = t.referencia_id
  LEFT JOIN avisos_consentimiento a ON a.id = t.referencia_id
  LEFT JOIN consentimientos ca ON ca.id = a.consentimiento_id
  CROSS JOIN LATERAL politica_vigente(CASE WHEN c.id IS NOT NULL OR a.id IS NOT NULL THEN 'CONSENTIMIENTO_PRACTICANTE'
                                           ELSE 'CONSENTIMIENTO_ATENCION' END::tipo_politica) v;
END;
$$;
