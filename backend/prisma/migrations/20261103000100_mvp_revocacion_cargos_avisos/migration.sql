-- Cierre hacia el MVP (decisiones del usuario, 2026-10-30):
-- 1. Revocar un acceso clinico temporal antes de su fecha. El acceso sigue
--    append-only: la revocacion es una fila aparte (A), con motivo de catalogo
--    para no guardar texto libre clinico.
-- 2. C-11: el centro decide si los cargos por inasistencia y cancelacion
--    tardia se liquidan al profesional (apagado por defecto: como hoy).
--    Una inasistencia justificada ya no cuenta como sesion liquidable.
-- 3. Avisos del equipo: correo si/no por grupo. La bandeja siempre registra.

-- -----------------------------------------------------------------------------
-- 1. Revocacion de accesos clinicos temporales
-- -----------------------------------------------------------------------------
CREATE TYPE "motivo_revocacion_acceso" AS ENUM ('TERMINO_ANTICIPADO', 'ERROR', 'SOLICITUD_PACIENTE');

CREATE TABLE "revocaciones_acceso_temporal" (
    "acceso_id" UUID NOT NULL,
    "motivo" "motivo_revocacion_acceso" NOT NULL,
    "revocado_por_id" UUID NOT NULL,
    "revocado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "revocaciones_acceso_temporal_pkey" PRIMARY KEY ("acceso_id")
);
ALTER TABLE "revocaciones_acceso_temporal" ADD CONSTRAINT "revocaciones_acceso_temporal_acceso_id_fkey" FOREIGN KEY ("acceso_id") REFERENCES "accesos_clinicos_temporales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "revocaciones_acceso_temporal" ADD CONSTRAINT "revocaciones_acceso_temporal_revocado_por_id_fkey" FOREIGN KEY ("revocado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMENT ON TABLE revocaciones_acceso_temporal IS
  'Categoria A. Corte anticipado de un acceso clinico temporal (append-only); escritura solo via revocar_acceso_temporal().';

CREATE TRIGGER revocaciones_acceso_temporal_append_only BEFORE UPDATE OR DELETE ON revocaciones_acceso_temporal
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();

ALTER TABLE revocaciones_acceso_temporal ENABLE ROW LEVEL SECURITY;
ALTER TABLE revocaciones_acceso_temporal FORCE ROW LEVEL SECURITY;
-- La ve quien ve el acceso (la RLS de accesos_clinicos_temporales filtra la subconsulta).
CREATE POLICY revocaciones_acceso_temporal_select ON revocaciones_acceso_temporal FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM accesos_clinicos_temporales a WHERE a.id = acceso_id));
CREATE POLICY revocaciones_acceso_temporal_acceso_vigente ON revocaciones_acceso_temporal AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON revocaciones_acceso_temporal TO app_user;

CREATE OR REPLACE FUNCTION acceso_temporal_vigente(p_paciente_id uuid, p_escritura boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_rol() = 'PROFESIONAL' AND EXISTS (
    SELECT 1 FROM accesos_clinicos_temporales a
    WHERE a.paciente_id = p_paciente_id AND a.profesional_id = app_usuario_id()
      AND a.desde <= now() AND a.hasta > now()
      AND NOT EXISTS (SELECT 1 FROM revocaciones_acceso_temporal r WHERE r.acceso_id = a.id)
      AND (NOT p_escritura OR a.alcance = 'LECTURA_ESCRITURA'))
$$;

CREATE OR REPLACE FUNCTION validar_profesional_de_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pacientes WHERE id = NEW.paciente_id AND profesional_id = NEW.profesional_id)
     AND NOT EXISTS (SELECT 1 FROM accesos_clinicos_temporales a
                     WHERE a.paciente_id = NEW.paciente_id AND a.profesional_id = NEW.profesional_id
                       AND a.desde <= NEW.inicio AND a.hasta >= NEW.fin
                       AND NOT EXISTS (SELECT 1 FROM revocaciones_acceso_temporal r WHERE r.acceso_id = a.id)) THEN
    RAISE EXCEPTION 'El profesional no es el tratante ni tiene acceso clinico temporal en ese horario'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_profesional_con_acceso';
  END IF;
  RETURN NEW;
END;
$$;

