-- =============================================================================
-- Correcciones 2026-11-11 (segunda vuelta).
--
-- 1. Roles flexibles (punto 4; decision del punto 36: roles fijos + asignacion
--    flexible, sin cambiar la RLS). Una cuenta del equipo (principal ADMIN,
--    GESTION o PROFESIONAL) suma como adicional cualquiera de los otros dos.
--    PRACTICANTE, PACIENTE y RESPONSABLE siguen exclusivos. Cada rol sigue
--    siendo una sesion distinta (token por rol). GESTION adicional exige
--    rol_gestion_habilitado, como el principal. Quitar un ADMIN o GESTION
--    adicional es inmediato (quitar_rol_adicional, corta sus sesiones); el
--    PROFESIONAL adicional sigue con baja programada (agenda y citas).
--
-- 2. Retencion de la reserva sin cuenta: corrige la ventana unica de 24 h de
--    20261113000100. La hora sin verificar se retiene solo el plazo corto
--    (minutos_retencion_solicitud): asi nadie bloquea agendas 24 h con correos
--    que no verifica. Al verificar el correo, el profesional tiene sus 24 h
--    completas (plazo_aprobacion) para aprobar.
--
-- 3. Aviso PROPUESTA_ACEPTADA al profesional cuando el paciente elige una de
--    las horas que le propuso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Roles flexibles
-- -----------------------------------------------------------------------------
ALTER TABLE roles_adicionales DROP CONSTRAINT roles_adicionales_solo_profesional;
ALTER TABLE roles_adicionales ADD CONSTRAINT roles_adicionales_equipo
  CHECK (rol IN ('ADMIN', 'GESTION', 'PROFESIONAL'));

CREATE OR REPLACE FUNCTION validar_rol_adicional() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol text;
  v_cerrada timestamptz;
