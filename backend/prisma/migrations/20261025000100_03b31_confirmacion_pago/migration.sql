-- =============================================================================
-- 03b-3.1: la confirmacion de la cita depende del medio de pago.
--
-- Estados (la hora queda bloqueada en todos salvo LIBERADA y CANCELADA):
--   RETENIDA       estado de la RESERVA, no de la cita: solicitud sin cuenta
--                  con la hora retenida (bloqueos_temporales) mientras se
--                  verifica el correo. Asi no se crea paciente ni ficha (que
--                  nunca se borran) para un correo que nadie verifico.
--   PENDIENTE_PAGO cita con correo verificado esperando el pago: medio por
--                  elegir, transferencia por validar o pasarela en curso.
--                  Vence en citas.pago_vence_en (plazo de validacion, siempre
--                  antes del inicio).
--   CONFIRMADA     pago validado, medio "pago en el centro" o nada que cobrar.
--   LIBERADA       vencio el plazo de pago: la hora vuelve a estar libre y se
--                  avisa al paciente (HORA_LIBERADA). La reserva vencida sin
--                  verificar queda EXPIRADA (solicitudes_hora) y se informa
--                  como LIBERADA en estado_reserva().
--   SOLICITADA     sin cambios: profesionales que aprueban pacientes nuevos.
-- El vencimiento lo decide el job liberar_reservas_vencidas (cada minuto),
-- nunca el cliente.
--
-- Medios (configuracion_centro.medios_pago_habilitados; sin el modulo COBROS
-- solo cuenta PAGO_EN_CENTRO):
--   PAGO_EN_CENTRO confirma al verificar (si es el unico medio) o al elegirlo.
--   TRANSFERENCIA  datos bancarios del centro (cuenta_bancaria_centro) o del
--                  profesional con cobro directo; comprobante opcional
--                  (transferencias, cifrado); valida GESTION/ADMIN (cobro del
--                  centro) o el profesional (cobro directo): registra el pago
--                  y confirma. Rechazar deja el motivo y avisa al paciente.
--   PASARELA       cobros_pasarela; el webhook (idempotente, verificado por la
--                  API) registra el pago y confirma. En el centro de
--                  demostracion la pasarela es simulada (integraciones.md).
--
-- Reserva consultable: solicitudes_hora.reserva_hash (SHA-256 de un token
-- opaco que la API entrega al retener). estado_reserva() devuelve solo estado,
-- vencimiento y siguiente paso. Verificacion tardia: si la retencion vencio y
-- la hora sigue libre, la solicitud se concreta igual; si no, 23P01 y la API
-- responde con alternativas.
--
-- Categorias: cuenta_bancaria_centro = A (dato bancario cifrado);
-- transferencias = A (comprobante cifrado); cobros_pasarela = A (pago de una
-- cita). Escrituras con reglas de estado solo via funciones.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configuracion del centro
-- -----------------------------------------------------------------------------
-- CreateEnum
CREATE TYPE "medio_confirmacion" AS ENUM ('PAGO_EN_CENTRO', 'TRANSFERENCIA', 'PASARELA');

-- CreateEnum
CREATE TYPE "estado_transferencia" AS ENUM ('POR_VALIDAR', 'VALIDADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "estado_cobro_pasarela" AS ENUM ('PENDIENTE', 'PAGADO', 'FALLIDO');

-- AlterTable
ALTER TABLE "configuracion_centro" ADD COLUMN "medios_pago_habilitados" "medio_confirmacion"[] DEFAULT ARRAY['PAGO_EN_CENTRO']::"medio_confirmacion"[],
ADD COLUMN "plazo_validacion_transferencia_horas" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN "porcentaje_pago_confirmacion" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_medios_pago
  CHECK (medios_pago_habilitados IS NOT NULL AND cardinality(medios_pago_habilitados) BETWEEN 1 AND 3
         AND array_position(medios_pago_habilitados, NULL) IS NULL
         AND plazo_validacion_transferencia_horas BETWEEN 1 AND 168
         AND porcentaje_pago_confirmacion BETWEEN 1 AND 100);
-- ADMIN las edita (politica configuracion_centro_update); GRANT por columna como el resto.
GRANT UPDATE (medios_pago_habilitados, plazo_validacion_transferencia_horas, porcentaje_pago_confirmacion)
  ON configuracion_centro TO app_user;

-- Cuenta del centro para transferencias (A). Una sola fila; datos cifrados
-- (FINANCIERO/IDENTIFICACION, AAD con el id que genera la API).
-- CreateTable
CREATE TABLE "cuenta_bancaria_centro" (
    "id" UUID NOT NULL,
    "rut" BYTEA NOT NULL,
    "banco" BYTEA NOT NULL,
    "tipo_cuenta" BYTEA NOT NULL,
    "numero_cuenta" BYTEA NOT NULL,
    "titular" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuenta_bancaria_centro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX cuenta_bancaria_centro_unica ON cuenta_bancaria_centro ((true));
ALTER TABLE cuenta_bancaria_centro ADD CONSTRAINT cuenta_bancaria_centro_cifrado
  CHECK (octet_length(rut) >= 49 AND octet_length(banco) >= 49 AND octet_length(tipo_cuenta) >= 49
         AND octet_length(numero_cuenta) >= 49 AND octet_length(titular) >= 49);
ALTER TABLE cuenta_bancaria_centro ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuenta_bancaria_centro FORCE ROW LEVEL SECURITY;
CREATE POLICY cuenta_bancaria_centro_select ON cuenta_bancaria_centro FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY cuenta_bancaria_centro_insert ON cuenta_bancaria_centro FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY cuenta_bancaria_centro_update ON cuenta_bancaria_centro FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY cuenta_bancaria_centro_acceso_vigente ON cuenta_bancaria_centro AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT, INSERT ON cuenta_bancaria_centro TO app_user;
GRANT UPDATE (rut, banco, tipo_cuenta, numero_cuenta, titular, updated_at) ON cuenta_bancaria_centro TO app_user;

-- Transferencia habilitada exige donde transferir: la cuenta del centro
-- (salvo modelo DIRECTO, donde cada profesional tiene la suya).
CREATE FUNCTION validar_medios_pago() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF 'TRANSFERENCIA' = ANY (NEW.medios_pago_habilitados) AND NEW.modelo_cobro <> 'DIRECTO'
     AND NOT EXISTS (SELECT 1 FROM cuenta_bancaria_centro) THEN
    RAISE EXCEPTION 'Para habilitar transferencia, registre primero la cuenta bancaria del centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'configuracion_centro_transferencia_sin_cuenta';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER configuracion_centro_medios_pago_validos BEFORE UPDATE OF medios_pago_habilitados, modelo_cobro
  ON configuracion_centro FOR EACH ROW EXECUTE FUNCTION validar_medios_pago();

-- Medios que valen hoy: sin el modulo COBROS, solo pagar en el centro.
CREATE FUNCTION medios_confirmacion_vigentes() RETURNS medio_confirmacion[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN 'COBROS' = ANY (coalesce(modulos_activos, '{}')) THEN medios_pago_habilitados
              ELSE ARRAY['PAGO_EN_CENTRO']::medio_confirmacion[] END
  FROM configuracion_centro
$$;

-- -----------------------------------------------------------------------------
-- 2. Citas: estado de pago
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "citas" ADD COLUMN "medio_confirmacion" "medio_confirmacion",
ADD COLUMN "pago_vence_en" TIMESTAMPTZ(6);

ALTER TABLE citas ADD CONSTRAINT citas_pago_coherente
  CHECK (estado <> 'PENDIENTE_PAGO' OR pago_vence_en IS NOT NULL);

-- La hora pendiente de pago tambien esta ocupada (EXCLUDE = fuente de verdad).
ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_espacio;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_espacio
  EXCLUDE USING gist (espacio_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'SOLICITADA', 'PENDIENTE_PAGO') AND modalidad = 'PRESENCIAL');
ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_profesional;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_profesional
  EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'SOLICITADA', 'PENDIENTE_PAGO'));

