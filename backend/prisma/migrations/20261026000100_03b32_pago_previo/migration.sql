-- =============================================================================
-- 03b-3.2: la hora se confirma con el pago (reemplaza el flujo de 03b-3.1 en
-- la reserva sin cuenta y retira la aprobacion de pacientes nuevos).
--
-- Reserva sin cuenta (paciente nuevo):
--   1. Pedir hora crea la cita RETENIDA SIN paciente (paciente_id NULL), con
--      plazo = configuracion_centro.minutos_retencion_solicitud. Es una fila
--      de citas: el EXCLUDE la protege todo el plazo (el soft-lock de
--      bloqueos_temporales ya no se usa aqui).
--   2. Transferencia o pasarela: el pago se registra contra la cita y, en la
--      misma transaccion, concretar_reserva crea paciente, ficha, adulto
--      responsable y aceptaciones y deja la cita CONFIRMADA. Despues sale la
--      invitacion a la cuenta (verifica el correo al usarse).
--   3. Pago en el centro (o nada que cobrar): el gatillo es el correo
--      verificado (token VERIFICACION_SOLICITUD), igual que antes.
--   Nunca se crea paciente ni ficha (que no se borran) sin pago validado o
--   correo verificado.
--
-- Plazos (pago_vence_en; el job los vence, nunca el cliente):
--   - Paciente (reserva sin cuenta o portal): minutos de retencion.
--   - Equipo (POST /api/citas): hasta 12 h antes de la sesion, con avisos
--     PAGO_PENDIENTE al agendar y 48 h / 24 h antes (el que ya paso se omite).
--     A menos de 12 h no hay plazo: queda CONFIRMADA con pago en el centro.
--   - Comprobante subido a tiempo: la hora se mantiene hasta que se valide o
--     rechace (plazo_validacion_transferencia_horas, nunca despues del
--     inicio). Rechazo: vuelve a correr el plazo corto (o el del equipo).
--   Solo pago en el centro habilitado: el equipo confirma directo, como antes.
--
-- Aprobacion de pacientes nuevos (SOLICITADA): retirada. El pago validado es
-- la aprobacion. Las SOLICITADA existentes se migran (futuras -> pago
-- pendiente con el plazo del equipo; pasadas -> CANCELADA) y un CHECK impide
-- volver a usarlo. El valor queda en el enum (Postgres no borra valores).
--
-- Pago registrado por el equipo (registrar_pago) que cubre lo exigido para
-- confirmar: la cita pendiente queda CONFIRMADA (pacientes sin cuenta).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Citas: columnas nuevas
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "citas" ALTER COLUMN "paciente_id" DROP NOT NULL,
ADD COLUMN "agendada_por_equipo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "ultimo_aviso_pago" SMALLINT;

ALTER TABLE citas ADD CONSTRAINT citas_aviso_pago_valido CHECK (ultimo_aviso_pago IN (48, 24));

