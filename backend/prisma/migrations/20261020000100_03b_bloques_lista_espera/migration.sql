-- =============================================================================
-- 03b: la agenda sale del box.
--
-- 1. El centro define cuando se puede usar cada box (horarios_espacio, ahora
--    por periodo: semana, mes, trimestre o sin fechas = siempre).
-- 2. El profesional (o ADMIN/GESTION por el) aparta bloques de un box dentro
--    de ese horario: bloques_atencion. Son su agenda: una cita (presencial u
--    online) solo cae dentro de un bloque suyo, y una cita presencial usa el
--    box del bloque (lo fija la BD). La disponibilidad publica, el match y
--    los huecos del backoffice salen de los bloques.
-- 3. Lista de espera publica sin cuenta (lista_espera_publica), por
--    profesional (por tipo de atencion queda pendiente): inscripcion
--    verificada por correo; si se libera una hora o el profesional aparta un
--    bloque nuevo, un job avisa por correo. No crea paciente ni ficha; vence
--    sola (configuracion_centro.dias_lista_espera_publica).
-- 4. Dashboard: el uso de box se mide por horas apartadas (muestra).
--
-- Categorias: bloques_atencion = A + C (agenda del profesional; otros ven la
-- ocupacion via ocupacion_espacios() / disponibilidad_espacios() /
-- disponibilidad_publica()). lista_espera_publica = A (contacto; telefono
-- cifrado; sin GRANT de escritura: solo funciones).
--
-- disponibilidad_profesional queda como "horario habitual" (plantilla para
-- apartar bloques); ya no decide la agenda.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Horario del box por periodo
-- -----------------------------------------------------------------------------
ALTER TABLE "horarios_espacio" ADD COLUMN "vigente_desde" DATE,
ADD COLUMN "vigente_hasta" DATE;

ALTER TABLE horarios_espacio ADD CONSTRAINT horarios_espacio_periodo
  CHECK (vigente_desde IS NULL OR vigente_hasta IS NULL OR vigente_hasta >= vigente_desde);

-- Rango dentro del horario del box ese dia (filas del periodo vigente). Box
-- sin filas = sin restriccion propia (manda el horario del centro). No cruza
-- el dia.
CREATE FUNCTION en_horario_espacio(p_espacio_id uuid, p_inicio timestamptz, p_fin timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM horarios_espacio WHERE espacio_id = p_espacio_id)
      OR EXISTS (SELECT 1 FROM horarios_espacio h, (SELECT (p_inicio AT TIME ZONE 'America/Santiago')::date AS dia) d
                 WHERE h.espacio_id = p_espacio_id AND h.dia_semana = extract(isodow FROM d.dia)
                   AND (h.vigente_desde IS NULL OR h.vigente_desde <= d.dia)
                   AND (h.vigente_hasta IS NULL OR d.dia <= h.vigente_hasta)
                   AND p_inicio >= minuto_local(d.dia, h.inicio_min) AND p_fin <= minuto_local(d.dia, h.fin_min))
$$;

-- Rango dentro del horario del centro (sin filas = sin restriccion).
CREATE FUNCTION en_horario_centro(p_inicio timestamptz, p_fin timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM horario_centro)
      OR EXISTS (SELECT 1 FROM horario_centro h, (SELECT (p_inicio AT TIME ZONE 'America/Santiago')::date AS dia) d
                 WHERE h.dia_semana = extract(isodow FROM d.dia)
                   AND p_inicio >= minuto_local(d.dia, h.inicio_min) AND p_fin <= minuto_local(d.dia, h.fin_min))
$$;

-- -----------------------------------------------------------------------------
-- 2. Bloques de atencion (horas de box apartadas por el profesional)
-- -----------------------------------------------------------------------------
-- CreateTable
CREATE TABLE "bloques_atencion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID NOT NULL,
    "espacio_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6) NOT NULL,
    "creado_por_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloques_atencion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bloques_atencion_profesional_id_inicio_idx" ON "bloques_atencion"("profesional_id", "inicio");

-- CreateIndex
CREATE INDEX "bloques_atencion_espacio_id_inicio_idx" ON "bloques_atencion"("espacio_id", "inicio");

-- AddForeignKey
ALTER TABLE "bloques_atencion" ADD CONSTRAINT "bloques_atencion_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloques_atencion" ADD CONSTRAINT "bloques_atencion_espacio_id_fkey" FOREIGN KEY ("espacio_id") REFERENCES "espacios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloques_atencion" ADD CONSTRAINT "bloques_atencion_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE bloques_atencion ADD CONSTRAINT bloques_atencion_rango CHECK (fin > inicio);
-- Fuente de verdad: un box lo usa un solo profesional a la vez, y un
-- profesional no aparta dos boxes a la misma hora.
ALTER TABLE bloques_atencion ADD CONSTRAINT bloques_atencion_sin_choque_box
  EXCLUDE USING gist (espacio_id WITH =, tstzrange(inicio, fin, '[)') WITH &&);
ALTER TABLE bloques_atencion ADD CONSTRAINT bloques_atencion_sin_choque_profesional
  EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin, '[)') WITH &&);

