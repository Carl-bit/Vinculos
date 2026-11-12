-- =============================================================================
-- Punto 9, pendiente (2026-11-11): volver con el profesional principal.
--
-- Cuando el paciente pide atencion temporal (responder_ausencia), queda
-- registrado su profesional principal (atenciones_temporales). En la
-- siguiente asignacion (el equipo agenda o el paciente pide hora) se pregunta
-- si el principal ya esta disponible (retorno_atencion_temporal): si lo esta,
-- se indica y el paciente puede pedir volver; la cuenta madre lo ofrece como
-- derivacion al principal (el tratante solo cambia por derivacion). Si no esta
-- disponible, se mantiene con el profesional actual (flujo normal de derivados).
-- Se cierra sola cuando el paciente vuelve a su principal (trigger sobre
-- pacientes.profesional_id) o la cuenta madre la cierra ("se queda").
--
-- Categoria A. Sin GRANT de escritura: solo funciones SECURITY DEFINER.
-- =============================================================================

CREATE TABLE atenciones_temporales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id uuid NOT NULL REFERENCES pacientes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  profesional_principal_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  solicitada_en timestamptz NOT NULL DEFAULT now(),
  -- El paciente dijo que quiere volver con su principal (prioridad para la cuenta madre).
  pide_volver_en timestamptz,
  cerrada_en timestamptz,
  cierre text CHECK (cierre IN ('VOLVIO', 'SE_QUEDA')),
  CONSTRAINT atenciones_temporales_cierre CHECK ((cerrada_en IS NULL) = (cierre IS NULL))
);
CREATE UNIQUE INDEX atenciones_temporales_una_abierta ON atenciones_temporales (paciente_id) WHERE cerrada_en IS NULL;
COMMENT ON TABLE atenciones_temporales IS
  'Categoria A. Atencion temporal con otro profesional mientras el principal no atiende (punto 9). Escritura solo via funciones.';

ALTER TABLE atenciones_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE atenciones_temporales FORCE ROW LEVEL SECURITY;
CREATE POLICY atenciones_temporales_select ON atenciones_temporales FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN'
         OR (SELECT contacto_emergencia_propio(paciente_id))
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE') AND (SELECT acceso_clinico_paciente(paciente_id)))
         OR profesional_principal_id = (SELECT app_usuario_id()));
CREATE POLICY atenciones_temporales_acceso_vigente ON atenciones_temporales AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON atenciones_temporales TO app_user;

-- Disponible = cuenta activa con rol profesional, sin bloqueo que cubra este momento (ni indefinido).
CREATE FUNCTION profesional_disponible(p_profesional_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = p_profesional_id AND u.activo AND u.cerrada_en IS NULL
                 AND (u.rol = 'PROFESIONAL' OR tiene_rol(u.id, 'PROFESIONAL'))
                 AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id AND b.procesada_en IS NULL)
                 AND NOT EXISTS (SELECT 1 FROM bloqueos_agenda bl WHERE bl.profesional_id = u.id
                                 AND bl.inicio <= now() AND (bl.fin IS NULL OR bl.fin > now())))
$$;