-- Mensaje en un hilo CASO: el revocado ya no recibe el aviso.
DO $$
DECLARE
  def text := pg_get_functiondef('avisar_mensaje_interno()'::regprocedure);
  nuevo text;
BEGIN
  nuevo := replace(def, $q$a.desde <= now() AND a.hasta > now()) x$q$,
                        $q$a.desde <= now() AND a.hasta > now()
              AND NOT EXISTS (SELECT 1 FROM revocaciones_acceso_temporal r WHERE r.acceso_id = a.id)) x$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'avisar_mensaje_interno: no se encontro el texto a reemplazar';
  END IF;
  EXECUTE nuevo;
END $$;

-- ADMIN o el tratante, los mismos que lo otorgan. Con sesiones futuras por
-- cubrir no se corta: quedarian con un profesional sin acceso a la ficha.
CREATE FUNCTION revocar_acceso_temporal(p_acceso_id uuid, p_motivo motivo_revocacion_acceso) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a accesos_clinicos_temporales%ROWTYPE;
  v_tratante uuid;
BEGIN
  SELECT * INTO a FROM accesos_clinicos_temporales WHERE id = p_acceso_id FOR UPDATE;
  SELECT profesional_id INTO v_tratante FROM pacientes WHERE id = a.paciente_id;
  IF a.id IS NULL OR NOT acceso_vigente()
     OR NOT (app_rol() = 'ADMIN' OR (app_rol() = 'PROFESIONAL' AND v_tratante = app_usuario_id())) THEN
    RAISE EXCEPTION 'Acceso temporal inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF a.hasta <= now() OR EXISTS (SELECT 1 FROM revocaciones_acceso_temporal WHERE acceso_id = a.id) THEN
    RAISE EXCEPTION 'El acceso temporal ya no esta vigente' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id = a.paciente_id AND c.profesional_id = a.profesional_id
               AND c.profesional_id IS DISTINCT FROM v_tratante AND c.inicio > now()
               AND c.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO')) THEN
    RAISE EXCEPTION 'El profesional tiene sesiones por cubrir con este paciente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'revocacion_con_sesiones_por_cubrir';
  END IF;
  INSERT INTO revocaciones_acceso_temporal (acceso_id, motivo, revocado_por_id) VALUES (a.id, p_motivo, app_usuario_id());
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion, detalle)
  VALUES (app_usuario_id(), app_rol()::rol, a.paciente_id, 'accesos_clinicos_temporales', 'ACCESO_TEMPORAL', 'revocado');
  PERFORM encolar_notificacion('ACCESO_CLINICO_REVOCADO', a.paciente_id, NULL, a.id, app_usuario_id());
  PERFORM encolar_notificacion('ACCESO_CLINICO_REVOCADO', NULL, a.profesional_id, a.id, app_usuario_id());
END;
$$;
REVOKE EXECUTE ON FUNCTION revocar_acceso_temporal(uuid, motivo_revocacion_acceso) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revocar_acceso_temporal(uuid, motivo_revocacion_acceso) TO app_user;

INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'ACCESO_CLINICO_REVOCADO'::tipo_notificacion, e.destinatario::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('PACIENTE', 'Aviso: terminó un acceso temporal a su ficha',
   'Hola {{nombre_paciente}}: {{nombre_profesional}} ya no tiene acceso temporal a su ficha. Detalle en el portal: {{enlace}}'),
  ('EQUIPO', 'Tu acceso temporal a una ficha terminó',
   'Hola {{nombre_profesional}}: tu acceso clínico temporal a una ficha fue revocado antes de su fecha de término.')
) AS e(destinatario, asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);

CREATE OR REPLACE FUNCTION categoria_evento(p_tipo tipo_notificacion) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_tipo IN ('CONSENTIMIENTO_SOLICITADO', 'CONSENTIMIENTO_POR_VENCER', 'AVISO_CAMBIO_SUPERVISOR', 'DOCUMENTO_CLINICO',
                    'ACCESO_CLINICO_TEMPORAL', 'ACCESO_CLINICO_REVOCADO')
      THEN 'LEGAL'
    WHEN p_tipo = 'RECORDATORIO_CITA' THEN 'RECORDATORIO'
    ELSE 'OPERATIVO'
  END
$$;