-- Apartar: profesional o practicante sin baja, box activo, dentro del horario
-- del box (periodo vigente) y del centro.
CREATE FUNCTION validar_bloque_atencion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (tiene_rol(NEW.profesional_id, 'PROFESIONAL') OR tiene_rol(NEW.profesional_id, 'PRACTICANTE'))
     OR EXISTS (SELECT 1 FROM bajas WHERE usuario_id = NEW.profesional_id) THEN
    RAISE EXCEPTION 'Solo un profesional o practicante vigente aparta horas de box'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bloques_atencion_profesional';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM espacios WHERE id = NEW.espacio_id AND activo) THEN
    RAISE EXCEPTION 'El box no existe o esta inactivo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bloques_atencion_box_activo';
  END IF;
  IF NOT en_horario_espacio(NEW.espacio_id, NEW.inicio, NEW.fin) THEN
    RAISE EXCEPTION 'El bloque cae fuera del horario disponible del box'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bloques_atencion_dentro_de_horario_espacio';
  END IF;
  IF NOT en_horario_centro(NEW.inicio, NEW.fin) THEN
    RAISE EXCEPTION 'El bloque cae fuera del horario de atencion del centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bloques_atencion_dentro_de_horario_centro';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bloques_atencion_validos BEFORE INSERT ON bloques_atencion
  FOR EACH ROW EXECUTE FUNCTION validar_bloque_atencion();

-- Liberar: no si tiene citas vigentes o retenciones en curso dentro.
CREATE FUNCTION proteger_bloque_atencion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM citas c
             WHERE c.profesional_id = OLD.profesional_id AND c.estado IN ('CONFIRMADA', 'SOLICITADA')
               AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(OLD.inicio, OLD.fin, '[)'))
     OR EXISTS (SELECT 1 FROM bloqueos_temporales t
                WHERE t.profesional_id = OLD.profesional_id AND t.expira_en > now()
                  AND tstzrange(t.inicio, t.fin, '[)') && tstzrange(OLD.inicio, OLD.fin, '[)')) THEN
    RAISE EXCEPTION 'El bloque tiene citas o reservas en curso: reprograme o cancele antes de liberarlo'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER bloques_atencion_protegidos BEFORE DELETE ON bloques_atencion
  FOR EACH ROW EXECUTE FUNCTION proteger_bloque_atencion();

ALTER TABLE bloques_atencion ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloques_atencion FORCE ROW LEVEL SECURITY;
CREATE POLICY bloques_atencion_gestion ON bloques_atencion FOR ALL TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()))
  WITH CHECK (((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()))
              AND creado_por_id = (SELECT app_usuario_id()));
CREATE POLICY bloques_atencion_acceso_vigente ON bloques_atencion AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT, INSERT, DELETE ON bloques_atencion TO app_user;

-- Bloques fuera del horario del box (para no dejar bloques huerfanos al
-- cambiar el horario): la API lo consulta despues de reemplazarlo.
CREATE FUNCTION bloques_fuera_de_horario(p_espacio_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM bloques_atencion b
  WHERE b.espacio_id = p_espacio_id AND b.fin > now() AND NOT en_horario_espacio(b.espacio_id, b.inicio, b.fin)
$$;

-- Horas libres de cada box (horario del periodo vigente, o del centro, menos
-- bloques ya apartados): lo que un profesional puede apartar. Sin pacientes
-- ni profesionales. Equipo con acceso vigente.
CREATE FUNCTION disponibilidad_espacios(desde timestamptz, hasta timestamptz)
RETURNS TABLE (espacio_id uuid, inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'disponibilidad_espacios: requiere equipo con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF desde IS NULL OR hasta IS NULL OR hasta <= desde OR hasta - desde > interval '62 days' THEN
    RAISE EXCEPTION 'Rango invalido (maximo 62 dias)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'disponibilidad_publica_rango';
  END IF;
  RETURN QUERY
  WITH dias AS (
    SELECT g.dia::date AS dia
    FROM generate_series((desde AT TIME ZONE 'America/Santiago')::date::timestamp,
                         (hasta AT TIME ZONE 'America/Santiago')::date::timestamp, interval '1 day') AS g(dia)
  ), centro AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM horario_centro)
                THEN (SELECT coalesce(range_agg(tstzrange(minuto_local(x.dia, h.inicio_min), minuto_local(x.dia, h.fin_min), '[)')),
                                      '{}'::tstzmultirange)
                      FROM dias x JOIN horario_centro h ON h.dia_semana = extract(isodow FROM x.dia))
                ELSE tstzmultirange(tstzrange(desde, hasta, '[)')) END AS r
  ), abierto AS (
    -- Box con horario propio: sus filas vigentes; sin filas: todo el rango.
    SELECT e.id AS e, tstzrange(minuto_local(x.dia, h.inicio_min), minuto_local(x.dia, h.fin_min), '[)') AS r
    FROM espacios e JOIN horarios_espacio h ON h.espacio_id = e.id
    JOIN dias x ON h.dia_semana = extract(isodow FROM x.dia)
      AND (h.vigente_desde IS NULL OR h.vigente_desde <= x.dia) AND (h.vigente_hasta IS NULL OR x.dia <= h.vigente_hasta)
    WHERE e.activo
    UNION ALL
    SELECT e.id, tstzrange(desde, hasta, '[)') FROM espacios e
    WHERE e.activo AND NOT EXISTS (SELECT 1 FROM horarios_espacio h WHERE h.espacio_id = e.id)
  ), libres AS (
    SELECT a.e,
           unnest((range_agg(a.r)
                   - coalesce((SELECT range_agg(tstzrange(b.inicio, b.fin, '[)')) FROM bloques_atencion b
                               WHERE b.espacio_id = a.e AND b.fin > desde AND b.inicio < hasta), '{}'::tstzmultirange))
                  * tstzmultirange(tstzrange(greatest(desde, now()), hasta, '[)')) * (SELECT c.r FROM centro c)) AS r
    FROM abierto a GROUP BY a.e
  )
  SELECT l.e, lower(l.r), upper(l.r) FROM libres l WHERE NOT isempty(l.r) ORDER BY 1, 2;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. La agenda sale de los bloques
