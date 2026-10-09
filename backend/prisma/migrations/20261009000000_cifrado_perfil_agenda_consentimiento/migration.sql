-- =============================================================================
-- 01e: cifrado de aplicacion (envelope) con contingencia de llaves, cuentas
-- de un solo periodo (reingreso = cuenta nueva) y cierre de datos personales,
-- perfil profesional autogestionado, modelo de cobro y tarifas, agenda por
-- modalidad, practicantes asignados via derivacion con consentimiento, y
-- evoluciones estructuradas.
--
-- Corre como dueño (vinculos_owner). La BD nunca ve llaves en claro: las
-- columnas cifradas son bytea opacos que cifra/descifra la API
-- (backend/src/common/crypto/). Formato de un valor cifrado:
--   [1 formato][16 id DEK][4 version DEK][12 IV][N cifrado][16 tag GCM]
-- => largo minimo 49 bytes (texto vacio). Los CHECK de largo minimo
-- reemplazan a los de formato; el formato real lo valida la API (DTOs).
--
-- Las columnas que pasan a bytea no se pueden convertir aqui (la BD no tiene
-- llaves): la migracion exige que esten vacias. Ningun entorno tiene datos
-- reales todavia; en desarrollo, reset_dev.sh recrea todo.
--
-- Enums: estado_derivacion se recrea (el valor nuevo se usa en un indice
-- parcial en esta misma migracion); estado_candidato recibe ADD VALUE (solo lo
-- usan funciones plpgsql, que se analizan al ejecutar).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Guardia: columnas que cambian a bytea / tablas recreadas, sin datos.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM usuarios WHERE telefono IS NOT NULL)
     OR EXISTS (SELECT 1 FROM pacientes WHERE rut IS NOT NULL OR telefono IS NOT NULL)
     OR EXISTS (SELECT 1 FROM adultos_responsables WHERE telefono IS NOT NULL)
     OR EXISTS (SELECT 1 FROM evoluciones)
     OR EXISTS (SELECT 1 FROM supervision_comentarios)
     OR EXISTS (SELECT 1 FROM derivaciones)
     OR EXISTS (SELECT 1 FROM boletas)
     OR EXISTS (SELECT 1 FROM consentimientos) THEN
    RAISE EXCEPTION '01e convierte columnas a cifradas y la BD no tiene llaves: requiere esas tablas/columnas vacias (desarrollo: infra/scripts/reset_dev.sh)';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

DROP INDEX "derivaciones_una_abierta_por_ficha";
ALTER TYPE "estado_derivacion" RENAME TO "estado_derivacion_01d";
CREATE TYPE "estado_derivacion" AS ENUM ('PENDIENTE', 'ESPERANDO_CONSENTIMIENTO', 'ACEPTADA', 'SIN_ASIGNAR', 'CANCELADA', 'CERRADA');
ALTER TABLE "derivaciones" ALTER COLUMN "estado" DROP DEFAULT,
  ALTER COLUMN "estado" TYPE "estado_derivacion" USING "estado"::text::"estado_derivacion",
  ALTER COLUMN "estado" SET DEFAULT 'PENDIENTE';
DROP TYPE "estado_derivacion_01d";

-- El paciente rechazo (o no respondio) el consentimiento para ese practicante.
ALTER TYPE "estado_candidato" ADD VALUE 'RECHAZADO_POR_PACIENTE';

CREATE TYPE "categoria_llave" AS ENUM ('IDENTIFICACION', 'CLINICO', 'FINANCIERO', 'HMAC');
CREATE TYPE "tipo_evento_llaves" AS ENUM ('APROVISIONAMIENTO', 'ROTACION', 'VERIFICACION', 'FALLO_CANARIO', 'RESTAURACION', 'SIMULACRO', 'CAMBIO_CUSTODIO', 'COMPROMISO');
CREATE TYPE "modelo_cobro" AS ENUM ('CENTRO', 'DIRECTO', 'MIXTO');
CREATE TYPE "modalidad_atencion" AS ENUM ('PRESENCIAL', 'ONLINE');
CREATE TYPE "motivo_bloqueo_agenda" AS ENUM ('VACACIONES', 'LICENCIA', 'PERSONAL', 'BAJA');
CREATE TYPE "estado_consentimiento" AS ENUM ('SOLICITADO', 'ACEPTADO', 'RECHAZADO', 'VENCIDO', 'REVOCADO');
CREATE TYPE "tipo_trayectoria" AS ENUM ('TITULO', 'POSTITULO', 'DIPLOMADO', 'MAGISTER', 'DOCTORADO', 'OTRO');
CREATE TYPE "tipo_sesion" AS ENUM ('INDIVIDUAL', 'PAREJA', 'FAMILIAR', 'GRUPAL', 'EVALUACION');
CREATE TYPE "nivel_riesgo" AS ENUM ('NINGUNO', 'BAJO', 'MEDIO', 'ALTO');


-- -----------------------------------------------------------------------------
-- 2. DDL (identico al que genera Prisma para el schema).
-- Ids: las filas con columnas cifradas usan el id como parte del AAD, asi que
-- el id lo genera la API (sin DEFAULT). El resto conserva gen_random_uuid().
-- -----------------------------------------------------------------------------

DROP INDEX "pacientes_rut_key";
ALTER TABLE "derivaciones" DROP CONSTRAINT "derivaciones_motivo_no_vacio";
DROP TABLE "consentimientos";

ALTER TABLE "usuarios" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "password_hash" DROP NOT NULL,
ALTER COLUMN "nombre" DROP NOT NULL,
ALTER COLUMN "telefono" SET DATA TYPE BYTEA USING NULL,
ADD COLUMN "cerrada_en" TIMESTAMPTZ(6);

ALTER TABLE "pacientes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "rut" SET DATA TYPE BYTEA USING NULL,
ALTER COLUMN "telefono" SET DATA TYPE BYTEA USING NULL,
ADD COLUMN "rut_hmac" BYTEA;

ALTER TABLE "adultos_responsables" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "telefono" SET DATA TYPE BYTEA USING NULL,
ADD COLUMN "rut" BYTEA,
ADD COLUMN "rut_hmac" BYTEA;

ALTER TABLE "evoluciones" ALTER COLUMN "id" DROP DEFAULT,
DROP COLUMN "contenido",
ADD COLUMN "notas" BYTEA NOT NULL,
ADD COLUMN "autor_nombre" BYTEA NOT NULL,
ADD COLUMN "autor_rut" BYTEA NOT NULL,
ADD COLUMN "autor_registro" BYTEA NOT NULL,
ADD COLUMN "tipo_sesion" "tipo_sesion" NOT NULL,
ADD COLUMN "estado_avance_id" UUID,
ADD COLUMN "nivel_riesgo" "nivel_riesgo" NOT NULL;

ALTER TABLE "supervision_comentarios" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "texto" SET DATA TYPE BYTEA USING NULL;

ALTER TABLE "derivaciones" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "motivo" SET DATA TYPE BYTEA USING NULL,
ALTER COLUMN "detalle" SET DATA TYPE BYTEA USING NULL;

ALTER TABLE "derivacion_candidatos" ADD COLUMN "propuesto_por_id" UUID;

ALTER TABLE "boletas" ALTER COLUMN "id" DROP DEFAULT,
ADD COLUMN "emisor_nombre" BYTEA NOT NULL,
ADD COLUMN "emisor_rut" BYTEA NOT NULL;

ALTER TABLE "profesionales" DROP COLUMN "tarifa",
DROP COLUMN "enfoque_terapeutico",
ADD COLUMN "enfoques" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "cobro_directo" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "configuracion_centro" ADD COLUMN "modelo_cobro" "modelo_cobro" NOT NULL DEFAULT 'CENTRO',
ADD COLUMN "plazo_consentimiento_horas" INTEGER NOT NULL DEFAULT 48;

ALTER TABLE "citas" ALTER COLUMN "espacio_id" DROP NOT NULL,
ADD COLUMN "modalidad" "modalidad_atencion" NOT NULL DEFAULT 'PRESENCIAL';

-- Soft-locks de UX con TTL: se descartan (siempre efimeros) para agregar
-- profesional_id obligatorio.
DELETE FROM "bloqueos_temporales";
ALTER TABLE "bloqueos_temporales" ALTER COLUMN "espacio_id" DROP NOT NULL,
ADD COLUMN "profesional_id" UUID NOT NULL,
ADD COLUMN "modalidad" "modalidad_atencion" NOT NULL DEFAULT 'PRESENCIAL';

CREATE TABLE "llaves_datos" (
    "id" UUID NOT NULL,
    "categoria" "categoria_llave" NOT NULL,
    "version" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT false,
    "dek_por_kek" BYTEA NOT NULL,
    "dek_por_recuperacion" BYTEA NOT NULL,
    "huella_kek" TEXT NOT NULL,
    "canario" BYTEA NOT NULL,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retirada_en" TIMESTAMPTZ(6),

    CONSTRAINT "llaves_datos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "custodios_llave" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parte" SMALLINT NOT NULL,
    "custodio" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "desde" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasta" TIMESTAMPTZ(6),

    CONSTRAINT "custodios_llave_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "eventos_llaves" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "tipo_evento_llaves" NOT NULL,
    "detalle" TEXT,
    "actor" TEXT NOT NULL,
    "ocurrido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_llaves_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profesional_trayectoria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID NOT NULL,
    "tipo" "tipo_trayectoria" NOT NULL,
    "titulo" TEXT NOT NULL,
    "institucion" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "registro_superintendencia" TEXT,
    "documento_respaldo_url" TEXT,
    "verificado" BOOLEAN NOT NULL DEFAULT false,
    "verificado_por_id" UUID,
    "verificado_en" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profesional_trayectoria_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profesional_datos_privados" (
    "usuario_id" UUID NOT NULL,
    "rut" BYTEA,
    "rut_hmac" BYTEA,
    "banco" BYTEA,
    "tipo_cuenta" BYTEA,
    "numero_cuenta" BYTEA,
    "titular" BYTEA,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profesional_datos_privados_pkey" PRIMARY KEY ("usuario_id")
);

CREATE TABLE "tarifas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID NOT NULL,
    "tipo_atencion_id" UUID,
    "modalidad" "modalidad_atencion",
    "monto" INTEGER NOT NULL,
    "vigente_desde" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tarifas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "disponibilidad_profesional" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    "hora_inicio" TIME(6) NOT NULL,
    "hora_fin" TIME(6) NOT NULL,
    "modalidad" "modalidad_atencion" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disponibilidad_profesional_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bloqueos_agenda" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6),
    "motivo" "motivo_bloqueo_agenda" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueos_agenda_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "intervenciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intervenciones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "estados_avance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estados_avance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "evolucion_intervenciones" (
    "evolucion_id" UUID NOT NULL,
    "intervencion_id" UUID NOT NULL,

    CONSTRAINT "evolucion_intervenciones_pkey" PRIMARY KEY ("evolucion_id","intervencion_id")
);