-- La API (app_user) no mueve el estado de pago: solo las funciones del flujo
-- (SECURITY DEFINER). Puede cancelar una cita pendiente de pago.
CREATE FUNCTION proteger_estado_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA') OR NEW.medio_confirmacion IS NOT NULL OR NEW.pago_vence_en IS NOT NULL THEN
      RAISE EXCEPTION 'El estado de pago de la cita solo lo fija el flujo de confirmacion' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.medio_confirmacion IS DISTINCT FROM OLD.medio_confirmacion OR NEW.pago_vence_en IS DISTINCT FROM OLD.pago_vence_en
        OR (NEW.estado IS DISTINCT FROM OLD.estado
            AND (NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA') OR OLD.estado = 'LIBERADA'
                 OR (OLD.estado = 'PENDIENTE_PAGO' AND NEW.estado <> 'CANCELADA'))) THEN
    RAISE EXCEPTION 'El estado de pago de la cita solo lo fija el flujo de confirmacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER citas_estado_pago_protegido BEFORE INSERT OR UPDATE ON citas
  FOR EACH ROW EXECUTE FUNCTION proteger_estado_pago();

-- Las funciones que tratan ('CONFIRMADA', 'SOLICITADA') como "hora ocupada"
-- (disponibilidad, validacion de agenda y del menor, ocupacion de boxes,
-- bloques con citas, bajas, proxima sesion) cuentan tambien PENDIENTE_PAGO.
-- Se reescribe solo esa lista, sobre la definicion vigente de cada una; si en
-- alguna no aparece, la migracion falla.
DO $$
DECLARE
  f text;
  def text;
  nuevo text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'disponibilidad_publica(uuid, timestamptz, timestamptz)', 'estado_fichas_profesional(uuid)',
    'iniciar_baja_profesional(uuid, timestamptz)', 'iniciar_baja_rol(uuid, rol, timestamptz)',
    'ocupacion_espacios(timestamptz, timestamptz)', 'procesar_bajas()', 'proteger_bloque_atencion()',
    'validar_agenda_cita()', 'validar_menor_con_adulto_responsable()'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def, $q$IN ('CONFIRMADA', 'SOLICITADA')$q$, $q$IN ('CONFIRMADA', 'SOLICITADA', 'PENDIENTE_PAGO')$q$);
    IF nuevo = def THEN
      RAISE EXCEPTION 'La funcion % no trae la lista de estados esperada', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;
  -- Reporte de cobros: la cita LIBERADA, como la CANCELADA, no tiene monto exigible.
  def := pg_get_functiondef('reporte_cobros(date, date)'::regprocedure);
  nuevo := replace(def, $q$WHEN c.estado = 'CANCELADA' THEN 0$q$, $q$WHEN c.estado IN ('CANCELADA', 'LIBERADA') THEN 0$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'reporte_cobros no trae la condicion esperada';
  END IF;
  EXECUTE nuevo;
END $$;

-- Saldo: la cita LIBERADA no se cobra (como la CANCELADA).
CREATE OR REPLACE VIEW estado_pago_citas WITH (security_invoker = true) AS
 SELECT c.id AS cita_id,
    c.profesional_id,
    c.paciente_id,
    c.estado AS estado_cita,
    c.inicio,
    c.fin,
    c.monto,
    x.exigible,
    x.pagado,
    x.devolucion,
    GREATEST((x.exigible - (x.pagado - x.devolucion)), 0) AS saldo,
        CASE
            WHEN (x.exigible = 0) THEN 'SIN_COBRO'::text
            WHEN ((x.pagado - x.devolucion) >= x.exigible) THEN 'PAGADO'::text
            WHEN ((x.pagado - x.devolucion) > 0) THEN 'PARCIAL'::text
            ELSE 'PENDIENTE'::text
        END AS estado_pago
   FROM ((citas c
     LEFT JOIN resoluciones_cita r ON ((r.cita_id = c.id)))
     CROSS JOIN LATERAL ( SELECT COALESCE(r.monto_exigible,
                CASE
                    WHEN (c.estado IN ('CANCELADA'::estado_cita, 'LIBERADA'::estado_cita)) THEN 0
                    ELSE COALESCE(c.monto, 0)
                END) AS exigible,
            (COALESCE(( SELECT sum(p.monto) AS sum
                   FROM pagos p
                  WHERE ((p.cita_id = c.id) AND (p.estado = 'REGISTRADO'::estado_pago))), (0)::bigint))::integer AS pagado,
            COALESCE(r.monto_devolucion, 0) AS devolucion) x)
  WHERE ((( SELECT app_rol() AS app_rol) IS DISTINCT FROM 'PRACTICANTE'::text) AND ((( SELECT app_rol() AS app_rol) IS DISTINCT FROM 'PACIENTE'::text) OR (c.paciente_id IN ( SELECT app_pacientes_plenos() AS app_pacientes_plenos))));

-- El monto se fija tambien al quedar pendiente de pago (para saber cuanto cobrar).
CREATE OR REPLACE FUNCTION fijar_monto_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.monto IS NOT NULL AND NEW.monto IS DISTINCT FROM OLD.monto THEN
    RAISE EXCEPTION 'El monto de la cita es inmutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO') AND (TG_OP = 'INSERT' OR OLD.monto IS NULL) THEN
    NEW.monto := coalesce(tarifa_vigente(NEW.profesional_id,
                                         (SELECT tipo_atencion_id FROM pacientes WHERE id = NEW.paciente_id),
                                         NEW.modalidad), 0);
  ELSIF TG_OP = 'INSERT' THEN
    NEW.monto := NULL;
  END IF;
  IF NEW.estado = 'CANCELADA' AND (TG_OP = 'INSERT' OR OLD.estado <> 'CANCELADA') THEN
    NEW.cancelada_en := now();
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cancelada_en := NULL;
  ELSE
    NEW.cancelada_en := OLD.cancelada_en;
  END IF;
  RETURN NEW;
END;
$$;