-- -----------------------------------------------------------------------------
-- Cita vigente: dentro de un bloque de su profesional (cualquier modalidad);
-- presencial = box del bloque (lo fija la BD), online = sin box. Sigue
-- validando bloqueos de agenda, horario del centro y del box.
CREATE OR REPLACE FUNCTION validar_agenda_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_box uuid;
BEGIN
  IF NEW.estado NOT IN ('CONFIRMADA', 'SOLICITADA') THEN
    RETURN NEW;
  END IF;
  SELECT b.espacio_id INTO v_box FROM bloques_atencion b
  WHERE b.profesional_id = NEW.profesional_id AND b.inicio <= NEW.inicio AND b.fin >= NEW.fin;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cita cae fuera de la disponibilidad del profesional (horas de box apartadas)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_disponibilidad';
  END IF;
  NEW.espacio_id := CASE WHEN NEW.modalidad = 'PRESENCIAL' THEN v_box END;
  IF EXISTS (
    SELECT 1 FROM bloqueos_agenda b
    WHERE b.profesional_id = NEW.profesional_id
      AND tstzrange(b.inicio, b.fin, '[)') && tstzrange(NEW.inicio, NEW.fin, '[)')
  ) THEN
    RAISE EXCEPTION 'El profesional tiene la agenda bloqueada en ese horario'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_fuera_de_bloqueos';
  END IF;
  IF NOT en_horario_centro(NEW.inicio, NEW.fin) THEN
    RAISE EXCEPTION 'La cita cae fuera del horario de atencion del centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_horario_centro';
  END IF;
  IF NEW.modalidad = 'PRESENCIAL' AND NOT en_horario_espacio(NEW.espacio_id, NEW.inicio, NEW.fin) THEN
    RAISE EXCEPTION 'La cita cae fuera del horario de funcionamiento del box'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_horario_espacio';
  END IF;
  RETURN NEW;
END;
$$;

