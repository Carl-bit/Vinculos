-- =============================================================================
-- AUD-01 (E2.3b; ARCOP-08; decision D2 con la variante aprobada el
-- 2026-10-28): solicitud de derechos sin cuenta, por RUT.
--
-- * La pantalla responde SIEMPRE lo mismo (no revela si el RUT es paciente:
--   ser paciente de un centro psicologico ya es un dato de salud).
-- * Por dentro: si el RUT es de un paciente, se registra la solicitud
--   (canal FORMULARIO_PUBLICO, plazo de 30 dias habiles) y se avisa SOLO al
--   correo ya registrado. Si pide cambiar el correo, no se cambia: queda
--   marcado para que el centro verifique la identidad y lo cambie el.
-- * Sin contexto (formulario publico); a lo mas 3 por paciente en 24 horas
--   (las demas se descartan en silencio). Si el RUT no existe, no se guarda
--   nada.
-- =============================================================================

ALTER TABLE solicitudes_derechos ADD COLUMN "pide_cambio_correo" BOOLEAN NOT NULL DEFAULT false;

-- Devuelve el correo registrado del paciente (para el aviso) o NULL si no se registro nada.
CREATE FUNCTION registrar_solicitud_publica(p_id uuid, p_tipo tipo_derecho, p_rut_hmac bytea, p_detalle bytea,
                                            p_cambio_correo boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p pacientes%ROWTYPE;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el formulario publico' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO p FROM pacientes WHERE rut_hmac = p_rut_hmac AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF (SELECT count(*) FROM solicitudes_derechos
      WHERE paciente_id = p.id AND canal = 'FORMULARIO_PUBLICO' AND recibida_en > now() - interval '24 hours') >= 3 THEN
    RETURN NULL;
  END IF;
  INSERT INTO solicitudes_derechos (id, tipo, paciente_id, canal, vence_el, detalle, pide_cambio_correo)
  VALUES (p_id, p_tipo, p.id, 'FORMULARIO_PUBLICO', dias_habiles_desde((now() AT TIME ZONE 'America/Santiago')::date, 30),
          p_detalle, coalesce(p_cambio_correo, false));
  RETURN p.email;
END;
$$;
REVOKE EXECUTE ON FUNCTION registrar_solicitud_publica(uuid, tipo_derecho, bytea, bytea, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_solicitud_publica(uuid, tipo_derecho, bytea, bytea, boolean) TO app_user;