-- Plazo de pago: el de validacion de transferencias, siempre antes del inicio.
CREATE FUNCTION plazo_pago(p_inicio timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT least(now() + make_interval(hours => plazo_validacion_transferencia_horas), p_inicio) FROM configuracion_centro
$$;

-- Lo que se cobra para confirmar: el porcentaje configurado del monto, menos lo ya pagado.
CREATE FUNCTION monto_confirmacion(p_cita_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT greatest(ceil(coalesce(c.monto, 0) * cc.porcentaje_pago_confirmacion / 100.0)::int
                  - coalesce((SELECT sum(p.monto) FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO'), 0)::int, 0)
  FROM citas c CROSS JOIN configuracion_centro cc WHERE c.id = p_cita_id
$$;

-- Cita recien creada en PENDIENTE_PAGO: se confirma de inmediato si el unico
-- medio es pagar en el centro o si no hay nada que cobrar.
CREATE FUNCTION decidir_confirmacion(p_cita_id uuid) RETURNS estado_cita
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  v_solo_centro boolean := medios_confirmacion_vigentes() = ARRAY['PAGO_EN_CENTRO']::medio_confirmacion[];
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF c.estado <> 'PENDIENTE_PAGO' THEN
    RETURN c.estado;
  END IF;
  IF v_solo_centro OR monto_confirmacion(c.id) = 0 THEN
    UPDATE citas SET estado = 'CONFIRMADA', medio_confirmacion = CASE WHEN v_solo_centro THEN 'PAGO_EN_CENTRO'::medio_confirmacion END,
                     updated_at = now()
    WHERE id = c.id;
    PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
    RETURN 'CONFIRMADA';
  END IF;
  RETURN 'PENDIENTE_PAGO';
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Reserva sin cuenta: token opaco, verificacion tardia
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "solicitudes_hora" ADD COLUMN "reserva_hash" BYTEA;

CREATE UNIQUE INDEX "solicitudes_hora_reserva_hash_key" ON "solicitudes_hora"("reserva_hash");
ALTER TABLE solicitudes_hora ADD CONSTRAINT solicitudes_hora_reserva_hash CHECK (octet_length(reserva_hash) = 32);

-- Como 03b, mas el hash del token de la reserva; el enlace de verificacion
-- dura hasta 24 h (o hasta el inicio) aunque la retencion venza antes: la
-- verificacion tardia se resuelve al concretar.
DROP FUNCTION crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea,
                                   bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea);
CREATE FUNCTION crear_solicitud_hora(
  p_id uuid, p_profesional_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz, p_fin timestamptz,
  p_nombre text, p_apellido text, p_fecha_nacimiento date, p_email text, p_telefono bytea,
  p_rut bytea, p_rut_hmac bytea, p_adulto_nombre text, p_adulto_parentesco text, p_adulto_telefono bytea,
  p_respuestas bytea, p_recomendado_id uuid, p_politica_id uuid, p_terminos_id uuid,
  p_token_hash bytea, p_reserva_hash bytea)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_expira timestamptz := now() + make_interval(mins => (SELECT minutos_retencion_solicitud FROM configuracion_centro));
  v_espacio uuid;
BEGIN
  IF p_inicio <= now() THEN
    RAISE EXCEPTION 'La hora ya paso' USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_hora_coherente';
  END IF;
  IF p_politica_id IS DISTINCT FROM (SELECT id FROM politica_vigente('POLITICA_DATOS'))
     OR p_terminos_id IS DISTINCT FROM (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')) THEN
    RAISE EXCEPTION 'Hay una version nueva de la politica: vuelva a aceptarla'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
  END IF;
  IF age((p_inicio AT TIME ZONE 'America/Santiago')::date, p_fecha_nacimiento) < interval '18 years'
     AND coalesce(btrim(p_adulto_nombre), '') = '' THEN
    RAISE EXCEPTION 'Paciente menor de 18: el solicitante se declara adulto responsable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_menor_requiere_adulto_responsable';
  END IF;
  IF (SELECT count(*) FROM solicitudes_hora
      WHERE lower(email) = lower(p_email) AND estado = 'PENDIENTE_VERIFICACION' AND expira_en > now()) >= 2 THEN
    RAISE EXCEPTION 'Ya hay solicitudes pendientes de verificar para este correo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'solicitudes_hora_limite';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico)
     OR NOT tiene_rol(p_profesional_id, 'PROFESIONAL')
     OR EXISTS (SELECT 1 FROM bajas WHERE usuario_id = p_profesional_id)
     OR NOT EXISTS (SELECT 1 FROM disponibilidad_publica(p_profesional_id, p_inicio - interval '1 minute', p_fin + interval '1 minute') d
                    WHERE d.modalidad = p_modalidad AND d.inicio <= p_inicio AND d.fin >= p_fin) THEN
    RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_disponible';
  END IF;
  IF p_modalidad = 'ONLINE' AND NOT EXISTS (SELECT 1 FROM salas_videollamada s WHERE s.usuario_id = p_profesional_id
                                            AND (s.modo = 'JITSI' OR s.enlace IS NOT NULL)) THEN
    RAISE EXCEPTION 'El profesional no atiende online por el portal'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'videollamada_sin_sala';
  END IF;
  IF p_modalidad = 'PRESENCIAL' THEN
    -- disponibilidad_publica ya exige un bloque que cubra la hora.
    SELECT b.espacio_id INTO v_espacio FROM bloques_atencion b
    WHERE b.profesional_id = p_profesional_id AND b.inicio <= p_inicio AND b.fin >= p_fin;
  END IF;

  INSERT INTO solicitudes_hora (id, profesional_id, modalidad, espacio_id, inicio, fin, nombre, apellido, fecha_nacimiento,
                                email, telefono, rut, rut_hmac, adulto_nombre, adulto_parentesco, adulto_telefono,
                                respuestas, recomendado_id, politica_id, terminos_id, expira_en, reserva_hash)
  VALUES (p_id, p_profesional_id, p_modalidad, v_espacio, p_inicio, p_fin, btrim(p_nombre), btrim(p_apellido),
          p_fecha_nacimiento, lower(btrim(p_email)), p_telefono, p_rut, p_rut_hmac, nullif(btrim(p_adulto_nombre), ''),
          p_adulto_parentesco, p_adulto_telefono, p_respuestas, p_recomendado_id,
          p_politica_id, p_terminos_id, v_expira, p_reserva_hash);
  INSERT INTO bloqueos_temporales (solicitud_id, profesional_id, espacio_id, modalidad, inicio, fin, expira_en)
  VALUES (p_id, p_profesional_id, v_espacio, p_modalidad, p_inicio, p_fin, v_expira);
  PERFORM emitir_token('VERIFICACION_SOLICITUD', p_token_hash, least(p_inicio, now() + interval '24 hours'),
                       NULL, NULL, NULL, p_id, NULL, lower(btrim(p_email)));
  RETURN v_expira;
END;
$$;
REVOKE EXECUTE ON FUNCTION
  crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea,
                       bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea, bytea)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea,
                       bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea, bytea)
TO app_user;

-- Datos de la solicitud de un enlace vigente: tambien si la retencion ya vencio.
CREATE OR REPLACE FUNCTION datos_solicitud_hora(p_token_hash bytea) RETURNS SETOF solicitudes_hora
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  SELECT s.* FROM tokens_correo t JOIN solicitudes_hora s ON s.id = t.referencia_id
  WHERE t.token_hash = p_token_hash AND t.tipo = 'VERIFICACION_SOLICITUD' AND t.usado_en IS NULL
    AND t.expira_en > now() AND s.estado IN ('PENDIENTE_VERIFICACION', 'EXPIRADA');
END;
$$;

-- Verificar el correo concreta la solicitud: paciente (id de la API), ficha,
-- adulto responsable, aceptaciones y la cita: SOLICITADA si el profesional
-- aprueba pacientes nuevos; si no, PENDIENTE_PAGO (o CONFIRMADA de inmediato,
-- decidir_confirmacion). Con la retencion vencida se concreta igual si la hora
-- sigue libre; si no, 23P01 (la API responde con alternativas). La invitacion
-- a la cuenta sale tambien con la cita pendiente de pago (el paciente paga o
-- sube el comprobante desde su cuenta).
CREATE OR REPLACE FUNCTION concretar_solicitud_hora(
  p_token_hash bytea, p_paciente_id uuid, p_adulto_id uuid, p_telefono bytea, p_rut bytea, p_rut_hmac bytea,
  p_adulto_telefono bytea, p_invitacion_hash bytea, p_invitacion_expira timestamptz)
RETURNS TABLE (paciente_id uuid, cita_id uuid, estado estado_cita, modalidad modalidad_atencion, profesional_id uuid,
               inicio timestamptz, fin timestamptz, invitacion_email text, invitacion_rol rol,
               sala_modo modo_videollamada, sala_enlace bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_token_hash, 'VERIFICACION_SOLICITUD');
  s solicitudes_hora%ROWTYPE;
  v_menor boolean;
  v_rut_libre boolean;
  v_dup boolean;
  v_estado estado_cita;
  v_cita uuid;
  v_adulto uuid;
  v_inv_email text;
  v_inv_rol rol;
BEGIN
  SELECT * INTO s FROM solicitudes_hora WHERE id = t.referencia_id FOR UPDATE;
  IF s.estado NOT IN ('PENDIENTE_VERIFICACION', 'EXPIRADA') THEN
    RAISE EXCEPTION 'La solicitud ya se proceso' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF s.expira_en <= now() THEN
    -- Verificacion tardia: la retencion vencio; vale si la hora sigue libre.
    DELETE FROM bloqueos_temporales WHERE solicitud_id = s.id;
    IF s.inicio <= now() OR NOT EXISTS (
         SELECT 1 FROM disponibilidad_publica(s.profesional_id, s.inicio - interval '1 minute', s.fin + interval '1 minute') d
         WHERE d.modalidad = s.modalidad AND d.inicio <= s.inicio AND d.fin >= s.fin) THEN
      RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_tomada';
    END IF;
  END IF;
  v_menor := age((s.inicio AT TIME ZONE 'America/Santiago')::date, s.fecha_nacimiento) < interval '18 years';
  v_rut_libre := p_rut_hmac IS NULL OR NOT EXISTS (SELECT 1 FROM pacientes WHERE rut_hmac = p_rut_hmac);
  -- Nunca fusionar por nombre (D-2): identidad = RUT (indice ciego) + correo verificado. Coincidencias -> GESTION concilia.
  v_dup := NOT v_rut_libre
           OR (NOT v_menor AND EXISTS (SELECT 1 FROM pacientes WHERE lower(email) = s.email));

  INSERT INTO pacientes (id, nombre, apellido, rut, rut_hmac, fecha_nacimiento, email, telefono, profesional_id,
                         creado_por_solicitud, posible_duplicado)
  VALUES (p_paciente_id, s.nombre, s.apellido, CASE WHEN v_rut_libre THEN p_rut END, CASE WHEN v_rut_libre THEN p_rut_hmac END,
          s.fecha_nacimiento, CASE WHEN v_menor THEN NULL ELSE s.email END, p_telefono, s.profesional_id, true, v_dup);
  INSERT INTO fichas_clinicas (paciente_id) VALUES (p_paciente_id);
  IF s.adulto_nombre IS NOT NULL THEN
    INSERT INTO adultos_responsables (id, paciente_id, nombre, parentesco, telefono, email)
    VALUES (p_adulto_id, p_paciente_id, s.adulto_nombre, s.adulto_parentesco, p_adulto_telefono,
            CASE WHEN v_menor THEN s.email END);
    v_adulto := p_adulto_id;
  END IF;
  INSERT INTO aceptaciones_politica (politica_id, paciente_id, solicitud_id, otorgado_por, adulto_responsable_id, canal, aceptada_en)
  SELECT x.id, p_paciente_id, s.id, CASE WHEN v_menor THEN 'ADULTO_RESPONSABLE' ELSE 'PACIENTE' END::otorgante_consentimiento,
         CASE WHEN v_menor THEN v_adulto END, 'SOLICITUD', s.creada_en
  FROM unnest(ARRAY[s.politica_id, s.terminos_id]) AS x(id) WHERE x.id IS NOT NULL;

  DELETE FROM bloqueos_temporales WHERE solicitud_id = s.id;
  v_estado := CASE WHEN (SELECT requiere_aprobacion_nuevos FROM profesionales WHERE usuario_id = s.profesional_id)
                   THEN 'SOLICITADA' ELSE 'PENDIENTE_PAGO' END;
  INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin, estado, pago_vence_en)
  VALUES (s.espacio_id, s.modalidad, s.profesional_id, p_paciente_id, s.inicio, s.fin, v_estado,
          CASE WHEN v_estado = 'PENDIENTE_PAGO' THEN plazo_pago(s.inicio) END)
  RETURNING id INTO v_cita;
  UPDATE solicitudes_hora SET estado = 'CONCRETADA', paciente_id = p_paciente_id, cita_id = v_cita, concretada_en = now()
  WHERE id = s.id;

  IF v_estado = 'SOLICITADA' THEN
    PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, s.profesional_id, v_cita, NULL);
  ELSE
    v_estado := decidir_confirmacion(v_cita);
    IF p_invitacion_hash IS NOT NULL THEN
      SELECT i.email, i.rol INTO v_inv_email, v_inv_rol
      FROM invitar_paciente_del_portal(p_paciente_id, p_invitacion_hash, p_invitacion_expira) i;
    END IF;
  END IF;

  RETURN QUERY
  SELECT p_paciente_id, v_cita, v_estado, s.modalidad, s.profesional_id, s.inicio, s.fin, v_inv_email, v_inv_rol,
         sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON s.modalidad = 'ONLINE' AND sv.usuario_id = s.profesional_id;
END;
$$;

-- Reserva desde la cuenta (03b-4): igual, pero sin retencion (el paciente ya
-- tiene la cuenta verificada): PENDIENTE_PAGO o CONFIRMADA de inmediato.
CREATE OR REPLACE FUNCTION reservar_cita_portal(p_paciente_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz,
                                                p_fin timestamptz, p_politica_id uuid, p_terminos_id uuid)
RETURNS TABLE (cita_id uuid, estado estado_cita, profesional_id uuid, sala_modo modo_videollamada, sala_enlace bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_profesional uuid;
  v_adulto uuid;
  v_otorgante otorgante_consentimiento;
  v_estado estado_cita;
  v_cita uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'reservar_cita_portal: solo el paciente o su adulto responsable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_rol() = 'PACIENTE' THEN
    IF p_paciente_id IS DISTINCT FROM app_paciente_id() THEN
      RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
    END IF;
    IF edad_paciente(p_paciente_id) < 18 THEN
      RAISE EXCEPTION 'Las horas de un menor las pide su adulto responsable'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_portal_cuenta_restringida';
    END IF;
    v_otorgante := 'PACIENTE';
  ELSE
    SELECT a.id INTO v_adulto FROM adultos_responsables a WHERE a.paciente_id = p_paciente_id AND a.usuario_id = app_usuario_id();
    IF v_adulto IS NULL THEN
      RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'no_data_found';
    END IF;
    v_otorgante := 'ADULTO_RESPONSABLE';
  END IF;
  IF p_inicio <= now() THEN
    RAISE EXCEPTION 'La hora ya paso' USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_portal_futura';
  END IF;
  IF p_politica_id IS DISTINCT FROM (SELECT id FROM politica_vigente('POLITICA_DATOS'))
     OR p_terminos_id IS DISTINCT FROM (SELECT id FROM politica_vigente('TERMINOS_AGENDAMIENTO')) THEN
    RAISE EXCEPTION 'Hay una version nueva de la politica: vuelva a aceptarla'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
  END IF;

  -- Solo con el tratante actual (un tratante por paciente; otro profesional = derivacion).
  SELECT p.profesional_id INTO v_profesional FROM pacientes p WHERE p.id = p_paciente_id;
  IF v_profesional IS NULL OR EXISTS (SELECT 1 FROM bajas WHERE usuario_id = v_profesional) THEN
    RAISE EXCEPTION 'No tienes un profesional tratante que agende por el portal: escribe al centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_portal_tratante';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM disponibilidad_publica(v_profesional, p_inicio - interval '1 minute', p_fin + interval '1 minute') d
                 WHERE d.modalidad = p_modalidad AND d.inicio <= p_inicio AND d.fin >= p_fin) THEN
    RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_disponible';
  END IF;
  IF p_modalidad = 'ONLINE' AND NOT EXISTS (SELECT 1 FROM salas_videollamada s WHERE s.usuario_id = v_profesional
                                            AND (s.modo = 'JITSI' OR s.enlace IS NOT NULL)) THEN
    RAISE EXCEPTION 'El profesional no atiende online por el portal'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'videollamada_sin_sala';
  END IF;

  v_estado := CASE WHEN (SELECT requiere_aprobacion_nuevos FROM profesionales WHERE usuario_id = v_profesional)
                        AND NOT EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id = p_paciente_id
                                          AND c.profesional_id = v_profesional AND c.estado = 'CONFIRMADA')
                   THEN 'SOLICITADA' ELSE 'PENDIENTE_PAGO' END;
  -- Presencial: la BD le pone el box del bloque del profesional (validar_agenda_cita).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, pago_vence_en)
  VALUES (p_modalidad, v_profesional, p_paciente_id, p_inicio, p_fin, v_estado,
          CASE WHEN v_estado = 'PENDIENTE_PAGO' THEN plazo_pago(p_inicio) END)
  RETURNING id INTO v_cita;

  -- Politica de datos y terminos vigentes: se registran si esta version aun no estaba aceptada.
  INSERT INTO aceptaciones_politica (politica_id, paciente_id, otorgado_por, adulto_responsable_id, canal)
  SELECT x.id, p_paciente_id, v_otorgante, v_adulto, 'PORTAL'
  FROM unnest(ARRAY[p_politica_id, p_terminos_id]) AS x(id)
  WHERE NOT EXISTS (SELECT 1 FROM aceptaciones_politica a WHERE a.paciente_id = p_paciente_id AND a.politica_id = x.id);

  IF v_estado = 'SOLICITADA' THEN
    PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, v_profesional, v_cita, NULL);
  ELSE
    v_estado := decidir_confirmacion(v_cita);
  END IF;

  RETURN QUERY
  SELECT v_cita, v_estado, v_profesional, sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON p_modalidad = 'ONLINE' AND sv.usuario_id = v_profesional;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Transferencia