-- Soft-lock presencial del equipo: box del bloque (como la cita).
CREATE FUNCTION asignar_box_bloqueo_temporal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.modalidad = 'PRESENCIAL' THEN
    NEW.espacio_id := coalesce((SELECT b.espacio_id FROM bloques_atencion b
                                WHERE b.profesional_id = NEW.profesional_id AND b.inicio <= NEW.inicio AND b.fin >= NEW.fin),
                               NEW.espacio_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bloqueos_temporales_box_del_bloque BEFORE INSERT ON bloqueos_temporales
  FOR EACH ROW EXECUTE FUNCTION asignar_box_bloqueo_temporal();

-- Disponibilidad publica: los bloques del profesional (ambas modalidades)
-- menos citas, bloqueos y retenciones (con margen entre modalidades), dentro
-- del horario del centro. Misma firma y columnas.
CREATE OR REPLACE FUNCTION disponibilidad_publica(p_profesional_id uuid, desde timestamptz, hasta timestamptz)
RETURNS TABLE (modalidad modalidad_atencion, inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_margen int := margen_vigente(p_profesional_id);
BEGIN
  IF desde IS NULL OR hasta IS NULL OR hasta <= desde OR hasta - desde > interval '62 days' THEN
    RAISE EXCEPTION 'Rango invalido (maximo 62 dias)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'disponibilidad_publica_rango';
  END IF;
  IF NOT (tiene_rol(p_profesional_id, 'PROFESIONAL') OR tiene_rol(p_profesional_id, 'PRACTICANTE'))
     OR NOT (acceso_vigente() OR EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH dias AS (
    SELECT g.dia::date AS dia
    FROM generate_series((desde AT TIME ZONE 'America/Santiago')::date::timestamp,
                         (hasta AT TIME ZONE 'America/Santiago')::date::timestamp, interval '1 day') AS g(dia)
  ), ventanas AS (
    SELECT mm.m, tstzrange(b.inicio, b.fin, '[)') AS r
    FROM bloques_atencion b CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE b.profesional_id = p_profesional_id AND b.fin > desde AND b.inicio < hasta
  ), centro AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM horario_centro)
                THEN (SELECT coalesce(range_agg(tstzrange(minuto_local(x.dia, h.inicio_min), minuto_local(x.dia, h.fin_min), '[)')),
                                      '{}'::tstzmultirange)
                      FROM dias x JOIN horario_centro h ON h.dia_semana = extract(isodow FROM x.dia))
                ELSE tstzmultirange(tstzrange(desde, hasta, '[)')) END AS r
  ), ocupado AS (
    SELECT mm.m,
           CASE WHEN c.modalidad = mm.m THEN tstzrange(c.inicio, c.fin, '[)')
                ELSE rango_con_margen(c.inicio, c.fin, c.margen_traslado_min + v_margen) END AS r
    FROM citas c CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE c.profesional_id = p_profesional_id AND c.estado IN ('CONFIRMADA', 'SOLICITADA')
    UNION ALL
    SELECT mm.m, tstzrange(b.inicio, b.fin, '[)')
    FROM bloqueos_agenda b CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE b.profesional_id = p_profesional_id
    UNION ALL
    SELECT mm.m,
           CASE WHEN t.modalidad = mm.m THEN tstzrange(t.inicio, t.fin, '[)')
                ELSE rango_con_margen(t.inicio, t.fin, 2 * v_margen) END
    FROM bloqueos_temporales t CROSS JOIN unnest(enum_range(NULL::modalidad_atencion)) AS mm(m)
    WHERE t.profesional_id = p_profesional_id AND t.expira_en > now()
  ), libres AS (
    SELECT v.m,
           unnest((range_agg(v.r) - coalesce((SELECT range_agg(o.r) FROM ocupado o WHERE o.m = v.m), '{}'::tstzmultirange))
                  * tstzmultirange(tstzrange(desde, hasta, '[)')) * (SELECT c.r FROM centro c)) AS r
    FROM ventanas v GROUP BY v.m
  )
  SELECT l.m, lower(l.r), upper(l.r) FROM libres l ORDER BY 2, 1;
END;
$$;

-- Ocupacion de boxes: bloques apartados + soft-locks presenciales (las
-- citas presenciales caen dentro de un bloque). Sin pacientes ni
-- profesionales. Misma firma y columnas.
CREATE OR REPLACE FUNCTION ocupacion_espacios(desde timestamptz, hasta timestamptz)
RETURNS TABLE (espacio_id uuid, inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'ocupacion_espacios: requiere acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT o.espacio_id, o.inicio, o.fin FROM (
    SELECT b.espacio_id, b.inicio, b.fin FROM bloques_atencion b
    WHERE tstzrange(b.inicio, b.fin, '[)') && tstzrange(desde, hasta, '[)')
    UNION ALL
    SELECT c.espacio_id, c.inicio, c.fin FROM citas c
    WHERE c.estado IN ('CONFIRMADA', 'SOLICITADA') AND c.espacio_id IS NOT NULL
      AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(desde, hasta, '[)')
      AND NOT EXISTS (SELECT 1 FROM bloques_atencion b WHERE b.espacio_id = c.espacio_id
                      AND b.inicio <= c.inicio AND b.fin >= c.fin)
    UNION ALL
    SELECT t.espacio_id, t.inicio, t.fin FROM bloqueos_temporales t
    WHERE t.expira_en > now() AND t.espacio_id IS NOT NULL
      AND tstzrange(t.inicio, t.fin, '[)') && tstzrange(desde, hasta, '[)')
      AND NOT EXISTS (SELECT 1 FROM bloques_atencion b WHERE b.espacio_id = t.espacio_id
                      AND b.inicio <= t.inicio AND b.fin >= t.fin)
  ) o
  ORDER BY o.espacio_id, o.inicio;
END;
$$;

-- Solicitud de hora sin cuenta: igual que 03a, pero el box presencial es el
-- del bloque del profesional (ya no "cualquier box libre").
CREATE OR REPLACE FUNCTION crear_solicitud_hora(
  p_id uuid, p_profesional_id uuid, p_modalidad modalidad_atencion, p_inicio timestamptz, p_fin timestamptz,
  p_nombre text, p_apellido text, p_fecha_nacimiento date, p_email text, p_telefono bytea,
  p_rut bytea, p_rut_hmac bytea, p_adulto_nombre text, p_adulto_parentesco text, p_adulto_telefono bytea,
  p_respuestas bytea, p_recomendado_id uuid, p_lista_espera boolean, p_politica_id uuid, p_terminos_id uuid,
  p_token_hash bytea)
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
                                respuestas, recomendado_id, lista_espera, politica_id, terminos_id, expira_en)
  VALUES (p_id, p_profesional_id, p_modalidad, v_espacio, p_inicio, p_fin, btrim(p_nombre), btrim(p_apellido),
          p_fecha_nacimiento, lower(btrim(p_email)), p_telefono, p_rut, p_rut_hmac, nullif(btrim(p_adulto_nombre), ''),
          p_adulto_parentesco, p_adulto_telefono, p_respuestas, p_recomendado_id, coalesce(p_lista_espera, false),
          p_politica_id, p_terminos_id, v_expira);
  INSERT INTO bloqueos_temporales (solicitud_id, profesional_id, espacio_id, modalidad, inicio, fin, expira_en)
  VALUES (p_id, p_profesional_id, v_espacio, p_modalidad, p_inicio, p_fin, v_expira);
  PERFORM emitir_token('VERIFICACION_SOLICITUD', p_token_hash, v_expira, NULL, NULL, NULL, p_id, NULL, lower(btrim(p_email)));
  RETURN v_expira;