-- Consentimiento para atencion con practicante supervisado: nombra al
-- practicante y al supervisor; si cambia cualquiera, deja de estar vigente.
CREATE TABLE "consentimientos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "tipo" "tipo_consentimiento" NOT NULL,
    "practicante_id" UUID NOT NULL,
    "supervisor_id" UUID NOT NULL,
    "derivacion_id" UUID,
    "estado" "estado_consentimiento" NOT NULL DEFAULT 'SOLICITADO',
    "solicitado_por_id" UUID NOT NULL,
    "solicitado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMPTZ(6) NOT NULL,
    "version_documento" TEXT,
    "otorgado_por_tipo" "otorgante_consentimiento",
    "adulto_responsable_id" UUID,
    "respondido_por_id" UUID,
    "respondido_en" TIMESTAMPTZ(6),
    "respaldo_documento_ref" TEXT,
    "revocado_en" TIMESTAMPTZ(6),
    "revocado_por_id" UUID,
    "revocado_por_tipo" "otorgante_consentimiento",
    "revocado_adulto_responsable_id" UUID,
    "respaldo_revocacion_ref" TEXT,

    CONSTRAINT "consentimientos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pacientes_rut_hmac_key" ON "pacientes"("rut_hmac");
CREATE INDEX "adultos_responsables_rut_hmac_idx" ON "adultos_responsables"("rut_hmac");
CREATE UNIQUE INDEX "llaves_datos_categoria_version_key" ON "llaves_datos"("categoria", "version");
CREATE INDEX "profesional_trayectoria_profesional_id_idx" ON "profesional_trayectoria"("profesional_id");
CREATE UNIQUE INDEX "profesional_datos_privados_rut_hmac_key" ON "profesional_datos_privados"("rut_hmac");
CREATE INDEX "tarifas_profesional_id_vigente_desde_idx" ON "tarifas"("profesional_id", "vigente_desde");
CREATE INDEX "disponibilidad_profesional_profesional_id_idx" ON "disponibilidad_profesional"("profesional_id");
CREATE INDEX "bloqueos_agenda_profesional_id_inicio_idx" ON "bloqueos_agenda"("profesional_id", "inicio");
CREATE UNIQUE INDEX "intervenciones_nombre_key" ON "intervenciones"("nombre");
CREATE UNIQUE INDEX "estados_avance_nombre_key" ON "estados_avance"("nombre");
CREATE INDEX "evolucion_intervenciones_intervencion_id_idx" ON "evolucion_intervenciones"("intervencion_id");
CREATE INDEX "consentimientos_paciente_id_idx" ON "consentimientos"("paciente_id");
CREATE INDEX "consentimientos_practicante_id_idx" ON "consentimientos"("practicante_id");

ALTER TABLE "evoluciones" ADD CONSTRAINT "evoluciones_estado_avance_id_fkey" FOREIGN KEY ("estado_avance_id") REFERENCES "estados_avance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "derivacion_candidatos" ADD CONSTRAINT "derivacion_candidatos_propuesto_por_id_fkey" FOREIGN KEY ("propuesto_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bloqueos_temporales" ADD CONSTRAINT "bloqueos_temporales_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profesional_trayectoria" ADD CONSTRAINT "profesional_trayectoria_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profesional_trayectoria" ADD CONSTRAINT "profesional_trayectoria_verificado_por_id_fkey" FOREIGN KEY ("verificado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profesional_datos_privados" ADD CONSTRAINT "profesional_datos_privados_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_tipo_atencion_id_fkey" FOREIGN KEY ("tipo_atencion_id") REFERENCES "tipos_atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disponibilidad_profesional" ADD CONSTRAINT "disponibilidad_profesional_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bloqueos_agenda" ADD CONSTRAINT "bloqueos_agenda_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evolucion_intervenciones" ADD CONSTRAINT "evolucion_intervenciones_evolucion_id_fkey" FOREIGN KEY ("evolucion_id") REFERENCES "evoluciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evolucion_intervenciones" ADD CONSTRAINT "evolucion_intervenciones_intervencion_id_fkey" FOREIGN KEY ("intervencion_id") REFERENCES "intervenciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_practicante_id_fkey" FOREIGN KEY ("practicante_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_derivacion_id_fkey" FOREIGN KEY ("derivacion_id") REFERENCES "derivaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_solicitado_por_id_fkey" FOREIGN KEY ("solicitado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_adulto_responsable_id_fkey" FOREIGN KEY ("adulto_responsable_id") REFERENCES "adultos_responsables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_respondido_por_id_fkey" FOREIGN KEY ("respondido_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_revocado_por_id_fkey" FOREIGN KEY ("revocado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consentimientos" ADD CONSTRAINT "consentimientos_revocado_adulto_responsable_id_fkey" FOREIGN KEY ("revocado_adulto_responsable_id") REFERENCES "adultos_responsables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- -----------------------------------------------------------------------------
-- 3. Reglas que Prisma no expresa.
-- -----------------------------------------------------------------------------

-- Columnas cifradas: largo minimo del formato (49 bytes). HMAC-SHA256: 32.
ALTER TABLE usuarios ADD CONSTRAINT usuarios_cifrado CHECK (octet_length(telefono) >= 49);
ALTER TABLE pacientes ADD CONSTRAINT pacientes_cifrado
  CHECK (octet_length(rut) >= 49 AND octet_length(telefono) >= 49 AND octet_length(rut_hmac) = 32
         AND (rut IS NULL) = (rut_hmac IS NULL));
ALTER TABLE adultos_responsables ADD CONSTRAINT adultos_responsables_cifrado
  CHECK (octet_length(rut) >= 49 AND octet_length(telefono) >= 49 AND octet_length(rut_hmac) = 32
         AND (rut IS NULL) = (rut_hmac IS NULL));
ALTER TABLE evoluciones ADD CONSTRAINT evoluciones_cifrado
  CHECK (octet_length(notas) >= 49 AND octet_length(autor_nombre) >= 49
         AND octet_length(autor_rut) >= 49 AND octet_length(autor_registro) >= 49);
ALTER TABLE supervision_comentarios ADD CONSTRAINT supervision_comentarios_cifrado CHECK (octet_length(texto) >= 49);
ALTER TABLE derivaciones ADD CONSTRAINT derivaciones_cifrado
  CHECK (octet_length(motivo) >= 49 AND octet_length(detalle) >= 49);
ALTER TABLE boletas ADD CONSTRAINT boletas_cifrado
  CHECK (octet_length(emisor_nombre) >= 49 AND octet_length(emisor_rut) >= 49);
ALTER TABLE profesional_datos_privados ADD CONSTRAINT profesional_datos_privados_cifrado
  CHECK (octet_length(rut) >= 49 AND octet_length(banco) >= 49 AND octet_length(tipo_cuenta) >= 49
         AND octet_length(numero_cuenta) >= 49 AND octet_length(titular) >= 49 AND octet_length(rut_hmac) = 32
         AND (rut IS NULL) = (rut_hmac IS NULL));

-- Cuenta = un periodo de trabajo. Cerrada: sin datos personales, inactiva.
ALTER TABLE usuarios ADD CONSTRAINT usuarios_cuenta_cerrada_vacia
  CHECK ((cerrada_en IS NULL AND email IS NOT NULL AND password_hash IS NOT NULL AND nombre IS NOT NULL)
         OR (cerrada_en IS NOT NULL AND NOT activo AND email IS NULL AND password_hash IS NULL
             AND nombre IS NULL AND telefono IS NULL));

ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_plazo_consentimiento_valido
  CHECK (plazo_consentimiento_horas > 0);

-- Llaves: una activa por categoria; activa y retirada se excluyen.
ALTER TABLE llaves_datos ADD CONSTRAINT llaves_datos_version_valida CHECK (version > 0 AND NOT (activa AND retirada_en IS NOT NULL));
CREATE UNIQUE INDEX llaves_datos_una_activa ON llaves_datos (categoria) WHERE activa;
ALTER TABLE custodios_llave ADD CONSTRAINT custodios_llave_parte_valida CHECK (parte BETWEEN 1 AND 3 AND (hasta IS NULL OR hasta > desde));
CREATE UNIQUE INDEX custodios_llave_un_custodio_por_parte ON custodios_llave (parte) WHERE hasta IS NULL;

-- Agenda por modalidad: box solo si es presencial.
ALTER TABLE citas ADD CONSTRAINT citas_espacio_segun_modalidad
  CHECK ((modalidad = 'PRESENCIAL') = (espacio_id IS NOT NULL));
ALTER TABLE bloqueos_temporales ADD CONSTRAINT bloqueos_temporales_espacio_segun_modalidad
  CHECK ((modalidad = 'PRESENCIAL') = (espacio_id IS NOT NULL));
-- Por profesional choca en ambas modalidades (sin cambios); por box, solo
-- presencial (una cita online no ocupa box).
ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_espacio;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_espacio
  EXCLUDE USING gist (espacio_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado = 'CONFIRMADA' AND modalidad = 'PRESENCIAL');

ALTER TABLE disponibilidad_profesional ADD CONSTRAINT disponibilidad_profesional_valida
  CHECK (dia_semana BETWEEN 1 AND 7 AND hora_fin > hora_inicio);
ALTER TABLE bloqueos_agenda ADD CONSTRAINT bloqueos_agenda_rango_valido CHECK (fin IS NULL OR fin > inicio);
ALTER TABLE tarifas ADD CONSTRAINT tarifas_monto_valido CHECK (monto >= 0);
ALTER TABLE profesional_trayectoria ADD CONSTRAINT profesional_trayectoria_valida
  CHECK (anio BETWEEN 1950 AND 2100 AND verificado = (verificado_por_id IS NOT NULL) AND verificado = (verificado_en IS NOT NULL));
ALTER TABLE intervenciones ADD CONSTRAINT intervenciones_nombre_no_vacio CHECK (btrim(nombre) <> '');
ALTER TABLE estados_avance ADD CONSTRAINT estados_avance_nombre_no_vacio CHECK (btrim(nombre) <> '');