-- -----------------------------------------------------------------------------
-- Una por cita (A). Comprobante opcional, cifrado (FINANCIERO, AAD con el id
-- que genera la API). Sin GRANT de escritura: solo funciones.
-- CreateTable
CREATE TABLE "transferencias" (
    "id" UUID NOT NULL,
    "cita_id" UUID NOT NULL,
    "estado" "estado_transferencia" NOT NULL DEFAULT 'POR_VALIDAR',
    "comprobante" BYTEA,
    "comprobante_tipo" TEXT,
    "comprobante_nombre" TEXT,
    "comprobante_subido_en" TIMESTAMPTZ(6),
    "motivo_rechazo" TEXT,
    "resuelta_por_id" UUID,
    "resuelta_en" TIMESTAMPTZ(6),
    "pago_id" UUID,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transferencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transferencias_cita_id_key" ON "transferencias"("cita_id");

-- CreateIndex
CREATE UNIQUE INDEX "transferencias_pago_id_key" ON "transferencias"("pago_id");

-- CreateIndex
CREATE INDEX "transferencias_estado_idx" ON "transferencias"("estado");

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_resuelta_por_id_fkey" FOREIGN KEY ("resuelta_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE transferencias ADD CONSTRAINT transferencias_cifrado CHECK (octet_length(comprobante) >= 49);
ALTER TABLE transferencias ADD CONSTRAINT transferencias_coherente
  CHECK ((comprobante IS NULL) = (comprobante_tipo IS NULL) AND (comprobante IS NULL) = (comprobante_subido_en IS NULL)
         AND (comprobante_tipo IS NULL OR comprobante_tipo IN ('application/pdf', 'image/png', 'image/jpeg'))
         AND (comprobante_nombre IS NULL OR length(comprobante_nombre) <= 200)
         AND (estado = 'POR_VALIDAR') = (resuelta_en IS NULL)
         AND (estado = 'VALIDADA') = (pago_id IS NOT NULL)
         AND (estado <> 'RECHAZADA' OR length(btrim(coalesce(motivo_rechazo, ''))) BETWEEN 3 AND 300));
ALTER TABLE transferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE transferencias FORCE ROW LEVEL SECURITY;
-- Lectura: ADMIN/GESTION todas; el profesional las de sus citas; el paciente
-- (o su adulto responsable, cuenta plena) las suyas.
CREATE POLICY transferencias_select ON transferencias FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND cita_id IN (SELECT c.id FROM citas c WHERE c.profesional_id = (SELECT app_usuario_id())))
         OR cita_id IN (SELECT c.id FROM citas c WHERE c.paciente_id IN (SELECT app_pacientes_plenos())));