BEGIN
  SELECT rol::text, cerrada_en INTO v_rol, v_cerrada FROM usuarios WHERE id = NEW.usuario_id;
  IF NEW.activo AND (v_rol NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL') OR v_rol = NEW.rol::text OR v_cerrada IS NOT NULL) THEN
    RAISE EXCEPTION 'Combinacion de roles invalida: solo una cuenta del equipo (cuenta madre, gestion o profesional) suma otro de esos roles'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_adicionales_combinacion';
  END IF;
  IF NEW.activo AND NEW.rol = 'GESTION' AND NOT (SELECT rol_gestion_habilitado FROM configuracion_centro FOR SHARE) THEN
    RAISE EXCEPTION 'El rol de gestion no esta habilitado en el centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_gestion_habilitado';
  END IF;
  RETURN NEW;
END;
$$;

-- Cambio del rol principal: el adicional igual al nuevo principal se apaga; uno exclusivo no conserva adicionales.
CREATE OR REPLACE FUNCTION coherencia_roles_usuario() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE roles_adicionales SET activo = false, desactivado_en = now(), fecha_baja = NULL
  WHERE usuario_id = NEW.id AND rol = NEW.rol AND activo;
  IF NEW.rol NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL')
     AND EXISTS (SELECT 1 FROM roles_adicionales WHERE usuario_id = NEW.id AND activo) THEN
    RAISE EXCEPTION 'Combinacion de roles invalida: solo una cuenta del equipo (cuenta madre, gestion o profesional) suma otro de esos roles'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_adicionales_combinacion';
  END IF;
  RETURN NULL;
END;
$$;

-- No apagar GESTION con cuentas que lo tienen activo, como principal o adicional.
CREATE OR REPLACE FUNCTION validar_desactivacion_gestion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.rol_gestion_habilitado AND NOT NEW.rol_gestion_habilitado
     AND (EXISTS (SELECT 1 FROM usuarios WHERE rol::text = 'GESTION' AND activo)
          OR EXISTS (SELECT 1 FROM roles_adicionales ra JOIN usuarios u ON u.id = ra.usuario_id
                     WHERE ra.rol = 'GESTION' AND ra.activo AND u.activo)) THEN
    RAISE EXCEPTION 'Hay usuarios GESTION activos: desactivarlos antes de deshabilitar el rol'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'configuracion_centro_gestion_activos';
  END IF;
  RETURN NEW;
END;
$$;

-- Quitar un ADMIN o GESTION adicional: inmediato (no tiene agenda); el trigger
-- roles_adicionales_revoca_sesiones corta las sesiones de ese rol. La cuenta
-- madre no se quita roles a si misma (no se queda sin acceso a mitad de la sesion).
CREATE FUNCTION quitar_rol_adicional(p_usuario_id uuid, p_rol rol) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN quita roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_rol NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'El rol profesional se da de baja con fecha (agenda y citas)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_adicionales_retiro';
  END IF;
  IF p_usuario_id = app_usuario_id() THEN
    RAISE EXCEPTION 'No puedes quitarte un rol a ti mismo: lo hace otra cuenta madre'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_adicionales_retiro_propio';
  END IF;
  UPDATE roles_adicionales SET activo = false, desactivado_en = now(), fecha_baja = NULL
  WHERE usuario_id = p_usuario_id AND rol = p_rol AND activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no tiene ese rol adicional activo' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION quitar_rol_adicional(uuid, rol) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quitar_rol_adicional(uuid, rol) TO app_user;

-- -----------------------------------------------------------------------------
-- 2 y 3. Retencion corta sin verificar, 24 h tras verificar; aviso de propuesta aceptada
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea, bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea, bytea)'::regprocedure);
  nuevo := replace(def, $q$v_expira timestamptz := CASE WHEN (SELECT 'COBROS' = ANY (coalesce(modulos_activos, '{}')) FROM configuracion_centro)
                                 THEN plazo_pago(p_inicio) ELSE plazo_aprobacion(p_inicio) END;$q$,
                        $q$v_expira timestamptz := plazo_pago(p_inicio);$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'crear_solicitud_hora no trae el plazo esperado';
  END IF;
  EXECUTE nuevo;

  def := pg_get_functiondef('concretar_reserva(uuid, bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz)'::regprocedure);
  nuevo := replace(def, $q$aprobacion_vence_en = CASE WHEN v_aprueba THEN
                       CASE WHEN c.pago_vence_en > now() THEN c.pago_vence_en ELSE plazo_aprobacion(c.inicio) END END,$q$,
                        $q$aprobacion_vence_en = CASE WHEN v_aprueba THEN plazo_aprobacion(c.inicio) END,$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'concretar_reserva no trae el plazo esperado';
  END IF;
  EXECUTE nuevo;

  def := pg_get_functiondef('aceptar_propuesta(uuid)'::regprocedure);
  nuevo := replace(def, $q$  PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);$q$,
                        $q$  PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
  PERFORM encolar_notificacion('PROPUESTA_ACEPTADA', NULL, c.profesional_id, c.id, NULL);$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'aceptar_propuesta no trae el aviso esperado';
  END IF;
  EXECUTE nuevo;

  def := pg_get_functiondef('notificaciones_por_enviar(int)'::regprocedure);
  nuevo := replace(def, $q$'CAMBIO_HORA_PROPUESTO') THEN t.referencia_id$q$,
                        $q$'CAMBIO_HORA_PROPUESTO', 'PROPUESTA_ACEPTADA') THEN t.referencia_id$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'notificaciones_por_enviar no trae la lista de avisos esperada';
  END IF;
  EXECUTE nuevo;
END $$;

CREATE OR REPLACE FUNCTION grupo_aviso_equipo(p_tipo tipo_notificacion) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_tipo IN ('CITA_CANCELADA', 'SOLICITUD_HORA', 'PROPUESTA_ACEPTADA') THEN 'AGENDA'
    WHEN p_tipo = 'DEUDA_PENDIENTE' THEN 'COBROS'
    WHEN p_tipo = 'DERIVACION_ACTUALIZADA' THEN 'DERIVACIONES'
    WHEN p_tipo IN ('MENSAJE_PACIENTE', 'MENSAJE_INTERNO') THEN 'MENSAJES'
  END
$$;

INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'PROPUESTA_ACEPTADA'::tipo_notificacion, 'EQUIPO'::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('Su paciente eligió una hora propuesta',
   'Hola {{nombre_profesional}}: su paciente eligió la hora del {{fecha}} a las {{hora}} que usted le propuso. Quedó confirmada en su agenda: {{enlace}}')
) AS e(asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);