-- -----------------------------------------------------------------------------
-- 2. Plazos y cobro previo del equipo
-- -----------------------------------------------------------------------------
-- Plazo del paciente: los minutos de retencion, nunca despues del inicio.
CREATE OR REPLACE FUNCTION plazo_pago(p_inicio timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT least(now() + make_interval(mins => minutos_retencion_solicitud), p_inicio) FROM configuracion_centro
$$;

-- Plazo del equipo: hasta 12 h antes de la sesion.
CREATE FUNCTION plazo_pago_equipo(p_inicio timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_inicio - interval '12 hours'
$$;

-- Hay algo que cobrar para confirmar (porcentaje configurado del monto).
CREATE FUNCTION cobra_para_confirmar(p_monto integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ceil(coalesce(p_monto, 0) * porcentaje_pago_confirmacion / 100.0) > 0 FROM configuracion_centro
$$;

-- Cita que agenda el equipo (INSERT de la API con rol de equipo): queda
-- pendiente de pago hasta 12 h antes de la sesion. Confirma directo si solo
-- se paga en el centro, si no hay nada que cobrar o si ya no queda plazo
-- (pago en el centro). Corre despues de citas_monto_fijado (orden alfabetico)
-- para conocer el monto.
CREATE FUNCTION cobro_previo_equipo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.estado <> 'CONFIRMADA' OR coalesce(app_rol(), '') NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RETURN NEW;
  END IF;
  NEW.agendada_por_equipo := true;
  IF medios_confirmacion_vigentes() = ARRAY['PAGO_EN_CENTRO']::medio_confirmacion[] OR NOT cobra_para_confirmar(NEW.monto) THEN
    RETURN NEW;
  END IF;
  IF plazo_pago_equipo(NEW.inicio) <= now() THEN
    NEW.medio_confirmacion := 'PAGO_EN_CENTRO';
  ELSE
    NEW.estado := 'PENDIENTE_PAGO';
    NEW.pago_vence_en := plazo_pago_equipo(NEW.inicio);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER citas_pago_previo_equipo BEFORE INSERT ON citas
  FOR EACH ROW EXECUTE FUNCTION cobro_previo_equipo();

-- -----------------------------------------------------------------------------
-- 3. Aprobacion de pacientes nuevos: se retira
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  UPDATE citas SET estado = 'CANCELADA', updated_at = now() WHERE estado = 'SOLICITADA' AND inicio <= now();
  FOR r IN SELECT id, inicio FROM citas WHERE estado = 'SOLICITADA' FOR UPDATE LOOP
    BEGIN
      IF plazo_pago_equipo(r.inicio) <= now() THEN
        UPDATE citas SET estado = 'CONFIRMADA', medio_confirmacion = 'PAGO_EN_CENTRO', agendada_por_equipo = true,
                         updated_at = now()
        WHERE id = r.id;
      ELSE
        UPDATE citas SET estado = 'PENDIENTE_PAGO', pago_vence_en = plazo_pago_equipo(r.inicio), agendada_por_equipo = true,
                         updated_at = now()
        WHERE id = r.id;
        IF decidir_confirmacion(r.id) = 'PENDIENTE_PAGO' THEN
          PERFORM encolar_notificacion('PAGO_PENDIENTE', c.paciente_id, NULL, c.id, NULL) FROM citas c WHERE c.id = r.id;
        END IF;
      END IF;
    EXCEPTION WHEN check_violation OR exclusion_violation THEN
      -- La agenda cambio desde que se pidio (box, bloqueo): la hora no se puede mantener.
      UPDATE citas SET estado = 'CANCELADA', updated_at = now() WHERE id = r.id;
      RAISE NOTICE 'Cita SOLICITADA % cancelada al migrar: ya no cabe en la agenda', r.id;
    END;
  END LOOP;
END $$;

ALTER TABLE citas ADD CONSTRAINT citas_sin_solicitada CHECK (estado <> 'SOLICITADA');

DROP FUNCTION aprobar_cita_solicitada(uuid);
DROP FUNCTION invitar_tras_aprobar(uuid, bytea, timestamptz);
DROP FUNCTION concretar_solicitud_hora(bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz);
DROP FUNCTION reservar_cita_portal(uuid, modalidad_atencion, timestamptz, timestamptz, uuid, uuid);

-- AlterTable
ALTER TABLE "profesionales" DROP COLUMN "requiere_aprobacion_nuevos";

-- -----------------------------------------------------------------------------
-- 4. Restricciones de citas
-- -----------------------------------------------------------------------------
-- Sin paciente solo la hora retenida (o la que se libero sin concretarse).
ALTER TABLE citas ADD CONSTRAINT citas_paciente_segun_estado
  CHECK (paciente_id IS NOT NULL OR estado IN ('RETENIDA', 'LIBERADA'));
ALTER TABLE citas DROP CONSTRAINT citas_pago_coherente;
ALTER TABLE citas ADD CONSTRAINT citas_pago_coherente
  CHECK (estado NOT IN ('PENDIENTE_PAGO', 'RETENIDA') OR pago_vence_en IS NOT NULL);

-- La hora retenida tambien esta ocupada (EXCLUDE = fuente de verdad).
ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_espacio;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_espacio
  EXCLUDE USING gist (espacio_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA') AND modalidad = 'PRESENCIAL');
ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_profesional;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_profesional
  EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA'));

-- Listas de estados "hora ocupada" (ocupacion, disponibilidad, agenda): suman
-- RETENIDA. Las que miran al paciente (menor, bajas que mueven a
-- POR_REPROGRAMAR) quedan sin SOLICITADA. Se reescribe solo esa lista; si en
-- alguna no aparece, la migracion falla.
DO $$
DECLARE
  f text;
  def text;
  nuevo text;
  viejo constant text := $q$IN ('CONFIRMADA', 'SOLICITADA', 'PENDIENTE_PAGO')$q$;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'disponibilidad_publica(uuid, timestamptz, timestamptz)', 'estado_fichas_profesional(uuid)',
    'ocupacion_espacios(timestamptz, timestamptz)', 'proteger_bloque_atencion()', 'validar_agenda_cita()'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def, viejo, $q$IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA')$q$);
    IF nuevo = def THEN
      RAISE EXCEPTION 'La funcion % no trae la lista de estados esperada', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'iniciar_baja_profesional(uuid, timestamptz)', 'iniciar_baja_rol(uuid, rol, timestamptz)', 'procesar_bajas()',
    'validar_menor_con_adulto_responsable()'] LOOP
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def, viejo, $q$IN ('CONFIRMADA', 'PENDIENTE_PAGO')$q$);
    IF nuevo = def THEN
      RAISE EXCEPTION 'La funcion % no trae la lista de estados esperada', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;

  -- Monto: tambien se fija en la hora retenida (tarifa sin tipo de atencion: aun no hay paciente).
  def := pg_get_functiondef('fijar_monto_cita()'::regprocedure);
  nuevo := replace(def, $q$NEW.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO')$q$, $q$NEW.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA')$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'fijar_monto_cita no trae la condicion esperada';
  END IF;
  EXECUTE nuevo;

  -- Panel de inicio: "por aprobar" pasa a "pagos pendientes" (y transferencias por validar).
  def := pg_get_functiondef('reporte_dashboard()'::regprocedure);
  nuevo := replace(def, $q$'solicitudes_por_aprobar', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'SOLICITADA')$q$,
                        $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'PENDIENTE_PAGO')$q$);
  nuevo := replace(nuevo, $q$AND (c.estado = 'SOLICITADA'$q$, $q$AND (c.estado = 'PENDIENTE_PAGO'$q$);
  nuevo := replace(nuevo, $q$'solicitudes_por_aprobar', (SELECT count(*) FROM citas WHERE estado = 'SOLICITADA'),$q$,
                          $q$'pagos_pendientes', (SELECT count(*) FROM citas WHERE estado = 'PENDIENTE_PAGO'),
      'transferencias_por_validar', (SELECT count(*) FROM transferencias WHERE estado = 'POR_VALIDAR'),$q$);
  IF nuevo LIKE '%SOLICITADA%' THEN
    RAISE EXCEPTION 'reporte_dashboard no trae las condiciones esperadas';
  END IF;
  EXECUTE nuevo;

  -- Mensajeria: el aviso de pago pendiente va referido a su cita (fecha, hora, profesional).
  def := pg_get_functiondef('notificaciones_por_enviar(integer)'::regprocedure);
  nuevo := replace(def, $q$'PAGO_VALIDADO', 'PAGO_RECHAZADO') THEN t.referencia_id$q$,
                        $q$'PAGO_VALIDADO', 'PAGO_RECHAZADO', 'PAGO_PENDIENTE') THEN t.referencia_id$q$);
  IF nuevo = def THEN
    RAISE EXCEPTION 'notificaciones_por_enviar no trae la lista esperada';
  END IF;
  EXECUTE nuevo;