CREATE POLICY transferencias_acceso_vigente ON transferencias AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON transferencias TO app_user;

-- -----------------------------------------------------------------------------
-- 5. Pasarela
-- -----------------------------------------------------------------------------
-- Un intento de cobro por fila (A). El id es la referencia que viaja a la
-- pasarela y vuelve en el webhook; evento_id hace idempotente el webhook.
-- CreateTable
CREATE TABLE "cobros_pasarela" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cita_id" UUID NOT NULL,
    "monto" INTEGER NOT NULL,
    "estado" "estado_cobro_pasarela" NOT NULL DEFAULT 'PENDIENTE',
    "evento_id" TEXT,
    "pago_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesado_en" TIMESTAMPTZ(6),

    CONSTRAINT "cobros_pasarela_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cobros_pasarela_evento_id_key" ON "cobros_pasarela"("evento_id");

-- CreateIndex
CREATE UNIQUE INDEX "cobros_pasarela_pago_id_key" ON "cobros_pasarela"("pago_id");

-- CreateIndex
CREATE INDEX "cobros_pasarela_cita_id_idx" ON "cobros_pasarela"("cita_id");

-- AddForeignKey
ALTER TABLE "cobros_pasarela" ADD CONSTRAINT "cobros_pasarela_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobros_pasarela" ADD CONSTRAINT "cobros_pasarela_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE cobros_pasarela ADD CONSTRAINT cobros_pasarela_coherente
  CHECK (monto > 0 AND (estado = 'PENDIENTE') = (procesado_en IS NULL) AND (estado = 'PAGADO') = (pago_id IS NOT NULL)
         AND (evento_id IS NULL OR length(evento_id) BETWEEN 1 AND 200));
ALTER TABLE cobros_pasarela ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobros_pasarela FORCE ROW LEVEL SECURITY;
CREATE POLICY cobros_pasarela_select ON cobros_pasarela FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
CREATE POLICY cobros_pasarela_acceso_vigente ON cobros_pasarela AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON cobros_pasarela TO app_user;

-- -----------------------------------------------------------------------------
-- 6. Funciones del flujo de pago
-- -----------------------------------------------------------------------------
-- Cita de una reserva sin cuenta ya verificada (por el hash del token opaco).
CREATE FUNCTION cita_de_reserva(p_hash bytea) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  SELECT s.cita_id INTO v FROM solicitudes_hora s WHERE s.reserva_hash = p_hash AND s.estado = 'CONCRETADA';
  IF v IS NULL THEN
    RAISE EXCEPTION 'Reserva inexistente o aun sin verificar' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v;
END;
$$;

