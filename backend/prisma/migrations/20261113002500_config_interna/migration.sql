-- =============================================================================
-- R4 (Vinculos Control, 2026-11-13): el plano de control aplica una revision
-- aprobada del manifiesto (job `reconfigurar` y paso P7 de `aprovisionar`).
--
-- aplicar_config_interna(): token del silo, sin contexto de usuario. Aplica
--   modulos_activos y las reglas del manifiesto (lista cerrada: las mismas
--   columnas de configuracion_centro que CAMPOS_REGLAS de @vinculos/manifest)
--   y registra revision + hash en identidad_silo.
--   - Misma revision y hash ya aplicados: SIN_CAMBIOS (idempotente).
--   - Revision menor o igual a la aplicada con otro hash: 55000 (nunca vuelve atras).
--   - Dependencias: MATCH y PAGINA_PUBLICA requieren EQUIPO; COBROS requiere AGENDA.
--   - Regla fuera de la lista: 23514. Los rangos los hacen cumplir los CHECK y
--     triggers de configuracion_centro (igual que cuando edita el ADMIN).
-- config_interna(): lo aplicado (revision, hash, fecha, modulos), para que el
--   agente confirme. El tema no se aplica aqui: sigue en el .env (TEMA).
-- =============================================================================

ALTER TABLE identidad_silo ADD COLUMN "revision_aplicada" INTEGER;
ALTER TABLE identidad_silo ADD COLUMN "hash_aplicado" TEXT;
ALTER TABLE identidad_silo ADD COLUMN "aplicada_en" TIMESTAMPTZ(6);
ALTER TABLE identidad_silo ADD CONSTRAINT identidad_silo_revision_aplicada
  CHECK ((revision_aplicada IS NULL) = (hash_aplicado IS NULL) AND (revision_aplicada IS NULL OR revision_aplicada >= 1)
         AND (hash_aplicado IS NULL OR hash_aplicado ~ '^[0-9a-f]{64}$'));

CREATE FUNCTION aplicar_config_interna(p_token text, p_revision integer, p_hash text,
                                       p_modulos modulo_centro[], p_reglas jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- Lista cerrada (CAMPOS_REGLAS del manifiesto). Nada de nombres libres en el SQL dinamico.
  c_reglas CONSTANT text[] := ARRAY[
    'rol_gestion_habilitado', 'max_cuentas_madre', 'plazo_aviso_cancelacion_horas', 'recordatorio_horas_antes',
    'margen_traslado_min', 'horas_aprobacion_solicitud', 'minutos_retencion_solicitud', 'plazo_respuesta_derivacion_horas',
    'plazo_consentimiento_horas', 'plazo_oposicion_horas', 'match_filtro_directo', 'dias_retencion_respuestas_match',
    'edad_minima_cuenta', 'dias_gracia_cierre', 'retencion_mensajes_dias', 'modelo_cobro',
    'penalizacion_cancelacion_porcentaje', 'cobro_inasistencia_porcentaje', 'comision_centro_porcentaje',
    'bloquear_agenda_morosos'];
  v_id identidad_silo%ROWTYPE;
  v_actual configuracion_centro%ROWTYPE;
  v_nueva configuracion_centro%ROWTYPE;
  v_modulos modulo_centro[];
  k text;
  v_set text;
BEGIN
  IF NOT interno_token_valido(p_token) OR app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el plano de control (token del silo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_revision IS NULL OR p_revision < 1 OR p_hash !~ '^[0-9a-f]{64}$' OR p_modulos IS NULL
     OR jsonb_typeof(coalesce(p_reglas, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Revision, hash, modulos o reglas con formato invalido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_interna_formato';
  END IF;
  SELECT * INTO v_id FROM identidad_silo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El silo no tiene identidad (migrate sin identidad_silo.js)' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_id.revision_aplicada = p_revision AND v_id.hash_aplicado = p_hash THEN
    RETURN 'SIN_CAMBIOS';
  END IF;
  IF v_id.revision_aplicada IS NOT NULL AND p_revision <= v_id.revision_aplicada THEN
    RAISE EXCEPTION 'La revision % no es posterior a la aplicada (%)', p_revision, v_id.revision_aplicada
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  SELECT coalesce(array_agg(DISTINCT m ORDER BY m), '{}') INTO v_modulos FROM unnest(p_modulos) AS m;
  IF ('MATCH' = ANY (v_modulos) OR 'PAGINA_PUBLICA' = ANY (v_modulos)) AND NOT 'EQUIPO' = ANY (v_modulos) THEN
    RAISE EXCEPTION 'Dependencias de modulos: MATCH y PAGINA_PUBLICA requieren EQUIPO'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_interna_dependencias';
  END IF;
  IF 'COBROS' = ANY (v_modulos) AND NOT 'AGENDA' = ANY (v_modulos) THEN
    RAISE EXCEPTION 'Dependencias de modulos: COBROS requiere AGENDA'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'config_interna_dependencias';
  END IF;
  FOR k IN SELECT jsonb_object_keys(coalesce(p_reglas, '{}'::jsonb)) LOOP
    IF NOT k = ANY (c_reglas) THEN
      RAISE EXCEPTION 'Regla desconocida: %', k USING ERRCODE = 'check_violation', CONSTRAINT = 'config_interna_regla';
    END IF;
  END LOOP;

  UPDATE configuracion_centro SET modulos_activos = v_modulos WHERE id;
  -- Tipos y rangos: jsonb_populate_record convierte con el tipo de cada columna;
  -- los CHECK y triggers de configuracion_centro validan como en una edicion del ADMIN.
  SELECT * INTO v_actual FROM configuracion_centro WHERE id;
  v_nueva := jsonb_populate_record(v_actual, coalesce(p_reglas, '{}'::jsonb));
  -- Un solo UPDATE con todas las reglas: los CHECK entre columnas (por ejemplo,
  -- recordatorio antes del plazo de cancelacion) se evaluan sobre el estado final.
  SELECT string_agg(format('%1$I = ($1).%1$I', x), ', ') INTO v_set FROM jsonb_object_keys(coalesce(p_reglas, '{}'::jsonb)) AS x;
  IF v_set IS NOT NULL THEN
    EXECUTE format('UPDATE configuracion_centro SET %s WHERE id', v_set) USING v_nueva;
  END IF;

  UPDATE identidad_silo SET revision_aplicada = p_revision, hash_aplicado = p_hash, aplicada_en = now();
  RETURN 'APLICADA';
END;
$$;
REVOKE EXECUTE ON FUNCTION aplicar_config_interna(text, integer, text, modulo_centro[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aplicar_config_interna(text, integer, text, modulo_centro[], jsonb) TO app_user;

CREATE FUNCTION config_interna(p_token text)
RETURNS TABLE (revision integer, hash text, aplicada_en timestamptz, modulos modulo_centro[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT interno_token_valido(p_token) OR app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el plano de control (token del silo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY SELECT i.revision_aplicada, i.hash_aplicado, i.aplicada_en, c.modulos_activos
               FROM identidad_silo i CROSS JOIN configuracion_centro c;
END;
$$;
REVOKE EXECUTE ON FUNCTION config_interna(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION config_interna(text) TO app_user;