END $$;

-- La API (app_user) no mueve el estado de pago ni toca la hora retenida: solo
-- las funciones del flujo (SECURITY DEFINER) y el trigger del equipo. Puede
-- cancelar una cita pendiente de pago.
CREATE OR REPLACE FUNCTION proteger_estado_pago() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA') OR NEW.medio_confirmacion IS NOT NULL
       OR NEW.pago_vence_en IS NOT NULL OR NEW.ultimo_aviso_pago IS NOT NULL THEN
      RAISE EXCEPTION 'El estado de pago de la cita solo lo fija el flujo de confirmacion' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF OLD.estado = 'RETENIDA'
        OR NEW.medio_confirmacion IS DISTINCT FROM OLD.medio_confirmacion OR NEW.pago_vence_en IS DISTINCT FROM OLD.pago_vence_en
        OR NEW.ultimo_aviso_pago IS DISTINCT FROM OLD.ultimo_aviso_pago
        OR NEW.agendada_por_equipo IS DISTINCT FROM OLD.agendada_por_equipo
        OR (NEW.estado IS DISTINCT FROM OLD.estado
            AND (NEW.estado IN ('PENDIENTE_PAGO', 'LIBERADA', 'RETENIDA') OR OLD.estado = 'LIBERADA'
                 OR (OLD.estado = 'PENDIENTE_PAGO' AND NEW.estado <> 'CANCELADA'))) THEN
    RAISE EXCEPTION 'El estado de pago de la cita solo lo fija el flujo de confirmacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Reserva sin cuenta: la hora retenida es una cita sin paciente
-- -----------------------------------------------------------------------------
-- Como 03b-3.1, pero la retencion es la cita RETENIDA (EXCLUDE) y el enlace
-- del correo solo se emite si el gatillo es la verificacion (solo pago en el
-- centro o nada que cobrar); si no, el siguiente paso es pagar.
DROP FUNCTION crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea,
                                   bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea, bytea);
CREATE FUNCTION crear_solicitud_hora(
  p_id uuid, p_profesional_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz, p_fin timestamptz,
  p_nombre text, p_apellido text, p_fecha_nacimiento date, p_email text, p_telefono bytea,
  p_rut bytea, p_rut_hmac bytea, p_adulto_nombre text, p_adulto_parentesco text, p_adulto_telefono bytea,
  p_respuestas bytea, p_recomendado_id uuid, p_politica_id uuid, p_terminos_id uuid,
  p_token_hash bytea, p_reserva_hash bytea)
RETURNS TABLE (expira timestamptz, cita_id uuid, verificar_correo boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_expira timestamptz := plazo_pago(p_inicio);
  v_espacio uuid;
  v_cita uuid;
  v_verificar boolean;
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
  IF (SELECT count(*) FROM solicitudes_hora s JOIN citas c ON c.id = s.cita_id
      WHERE lower(s.email) = lower(p_email) AND s.estado = 'PENDIENTE_VERIFICACION' AND c.estado = 'RETENIDA'
        AND c.pago_vence_en > now()) >= 2 THEN
    RAISE EXCEPTION 'Ya hay reservas en curso para este correo'
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

  -- Presencial: la BD le pone el box del bloque del profesional (validar_agenda_cita).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, pago_vence_en)
  VALUES (p_modalidad, p_profesional_id, NULL, p_inicio, p_fin, 'RETENIDA', v_expira)
  RETURNING id, espacio_id INTO v_cita, v_espacio;

  INSERT INTO solicitudes_hora (id, profesional_id, modalidad, espacio_id, inicio, fin, nombre, apellido, fecha_nacimiento,
                                email, telefono, rut, rut_hmac, adulto_nombre, adulto_parentesco, adulto_telefono,
                                respuestas, recomendado_id, politica_id, terminos_id, expira_en, reserva_hash, cita_id)
  VALUES (p_id, p_profesional_id, p_modalidad, v_espacio, p_inicio, p_fin, btrim(p_nombre), btrim(p_apellido),
          p_fecha_nacimiento, lower(btrim(p_email)), p_telefono, p_rut, p_rut_hmac, nullif(btrim(p_adulto_nombre), ''),
          p_adulto_parentesco, p_adulto_telefono, p_respuestas, p_recomendado_id,
          p_politica_id, p_terminos_id, v_expira, p_reserva_hash, v_cita);

  v_verificar := medios_confirmacion_vigentes() = ARRAY['PAGO_EN_CENTRO']::medio_confirmacion[] OR monto_confirmacion(v_cita) = 0;
  IF v_verificar THEN
    PERFORM emitir_token('VERIFICACION_SOLICITUD', p_token_hash, least(p_inicio, now() + interval '24 hours'),
                         NULL, NULL, NULL, p_id, NULL, lower(btrim(p_email)));
  END IF;
  RETURN QUERY SELECT v_expira, v_cita, v_verificar;
END;
$$;

-- Cita de una reserva sin cuenta (por el hash del token opaco), en cualquier estado.
CREATE OR REPLACE FUNCTION cita_de_reserva(p_hash bytea) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  SELECT s.cita_id INTO v FROM solicitudes_hora s WHERE s.reserva_hash = p_hash;
  IF v IS NULL THEN
    RAISE EXCEPTION 'Reserva inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v;
END;
$$;