ALTER TABLE consentimientos ADD CONSTRAINT consentimientos_coherente
  CHECK ((estado IN ('ACEPTADO', 'RECHAZADO', 'REVOCADO')) = (respondido_en IS NOT NULL AND otorgado_por_tipo IS NOT NULL)
         AND (estado NOT IN ('ACEPTADO', 'REVOCADO') OR version_documento IS NOT NULL)
         AND (otorgado_por_tipo IS DISTINCT FROM 'ADULTO_RESPONSABLE') = (adulto_responsable_id IS NULL)
         AND (estado = 'REVOCADO') = (revocado_en IS NOT NULL AND revocado_por_tipo IS NOT NULL)
         AND (revocado_por_tipo IS DISTINCT FROM 'ADULTO_RESPONSABLE') = (revocado_adulto_responsable_id IS NULL)
         AND vence_en > solicitado_en);
-- Una solicitud abierta por paciente y practicante.
CREATE UNIQUE INDEX consentimientos_una_solicitud_abierta
  ON consentimientos (paciente_id, practicante_id) WHERE estado = 'SOLICITADO';

CREATE UNIQUE INDEX derivaciones_una_abierta_por_ficha
  ON derivaciones (ficha_clinica_id) WHERE estado IN ('PENDIENTE', 'ESPERANDO_CONSENTIMIENTO', 'SIN_ASIGNAR');


-- -----------------------------------------------------------------------------
-- 4. Helpers.
-- -----------------------------------------------------------------------------

-- Una cuenta cerrada nunca tiene acceso (ademas es inactiva por CHECK).
CREATE OR REPLACE FUNCTION acceso_vigente() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = app_usuario_id()
      AND u.activo
      AND u.cerrada_en IS NULL
      AND u.rol::text = app_rol()
      AND (u.rol::text <> 'PRACTICANTE'
           OR (u.fecha_expiracion_acceso > now() AND supervisor_vigente(u.id) IS NOT NULL))
  )
$$;

-- Consentimiento ACEPTADO que nombra a este practicante y a su supervisor
-- vigente de hoy.
CREATE FUNCTION consentimiento_vigente_para(p_paciente_id uuid, p_practicante_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM consentimientos
    WHERE paciente_id = p_paciente_id AND practicante_id = p_practicante_id
      AND tipo = 'ATENCION_CON_PRACTICANTE_SUPERVISADO' AND estado = 'ACEPTADO'
      AND supervisor_id = supervisor_vigente(p_practicante_id)
  )
$$;

-- Del tratante actual del paciente (lo usan las politicas RESTRICTIVE de 01d
-- y el trigger diferido).
CREATE OR REPLACE FUNCTION consentimiento_practicante_vigente(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT consentimiento_vigente_para(p.id, p.profesional_id) FROM pacientes p WHERE p.id = p_paciente_id), false)
$$;

CREATE OR REPLACE FUNCTION motivo_reasignacion(p_paciente_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = t.id) THEN 'BAJA'
    WHEN t.rol::text = 'PRACTICANTE' AND (NOT t.activo OR t.fecha_expiracion_acceso <= now()) THEN
      coalesce((SELECT CASE WHEN h.accion::text = 'REVOCADO' THEN 'ACCESO_REVOCADO' ELSE 'ACCESO_EXPIRADO' END
                FROM historial_accesos_practicante h WHERE h.practicante_id = t.id
                ORDER BY h.created_at DESC LIMIT 1), 'ACCESO_EXPIRADO')
    WHEN t.rol::text = 'PRACTICANTE' AND supervisor_vigente(t.id) IS NULL THEN 'SIN_SUPERVISION'
    WHEN t.rol::text = 'PRACTICANTE' AND NOT consentimiento_vigente_para(p.id, t.id) THEN 'CONSENTIMIENTO'
    WHEN NOT t.activo THEN 'TRATANTE_INACTIVO'
  END
  FROM pacientes p JOIN usuarios t ON t.id = p.profesional_id
  WHERE p.id = p_paciente_id AND p.deleted_at IS NULL
$$;

-- Cobro directo efectivo: modelo DIRECTO, o MIXTO con el profesional adherido.
CREATE FUNCTION cobro_directo(p_profesional_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE (SELECT modelo_cobro FROM configuracion_centro)
    WHEN 'DIRECTO' THEN true
    WHEN 'MIXTO' THEN coalesce((SELECT cobro_directo FROM profesionales WHERE usuario_id = p_profesional_id), false)
    ELSE false
  END
$$;


-- -----------------------------------------------------------------------------
-- 5. Triggers.
-- -----------------------------------------------------------------------------

-- Nadie se reactiva: quien vuelve recibe cuenta nueva. Una cuenta cerrada no
-- cambia mas. Aplica a todos (incluido el dueño).
CREATE FUNCTION bloquear_reactivacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cerrada_en IS NOT NULL THEN
    RAISE EXCEPTION 'Cuenta cerrada: no se modifica (quien vuelve recibe cuenta nueva)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT OLD.activo AND NEW.activo THEN
    RAISE EXCEPTION 'Una cuenta desactivada no se reactiva: crear cuenta nueva'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_sin_reactivacion';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER usuarios_sin_reactivacion BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION bloquear_reactivacion();

-- Pacientes: llegan a un practicante solo via derivacion con consentimiento.
-- Ningun INSERT de la API los asigna directo (el dueño queda exento: datos de
-- prueba). Reemplaza la asignacion inicial de 01d.
CREATE OR REPLACE FUNCTION validar_asignacion_practicante() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_user' AND rol_usuario(NEW.profesional_id) = 'PRACTICANTE' THEN
    RAISE EXCEPTION 'Un paciente llega a un practicante solo via derivacion con consentimiento'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- profesionales: publicar es consentimiento del propio y exige tarifa general
-- vigente (tipo y modalidad nulos).
CREATE OR REPLACE FUNCTION proteger_perfil_profesional() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.perfil_publico AND (TG_OP = 'INSERT' OR NOT OLD.perfil_publico) THEN
    IF session_user = 'app_user' AND NEW.usuario_id IS DISTINCT FROM app_usuario_id() THEN
      RAISE EXCEPTION 'Solo el propio profesional consiente publicar su perfil'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tarifas WHERE profesional_id = NEW.usuario_id
                   AND tipo_atencion_id IS NULL AND modalidad IS NULL AND vigente_desde <= now()) THEN
      RAISE EXCEPTION 'Publicar el perfil exige una tarifa general vigente'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'profesionales_publicar_requiere_tarifa';
    END IF;
    NEW.perfil_publico_consentido_en := now();
  END IF;
  RETURN NEW;
END;
$$;

-- profesional_trayectoria: el propio carga y edita (cualquier cambio quita la
-- verificacion); solo ADMIN verifica, y solo toca los campos de verificacion.
CREATE FUNCTION proteger_trayectoria() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF app_rol() = 'ADMIN' THEN
    IF TG_OP = 'INSERT'
       OR (NEW.profesional_id, NEW.tipo, NEW.titulo, NEW.institucion, NEW.anio, NEW.registro_superintendencia, NEW.documento_respaldo_url)
          IS DISTINCT FROM
          (OLD.profesional_id, OLD.tipo, OLD.titulo, OLD.institucion, OLD.anio, OLD.registro_superintendencia, OLD.documento_respaldo_url) THEN
      RAISE EXCEPTION 'ADMIN solo verifica la trayectoria' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.verificado_por_id := CASE WHEN NEW.verificado THEN app_usuario_id() END;
    NEW.verificado_en := CASE WHEN NEW.verificado THEN now() END;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.verificado, NEW.verificado_por_id, NEW.verificado_en)
                          IS DISTINCT FROM (OLD.verificado, OLD.verificado_por_id, OLD.verificado_en) THEN
    RAISE EXCEPTION 'Solo ADMIN verifica la trayectoria' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.verificado := false;
  NEW.verificado_por_id := NULL;
  NEW.verificado_en := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profesional_trayectoria_protegida BEFORE INSERT OR UPDATE ON profesional_trayectoria
  FOR EACH ROW EXECUTE FUNCTION proteger_trayectoria();

-- bloqueos_agenda: el motivo BAJA solo lo crea iniciar_baja_profesional y la
-- API no lo modifica ni lo borra.
CREATE FUNCTION proteger_bloqueo_baja() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'app_user'
     AND ((TG_OP <> 'INSERT' AND OLD.motivo = 'BAJA') OR (TG_OP <> 'DELETE' AND NEW.motivo = 'BAJA')) THEN
    RAISE EXCEPTION 'El bloqueo por BAJA lo maneja iniciar_baja_profesional' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER bloqueos_agenda_baja_protegida BEFORE INSERT OR UPDATE OR DELETE ON bloqueos_agenda
  FOR EACH ROW EXECUTE FUNCTION proteger_bloqueo_baja();

-- citas: una cita CONFIRMADA cae dentro de la disponibilidad de su modalidad
-- (dia y horas en hora de Chile, sin cruzar de dia) y fuera de bloqueos de
-- agenda. Regla de negocio: aplica a todos. 23514.
CREATE FUNCTION validar_agenda_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inicio timestamp := NEW.inicio AT TIME ZONE 'America/Santiago';
  v_fin timestamp := NEW.fin AT TIME ZONE 'America/Santiago';
BEGIN
  IF NEW.estado <> 'CONFIRMADA' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM disponibilidad_profesional d
    WHERE d.profesional_id = NEW.profesional_id AND d.modalidad = NEW.modalidad
      AND d.dia_semana = extract(isodow FROM v_inicio)
      AND v_inicio - v_inicio::date >= d.hora_inicio::interval
      AND v_fin - v_inicio::date <= d.hora_fin::interval
  ) THEN
    RAISE EXCEPTION 'La cita cae fuera de la disponibilidad del profesional para esa modalidad'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_disponibilidad';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bloqueos_agenda b
    WHERE b.profesional_id = NEW.profesional_id
      AND tstzrange(b.inicio, b.fin, '[)') && tstzrange(NEW.inicio, NEW.fin, '[)')
  ) THEN
    RAISE EXCEPTION 'El profesional tiene la agenda bloqueada en ese horario'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_fuera_de_bloqueos';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER citas_agenda_valida
  BEFORE INSERT OR UPDATE OF estado, inicio, fin, profesional_id, modalidad ON citas
  FOR EACH ROW EXECUTE FUNCTION validar_agenda_cita();

-- llaves_datos: nunca DELETE; UPDATE solo de activa/retirada_en (activacion
-- y retiro, una vez) y de las envolturas: dek_por_kek/huella_kek (KEK nueva)
-- y dek_por_recuperacion (par de recuperacion nuevo al cambiar custodios). La
-- DEK misma (id, version) y su canario no cambian. Incluso dueño.
CREATE FUNCTION proteger_llaves_datos() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (NEW.id, NEW.categoria, NEW.version, NEW.canario, NEW.creada_en)
        IS DISTINCT FROM (OLD.id, OLD.categoria, OLD.version, OLD.canario, OLD.creada_en)
     OR (OLD.retirada_en IS NOT NULL AND NEW.retirada_en IS DISTINCT FROM OLD.retirada_en) THEN
    RAISE EXCEPTION 'llaves_datos: solo se activa, se retira o se re-envuelve; nunca se borra'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER llaves_datos_protegidas BEFORE UPDATE OR DELETE ON llaves_datos
  FOR EACH ROW EXECUTE FUNCTION proteger_llaves_datos();
