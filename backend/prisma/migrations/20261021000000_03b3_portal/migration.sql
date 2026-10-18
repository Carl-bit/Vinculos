-- =============================================================================
-- 03b-3: portal del paciente y paginas por enlace.
--
-- 1. consultar_token_consentimiento devuelve tambien quien atiende y quien
--    supervisa (consentimiento de practicante) o el supervisor anterior y el
--    nuevo (aviso de cambio de supervisor): la pagina del enlace explica que
--    se acepta. Solo nombres (como mi_equipo_tratante); sin el token no hay
--    nada (misma excepcion que antes).
-- 2. supervisores_portal(): nombre de quien supervisa a los practicantes que
--    atienden al paciente (consentimientos y avisos del portal). El resto de
--    los nombres del portal sale de mi_equipo_tratante().
--
-- Sin tablas nuevas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Pagina del enlace de consentimiento (sin contexto)
-- -----------------------------------------------------------------------------
DROP FUNCTION consultar_token_consentimiento(bytea);

CREATE FUNCTION consultar_token_consentimiento(p_hash bytea)
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
  FROM politica_vigente('CONSENTIMIENTO_ATENCION') v
  LEFT JOIN consentimientos c ON c.id = t.referencia_id
  LEFT JOIN avisos_consentimiento a ON a.id = t.referencia_id
  LEFT JOIN consentimientos ca ON ca.id = a.consentimiento_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Supervisores visibles en el portal
-- -----------------------------------------------------------------------------
-- Quien supervisa (o supervisaba, en un aviso de cambio) a los practicantes
-- de los consentimientos que la cuenta ve: el propio paciente o los menores a
-- cargo del adulto responsable. Solo id y nombre.
CREATE FUNCTION supervisores_portal()
RETURNS TABLE (id uuid, nombre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'supervisores_portal: solo PACIENTE o RESPONSABLE con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH mios AS (
    SELECT c.id, c.supervisor_id FROM consentimientos c
    WHERE c.paciente_id IN (SELECT app_paciente_id() UNION SELECT pacientes_a_cargo())
  )
  SELECT u.id, u.nombre FROM usuarios u
  WHERE u.id IN (SELECT m.supervisor_id FROM mios m
                 UNION SELECT a.supervisor_anterior_id FROM avisos_consentimiento a JOIN mios m ON m.id = a.consentimiento_id
                 UNION SELECT a.supervisor_nuevo_id FROM avisos_consentimiento a JOIN mios m ON m.id = a.consentimiento_id)
  ORDER BY u.nombre;
END;
$$;

REVOKE EXECUTE ON FUNCTION consultar_token_consentimiento(bytea), supervisores_portal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consultar_token_consentimiento(bytea), supervisores_portal() TO app_user;
