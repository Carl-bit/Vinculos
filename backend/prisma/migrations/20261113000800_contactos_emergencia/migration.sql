-- =============================================================================
-- Punto 38 (correcciones 2026-11-10/11): contactos de emergencia del paciente.
--
-- Categoria A+C. Los agrega, edita y elimina el paciente (o su adulto
-- responsable) desde el portal; puede tener varios y no es obligatorio. El
-- profesional tratante (acceso clinico vigente) ve que existen y el
-- parentesco; el nombre y el telefono solo en una emergencia, con motivo y
-- auditado en accesos_ficha (datos_contactos_emergencia). La cuenta madre y
-- gestion no los ven (punto 20). Si no hay ninguno, el tratante puede pedirle
-- al paciente que agregue uno (pedir_contacto_emergencia, una vez por semana).
--
-- nombre y telefono: cifrados (IDENTIFICACION, registro.ts); id lo da la API
-- (AAD). app_user no tiene SELECT de esas columnas: solo la funcion las entrega.
-- pacientes.contacto_emergencia (texto del centro, antes de este punto) queda
-- como dato heredado de solo lectura.
-- =============================================================================

CREATE TABLE contactos_emergencia (
  id uuid PRIMARY KEY,
  paciente_id uuid NOT NULL REFERENCES pacientes(id) ON DELETE RESTRICT,
  nombre bytea NOT NULL CHECK (octet_length(nombre) >= 49),
  parentesco text NOT NULL CHECK (length(btrim(parentesco)) BETWEEN 1 AND 60),
  telefono bytea NOT NULL CHECK (octet_length(telefono) >= 49),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contactos_emergencia_paciente_id_idx ON contactos_emergencia (paciente_id);
COMMENT ON TABLE contactos_emergencia IS
  'Categoria A+C. Contactos de emergencia que agrega el paciente. El tratante ve existencia y parentesco; nombre y telefono solo via datos_contactos_emergencia() (emergencia, auditado).';

-- A lo mas 5 por paciente (evita listas sin fin; el formulario lo dice).
CREATE FUNCTION validar_contactos_emergencia() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (SELECT count(*) FROM contactos_emergencia WHERE paciente_id = NEW.paciente_id) >= 5 THEN
    RAISE EXCEPTION 'A lo mas 5 contactos de emergencia por paciente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contactos_emergencia_maximo';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER contactos_emergencia_maximo BEFORE INSERT ON contactos_emergencia
  FOR EACH ROW EXECUTE FUNCTION validar_contactos_emergencia();

ALTER TABLE contactos_emergencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE contactos_emergencia FORCE ROW LEVEL SECURITY;

-- Lo del paciente: el titular o su adulto responsable (cuenta del portal).
CREATE FUNCTION contacto_emergencia_propio(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE app_rol()
    WHEN 'PACIENTE' THEN p_paciente_id = app_paciente_id()
    WHEN 'RESPONSABLE' THEN p_paciente_id IN (SELECT pacientes_a_cargo())
    ELSE false
  END
$$;

CREATE POLICY contactos_emergencia_select ON contactos_emergencia FOR SELECT TO app_user
  USING ((SELECT contacto_emergencia_propio(paciente_id))
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE') AND (SELECT acceso_clinico_paciente(paciente_id))));
CREATE POLICY contactos_emergencia_insert ON contactos_emergencia FOR INSERT TO app_user
  WITH CHECK ((SELECT contacto_emergencia_propio(paciente_id)));
CREATE POLICY contactos_emergencia_update ON contactos_emergencia FOR UPDATE TO app_user
  USING ((SELECT contacto_emergencia_propio(paciente_id))) WITH CHECK ((SELECT contacto_emergencia_propio(paciente_id)));
CREATE POLICY contactos_emergencia_delete ON contactos_emergencia FOR DELETE TO app_user
  USING ((SELECT contacto_emergencia_propio(paciente_id)));
CREATE POLICY contactos_emergencia_acceso_vigente ON contactos_emergencia AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));

-- Sin SELECT de nombre ni telefono: ni el tratante los lee por la tabla.
GRANT SELECT (id, paciente_id, parentesco, created_at, updated_at) ON contactos_emergencia TO app_user;
GRANT INSERT ON contactos_emergencia TO app_user;
GRANT UPDATE (nombre, parentesco, telefono, updated_at) ON contactos_emergencia TO app_user;
GRANT DELETE ON contactos_emergencia TO app_user;

-- Nombre y telefono (cifrados; los abre la API). El paciente, siempre. El
-- tratante, solo con un motivo de emergencia, y queda en accesos_ficha.
CREATE FUNCTION datos_contactos_emergencia(p_paciente_id uuid, p_motivo text)
RETURNS TABLE (id uuid, nombre bytea, parentesco text, telefono bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'Sin acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT contacto_emergencia_propio(p_paciente_id) THEN
    IF app_rol() NOT IN ('PROFESIONAL', 'PRACTICANTE') OR NOT acceso_clinico_paciente(p_paciente_id) THEN
      RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
    END IF;
    IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
      RAISE EXCEPTION 'Indique el motivo de la emergencia'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'contactos_emergencia_motivo';
    END IF;
    INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion, detalle)
    VALUES (app_usuario_id(), app_rol()::rol, p_paciente_id, 'contactos_emergencia', 'EMERGENCIA', left(btrim(p_motivo), 200));
  END IF;
  RETURN QUERY
  SELECT c.id, c.nombre, c.parentesco, c.telefono FROM contactos_emergencia c
  WHERE c.paciente_id = p_paciente_id ORDER BY c.created_at;
END;
$$;
REVOKE EXECUTE ON FUNCTION datos_contactos_emergencia(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION datos_contactos_emergencia(uuid, text) TO app_user;

-- El tratante pide al paciente que agregue uno: solo si no tiene, a lo mas una vez por semana.
CREATE FUNCTION pedir_contacto_emergencia(p_paciente_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PROFESIONAL', 'PRACTICANTE') OR NOT acceso_clinico_paciente(p_paciente_id) THEN
    RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM contactos_emergencia WHERE paciente_id = p_paciente_id) THEN
    RAISE EXCEPTION 'El paciente ya tiene un contacto de emergencia'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contactos_emergencia_existe';
  END IF;
  IF EXISTS (SELECT 1 FROM notificaciones WHERE paciente_id = p_paciente_id AND tipo = 'CONTACTO_EMERGENCIA_PENDIENTE'
             AND canal = 'BANDEJA' AND creada_en > now() - interval '7 days') THEN
    RAISE EXCEPTION 'Ya se le pidio en los ultimos 7 dias'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'contactos_emergencia_aviso_reciente';
  END IF;
  PERFORM encolar_notificacion('CONTACTO_EMERGENCIA_PENDIENTE', p_paciente_id, NULL, p_paciente_id, app_usuario_id());
END;
$$;
REVOKE EXECUTE ON FUNCTION pedir_contacto_emergencia(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pedir_contacto_emergencia(uuid) TO app_user;

INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'CONTACTO_EMERGENCIA_PENDIENTE'::tipo_notificacion, 'PACIENTE'::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('Agrega un contacto de emergencia',
   'Hola {{nombre_paciente}}: tu profesional te pide registrar un contacto de emergencia (alguien a quien llamar si lo necesitas durante tu atención). Lo agregas en Mis datos y seguridad: {{enlace}}')
) AS e(asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);