CREATE TRIGGER eventos_llaves_append_only BEFORE UPDATE OR DELETE ON eventos_llaves
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();
CREATE TRIGGER evolucion_intervenciones_append_only BEFORE UPDATE OR DELETE ON evolucion_intervenciones
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();
-- consentimientos: se escriben solo via funciones; nunca DELETE (incluso dueño).
CREATE TRIGGER consentimientos_sin_delete BEFORE DELETE ON consentimientos
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_auditoria();


-- -----------------------------------------------------------------------------
-- 6. Politicas.
-- -----------------------------------------------------------------------------

-- pacientes: vuelve la de 01c (sin rama de supervisor: no hay asignacion directa).
DROP POLICY pacientes_insert ON pacientes;
CREATE POLICY pacientes_insert ON pacientes FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
              OR (profesional_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) = 'PROFESIONAL'));

-- profesionales: autogestionado (el propio tambien crea su perfil).
DROP POLICY profesionales_insert ON profesionales;
CREATE POLICY profesionales_insert ON profesionales FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
              OR (usuario_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) = 'PROFESIONAL'));

-- supervision_comentarios: registro del paciente. Leen el tratante actual (la
-- subconsulta pasa por la RLS de evoluciones: incluye al practicante autor
-- mientras sea tratante) y el supervisor mientras la supervision siga vigente.
-- ADMIN nunca.
DROP POLICY supervision_comentarios_select ON supervision_comentarios;
CREATE POLICY supervision_comentarios_select ON supervision_comentarios FOR SELECT TO app_user
  USING (evolucion_id IN (SELECT id FROM evoluciones)
         OR (supervisor_id = (SELECT app_usuario_id()) AND evolucion_supervisable(evolucion_id)));

-- consentimientos (A): solo lectura directa; escritura via funciones.
CREATE POLICY consentimientos_select ON consentimientos FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR paciente_id = (SELECT app_paciente_id())
         OR practicante_id = (SELECT app_usuario_id())
         OR supervisor_id = (SELECT app_usuario_id())
         OR es_profesional_de_paciente(paciente_id));

-- profesional_trayectoria (A): el propio (todo) y ADMIN/GESTION (lectura);
-- ADMIN verifica (trigger). Publico: solo titulos verificados via perfiles_publicos().
CREATE POLICY profesional_trayectoria_select ON profesional_trayectoria FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()));
CREATE POLICY profesional_trayectoria_insert ON profesional_trayectoria FOR INSERT TO app_user
  WITH CHECK (profesional_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE'));
CREATE POLICY profesional_trayectoria_update ON profesional_trayectoria FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN' OR profesional_id = (SELECT app_usuario_id()))
  WITH CHECK ((SELECT app_rol()) = 'ADMIN' OR profesional_id = (SELECT app_usuario_id()));
CREATE POLICY profesional_trayectoria_delete ON profesional_trayectoria FOR DELETE TO app_user
  USING (profesional_id = (SELECT app_usuario_id()));

-- profesional_datos_privados (A, cifrado): edita el propio; leen el propio y
-- ADMIN/GESTION. El PACIENTE obtiene lo necesario via datos_pago_profesional().
CREATE POLICY profesional_datos_privados_select ON profesional_datos_privados FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR usuario_id = (SELECT app_usuario_id()));
CREATE POLICY profesional_datos_privados_insert ON profesional_datos_privados FOR INSERT TO app_user
  WITH CHECK (usuario_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE'));
CREATE POLICY profesional_datos_privados_update ON profesional_datos_privados FOR UPDATE TO app_user
  USING (usuario_id = (SELECT app_usuario_id())) WITH CHECK (usuario_id = (SELECT app_usuario_id()));

-- tarifas (A): las fija el propio (historial: una tarifa nueva reemplaza a la
-- anterior desde vigente_desde; sin UPDATE ni DELETE). Leen el propio y
-- ADMIN/GESTION; publico via perfiles_publicos().
CREATE POLICY tarifas_select ON tarifas FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()));
CREATE POLICY tarifas_insert ON tarifas FOR INSERT TO app_user
  WITH CHECK (profesional_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) = 'PROFESIONAL');

-- disponibilidad_profesional y bloqueos_agenda (A+C): el propio y
-- ADMIN/GESTION. Otros: solo huecos via disponibilidad_publica(), sin motivos.
CREATE POLICY disponibilidad_profesional_gestion ON disponibilidad_profesional FOR ALL TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()))
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()));
CREATE POLICY bloqueos_agenda_gestion ON bloqueos_agenda FOR ALL TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()))
  WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR profesional_id = (SELECT app_usuario_id()));

-- intervenciones / estados_avance (B): todos leen; ADMIN escribe; sin DELETE.
CREATE POLICY intervenciones_select ON intervenciones FOR SELECT TO app_user USING (true);
CREATE POLICY intervenciones_insert ON intervenciones FOR INSERT TO app_user WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY intervenciones_update ON intervenciones FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY estados_avance_select ON estados_avance FOR SELECT TO app_user USING (true);
CREATE POLICY estados_avance_insert ON estados_avance FOR INSERT TO app_user WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY estados_avance_update ON estados_avance FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');

-- evolucion_intervenciones (A): visible con la evolucion; se agregan solo en
-- la misma transaccion que crea la evolucion propia (created_at = now()), asi
-- la evolucion sigue siendo append-only.
CREATE POLICY evolucion_intervenciones_select ON evolucion_intervenciones FOR SELECT TO app_user
  USING (evolucion_id IN (SELECT id FROM evoluciones));
CREATE POLICY evolucion_intervenciones_insert ON evolucion_intervenciones FOR INSERT TO app_user
  WITH CHECK (evolucion_id IN (SELECT id FROM evoluciones WHERE autor_id = (SELECT app_usuario_id()) AND created_at = now()));

-- llaves_datos, custodios_llave, eventos_llaves (A): sin politicas ni GRANT
-- para app_user. Las llaves se leen con llaves_vigentes(); los eventos de la
-- API se escriben con registrar_evento_llaves(). Custodios: solo el operador
-- de la plataforma (vinculos_owner via scripts), nunca un rol del centro.


-- -----------------------------------------------------------------------------
-- 7. Funciones: llaves.
-- -----------------------------------------------------------------------------