-- Pregunta de la siguiente asignacion: atencion temporal abierta y si su principal ya esta disponible.
-- Devuelve 0 filas si no hay atencion temporal abierta (o el rol no la ve: RLS de la tabla).
CREATE FUNCTION retorno_atencion_temporal(p_paciente_id uuid)
RETURNS TABLE (atencion_id uuid, profesional_principal_id uuid, principal_disponible boolean, pide_volver boolean, tratante_actual_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.profesional_principal_id, profesional_disponible(a.profesional_principal_id), a.pide_volver_en IS NOT NULL,
         (SELECT p.profesional_id FROM pacientes p WHERE p.id = a.paciente_id)
  FROM atenciones_temporales a
  WHERE a.paciente_id = p_paciente_id AND a.cerrada_en IS NULL
$$;
GRANT EXECUTE ON FUNCTION retorno_atencion_temporal(uuid) TO app_user;

-- Atenciones abiertas cuyo principal ya esta disponible (bandeja de la cuenta madre).
CREATE FUNCTION retornos_disponibles()
RETURNS TABLE (paciente_id uuid, codigo text, nombre text, apellido text, profesional_principal_id uuid, tratante_actual_id uuid, pide_volver boolean, solicitada_en timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo la cuenta madre' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT p.id, p.codigo_seudonimo, p.nombre, p.apellido, a.profesional_principal_id, p.profesional_id,
         a.pide_volver_en IS NOT NULL, a.solicitada_en
  FROM atenciones_temporales a JOIN pacientes p ON p.id = a.paciente_id
  WHERE a.cerrada_en IS NULL AND p.profesional_id <> a.profesional_principal_id
    AND profesional_disponible(a.profesional_principal_id)
  ORDER BY a.pide_volver_en NULLS LAST, a.solicitada_en;
END;
$$;
REVOKE EXECUTE ON FUNCTION retornos_disponibles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retornos_disponibles() TO app_user;

-- El paciente pide volver con su principal (solo si esta disponible); la cuenta madre lo ve primero.
CREATE FUNCTION pedir_volver_con_principal(p_paciente_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a record;
BEGIN
  IF NOT acceso_vigente() OR NOT coalesce(contacto_emergencia_propio(p_paciente_id), false) THEN
    RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT id, profesional_principal_id INTO a FROM atenciones_temporales WHERE paciente_id = p_paciente_id AND cerrada_en IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT profesional_disponible(a.profesional_principal_id) THEN
    RAISE EXCEPTION 'Tu profesional principal todavia no esta disponible'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'atenciones_temporales_principal_disponible';
  END IF;
  UPDATE atenciones_temporales SET pide_volver_en = coalesce(pide_volver_en, now()) WHERE id = a.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION pedir_volver_con_principal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pedir_volver_con_principal(uuid) TO app_user;

-- La cuenta madre decide que se queda con el profesional actual.
CREATE FUNCTION mantener_atencion_temporal(p_paciente_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo la cuenta madre' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE atenciones_temporales SET cerrada_en = now(), cierre = 'SE_QUEDA' WHERE paciente_id = p_paciente_id AND cerrada_en IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sin atencion temporal abierta' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION mantener_atencion_temporal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mantener_atencion_temporal(uuid) TO app_user;

-- Al volver con su principal (derivacion aceptada), se cierra sola.
CREATE FUNCTION cerrar_atencion_temporal_al_volver() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE atenciones_temporales SET cerrada_en = now(), cierre = 'VOLVIO'
  WHERE paciente_id = NEW.id AND cerrada_en IS NULL AND profesional_principal_id = NEW.profesional_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER pacientes_atencion_temporal_retorno AFTER UPDATE OF profesional_id ON pacientes
  FOR EACH ROW WHEN (NEW.profesional_id IS DISTINCT FROM OLD.profesional_id) EXECUTE FUNCTION cerrar_atencion_temporal_al_volver();

-- responder_ausencia: ATENCION_TEMPORAL tambien registra al profesional principal.
CREATE OR REPLACE FUNCTION responder_ausencia(p_cita_id uuid, p_opcion text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
BEGIN
  SELECT id, paciente_id, profesional_id, estado::text AS estado INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND OR NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE')
     -- coalesce: con NULL (responsable sin paciente propio) la comparacion no debe dejar pasar.
     OR NOT (coalesce(c.paciente_id = app_paciente_id(), false)
             OR coalesce(c.paciente_id IN (SELECT pacientes_a_cargo()), false)) THEN
    RAISE EXCEPTION 'Cita no encontrada' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'POR_REPROGRAMAR' THEN
    RAISE EXCEPTION 'La hora ya no esta por reprogramar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_opcion = 'CANCELAR' THEN
    UPDATE citas SET estado = 'CANCELADA', updated_at = now() WHERE id = p_cita_id;
  ELSIF p_opcion = 'ATENCION_TEMPORAL' THEN
    INSERT INTO alertas_internas (tipo, referencia_id, detalle)
    VALUES ('ATENCION_TEMPORAL', c.paciente_id,
            'El paciente pide atenderse con otro profesional mientras su tratante no atiende. Derivalo desde Fichas y pacientes > Derivaciones.')
    ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
    INSERT INTO atenciones_temporales (paciente_id, profesional_principal_id)
    VALUES (c.paciente_id, (SELECT profesional_id FROM pacientes WHERE id = c.paciente_id))
    ON CONFLICT (paciente_id) WHERE cerrada_en IS NULL DO NOTHING;
  ELSE
    RAISE EXCEPTION 'Opcion: CANCELAR o ATENCION_TEMPORAL' USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_respuesta_ausencia';
  END IF;
  RETURN p_opcion;
END;
$$;