END;
$$;

-- Ya no se usa: el box sale del bloque.
DROP FUNCTION espacio_libre(timestamptz, timestamptz);

-- -----------------------------------------------------------------------------
-- 4. Lista de espera publica (sin cuenta)
-- -----------------------------------------------------------------------------
-- AlterTable
ALTER TABLE "configuracion_centro" ADD COLUMN "dias_lista_espera_publica" SMALLINT NOT NULL DEFAULT 60;

ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_lista_espera_publica
  CHECK (dias_lista_espera_publica BETWEEN 7 AND 365);

-- CreateTable
CREATE TABLE "lista_espera_publica" (
    "id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" BYTEA,
    "politica_id" UUID NOT NULL,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificada_en" TIMESTAMPTZ(6),
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "aviso_pendiente_en" TIMESTAMPTZ(6),
    "avisada_en" TIMESTAMPTZ(6),

    CONSTRAINT "lista_espera_publica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lista_espera_publica_profesional_id_idx" ON "lista_espera_publica"("profesional_id");

-- AddForeignKey
ALTER TABLE "lista_espera_publica" ADD CONSTRAINT "lista_espera_publica_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera_publica" ADD CONSTRAINT "lista_espera_publica_politica_id_fkey" FOREIGN KEY ("politica_id") REFERENCES "politicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE lista_espera_publica ADD CONSTRAINT lista_espera_publica_coherente
  CHECK (btrim(nombre) <> '' AND length(nombre) <= 120 AND btrim(email) <> '' AND length(email) <= 254
         AND expira_en > creada_en AND (aviso_pendiente_en IS NULL OR verificada_en IS NOT NULL));
ALTER TABLE lista_espera_publica ADD CONSTRAINT lista_espera_publica_cifrado CHECK (octet_length(telefono) >= 49);
-- Una inscripcion por correo y profesional.
CREATE UNIQUE INDEX lista_espera_publica_una_por_destino
  ON lista_espera_publica (lower(email), profesional_id);

ALTER TABLE lista_espera_publica ENABLE ROW LEVEL SECURITY;
ALTER TABLE lista_espera_publica FORCE ROW LEVEL SECURITY;
-- Lectura del equipo (backoffice): ADMIN/GESTION todo; el profesional las
-- suyas. Escritura: solo funciones.
CREATE POLICY lista_espera_publica_select ON lista_espera_publica FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND profesional_id = (SELECT app_usuario_id())));
CREATE POLICY lista_espera_publica_acceso_vigente ON lista_espera_publica AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
GRANT SELECT ON lista_espera_publica TO app_user;

-- Inscribir (sin contexto). Siempre la misma respuesta hacia afuera: si ya
-- hay una inscripcion de ese correo para el mismo profesional, no se toca (solo
-- se manda otro enlace de verificacion a ese correo); sobre el limite por
-- correo no se emite nada. Devuelve si emitio el token (la API manda el
-- correo solo entonces) y el vencimiento del enlace.
CREATE FUNCTION inscribir_lista_espera_publica(
  p_id uuid, p_profesional_id uuid, p_nombre text, p_email text, p_telefono bytea, p_politica_id uuid,
  p_token_hash bytea)
RETURNS TABLE (emitido boolean, expira timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_email text := lower(btrim(p_email));
  v_expira timestamptz := now() + interval '24 hours';
  v_id uuid;
BEGIN
  IF p_politica_id IS DISTINCT FROM (SELECT id FROM politica_vigente('POLITICA_DATOS')) THEN
    RAISE EXCEPTION 'Hay una version nueva de la politica: vuelva a aceptarla'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
  END IF;
  IF p_profesional_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico) THEN
    RAISE EXCEPTION 'Profesional no disponible para la lista de espera'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'lista_espera_publica_destino';
  END IF;

  SELECT l.id INTO v_id FROM lista_espera_publica l
  WHERE lower(l.email) = v_email AND l.profesional_id = p_profesional_id;
  IF v_id IS NULL THEN
    IF (SELECT count(*) FROM lista_espera_publica l WHERE lower(l.email) = v_email) >= 5 THEN
      RETURN QUERY SELECT false, v_expira;
      RETURN;
    END IF;
    INSERT INTO lista_espera_publica (id, profesional_id, nombre, email, telefono, politica_id, expira_en)
    VALUES (p_id, p_profesional_id, btrim(p_nombre), v_email, p_telefono, p_politica_id, v_expira);
    v_id := p_id;
  END IF;
  PERFORM emitir_token('VERIFICACION_LISTA_ESPERA', p_token_hash, v_expira, NULL, NULL, NULL, v_id, NULL, v_email);
  RETURN QUERY SELECT true, v_expira;
END;
$$;

-- Verificar (sin contexto): el enlace del correo activa (o renueva) la
-- inscripcion por dias_lista_espera_publica y deja el token de baja.
CREATE FUNCTION verificar_lista_espera_publica(p_token_hash bytea, p_baja_hash bytea)
RETURNS TABLE (id uuid, email text, profesional_id uuid, expira_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_token_hash, 'VERIFICACION_LISTA_ESPERA');
  l lista_espera_publica%ROWTYPE;