-- La API la llama al arrancar (sin contexto): todas las versiones (para
-- descifrar datos viejos), envueltas con la KEK. Nunca dek_por_recuperacion.
CREATE FUNCTION llaves_vigentes()
RETURNS TABLE (id uuid, categoria categoria_llave, version int, activa boolean,
               dek_por_kek bytea, huella_kek text, canario bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, categoria, version, activa, dek_por_kek, huella_kek, canario
  FROM llaves_datos ORDER BY categoria, version
$$;

-- La API solo registra verificaciones y fallos de canario. El resto de los
-- eventos los escriben los scripts de infra/scripts/llaves (dueño).
CREATE FUNCTION registrar_evento_llaves(p_tipo tipo_evento_llaves, p_detalle text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_tipo NOT IN ('VERIFICACION', 'FALLO_CANARIO') THEN
    RAISE EXCEPTION 'La API solo registra VERIFICACION o FALLO_CANARIO' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO eventos_llaves (tipo, detalle, actor) VALUES (p_tipo, p_detalle, 'api');
END;
$$;


-- -----------------------------------------------------------------------------
-- 8. Funciones: perfil publico, cobro, agenda.
-- -----------------------------------------------------------------------------

-- directorio_interno: telefono ahora es bytea cifrado (la API descifra con
-- AAD usuarios:telefono:<id>). Mismo cuerpo que 01d.
DROP FUNCTION directorio_interno();
CREATE FUNCTION directorio_interno()
RETURNS TABLE (id uuid, nombre text, rol rol, tipos_atencion text[], email text, telefono bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_rol text := app_rol();
  v_contacto boolean := app_rol() IN ('ADMIN', 'GESTION');
BEGIN
  IF NOT acceso_vigente() OR v_rol NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE') THEN
    RAISE EXCEPTION 'directorio_interno: solo equipo con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT u.id, u.nombre, u.rol,
         ARRAY(SELECT t.nombre FROM profesional_tipos_atencion pt JOIN tipos_atencion t ON t.id = pt.tipo_atencion_id
               WHERE pt.profesional_id = u.id AND t.activo ORDER BY t.nombre),
         CASE WHEN v_contacto THEN u.email END,
         CASE WHEN v_contacto THEN u.telefono END
  FROM usuarios u
  WHERE u.activo AND u.rol::text <> 'PACIENTE'
    AND (v_rol <> 'PRACTICANTE' OR u.id = supervisor_vigente(app_usuario_id()))
  ORDER BY u.nombre;
END;
$$;

DROP FUNCTION perfiles_publicos();
-- Nunca RUT, datos bancarios ni contacto. Tarifas vigentes: la mas reciente
-- por (tipo de atencion, modalidad).
CREATE FUNCTION perfiles_publicos()
RETURNS TABLE (id uuid, nombre_publico text, bio text, foto_url text, especialidad text, enfoques text[],
               modalidad modalidad, tipos_atencion text[], verificado boolean, titulos_verificados text[],
               tarifas jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.usuario_id, p.nombre_publico, p.bio, p.foto_url, p.especialidad, p.enfoques, p.modalidad,
         ARRAY(SELECT t.nombre FROM profesional_tipos_atencion pt JOIN tipos_atencion t ON t.id = pt.tipo_atencion_id
               WHERE pt.profesional_id = p.usuario_id AND t.activo ORDER BY t.nombre),
         EXISTS (SELECT 1 FROM profesional_trayectoria tr WHERE tr.profesional_id = p.usuario_id AND tr.verificado),
         ARRAY(SELECT tr.titulo FROM profesional_trayectoria tr
               WHERE tr.profesional_id = p.usuario_id AND tr.verificado ORDER BY tr.anio, tr.titulo),
         (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo_atencion', ta.nombre, 'modalidad', v.modalidad, 'monto', v.monto)
                                    ORDER BY ta.nombre NULLS FIRST, v.modalidad NULLS FIRST), '[]'::jsonb)
          FROM (SELECT DISTINCT ON (tf.tipo_atencion_id, tf.modalidad) tf.tipo_atencion_id, tf.modalidad, tf.monto
                FROM tarifas tf
                WHERE tf.profesional_id = p.usuario_id AND tf.vigente_desde <= now()
                ORDER BY tf.tipo_atencion_id, tf.modalidad, tf.vigente_desde DESC, tf.created_at DESC) v
          LEFT JOIN tipos_atencion ta ON ta.id = v.tipo_atencion_id)
  FROM profesionales p JOIN usuarios u ON u.id = p.usuario_id
  WHERE p.perfil_publico AND u.activo AND u.rol::text = 'PROFESIONAL'
    AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
  ORDER BY p.nombre_publico
$$;

-- PACIENTE: datos de transferencia del profesional de SU cita, solo si el
-- cobro es directo y la cita esta CONFIRMADA sin pagos. 0 filas si no aplica.
-- Columnas cifradas: la API descifra (AAD profesional_datos_privados:<col>:<profesional_id>).
CREATE FUNCTION datos_pago_profesional(p_cita_id uuid)
RETURNS TABLE (profesional_id uuid, rut bytea, banco bytea, tipo_cuenta bytea, numero_cuenta bytea, titular bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_profesional uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PACIENTE' THEN
    RAISE EXCEPTION 'datos_pago_profesional: solo PACIENTE' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.profesional_id INTO v_profesional FROM citas c
  WHERE c.id = p_cita_id AND c.paciente_id = app_paciente_id() AND c.estado = 'CONFIRMADA'
    AND NOT EXISTS (SELECT 1 FROM pagos pg WHERE pg.cita_id = c.id);
  IF v_profesional IS NULL OR NOT cobro_directo(v_profesional) THEN
    RETURN;
  END IF;

  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), 'PACIENTE', app_paciente_id(), 'datos_pago_profesional', 'DATOS_PAGO');

  RETURN QUERY
  SELECT d.usuario_id, d.rut, d.banco, d.tipo_cuenta, d.numero_cuenta, d.titular
  FROM profesional_datos_privados d WHERE d.usuario_id = v_profesional;
END;
$$;

-- Huecos libres del profesional por modalidad en [desde, hasta) (max. 62
-- dias): disponibilidad semanal menos citas confirmadas, bloqueos de agenda y
-- soft-locks activos. Sin motivos ni pacientes. Sin contexto, solo para
-- perfiles publicos; con acceso vigente, cualquier profesional activo.
CREATE FUNCTION disponibilidad_publica(p_profesional_id uuid, desde timestamptz, hasta timestamptz)
RETURNS TABLE (modalidad modalidad_atencion, inicio timestamptz, fin timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF desde IS NULL OR hasta IS NULL OR hasta <= desde OR hasta - desde > interval '62 days' THEN
    RAISE EXCEPTION 'Rango invalido (maximo 62 dias)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'disponibilidad_publica_rango';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = p_profesional_id AND u.activo
                 AND u.rol::text IN ('PROFESIONAL', 'PRACTICANTE'))
     OR NOT (acceso_vigente() OR EXISTS (SELECT 1 FROM profesionales WHERE usuario_id = p_profesional_id AND perfil_publico)) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH ventanas AS (
    SELECT d.modalidad AS m,
           tstzrange((g.dia + d.hora_inicio) AT TIME ZONE 'America/Santiago',
                     (g.dia + d.hora_fin) AT TIME ZONE 'America/Santiago', '[)') AS r
    FROM generate_series((desde AT TIME ZONE 'America/Santiago')::date::timestamp,
                         (hasta AT TIME ZONE 'America/Santiago')::date::timestamp, interval '1 day') AS g(dia)
    JOIN disponibilidad_profesional d ON d.profesional_id = p_profesional_id AND d.dia_semana = extract(isodow FROM g.dia)
  ), ocupado AS (
    SELECT coalesce(range_agg(o.r), '{}'::tstzmultirange) AS m FROM (
      SELECT tstzrange(c.inicio, c.fin, '[)') AS r FROM citas c
      WHERE c.profesional_id = p_profesional_id AND c.estado = 'CONFIRMADA'
      UNION ALL
      SELECT tstzrange(b.inicio, b.fin, '[)') FROM bloqueos_agenda b WHERE b.profesional_id = p_profesional_id
      UNION ALL
      SELECT tstzrange(t.inicio, t.fin, '[)') FROM bloqueos_temporales t
      WHERE t.profesional_id = p_profesional_id AND t.expira_en > now()
    ) o
  ), libres AS (
    SELECT v.m, unnest((range_agg(v.r) - (SELECT m FROM ocupado)) * tstzmultirange(tstzrange(desde, hasta, '[)'))) AS r
    FROM ventanas v GROUP BY v.m
  )
  SELECT l.m, lower(l.r), upper(l.r) FROM libres l ORDER BY 2, 1;
END;
$$;

-- Ocupacion de boxes: solo citas y soft-locks presenciales.
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
    SELECT c.espacio_id, c.inicio, c.fin FROM citas c
    WHERE c.estado = 'CONFIRMADA' AND c.espacio_id IS NOT NULL
      AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(desde, hasta, '[)')
    UNION ALL
    SELECT b.espacio_id, b.inicio, b.fin FROM bloqueos_temporales b
    WHERE b.expira_en > now() AND b.espacio_id IS NOT NULL
      AND tstzrange(b.inicio, b.fin, '[)') && tstzrange(desde, hasta, '[)')
  ) o
  ORDER BY o.espacio_id, o.inicio;
END;
$$;


-- -----------------------------------------------------------------------------
-- 9. Bajas, cierre de cuenta y accesos de practicantes.
-- -----------------------------------------------------------------------------