CREATE OR REPLACE FUNCTION notificar(p_tipo tipo_notificacion, p_paciente_id uuid, p_usuario_id uuid, p_referencia_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente()
     OR p_tipo IN ('DERIVACION_OFRECIDA', 'DERIVACION_ACTUALIZADA', 'RECORDATORIO_CITA', 'CONSENTIMIENTO_POR_VENCER',
                   'HORA_LIBERADA', 'ACCESO_CLINICO_TEMPORAL', 'ACCESO_CLINICO_REVOCADO', 'SOLICITUD_HORA') THEN
    RAISE EXCEPTION 'Aviso no permitido desde la API' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM encolar_notificacion(p_tipo, p_paciente_id, p_usuario_id, p_referencia_id, app_usuario_id());
END;
$$;

-- El job arma {{nombre_profesional}} igual que en el aviso de acceso.
DO $$
DECLARE
  def text := pg_get_functiondef('notificaciones_por_enviar(integer)'::regprocedure);
  nuevo text;
BEGIN
  nuevo := replace(def, $q$WHEN t.tipo = 'ACCESO_CLINICO_TEMPORAL'$q$,
                        $q$WHEN t.tipo IN ('ACCESO_CLINICO_TEMPORAL', 'ACCESO_CLINICO_REVOCADO')$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'notificaciones_por_enviar: no se encontro el texto a reemplazar';
  END IF;
  EXECUTE nuevo;
END $$;

-- -----------------------------------------------------------------------------
-- 2. C-11: cargos por inasistencia y cancelacion tardia en la liquidacion
-- -----------------------------------------------------------------------------
ALTER TABLE "configuracion_centro" ADD COLUMN "liquidar_cargos_a_profesional" BOOLEAN NOT NULL DEFAULT false;
GRANT UPDATE (liquidar_cargos_a_profesional) ON configuracion_centro TO app_user;

ALTER TABLE "liquidaciones" ADD COLUMN "cargos_liquidados" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE liquidaciones ADD CONSTRAINT liquidaciones_cargos_liquidados CHECK (cargos_liquidados BETWEEN 0 AND total_cobrado);

-- Una inasistencia justificada (TRASLADO o DEVOLUCION de una cita ya terminada)
-- no es una sesion realizada: lo pagado se traslado o se devolvio.
CREATE OR REPLACE FUNCTION cita_liquidable(p_cita_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cita_realizada(p_cita_id)
         AND NOT EXISTS (SELECT 1 FROM resoluciones_cita r WHERE r.cita_id = p_cita_id AND r.inasistencia_justificada)
         AND (NOT (SELECT liquidar_exige_evolucion FROM configuracion_centro)
              OR EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = p_cita_id))
$$;

-- Lo retenido por el centro como cargo de una cita no realizada: lo exigible,
-- con tope en lo pagado (lo demas se devuelve). 0 si el centro no lo liquida.
-- Interna: la usa generar_liquidacion.
CREATE FUNCTION cargo_cita(p_cita_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT least(r.monto_exigible,
                 (SELECT coalesce(sum(p.monto), 0) FROM pagos p
                  WHERE p.cita_id = r.cita_id AND p.estado = 'REGISTRADO' AND p.cobrado_por = 'CENTRO'))::int
    FROM resoluciones_cita r CROSS JOIN configuracion_centro cc
    WHERE r.cita_id = p_cita_id AND cc.liquidar_cargos_a_profesional AND r.decision IN ('INASISTENCIA', 'DEVOLUCION')), 0)
$$;
REVOKE EXECUTE ON FUNCTION cargo_cita(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION proteger_liquidacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (OLD.estado <> 'BORRADOR' AND NOT (OLD.estado = 'EMITIDA' AND NEW.estado = 'PAGADA'
         AND (NEW.total_cobrado, NEW.cargos_liquidados, NEW.comision, NEW.comision_derivacion, NEW.sesiones_derivadas, NEW.arriendos, NEW.total, NEW.emitida_en)
             IS NOT DISTINCT FROM (OLD.total_cobrado, OLD.cargos_liquidados, OLD.comision, OLD.comision_derivacion, OLD.sesiones_derivadas, OLD.arriendos, OLD.total, OLD.emitida_en)))
     OR (NEW.id, NEW.profesional_id, NEW.periodo_desde, NEW.periodo_hasta, NEW.creada_en)
        IS DISTINCT FROM (OLD.id, OLD.profesional_id, OLD.periodo_desde, OLD.periodo_hasta, OLD.creada_en) THEN
    RAISE EXCEPTION 'Una liquidacion emitida no se modifica ni se borra' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Igual que 03b-4.2, mas los cargos: entran a lo cobrado y pagan la misma
-- comision; `cargos_liquidados` los muestra aparte.
CREATE OR REPLACE FUNCTION generar_liquidacion(p_profesional_id uuid, p_desde date, p_hasta date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cobrado int;
  v_cargos int;
  v_propio int;
  v_derivadas int;
  v_der numeric;
  v_pct numeric(5,2);
  v_tipo tipo_comision_derivacion;
  v_comision int;
  v_comision_der int;
  v_arriendos int;
  v_id uuid;
  v_estado estado_liquidacion;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION liquidan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT tiene_rol(p_profesional_id, 'PROFESIONAL') OR p_hasta <= p_desde THEN
    RAISE EXCEPTION 'Liquidacion: un PROFESIONAL y un periodo valido'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'liquidaciones_coherente';
  END IF;
  SELECT coalesce(sum(x.cobrado), 0), coalesce(sum(x.cobrado) FILTER (WHERE x.es_cargo), 0),
         coalesce(sum(x.cobrado) FILTER (WHERE NOT x.traido), 0),
         count(*) FILTER (WHERE x.traido), coalesce(sum(comision_derivacion_cita(x.cobrado)) FILTER (WHERE x.traido), 0)
  INTO v_cobrado, v_cargos, v_propio, v_derivadas, v_der
  FROM (SELECT c.id, coalesce(pa.traido_por_centro, false) AS traido, NOT cita_liquidable(c.id) AS es_cargo,
               CASE WHEN cita_liquidable(c.id) THEN sum(p.monto)::int ELSE cargo_cita(c.id) END AS cobrado
        FROM pagos p JOIN citas c ON c.id = p.cita_id
        LEFT JOIN pacientes pa ON pa.id = c.paciente_id
        WHERE c.profesional_id = p_profesional_id AND p.estado = 'REGISTRADO' AND p.cobrado_por = 'CENTRO'
          AND (c.inicio AT TIME ZONE 'America/Santiago')::date >= p_desde
          AND (c.inicio AT TIME ZONE 'America/Santiago')::date < p_hasta
          AND (cita_liquidable(c.id) OR cargo_cita(c.id) > 0)
        GROUP BY c.id, pa.traido_por_centro) x;
  SELECT comision_centro_porcentaje, comision_derivacion_tipo INTO v_pct, v_tipo FROM configuracion_centro;
  v_comision := round(greatest(v_propio, 0) * v_pct / 100 + v_der);
  IF v_tipo = 'GENERAL' THEN
    v_comision_der := 0;
    v_derivadas := 0;
  ELSE
    v_comision_der := least(round(v_der), v_comision);
  END IF;
  SELECT coalesce(sum(monto), 0) INTO v_arriendos FROM arriendos
  WHERE profesional_id = p_profesional_id AND periodo_desde >= p_desde AND periodo_desde < p_hasta;

  SELECT id, estado INTO v_id, v_estado FROM liquidaciones
  WHERE profesional_id = p_profesional_id AND periodo_desde = p_desde AND periodo_hasta = p_hasta FOR UPDATE;
  IF v_estado IS NOT NULL AND v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La liquidacion del periodo ya fue emitida' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO liquidaciones (profesional_id, periodo_desde, periodo_hasta, total_cobrado, cargos_liquidados, comision_porcentaje, comision,
                               comision_derivacion, sesiones_derivadas, arriendos, total, creada_por_id)
    VALUES (p_profesional_id, p_desde, p_hasta, v_cobrado, v_cargos, v_pct, v_comision, v_comision_der, v_derivadas, v_arriendos,
            v_cobrado - v_comision - v_arriendos, app_usuario_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE liquidaciones SET total_cobrado = v_cobrado, cargos_liquidados = v_cargos, comision_porcentaje = v_pct, comision = v_comision,
                             comision_derivacion = v_comision_der, sesiones_derivadas = v_derivadas,
                             arriendos = v_arriendos, total = v_cobrado - v_comision - v_arriendos
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Avisos del equipo: correo si/no por grupo
-- -----------------------------------------------------------------------------
CREATE TABLE "preferencias_aviso_equipo" (
    "usuario_id" UUID NOT NULL,
    "agenda" BOOLEAN NOT NULL DEFAULT true,
    "cobros" BOOLEAN NOT NULL DEFAULT true,
    "derivaciones" BOOLEAN NOT NULL DEFAULT true,
    "mensajes" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "preferencias_aviso_equipo_pkey" PRIMARY KEY ("usuario_id")
);
ALTER TABLE "preferencias_aviso_equipo" ADD CONSTRAINT "preferencias_aviso_equipo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMENT ON TABLE preferencias_aviso_equipo IS
  'Categoria A. Avisos que cada integrante recibe por correo. Sin fila = todos. La bandeja registra todo.';

ALTER TABLE preferencias_aviso_equipo ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferencias_aviso_equipo FORCE ROW LEVEL SECURITY;
CREATE POLICY preferencias_aviso_equipo_propias ON preferencias_aviso_equipo FOR ALL TO app_user
  USING (usuario_id = (SELECT app_usuario_id())) WITH CHECK (usuario_id = (SELECT app_usuario_id()));
CREATE POLICY preferencias_aviso_equipo_acceso_vigente ON preferencias_aviso_equipo AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT, INSERT ON preferencias_aviso_equipo TO app_user;
GRANT UPDATE (agenda, cobros, derivaciones, mensajes, updated_at) ON preferencias_aviso_equipo TO app_user;

-- NULL = no se apaga: oferta de derivacion con plazo, cierre requerido,
-- posible duplicado y avisos legales.
CREATE FUNCTION grupo_aviso_equipo(p_tipo tipo_notificacion) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_tipo IN ('CITA_CANCELADA', 'SOLICITUD_HORA') THEN 'AGENDA'
    WHEN p_tipo = 'DEUDA_PENDIENTE' THEN 'COBROS'
    WHEN p_tipo = 'DERIVACION_ACTUALIZADA' THEN 'DERIVACIONES'
    WHEN p_tipo IN ('MENSAJE_PACIENTE', 'MENSAJE_INTERNO') THEN 'MENSAJES'
  END
$$;

CREATE OR REPLACE FUNCTION encolar_notificacion(p_tipo tipo_notificacion, p_paciente_id uuid, p_usuario_id uuid,
                                                p_referencia_id uuid, p_creada_por uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_destinatario destinatario_mensaje := CASE WHEN p_paciente_id IS NOT NULL THEN 'PACIENTE' ELSE 'EQUIPO' END;
  v_categoria text := categoria_evento(p_tipo);
  v_grupo text := grupo_aviso_equipo(p_tipo);
BEGIN
  INSERT INTO notificaciones (tipo, canal, paciente_id, usuario_id, referencia_id, creada_por_id)
  VALUES (p_tipo, 'BANDEJA', p_paciente_id, p_usuario_id, p_referencia_id, p_creada_por);
  IF EXISTS (SELECT 1 FROM plantillas_mensaje WHERE evento = p_tipo AND destinatario = v_destinatario
               AND canal = 'CORREO' AND activa)
     AND (CASE
           WHEN v_destinatario = 'EQUIPO' THEN NOT EXISTS (
             SELECT 1 FROM preferencias_aviso_equipo pe WHERE pe.usuario_id = p_usuario_id
               AND NOT CASE v_grupo WHEN 'AGENDA' THEN pe.agenda WHEN 'COBROS' THEN pe.cobros
                                    WHEN 'DERIVACIONES' THEN pe.derivaciones WHEN 'MENSAJES' THEN pe.mensajes
                                    ELSE true END)
           WHEN v_categoria = 'LEGAL' THEN true
           ELSE NOT EXISTS (
             SELECT 1 FROM preferencias_notificacion pr WHERE pr.paciente_id = p_paciente_id
               AND NOT CASE WHEN v_categoria = 'RECORDATORIO' THEN pr.recordatorios ELSE pr.avisos_operativos END)
         END) THEN
    INSERT INTO notificaciones (tipo, canal, paciente_id, usuario_id, referencia_id, creada_por_id)
    VALUES (p_tipo, 'CORREO', p_paciente_id, p_usuario_id, p_referencia_id, p_creada_por);
  END IF;
END;
$$;