-- Cita del portal: del paciente o de su menor (cuenta plena: el adolescente no paga).
CREATE FUNCTION cita_del_portal(p_cita_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'Solo el paciente o su adulto responsable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM citas c WHERE c.id = p_cita_id AND c.paciente_id IN (SELECT app_pacientes_plenos())) THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN p_cita_id;
END;
$$;

-- Hay donde transferir: la cuenta del profesional (cobro directo) o la del centro.
CREATE FUNCTION cuenta_transferencia_existe(p_profesional_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN cobro_directo(p_profesional_id)
              THEN EXISTS (SELECT 1 FROM profesional_datos_privados d WHERE d.usuario_id = p_profesional_id
                             AND d.banco IS NOT NULL AND d.numero_cuenta IS NOT NULL)
              ELSE EXISTS (SELECT 1 FROM cuenta_bancaria_centro) END
$$;

-- Elegir el medio (interna): pagar en el centro confirma; transferencia deja la
-- fila por validar (id de la API) e instrucciones; pasarela queda en curso.
CREATE FUNCTION elegir_medio_cita(p_cita_id uuid, p_medio medio_confirmacion, p_transferencia_id uuid) RETURNS estado_cita
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF c.estado IS DISTINCT FROM 'PENDIENTE_PAGO' THEN
    RAISE EXCEPTION 'La cita no esta pendiente de pago' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_medio IS NULL OR NOT p_medio = ANY (medios_confirmacion_vigentes()) THEN
    RAISE EXCEPTION 'Ese medio de pago no esta habilitado en el centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_medio_no_habilitado';
  END IF;
  IF p_medio = 'PAGO_EN_CENTRO' THEN
    UPDATE citas SET estado = 'CONFIRMADA', medio_confirmacion = 'PAGO_EN_CENTRO', updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
    RETURN 'CONFIRMADA';
  END IF;
  IF p_medio = 'TRANSFERENCIA' THEN
    IF NOT cuenta_transferencia_existe(c.profesional_id) THEN
      RAISE EXCEPTION 'No hay una cuenta registrada para transferir: elija otro medio'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_transferencia_sin_cuenta';
    END IF;
    INSERT INTO transferencias (id, cita_id) VALUES (p_transferencia_id, c.id) ON CONFLICT (cita_id) DO NOTHING;
    IF c.medio_confirmacion IS DISTINCT FROM 'TRANSFERENCIA' THEN
      PERFORM encolar_notificacion('INSTRUCCIONES_TRANSFERENCIA', c.paciente_id, NULL, c.id, NULL);
    END IF;
  END IF;
  UPDATE citas SET medio_confirmacion = p_medio, updated_at = now() WHERE id = c.id;
  RETURN 'PENDIENTE_PAGO';
END;
$$;

CREATE FUNCTION elegir_medio_reserva(p_hash bytea, p_medio medio_confirmacion, p_transferencia_id uuid) RETURNS estado_cita
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT elegir_medio_cita(cita_de_reserva(p_hash), p_medio, p_transferencia_id)
$$;

CREATE FUNCTION elegir_medio_portal(p_cita_id uuid, p_medio medio_confirmacion, p_transferencia_id uuid) RETURNS estado_cita
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT elegir_medio_cita(cita_del_portal(p_cita_id), p_medio, p_transferencia_id)
$$;

-- Estado de una cita en el flujo de pago (interna): estado, vencimiento y
-- siguiente paso (con el motivo si se rechazo la transferencia); sin datos personales.
CREATE FUNCTION estado_pago_cita(p_cita_id uuid)
RETURNS TABLE (estado text, vence_en timestamptz, siguiente text, medios medio_confirmacion[], medio medio_confirmacion,
               monto integer, comprobante_recibido boolean, motivo_rechazo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
  t transferencias%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id;
  SELECT * INTO t FROM transferencias WHERE cita_id = p_cita_id;
  RETURN QUERY SELECT
    c.estado::text,
    CASE WHEN c.estado = 'PENDIENTE_PAGO' THEN c.pago_vence_en END,
    CASE
      WHEN c.estado = 'CONFIRMADA' THEN 'NINGUNO'
      WHEN c.estado = 'SOLICITADA' THEN 'ESPERAR_APROBACION'
      WHEN c.estado = 'PENDIENTE_PAGO' AND c.medio_confirmacion IS NULL THEN 'ELEGIR_MEDIO'
      WHEN c.estado = 'PENDIENTE_PAGO' AND c.medio_confirmacion = 'TRANSFERENCIA' AND t.estado = 'RECHAZADA' THEN 'TRANSFERENCIA_RECHAZADA'
      WHEN c.estado = 'PENDIENTE_PAGO' AND c.medio_confirmacion = 'TRANSFERENCIA' THEN 'ESPERAR_VALIDACION'
      WHEN c.estado = 'PENDIENTE_PAGO' THEN 'PAGAR_EN_LINEA'
      ELSE 'ELEGIR_OTRA_HORA'
    END,
    CASE WHEN c.estado = 'PENDIENTE_PAGO' THEN medios_confirmacion_vigentes() END,
    c.medio_confirmacion,
    CASE WHEN c.estado = 'PENDIENTE_PAGO' THEN monto_confirmacion(c.id) END,
    t.comprobante IS NOT NULL,
    CASE WHEN c.estado = 'PENDIENTE_PAGO' AND t.estado = 'RECHAZADA' THEN t.motivo_rechazo END;
END;
$$;

-- Estado de la reserva sin cuenta (sin contexto; rate limit en la API).
CREATE FUNCTION estado_reserva(p_hash bytea)
RETURNS TABLE (estado text, vence_en timestamptz, siguiente text, medios medio_confirmacion[], medio medio_confirmacion,
               monto integer, comprobante_recibido boolean, motivo_rechazo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  s solicitudes_hora%ROWTYPE;
BEGIN
  SELECT * INTO s FROM solicitudes_hora WHERE reserva_hash = p_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF s.estado = 'CONCRETADA' THEN
    RETURN QUERY SELECT * FROM estado_pago_cita(s.cita_id);
  ELSIF s.estado = 'PENDIENTE_VERIFICACION' AND s.expira_en > now() THEN
    RETURN QUERY SELECT 'RETENIDA', s.expira_en, 'VERIFICAR_CORREO', NULL::medio_confirmacion[], NULL::medio_confirmacion,
                        NULL::integer, false, NULL::text;
  ELSE
    -- Retencion vencida: la hora quedo libre. El enlace del correo aun sirve si nadie la tomo.
    RETURN QUERY SELECT 'LIBERADA', NULL::timestamptz, 'ELEGIR_OTRA_HORA', NULL::medio_confirmacion[], NULL::medio_confirmacion,
                        NULL::integer, false, NULL::text;
  END IF;
END;
$$;

CREATE FUNCTION estado_pago_portal(p_cita_id uuid)
RETURNS TABLE (estado text, vence_en timestamptz, siguiente text, medios medio_confirmacion[], medio medio_confirmacion,
               monto integer, comprobante_recibido boolean, motivo_rechazo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM estado_pago_cita(cita_del_portal(p_cita_id))
$$;

-- Datos para transferir (interna): cuenta del profesional con cobro directo o
-- del centro, cifrados (la API descifra con el AAD de la fila de origen).
CREATE FUNCTION datos_transferencia(p_cita_id uuid)
RETURNS TABLE (origen text, cuenta_id uuid, rut bytea, banco bytea, tipo_cuenta bytea, numero_cuenta bytea, titular bytea,
               monto integer, vence_en timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id;
  IF c.estado IS DISTINCT FROM 'PENDIENTE_PAGO' OR c.medio_confirmacion IS DISTINCT FROM 'TRANSFERENCIA' THEN
    RAISE EXCEPTION 'La cita no espera una transferencia' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF cobro_directo(c.profesional_id) THEN
    RETURN QUERY SELECT 'PROFESIONAL', d.usuario_id, d.rut, d.banco, d.tipo_cuenta, d.numero_cuenta, d.titular,
                        monto_confirmacion(c.id), c.pago_vence_en
    FROM profesional_datos_privados d WHERE d.usuario_id = c.profesional_id;
  ELSE
    RETURN QUERY SELECT 'CENTRO', k.id, k.rut, k.banco, k.tipo_cuenta, k.numero_cuenta, k.titular,
                        monto_confirmacion(c.id), c.pago_vence_en
    FROM cuenta_bancaria_centro k;
  END IF;
END;
$$;

CREATE FUNCTION datos_transferencia_reserva(p_hash bytea)
RETURNS TABLE (origen text, cuenta_id uuid, rut bytea, banco bytea, tipo_cuenta bytea, numero_cuenta bytea, titular bytea,
               monto integer, vence_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM datos_transferencia(cita_de_reserva(p_hash))
$$;

-- Desde la cuenta: queda en accesos_ficha (DATOS_PAGO), como datos_pago_profesional.
CREATE FUNCTION datos_transferencia_portal(p_cita_id uuid)
RETURNS TABLE (origen text, cuenta_id uuid, rut bytea, banco bytea, tipo_cuenta bytea, numero_cuenta bytea, titular bytea,
               monto integer, vence_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM cita_del_portal(p_cita_id);
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  SELECT app_usuario_id(), app_rol()::rol, c.paciente_id, 'datos_transferencia', 'DATOS_PAGO' FROM citas c WHERE c.id = p_cita_id;
  RETURN QUERY SELECT * FROM datos_transferencia(p_cita_id);
END;
$$;

-- Comprobante (interna): reemplaza el anterior y vuelve a POR_VALIDAR (tambien
-- tras un rechazo). La API lo valida por contenido y lo cifra con el id de la
-- transferencia (transferencia_de_cita).
CREATE FUNCTION transferencia_de_cita(p_cita_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  SELECT t.id INTO v FROM transferencias t JOIN citas c ON c.id = t.cita_id
  WHERE t.cita_id = p_cita_id AND t.estado <> 'VALIDADA' AND c.estado = 'PENDIENTE_PAGO' AND c.medio_confirmacion = 'TRANSFERENCIA';
  IF v IS NULL THEN
    RAISE EXCEPTION 'La cita no espera una transferencia' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN v;
END;
$$;

CREATE FUNCTION guardar_comprobante(p_cita_id uuid, p_contenido bytea, p_tipo text, p_nombre text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid := transferencia_de_cita(p_cita_id);
BEGIN
  UPDATE transferencias SET comprobante = p_contenido, comprobante_tipo = p_tipo, comprobante_nombre = left(p_nombre, 200),
                            comprobante_subido_en = now(), estado = 'POR_VALIDAR', resuelta_en = NULL, resuelta_por_id = NULL
  WHERE id = v_id;
  PERFORM encolar_notificacion('COMPROBANTE_RECIBIDO', c.paciente_id, NULL, c.id, NULL) FROM citas c WHERE c.id = p_cita_id;
END;
$$;

CREATE FUNCTION transferencia_de_reserva(p_hash bytea) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT transferencia_de_cita(cita_de_reserva(p_hash))
$$;

CREATE FUNCTION subir_comprobante_reserva(p_hash bytea, p_contenido bytea, p_tipo text, p_nombre text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT guardar_comprobante(cita_de_reserva(p_hash), p_contenido, p_tipo, p_nombre)
$$;

CREATE FUNCTION transferencia_portal(p_cita_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT transferencia_de_cita(cita_del_portal(p_cita_id))
$$;

CREATE FUNCTION subir_comprobante_portal(p_cita_id uuid, p_contenido bytea, p_tipo text, p_nombre text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT guardar_comprobante(cita_del_portal(p_cita_id), p_contenido, p_tipo, p_nombre)
$$;

-- Quien valida segun el modelo de cobro: GESTION/ADMIN (cobro del centro) o el
-- profesional de la cita (cobro directo).
CREATE FUNCTION puede_validar_transferencia(p_profesional_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT acceso_vigente() AND CASE WHEN cobro_directo(p_profesional_id)
                                   THEN app_rol() = 'PROFESIONAL' AND app_usuario_id() = p_profesional_id
                                   ELSE app_rol() IN ('ADMIN', 'GESTION') END
$$;

-- Validar: registra el pago (monto de confirmacion, medio TRANSFERENCIA) y confirma.
CREATE FUNCTION validar_transferencia(p_cita_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  t transferencias%ROWTYPE;
  v_monto int;
  v_pago uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  SELECT * INTO t FROM transferencias WHERE cita_id = p_cita_id FOR UPDATE;
  IF t.id IS NULL OR NOT puede_validar_transferencia(c.profesional_id) THEN
    IF t.id IS NOT NULL AND acceso_vigente() AND app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
      RAISE EXCEPTION 'Valida GESTION/ADMIN (cobro del centro) o el profesional de la cita (cobro directo)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'Transferencia inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'PENDIENTE_PAGO' OR t.estado = 'VALIDADA' THEN
    RAISE EXCEPTION 'La cita ya no espera esta transferencia' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  v_monto := monto_confirmacion(c.id);
  IF v_monto > 0 THEN
    INSERT INTO pagos (cita_id, monto, medio_pago, registrado_por_id, cobrado_por)
    VALUES (c.id, v_monto, 'TRANSFERENCIA', app_usuario_id(),
            CASE WHEN cobro_directo(c.profesional_id) THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO' END)
    RETURNING id INTO v_pago;
  END IF;
  UPDATE transferencias SET estado = 'VALIDADA', pago_id = v_pago, resuelta_por_id = app_usuario_id(), resuelta_en = now()
  WHERE id = t.id;
  UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = c.id;
  PERFORM encolar_notificacion('PAGO_VALIDADO', c.paciente_id, NULL, c.id, NULL);
  PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
  RETURN v_pago;
END;
$$;

-- Rechazar: queda el motivo y se avisa al paciente; la cita sigue pendiente
-- hasta su plazo (puede transferir de nuevo y subir otro comprobante).
CREATE FUNCTION rechazar_transferencia(p_cita_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  t transferencias%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  SELECT * INTO t FROM transferencias WHERE cita_id = p_cita_id FOR UPDATE;
  IF t.id IS NULL OR NOT puede_validar_transferencia(c.profesional_id) THEN
    IF t.id IS NOT NULL AND acceso_vigente() AND app_rol() IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
      RAISE EXCEPTION 'Valida GESTION/ADMIN (cobro del centro) o el profesional de la cita (cobro directo)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RAISE EXCEPTION 'Transferencia inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'PENDIENTE_PAGO' OR t.estado <> 'POR_VALIDAR' THEN
    RAISE EXCEPTION 'La transferencia no esta por validar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE transferencias SET estado = 'RECHAZADA', motivo_rechazo = btrim(p_motivo), resuelta_por_id = app_usuario_id(),
                            resuelta_en = now()
  WHERE id = t.id;
  PERFORM encolar_notificacion('PAGO_RECHAZADO', c.paciente_id, NULL, c.id, NULL);
END;
$$;

-- Pasarela: crea el intento (su id es la referencia) con el monto de
-- confirmacion; la API llama al adaptador con esa referencia.
CREATE FUNCTION iniciar_cobro_pasarela(p_cita_id uuid) RETURNS TABLE (cobro_id uuid, monto integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
  v_monto int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF c.estado IS DISTINCT FROM 'PENDIENTE_PAGO' OR c.medio_confirmacion IS DISTINCT FROM 'PASARELA' THEN
    RAISE EXCEPTION 'La cita no espera un pago en linea' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  v_monto := monto_confirmacion(c.id);
  IF v_monto <= 0 THEN
    RAISE EXCEPTION 'No hay monto que cobrar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  INSERT INTO cobros_pasarela (cita_id, monto) VALUES (c.id, v_monto) RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, v_monto;
END;
$$;

CREATE FUNCTION iniciar_cobro_reserva(p_hash bytea) RETURNS TABLE (cobro_id uuid, monto integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM iniciar_cobro_pasarela(cita_de_reserva(p_hash))
$$;

CREATE FUNCTION iniciar_cobro_portal(p_cita_id uuid) RETURNS TABLE (cobro_id uuid, monto integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM iniciar_cobro_pasarela(cita_del_portal(p_cita_id))
$$;

-- Webhook (sin contexto; la API ya verifico la firma): idempotente por estado
-- del intento y por evento_id. Pagado: registra el pago y confirma si la cita
-- sigue pendiente (si vencio antes, el pago queda para devolucion manual).
CREATE FUNCTION confirmar_cobro_pasarela(p_cobro_id uuid, p_evento_id text, p_pagado boolean) RETURNS estado_cobro_pasarela
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  k cobros_pasarela%ROWTYPE;
  c citas%ROWTYPE;
  v_pago uuid;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el webhook de la pasarela' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO k FROM cobros_pasarela WHERE id = p_cobro_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF k.estado <> 'PENDIENTE' OR EXISTS (SELECT 1 FROM cobros_pasarela WHERE evento_id = p_evento_id) THEN
    RETURN k.estado;
  END IF;
  IF NOT p_pagado THEN
    UPDATE cobros_pasarela SET estado = 'FALLIDO', evento_id = p_evento_id, procesado_en = now() WHERE id = k.id;
    RETURN 'FALLIDO';
  END IF;
  SELECT * INTO c FROM citas WHERE id = k.cita_id FOR UPDATE;
  INSERT INTO pagos (cita_id, monto, medio_pago, origen, cobrado_por)
  VALUES (c.id, k.monto, 'PASARELA', 'PASARELA',
          CASE WHEN cobro_directo(c.profesional_id) THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO' END)
  RETURNING id INTO v_pago;
  UPDATE cobros_pasarela SET estado = 'PAGADO', pago_id = v_pago, evento_id = p_evento_id, procesado_en = now() WHERE id = k.id;
  IF c.estado = 'PENDIENTE_PAGO' THEN
    UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('PAGO_VALIDADO', c.paciente_id, NULL, c.id, NULL);
    PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
  END IF;
  RETURN 'PAGADO';
END;
$$;

-- Job (sin contexto, cada minuto): reservas sin verificar vencidas -> EXPIRADA
-- (suelta la retencion) y citas con el plazo de pago vencido -> LIBERADA con
-- aviso al paciente. Idempotente; SKIP LOCKED.
CREATE FUNCTION liberar_reservas_vencidas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  v_n int := 0;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH vencidas AS (
    UPDATE solicitudes_hora SET estado = 'EXPIRADA'
    WHERE estado = 'PENDIENTE_VERIFICACION' AND expira_en <= now() RETURNING id
  )
  DELETE FROM bloqueos_temporales b USING vencidas v WHERE b.solicitud_id = v.id;
  FOR c IN
    SELECT x.id, x.paciente_id FROM citas x
    WHERE x.estado = 'PENDIENTE_PAGO' AND x.pago_vence_en <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE citas SET estado = 'LIBERADA', updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('HORA_LIBERADA', c.paciente_id, NULL, c.id, NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Mensajeria: plantillas y datos del job
-- -----------------------------------------------------------------------------
INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT e.evento::tipo_notificacion, 'PACIENTE'::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('INSTRUCCIONES_TRANSFERENCIA', 'Datos para transferir',
   'Hola {{nombre_paciente}}: su hora del {{fecha}} a las {{hora}} con {{nombre_profesional}} queda reservada hasta que validemos la transferencia. Los datos de la cuenta, el monto y el plazo estan en: {{enlace}}'),
  ('COMPROBANTE_RECIBIDO', 'Recibimos su comprobante',
   'Hola {{nombre_paciente}}: recibimos el comprobante de su hora del {{fecha}} a las {{hora}}. Le avisaremos cuando quede validado. Detalle: {{enlace}}'),
  ('PAGO_VALIDADO', 'Pago validado',
   'Hola {{nombre_paciente}}: validamos el pago de su hora del {{fecha}} a las {{hora}} con {{nombre_profesional}}. Su hora quedo confirmada. Detalle: {{enlace}}'),
  ('PAGO_RECHAZADO', 'No pudimos validar su pago',
   'Hola {{nombre_paciente}}: no pudimos validar la transferencia de su hora del {{fecha}} a las {{hora}}. Revise el motivo y vuelva a intentarlo antes del plazo: {{enlace}}'),
  ('HORA_LIBERADA', 'Su hora se libero',
   'Hola {{nombre_paciente}}: su hora del {{fecha}} a las {{hora}} con {{nombre_profesional}} se libero porque vencio el plazo de pago. Si quiere, pida otra hora: {{enlace}}')
) AS e(evento, asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);

-- Job de mensajes (como la version de la migracion anterior) con los avisos de
-- pago referidos a su cita (fecha, hora, profesional).
CREATE OR REPLACE FUNCTION notificaciones_por_enviar(p_limite int)
RETURNS TABLE (id uuid, tipo tipo_notificacion, canal canal_mensaje, referencia_id uuid, email text,
               asunto bytea, cuerpo bytea, plantilla_asunto text, plantilla_cuerpo text,
               enlace bytea, enlace_origen text, enlace_id uuid, adjunto bytea, datos jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job de mensajes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH tomadas AS (
    SELECT n.id, n.tipo, n.canal, n.referencia_id, n.paciente_id, n.usuario_id, n.asunto, n.cuerpo, n.creada_en
    FROM notificaciones n
    WHERE n.estado = 'PENDIENTE' AND n.proximo_intento <= now()
    ORDER BY n.proximo_intento, n.creada_en
    LIMIT greatest(coalesce(p_limite, 50), 1)
    FOR UPDATE SKIP LOCKED
  ), base AS (
    SELECT t.*,
           CASE WHEN t.paciente_id IS NOT NULL THEN 'PACIENTE'::destinatario_mensaje ELSE 'EQUIPO' END AS destinatario,
           CASE
             WHEN t.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'CITA_CANCELADA', 'ENLACE_ONLINE', 'SOLICITUD_HORA',
                             'CIERRE_REQUERIDO', 'HORA_LIBERADA', 'INSTRUCCIONES_TRANSFERENCIA', 'COMPROBANTE_RECIBIDO',
                             'PAGO_VALIDADO', 'PAGO_RECHAZADO') THEN t.referencia_id
             WHEN t.tipo = 'RECORDATORIO_CITA' THEN (SELECT r.cita_id FROM recordatorios_cita r WHERE r.id = t.referencia_id)
             WHEN t.tipo = 'PAGO_REGISTRADO' THEN (SELECT pg.cita_id FROM pagos pg WHERE pg.id = t.referencia_id)
             WHEN t.tipo = 'BOLETA_EMITIDA' THEN (SELECT b.cita_id FROM boletas b WHERE b.id = t.referencia_id)
           END AS cita_id,
           CASE
             WHEN t.tipo = 'ACCESO_CLINICO_TEMPORAL'
               THEN (SELECT a.profesional_id FROM accesos_clinicos_temporales a WHERE a.id = t.referencia_id)
           END AS otro_profesional_id
    FROM tomadas t
  )
  SELECT b.id, b.tipo, b.canal, b.referencia_id,
         CASE
           WHEN b.canal <> 'CORREO' THEN NULL
           WHEN b.usuario_id IS NOT NULL THEN (SELECT u.email FROM usuarios u WHERE u.id = b.usuario_id AND u.activo)
           WHEN age((now() AT TIME ZONE 'America/Santiago')::date, p.fecha_nacimiento) < interval '18 years' THEN
             (SELECT a.email FROM adultos_responsables a WHERE a.paciente_id = p.id AND a.email IS NOT NULL
              ORDER BY a.created_at LIMIT 1)
           ELSE coalesce(p.email, (SELECT u.email FROM usuarios u WHERE u.paciente_id = p.id AND u.activo))
         END,
         b.asunto, b.cuerpo, pl.asunto, pl.cuerpo,
         CASE WHEN b.tipo = 'RECORDATORIO_CITA' THEN r.enlace
              WHEN b.tipo = 'DOCUMENTO_CLINICO' THEN ev.enlace
              WHEN b.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'ENLACE_ONLINE') THEN c.enlace_online END,
         CASE WHEN b.tipo = 'RECORDATORIO_CITA' THEN 'recordatorios_cita'
              WHEN b.tipo = 'DOCUMENTO_CLINICO' THEN 'envios_documento'
              WHEN b.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'ENLACE_ONLINE') THEN 'citas' END,
         CASE WHEN b.tipo = 'RECORDATORIO_CITA' THEN r.id
              WHEN b.tipo = 'DOCUMENTO_CLINICO' THEN ev.id
              WHEN b.tipo IN ('CITA_CONFIRMADA', 'CITA_REPROGRAMADA', 'ENLACE_ONLINE') THEN c.id END,
         CASE WHEN b.canal = 'CORREO' AND b.tipo = 'DOCUMENTO_CLINICO' AND ev.modo = 'ADJUNTO' THEN d.contenido END,
         jsonb_strip_nulls(jsonb_build_object(
           'centro', (SELECT cc.nombre_centro FROM configuracion_centro cc),
           'destinatario', b.destinatario,
           'paciente', CASE WHEN b.destinatario = 'PACIENTE' THEN p.nombre END,
           'profesional', CASE
                            WHEN b.destinatario = 'EQUIPO' THEN ud.nombre
                            ELSE (SELECT coalesce(pf.nombre_publico, u.nombre) FROM usuarios u
                                  LEFT JOIN profesionales pf ON pf.usuario_id = u.id
                                  WHERE u.id = coalesce(c.profesional_id, d.emitido_por_id, co.practicante_id,
                                                        b.otro_profesional_id))
                          END,
           'cita_id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'modalidad', c.modalidad, 'estado', c.estado,
           'secuencia', c.secuencia, 'espacio', (SELECT e.nombre FROM espacios e WHERE e.id = c.espacio_id),
           'documento_id', d.id, 'tipo_documento', td.nombre, 'nombre_archivo', d.nombre_archivo,
           'emitido_en', d.emitido_en, 'modo', ev.modo,
           'creada_en', b.creada_en))
  FROM base b
  LEFT JOIN pacientes p ON p.id = b.paciente_id
  LEFT JOIN usuarios ud ON ud.id = b.usuario_id
  LEFT JOIN citas c ON c.id = b.cita_id
  LEFT JOIN recordatorios_cita r ON b.tipo = 'RECORDATORIO_CITA' AND r.id = b.referencia_id
  LEFT JOIN envios_documento ev ON b.tipo = 'DOCUMENTO_CLINICO' AND ev.id = b.referencia_id
  LEFT JOIN documentos_clinicos d ON d.id = ev.documento_id
  LEFT JOIN tipos_documento_clinico td ON td.id = d.tipo_documento_id
  LEFT JOIN consentimientos co ON b.tipo IN ('CONSENTIMIENTO_SOLICITADO', 'CONSENTIMIENTO_POR_VENCER') AND co.id = b.referencia_id
  LEFT JOIN plantillas_mensaje pl ON pl.evento = b.tipo AND pl.destinatario = b.destinatario AND pl.canal = b.canal
                                 AND pl.activa;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Permisos de funciones
-- -----------------------------------------------------------------------------
-- Internas (triggers y piezas del flujo): sin EXECUTE para app_user.
REVOKE EXECUTE ON FUNCTION
  validar_medios_pago(), proteger_estado_pago(), plazo_pago(timestamptz), monto_confirmacion(uuid),
  decidir_confirmacion(uuid), cita_de_reserva(bytea), cuenta_transferencia_existe(uuid),
  elegir_medio_cita(uuid, medio_confirmacion, uuid), estado_pago_cita(uuid), datos_transferencia(uuid),
  transferencia_de_cita(uuid), guardar_comprobante(uuid, bytea, text, text), puede_validar_transferencia(uuid),
  iniciar_cobro_pasarela(uuid)
FROM PUBLIC;

-- Llamadas desde la API (cada una valida su contexto: token de la reserva,
-- cuenta del paciente, rol segun el modelo de cobro o job/webhook sin usuario).
REVOKE EXECUTE ON FUNCTION
  medios_confirmacion_vigentes(), cita_del_portal(uuid),
  elegir_medio_reserva(bytea, medio_confirmacion, uuid), elegir_medio_portal(uuid, medio_confirmacion, uuid),
  estado_reserva(bytea), estado_pago_portal(uuid),
  datos_transferencia_reserva(bytea), datos_transferencia_portal(uuid),
  transferencia_de_reserva(bytea), subir_comprobante_reserva(bytea, bytea, text, text),
  transferencia_portal(uuid), subir_comprobante_portal(uuid, bytea, text, text),
  validar_transferencia(uuid), rechazar_transferencia(uuid, text),
  iniciar_cobro_reserva(bytea), iniciar_cobro_portal(uuid), confirmar_cobro_pasarela(uuid, text, boolean),
  liberar_reservas_vencidas()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  medios_confirmacion_vigentes(), cita_del_portal(uuid),
  elegir_medio_reserva(bytea, medio_confirmacion, uuid), elegir_medio_portal(uuid, medio_confirmacion, uuid),
  estado_reserva(bytea), estado_pago_portal(uuid),
  datos_transferencia_reserva(bytea), datos_transferencia_portal(uuid),
  transferencia_de_reserva(bytea), subir_comprobante_reserva(bytea, bytea, text, text),
  transferencia_portal(uuid), subir_comprobante_portal(uuid, bytea, text, text),
  validar_transferencia(uuid), rechazar_transferencia(uuid, text),
  iniciar_cobro_reserva(bytea), iniciar_cobro_portal(uuid), confirmar_cobro_pasarela(uuid, text, boolean),
  liberar_reservas_vencidas()
TO app_user;