-- Gatillo de la verificacion del correo: pago en el centro elegido, o sin
-- eleccion cuando es el unico medio o no hay nada que cobrar.
CREATE FUNCTION confirma_con_correo(p_cita_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.medio_confirmacion = 'PAGO_EN_CENTRO'
         OR (c.medio_confirmacion IS NULL
             AND (medios_confirmacion_vigentes() = ARRAY['PAGO_EN_CENTRO']::medio_confirmacion[] OR monto_confirmacion(c.id) = 0))
  FROM citas c WHERE c.id = p_cita_id
$$;

-- Elegir el medio (interna): en la cita del paciente, pagar en el centro
-- confirma; en la hora retenida, deja el medio y el gatillo pasa a ser el
-- correo. Transferencia deja la fila por validar (id de la API); pasarela
-- queda en curso.
CREATE OR REPLACE FUNCTION elegir_medio_cita(p_cita_id uuid, p_medio medio_confirmacion, p_transferencia_id uuid) RETURNS estado_cita
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF c.estado IS DISTINCT FROM 'PENDIENTE_PAGO' AND (c.estado IS DISTINCT FROM 'RETENIDA' OR c.pago_vence_en <= now()) THEN
    RAISE EXCEPTION 'La cita no esta pendiente de pago' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_medio IS NULL OR NOT p_medio = ANY (medios_confirmacion_vigentes()) THEN
    RAISE EXCEPTION 'Ese medio de pago no esta habilitado en el centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_medio_no_habilitado';
  END IF;
  IF p_medio = 'PAGO_EN_CENTRO' AND c.estado = 'PENDIENTE_PAGO' THEN
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
    IF c.medio_confirmacion IS DISTINCT FROM 'TRANSFERENCIA' AND c.paciente_id IS NOT NULL THEN
      PERFORM encolar_notificacion('INSTRUCCIONES_TRANSFERENCIA', c.paciente_id, NULL, c.id, NULL);
    END IF;
  END IF;
  UPDATE citas SET medio_confirmacion = p_medio, updated_at = now() WHERE id = c.id;
  RETURN c.estado;
END;
$$;

-- Desde la reserva: pago en el centro en la hora retenida emite el enlace del
-- correo (la API lo envia a verificacion_email).
DROP FUNCTION elegir_medio_reserva(bytea, medio_confirmacion, uuid);
CREATE FUNCTION elegir_medio_reserva(p_hash bytea, p_medio medio_confirmacion, p_transferencia_id uuid, p_token_hash bytea)
RETURNS TABLE (estado estado_cita, verificacion_email text, retencion_vence timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_cita uuid := cita_de_reserva(p_hash);
  v_estado estado_cita := elegir_medio_cita(v_cita, p_medio, p_transferencia_id);
  s solicitudes_hora%ROWTYPE;
  v_vence timestamptz;
BEGIN
  IF v_estado = 'RETENIDA' AND p_medio = 'PAGO_EN_CENTRO' THEN
    SELECT * INTO s FROM solicitudes_hora x WHERE x.cita_id = v_cita;
    v_vence := least(s.inicio, now() + interval '24 hours');
    PERFORM emitir_token('VERIFICACION_SOLICITUD', p_token_hash, v_vence, NULL, NULL, NULL, s.id, NULL, s.email);
    -- El correo muestra el vencimiento de la retencion (el enlace sirve despues si nadie tomo la hora).
    RETURN QUERY SELECT v_estado, s.email, c.pago_vence_en FROM citas c WHERE c.id = v_cita;
  ELSE
    RETURN QUERY SELECT v_estado, NULL::text, NULL::timestamptz;
  END IF;
END;
$$;

-- Estado de una cita en el flujo de pago (interna): estado, vencimiento y
-- siguiente paso, sin datos personales. La hora retenida vencida figura
-- liberada por hora del servidor aunque el job aun no corra.
CREATE OR REPLACE FUNCTION estado_pago_cita(p_cita_id uuid)
RETURNS TABLE (estado text, vence_en timestamptz, siguiente text, medios medio_confirmacion[], medio medio_confirmacion,
               monto integer, comprobante_recibido boolean, motivo_rechazo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
  t transferencias%ROWTYPE;
  v_estado text;
  v_pendiente boolean;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id;
  SELECT * INTO t FROM transferencias WHERE cita_id = p_cita_id;
  v_estado := CASE WHEN c.estado = 'RETENIDA' AND c.pago_vence_en <= now() THEN 'LIBERADA' ELSE c.estado::text END;
  v_pendiente := v_estado IN ('PENDIENTE_PAGO', 'RETENIDA');
  RETURN QUERY SELECT
    v_estado,
    CASE WHEN v_pendiente THEN c.pago_vence_en END,
    CASE
      WHEN v_estado = 'CONFIRMADA' THEN 'NINGUNO'
      WHEN v_estado = 'RETENIDA' AND confirma_con_correo(c.id) THEN 'VERIFICAR_CORREO'
      WHEN v_pendiente AND c.medio_confirmacion IS NULL THEN 'ELEGIR_MEDIO'
      WHEN v_pendiente AND c.medio_confirmacion = 'TRANSFERENCIA' AND t.estado = 'RECHAZADA' THEN 'TRANSFERENCIA_RECHAZADA'
      WHEN v_pendiente AND c.medio_confirmacion = 'TRANSFERENCIA' THEN 'ESPERAR_VALIDACION'
      WHEN v_pendiente THEN 'PAGAR_EN_LINEA'
      -- Pago que llego cuando la hora ya no estaba: el centro lo devuelve.
      WHEN EXISTS (SELECT 1 FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO') THEN 'CONTACTAR_CENTRO'
      ELSE 'ELEGIR_OTRA_HORA'
    END,
    CASE WHEN v_pendiente THEN medios_confirmacion_vigentes() END,
    c.medio_confirmacion,
    CASE WHEN v_pendiente THEN monto_confirmacion(c.id) END,
    t.comprobante IS NOT NULL,
    CASE WHEN v_pendiente AND t.estado = 'RECHAZADA' THEN t.motivo_rechazo END;
END;
$$;

-- Estado de la reserva sin cuenta (sin contexto; rate limit en la API).
CREATE OR REPLACE FUNCTION estado_reserva(p_hash bytea)
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
  IF s.cita_id IS NULL THEN
    -- Reserva anterior a 03b-3.2 (sin cita): solo pudo vencer.
    RETURN QUERY SELECT 'LIBERADA', NULL::timestamptz, 'ELEGIR_OTRA_HORA', NULL::medio_confirmacion[], NULL::medio_confirmacion,
                        NULL::integer, false, NULL::text;
  ELSE
    RETURN QUERY SELECT * FROM estado_pago_cita(s.cita_id);
  END IF;
END;
$$;

-- Datos para transferir, comprobante y pasarela: tambien en la hora retenida.
CREATE OR REPLACE FUNCTION datos_transferencia(p_cita_id uuid)
RETURNS TABLE (origen text, cuenta_id uuid, rut bytea, banco bytea, tipo_cuenta bytea, numero_cuenta bytea, titular bytea,
               monto integer, vence_en timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id;
  IF c.estado NOT IN ('PENDIENTE_PAGO', 'RETENIDA') OR c.medio_confirmacion IS DISTINCT FROM 'TRANSFERENCIA' THEN
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

CREATE OR REPLACE FUNCTION transferencia_de_cita(p_cita_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v uuid;
BEGIN
  SELECT t.id INTO v FROM transferencias t JOIN citas c ON c.id = t.cita_id
  WHERE t.cita_id = p_cita_id AND t.estado <> 'VALIDADA' AND c.estado IN ('PENDIENTE_PAGO', 'RETENIDA')
    AND c.pago_vence_en > now() AND c.medio_confirmacion = 'TRANSFERENCIA';
  IF v IS NULL THEN
    RAISE EXCEPTION 'La cita no espera una transferencia' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN v;
END;
$$;

-- Comprobante subido a tiempo: la hora se mantiene hasta que se valide o
-- rechace (plazo de validacion del centro, nunca despues del inicio).
CREATE OR REPLACE FUNCTION guardar_comprobante(p_cita_id uuid, p_contenido bytea, p_tipo text, p_nombre text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid := transferencia_de_cita(p_cita_id);
  c citas%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  UPDATE transferencias SET comprobante = p_contenido, comprobante_tipo = p_tipo, comprobante_nombre = left(p_nombre, 200),
                            comprobante_subido_en = now(), estado = 'POR_VALIDAR', resuelta_en = NULL, resuelta_por_id = NULL
  WHERE id = v_id;
  UPDATE citas SET pago_vence_en = greatest(c.pago_vence_en, least(c.inicio, now() + make_interval(
                     hours => (SELECT plazo_validacion_transferencia_horas FROM configuracion_centro)))),
                   updated_at = now()
  WHERE id = c.id;
  IF c.paciente_id IS NOT NULL THEN
    PERFORM encolar_notificacion('COMPROBANTE_RECIBIDO', c.paciente_id, NULL, c.id, NULL);
  END IF;
END;
$$;

-- Validar: registra el pago (monto de confirmacion, medio TRANSFERENCIA). La
-- cita del paciente queda CONFIRMADA; la hora retenida la concreta la API en
-- la misma transaccion (concretar_reserva: necesita cifrar los datos).
CREATE OR REPLACE FUNCTION validar_transferencia(p_cita_id uuid) RETURNS uuid
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
  IF c.estado NOT IN ('PENDIENTE_PAGO', 'RETENIDA') OR t.estado = 'VALIDADA' THEN
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
  IF c.estado = 'PENDIENTE_PAGO' THEN
    UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('PAGO_VALIDADO', c.paciente_id, NULL, c.id, NULL);
    PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
  END IF;
  RETURN v_pago;
END;
$$;

-- Rechazar: queda el motivo; vuelve a correr el plazo (corto o el del equipo)
-- para transferir de nuevo. Aviso solo si ya hay paciente.
CREATE OR REPLACE FUNCTION rechazar_transferencia(p_cita_id uuid, p_motivo text) RETURNS void
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
  IF c.estado NOT IN ('PENDIENTE_PAGO', 'RETENIDA') OR t.estado <> 'POR_VALIDAR' THEN
    RAISE EXCEPTION 'La transferencia no esta por validar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE transferencias SET estado = 'RECHAZADA', motivo_rechazo = btrim(p_motivo), resuelta_por_id = app_usuario_id(),
                            resuelta_en = now()
  WHERE id = t.id;
  UPDATE citas SET pago_vence_en = least(c.inicio, greatest(plazo_pago(c.inicio),
                                                            CASE WHEN c.agendada_por_equipo THEN plazo_pago_equipo(c.inicio) END)),
                   updated_at = now()
  WHERE id = c.id;
  IF c.paciente_id IS NOT NULL THEN
    PERFORM encolar_notificacion('PAGO_RECHAZADO', c.paciente_id, NULL, c.id, NULL);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION iniciar_cobro_pasarela(p_cita_id uuid) RETURNS TABLE (cobro_id uuid, monto integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
  v_monto int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF c.estado NOT IN ('PENDIENTE_PAGO', 'RETENIDA') OR c.pago_vence_en <= now() OR c.medio_confirmacion IS DISTINCT FROM 'PASARELA' THEN
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

-- Webhook (sin contexto; la API ya verifico la firma): idempotente por estado
-- del intento y por evento_id. Pagado: registra el pago; la cita del paciente
-- queda CONFIRMADA si sigue pendiente (si vencio, el pago queda para
-- devolucion); la hora retenida (o vencida sin paciente) la concreta la API
-- con cita_id en la misma transaccion.
DROP FUNCTION confirmar_cobro_pasarela(uuid, text, boolean);
CREATE FUNCTION confirmar_cobro_pasarela(p_cobro_id uuid, p_evento_id text, p_pagado boolean)
RETURNS TABLE (estado estado_cobro_pasarela, cita_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
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
  IF k.estado <> 'PENDIENTE' OR EXISTS (SELECT 1 FROM cobros_pasarela x WHERE x.evento_id = p_evento_id) THEN
    RETURN QUERY SELECT k.estado, k.cita_id;
    RETURN;
  END IF;
  IF NOT p_pagado THEN
    UPDATE cobros_pasarela SET estado = 'FALLIDO', evento_id = p_evento_id, procesado_en = now() WHERE id = k.id;
    RETURN QUERY SELECT 'FALLIDO'::estado_cobro_pasarela, k.cita_id;
    RETURN;
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
  RETURN QUERY SELECT 'PAGADO'::estado_cobro_pasarela, c.id;
END;
$$;

-- Datos cifrados de la reserva pagada y aun sin paciente (la API los
-- descifra con el AAD de la solicitud y los vuelve a cifrar con el del
-- paciente). Sin filas si no hay nada que concretar. Lo pide el webhook (sin
-- usuario) o quien valida la transferencia de esa cita.
CREATE FUNCTION reserva_por_concretar(p_cita_id uuid)
RETURNS TABLE (solicitud_id uuid, telefono bytea, rut bytea, adulto_telefono bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  c citas%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id;
  IF NOT FOUND OR NOT (app_usuario_id() IS NULL OR puede_validar_transferencia(c.profesional_id)) THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.paciente_id IS NOT NULL OR c.estado NOT IN ('RETENIDA', 'LIBERADA') OR monto_confirmacion(c.id) > 0
     OR NOT EXISTS (SELECT 1 FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT s.id, s.telefono, s.rut, s.adulto_telefono FROM solicitudes_hora s
  WHERE s.cita_id = c.id AND s.estado <> 'CONCRETADA';
END;
$$;

-- Concretar la reserva: paciente (id de la API), ficha, adulto responsable,
-- aceptaciones; la cita pasa a CONFIRMADA con su paciente y sale la
-- invitacion a la cuenta. Dos gatillos:
--   - p_token_hash (enlace del correo): solo si se paga en el centro o no hay
--     nada que cobrar. Verificacion tardia (retencion vencida): vale si la
--     hora sigue libre; si no, 23P01 solicitudes_hora_tomada (la API responde
--     con alternativas).
--   - sin token (pago registrado): lo llama el webhook o quien valida la
--     transferencia. Si la hora ya no se puede mantener (vencio y otra
--     persona la tomo, bloqueo de agenda), la cita queda LIBERADA y el pago
--     queda para devolucion (CONTACTAR_CENTRO), sin crear paciente.
CREATE FUNCTION concretar_reserva(
  p_cita_id uuid, p_token_hash bytea, p_paciente_id uuid, p_adulto_id uuid, p_telefono bytea, p_rut bytea, p_rut_hmac bytea,
  p_adulto_telefono bytea, p_invitacion_hash bytea, p_invitacion_expira timestamptz)
RETURNS TABLE (paciente_id uuid, cita_id uuid, estado estado_cita, modalidad modalidad_atencion, profesional_id uuid,
               inicio timestamptz, fin timestamptz, invitacion_email text, invitacion_rol rol,
               sala_modo modo_videollamada, sala_enlace bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE;
  s solicitudes_hora%ROWTYPE;
  c citas%ROWTYPE;
  v_pagada boolean := p_token_hash IS NULL;
  v_menor boolean;
  v_rut_libre boolean;
  v_dup boolean;
  v_adulto uuid;
  v_inv_email text;
  v_inv_rol rol;
  -- Solo los errores de la hora (inicio, EXCLUDE, agenda) se tratan como "hora tomada";
  -- las variables de plpgsql no vuelven atras con el subbloque.
  v_en_hora boolean := false;
BEGIN
  IF v_pagada THEN
    SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
    IF NOT FOUND OR NOT (app_usuario_id() IS NULL OR puede_validar_transferencia(c.profesional_id)) THEN
      RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
    END IF;
    IF monto_confirmacion(c.id) > 0 OR NOT EXISTS (SELECT 1 FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO') THEN
      RAISE EXCEPTION 'La reserva aun no esta pagada' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    SELECT * INTO s FROM solicitudes_hora x WHERE x.cita_id = c.id FOR UPDATE;
  ELSE
    t := consumir_token(p_token_hash, 'VERIFICACION_SOLICITUD');
    SELECT * INTO s FROM solicitudes_hora WHERE id = t.referencia_id FOR UPDATE;
    SELECT * INTO c FROM citas WHERE id = s.cita_id FOR UPDATE;
    IF c.id IS NOT NULL AND NOT confirma_con_correo(c.id) THEN
      RAISE EXCEPTION 'Elegiste pagar para confirmar: completa el pago en la pantalla de la reserva'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;
  IF s.id IS NULL OR c.id IS NULL OR s.estado = 'CONCRETADA' OR c.paciente_id IS NOT NULL OR c.estado NOT IN ('RETENIDA', 'LIBERADA') THEN
    RAISE EXCEPTION 'La solicitud ya se proceso' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  BEGIN
    IF c.inicio <= now() THEN
      v_en_hora := true;
      RAISE EXCEPTION 'La hora ya paso' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_tomada';
    END IF;
    v_menor := age((s.inicio AT TIME ZONE 'America/Santiago')::date, s.fecha_nacimiento) < interval '18 years';
    v_rut_libre := p_rut_hmac IS NULL OR NOT EXISTS (SELECT 1 FROM pacientes x WHERE x.rut_hmac = p_rut_hmac);
    -- Nunca fusionar por nombre (D-2): identidad = RUT (indice ciego) + correo. Coincidencias -> GESTION concilia.
    v_dup := NOT v_rut_libre
             OR (NOT v_menor AND EXISTS (SELECT 1 FROM pacientes x WHERE lower(x.email) = s.email));

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

    -- Retencion vigente o vencida: el EXCLUDE y validar_agenda_cita deciden si la hora sigue libre.
    v_en_hora := true;
    UPDATE citas SET paciente_id = p_paciente_id, estado = 'CONFIRMADA',
                     medio_confirmacion = coalesce(c.medio_confirmacion,
                       CASE WHEN medios_confirmacion_vigentes() = ARRAY['PAGO_EN_CENTRO']::medio_confirmacion[]
                            THEN 'PAGO_EN_CENTRO'::medio_confirmacion END),
                     updated_at = now()
    WHERE id = c.id;
  EXCEPTION WHEN exclusion_violation OR check_violation THEN
    IF NOT v_en_hora THEN
      RAISE;
    END IF;
    IF NOT v_pagada THEN
      RAISE EXCEPTION 'La hora ya no esta disponible' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_tomada';
    END IF;
    -- Pagada pero la hora ya no se puede mantener: queda para devolucion.
    UPDATE citas SET estado = 'LIBERADA', updated_at = now() WHERE id = c.id AND estado = 'RETENIDA';
    UPDATE solicitudes_hora SET estado = 'EXPIRADA' WHERE id = s.id;
    RETURN QUERY SELECT NULL::uuid, c.id, 'LIBERADA'::estado_cita, c.modalidad, c.profesional_id, c.inicio, c.fin,
                        NULL::text, NULL::rol, NULL::modo_videollamada, NULL::bytea;
    RETURN;
  END;

  UPDATE solicitudes_hora SET estado = 'CONCRETADA', paciente_id = p_paciente_id, concretada_en = now() WHERE id = s.id;
  IF v_pagada THEN
    PERFORM encolar_notificacion('PAGO_VALIDADO', p_paciente_id, NULL, c.id, NULL);
  END IF;
  PERFORM encolar_notificacion('CITA_CONFIRMADA', p_paciente_id, NULL, c.id, NULL);
  IF p_invitacion_hash IS NOT NULL THEN
    SELECT i.email, i.rol INTO v_inv_email, v_inv_rol
    FROM invitar_paciente_del_portal(p_paciente_id, p_invitacion_hash, p_invitacion_expira) i;
  END IF;

  RETURN QUERY
  SELECT p_paciente_id, c.id, 'CONFIRMADA'::estado_cita, c.modalidad, c.profesional_id, c.inicio, c.fin, v_inv_email, v_inv_rol,
         sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON c.modalidad = 'ONLINE' AND sv.usuario_id = c.profesional_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Portal: misma regla (pagar para confirmar), sin aprobacion
-- -----------------------------------------------------------------------------
CREATE FUNCTION reservar_cita_portal(p_paciente_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz,
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

  -- Presencial: la BD le pone el box del bloque del profesional (validar_agenda_cita).
  INSERT INTO citas (modalidad, profesional_id, paciente_id, inicio, fin, estado, pago_vence_en)
  VALUES (p_modalidad, v_profesional, p_paciente_id, p_inicio, p_fin, 'PENDIENTE_PAGO', plazo_pago(p_inicio))
  RETURNING id INTO v_cita;

  -- Politica de datos y terminos vigentes: se registran si esta version aun no estaba aceptada.
  INSERT INTO aceptaciones_politica (politica_id, paciente_id, otorgado_por, adulto_responsable_id, canal)
  SELECT x.id, p_paciente_id, v_otorgante, v_adulto, 'PORTAL'
  FROM unnest(ARRAY[p_politica_id, p_terminos_id]) AS x(id)
  WHERE NOT EXISTS (SELECT 1 FROM aceptaciones_politica a WHERE a.paciente_id = p_paciente_id AND a.politica_id = x.id);

  v_estado := decidir_confirmacion(v_cita);

  RETURN QUERY
  SELECT v_cita, v_estado, v_profesional, sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON p_modalidad = 'ONLINE' AND sv.usuario_id = v_profesional;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Pago registrado por el equipo: confirma la cita pendiente si cubre lo exigido
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_pago(p_cita_id uuid, p_monto integer, p_medio medio_pago) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
  v_saldo int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT acceso_vigente() OR NOT (app_rol() IN ('ADMIN', 'GESTION')
          OR (app_rol() = 'PROFESIONAL' AND c.profesional_id = app_usuario_id() AND cobro_directo(c.profesional_id))) THEN
    RAISE EXCEPTION 'Registran ADMIN/GESTION, o el profesional de la cita con cobro directo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF c.profesional_id IS NULL THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  -- La hora retenida (sin paciente) se paga por la reserva, no por caja.
  IF c.paciente_id IS NULL THEN
    RAISE EXCEPTION 'La hora esta retenida por una reserva en curso' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser positivo' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_monto_positivo';
  END IF;
  SELECT saldo INTO v_saldo FROM estado_pago_citas WHERE cita_id = p_cita_id;
  IF p_monto > v_saldo THEN
    RAISE EXCEPTION 'El pago supera el saldo de la cita (%)', v_saldo
      USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_sin_sobrepago';
  END IF;
  INSERT INTO pagos (cita_id, monto, medio_pago, registrado_por_id, cobrado_por)
  VALUES (p_cita_id, p_monto, p_medio, app_usuario_id(),
          CASE WHEN cobro_directo(c.profesional_id) THEN 'PROFESIONAL'::cobrado_por ELSE 'CENTRO' END)
  RETURNING id INTO v_id;
  IF c.estado = 'PENDIENTE_PAGO' AND monto_confirmacion(c.id) = 0 THEN
    UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = c.id;
    PERFORM encolar_notificacion('CITA_CONFIRMADA', c.paciente_id, NULL, c.id, NULL);
  END IF;
  RETURN v_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Jobs: vencimientos y avisos de pago
-- -----------------------------------------------------------------------------
-- Citas pendientes o retenidas con el plazo vencido -> LIBERADA (aviso al
-- paciente si lo hay; la reserva sin paciente queda EXPIRADA). Idempotente;
-- SKIP LOCKED.
CREATE OR REPLACE FUNCTION liberar_reservas_vencidas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  v_n int := 0;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    SELECT x.id, x.paciente_id FROM citas x
    WHERE x.estado IN ('PENDIENTE_PAGO', 'RETENIDA') AND x.pago_vence_en <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE citas SET estado = 'LIBERADA', updated_at = now() WHERE id = c.id;
    IF c.paciente_id IS NOT NULL THEN
      PERFORM encolar_notificacion('HORA_LIBERADA', c.paciente_id, NULL, c.id, NULL);
    END IF;
    UPDATE solicitudes_hora SET estado = 'EXPIRADA' WHERE cita_id = c.id AND estado = 'PENDIENTE_VERIFICACION';
    v_n := v_n + 1;
  END LOOP;
  -- Reservas anteriores a 03b-3.2 (retenidas con soft-lock, sin cita).
  WITH vencidas AS (
    UPDATE solicitudes_hora SET estado = 'EXPIRADA'
    WHERE estado = 'PENDIENTE_VERIFICACION' AND cita_id IS NULL AND expira_en <= now() RETURNING id
  )
  DELETE FROM bloqueos_temporales b USING vencidas v WHERE b.solicitud_id = v.id;
  RETURN v_n;
END;
$$;

-- Avisos de pago de las horas que agenda el equipo: 48 h y 24 h antes de la
-- sesion, mientras siga pendiente y sin comprobante por validar. El hito que
-- ya habia pasado al agendar se omite (el aviso inicial lo cubre).
CREATE FUNCTION avisar_pagos_pendientes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c record;
  v_hito smallint;
  v_n int := 0;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR c IN
    SELECT x.id, x.paciente_id, x.inicio, x.created_at FROM citas x
    WHERE x.estado = 'PENDIENTE_PAGO' AND x.agendada_por_equipo AND x.pago_vence_en > now()
      AND ((x.ultimo_aviso_pago IS NULL AND x.inicio - interval '48 hours' <= now())
           OR (coalesce(x.ultimo_aviso_pago, 48) = 48 AND x.inicio - interval '24 hours' <= now()))
      AND NOT EXISTS (SELECT 1 FROM transferencias t WHERE t.cita_id = x.id AND t.estado = 'POR_VALIDAR'
                        AND t.comprobante IS NOT NULL)
    FOR UPDATE SKIP LOCKED
  LOOP
    v_hito := CASE WHEN c.inicio - interval '24 hours' <= now() THEN 24 ELSE 48 END;
    UPDATE citas SET ultimo_aviso_pago = v_hito WHERE id = c.id;
    IF c.created_at < c.inicio - make_interval(hours => v_hito) THEN
      PERFORM encolar_notificacion('PAGO_PENDIENTE', c.paciente_id, NULL, c.id, NULL);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Limpieza (03a): sin el vencimiento de retenciones (lo hace liberar_reservas_vencidas).
CREATE OR REPLACE FUNCTION limpiar_solicitudes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_dias int := (SELECT dias_retencion_respuestas_match FROM configuracion_centro);
  v_n int := 0;
  v_m int;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE solicitudes_hora s SET respuestas = NULL
  WHERE s.respuestas IS NOT NULL AND s.creada_en <= now() - make_interval(days => v_dias)
    AND (s.estado <> 'CONCRETADA'
         OR NOT EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id = s.paciente_id AND c.estado = 'CONFIRMADA'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM solicitudes_hora WHERE estado = 'EXPIRADA' AND creada_en <= now() - make_interval(days => v_dias);
  GET DIAGNOSTICS v_m = ROW_COUNT;
  RETURN v_n + v_m;
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Mensajeria: plantilla del aviso de pago pendiente
-- -----------------------------------------------------------------------------
INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT 'PAGO_PENDIENTE'::tipo_notificacion, 'PACIENTE'::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('Hora pendiente de pago',
   'Hola {{nombre_paciente}}: su hora del {{fecha}} a las {{hora}} con {{nombre_profesional}} esta pendiente de pago. Pague hasta 12 horas antes de la sesion para confirmarla; si no, la hora se libera. Detalle: {{enlace}}')
) AS e(asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);

-- -----------------------------------------------------------------------------
-- 10. Permisos de funciones
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
  plazo_pago_equipo(timestamptz), cobra_para_confirmar(integer), cobro_previo_equipo(), confirma_con_correo(uuid)
FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION
  crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea,
                       bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea, bytea),
  elegir_medio_reserva(bytea, medio_confirmacion, uuid, bytea), confirmar_cobro_pasarela(uuid, text, boolean),
  reserva_por_concretar(uuid),
  concretar_reserva(uuid, bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz),
  reservar_cita_portal(uuid, modalidad_atencion, timestamptz, timestamptz, uuid, uuid),
  avisar_pagos_pendientes()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea,
                       bytea, bytea, text, text, bytea, bytea, uuid, uuid, uuid, bytea, bytea),
  elegir_medio_reserva(bytea, medio_confirmacion, uuid, bytea), confirmar_cobro_pasarela(uuid, text, boolean),
  reserva_por_concretar(uuid),
  concretar_reserva(uuid, bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz),
  reservar_cita_portal(uuid, modalidad_atencion, timestamptz, timestamptz, uuid, uuid),
  avisar_pagos_pendientes()
TO app_user;