BEGIN
  UPDATE lista_espera_publica x
  SET verificada_en = coalesce(x.verificada_en, now()),
      expira_en = now() + make_interval(days => (SELECT dias_lista_espera_publica FROM configuracion_centro))
  WHERE x.id = t.referencia_id
  RETURNING * INTO l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inscripcion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM emitir_token('BAJA_LISTA_ESPERA', p_baja_hash, l.expira_en, NULL, NULL, NULL, l.id, NULL, l.email);
  RETURN QUERY SELECT l.id, l.email, l.profesional_id, l.expira_en;
END;
$$;

-- Baja (sin contexto): el enlace de baja borra la inscripcion (minimizacion).
CREATE FUNCTION baja_lista_espera_publica(p_token_hash bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_token_hash, 'BAJA_LISTA_ESPERA');
BEGIN
  DELETE FROM lista_espera_publica WHERE id = t.referencia_id;
  UPDATE tokens_correo SET expira_en = greatest(creado_en + interval '1 second', least(expira_en, now()))
  WHERE referencia_id = t.referencia_id AND usado_en IS NULL AND tipo IN ('VERIFICACION_LISTA_ESPERA', 'BAJA_LISTA_ESPERA');
END;
$$;

-- Hora nueva o liberada de un profesional: avisa a la lista de espera con
-- cuenta (bandeja + correo, como 03a) y marca las inscripciones publicas
-- (el job manda el correo; como maximo un aviso cada 12 horas por inscripcion).
CREATE FUNCTION avisar_lista_espera(p_profesional_id uuid, p_excluir_paciente uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l record;
BEGIN
  FOR l IN
    SELECT le.id, le.paciente_id FROM lista_espera le
    WHERE le.estado = 'ACTIVA' AND le.paciente_id IS DISTINCT FROM p_excluir_paciente
      AND (le.profesional_id = p_profesional_id
           OR (le.profesional_id IS NULL AND le.tipo_atencion_id IN (
                 SELECT pt.tipo_atencion_id FROM profesional_tipos_atencion pt
                 WHERE pt.profesional_id = p_profesional_id AND pt.estado = 'APROBADO')))
    FOR UPDATE OF le SKIP LOCKED
  LOOP
    PERFORM encolar_notificacion('HORA_LIBERADA', l.paciente_id, NULL, l.id, NULL);
    UPDATE lista_espera SET avisada_en = now() WHERE id = l.id;
  END LOOP;

  IF EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico) THEN
    UPDATE lista_espera_publica lp SET aviso_pendiente_en = now()
    WHERE lp.verificada_en IS NOT NULL AND lp.expira_en > now() AND lp.aviso_pendiente_en IS NULL
      AND (lp.avisada_en IS NULL OR lp.avisada_en < now() - interval '12 hours')
      AND lp.profesional_id = p_profesional_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION avisar_hora_liberada() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.inicio <= now() THEN
    RETURN NULL;
  END IF;
  PERFORM avisar_lista_espera(OLD.profesional_id, OLD.paciente_id);
  RETURN NULL;
END;
$$;

-- Bloques nuevos a futuro = horas nuevas: un aviso por sentencia y
-- profesional (apartar varias semanas de una vez avisa una sola vez).
CREATE FUNCTION avisar_bloques_nuevos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p uuid;
BEGIN
  FOR p IN SELECT DISTINCT n.profesional_id FROM nuevos n WHERE n.fin > now() LOOP
    PERFORM avisar_lista_espera(p, NULL);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER bloques_atencion_avisan AFTER INSERT ON bloques_atencion
  REFERENCING NEW TABLE AS nuevos FOR EACH STATEMENT EXECUTE FUNCTION avisar_bloques_nuevos();