-- Interno: cierra una cuenta desactivada de PROFESIONAL/PRACTICANTE. Del
-- profesional no se retiene nada como persona: se borran perfil, trayectoria,
-- datos privados, tarifas, disponibilidad y tipos de atencion; usuarios queda
-- con id, rol y fechas (email liberado). Lo que exige la ley sobrevive en los
-- documentos de retencion: copia de autoria cifrada en evoluciones y emisor en
-- boletas. Los registros de pacientes no se tocan.
CREATE FUNCTION cerrar_cuenta(p_usuario_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM profesional_tipos_atencion WHERE profesional_id = p_usuario_id;
  DELETE FROM tarifas WHERE profesional_id = p_usuario_id;
  DELETE FROM disponibilidad_profesional WHERE profesional_id = p_usuario_id;
  DELETE FROM profesional_trayectoria WHERE profesional_id = p_usuario_id;
  DELETE FROM profesional_datos_privados WHERE usuario_id = p_usuario_id;
  DELETE FROM profesionales WHERE usuario_id = p_usuario_id;
  UPDATE usuarios
  SET nombre = NULL, email = NULL, password_hash = NULL, telefono = NULL, cerrada_en = now(), updated_at = now()
  WHERE id = p_usuario_id AND NOT activo AND cerrada_en IS NULL;
END;
$$;

-- Ya no reactiva: solo ajusta la expiracion de un practicante activo. Quien
-- fue revocado o expiro vuelve con cuenta nueva.
CREATE OR REPLACE FUNCTION otorgar_acceso_practicante(p_practicante_id uuid, p_fecha_expiracion timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_activo boolean;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN otorga acceso a practicantes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT activo INTO v_activo FROM usuarios WHERE id = p_practicante_id AND rol::text = 'PRACTICANTE' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Practicante inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'Cuenta desactivada: quien vuelve recibe cuenta nueva'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_fecha_expiracion IS NULL OR p_fecha_expiracion <= now() THEN
    RAISE EXCEPTION 'La fecha de expiracion debe ser futura'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'historial_accesos_practicante_expiracion_futura';
  END IF;
  IF supervisor_vigente(p_practicante_id) IS NULL THEN
    RAISE EXCEPTION 'El practicante no tiene supervision vigente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'practicante_requiere_supervision';
  END IF;

  UPDATE usuarios SET fecha_expiracion_acceso = p_fecha_expiracion, updated_at = now() WHERE id = p_practicante_id;
  INSERT INTO historial_accesos_practicante (practicante_id, actor_id, accion, fecha_expiracion)
  VALUES (p_practicante_id, app_usuario_id(), 'OTORGADO', p_fecha_expiracion);
END;
$$;

-- Ademas de 01d: bloquea la agenda desde la fecha efectiva (al instante: no
-- se puede agendar despues de esa fecha).
CREATE OR REPLACE FUNCTION iniciar_baja_profesional(p_usuario_id uuid, p_fecha_efectiva timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol text;
  v_activo boolean;
  v_citas int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN inicia bajas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT rol::text, activo INTO v_rol, v_activo FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_rol NOT IN ('PROFESIONAL', 'PRACTICANTE') OR p_fecha_efectiva IS NULL THEN
    RAISE EXCEPTION 'Baja solo para PROFESIONAL o PRACTICANTE, con fecha efectiva'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bajas_validas';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'El usuario ya esta inactivo' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO bajas (usuario_id, fecha_efectiva, iniciada_por_id)
  VALUES (p_usuario_id, p_fecha_efectiva, app_usuario_id());
  INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo)
  VALUES (p_usuario_id, p_fecha_efectiva, NULL, 'BAJA');

  UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
  WHERE profesional_id = p_usuario_id AND estado = 'CONFIRMADA' AND inicio >= p_fecha_efectiva;
  GET DIAGNOSTICS v_citas = ROW_COUNT;
  RETURN v_citas;
END;
$$;

-- Ademas de 01d: cierra toda cuenta de PROFESIONAL/PRACTICANTE desactivada
-- (baja, expiracion o revocacion). Sigue siendo idempotente.
CREATE OR REPLACE FUNCTION procesar_bajas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_total int := 0;
BEGIN
  FOR r IN
    SELECT id, fecha_expiracion_acceso FROM usuarios
    WHERE rol::text = 'PRACTICANTE' AND activo AND fecha_expiracion_acceso <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM desactivar_tratante(r.id, now());
    INSERT INTO historial_accesos_practicante (practicante_id, accion, fecha_expiracion)
    VALUES (r.id, 'EXPIRADO', r.fecha_expiracion_acceso);
    v_total := v_total + 1;
  END LOOP;

  FOR r IN
    SELECT id, usuario_id, fecha_efectiva FROM bajas
    WHERE procesada_en IS NULL AND fecha_efectiva <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM desactivar_tratante(r.usuario_id, r.fecha_efectiva);
    UPDATE bajas SET procesada_en = now() WHERE id = r.id;
    v_total := v_total + 1;
  END LOOP;

  UPDATE citas c SET estado = 'POR_REPROGRAMAR', updated_at = now()
  FROM bajas b
  WHERE c.profesional_id = b.usuario_id AND c.estado = 'CONFIRMADA' AND c.inicio >= b.fecha_efectiva;

  FOR r IN
    SELECT id FROM usuarios
    WHERE rol::text IN ('PROFESIONAL', 'PRACTICANTE') AND NOT activo AND cerrada_en IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM cerrar_cuenta(r.id);
  END LOOP;

  RETURN v_total;
END;
$$;

DROP FUNCTION pacientes_por_reasignar();
-- ADMIN/GESTION: todos, con nombre. Supervisor vigente: solo pacientes de sus
-- practicantes, con informacion minima (codigo seudonimo, sin nombre).
-- ficha_id permite derivar de oficio.
CREATE FUNCTION pacientes_por_reasignar()
RETURNS TABLE (paciente_id uuid, ficha_id uuid, codigo text, nombre text, apellido text, tratante_id uuid,
               motivo text, derivacion_abierta boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_gestion boolean := app_rol() IN ('ADMIN', 'GESTION');
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
    RAISE EXCEPTION 'pacientes_por_reasignar: solo ADMIN, GESTION o supervisor' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT p.id, f.id, p.codigo_seudonimo,
         CASE WHEN v_gestion THEN p.nombre END, CASE WHEN v_gestion THEN p.apellido END,
         p.profesional_id, m.motivo,
         EXISTS (SELECT 1 FROM derivaciones d
                 WHERE d.ficha_clinica_id = f.id AND d.estado IN ('PENDIENTE', 'ESPERANDO_CONSENTIMIENTO', 'SIN_ASIGNAR'))
  FROM pacientes p
  LEFT JOIN fichas_clinicas f ON f.paciente_id = p.id
  CROSS JOIN LATERAL (SELECT motivo_reasignacion(p.id) AS motivo) m
  WHERE m.motivo IS NOT NULL AND (v_gestion OR es_supervisor_vigente_de(p.profesional_id))
  ORDER BY p.apellido, p.nombre;
END;
$$;


-- -----------------------------------------------------------------------------
-- 10. Derivaciones con practicantes y consentimiento.
-- -----------------------------------------------------------------------------

DROP FUNCTION crear_derivacion(uuid, text, uuid, text, uuid[]);
DROP FUNCTION oferta_derivacion(uuid);
DROP FUNCTION supervision_evoluciones(text);

-- PRACTICANTE como candidato: lo agrega ADMIN o su supervisor vigente, con
-- acceso y supervision vigentes. propuesto_por queda registrado (es quien
-- solicita el consentimiento si el practicante acepta).
CREATE OR REPLACE FUNCTION agregar_candidatos(p_derivacion_id uuid, p_candidatos uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_max int;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(p_candidatos) AS c(id)
    JOIN derivaciones d ON d.id = p_derivacion_id
    LEFT JOIN usuarios u ON u.id = c.id
    WHERE c.id IS NULL OR c.id = d.profesional_origen_id OR u.id IS NULL OR NOT u.activo
       OR EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
       OR NOT coalesce(u.rol::text = 'PROFESIONAL'
                       OR (u.rol::text = 'PRACTICANTE'
                           AND (app_rol() = 'ADMIN' OR es_supervisor_vigente_de(u.id))
                           AND u.fecha_expiracion_acceso > now() AND supervisor_vigente(u.id) IS NOT NULL), false)
  ) THEN
    RAISE EXCEPTION 'Candidatos invalidos: PROFESIONAL activos distintos del origen (PRACTICANTE solo via ADMIN o su supervisor)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'derivacion_candidatos_validos';
  END IF;

  SELECT coalesce(max(orden), 0) INTO v_max FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id;
  INSERT INTO derivacion_candidatos (derivacion_id, profesional_id, orden, propuesto_por_id)
  SELECT p_derivacion_id, c.id, v_max + c.n::int, app_usuario_id()
  FROM unnest(p_candidatos) WITH ORDINALITY AS c(id, n);
END;
$$;

-- p_id lo genera la API (AAD de motivo/detalle cifrados). De oficio: ADMIN o
-- el supervisor vigente del tratante practicante, si el paciente necesita
-- reasignacion.
CREATE FUNCTION crear_derivacion(p_id uuid, p_ficha_id uuid, p_motivo bytea, p_tipo_atencion_id uuid,
                                 p_detalle bytea, p_candidatos uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_paciente uuid;
  v_tratante uuid;
BEGIN
  SELECT p.id, p.profesional_id INTO v_paciente, v_tratante
  FROM fichas_clinicas f JOIN pacientes p ON p.id = f.paciente_id
  WHERE f.id = p_ficha_id;

  IF NOT acceso_vigente()
     OR NOT ((app_rol() = 'PROFESIONAL' AND v_tratante = app_usuario_id())
             OR ((app_rol() = 'ADMIN' OR es_supervisor_vigente_de(v_tratante))
                 AND motivo_reasignacion(v_paciente) IS NOT NULL)) THEN
    RAISE EXCEPTION 'Deriva el tratante, o de oficio ADMIN o el supervisor si el tratante se va o perdio el acceso'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tipos_atencion WHERE id = p_tipo_atencion_id AND activo) THEN
    RAISE EXCEPTION 'Tipo de atencion inexistente o inactivo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'derivaciones_tipo_atencion_activo';
  END IF;

  INSERT INTO derivaciones (id, ficha_clinica_id, profesional_origen_id, motivo, tipo_atencion_id, detalle, creada_por_id)
  VALUES (p_id, p_ficha_id, v_tratante, p_motivo, p_tipo_atencion_id, p_detalle, app_usuario_id());

  PERFORM agregar_candidatos(p_id, coalesce(p_candidatos, '{}'));
  PERFORM ofrecer_siguiente_candidato(p_id);
  PERFORM registrar_accion_derivacion(p_id, 'derivaciones');
  RETURN p_id;
END;
$$;

-- ADMIN o el supervisor vigente agregan al practicante al final de la lista.
CREATE FUNCTION proponer_practicante(p_derivacion_id uuid, p_practicante_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado estado_derivacion;
BEGIN
  IF NOT acceso_vigente() OR NOT (app_rol() = 'ADMIN' OR es_supervisor_vigente_de(p_practicante_id)) THEN
    RAISE EXCEPTION 'Propone ADMIN o el supervisor vigente del practicante' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT estado INTO v_estado FROM derivaciones WHERE id = p_derivacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Derivacion inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_estado NOT IN ('PENDIENTE', 'SIN_ASIGNAR') THEN
    RAISE EXCEPTION 'La derivacion no admite candidatos en estado %', v_estado
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF rol_usuario(p_practicante_id) IS DISTINCT FROM 'PRACTICANTE' THEN
    RAISE EXCEPTION 'Solo se proponen practicantes' USING ERRCODE = 'check_violation', CONSTRAINT = 'derivacion_candidatos_validos';
  END IF;

  PERFORM agregar_candidatos(p_derivacion_id, ARRAY[p_practicante_id]);
  IF NOT EXISTS (SELECT 1 FROM derivacion_candidatos WHERE derivacion_id = p_derivacion_id AND estado = 'OFRECIDA') THEN
    PERFORM ofrecer_siguiente_candidato(p_derivacion_id);
  END IF;
  PERFORM registrar_accion_derivacion(p_derivacion_id, 'derivacion_candidatos');
END;
$$;

-- Bandeja de ofertas para ADMIN y supervisores vigentes: derivaciones
-- PENDIENTE o SIN_ASIGNAR con la informacion de oferta. Auditada.
CREATE FUNCTION derivaciones_pendientes()
RETURNS TABLE (derivacion_id uuid, estado estado_derivacion, motivo bytea, detalle bytea, tipo_atencion text, edad_paciente int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente()
     OR NOT (app_rol() = 'ADMIN'
             OR (app_rol() = 'PROFESIONAL' AND EXISTS (
                   SELECT 1 FROM supervisiones s WHERE s.supervisor_id = app_usuario_id()
                   AND s.desde <= now() AND (s.hasta IS NULL OR s.hasta > now())))) THEN
    RAISE EXCEPTION 'derivaciones_pendientes: solo ADMIN o supervisor vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH pendientes AS (
    SELECT d.id, d.estado, d.motivo, d.detalle, t.nombre AS tipo, p.id AS paciente_id, f.id AS ficha_id,
           extract(year FROM age((now() AT TIME ZONE 'America/Santiago')::date, p.fecha_nacimiento))::int AS edad
    FROM derivaciones d
    JOIN tipos_atencion t ON t.id = d.tipo_atencion_id
    JOIN fichas_clinicas f ON f.id = d.ficha_clinica_id
    JOIN pacientes p ON p.id = f.paciente_id
    WHERE d.estado IN ('PENDIENTE', 'SIN_ASIGNAR')
  ), auditoria AS (
    INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, ficha_id, recurso, accion)
    SELECT app_usuario_id(), app_rol()::rol, x.paciente_id, x.ficha_id, 'derivaciones_pendientes', 'DERIVACION' FROM pendientes x
  )
  SELECT x.id, x.estado, x.motivo, x.detalle, x.tipo, x.edad FROM pendientes x ORDER BY x.id;
END;
$$;

-- motivo/detalle cifrados: los descifra la API (AAD derivaciones:<col>:<id>).
CREATE FUNCTION oferta_derivacion(p_derivacion_id uuid)
RETURNS TABLE (derivacion_id uuid, motivo bytea, tipo_atencion text, detalle bytea, edad_paciente int,
               vence_en timestamptz, citas_en_conflicto int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'oferta_derivacion: requiere acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT d.id, d.motivo, t.nombre, d.detalle,
         extract(year FROM age((now() AT TIME ZONE 'America/Santiago')::date, p.fecha_nacimiento))::int,
         c.vence_en,
         (SELECT count(*)::int FROM citas x
          WHERE x.paciente_id = p.id AND x.profesional_id = d.profesional_origen_id
            AND x.estado IN ('CONFIRMADA', 'POR_REPROGRAMAR') AND x.inicio > now()
            AND (EXISTS (SELECT 1 FROM citas y
                         WHERE y.profesional_id = c.profesional_id AND y.estado = 'CONFIRMADA'
                           AND tstzrange(y.inicio, y.fin, '[)') && tstzrange(x.inicio, x.fin, '[)'))
                 OR (x.estado = 'POR_REPROGRAMAR' AND EXISTS (
                         SELECT 1 FROM citas y
                         WHERE y.espacio_id = x.espacio_id AND y.estado = 'CONFIRMADA'
                           AND tstzrange(y.inicio, y.fin, '[)') && tstzrange(x.inicio, x.fin, '[)')))))
  FROM derivaciones d
  JOIN tipos_atencion t ON t.id = d.tipo_atencion_id
  JOIN derivacion_candidatos c ON c.derivacion_id = d.id
  JOIN fichas_clinicas f ON f.id = d.ficha_clinica_id
  JOIN pacientes p ON p.id = f.paciente_id
  WHERE d.id = p_derivacion_id AND d.estado = 'PENDIENTE'
    AND c.estado = 'OFRECIDA' AND c.profesional_id = app_usuario_id();

  IF FOUND THEN
    PERFORM registrar_accion_derivacion(p_derivacion_id, 'oferta_derivacion');
  END IF;
END;
$$;

-- Interno: traspaso efectivo (aceptacion de PROFESIONAL, o consentimiento
-- ACEPTADO para un PRACTICANTE).
CREATE FUNCTION concretar_traspaso(p_derivacion_id uuid, p_candidato_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_derivacion derivaciones%ROWTYPE;
  v_destino uuid;
  v_paciente uuid;
BEGIN
  SELECT * INTO v_derivacion FROM derivaciones WHERE id = p_derivacion_id;
  SELECT profesional_id INTO v_destino FROM derivacion_candidatos WHERE id = p_candidato_id;
  SELECT paciente_id INTO v_paciente FROM fichas_clinicas WHERE id = v_derivacion.ficha_clinica_id;

  UPDATE derivacion_candidatos SET estado = 'ACEPTADA', respondido_en = coalesce(respondido_en, now())
  WHERE id = p_candidato_id AND estado <> 'ACEPTADA';
  UPDATE derivacion_candidatos SET estado = 'OMITIDA'
  WHERE derivacion_id = p_derivacion_id AND estado = 'EN_ESPERA';
  UPDATE derivaciones SET estado = 'ACEPTADA', updated_at = now() WHERE id = p_derivacion_id;
  UPDATE pacientes SET profesional_id = v_destino, tipo_atencion_id = v_derivacion.tipo_atencion_id, updated_at = now()
  WHERE id = v_paciente;
  PERFORM reasignar_citas_derivacion(v_paciente, v_derivacion.profesional_origen_id, v_destino);
END;
$$;

-- Responde el candidato OFRECIDO. PROFESIONAL acepta -> traspaso. PRACTICANTE
-- acepta -> ESPERANDO_CONSENTIMIENTO + solicitud de consentimiento (salvo que
-- ya exista uno vigente para el y su supervisor: traspaso directo).
CREATE OR REPLACE FUNCTION responder_derivacion(p_derivacion_id uuid, p_acepta boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_candidato derivacion_candidatos%ROWTYPE;
  v_derivacion derivaciones%ROWTYPE;
  v_paciente uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PROFESIONAL', 'PRACTICANTE') OR p_acepta IS NULL THEN
    RAISE EXCEPTION 'Solo un PROFESIONAL o PRACTICANTE con acceso vigente responde derivaciones'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_derivacion FROM derivaciones WHERE id = p_derivacion_id AND estado = 'PENDIENTE' FOR UPDATE;
  SELECT * INTO v_candidato FROM derivacion_candidatos
  WHERE derivacion_id = p_derivacion_id AND estado = 'OFRECIDA' AND profesional_id = app_usuario_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una oferta de esta derivacion para el usuario'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_candidato.vence_en <= now() THEN
    RAISE EXCEPTION 'La oferta vencio' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF NOT p_acepta THEN
    UPDATE derivacion_candidatos SET estado = 'RECHAZADA', respondido_en = now() WHERE id = v_candidato.id;
    PERFORM ofrecer_siguiente_candidato(p_derivacion_id);
  ELSE
    SELECT paciente_id INTO v_paciente FROM fichas_clinicas WHERE id = v_derivacion.ficha_clinica_id;
    IF app_rol() = 'PRACTICANTE' AND NOT consentimiento_vigente_para(v_paciente, v_candidato.profesional_id) THEN
      UPDATE derivacion_candidatos SET estado = 'ACEPTADA', respondido_en = now() WHERE id = v_candidato.id;
      UPDATE derivaciones SET estado = 'ESPERANDO_CONSENTIMIENTO', updated_at = now() WHERE id = p_derivacion_id;
      INSERT INTO consentimientos (paciente_id, tipo, practicante_id, supervisor_id, derivacion_id,
                                   solicitado_por_id, vence_en)
      VALUES (v_paciente, 'ATENCION_CON_PRACTICANTE_SUPERVISADO', v_candidato.profesional_id,
              supervisor_vigente(v_candidato.profesional_id), p_derivacion_id,
              coalesce(v_candidato.propuesto_por_id, v_derivacion.creada_por_id),
              now() + make_interval(hours => (SELECT plazo_consentimiento_horas FROM configuracion_centro)));
    ELSE
      PERFORM concretar_traspaso(p_derivacion_id, v_candidato.id);
    END IF;
  END IF;
  PERFORM registrar_accion_derivacion(p_derivacion_id, 'derivaciones');
END;
$$;

-- Interno: el paciente rechazo o no respondio: el practicante queda
-- RECHAZADO_POR_PACIENTE y la oferta pasa al siguiente.
CREATE FUNCTION consentimiento_no_otorgado(p_consentimiento_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_c consentimientos%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM consentimientos WHERE id = p_consentimiento_id;
  IF v_c.derivacion_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM derivaciones WHERE id = v_c.derivacion_id AND estado = 'ESPERANDO_CONSENTIMIENTO') THEN
    UPDATE derivacion_candidatos SET estado = 'RECHAZADO_POR_PACIENTE'
    WHERE derivacion_id = v_c.derivacion_id AND profesional_id = v_c.practicante_id AND estado = 'ACEPTADA';
    PERFORM ofrecer_siguiente_candidato(v_c.derivacion_id);
  END IF;
END;
$$;

-- Interno: valida quien responde/revoca. PACIENTE: el propio (si es menor,
-- en nombre de un adulto responsable suyo). ADMIN/GESTION: con respaldo
-- documental. El supervisor solicita pero nunca registra.
CREATE FUNCTION validar_otorgante(p_paciente_id uuid, p_tipo otorgante_consentimiento,
                                  p_adulto_id uuid, p_respaldo text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente()
     OR NOT ((app_rol() = 'PACIENTE' AND app_paciente_id() = p_paciente_id) OR app_rol() IN ('ADMIN', 'GESTION')) THEN
    RAISE EXCEPTION 'Responde o revoca el paciente, o ADMIN/GESTION con respaldo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF app_rol() IN ('ADMIN', 'GESTION') AND coalesce(btrim(p_respaldo), '') = '' THEN
    RAISE EXCEPTION 'ADMIN/GESTION registran con respaldo documental'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_respaldo_obligatorio';
  END IF;
  IF p_tipo IS NULL
     OR (p_tipo = 'ADULTO_RESPONSABLE') <> (p_adulto_id IS NOT NULL)
     OR (p_adulto_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM adultos_responsables WHERE id = p_adulto_id AND paciente_id = p_paciente_id)) THEN
    RAISE EXCEPTION 'Otorgante invalido: ADULTO_RESPONSABLE exige un adulto responsable del mismo paciente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_adulto_del_paciente';
  END IF;
  IF p_tipo <> 'ADULTO_RESPONSABLE'
     AND (SELECT age((now() AT TIME ZONE 'America/Santiago')::date, fecha_nacimiento) FROM pacientes WHERE id = p_paciente_id)
         < interval '18 years' THEN
    RAISE EXCEPTION 'Paciente menor de 18: responde un adulto responsable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_menor_requiere_adulto_responsable';
  END IF;
END;
$$;

-- Respuesta a una solicitud. ACEPTADO concreta el traspaso de la derivacion
-- (mismas reglas de citas); RECHAZADO pasa la oferta al siguiente.
CREATE FUNCTION responder_consentimiento(p_consentimiento_id uuid, p_acepta boolean, p_version_documento text,
                                         p_otorgado_por_tipo otorgante_consentimiento, p_adulto_responsable_id uuid,
                                         p_respaldo_documento_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c consentimientos%ROWTYPE;
  v_candidato uuid;
BEGIN
  SELECT * INTO v_c FROM consentimientos WHERE id = p_consentimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consentimiento inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM validar_otorgante(v_c.paciente_id, p_otorgado_por_tipo, p_adulto_responsable_id, p_respaldo_documento_ref);
  IF v_c.estado <> 'SOLICITADO' OR v_c.vence_en <= now() THEN
    RAISE EXCEPTION 'La solicitud ya fue respondida o vencio' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_acepta IS NULL OR (p_acepta AND coalesce(btrim(p_version_documento), '') = '') THEN
    RAISE EXCEPTION 'Aceptar exige la version del documento'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_coherente';
  END IF;

  UPDATE consentimientos
  SET estado = CASE WHEN p_acepta THEN 'ACEPTADO'::estado_consentimiento ELSE 'RECHAZADO' END,
      version_documento = p_version_documento, otorgado_por_tipo = p_otorgado_por_tipo,
      adulto_responsable_id = p_adulto_responsable_id, respondido_por_id = app_usuario_id(),
      respondido_en = now(), respaldo_documento_ref = p_respaldo_documento_ref
  WHERE id = p_consentimiento_id;

  IF NOT p_acepta THEN
    PERFORM consentimiento_no_otorgado(p_consentimiento_id);
  ELSIF v_c.derivacion_id IS NOT NULL THEN
    SELECT c.id INTO v_candidato FROM derivacion_candidatos c JOIN derivaciones d ON d.id = c.derivacion_id
    WHERE c.derivacion_id = v_c.derivacion_id AND c.profesional_id = v_c.practicante_id
      AND c.estado = 'ACEPTADA' AND d.estado = 'ESPERANDO_CONSENTIMIENTO';
    IF v_candidato IS NOT NULL THEN
      PERFORM concretar_traspaso(v_c.derivacion_id, v_candidato);
    END IF;
  END IF;
  IF v_c.derivacion_id IS NOT NULL THEN
    PERFORM registrar_accion_derivacion(v_c.derivacion_id, 'consentimientos');
  END IF;
END;
$$;

-- Nueva solicitud para el practicante tratante actual (p. ej. cambio de
-- supervisor): ADMIN o el supervisor vigente. Sin derivacion asociada.
CREATE FUNCTION solicitar_consentimiento(p_paciente_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_practicante uuid;
  v_id uuid;
BEGIN
  SELECT profesional_id INTO v_practicante FROM pacientes WHERE id = p_paciente_id AND deleted_at IS NULL;
  IF NOT acceso_vigente() OR NOT (app_rol() = 'ADMIN' OR es_supervisor_vigente_de(v_practicante)) THEN
    RAISE EXCEPTION 'Solicita ADMIN o el supervisor vigente del practicante tratante' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF rol_usuario(v_practicante) IS DISTINCT FROM 'PRACTICANTE' OR supervisor_vigente(v_practicante) IS NULL THEN
    RAISE EXCEPTION 'El tratante no es un practicante con supervision vigente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'practicante_requiere_supervision';
  END IF;
  -- Ya hay una abierta -> consentimientos_una_solicitud_abierta (23505).
  INSERT INTO consentimientos (paciente_id, tipo, practicante_id, supervisor_id, solicitado_por_id, vence_en)
  VALUES (p_paciente_id, 'ATENCION_CON_PRACTICANTE_SUPERVISADO', v_practicante, supervisor_vigente(v_practicante),
          app_usuario_id(), now() + make_interval(hours => (SELECT plazo_consentimiento_horas FROM configuracion_centro)))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Revocacion: efecto inmediato (RLS), citas futuras con el practicante a
-- POR_REPROGRAMAR y el paciente entra a pacientes_por_reasignar().
CREATE FUNCTION revocar_consentimiento(p_consentimiento_id uuid, p_revocado_por_tipo otorgante_consentimiento,
                                       p_adulto_responsable_id uuid, p_respaldo_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c consentimientos%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM consentimientos WHERE id = p_consentimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consentimiento inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM validar_otorgante(v_c.paciente_id, p_revocado_por_tipo, p_adulto_responsable_id, p_respaldo_ref);
  IF v_c.estado <> 'ACEPTADO' THEN
    RAISE EXCEPTION 'Solo se revoca un consentimiento ACEPTADO' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE consentimientos
  SET estado = 'REVOCADO', revocado_en = now(), revocado_por_id = app_usuario_id(),
      revocado_por_tipo = p_revocado_por_tipo, revocado_adulto_responsable_id = p_adulto_responsable_id,
      respaldo_revocacion_ref = p_respaldo_ref
  WHERE id = p_consentimiento_id;
  UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
  WHERE paciente_id = v_c.paciente_id AND profesional_id = v_c.practicante_id
    AND estado = 'CONFIRMADA' AND inicio > now();
END;
$$;

-- Job: ademas de las ofertas vencidas, las solicitudes de consentimiento
-- vencidas (VENCIDO + siguiente candidato). Devuelve el total.
CREATE OR REPLACE FUNCTION expirar_ofertas_derivacion() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_total int := 0;
BEGIN
  FOR v_id IN
    SELECT d.id FROM derivaciones d
    WHERE d.estado = 'PENDIENTE'
      AND EXISTS (SELECT 1 FROM derivacion_candidatos c
                  WHERE c.derivacion_id = d.id AND c.estado = 'OFRECIDA' AND c.vence_en <= now())
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE derivacion_candidatos SET estado = 'EXPIRADA'
    WHERE derivacion_id = v_id AND estado = 'OFRECIDA' AND vence_en <= now();
    IF FOUND THEN
      PERFORM ofrecer_siguiente_candidato(v_id);
      v_total := v_total + 1;
    END IF;
  END LOOP;

  FOR v_id IN
    SELECT id FROM consentimientos WHERE estado = 'SOLICITADO' AND vence_en <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE consentimientos SET estado = 'VENCIDO' WHERE id = v_id;
    PERFORM consentimiento_no_otorgado(v_id);
    v_total := v_total + 1;
  END LOOP;
  RETURN v_total;
END;
$$;

-- Ademas de 01d: campos estructurados; notas cifradas (la API descifra con
-- AAD evoluciones:notas:<evolucion_id>).
CREATE FUNCTION supervision_evoluciones(p_codigo text)
RETURNS TABLE (evolucion_id uuid, autor_id uuid, tipo_sesion tipo_sesion, intervenciones text[], estado_avance text,
               nivel_riesgo nivel_riesgo, notas bytea, corrige_a_id uuid, creado_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_paciente uuid;
  v_ficha uuid;
  v_practicante uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PROFESIONAL' THEN
    RAISE EXCEPTION 'supervision_evoluciones: solo PROFESIONAL con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.id, f.id, p.profesional_id INTO v_paciente, v_ficha, v_practicante
  FROM pacientes p JOIN fichas_clinicas f ON f.paciente_id = p.id
  WHERE p.codigo_seudonimo = p_codigo AND p.deleted_at IS NULL
    AND es_supervisor_vigente_de(p.profesional_id) AND consentimiento_practicante_vigente(p.id);
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, ficha_id, recurso, accion)
  VALUES (app_usuario_id(), 'PROFESIONAL', v_paciente, v_ficha, 'supervision_evoluciones', 'SUPERVISION');

  RETURN QUERY
  SELECT e.id, e.autor_id, e.tipo_sesion,
         ARRAY(SELECT i.nombre FROM evolucion_intervenciones ei JOIN intervenciones i ON i.id = ei.intervencion_id
               WHERE ei.evolucion_id = e.id ORDER BY i.nombre),
         ea.nombre, e.nivel_riesgo, e.notas, e.corrige_a_id, e.created_at
  FROM evoluciones e
  LEFT JOIN estados_avance ea ON ea.id = e.estado_avance_id
  WHERE e.ficha_clinica_id = v_ficha AND e.autor_id = v_practicante
  ORDER BY e.created_at;
END;
$$;


-- -----------------------------------------------------------------------------
-- 11. GRANTs.
-- -----------------------------------------------------------------------------

-- Columnas recreadas: se rehace el GRANT por columna.
GRANT UPDATE (telefono) ON usuarios TO app_user;
REVOKE UPDATE ON pacientes FROM app_user;
GRANT UPDATE (nombre, apellido, rut, rut_hmac, fecha_nacimiento, email, telefono, profesional_id, tipo_atencion_id,
              updated_at, deleted_at)
  ON pacientes TO app_user;
GRANT UPDATE (modelo_cobro, plazo_consentimiento_horas) ON configuracion_centro TO app_user;

-- consentimientos: recreada, solo lectura directa.
GRANT SELECT ON consentimientos TO app_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON profesional_trayectoria, disponibilidad_profesional, bloqueos_agenda TO app_user;
GRANT SELECT, INSERT, UPDATE ON profesional_datos_privados, intervenciones, estados_avance TO app_user;
GRANT SELECT, INSERT ON tarifas, evolucion_intervenciones TO app_user;
-- llaves_datos, custodios_llave, eventos_llaves: ningun GRANT a app_user.

REVOKE EXECUTE ON FUNCTION
  directorio_interno(),
  consentimiento_vigente_para(uuid, uuid),
  cobro_directo(uuid),
  llaves_vigentes(),
  registrar_evento_llaves(tipo_evento_llaves, text),
  perfiles_publicos(),
  datos_pago_profesional(uuid),
  disponibilidad_publica(uuid, timestamptz, timestamptz),
  cerrar_cuenta(uuid),
  pacientes_por_reasignar(),
  crear_derivacion(uuid, uuid, bytea, uuid, bytea, uuid[]),
  proponer_practicante(uuid, uuid),
  derivaciones_pendientes(),
  oferta_derivacion(uuid),
  concretar_traspaso(uuid, uuid),
  consentimiento_no_otorgado(uuid),
  validar_otorgante(uuid, otorgante_consentimiento, uuid, text),
  responder_consentimiento(uuid, boolean, text, otorgante_consentimiento, uuid, text),
  solicitar_consentimiento(uuid),
  revocar_consentimiento(uuid, otorgante_consentimiento, uuid, text),
  supervision_evoluciones(text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  directorio_interno(),
  consentimiento_vigente_para(uuid, uuid),
  llaves_vigentes(),
  registrar_evento_llaves(tipo_evento_llaves, text),
  perfiles_publicos(),
  datos_pago_profesional(uuid),
  disponibilidad_publica(uuid, timestamptz, timestamptz),
  pacientes_por_reasignar(),
  crear_derivacion(uuid, uuid, bytea, uuid, bytea, uuid[]),
  proponer_practicante(uuid, uuid),
  derivaciones_pendientes(),
  oferta_derivacion(uuid),
  responder_consentimiento(uuid, boolean, text, otorgante_consentimiento, uuid, text),
  solicitar_consentimiento(uuid),
  revocar_consentimiento(uuid, otorgante_consentimiento, uuid, text),
  supervision_evoluciones(text)
TO app_user;


-- -----------------------------------------------------------------------------
-- 12. ENABLE + FORCE RLS; acceso vigente en las tablas que app_user usa.
-- -----------------------------------------------------------------------------

ALTER TABLE consentimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE llaves_datos ENABLE ROW LEVEL SECURITY;
ALTER TABLE custodios_llave ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_llaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE profesional_trayectoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE profesional_datos_privados ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarifas ENABLE ROW LEVEL SECURITY;
ALTER TABLE disponibilidad_profesional ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloqueos_agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervenciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE estados_avance ENABLE ROW LEVEL SECURITY;
ALTER TABLE evolucion_intervenciones ENABLE ROW LEVEL SECURITY;

ALTER TABLE consentimientos FORCE ROW LEVEL SECURITY;
ALTER TABLE llaves_datos FORCE ROW LEVEL SECURITY;
ALTER TABLE custodios_llave FORCE ROW LEVEL SECURITY;
ALTER TABLE eventos_llaves FORCE ROW LEVEL SECURITY;
ALTER TABLE profesional_trayectoria FORCE ROW LEVEL SECURITY;
ALTER TABLE profesional_datos_privados FORCE ROW LEVEL SECURITY;
ALTER TABLE tarifas FORCE ROW LEVEL SECURITY;
ALTER TABLE disponibilidad_profesional FORCE ROW LEVEL SECURITY;
ALTER TABLE bloqueos_agenda FORCE ROW LEVEL SECURITY;
ALTER TABLE intervenciones FORCE ROW LEVEL SECURITY;
ALTER TABLE estados_avance FORCE ROW LEVEL SECURITY;
ALTER TABLE evolucion_intervenciones FORCE ROW LEVEL SECURITY;

CREATE POLICY consentimientos_acceso_vigente ON consentimientos AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY profesional_trayectoria_acceso_vigente ON profesional_trayectoria AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY profesional_datos_privados_acceso_vigente ON profesional_datos_privados AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY tarifas_acceso_vigente ON tarifas AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY disponibilidad_profesional_acceso_vigente ON disponibilidad_profesional AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY bloqueos_agenda_acceso_vigente ON bloqueos_agenda AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY intervenciones_acceso_vigente ON intervenciones AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY estados_avance_acceso_vigente ON estados_avance AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
CREATE POLICY evolucion_intervenciones_acceso_vigente ON evolucion_intervenciones AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()));
