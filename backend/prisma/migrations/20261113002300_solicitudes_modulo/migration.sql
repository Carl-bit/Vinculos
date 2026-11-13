-- =============================================================================
-- Tarea 31 / R2 y R3 (Vinculos Control, 2026-11-13): el ADMIN pide activar o
-- desactivar un modulo; el plano de control la recoge por /api/internal/* y
-- devuelve el estado. Solo el operador cambia modulos_activos (sin cambios).
--
-- solicitudes_modulo: categoria A (pedida_por identifica a la cuenta del
-- equipo). RLS: solo ADMIN lee; nadie escribe directo (sin GRANT de escritura).
-- Escritura solo con funciones SECURITY DEFINER:
--   solicitar_modulo()            ADMIN, valida estado y dependencias
--   solicitudes_modulo_internas() plano de control (token del silo), sin
--                                 motivo ni pedida_por: solo modulo, accion,
--                                 rol, fechas y estado
--   responder_solicitud_modulo()  plano de control (token del silo)
-- Una sola solicitud abierta (PENDIENTE o APROBADA) por modulo.
-- MVP (2026-11-11): COBROS y WHATSAPP no se pueden pedir.
-- =============================================================================

CREATE TYPE "accion_modulo" AS ENUM ('ACTIVAR', 'DESACTIVAR');
CREATE TYPE "estado_solicitud_modulo" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'APLICADA');

CREATE TABLE "solicitudes_modulo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "modulo" "modulo_centro" NOT NULL,
    "accion" "accion_modulo" NOT NULL,
    "motivo" TEXT,
    "pedida_por" UUID NOT NULL,
    "pedida_por_rol" "rol" NOT NULL,
    "pedida_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "estado_solicitud_modulo" NOT NULL DEFAULT 'PENDIENTE',
    "respuesta" TEXT,
    "respondida_en" TIMESTAMPTZ(6),
    "actualizada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitudes_modulo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "solicitudes_modulo_actualizada_en_idx" ON "solicitudes_modulo"("actualizada_en");

ALTER TABLE "solicitudes_modulo" ADD CONSTRAINT "solicitudes_modulo_pedida_por_fkey" FOREIGN KEY ("pedida_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE solicitudes_modulo ADD CONSTRAINT solicitudes_modulo_textos
  CHECK ((motivo IS NULL OR char_length(motivo) <= 300) AND (respuesta IS NULL OR char_length(respuesta) <= 300));
ALTER TABLE solicitudes_modulo ADD CONSTRAINT solicitudes_modulo_respondida
  CHECK ((estado = 'PENDIENTE') = (respondida_en IS NULL));
CREATE UNIQUE INDEX solicitudes_modulo_una_abierta ON solicitudes_modulo (modulo)
  WHERE estado IN ('PENDIENTE', 'APROBADA');

ALTER TABLE solicitudes_modulo ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_modulo FORCE ROW LEVEL SECURITY;
CREATE POLICY solicitudes_modulo_select ON solicitudes_modulo FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY solicitudes_modulo_acceso_vigente ON solicitudes_modulo AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON solicitudes_modulo TO app_user;

-- -----------------------------------------------------------------------------
-- ADMIN: pedir. Valida contra modulos_activos() y las dependencias de
-- Vinculos Control: MATCH y PAGINA_PUBLICA requieren EQUIPO; COBROS requiere
-- AGENDA; no se desactiva un modulo del que depende otro activo.
-- -----------------------------------------------------------------------------
CREATE FUNCTION solicitar_modulo(p_modulo modulo_centro, p_accion accion_modulo, p_motivo text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_activos modulo_centro[] := modulos_activos();
  v_id uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo la cuenta madre (ADMIN) solicita modulos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_modulo IN ('COBROS', 'WHATSAPP') THEN
    RAISE EXCEPTION 'El modulo % no esta disponible en esta version', p_modulo
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_disponible';
  END IF;
  IF p_accion = 'ACTIVAR' THEN
    IF p_modulo = ANY (v_activos) THEN
      RAISE EXCEPTION 'El modulo % ya esta activo', p_modulo
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_estado';
    END IF;
    IF p_modulo IN ('MATCH', 'PAGINA_PUBLICA') AND NOT 'EQUIPO' = ANY (v_activos) THEN
      RAISE EXCEPTION 'El modulo % requiere EQUIPO activo: solicita primero EQUIPO', p_modulo
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_dependencias';
    END IF;
  ELSE
    IF NOT p_modulo = ANY (v_activos) THEN
      RAISE EXCEPTION 'El modulo % no esta activo', p_modulo
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_estado';
    END IF;
    IF p_modulo = 'EQUIPO' AND ('MATCH' = ANY (v_activos) OR 'PAGINA_PUBLICA' = ANY (v_activos)) THEN
      RAISE EXCEPTION 'MATCH y PAGINA_PUBLICA dependen de EQUIPO: desactivalos primero'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_dependencias';
    END IF;
    IF p_modulo = 'AGENDA' AND 'COBROS' = ANY (v_activos) THEN
      RAISE EXCEPTION 'COBROS depende de AGENDA: desactivalo primero'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_dependencias';
    END IF;
  END IF;
  INSERT INTO solicitudes_modulo (modulo, accion, motivo, pedida_por, pedida_por_rol)
  VALUES (p_modulo, p_accion, nullif(btrim(p_motivo), ''), app_usuario_id(), 'ADMIN')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION solicitar_modulo(modulo_centro, accion_modulo, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION solicitar_modulo(modulo_centro, accion_modulo, text) TO app_user;

-- -----------------------------------------------------------------------------
-- R2: lectura del plano de control. Sin contexto de usuario y con el token del
-- silo (interno_token_valido). Sin motivo ni pedida_por: nada personal sale.
-- -----------------------------------------------------------------------------
CREATE FUNCTION solicitudes_modulo_internas(p_token text, p_desde timestamptz)
RETURNS TABLE (id uuid, modulo modulo_centro, accion accion_modulo, pedida_por_rol rol,
               pedida_en timestamptz, estado estado_solicitud_modulo, respondida_en timestamptz,
               actualizada_en timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT interno_token_valido(p_token) OR app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el plano de control (token del silo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT s.id, s.modulo, s.accion, s.pedida_por_rol, s.pedida_en, s.estado, s.respondida_en, s.actualizada_en
    FROM solicitudes_modulo s
    WHERE p_desde IS NULL OR s.actualizada_en > p_desde
    ORDER BY s.actualizada_en, s.id
    LIMIT 500;
END;
$$;
REVOKE EXECUTE ON FUNCTION solicitudes_modulo_internas(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION solicitudes_modulo_internas(text, timestamptz) TO app_user;

-- -----------------------------------------------------------------------------
-- R3: respuesta del plano de control. Transiciones: PENDIENTE -> APROBADA |
-- RECHAZADA; APROBADA -> APLICADA | RECHAZADA. Repetir el mismo estado no hace
-- nada (el agente reintenta). APLICADA exige que modulos_activos ya refleje la
-- accion (la aplica el operador; con R4, el job reconfigurar).
-- -----------------------------------------------------------------------------
CREATE FUNCTION responder_solicitud_modulo(p_token text, p_id uuid, p_estado estado_solicitud_modulo, p_respuesta text)
RETURNS estado_solicitud_modulo
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s solicitudes_modulo%ROWTYPE;
  v_activo boolean;
BEGIN
  IF NOT interno_token_valido(p_token) OR app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el plano de control (token del silo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM solicitudes_modulo WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF s.estado = p_estado THEN
    RETURN s.estado;
  END IF;
  IF NOT ((s.estado = 'PENDIENTE' AND p_estado IN ('APROBADA', 'RECHAZADA'))
          OR (s.estado = 'APROBADA' AND p_estado IN ('APLICADA', 'RECHAZADA'))) THEN
    RAISE EXCEPTION 'Transicion no permitida: % -> %', s.estado, p_estado
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_transicion';
  END IF;
  IF p_estado = 'APLICADA' THEN
    v_activo := s.modulo = ANY (modulos_activos());
    IF v_activo IS DISTINCT FROM (s.accion = 'ACTIVAR') THEN
      RAISE EXCEPTION 'modulos_activos aun no refleja la solicitud (%, %)', s.accion, s.modulo
        USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_modulo_aplicada';
    END IF;
  END IF;
  UPDATE solicitudes_modulo
     SET estado = p_estado,
         respuesta = nullif(btrim(p_respuesta), ''),
         respondida_en = now(),
         actualizada_en = now()
   WHERE id = p_id;
  RETURN p_estado;
END;
$$;
REVOKE EXECUTE ON FUNCTION responder_solicitud_modulo(text, uuid, estado_solicitud_modulo, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION responder_solicitud_modulo(text, uuid, estado_solicitud_modulo, text) TO app_user;