-- Job (sin contexto): toma inscripciones con aviso pendiente (SKIP LOCKED),
-- las marca avisadas y devuelve lo necesario para el correo. El token de
-- baja de cada correo se emite con token_baja_lista_espera.
CREATE FUNCTION avisos_lista_espera_publica(p_limite int)
RETURNS TABLE (id uuid, email text, nombre text, profesional_id uuid, profesional_nombre text, expira_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH tomadas AS (
    SELECT lp.id FROM lista_espera_publica lp
    WHERE lp.aviso_pendiente_en IS NOT NULL AND lp.expira_en > now()
    ORDER BY lp.aviso_pendiente_en LIMIT p_limite FOR UPDATE SKIP LOCKED
  ), avisadas AS (
    UPDATE lista_espera_publica lp SET aviso_pendiente_en = NULL, avisada_en = now()
    FROM tomadas t WHERE lp.id = t.id
    RETURNING lp.*
  )
  SELECT a.id, a.email, a.nombre, a.profesional_id, u.nombre, a.expira_en
  FROM avisadas a
  JOIN usuarios u ON u.id = a.profesional_id;
END;
$$;

CREATE FUNCTION token_baja_lista_espera(p_id uuid, p_hash bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM emitir_token('BAJA_LISTA_ESPERA', p_hash, l.expira_en, NULL, NULL, NULL, l.id, NULL, l.email)
  FROM lista_espera_publica l WHERE l.id = p_id;
END;
$$;

-- Job (sin contexto): borra inscripciones vencidas (sin verificar a las 24 h
-- o pasada su vigencia). Idempotente.
CREATE FUNCTION limpiar_lista_espera_publica() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n int;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM lista_espera_publica WHERE expira_en <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Dashboard: uso de box = horas apartadas
-- -----------------------------------------------------------------------------
-- ocupacion_boxes_hoy pasa a "apartado": minutos de hoy en bloques de
-- atencion / minutos de horario de los boxes activos (periodo vigente). Es la
-- metrica de muestra del producto, no una regla: cada centro puede definir la
-- suya. Mismo nombre de campo; el resto de reporte_dashboard (03a) igual.
CREATE OR REPLACE FUNCTION reporte_dashboard() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol text := app_rol();
  v_yo uuid := app_usuario_id();
  v_hoy date := (now() AT TIME ZONE 'America/Santiago')::date;
  v_ini timestamptz := v_hoy::timestamp AT TIME ZONE 'America/Santiago';
  v_fin timestamptz := (v_hoy + 1)::timestamp AT TIME ZONE 'America/Santiago';
  v_semana timestamptz := (v_hoy - (extract(isodow FROM v_hoy)::int - 1))::timestamp AT TIME ZONE 'America/Santiago';
  v_mes timestamptz := date_trunc('month', v_hoy)::timestamp AT TIME ZONE 'America/Santiago';
  v_minutos_box numeric;
  v_minutos_ocupados numeric;
BEGIN
  IF NOT acceso_vigente() OR v_rol NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'reporte_dashboard: solo equipo con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_rol IN ('PROFESIONAL', 'PRACTICANTE') THEN
    RETURN jsonb_build_object(
      'rol', v_rol,
      'sesiones_hoy', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'CONFIRMADA'
                       AND inicio >= v_ini AND inicio < v_fin),
      'sesiones_semana', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'CONFIRMADA'
                          AND inicio >= v_semana AND inicio < v_semana + interval '7 days'),
      'pacientes_activos', (SELECT count(DISTINCT c.paciente_id) FROM citas c
                            WHERE c.profesional_id = v_yo AND c.estado = 'CONFIRMADA' AND c.fin >= now() - interval '90 days'
                              AND NOT EXISTS (SELECT 1 FROM altas_paciente a WHERE a.paciente_id = c.paciente_id
                                              AND a.fecha >= (c.inicio AT TIME ZONE 'America/Santiago')::date)),
      'fichas_sin_cerrar', (SELECT count(*) FROM citas c WHERE c.profesional_id = v_yo AND cita_realizada(c.id)
                            AND c.fin >= now() - interval '30 days'
                            AND NOT EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = c.id)),
      'borradores', (SELECT count(*) FROM borradores_evolucion WHERE autor_id = v_yo),
      'solicitudes_por_aprobar', (SELECT count(*) FROM citas WHERE profesional_id = v_yo AND estado = 'SOLICITADA'),
      'mensajes_sin_leer', (SELECT count(*) FROM mensajes_paciente WHERE profesional_id = v_yo AND leido_en IS NULL),
      'calificacion', (SELECT round(avg(calificacion), 1) FROM resenas WHERE profesional_id = v_yo AND estado = 'PUBLICADA'),
      'resenas', (SELECT count(*) FROM resenas WHERE profesional_id = v_yo AND estado = 'PUBLICADA'),
      'proxima_sesion', (SELECT jsonb_build_object('cita_id', id, 'inicio', inicio, 'espacio_id', espacio_id, 'modalidad', modalidad)
                         FROM citas WHERE profesional_id = v_yo AND estado = 'CONFIRMADA' AND inicio >= now()
                         ORDER BY inicio LIMIT 1));
  END IF;

  -- Horario de hoy de cada box activo: sus filas del periodo vigente; box sin
  -- filas propias = horario del centro; sin ninguno = 09:00-20:00 (muestra).
  SELECT coalesce(sum(extract(epoch FROM upper(r) - lower(r)) / 60), 0) INTO v_minutos_box
  FROM (SELECT tstzrange(minuto_local(v_hoy, h.inicio_min), minuto_local(v_hoy, h.fin_min), '[)') AS r
        FROM espacios e JOIN horarios_espacio h ON h.espacio_id = e.id
        WHERE e.activo AND h.dia_semana = extract(isodow FROM v_hoy)
          AND (h.vigente_desde IS NULL OR h.vigente_desde <= v_hoy) AND (h.vigente_hasta IS NULL OR v_hoy <= h.vigente_hasta)
        UNION ALL
        SELECT tstzrange(minuto_local(v_hoy, coalesce(hc.inicio_min, 540)), minuto_local(v_hoy, coalesce(hc.fin_min, 1200)), '[)')
        FROM espacios e
        LEFT JOIN horario_centro hc ON hc.dia_semana = extract(isodow FROM v_hoy)
        WHERE e.activo AND NOT EXISTS (SELECT 1 FROM horarios_espacio h WHERE h.espacio_id = e.id)
          AND (hc.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM horario_centro))) x;
  -- Apartado: minutos de hoy en bloques de atencion de boxes activos (el
  -- bloque ya cae dentro del horario del box y del centro).
  SELECT coalesce(sum(extract(epoch FROM least(b.fin, v_fin) - greatest(b.inicio, v_ini)) / 60), 0) INTO v_minutos_ocupados
  FROM bloques_atencion b JOIN espacios e ON e.id = b.espacio_id AND e.activo
  WHERE b.inicio < v_fin AND b.fin > v_ini;

  RETURN jsonb_build_object(
    'rol', v_rol,
    'pacientes_activos', (SELECT count(DISTINCT c.paciente_id) FROM citas c
                          WHERE c.estado = 'CONFIRMADA' AND c.fin >= now() - interval '90 days'
                            AND NOT EXISTS (SELECT 1 FROM altas_paciente a WHERE a.paciente_id = c.paciente_id
                                            AND a.fecha >= (c.inicio AT TIME ZONE 'America/Santiago')::date)),
    'pacientes_nuevos_mes', (SELECT count(*) FROM pacientes WHERE created_at >= v_mes),
    'sesiones_hoy', (SELECT count(*) FROM citas WHERE estado = 'CONFIRMADA' AND inicio >= v_ini AND inicio < v_fin),
    'por_confirmar', (SELECT count(*) FROM citas c WHERE c.inicio >= now() AND c.inicio < now() + interval '48 hours'
                      AND (c.estado = 'SOLICITADA'
                           OR (c.estado = 'CONFIRMADA' AND EXISTS (SELECT 1 FROM recordatorios_cita r
                                                                   WHERE r.cita_id = c.id AND r.respuesta IS NULL)))),
    'ocupacion_boxes_hoy', CASE WHEN v_minutos_box > 0 THEN least(100, round(100 * v_minutos_ocupados / v_minutos_box)) ELSE 0 END,
    'boxes_activos', (SELECT count(*) FROM espacios WHERE activo),
    'fichas_por_cerrar', (SELECT count(*) FROM citas c WHERE cita_realizada(c.id) AND c.fin >= now() - interval '7 days'
                          AND NOT EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = c.id)),
    'pendientes', jsonb_build_object(
      'solicitudes_por_aprobar', (SELECT count(*) FROM citas WHERE estado = 'SOLICITADA'),
      'ruts_faltantes', (SELECT count(*) FROM pacientes WHERE creado_por_solicitud AND rut IS NULL),
      'posibles_duplicados', (SELECT count(*) FROM pacientes WHERE posible_duplicado),
      'consentimientos_pendientes', (SELECT count(*) FROM consentimientos WHERE estado = 'SOLICITADO'),
      'practicantes_por_vencer', (SELECT count(*) FROM usuarios WHERE rol = 'PRACTICANTE' AND activo
                                  AND fecha_expiracion_acceso < now() + interval '14 days'),
      'por_reprogramar', (SELECT count(*) FROM citas WHERE estado = 'POR_REPROGRAMAR' AND inicio >= now()),
      'lista_espera', (SELECT count(*) FROM lista_espera WHERE estado = 'ACTIVA'),
      'resenas_por_moderar', CASE WHEN v_rol = 'ADMIN' THEN (SELECT count(*) FROM resenas WHERE estado = 'PENDIENTE') END,
      'alertas_abiertas', CASE WHEN v_rol = 'ADMIN' THEN (SELECT count(*) FROM alertas_internas WHERE atendida_en IS NULL) END));
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Permisos de funciones (como 03a)
-- -----------------------------------------------------------------------------
-- Internas (triggers y validaciones): sin EXECUTE para app_user.
REVOKE EXECUTE ON FUNCTION
  validar_bloque_atencion(), proteger_bloque_atencion(), asignar_box_bloqueo_temporal(), avisar_bloques_nuevos(),
  avisar_lista_espera(uuid, uuid)
