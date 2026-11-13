-- =============================================================================
-- Puntos 40/44 (correcciones 2026-11-10/11, aprobado): chat profesional <->
-- paciente. Antes el profesional respondia por un canal externo (CLAUDE.md lo
-- dejaba fuera de alcance; decision del usuario: entra al MVP).
--
-- Mismo registro que los mensajes del portal (mensajes_paciente: dato clinico,
-- cifrado CLINICO, append-only). La respuesta del tratante es una fila con
-- de_profesional = true y destinatario_id = la cuenta del portal a la que
-- responde (el paciente o su adulto responsable). ADMIN y GESTION nunca leen
-- contenido (sin politica para ellos). El destinatario marca leida la
-- respuesta; al llegar, el paciente recibe MENSAJE_PROFESIONAL (sin contenido).
-- =============================================================================

ALTER TABLE mensajes_paciente ADD COLUMN de_profesional boolean NOT NULL DEFAULT false;
ALTER TABLE mensajes_paciente ADD COLUMN destinatario_id uuid REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE mensajes_paciente ADD CONSTRAINT mensajes_paciente_respuesta_coherente
  CHECK (de_profesional = (destinatario_id IS NOT NULL));
CREATE INDEX mensajes_paciente_destinatario_id_idx ON mensajes_paciente (destinatario_id);

-- Cuenta del portal ligada al paciente: la suya o la de un adulto responsable.
CREATE FUNCTION cuenta_portal_de(p_paciente_id uuid, p_usuario_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = p_usuario_id AND u.paciente_id = p_paciente_id AND u.activo)
      OR EXISTS (SELECT 1 FROM adultos_responsables a JOIN usuarios u ON u.id = a.usuario_id
                 WHERE a.paciente_id = p_paciente_id AND a.usuario_id = p_usuario_id AND u.activo)
$$;

DROP POLICY mensajes_paciente_select ON mensajes_paciente;
CREATE POLICY mensajes_paciente_select ON mensajes_paciente FOR SELECT TO app_user
  USING (paciente_id = (SELECT app_paciente_id())
         OR ((SELECT app_rol()) = 'RESPONSABLE' AND (autor_id = (SELECT app_usuario_id()) OR destinatario_id = (SELECT app_usuario_id())))
         OR profesional_id = (SELECT app_usuario_id()));

DROP POLICY mensajes_paciente_insert ON mensajes_paciente;
CREATE POLICY mensajes_paciente_insert ON mensajes_paciente FOR INSERT TO app_user
  WITH CHECK (autor_id = (SELECT app_usuario_id()) AND leido_en IS NULL
              AND (
                -- Del portal al equipo tratante.
                (NOT de_profesional
                 AND (((SELECT app_rol()) = 'PACIENTE' AND paciente_id = (SELECT app_paciente_id()))
                      OR ((SELECT app_rol()) = 'RESPONSABLE' AND paciente_id IN (SELECT pacientes_a_cargo())))
                 AND profesional_id IN (SELECT equipo_tratante_de(paciente_id)))
                -- Respuesta del tratante a una cuenta del portal de ese paciente.
                OR (de_profesional
                    AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE')
                    AND profesional_id = (SELECT app_usuario_id())
                    AND profesional_id IN (SELECT equipo_tratante_de(paciente_id))
                    AND (SELECT cuenta_portal_de(paciente_id, destinatario_id)))));

-- El destinatario marca leido: el profesional los del portal; la cuenta del portal, las respuestas.
CREATE OR REPLACE FUNCTION marcar_mensaje_leido(p_mensaje_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'Sin acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE mensajes_paciente SET leido_en = now()
  WHERE id = p_mensaje_id AND leido_en IS NULL
    AND ((NOT de_profesional AND app_rol() IN ('PROFESIONAL', 'PRACTICANTE') AND profesional_id = app_usuario_id())
         OR (de_profesional AND destinatario_id = app_usuario_id()));
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM mensajes_paciente WHERE id = p_mensaje_id AND leido_en IS NOT NULL
               AND (profesional_id = app_usuario_id() OR destinatario_id = app_usuario_id())) THEN
      RAISE EXCEPTION 'El mensaje ya estaba leido' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    RAISE EXCEPTION 'Mensaje inexistente' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

-- Aviso al paciente (sin contenido: el texto clinico no viaja por correo).
CREATE FUNCTION avisar_respuesta_profesional() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM encolar_notificacion('MENSAJE_PROFESIONAL', NEW.paciente_id, NULL, NEW.id, NEW.autor_id);
  RETURN NULL;
END;
$$;
CREATE TRIGGER mensajes_paciente_aviso_respuesta AFTER INSERT ON mensajes_paciente
  FOR EACH ROW WHEN (NEW.de_profesional) EXECUTE FUNCTION avisar_respuesta_profesional();

INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'MENSAJE_PROFESIONAL'::tipo_notificacion, 'PACIENTE'::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('Tu profesional te respondió',
   'Hola {{nombre_paciente}}: tu profesional te respondió. Por tu privacidad, el mensaje solo se lee en tu cuenta: {{enlace}}')
) AS e(asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);