FROM PUBLIC;

-- Llamadas desde la API o usadas por triggers con SECURITY DEFINER (cada una valida su contexto).
REVOKE EXECUTE ON FUNCTION
  en_horario_espacio(uuid, timestamptz, timestamptz), en_horario_centro(timestamptz, timestamptz),
  bloques_fuera_de_horario(uuid), disponibilidad_espacios(timestamptz, timestamptz),
  inscribir_lista_espera_publica(uuid, uuid, text, text, bytea, uuid, bytea),
  verificar_lista_espera_publica(bytea, bytea), baja_lista_espera_publica(bytea),
  avisos_lista_espera_publica(int), token_baja_lista_espera(uuid, bytea), limpiar_lista_espera_publica()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  en_horario_espacio(uuid, timestamptz, timestamptz), en_horario_centro(timestamptz, timestamptz),
  bloques_fuera_de_horario(uuid), disponibilidad_espacios(timestamptz, timestamptz),
  inscribir_lista_espera_publica(uuid, uuid, text, text, bytea, uuid, bytea),
  verificar_lista_espera_publica(bytea, bytea), baja_lista_espera_publica(bytea),
  avisos_lista_espera_publica(int), token_baja_lista_espera(uuid, bytea), limpiar_lista_espera_publica()
TO app_user;
