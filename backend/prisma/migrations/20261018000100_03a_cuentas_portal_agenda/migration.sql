-- =============================================================================
-- 03a-1: alinear el backend con el diseño (docs/front/brechas.md).
--   1. Varios roles por cuenta (C-1, C-2)         6. Perfil publico, imagenes, contenido, modulos, match (D-5, D-7, C-3)
--   2. Cuentas: tokens por correo, invitaciones,   7. Reseñas (D-1)
--      recuperacion, acceso sin contraseña, TOTP   8. Acceso clinico temporal, borradores, alta, cobros (C-4, C-5, C-8, C-11)
--   3. Politicas versionadas y consentimientos     9. Reportes por rol, avisos nuevos, bajas, GRANTs
--      por enlace (D-3)
--   4. Menores y adulto responsable (D-4)
--   5. Agenda: SOLICITADA, horarios, lista de espera, solicitud de hora sin cuenta (D-2, C-15)
-- Categorias (criterio_clasificacion.md): A = roles_adicionales, tokens_correo,
-- aceptaciones_politica, solicitudes_hora, resenas, resenas_reportes,
-- resenas_eventos, altas_paciente, lista_espera, accesos_clinicos_temporales,
-- borradores_evolucion. B = politicas, match_preguntas, match_opciones,
-- horario_centro, horarios_espacio. C = imagenes_publicas, contenido_publico,
-- match_resultados.
-- =============================================================================

-- CreateEnum
CREATE TYPE "modulo_centro" AS ENUM ('PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'COBROS');

-- CreateEnum
CREATE TYPE "tipo_token_correo" AS ENUM ('VERIFICACION_SOLICITUD', 'INVITACION', 'RECUPERACION', 'ACCESO', 'VERIFICACION_CORREO', 'CONSENTIMIENTO');

-- CreateEnum
CREATE TYPE "tipo_politica" AS ENUM ('POLITICA_DATOS', 'CONSENTIMIENTO_ATENCION', 'TERMINOS_AGENDAMIENTO');

-- CreateEnum
CREATE TYPE "canal_aceptacion" AS ENUM ('SOLICITUD', 'PORTAL', 'TOKEN', 'PRESENCIAL');

-- CreateEnum
CREATE TYPE "estado_solicitud_hora" AS ENUM ('PENDIENTE_VERIFICACION', 'CONCRETADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "tipo_pregunta_match" AS ENUM ('UNICA', 'MULTIPLE', 'ESCALA', 'TEXTO', 'DIAS', 'FRANJAS');

-- CreateEnum
CREATE TYPE "criterio_match" AS ENUM ('TIPO_ATENCION', 'ENFOQUE', 'ESPECIALIDAD', 'MODALIDAD', 'PREVISION');

-- CreateEnum
CREATE TYPE "estado_resena" AS ENUM ('PENDIENTE', 'PUBLICADA', 'OCULTA', 'RETIRADA');

-- CreateEnum
CREATE TYPE "mostrar_resena" AS ENUM ('ANONIMO', 'NOMBRE_INICIAL');

-- CreateEnum
CREATE TYPE "estado_lista_espera" AS ENUM ('ACTIVA', 'ASIGNADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "motivo_acceso_temporal" AS ENUM ('REEMPLAZO', 'INTERCONSULTA');

-- CreateEnum
CREATE TYPE "alcance_acceso_temporal" AS ENUM ('LECTURA', 'LECTURA_ESCRITURA');








-- AlterTable
ALTER TABLE "configuracion_centro" ADD COLUMN     "dias_retencion_respuestas_match" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "liquidar_exige_evolucion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "match_filtro_directo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "minutos_retencion_solicitud" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "modulos_activos" "modulo_centro"[] DEFAULT ARRAY['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH', 'COBROS']::"modulo_centro"[];

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "totp_activo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totp_secreto" BYTEA;

-- AlterTable
ALTER TABLE "mensajes_paciente" ADD COLUMN     "autor_id" UUID;

-- AlterTable
ALTER TABLE "pacientes" ADD COLUMN     "contacto_emergencia" BYTEA,
ADD COLUMN     "creado_por_solicitud" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "posible_duplicado" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "adultos_responsables" ADD COLUMN     "usuario_id" UUID;

-- AlterTable
ALTER TABLE "evoluciones" ADD COLUMN     "cita_id" UUID;

-- AlterTable
ALTER TABLE "espacios" ADD COLUMN     "duracion_defecto_min" SMALLINT,
ADD COLUMN     "nota" TEXT;

-- AlterTable
ALTER TABLE "bloqueos_temporales" ADD COLUMN     "solicitud_id" UUID,
ALTER COLUMN "usuario_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "profesionales" ADD COLUMN     "boleta_reembolsable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cita_destacada" TEXT,
ADD COLUMN     "convenios" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "idiomas" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "requiere_aprobacion_nuevos" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "roles_adicionales" (
    "usuario_id" UUID NOT NULL,
    "rol" "rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_baja" TIMESTAMPTZ(6),
    "otorgado_por_id" UUID NOT NULL,
    "otorgado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "desactivado_en" TIMESTAMPTZ(6),

    CONSTRAINT "roles_adicionales_pkey" PRIMARY KEY ("usuario_id","rol")
);

-- CreateTable
CREATE TABLE "tokens_correo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "tipo_token_correo" NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "usuario_id" UUID,
    "paciente_id" UUID,
    "adulto_responsable_id" UUID,
    "referencia_id" UUID,
    "rol" "rol",
    "email" TEXT,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "usado_en" TIMESTAMPTZ(6),
    "usado_txid" BIGINT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_correo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "politicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" "tipo_politica" NOT NULL,
    "version" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "vigente_desde" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creada_por_id" UUID,

    CONSTRAINT "politicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aceptaciones_politica" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "politica_id" UUID NOT NULL,
    "paciente_id" UUID,
    "solicitud_id" UUID,
    "otorgado_por" "otorgante_consentimiento",
    "adulto_responsable_id" UUID,
    "canal" "canal_aceptacion" NOT NULL,
    "respaldo_ref" TEXT,
    "registrada_por_id" UUID,
    "aceptada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aceptaciones_politica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitudes_hora" (
    "id" UUID NOT NULL,
    "estado" "estado_solicitud_hora" NOT NULL DEFAULT 'PENDIENTE_VERIFICACION',
    "profesional_id" UUID NOT NULL,
    "modalidad" "modalidad_atencion" NOT NULL,
    "espacio_id" UUID,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6) NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "fecha_nacimiento" DATE NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" BYTEA,
    "rut" BYTEA,
    "rut_hmac" BYTEA,
    "adulto_nombre" TEXT,
    "adulto_parentesco" TEXT,
    "adulto_telefono" BYTEA,
    "respuestas" BYTEA,
    "recomendado_id" UUID,
    "lista_espera" BOOLEAN NOT NULL DEFAULT false,
    "politica_id" UUID NOT NULL,
    "terminos_id" UUID,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "paciente_id" UUID,
    "cita_id" UUID,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concretada_en" TIMESTAMPTZ(6),

    CONSTRAINT "solicitudes_hora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imagenes_publicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" TEXT NOT NULL,
    "usuario_id" UUID,
    "tipo_mime" TEXT NOT NULL,
    "ancho" INTEGER NOT NULL,
    "alto" INTEGER NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "contenido" BYTEA NOT NULL,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imagenes_publicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contenido_publico" (
    "id" BOOLEAN NOT NULL DEFAULT true,
    "hero_titulo" TEXT,
    "hero_texto" TEXT,
    "servicios" JSONB NOT NULL DEFAULT '[]',
    "contacto_correo" TEXT,
    "contacto_telefono" TEXT,
    "direccion" TEXT,
    "whatsapp" TEXT,
    "instagram" TEXT,
    "mision" TEXT,
    "vision" TEXT,
    "color_marca" TEXT,
    "logo_imagen_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contenido_publico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_preguntas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clave" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "ayuda" TEXT,
    "tipo" "tipo_pregunta_match" NOT NULL,
    "orden" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "obligatoria" BOOLEAN NOT NULL DEFAULT true,
    "max_selecciones" SMALLINT,
    "propia_centro" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_preguntas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_opciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pregunta_id" UUID NOT NULL,
    "valor" TEXT NOT NULL,
    "etiqueta" TEXT NOT NULL,
    "nota" TEXT,
    "orden" INTEGER NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "criterio" "criterio_match",
    "objetivo" TEXT,
    "peso" SMALLINT NOT NULL DEFAULT 0,
    "estricto" BOOLEAN NOT NULL DEFAULT false,
    "mensaje" TEXT,

    CONSTRAINT "match_opciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_resultados" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_resultados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resenas" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "calificacion" SMALLINT NOT NULL,
    "texto" BYTEA,
    "feedback_privado" BYTEA,
    "mostrar_como" "mostrar_resena" NOT NULL DEFAULT 'ANONIMO',
    "estado" "estado_resena" NOT NULL DEFAULT 'PENDIENTE',
    "motivo_ocultamiento" TEXT,
    "moderada_por_id" UUID,
    "moderada_en" TIMESTAMPTZ(6),
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editada_en" TIMESTAMPTZ(6),

    CONSTRAINT "resenas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resenas_reportes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resena_id" UUID NOT NULL,
    "motivo" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resenas_reportes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resenas_eventos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resena_id" UUID NOT NULL,
    "accion" TEXT NOT NULL,
    "actor_id" UUID,
    "rol" TEXT,
    "motivo" TEXT,
    "en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resenas_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "altas_paciente" (
    "id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "motivo" BYTEA NOT NULL,
    "registrada_por_id" UUID NOT NULL,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "altas_paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horario_centro" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dia_semana" SMALLINT NOT NULL,
    "inicio_min" SMALLINT NOT NULL,
    "fin_min" SMALLINT NOT NULL,

    CONSTRAINT "horario_centro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horarios_espacio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "espacio_id" UUID NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    "inicio_min" SMALLINT NOT NULL,
    "fin_min" SMALLINT NOT NULL,

    CONSTRAINT "horarios_espacio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lista_espera" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "profesional_id" UUID,
    "tipo_atencion_id" UUID,
    "preferencias" TEXT,
    "estado" "estado_lista_espera" NOT NULL DEFAULT 'ACTIVA',
    "creada_por_id" UUID,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avisada_en" TIMESTAMPTZ(6),
    "cerrada_en" TIMESTAMPTZ(6),

    CONSTRAINT "lista_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accesos_clinicos_temporales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "motivo" "motivo_acceso_temporal" NOT NULL,
    "alcance" "alcance_acceso_temporal" NOT NULL,
    "desde" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasta" TIMESTAMPTZ(6) NOT NULL,
    "otorgado_por_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accesos_clinicos_temporales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "borradores_evolucion" (
    "id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "ficha_clinica_id" UUID NOT NULL,
    "cita_id" UUID,
    "contenido" BYTEA NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "borradores_evolucion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tokens_correo_token_hash_key" ON "tokens_correo"("token_hash");

-- CreateIndex
CREATE INDEX "tokens_correo_tipo_expira_en_idx" ON "tokens_correo"("tipo", "expira_en");

-- CreateIndex
CREATE UNIQUE INDEX "politicas_tipo_version_key" ON "politicas"("tipo", "version");

-- CreateIndex
CREATE INDEX "aceptaciones_politica_paciente_id_idx" ON "aceptaciones_politica"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "solicitudes_hora_cita_id_key" ON "solicitudes_hora"("cita_id");

-- CreateIndex
CREATE INDEX "solicitudes_hora_estado_expira_en_idx" ON "solicitudes_hora"("estado", "expira_en");

-- CreateIndex
CREATE INDEX "solicitudes_hora_paciente_id_idx" ON "solicitudes_hora"("paciente_id");

-- CreateIndex
CREATE INDEX "solicitudes_hora_email_idx" ON "solicitudes_hora"("email");

-- CreateIndex
CREATE UNIQUE INDEX "match_preguntas_clave_key" ON "match_preguntas"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "match_opciones_pregunta_id_valor_key" ON "match_opciones"("pregunta_id", "valor");

-- CreateIndex
CREATE INDEX "match_resultados_creado_en_idx" ON "match_resultados"("creado_en");

-- CreateIndex
CREATE INDEX "resenas_profesional_id_estado_idx" ON "resenas"("profesional_id", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "resenas_paciente_id_profesional_id_key" ON "resenas"("paciente_id", "profesional_id");

-- CreateIndex
CREATE INDEX "resenas_reportes_resena_id_idx" ON "resenas_reportes"("resena_id");

-- CreateIndex
CREATE INDEX "resenas_eventos_resena_id_idx" ON "resenas_eventos"("resena_id");

-- CreateIndex
CREATE INDEX "altas_paciente_paciente_id_idx" ON "altas_paciente"("paciente_id");

-- CreateIndex
CREATE INDEX "horarios_espacio_espacio_id_idx" ON "horarios_espacio"("espacio_id");

-- CreateIndex
CREATE INDEX "lista_espera_profesional_id_estado_idx" ON "lista_espera"("profesional_id", "estado");

-- CreateIndex
CREATE INDEX "lista_espera_tipo_atencion_id_estado_idx" ON "lista_espera"("tipo_atencion_id", "estado");

-- CreateIndex
CREATE INDEX "accesos_clinicos_temporales_profesional_id_hasta_idx" ON "accesos_clinicos_temporales"("profesional_id", "hasta");

-- CreateIndex
CREATE INDEX "accesos_clinicos_temporales_paciente_id_idx" ON "accesos_clinicos_temporales"("paciente_id");

-- CreateIndex
CREATE INDEX "borradores_evolucion_autor_id_idx" ON "borradores_evolucion"("autor_id");

-- CreateIndex
CREATE INDEX "adultos_responsables_usuario_id_idx" ON "adultos_responsables"("usuario_id");

-- CreateIndex
CREATE INDEX "evoluciones_cita_id_idx" ON "evoluciones"("cita_id");

-- CreateIndex
CREATE UNIQUE INDEX "bloqueos_temporales_solicitud_id_key" ON "bloqueos_temporales"("solicitud_id");

-- AddForeignKey
ALTER TABLE "mensajes_paciente" ADD CONSTRAINT "mensajes_paciente_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adultos_responsables" ADD CONSTRAINT "adultos_responsables_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evoluciones" ADD CONSTRAINT "evoluciones_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_temporales" ADD CONSTRAINT "bloqueos_temporales_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes_hora"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles_adicionales" ADD CONSTRAINT "roles_adicionales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles_adicionales" ADD CONSTRAINT "roles_adicionales_otorgado_por_id_fkey" FOREIGN KEY ("otorgado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "politicas" ADD CONSTRAINT "politicas_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aceptaciones_politica" ADD CONSTRAINT "aceptaciones_politica_politica_id_fkey" FOREIGN KEY ("politica_id") REFERENCES "politicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aceptaciones_politica" ADD CONSTRAINT "aceptaciones_politica_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aceptaciones_politica" ADD CONSTRAINT "aceptaciones_politica_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitudes_hora"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aceptaciones_politica" ADD CONSTRAINT "aceptaciones_politica_adulto_responsable_id_fkey" FOREIGN KEY ("adulto_responsable_id") REFERENCES "adultos_responsables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aceptaciones_politica" ADD CONSTRAINT "aceptaciones_politica_registrada_por_id_fkey" FOREIGN KEY ("registrada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_hora" ADD CONSTRAINT "solicitudes_hora_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_hora" ADD CONSTRAINT "solicitudes_hora_espacio_id_fkey" FOREIGN KEY ("espacio_id") REFERENCES "espacios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_hora" ADD CONSTRAINT "solicitudes_hora_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_hora" ADD CONSTRAINT "solicitudes_hora_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_hora" ADD CONSTRAINT "solicitudes_hora_politica_id_fkey" FOREIGN KEY ("politica_id") REFERENCES "politicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_hora" ADD CONSTRAINT "solicitudes_hora_terminos_id_fkey" FOREIGN KEY ("terminos_id") REFERENCES "politicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imagenes_publicas" ADD CONSTRAINT "imagenes_publicas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_opciones" ADD CONSTRAINT "match_opciones_pregunta_id_fkey" FOREIGN KEY ("pregunta_id") REFERENCES "match_preguntas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resenas" ADD CONSTRAINT "resenas_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resenas" ADD CONSTRAINT "resenas_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resenas" ADD CONSTRAINT "resenas_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resenas" ADD CONSTRAINT "resenas_moderada_por_id_fkey" FOREIGN KEY ("moderada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resenas_reportes" ADD CONSTRAINT "resenas_reportes_resena_id_fkey" FOREIGN KEY ("resena_id") REFERENCES "resenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "altas_paciente" ADD CONSTRAINT "altas_paciente_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "altas_paciente" ADD CONSTRAINT "altas_paciente_registrada_por_id_fkey" FOREIGN KEY ("registrada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_espacio" ADD CONSTRAINT "horarios_espacio_espacio_id_fkey" FOREIGN KEY ("espacio_id") REFERENCES "espacios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_tipo_atencion_id_fkey" FOREIGN KEY ("tipo_atencion_id") REFERENCES "tipos_atencion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_creada_por_id_fkey" FOREIGN KEY ("creada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_clinicos_temporales" ADD CONSTRAINT "accesos_clinicos_temporales_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_clinicos_temporales" ADD CONSTRAINT "accesos_clinicos_temporales_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_clinicos_temporales" ADD CONSTRAINT "accesos_clinicos_temporales_otorgado_por_id_fkey" FOREIGN KEY ("otorgado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borradores_evolucion" ADD CONSTRAINT "borradores_evolucion_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borradores_evolucion" ADD CONSTRAINT "borradores_evolucion_ficha_clinica_id_fkey" FOREIGN KEY ("ficha_clinica_id") REFERENCES "fichas_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borradores_evolucion" ADD CONSTRAINT "borradores_evolucion_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- 1. Varios roles por cuenta (C-1, C-2). Un rol activo por sesion: la BD sigue
--    recibiendo un solo app.current_rol y la matriz por rol no cambia.
--    usuarios.rol = rol principal; roles_adicionales = segundo rol.
--    Combinaciones: ADMIN+PROFESIONAL, GESTION+PROFESIONAL. PRACTICANTE,
--    PACIENTE y RESPONSABLE son exclusivos. Baja por rol (fecha_baja).
-- =============================================================================

-- Categoria A (criterio_clasificacion.md): identidad y permisos del equipo.
ALTER TABLE roles_adicionales ADD CONSTRAINT roles_adicionales_solo_profesional CHECK (rol = 'PROFESIONAL');
ALTER TABLE roles_adicionales ADD CONSTRAINT roles_adicionales_coherente
  CHECK (activo = (desactivado_en IS NULL));

-- El principal debe admitir el segundo rol y la cuenta no estar cerrada.
CREATE FUNCTION validar_rol_adicional() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol text;
  v_cerrada timestamptz;
BEGIN
  SELECT rol::text, cerrada_en INTO v_rol, v_cerrada FROM usuarios WHERE id = NEW.usuario_id;
  IF NEW.activo AND (v_rol NOT IN ('ADMIN', 'GESTION') OR v_cerrada IS NOT NULL) THEN
    RAISE EXCEPTION 'Combinacion de roles invalida: solo ADMIN o GESTION suman PROFESIONAL'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_adicionales_combinacion';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER roles_adicionales_validos BEFORE INSERT OR UPDATE ON roles_adicionales
  FOR EACH ROW EXECUTE FUNCTION validar_rol_adicional();

-- Desactivar un rol corta las sesiones abiertas con ese rol.
CREATE FUNCTION revocar_sesiones_de_rol() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE sesiones SET revocada_en = now(), motivo_revocacion = 'CAMBIO_CUENTA'
  WHERE usuario_id = NEW.usuario_id AND rol = NEW.rol AND revocada_en IS NULL;
  RETURN NULL;
END;
$$;
CREATE TRIGGER roles_adicionales_revoca_sesiones AFTER UPDATE ON roles_adicionales
  FOR EACH ROW WHEN (OLD.activo AND NOT NEW.activo) EXECUTE FUNCTION revocar_sesiones_de_rol();

-- Cambiar el rol principal: si pasa a ser el adicional, el adicional se
-- desactiva (queda uno); un principal exclusivo no convive con adicionales.
CREATE FUNCTION coherencia_roles_usuario() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE roles_adicionales SET activo = false, desactivado_en = now(), fecha_baja = NULL
  WHERE usuario_id = NEW.id AND rol = NEW.rol AND activo;
  IF NEW.rol NOT IN ('ADMIN', 'GESTION')
     AND EXISTS (SELECT 1 FROM roles_adicionales WHERE usuario_id = NEW.id AND activo) THEN
    RAISE EXCEPTION 'Combinacion de roles invalida: solo ADMIN o GESTION suman PROFESIONAL'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'roles_adicionales_combinacion';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER usuarios_roles_coherentes AFTER UPDATE OF rol ON usuarios
  FOR EACH ROW WHEN (OLD.rol IS DISTINCT FROM NEW.rol) EXECUTE FUNCTION coherencia_roles_usuario();

-- Tiene el rol (principal o adicional activo) en una cuenta activa no cerrada.
CREATE FUNCTION tiene_rol(p_usuario_id uuid, p_rol text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = p_usuario_id AND u.activo AND u.cerrada_en IS NULL
      AND (u.rol::text = p_rol
           OR EXISTS (SELECT 1 FROM roles_adicionales r WHERE r.usuario_id = u.id AND r.rol::text = p_rol AND r.activo))
  )
$$;

CREATE OR REPLACE FUNCTION acceso_vigente() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = app_usuario_id()
      AND u.activo
      AND u.cerrada_en IS NULL
      AND (u.rol::text = app_rol()
           OR EXISTS (SELECT 1 FROM roles_adicionales r
                      WHERE r.usuario_id = u.id AND r.rol::text = app_rol() AND r.activo))
      AND (u.rol::text <> 'PRACTICANTE'
           OR (u.fecha_expiracion_acceso > now() AND supervisor_vigente(u.id) IS NOT NULL))
  )
$$;

CREATE OR REPLACE FUNCTION cuenta_habilitada(p_usuario_id uuid, p_rol text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = p_usuario_id AND u.activo AND u.cerrada_en IS NULL
      AND (u.rol::text = p_rol
           OR EXISTS (SELECT 1 FROM roles_adicionales r
                      WHERE r.usuario_id = u.id AND r.rol::text = p_rol AND r.activo))
      AND (u.rol::text <> 'PRACTICANTE'
           OR (u.fecha_expiracion_acceso > now() AND supervisor_vigente(u.id) IS NOT NULL))
  )
$$;

-- Login (sin contexto): roles con los que la cuenta puede abrir sesion.
CREATE FUNCTION roles_cuenta(p_usuario_id uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(r ORDER BY r = (SELECT rol::text FROM usuarios WHERE id = p_usuario_id) DESC, r), '{}')
  FROM (SELECT rol::text AS r FROM usuarios WHERE id = p_usuario_id
        UNION SELECT rol::text FROM roles_adicionales WHERE usuario_id = p_usuario_id AND activo) x
  WHERE cuenta_habilitada(p_usuario_id, r)
$$;

-- Cambio de rol sin cerrar sesion: revoca la familia y abre otra con el rol
-- pedido (token nuevo). Sin rol habilitado o token invalido: 0 filas.
CREATE FUNCTION cambiar_rol_sesion(p_token_hash bytea, p_nuevo_hash bytea, p_rol rol, p_expira timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s sesiones%ROWTYPE;
BEGIN
  SELECT * INTO s FROM sesiones WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR s.usada_en IS NOT NULL OR s.revocada_en IS NOT NULL OR s.expira_en <= now()
     OR NOT cuenta_habilitada(s.usuario_id, p_rol::text) THEN
    RETURN NULL;
  END IF;
  UPDATE sesiones SET revocada_en = now(), motivo_revocacion = 'CAMBIO_ROL'
  WHERE familia_id = s.familia_id AND revocada_en IS NULL;
  INSERT INTO sesiones (usuario_id, familia_id, token_hash, rol, expira_en)
  VALUES (s.usuario_id, gen_random_uuid(), p_nuevo_hash, p_rol, p_expira);
  RETURN s.usuario_id;
END;
$$;

-- ADMIN suma PROFESIONAL a una cuenta ADMIN o GESTION (o lo reactiva).
CREATE FUNCTION otorgar_rol_adicional(p_usuario_id uuid, p_rol rol) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN otorga roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_usuario_id) THEN
    RAISE EXCEPTION 'Usuario inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO roles_adicionales (usuario_id, rol, otorgado_por_id)
  VALUES (p_usuario_id, p_rol, app_usuario_id())
  ON CONFLICT (usuario_id, rol) DO UPDATE
    SET activo = true, desactivado_en = NULL, fecha_baja = NULL,
        otorgado_por_id = excluded.otorgado_por_id, otorgado_en = now();
END;
$$;

-- Baja de un rol (no de la cuenta): bloquea la agenda desde la fecha y deja
-- POR_REPROGRAMAR las citas desde ahi; procesar_bajas lo desactiva al
-- cumplirse. Como la baja de cuenta: no a quien supervisa practicantes activos.
CREATE FUNCTION iniciar_baja_rol(p_usuario_id uuid, p_rol rol, p_fecha_efectiva timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_citas int;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN inicia bajas' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_fecha_efectiva IS NULL THEN
    RAISE EXCEPTION 'Baja con fecha efectiva' USING ERRCODE = 'check_violation', CONSTRAINT = 'bajas_validas';
  END IF;
  PERFORM 1 FROM roles_adicionales WHERE usuario_id = p_usuario_id AND rol = p_rol AND activo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta no tiene ese rol adicional activo' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM supervisiones s JOIN usuarios u ON u.id = s.practicante_id
             WHERE s.supervisor_id = p_usuario_id AND u.activo
               AND s.desde <= now() AND (s.hasta IS NULL OR s.hasta > now())) THEN
    RAISE EXCEPTION 'Supervisa practicantes activos: cambiar su supervisor antes de la baja'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE roles_adicionales SET fecha_baja = p_fecha_efectiva WHERE usuario_id = p_usuario_id AND rol = p_rol;
  INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo)
  VALUES (p_usuario_id, p_fecha_efectiva, NULL, 'BAJA');
  UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
  WHERE profesional_id = p_usuario_id AND estado IN ('CONFIRMADA', 'SOLICITADA') AND inicio >= p_fecha_efectiva;
  GET DIAGNOSTICS v_citas = ROW_COUNT;
  RETURN v_citas;
END;
$$;

-- roles_adicionales: ADMIN/GESTION leen todo; cada uno los suyos. Escritura solo via funciones.
ALTER TABLE roles_adicionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles_adicionales FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_adicionales_select ON roles_adicionales FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR usuario_id = (SELECT app_usuario_id()));
GRANT SELECT ON roles_adicionales TO app_user;

-- =============================================================================
-- 2. Cuentas: enlaces de un solo uso por correo, invitaciones, recuperacion,
--    acceso sin contraseña (paciente, C-6), cambio de correo (C-9) y TOTP.
-- =============================================================================

-- Edad del paciente hoy (hora de Chile), como la regla de menores.
CREATE FUNCTION edad_paciente(p_paciente_id uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT extract(year FROM age((now() AT TIME ZONE 'America/Santiago')::date, fecha_nacimiento))::int
  FROM pacientes WHERE id = p_paciente_id
$$;

-- Cuenta invitada (03a): abierta sin contraseña hasta que se activa la invitacion.
ALTER TABLE usuarios DROP CONSTRAINT usuarios_cuenta_cerrada_vacia;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_cuenta_cerrada_vacia
  CHECK ((cerrada_en IS NULL AND email IS NOT NULL AND nombre IS NOT NULL)
         OR (cerrada_en IS NOT NULL AND NOT activo AND email IS NULL AND password_hash IS NULL
             AND nombre IS NULL AND telefono IS NULL));

-- tokens_correo (A): solo el SHA-256; sin GRANT (solo funciones). Un uso, con vencimiento.
ALTER TABLE tokens_correo ADD CONSTRAINT tokens_correo_coherente
  CHECK (octet_length(token_hash) = 32 AND expira_en > creado_en AND (usado_en IS NULL) = (usado_txid IS NULL));
ALTER TABLE tokens_correo ENABLE ROW LEVEL SECURITY;
ALTER TABLE tokens_correo FORCE ROW LEVEL SECURITY;

-- Interno: toma el token (P0002 si no existe, 55000 si se uso o vencio) y lo
-- marca usado en esta transaccion (usado_txid autoriza funciones encadenadas).
CREATE FUNCTION consumir_token(p_hash bytea, p_tipo tipo_token_correo) RETURNS tokens_correo
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tokens_correo%ROWTYPE;
BEGIN
  SELECT * INTO t FROM tokens_correo WHERE token_hash = p_hash AND tipo = p_tipo FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enlace inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.usado_en IS NOT NULL OR t.expira_en <= now() THEN
    RAISE EXCEPTION 'El enlace ya se uso o vencio' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE tokens_correo SET usado_en = now(), usado_txid = txid_current() WHERE id = t.id RETURNING * INTO t;
  RETURN t;
END;
$$;

-- Interno: un token por proposito; los anteriores sin usar de lo mismo se anulan.
CREATE FUNCTION emitir_token(p_tipo tipo_token_correo, p_hash bytea, p_expira timestamptz, p_usuario_id uuid,
                             p_paciente_id uuid, p_adulto_id uuid, p_referencia_id uuid, p_rol rol, p_email text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE tokens_correo SET expira_en = greatest(creado_en + interval '1 second', least(expira_en, now()))
  WHERE tipo = p_tipo AND usado_en IS NULL AND expira_en > now()
    AND usuario_id IS NOT DISTINCT FROM p_usuario_id AND paciente_id IS NOT DISTINCT FROM p_paciente_id
    AND adulto_responsable_id IS NOT DISTINCT FROM p_adulto_id AND referencia_id IS NOT DISTINCT FROM p_referencia_id;
  INSERT INTO tokens_correo (tipo, token_hash, usuario_id, paciente_id, adulto_responsable_id, referencia_id, rol, email, expira_en)
  VALUES (p_tipo, p_hash, p_usuario_id, p_paciente_id, p_adulto_id, p_referencia_id, p_rol, p_email, p_expira);
END;
$$;

-- Recuperar contraseña (sin contexto). Devuelve si se emitio (la API responde igual exista o no).
CREATE FUNCTION crear_token_recuperacion(p_email text, p_hash bytea, p_expira timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM usuarios WHERE email = p_email AND activo AND cerrada_en IS NULL;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  PERFORM emitir_token('RECUPERACION', p_hash, p_expira, v_id, NULL, NULL, NULL, NULL, NULL);
  RETURN true;
END;
$$;

CREATE FUNCTION usar_token_recuperacion(p_hash bytea, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_hash, 'RECUPERACION');
BEGIN
  -- El trigger usuarios_revoca_sesiones corta las sesiones abiertas.
  UPDATE usuarios SET password_hash = p_password_hash, updated_at = now()
  WHERE id = t.usuario_id AND activo AND cerrada_en IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta sin acceso' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN t.usuario_id;
END;
$$;

-- Acceso sin contraseña (C-6): solo cuentas de pacientes y adultos responsables.
CREATE FUNCTION crear_token_acceso(p_email text, p_hash bytea, p_expira timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM usuarios
  WHERE email = p_email AND rol IN ('PACIENTE', 'RESPONSABLE') AND activo AND cerrada_en IS NULL;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  PERFORM emitir_token('ACCESO', p_hash, p_expira, v_id, NULL, NULL, NULL, NULL, NULL);
  RETURN true;
END;
$$;

CREATE FUNCTION usar_token_acceso(p_hash bytea) RETURNS TABLE (usuario_id uuid, rol rol)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_hash, 'ACCESO');
BEGIN
  RETURN QUERY SELECT u.id, u.rol FROM usuarios u
  WHERE u.id = t.usuario_id AND cuenta_habilitada(u.id, u.rol::text);
END;
$$;

-- Invitaciones. Equipo: ADMIN, a una cuenta ya creada (fija la contraseña).
CREATE FUNCTION crear_invitacion_equipo(p_usuario_id uuid, p_hash bytea, p_expira timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text;
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN invita al equipo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT email INTO v_email FROM usuarios
  WHERE id = p_usuario_id AND rol NOT IN ('PACIENTE', 'RESPONSABLE') AND activo AND cerrada_en IS NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Cuenta de equipo inexistente o sin acceso' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM emitir_token('INVITACION', p_hash, p_expira, p_usuario_id, NULL, NULL, NULL, NULL, v_email);
  RETURN v_email;
END;
$$;

-- Paciente (D-2, D-4): ADMIN/GESTION, desde los 14 años y sin cuenta previa.
CREATE FUNCTION crear_invitacion_paciente(p_paciente_id uuid, p_email text, p_hash bytea, p_expira timestamptz)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION invitan pacientes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(p_email, email) INTO v_email FROM pacientes WHERE id = p_paciente_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_email IS NULL OR edad_paciente(p_paciente_id) < 14 THEN
    RAISE EXCEPTION 'Cuenta de paciente: correo y al menos 14 años (menores de 14 opera el adulto responsable)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_paciente_edad_minima';
  END IF;
  IF EXISTS (SELECT 1 FROM usuarios WHERE paciente_id = p_paciente_id) THEN
    RAISE EXCEPTION 'El paciente ya tiene cuenta' USING ERRCODE = 'unique_violation';
  END IF;
  PERFORM emitir_token('INVITACION', p_hash, p_expira, NULL, p_paciente_id, NULL, NULL, 'PACIENTE', v_email);
  RETURN v_email;
END;
$$;

-- Adulto responsable de un menor (D-4): ADMIN/GESTION.
CREATE FUNCTION crear_invitacion_responsable(p_adulto_id uuid, p_email text, p_hash bytea, p_expira timestamptz)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email text;
  v_paciente uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION invitan adultos responsables' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(p_email, email), paciente_id INTO v_email, v_paciente FROM adultos_responsables WHERE id = p_adulto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adulto responsable inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_email IS NULL OR edad_paciente(v_paciente) >= 18 THEN
    RAISE EXCEPTION 'Cuenta de adulto responsable: correo y paciente menor de 18'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_responsable_de_menor';
  END IF;
  PERFORM emitir_token('INVITACION', p_hash, p_expira, NULL, v_paciente, p_adulto_id, NULL, 'RESPONSABLE', v_email);
  RETURN v_email;
END;
$$;

-- Activar una invitacion (sin contexto). Equipo: fija la contraseña. Paciente
-- o responsable: crea la cuenta (id de la API) con el correo verificado; un
-- responsable que ya tiene cuenta (mismo correo) solo se vincula.
CREATE FUNCTION activar_invitacion(p_hash bytea, p_password_hash text, p_nuevo_usuario_id uuid)
RETURNS TABLE (usuario_id uuid, rol rol)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_hash, 'INVITACION');
  v_id uuid;
  v_nombre text;
BEGIN
  IF t.usuario_id IS NOT NULL THEN
    UPDATE usuarios SET password_hash = p_password_hash, updated_at = now()
    WHERE id = t.usuario_id AND activo AND cerrada_en IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cuenta sin acceso' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    v_id := t.usuario_id;
  ELSIF t.rol = 'PACIENTE' THEN
    IF edad_paciente(t.paciente_id) < 14 THEN
      RAISE EXCEPTION 'Cuenta de paciente desde los 14 años'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_paciente_edad_minima';
    END IF;
    SELECT nombre || ' ' || apellido INTO v_nombre FROM pacientes WHERE id = t.paciente_id;
    INSERT INTO usuarios (id, email, password_hash, nombre, rol, paciente_id)
    VALUES (p_nuevo_usuario_id, t.email, p_password_hash, v_nombre, 'PACIENTE', t.paciente_id);
    v_id := p_nuevo_usuario_id;
  ELSE
    SELECT id INTO v_id FROM usuarios WHERE email = t.email AND rol = 'RESPONSABLE' AND activo AND cerrada_en IS NULL;
    IF v_id IS NULL THEN
      SELECT nombre INTO v_nombre FROM adultos_responsables WHERE id = t.adulto_responsable_id;
      INSERT INTO usuarios (id, email, password_hash, nombre, rol)
      VALUES (p_nuevo_usuario_id, t.email, p_password_hash, v_nombre, 'RESPONSABLE');
      v_id := p_nuevo_usuario_id;
    END IF;
    UPDATE adultos_responsables SET usuario_id = v_id WHERE id = t.adulto_responsable_id;
  END IF;
  RETURN QUERY SELECT u.id, u.rol FROM usuarios u WHERE u.id = v_id;
END;
$$;

-- Cambio de correo del paciente o responsable (C-9): el nuevo se verifica.
CREATE FUNCTION crear_token_cambio_correo(p_email text, p_hash bytea, p_expira timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'Solo el paciente o su adulto responsable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM emitir_token('VERIFICACION_CORREO', p_hash, p_expira, app_usuario_id(), app_paciente_id(), NULL, NULL, NULL,
                       p_email);
END;
$$;

CREATE FUNCTION usar_token_cambio_correo(p_hash bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_hash, 'VERIFICACION_CORREO');
BEGIN
  UPDATE usuarios SET email = t.email, updated_at = now() WHERE id = t.usuario_id AND activo AND cerrada_en IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta sin acceso' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF t.paciente_id IS NOT NULL THEN
    UPDATE pacientes SET email = t.email, updated_at = now() WHERE id = t.paciente_id;
  END IF;
END;
$$;

-- C-9: el paciente cambia su telefono (cifrado por la API con el id del paciente).
CREATE FUNCTION actualizar_telefono_paciente(p_telefono bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'PACIENTE' THEN
    RAISE EXCEPTION 'Solo el paciente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE pacientes SET telefono = p_telefono, updated_at = now() WHERE id = app_paciente_id();
END;
$$;

-- Login por RUT del paciente (indice ciego), mismas columnas que credenciales_login.
CREATE FUNCTION credenciales_login_rut(p_rut_hmac bytea)
RETURNS TABLE (id uuid, password_hash text, rol rol, activo boolean, fecha_expiracion_acceso timestamptz, paciente_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.password_hash, u.rol, u.activo, u.fecha_expiracion_acceso, u.paciente_id
  FROM usuarios u JOIN pacientes p ON p.id = u.paciente_id
  WHERE p.rut_hmac = p_rut_hmac AND u.rol = 'PACIENTE'
$$;

-- TOTP: secreto cifrado (IDENTIFICACION, AAD usuarios:totp_secreto:id).
-- Obligatorio con un rol clinico (PROFESIONAL o PRACTICANTE, principal o adicional).
ALTER TABLE usuarios ADD CONSTRAINT usuarios_totp_cifrado
  CHECK (octet_length(totp_secreto) >= 49 AND (NOT totp_activo OR totp_secreto IS NOT NULL));

CREATE FUNCTION segundo_factor(p_usuario_id uuid)
RETURNS TABLE (secreto bytea, activo boolean, requerido boolean, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.totp_secreto, u.totp_activo,
         u.rol::text IN ('PROFESIONAL', 'PRACTICANTE')
           OR EXISTS (SELECT 1 FROM roles_adicionales r WHERE r.usuario_id = u.id AND r.activo AND r.rol = 'PROFESIONAL'),
         u.email
  FROM usuarios u WHERE u.id = p_usuario_id
$$;

-- Enrolamiento (sin contexto, tras validar la contraseña): solo si aun no esta activo.
CREATE FUNCTION guardar_totp(p_usuario_id uuid, p_secreto bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE usuarios SET totp_secreto = p_secreto WHERE id = p_usuario_id AND NOT totp_activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El segundo factor ya esta activo' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END;
$$;

CREATE FUNCTION activar_totp(p_usuario_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE usuarios SET totp_activo = true WHERE id = p_usuario_id AND totp_secreto IS NOT NULL;
END;
$$;

-- ADMIN reinicia el segundo factor de otro (dispositivo perdido); corta sus sesiones.
CREATE FUNCTION reiniciar_totp(p_usuario_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' OR p_usuario_id = app_usuario_id() THEN
    RAISE EXCEPTION 'Solo ADMIN reinicia el segundo factor de otra cuenta' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE usuarios SET totp_secreto = NULL, totp_activo = false WHERE id = p_usuario_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE sesiones SET revocada_en = now(), motivo_revocacion = 'CAMBIO_CUENTA'
  WHERE usuario_id = p_usuario_id AND revocada_en IS NULL;
END;
$$;

-- =============================================================================
-- 3. Politicas versionadas y consentimientos (D-3): politica de datos,
--    consentimiento informado de atencion y terminos de agendamiento. Se
--    aceptan en la solicitud de hora, en el portal, por enlace de un solo uso
--    o los registra ADMIN/GESTION con respaldo. El consentimiento de
--    practicante y la oposicion a un aviso aceptan tambien el enlace.
-- =============================================================================

-- politicas (B): append-only; la version la fija la BD (max + 1).
ALTER TABLE politicas ADD CONSTRAINT politicas_coherente
  CHECK (version >= 1 AND btrim(texto) <> '' AND length(texto) <= 50000);

CREATE FUNCTION versionar_politica() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('vinculos:politica:' || NEW.tipo));
  NEW.version := coalesce((SELECT max(version) FROM politicas WHERE tipo = NEW.tipo), 0) + 1;
  NEW.vigente_desde := now();
  NEW.creada_por_id := app_usuario_id();
  RETURN NEW;
END;
$$;
CREATE TRIGGER politicas_versionadas BEFORE INSERT ON politicas
  FOR EACH ROW EXECUTE FUNCTION versionar_politica();
CREATE TRIGGER politicas_append_only BEFORE UPDATE OR DELETE ON politicas
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();

ALTER TABLE politicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE politicas FORCE ROW LEVEL SECURITY;
CREATE POLICY politicas_select ON politicas FOR SELECT TO app_user USING (true);
CREATE POLICY politicas_insert ON politicas FOR INSERT TO app_user WITH CHECK ((SELECT app_rol()) = 'ADMIN');
GRANT SELECT, INSERT ON politicas TO app_user;

-- Portal publico (sin contexto): la version vigente de un tipo.
CREATE FUNCTION politica_vigente(p_tipo tipo_politica)
RETURNS TABLE (id uuid, version int, texto text, vigente_desde timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.version, p.texto, p.vigente_desde FROM politicas p
  WHERE p.tipo = p_tipo ORDER BY p.version DESC LIMIT 1
$$;

-- Textos iniciales (el centro los reemplaza publicando una version nueva).
INSERT INTO politicas (tipo, texto) VALUES
  ('POLITICA_DATOS', 'El centro registra sus datos personales y de salud con el unico fin de brindarle atencion en salud mental. Su ficha clinica es confidencial: solo el profesional que lo atiende accede a su contenido clinico. El centro conserva los registros por el plazo que exige la normativa vigente (Ley 20.584 y Decreto 41). Puede solicitar acceso, rectificacion o eliminacion de sus datos personales escribiendo al centro.'),
  ('CONSENTIMIENTO_ATENCION', 'Autorizo al centro a brindarme atencion psicologica. Entiendo los objetivos, la duracion estimada y las condiciones de la atencion, que puedo hacer preguntas en cualquier momento y que puedo retirar este consentimiento cuando lo estime.'),
  ('TERMINOS_AGENDAMIENTO', 'Puede cambiar o cancelar su hora sin costo hasta el plazo de aviso que fija el centro. Las cancelaciones tardias y las inasistencias se rigen por la politica de cancelacion vigente. Si el paciente es menor de edad, el adulto responsable asiste a la primera sesion.');

-- aceptaciones_politica (A): append-only.
CREATE TRIGGER aceptaciones_politica_append_only BEFORE UPDATE OR DELETE ON aceptaciones_politica
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();
ALTER TABLE aceptaciones_politica ADD CONSTRAINT aceptaciones_politica_coherente
  CHECK ((otorgado_por IS DISTINCT FROM 'ADULTO_RESPONSABLE') = (adulto_responsable_id IS NULL)
         AND (canal <> 'PRESENCIAL' OR coalesce(btrim(respaldo_ref), '') <> '')
         AND (paciente_id IS NOT NULL OR solicitud_id IS NOT NULL));

-- Portal: el paciente adulto o el adulto responsable de un menor. ADMIN/GESTION con respaldo (PRESENCIAL).
CREATE FUNCTION registrar_aceptacion(p_tipo tipo_politica, p_paciente_id uuid, p_adulto_id uuid, p_respaldo text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_politica uuid;
  v_id uuid;
  v_menor boolean := edad_paciente(p_paciente_id) < 18;
BEGIN
  IF NOT acceso_vigente() THEN
    RAISE EXCEPTION 'Sin acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id INTO v_politica FROM politica_vigente(p_tipo);
  IF v_politica IS NULL OR v_menor IS NULL THEN
    RAISE EXCEPTION 'Politica o paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF app_rol() = 'PACIENTE' AND app_paciente_id() = p_paciente_id AND NOT v_menor AND p_adulto_id IS NULL THEN
    INSERT INTO aceptaciones_politica (politica_id, paciente_id, otorgado_por, canal, registrada_por_id)
    VALUES (v_politica, p_paciente_id, 'PACIENTE', 'PORTAL', app_usuario_id()) RETURNING id INTO v_id;
  ELSIF app_rol() = 'RESPONSABLE' AND v_menor
        AND EXISTS (SELECT 1 FROM adultos_responsables WHERE id = p_adulto_id AND paciente_id = p_paciente_id
                    AND usuario_id = app_usuario_id()) THEN
    INSERT INTO aceptaciones_politica (politica_id, paciente_id, otorgado_por, adulto_responsable_id, canal, registrada_por_id)
    VALUES (v_politica, p_paciente_id, 'ADULTO_RESPONSABLE', p_adulto_id, 'PORTAL', app_usuario_id()) RETURNING id INTO v_id;
  ELSIF app_rol() IN ('ADMIN', 'GESTION') THEN
    IF v_menor <> (p_adulto_id IS NOT NULL)
       OR (p_adulto_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM adultos_responsables WHERE id = p_adulto_id
                                                    AND paciente_id = p_paciente_id)) THEN
      RAISE EXCEPTION 'Paciente menor de 18: acepta un adulto responsable del paciente'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_menor_requiere_adulto_responsable';
    END IF;
    INSERT INTO aceptaciones_politica (politica_id, paciente_id, otorgado_por, adulto_responsable_id, canal, respaldo_ref,
                                       registrada_por_id)
    VALUES (v_politica, p_paciente_id, CASE WHEN v_menor THEN 'ADULTO_RESPONSABLE' ELSE 'PACIENTE' END::otorgante_consentimiento,
            p_adulto_id, 'PRESENCIAL', p_respaldo, app_usuario_id()) RETURNING id INTO v_id;
  ELSE
    RAISE EXCEPTION 'Acepta el paciente adulto, su adulto responsable o ADMIN/GESTION con respaldo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_id;
END;
$$;

-- Enlace de consentimiento por correo (ADMIN/GESTION): consentimiento de
-- practicante (SOLICITADO), aviso de cambio de supervisor (SIN_RESPUESTA) o
-- consentimiento de atencion (referencia = paciente). Va al correo del
-- paciente o, si es menor, al de su adulto responsable. Devuelve el correo.
CREATE FUNCTION crear_token_consentimiento(p_referencia_id uuid, p_hash bytea, p_expira timestamptz) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_paciente uuid;
  v_adulto uuid;
  v_email text;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION envian el enlace' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT c.paciente_id INTO v_paciente FROM consentimientos c WHERE c.id = p_referencia_id AND c.estado = 'SOLICITADO';
  IF v_paciente IS NULL THEN
    SELECT c.paciente_id INTO v_paciente FROM avisos_consentimiento a JOIN consentimientos c ON c.id = a.consentimiento_id
    WHERE a.id = p_referencia_id AND a.respuesta = 'SIN_RESPUESTA';
  END IF;
  IF v_paciente IS NULL THEN
    SELECT id INTO v_paciente FROM pacientes WHERE id = p_referencia_id;
  END IF;
  IF v_paciente IS NULL THEN
    RAISE EXCEPTION 'Nada que consentir con esa referencia' USING ERRCODE = 'no_data_found';
  END IF;
  IF edad_paciente(v_paciente) < 18 THEN
    SELECT id, email INTO v_adulto, v_email FROM adultos_responsables
    WHERE paciente_id = v_paciente AND email IS NOT NULL ORDER BY created_at LIMIT 1;
  ELSE
    SELECT coalesce(p.email, (SELECT u.email FROM usuarios u WHERE u.paciente_id = p.id)) INTO v_email
    FROM pacientes p WHERE p.id = v_paciente;
  END IF;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'El paciente (o su adulto responsable) no tiene correo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tokens_correo_sin_destinatario';
  END IF;
  PERFORM emitir_token('CONSENTIMIENTO', p_hash, p_expira, NULL, v_paciente, v_adulto, p_referencia_id, NULL, v_email);
  RETURN v_email;
END;
$$;

-- Pagina del enlace (sin contexto, no lo consume): que se pide y la version vigente.
CREATE FUNCTION consultar_token_consentimiento(p_hash bytea)
RETURNS TABLE (tipo text, politica_version int, politica_texto text, vence_en timestamptz, menor boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  t tokens_correo%ROWTYPE;
BEGIN
  SELECT * INTO t FROM tokens_correo WHERE token_hash = p_hash AND tipo = 'CONSENTIMIENTO'
    AND usado_en IS NULL AND expira_en > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enlace inexistente, usado o vencido' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN QUERY
  SELECT CASE WHEN EXISTS (SELECT 1 FROM consentimientos WHERE id = t.referencia_id) THEN 'PRACTICANTE'
              WHEN EXISTS (SELECT 1 FROM avisos_consentimiento WHERE id = t.referencia_id) THEN 'AVISO_SUPERVISOR'
              ELSE 'ATENCION' END,
         v.version, v.texto, t.expira_en, t.adulto_responsable_id IS NOT NULL
  FROM politica_vigente('CONSENTIMIENTO_ATENCION') v;
END;
$$;

-- Respuesta por enlace (sin contexto). El token consumido en esta
-- transaccion autoriza a validar_otorgante (usado_txid); otorga el paciente
-- o, si es menor, el adulto responsable al que se envio.
CREATE FUNCTION responder_token_consentimiento(p_hash bytea, p_acepta boolean, p_version text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t tokens_correo%ROWTYPE := consumir_token(p_hash, 'CONSENTIMIENTO');
  v_tipo otorgante_consentimiento := CASE WHEN t.adulto_responsable_id IS NULL THEN 'PACIENTE' ELSE 'ADULTO_RESPONSABLE' END;
  v_politica record;
BEGIN
  IF p_acepta IS NULL THEN
    RAISE EXCEPTION 'Responder si o no' USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_coherente';
  END IF;
  IF EXISTS (SELECT 1 FROM consentimientos WHERE id = t.referencia_id) THEN
    PERFORM responder_consentimiento(t.referencia_id, p_acepta, p_version, v_tipo, t.adulto_responsable_id, NULL);
    RETURN 'PRACTICANTE';
  ELSIF EXISTS (SELECT 1 FROM avisos_consentimiento WHERE id = t.referencia_id) THEN
    PERFORM responder_aviso_consentimiento(t.referencia_id,
                                           CASE WHEN p_acepta THEN 'CONFORME' ELSE 'OPOSICION' END::respuesta_aviso,
                                           v_tipo, t.adulto_responsable_id, NULL);
    RETURN 'AVISO_SUPERVISOR';
  END IF;
  IF p_acepta THEN
    SELECT * INTO v_politica FROM politica_vigente('CONSENTIMIENTO_ATENCION');
    IF v_politica.version::text IS DISTINCT FROM p_version THEN
      RAISE EXCEPTION 'La version aceptada no es la vigente'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'aceptaciones_politica_version_vigente';
    END IF;
    INSERT INTO aceptaciones_politica (politica_id, paciente_id, otorgado_por, adulto_responsable_id, canal)
    VALUES (v_politica.id, t.paciente_id, v_tipo, t.adulto_responsable_id, 'TOKEN');
  END IF;
  RETURN 'ATENCION';
END;
$$;

-- validar_otorgante: ademas del paciente y de ADMIN/GESTION con respaldo,
-- responde el adulto responsable con cuenta (RESPONSABLE) por su menor y el
-- enlace por correo (token consumido en esta transaccion).
CREATE OR REPLACE FUNCTION validar_otorgante(p_paciente_id uuid, p_tipo otorgante_consentimiento,
                                             p_adulto_id uuid, p_respaldo text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_token boolean := EXISTS (
    SELECT 1 FROM tokens_correo t
    WHERE t.usado_txid = txid_current() AND t.tipo = 'CONSENTIMIENTO' AND t.paciente_id = p_paciente_id
      AND t.adulto_responsable_id IS NOT DISTINCT FROM p_adulto_id);
BEGIN
  IF NOT v_token AND (
     NOT acceso_vigente()
     OR NOT ((app_rol() = 'PACIENTE' AND app_paciente_id() = p_paciente_id)
             OR (app_rol() = 'RESPONSABLE' AND EXISTS (SELECT 1 FROM adultos_responsables
                                                        WHERE id = p_adulto_id AND paciente_id = p_paciente_id
                                                          AND usuario_id = app_usuario_id()))
             OR app_rol() IN ('ADMIN', 'GESTION'))) THEN
    RAISE EXCEPTION 'Responde o revoca el paciente, su adulto responsable, o ADMIN/GESTION con respaldo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT v_token AND app_rol() IN ('ADMIN', 'GESTION') AND coalesce(btrim(p_respaldo), '') = '' THEN
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
  IF p_tipo <> 'ADULTO_RESPONSABLE' AND edad_paciente(p_paciente_id) < 18 THEN
    RAISE EXCEPTION 'Paciente menor de 18: responde un adulto responsable'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'consentimientos_menor_requiere_adulto_responsable';
  END IF;
END;
$$;

-- Avisos respondidos por enlace: sin usuario que responda (el token es el registro).
ALTER TABLE avisos_consentimiento DROP CONSTRAINT avisos_consentimiento_coherente;
ALTER TABLE avisos_consentimiento ADD CONSTRAINT avisos_consentimiento_coherente
  CHECK ((respuesta = 'SIN_RESPUESTA') = (respondido_en IS NULL)
         AND (respondido_por_id IS NULL OR otorgado_por_tipo IS NOT NULL)
         AND (respuesta <> 'OPOSICION' OR otorgado_por_tipo IS NOT NULL)
         AND (otorgado_por_tipo IS DISTINCT FROM 'ADULTO_RESPONSABLE') = (adulto_responsable_id IS NULL)
         AND vence_en > notificado_en);

ALTER TABLE aceptaciones_politica ENABLE ROW LEVEL SECURITY;
ALTER TABLE aceptaciones_politica FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. Menores en el portal (D-4, requiere validacion legal: Ley 21.331).
--    - Menor de 14: sin cuenta propia; opera el adulto responsable.
--    - 14 a 17: cuenta restringida: sus citas, recordatorios y mensajes a su
--      profesional (no pagos, documentos, epicrisis ni consentimientos).
--    - Adulto responsable (rol RESPONSABLE, cuenta exclusiva): ve citas,
--      pagos y documentos emitidos de sus menores; nunca los mensajes del
--      adolescente. Nadie del portal ve la ficha.
--    Ademas, el acceso clinico temporal (C-4/C-5, seccion 8) entra en las
--    politicas de lectura clinica desde aqui.
-- =============================================================================

-- Pacientes menores de 18 a cargo del RESPONSABLE de la sesion.
CREATE FUNCTION pacientes_a_cargo() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ar.paciente_id FROM adultos_responsables ar
  WHERE app_rol() = 'RESPONSABLE' AND ar.usuario_id = app_usuario_id() AND edad_paciente(ar.paciente_id) < 18
$$;

-- Pacientes con acceso pleno del portal: el propio si es adulto, o los menores a cargo.
CREATE FUNCTION app_pacientes_plenos() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_paciente_id() WHERE app_rol() = 'PACIENTE' AND edad_paciente(app_paciente_id()) >= 18
  UNION ALL
  SELECT pacientes_a_cargo()
$$;

-- Acceso clinico temporal vigente del PROFESIONAL de la sesion (seccion 8).
CREATE FUNCTION acceso_temporal_vigente(p_paciente_id uuid, p_escritura boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_rol() = 'PROFESIONAL' AND EXISTS (
    SELECT 1 FROM accesos_clinicos_temporales a
    WHERE a.paciente_id = p_paciente_id AND a.profesional_id = app_usuario_id()
      AND a.desde <= now() AND a.hasta > now()
      AND (NOT p_escritura OR a.alcance = 'LECTURA_ESCRITURA'))
$$;

CREATE FUNCTION acceso_temporal_ficha(p_ficha_id uuid, p_escritura boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT acceso_temporal_vigente((SELECT paciente_id FROM fichas_clinicas WHERE id = p_ficha_id), p_escritura)
$$;

-- Equipo tratante de un paciente: su tratante y los profesionales de sus citas.
CREATE FUNCTION equipo_tratante_de(p_paciente_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT profesional_id FROM pacientes WHERE id = p_paciente_id
  UNION SELECT profesional_id FROM citas WHERE paciente_id = p_paciente_id
$$;

DROP POLICY pacientes_select ON pacientes;
CREATE POLICY pacientes_select ON pacientes FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR (profesional_id = (SELECT app_usuario_id())
             AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE'))
         OR id = (SELECT app_paciente_id())
         OR id IN (SELECT pacientes_a_cargo())
         OR acceso_temporal_vigente(id, false));

DROP POLICY adultos_responsables_select ON adultos_responsables;
CREATE POLICY adultos_responsables_select ON adultos_responsables FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR es_profesional_de_paciente(paciente_id)
         OR paciente_id = (SELECT app_paciente_id())
         OR ((SELECT app_rol()) = 'RESPONSABLE' AND usuario_id = (SELECT app_usuario_id()))
         OR acceso_temporal_vigente(paciente_id, false));

DROP POLICY citas_select ON citas;
CREATE POLICY citas_select ON citas FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR (profesional_id = (SELECT app_usuario_id())
             AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE'))
         OR paciente_id = (SELECT app_paciente_id())
         OR paciente_id IN (SELECT pacientes_a_cargo()));

DROP POLICY pagos_select ON pagos;
CREATE POLICY pagos_select ON pagos FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND cita_id IN (SELECT id FROM citas))
         OR cita_id IN (SELECT c.id FROM citas c WHERE c.paciente_id IN (SELECT app_pacientes_plenos())));

DROP POLICY boletas_select ON boletas;
CREATE POLICY boletas_select ON boletas FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND cita_id IN (SELECT id FROM citas))
         OR cita_id IN (SELECT c.id FROM citas c WHERE c.paciente_id IN (SELECT app_pacientes_plenos())));

DROP POLICY resoluciones_cita_select ON resoluciones_cita;
CREATE POLICY resoluciones_cita_select ON resoluciones_cita FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND cita_id IN (SELECT id FROM citas))
         OR cita_id IN (SELECT c.id FROM citas c WHERE c.paciente_id IN (SELECT app_pacientes_plenos())));

DROP POLICY recordatorios_cita_select ON recordatorios_cita;
CREATE POLICY recordatorios_cita_select ON recordatorios_cita FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PACIENTE', 'RESPONSABLE') AND cita_id IN (SELECT id FROM citas)));

DROP POLICY documentos_clinicos_select ON documentos_clinicos;
CREATE POLICY documentos_clinicos_select ON documentos_clinicos FOR SELECT TO app_user
  USING (es_profesional_de_paciente(paciente_id)
         OR paciente_id IN (SELECT app_pacientes_plenos())
         OR acceso_temporal_vigente(paciente_id, false));

DROP POLICY consentimientos_select ON consentimientos;
CREATE POLICY consentimientos_select ON consentimientos FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR paciente_id IN (SELECT app_pacientes_plenos())
         OR practicante_id = (SELECT app_usuario_id())
         OR supervisor_id = (SELECT app_usuario_id())
         OR es_profesional_de_paciente(paciente_id));

DROP POLICY solicitudes_epicrisis_select ON solicitudes_epicrisis;
CREATE POLICY solicitudes_epicrisis_select ON solicitudes_epicrisis FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR paciente_id IN (SELECT app_pacientes_plenos())
         OR ((SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE') AND es_profesional_de_paciente(paciente_id)));
DROP POLICY solicitudes_epicrisis_insert ON solicitudes_epicrisis;
CREATE POLICY solicitudes_epicrisis_insert ON solicitudes_epicrisis FOR INSERT TO app_user
  WITH CHECK ((SELECT app_rol()) IN ('PACIENTE', 'RESPONSABLE') AND paciente_id IN (SELECT app_pacientes_plenos())
              AND estado = 'SOLICITADA');

-- Mensajes: el adolescente ve los suyos; el adulto responsable solo los que el escribio.
DROP POLICY mensajes_paciente_select ON mensajes_paciente;
CREATE POLICY mensajes_paciente_select ON mensajes_paciente FOR SELECT TO app_user
  USING (paciente_id = (SELECT app_paciente_id())
         OR ((SELECT app_rol()) = 'RESPONSABLE' AND autor_id = (SELECT app_usuario_id()))
         OR profesional_id = (SELECT app_usuario_id()));
DROP POLICY mensajes_paciente_insert ON mensajes_paciente;
CREATE POLICY mensajes_paciente_insert ON mensajes_paciente FOR INSERT TO app_user
  WITH CHECK (autor_id = (SELECT app_usuario_id()) AND leido_en IS NULL
              AND (((SELECT app_rol()) = 'PACIENTE' AND paciente_id = (SELECT app_paciente_id()))
                   OR ((SELECT app_rol()) = 'RESPONSABLE' AND paciente_id IN (SELECT pacientes_a_cargo())))
              AND profesional_id IN (SELECT equipo_tratante_de(paciente_id)));

DROP POLICY notificaciones_select ON notificaciones;
CREATE POLICY notificaciones_select ON notificaciones FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR usuario_id = (SELECT app_usuario_id())
         OR paciente_id = (SELECT app_paciente_id())
         OR paciente_id IN (SELECT pacientes_a_cargo()));

DROP POLICY preferencias_notificacion_select ON preferencias_notificacion;
CREATE POLICY preferencias_notificacion_select ON preferencias_notificacion FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION') OR paciente_id = (SELECT app_paciente_id())
         OR paciente_id IN (SELECT pacientes_a_cargo()));
DROP POLICY preferencias_notificacion_insert ON preferencias_notificacion;
CREATE POLICY preferencias_notificacion_insert ON preferencias_notificacion FOR INSERT TO app_user
  WITH CHECK (paciente_id = (SELECT app_paciente_id()) OR paciente_id IN (SELECT pacientes_a_cargo()));
DROP POLICY preferencias_notificacion_update ON preferencias_notificacion;
CREATE POLICY preferencias_notificacion_update ON preferencias_notificacion FOR UPDATE TO app_user
  USING (paciente_id = (SELECT app_paciente_id()) OR paciente_id IN (SELECT pacientes_a_cargo()))
  WITH CHECK (paciente_id = (SELECT app_paciente_id()) OR paciente_id IN (SELECT pacientes_a_cargo()));

CREATE OR REPLACE FUNCTION tipo_documento_del_paciente(p_tipo_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM documentos_clinicos
                 WHERE tipo_documento_id = p_tipo_id AND paciente_id IN (SELECT app_pacientes_plenos()))
$$;
DROP POLICY tipos_documento_clinico_select_paciente ON tipos_documento_clinico;
CREATE POLICY tipos_documento_clinico_select_paciente ON tipos_documento_clinico FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('PACIENTE', 'RESPONSABLE') AND tipo_documento_del_paciente(id));

-- Estado de pago: el adolescente no ve montos (solo el adulto responsable).
CREATE OR REPLACE VIEW estado_pago_citas WITH (security_invoker = true) AS
SELECT c.id AS cita_id, c.profesional_id, c.paciente_id, c.estado AS estado_cita, c.inicio, c.fin, c.monto,
       x.exigible, x.pagado, x.devolucion,
       greatest(x.exigible - (x.pagado - x.devolucion), 0) AS saldo,
       CASE
         WHEN x.exigible = 0 THEN 'SIN_COBRO'
         WHEN x.pagado - x.devolucion >= x.exigible THEN 'PAGADO'
         WHEN x.pagado - x.devolucion > 0 THEN 'PARCIAL'
         ELSE 'PENDIENTE'
       END AS estado_pago
FROM citas c
LEFT JOIN resoluciones_cita r ON r.cita_id = c.id
CROSS JOIN LATERAL (
  SELECT coalesce(r.monto_exigible, CASE WHEN c.estado = 'CANCELADA' THEN 0 ELSE coalesce(c.monto, 0) END) AS exigible,
         coalesce((SELECT sum(p.monto) FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO'), 0)::int AS pagado,
         coalesce(r.monto_devolucion, 0) AS devolucion
) x
WHERE (SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE'
  AND ((SELECT app_rol()) IS DISTINCT FROM 'PACIENTE' OR c.paciente_id IN (SELECT app_pacientes_plenos()));

CREATE OR REPLACE FUNCTION mi_equipo_tratante()
RETURNS TABLE (id uuid, nombre text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'mi_equipo_tratante: solo PACIENTE o RESPONSABLE con acceso vigente' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT u.id, u.nombre FROM usuarios u
  WHERE u.id IN (SELECT equipo_tratante_de(p.id)
                 FROM (SELECT app_paciente_id() AS id UNION SELECT pacientes_a_cargo()) p WHERE p.id IS NOT NULL)
  ORDER BY u.nombre;
END;
$$;

CREATE OR REPLACE FUNCTION datos_pago_profesional(p_cita_id uuid)
RETURNS TABLE(profesional_id uuid, rut bytea, banco bytea, tipo_cuenta bytea, numero_cuenta bytea, titular bytea)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_profesional uuid;
  v_paciente uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'datos_pago_profesional: solo PACIENTE o su adulto responsable' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.profesional_id, c.paciente_id INTO v_profesional, v_paciente FROM citas c
  WHERE c.id = p_cita_id AND c.paciente_id IN (SELECT app_pacientes_plenos()) AND c.estado = 'CONFIRMADA'
    AND (SELECT e.saldo FROM estado_pago_citas e WHERE e.cita_id = c.id) > 0;
  IF v_profesional IS NULL OR NOT cobro_directo(v_profesional) THEN
    RETURN;
  END IF;

  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), app_rol()::rol, v_paciente, 'datos_pago_profesional', 'DATOS_PAGO');

  RETURN QUERY
  SELECT d.usuario_id, d.rut, d.banco, d.tipo_cuenta, d.numero_cuenta, d.titular
  FROM profesional_datos_privados d WHERE d.usuario_id = v_profesional;
END;
$$;

CREATE OR REPLACE FUNCTION registrar_descarga_documento(p_token_hash text)
RETURNS TABLE (documento_id uuid, vencido boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_envio envios_documento%ROWTYPE;
  v_paciente uuid;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'Solo el paciente (o su adulto responsable) descarga sus documentos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT e.* INTO v_envio FROM envios_documento e JOIN documentos_clinicos d ON d.id = e.documento_id
  WHERE e.token_hash = p_token_hash AND d.paciente_id IN (SELECT app_pacientes_plenos());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enlace inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT d.paciente_id INTO v_paciente FROM documentos_clinicos d WHERE d.id = v_envio.documento_id;
  IF v_envio.expira_en <= now() THEN
    RETURN QUERY SELECT v_envio.documento_id, true;
    RETURN;
  END IF;
  INSERT INTO descargas_documento (documento_id, envio_id, usuario_id)
  VALUES (v_envio.documento_id, v_envio.id, app_usuario_id());
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), app_rol()::rol, v_paciente, 'documentos_clinicos', 'DESCARGA');
  RETURN QUERY SELECT v_envio.documento_id, false;
END;
$$;

CREATE OR REPLACE FUNCTION solicitar_adjunto_documento(p_documento_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_solicitado timestamptz;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('PACIENTE', 'RESPONSABLE') THEN
    RAISE EXCEPTION 'Solo el paciente (o su adulto responsable) pide el documento adjunto' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT adjunto_solicitado_en INTO v_solicitado FROM documentos_clinicos
  WHERE id = p_documento_id AND paciente_id IN (SELECT app_pacientes_plenos()) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_solicitado IS NOT NULL THEN
    RAISE EXCEPTION 'El adjunto ya fue solicitado' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE documentos_clinicos SET adjunto_solicitado_en = now() WHERE id = p_documento_id;
END;
$$;

-- =============================================================================
-- 5. Agenda: cita SOLICITADA (C-15), horario del centro y de cada box, lista
--    de espera y solicitud de hora sin cuenta (D-2, D-3, C-15).
-- =============================================================================

-- SOLICITADA retiene el horario igual que CONFIRMADA (fuente de verdad: EXCLUDE).
ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_espacio;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_espacio
  EXCLUDE USING gist (espacio_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'SOLICITADA') AND modalidad = 'PRESENCIAL');
ALTER TABLE citas DROP CONSTRAINT citas_no_solapamiento_profesional;
ALTER TABLE citas ADD CONSTRAINT citas_no_solapamiento_profesional
  EXCLUDE USING gist (profesional_id WITH =, tstzrange(inicio, fin, '[)') WITH &&)
  WHERE (estado IN ('CONFIRMADA', 'SOLICITADA'));

-- horario_centro / horarios_espacio (B): minutos locales; sin filas = sin restriccion.
ALTER TABLE horario_centro ADD CONSTRAINT horario_centro_valido
  CHECK (dia_semana BETWEEN 1 AND 7 AND inicio_min >= 0 AND fin_min <= 1440 AND inicio_min < fin_min);
ALTER TABLE horarios_espacio ADD CONSTRAINT horarios_espacio_valido
  CHECK (dia_semana BETWEEN 1 AND 7 AND inicio_min >= 0 AND fin_min <= 1440 AND inicio_min < fin_min);
ALTER TABLE espacios ADD CONSTRAINT espacios_duracion_valida CHECK (duracion_defecto_min BETWEEN 10 AND 240);

-- Validacion de agenda: tambien SOLICITADA; ademas dentro del horario del
-- centro y, si es presencial, del box (cuando tienen horario definido).
CREATE OR REPLACE FUNCTION validar_agenda_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_dia date := (NEW.inicio AT TIME ZONE 'America/Santiago')::date;
BEGIN
  IF NEW.estado NOT IN ('CONFIRMADA', 'SOLICITADA') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM disponibilidad_profesional d
    WHERE d.profesional_id = NEW.profesional_id AND d.modalidad = NEW.modalidad
      AND d.dia_semana = extract(isodow FROM v_dia)
      AND NEW.inicio >= minuto_local(v_dia, d.inicio_min)
      AND NEW.fin <= minuto_local(v_dia, d.fin_min)
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
  IF EXISTS (SELECT 1 FROM horario_centro) AND NOT EXISTS (
    SELECT 1 FROM horario_centro h
    WHERE h.dia_semana = extract(isodow FROM v_dia)
      AND NEW.inicio >= minuto_local(v_dia, h.inicio_min) AND NEW.fin <= minuto_local(v_dia, h.fin_min)
  ) THEN
    RAISE EXCEPTION 'La cita cae fuera del horario de atencion del centro'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_horario_centro';
  END IF;
  IF NEW.modalidad = 'PRESENCIAL' AND EXISTS (SELECT 1 FROM horarios_espacio WHERE espacio_id = NEW.espacio_id)
     AND NOT EXISTS (
       SELECT 1 FROM horarios_espacio h
       WHERE h.espacio_id = NEW.espacio_id AND h.dia_semana = extract(isodow FROM v_dia)
         AND NEW.inicio >= minuto_local(v_dia, h.inicio_min) AND NEW.fin <= minuto_local(v_dia, h.fin_min)
  ) THEN
    RAISE EXCEPTION 'La cita cae fuera del horario de funcionamiento del box'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_dentro_de_horario_espacio';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER citas_agenda_valida ON citas;
CREATE TRIGGER citas_agenda_valida
  BEFORE INSERT OR UPDATE OF estado, inicio, fin, profesional_id, modalidad, espacio_id ON citas
  FOR EACH ROW EXECUTE FUNCTION validar_agenda_cita();

CREATE OR REPLACE FUNCTION validar_menor_con_adulto_responsable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fecha_nacimiento date;
BEGIN
  IF NEW.estado NOT IN ('CONFIRMADA', 'SOLICITADA') THEN
    RETURN NEW;
  END IF;

  SELECT fecha_nacimiento INTO v_fecha_nacimiento FROM pacientes WHERE id = NEW.paciente_id;

  IF age((NEW.inicio AT TIME ZONE 'America/Santiago')::date, v_fecha_nacimiento) < interval '18 years'
     AND NOT EXISTS (SELECT 1 FROM adultos_responsables WHERE paciente_id = NEW.paciente_id) THEN
    RAISE EXCEPTION 'Paciente menor de 18 sin adulto responsable registrado'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_menor_requiere_adulto_responsable';
  END IF;

  RETURN NEW;
END;
$$;

-- C-5: mover una cita a otro profesional exige que sea el tratante o tenga
-- acceso clinico temporal vigente en el horario de la cita ("Cubrir sesion").
CREATE FUNCTION validar_profesional_de_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pacientes WHERE id = NEW.paciente_id AND profesional_id = NEW.profesional_id)
     AND NOT EXISTS (SELECT 1 FROM accesos_clinicos_temporales a
                     WHERE a.paciente_id = NEW.paciente_id AND a.profesional_id = NEW.profesional_id
                       AND a.desde <= NEW.inicio AND a.hasta >= NEW.fin) THEN
    RAISE EXCEPTION 'El profesional no es el tratante ni tiene acceso clinico temporal en ese horario'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'citas_profesional_con_acceso';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER citas_profesional_con_acceso BEFORE UPDATE OF profesional_id ON citas
  FOR EACH ROW WHEN (OLD.profesional_id IS DISTINCT FROM NEW.profesional_id)
  EXECUTE FUNCTION validar_profesional_de_cita();

-- La aprueba el tratante, ADMIN o GESTION (C-15). Devuelve el paciente.
CREATE FUNCTION aprobar_cita_solicitada(p_cita_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c citas%ROWTYPE;
BEGIN
  SELECT * INTO c FROM citas WHERE id = p_cita_id FOR UPDATE;
  IF NOT FOUND OR NOT acceso_vigente()
     OR NOT (app_rol() IN ('ADMIN', 'GESTION') OR (app_rol() = 'PROFESIONAL' AND c.profesional_id = app_usuario_id())) THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF c.estado <> 'SOLICITADA' THEN
    RAISE EXCEPTION 'La cita no esta por aprobar' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE citas SET estado = 'CONFIRMADA', updated_at = now() WHERE id = p_cita_id;
  RETURN c.paciente_id;
END;
$$;

-- Invitacion de cuenta al confirmar la primera cita de un paciente del portal
-- (adulto: paciente; menor: su adulto responsable). Sin cuenta previa.
-- Interno (lo llaman concretar_solicitud_hora y la API tras aprobar).
CREATE FUNCTION invitar_paciente_del_portal(p_paciente_id uuid, p_hash bytea, p_expira timestamptz)
RETURNS TABLE (email text, rol rol)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  p pacientes%ROWTYPE;
  a adultos_responsables%ROWTYPE;
BEGIN
  SELECT * INTO p FROM pacientes WHERE id = p_paciente_id;
  IF NOT p.creado_por_solicitud OR EXISTS (SELECT 1 FROM usuarios u WHERE u.paciente_id = p.id) THEN
    RETURN;
  END IF;
  IF edad_paciente(p.id) >= 18 THEN
    IF p.email IS NULL OR EXISTS (SELECT 1 FROM usuarios u WHERE u.email = p.email) THEN
      RETURN;
    END IF;
    PERFORM emitir_token('INVITACION', p_hash, p_expira, NULL, p.id, NULL, NULL, 'PACIENTE', p.email);
    RETURN QUERY SELECT p.email, 'PACIENTE'::rol;
  ELSE
    SELECT * INTO a FROM adultos_responsables WHERE paciente_id = p.id AND email IS NOT NULL AND usuario_id IS NULL
    ORDER BY created_at LIMIT 1;
    IF a.id IS NULL THEN
      RETURN;
    END IF;
    PERFORM emitir_token('INVITACION', p_hash, p_expira, NULL, p.id, a.id, NULL, 'RESPONSABLE', a.email);
    RETURN QUERY SELECT a.email, 'RESPONSABLE'::rol;
  END IF;
END;
$$;

-- Tras aprobar (la API pide la invitacion con contexto del que aprobo).
CREATE FUNCTION invitar_tras_aprobar(p_cita_id uuid, p_hash bytea, p_expira timestamptz)
RETURNS TABLE (email text, rol rol)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_paciente uuid;
BEGIN
  SELECT paciente_id INTO v_paciente FROM citas WHERE id = p_cita_id AND estado = 'CONFIRMADA'
    AND (app_rol() IN ('ADMIN', 'GESTION') OR (app_rol() = 'PROFESIONAL' AND profesional_id = app_usuario_id()));
  IF v_paciente IS NULL OR NOT acceso_vigente() THEN
    RAISE EXCEPTION 'Cita inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN QUERY SELECT * FROM invitar_paciente_del_portal(v_paciente, p_hash, p_expira);
END;
$$;

-- ---------------------------------------------------------------------------
-- Disponibilidad publica: SOLICITADA ocupa; el profesional por rol (incluye
-- ADMIN/GESTION con PROFESIONAL); solo dentro del horario del centro.
-- ---------------------------------------------------------------------------
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
    SELECT d.modalidad AS m,
           tstzrange(minuto_local(x.dia, d.inicio_min), minuto_local(x.dia, d.fin_min), '[)') AS r
    FROM dias x
    JOIN disponibilidad_profesional d ON d.profesional_id = p_profesional_id AND d.dia_semana = extract(isodow FROM x.dia)
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
    WHERE c.estado IN ('CONFIRMADA', 'SOLICITADA') AND c.espacio_id IS NOT NULL
      AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(desde, hasta, '[)')
    UNION ALL
    SELECT b.espacio_id, b.inicio, b.fin FROM bloqueos_temporales b
    WHERE b.expira_en > now() AND b.espacio_id IS NOT NULL
      AND tstzrange(b.inicio, b.fin, '[)') && tstzrange(desde, hasta, '[)')
  ) o
  ORDER BY o.espacio_id, o.inicio;
END;
$$;

-- Box libre para una cita presencial (activo, sin citas ni retenciones, dentro de su horario).
CREATE FUNCTION espacio_libre(p_inicio timestamptz, p_fin timestamptz) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id FROM espacios e
  WHERE e.activo
    AND NOT EXISTS (SELECT 1 FROM citas c WHERE c.espacio_id = e.id AND c.estado IN ('CONFIRMADA', 'SOLICITADA')
                    AND tstzrange(c.inicio, c.fin, '[)') && tstzrange(p_inicio, p_fin, '[)'))
    AND NOT EXISTS (SELECT 1 FROM bloqueos_temporales b WHERE b.espacio_id = e.id AND b.expira_en > now()
                    AND tstzrange(b.inicio, b.fin, '[)') && tstzrange(p_inicio, p_fin, '[)'))
    AND (NOT EXISTS (SELECT 1 FROM horarios_espacio h WHERE h.espacio_id = e.id)
         OR EXISTS (SELECT 1 FROM horarios_espacio h
                    WHERE h.espacio_id = e.id
                      AND h.dia_semana = extract(isodow FROM (p_inicio AT TIME ZONE 'America/Santiago')::date)
                      AND p_inicio >= minuto_local((p_inicio AT TIME ZONE 'America/Santiago')::date, h.inicio_min)
                      AND p_fin <= minuto_local((p_inicio AT TIME ZONE 'America/Santiago')::date, h.fin_min)))
  ORDER BY e.nombre LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- Lista de espera (A).
-- ---------------------------------------------------------------------------
ALTER TABLE lista_espera ADD CONSTRAINT lista_espera_coherente
  CHECK ((profesional_id IS NOT NULL OR tipo_atencion_id IS NOT NULL)
         AND (estado = 'ACTIVA') = (cerrada_en IS NULL)
         AND (preferencias IS NULL OR length(preferencias) <= 500));

ALTER TABLE lista_espera ENABLE ROW LEVEL SECURITY;
ALTER TABLE lista_espera FORCE ROW LEVEL SECURITY;
CREATE POLICY lista_espera_select ON lista_espera FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND (profesional_id = (SELECT app_usuario_id())
                                                     OR es_profesional_de_paciente(paciente_id)))
         OR paciente_id = (SELECT app_paciente_id())
         OR paciente_id IN (SELECT pacientes_a_cargo()));
CREATE POLICY lista_espera_insert ON lista_espera FOR INSERT TO app_user
  WITH CHECK (estado = 'ACTIVA' AND creada_por_id = (SELECT app_usuario_id())
              AND ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
                   OR ((SELECT app_rol()) = 'PROFESIONAL' AND es_profesional_de_paciente(paciente_id))
                   OR paciente_id = (SELECT app_paciente_id())
                   OR paciente_id IN (SELECT pacientes_a_cargo())));
CREATE POLICY lista_espera_update ON lista_espera FOR UPDATE TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND (profesional_id = (SELECT app_usuario_id())
                                                     OR es_profesional_de_paciente(paciente_id)))
         OR paciente_id = (SELECT app_paciente_id())
         OR paciente_id IN (SELECT pacientes_a_cargo()))
  WITH CHECK (true);
GRANT SELECT, INSERT ON lista_espera TO app_user;
GRANT UPDATE (estado, cerrada_en) ON lista_espera TO app_user;

-- Hora liberada: al cancelar, pasar a reprogramar o mover una cita futura, la
-- BD avisa a la lista de espera del profesional y de los tipos de atencion
-- que atiende (aprobados). Sin autor (como los avisos de derivacion).
CREATE FUNCTION avisar_hora_liberada() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l record;
BEGIN
  IF OLD.inicio <= now() THEN
    RETURN NULL;
  END IF;
  FOR l IN
    SELECT le.id, le.paciente_id FROM lista_espera le
    WHERE le.estado = 'ACTIVA' AND le.paciente_id <> OLD.paciente_id
      AND (le.profesional_id = OLD.profesional_id
           OR (le.profesional_id IS NULL AND le.tipo_atencion_id IN (
                 SELECT pt.tipo_atencion_id FROM profesional_tipos_atencion pt
                 WHERE pt.profesional_id = OLD.profesional_id AND pt.estado = 'APROBADO')))
    FOR UPDATE OF le SKIP LOCKED
  LOOP
    PERFORM encolar_notificacion('HORA_LIBERADA', l.paciente_id, NULL, l.id, NULL);
    UPDATE lista_espera SET avisada_en = now() WHERE id = l.id;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER citas_hora_liberada AFTER UPDATE OF estado, inicio, fin ON citas
  FOR EACH ROW
  WHEN (OLD.estado IN ('CONFIRMADA', 'SOLICITADA')
        AND (NEW.estado NOT IN ('CONFIRMADA', 'SOLICITADA') OR NEW.inicio IS DISTINCT FROM OLD.inicio))
  EXECUTE FUNCTION avisar_hora_liberada();

-- ---------------------------------------------------------------------------
-- Solicitud de hora sin cuenta. Sin GRANT: todo via funciones (sin contexto).
-- ---------------------------------------------------------------------------
ALTER TABLE solicitudes_hora ADD CONSTRAINT solicitudes_hora_coherente
  CHECK (fin > inicio AND fin - inicio <= interval '4 hours'
         AND (modalidad = 'PRESENCIAL') = (espacio_id IS NOT NULL)
         AND btrim(nombre) <> '' AND btrim(apellido) <> '' AND btrim(email) <> ''
         AND (rut IS NULL) = (rut_hmac IS NULL)
         AND (estado = 'CONCRETADA') = (paciente_id IS NOT NULL AND concretada_en IS NOT NULL));
ALTER TABLE solicitudes_hora ADD CONSTRAINT solicitudes_hora_cifrado
  CHECK (octet_length(telefono) >= 49 AND octet_length(rut) >= 49 AND octet_length(rut_hmac) = 32
         AND octet_length(adulto_telefono) >= 49 AND octet_length(respuestas) >= 49);
ALTER TABLE solicitudes_hora ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_hora FORCE ROW LEVEL SECURITY;

-- La retencion de una solicitud no tiene usuario.
ALTER TABLE bloqueos_temporales ADD CONSTRAINT bloqueos_temporales_dueno
  CHECK (usuario_id IS NOT NULL OR solicitud_id IS NOT NULL);

-- Crea la solicitud, retiene el horario (minutos_retencion_solicitud) y deja
-- el token de verificacion del correo. Datos cifrados por la API con el id.
CREATE FUNCTION crear_solicitud_hora(
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
    v_espacio := espacio_libre(p_inicio, p_fin);
    IF v_espacio IS NULL THEN
      RAISE EXCEPTION 'No hay box disponible en ese horario' USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'solicitudes_hora_sin_box';
    END IF;
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

-- Datos de la solicitud de un token vigente (sin consumirlo): la API descifra
-- y vuelve a cifrar con el id del paciente antes de concretarla.
CREATE FUNCTION datos_solicitud_hora(p_token_hash bytea) RETURNS SETOF solicitudes_hora
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  SELECT s.* FROM tokens_correo t JOIN solicitudes_hora s ON s.id = t.referencia_id
  WHERE t.token_hash = p_token_hash AND t.tipo = 'VERIFICACION_SOLICITUD' AND t.usado_en IS NULL
    AND t.expira_en > now() AND s.estado = 'PENDIENTE_VERIFICACION';
END;
$$;

-- Verificar el correo concreta la solicitud: paciente (id de la API), ficha,
-- adulto responsable, aceptaciones, cita CONFIRMADA (o SOLICITADA si el
-- profesional aprueba pacientes nuevos), lista de espera e invitacion.
CREATE FUNCTION concretar_solicitud_hora(
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
  IF s.estado <> 'PENDIENTE_VERIFICACION' OR s.expira_en <= now() THEN
    RAISE EXCEPTION 'La solicitud vencio: pida la hora de nuevo' USING ERRCODE = 'object_not_in_prerequisite_state';
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
                   THEN 'SOLICITADA' ELSE 'CONFIRMADA' END;
  INSERT INTO citas (espacio_id, modalidad, profesional_id, paciente_id, inicio, fin, estado)
  VALUES (s.espacio_id, s.modalidad, s.profesional_id, p_paciente_id, s.inicio, s.fin, v_estado)
  RETURNING id INTO v_cita;
  IF s.lista_espera THEN
    INSERT INTO lista_espera (paciente_id, profesional_id, preferencias) VALUES (p_paciente_id, s.profesional_id, 'Desde el portal');
  END IF;
  UPDATE solicitudes_hora SET estado = 'CONCRETADA', paciente_id = p_paciente_id, cita_id = v_cita, concretada_en = now()
  WHERE id = s.id;

  IF v_estado = 'CONFIRMADA' THEN
    PERFORM encolar_notificacion('CITA_CONFIRMADA', p_paciente_id, NULL, v_cita, NULL);
    IF p_invitacion_hash IS NOT NULL THEN
      SELECT i.email, i.rol INTO v_inv_email, v_inv_rol
      FROM invitar_paciente_del_portal(p_paciente_id, p_invitacion_hash, p_invitacion_expira) i;
    END IF;
  ELSE
    PERFORM encolar_notificacion('SOLICITUD_HORA', NULL, s.profesional_id, v_cita, NULL);
  END IF;

  RETURN QUERY
  SELECT p_paciente_id, v_cita, v_estado, s.modalidad, s.profesional_id, s.inicio, s.fin, v_inv_email, v_inv_rol,
         sv.modo, sv.enlace
  FROM (SELECT 1) x LEFT JOIN salas_videollamada sv ON s.modalidad = 'ONLINE' AND sv.usuario_id = s.profesional_id;
END;
$$;

-- Enlace de videollamada de la cita recien concretada (misma transaccion).
CREATE FUNCTION guardar_enlace_solicitud(p_cita_id uuid, p_enlace bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE citas SET enlace_online = p_enlace
  WHERE id = p_cita_id AND modalidad = 'ONLINE' AND enlace_online IS NULL
    AND EXISTS (SELECT 1 FROM solicitudes_hora s WHERE s.cita_id = p_cita_id AND s.concretada_en = now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no recien concretada' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- Respuestas del match del paciente (D-6): solo su tratante (o acceso
-- temporal); se registra la lectura en accesos_ficha.
CREATE FUNCTION respuestas_match_paciente(p_paciente_id uuid)
RETURNS TABLE (solicitud_id uuid, respuestas bytea, creada_en timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR NOT (es_profesional_de_paciente(p_paciente_id) OR acceso_temporal_vigente(p_paciente_id, false))
     OR (app_rol() = 'PRACTICANTE' AND NOT consentimiento_practicante_vigente(p_paciente_id)) THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), app_rol()::rol, p_paciente_id, 'respuestas_match', 'LECTURA');
  RETURN QUERY SELECT s.id, s.respuestas, s.creada_en FROM solicitudes_hora s
  WHERE s.paciente_id = p_paciente_id AND s.respuestas IS NOT NULL ORDER BY s.creada_en DESC;
END;
$$;

-- Job (sin contexto): vence retenciones, borra respuestas de solicitudes no
-- concretadas (dias_retencion_respuestas_match) y elimina solicitudes
-- vencidas pasado ese plazo (minimizacion de datos). Idempotente.
CREATE FUNCTION limpiar_solicitudes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_dias int := (SELECT dias_retencion_respuestas_match FROM configuracion_centro);
  v_n int := 0;
  v_m int;
BEGIN
  IF app_usuario_id() IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH vencidas AS (
    UPDATE solicitudes_hora SET estado = 'EXPIRADA'
    WHERE estado = 'PENDIENTE_VERIFICACION' AND expira_en <= now() RETURNING id
  )
  DELETE FROM bloqueos_temporales b USING vencidas v WHERE b.solicitud_id = v.id;
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

-- =============================================================================
-- 6. Perfil publico, imagenes, contenido del centro, modulos y match
--    configurable (D-5, D-7). Practicantes fuera del equipo publico (C-3).
-- =============================================================================

-- Perfil (A+C): prevision, convenios, idiomas y cita destacada (D-7).
ALTER TABLE profesionales ADD CONSTRAINT profesionales_perfil_extendido
  CHECK (coalesce(array_length(convenios, 1), 0) <= 20 AND coalesce(array_length(idiomas, 1), 0) <= 10
         AND (cita_destacada IS NULL OR length(cita_destacada) <= 300));

-- Perfiles publicos: solo con rol PROFESIONAL (principal o adicional; nunca
-- PRACTICANTE), con trayectoria verificada, años de experiencia derivados del
-- titulo verificado mas antiguo y reseñas publicadas (promedio y cantidad).
DROP FUNCTION perfiles_publicos();
CREATE FUNCTION perfiles_publicos()
RETURNS TABLE (id uuid, nombre_publico text, bio text, foto_url text, especialidad text, enfoques text[],
               modalidad modalidad, tipos_atencion text[], verificado boolean, titulos_verificados text[], tarifas jsonb,
               trayectoria jsonb, anios_experiencia int, boleta_reembolsable boolean, convenios text[], idiomas text[],
               cita_destacada text, calificacion numeric, resenas int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.usuario_id, p.nombre_publico, p.bio, p.foto_url, p.especialidad, p.enfoques, p.modalidad,
         ARRAY(SELECT t.nombre FROM profesional_tipos_atencion pt JOIN tipos_atencion t ON t.id = pt.tipo_atencion_id
               WHERE pt.profesional_id = p.usuario_id AND pt.estado = 'APROBADO' AND t.activo ORDER BY t.nombre),
         EXISTS (SELECT 1 FROM profesional_trayectoria tr WHERE tr.profesional_id = p.usuario_id AND tr.verificado),
         ARRAY(SELECT tr.titulo FROM profesional_trayectoria tr
               WHERE tr.profesional_id = p.usuario_id AND tr.verificado ORDER BY tr.anio, tr.titulo),
         (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo_atencion', ta.nombre, 'modalidad', v.modalidad, 'monto', v.monto)
                                    ORDER BY ta.nombre NULLS FIRST, v.modalidad NULLS FIRST), '[]'::jsonb)
          FROM (SELECT DISTINCT ON (tf.tipo_atencion_id, tf.modalidad) tf.tipo_atencion_id, tf.modalidad, tf.monto
                FROM tarifas tf
                WHERE tf.profesional_id = p.usuario_id AND tf.vigente_desde <= now()
                ORDER BY tf.tipo_atencion_id, tf.modalidad, tf.vigente_desde DESC, tf.created_at DESC) v
          LEFT JOIN tipos_atencion ta ON ta.id = v.tipo_atencion_id),
         (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo', tr.tipo, 'titulo', tr.titulo, 'institucion', tr.institucion,
                                                       'anio', tr.anio) ORDER BY tr.anio DESC, tr.titulo), '[]'::jsonb)
          FROM profesional_trayectoria tr WHERE tr.profesional_id = p.usuario_id AND tr.verificado),
         (SELECT extract(year FROM now())::int - min(tr.anio) FROM profesional_trayectoria tr
          WHERE tr.profesional_id = p.usuario_id AND tr.verificado AND tr.tipo = 'TITULO'),
         p.boleta_reembolsable, coalesce(p.convenios, '{}'), coalesce(p.idiomas, '{}'), p.cita_destacada,
         (SELECT round(avg(r.calificacion), 1) FROM resenas r WHERE r.profesional_id = p.usuario_id AND r.estado = 'PUBLICADA'),
         (SELECT count(*)::int FROM resenas r WHERE r.profesional_id = p.usuario_id AND r.estado = 'PUBLICADA')
  FROM profesionales p JOIN usuarios u ON u.id = p.usuario_id
  WHERE p.perfil_publico AND tiene_rol(u.id, 'PROFESIONAL')
    AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM roles_adicionales ra WHERE ra.usuario_id = u.id AND ra.rol = 'PROFESIONAL'
                    AND ra.fecha_baja IS NOT NULL)
  ORDER BY p.nombre_publico
$$;

-- Directorio: roles de cada cuenta (para el selector de equipo y candidatos).
DROP FUNCTION directorio_interno();
CREATE FUNCTION directorio_interno()
RETURNS TABLE(id uuid, nombre text, rol rol, roles text[], tipos_atencion text[], email text, telefono bytea)
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
         ARRAY(SELECT u.rol::text UNION ALL
               SELECT r.rol::text FROM roles_adicionales r WHERE r.usuario_id = u.id AND r.activo),
         ARRAY(SELECT t.nombre FROM profesional_tipos_atencion pt JOIN tipos_atencion t ON t.id = pt.tipo_atencion_id
               WHERE pt.profesional_id = u.id AND pt.estado = 'APROBADO' AND t.activo ORDER BY t.nombre),
         CASE WHEN v_contacto THEN u.email END,
         CASE WHEN v_contacto THEN u.telefono END
  FROM usuarios u
  WHERE u.activo AND u.rol::text NOT IN ('PACIENTE', 'RESPONSABLE')
    AND (v_rol <> 'PRACTICANTE' OR u.id = supervisor_vigente(app_usuario_id()))
  ORDER BY u.nombre;
END;
$$;

-- Candidatos de derivacion y supervisores: por rol (principal o adicional).
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
       OR NOT coalesce(tiene_rol(u.id, 'PROFESIONAL')
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

CREATE OR REPLACE FUNCTION validar_supervision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF rol_usuario(NEW.practicante_id) IS DISTINCT FROM 'PRACTICANTE' OR NOT tiene_rol(NEW.supervisor_id, 'PROFESIONAL') THEN
    RAISE EXCEPTION 'Supervision invalida: practicante PRACTICANTE y supervisor PROFESIONAL activo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'supervisiones_roles_validos';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION motivo_reasignacion(p_paciente_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = t.id)
         OR EXISTS (SELECT 1 FROM roles_adicionales r WHERE r.usuario_id = t.id AND r.rol = 'PROFESIONAL'
                    AND r.fecha_baja IS NOT NULL) THEN 'BAJA'
    WHEN t.rol::text = 'PRACTICANTE' AND (NOT t.activo OR t.fecha_expiracion_acceso <= now()) THEN
      coalesce((SELECT CASE WHEN h.accion::text = 'REVOCADO' THEN 'ACCESO_REVOCADO' ELSE 'ACCESO_EXPIRADO' END
                FROM historial_accesos_practicante h WHERE h.practicante_id = t.id
                ORDER BY h.created_at DESC LIMIT 1), 'ACCESO_EXPIRADO')
    WHEN t.rol::text = 'PRACTICANTE' AND supervisor_vigente(t.id) IS NULL THEN 'SIN_SUPERVISION'
    WHEN t.rol::text = 'PRACTICANTE' AND NOT consentimiento_vigente_para(p.id, t.id) THEN 'CONSENTIMIENTO'
    WHEN NOT t.activo OR (t.rol::text <> 'PRACTICANTE' AND NOT tiene_rol(t.id, 'PROFESIONAL')) THEN 'TRATANTE_INACTIVO'
  END
  FROM pacientes p JOIN usuarios t ON t.id = p.profesional_id
  WHERE p.id = p_paciente_id AND p.deleted_at IS NULL
$$;

-- ---------------------------------------------------------------------------
-- Imagenes publicas (C): foto de perfil y logo. La API valida el contenido,
-- redimensiona y quita metadatos antes de insertar. Append-only.
-- ---------------------------------------------------------------------------
ALTER TABLE imagenes_publicas ADD CONSTRAINT imagenes_publicas_validas
  CHECK (tipo IN ('FOTO_PERFIL', 'LOGO') AND tipo_mime IN ('image/jpeg', 'image/png', 'image/webp')
         AND ancho BETWEEN 1 AND 1024 AND alto BETWEEN 1 AND 1024
         AND tamano_bytes = octet_length(contenido) AND tamano_bytes <= 1048576
         AND (tipo = 'LOGO' OR usuario_id IS NOT NULL));
CREATE TRIGGER imagenes_publicas_append_only BEFORE UPDATE OR DELETE ON imagenes_publicas
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();
ALTER TABLE imagenes_publicas ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagenes_publicas FORCE ROW LEVEL SECURITY;
CREATE POLICY imagenes_publicas_select ON imagenes_publicas FOR SELECT TO app_user USING (true);
CREATE POLICY imagenes_publicas_insert ON imagenes_publicas FOR INSERT TO app_user
  WITH CHECK ((tipo = 'FOTO_PERFIL' AND usuario_id = (SELECT app_usuario_id())
               AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE', 'ADMIN', 'GESTION'))
              OR (SELECT app_rol()) = 'ADMIN');
GRANT SELECT, INSERT ON imagenes_publicas TO app_user;

CREATE FUNCTION imagen_publica(p_id uuid) RETURNS TABLE (tipo_mime text, contenido bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.tipo_mime, i.contenido FROM imagenes_publicas i WHERE i.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Contenido publico del centro (C): una fila; edita ADMIN.
-- ---------------------------------------------------------------------------
ALTER TABLE contenido_publico ADD CONSTRAINT contenido_publico_una_fila CHECK (id);
ALTER TABLE contenido_publico ADD CONSTRAINT contenido_publico_valido
  CHECK (jsonb_typeof(servicios) = 'array' AND jsonb_array_length(servicios) <= 12
         AND (color_marca IS NULL OR color_marca ~ '^#[0-9A-Fa-f]{6}$')
         AND length(coalesce(hero_texto, '') || coalesce(mision, '') || coalesce(vision, '')) <= 6000);
INSERT INTO contenido_publico (id) VALUES (true);
ALTER TABLE contenido_publico ENABLE ROW LEVEL SECURITY;
ALTER TABLE contenido_publico FORCE ROW LEVEL SECURITY;
CREATE POLICY contenido_publico_select ON contenido_publico FOR SELECT TO app_user USING (true);
CREATE POLICY contenido_publico_update ON contenido_publico FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
GRANT SELECT ON contenido_publico TO app_user;
GRANT UPDATE (hero_titulo, hero_texto, servicios, contacto_correo, contacto_telefono, direccion, whatsapp, instagram,
              mision, vision, color_marca, logo_imagen_id, updated_at) ON contenido_publico TO app_user;

-- Modulos contratados: solo el operador los cambia (sin GRANT UPDATE a la API).
-- Dependencias: Match requiere Equipo; Cobros requiere Agenda.
ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_modulos_coherentes
  CHECK (modulos_activos IS NOT NULL
         AND (NOT 'MATCH' = ANY (modulos_activos) OR 'EQUIPO' = ANY (modulos_activos))
         AND (NOT 'COBROS' = ANY (modulos_activos) OR 'AGENDA' = ANY (modulos_activos)));
ALTER TABLE configuracion_centro ADD CONSTRAINT configuracion_centro_portal_valido
  CHECK (dias_retencion_respuestas_match BETWEEN 1 AND 365 AND minutos_retencion_solicitud BETWEEN 5 AND 120);
GRANT UPDATE (liquidar_exige_evolucion, match_filtro_directo, dias_retencion_respuestas_match, minutos_retencion_solicitud)
  ON configuracion_centro TO app_user;

CREATE FUNCTION modulos_activos() RETURNS modulo_centro[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT modulos_activos FROM configuracion_centro
$$;

-- Portal publico (sin contexto): contenido, nombre, modulos y opciones del match.
CREATE FUNCTION contenido_publico_centro() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(cp) - 'id' || jsonb_build_object(
           'nombre_centro', cc.nombre_centro, 'modulos', to_jsonb(cc.modulos_activos),
           'match_filtro_directo', cc.match_filtro_directo,
           'plazo_aviso_cancelacion_horas', cc.plazo_aviso_cancelacion_horas,
           'penalizacion_cancelacion_porcentaje', cc.penalizacion_cancelacion_porcentaje,
           'cobro_inasistencia_porcentaje', cc.cobro_inasistencia_porcentaje,
           'modelo_cobro', cc.modelo_cobro)
  FROM contenido_publico cp CROSS JOIN configuracion_centro cc
$$;

-- ---------------------------------------------------------------------------
-- Match configurable (B, D-5): reglas, sin IA. ADMIN edita; nunca DELETE.
-- ---------------------------------------------------------------------------
ALTER TABLE match_preguntas ADD CONSTRAINT match_preguntas_validas
  CHECK (btrim(texto) <> '' AND length(texto) <= 300 AND clave ~ '^[a-z0-9_]{1,40}$'
         AND (max_selecciones IS NULL OR max_selecciones >= 1));
ALTER TABLE match_opciones ADD CONSTRAINT match_opciones_validas
  CHECK (btrim(etiqueta) <> '' AND length(etiqueta) <= 120 AND peso BETWEEN -100 AND 100
         AND (criterio IS NULL) = (objetivo IS NULL) AND (NOT estricto OR criterio IS NOT NULL));
ALTER TABLE match_preguntas ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_preguntas FORCE ROW LEVEL SECURITY;
ALTER TABLE match_opciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_opciones FORCE ROW LEVEL SECURITY;
CREATE POLICY match_preguntas_select ON match_preguntas FOR SELECT TO app_user USING (true);
CREATE POLICY match_preguntas_admin ON match_preguntas FOR INSERT TO app_user WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY match_preguntas_update ON match_preguntas FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY match_opciones_select ON match_opciones FOR SELECT TO app_user USING (true);
CREATE POLICY match_opciones_admin ON match_opciones FOR INSERT TO app_user WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY match_opciones_update ON match_opciones FOR UPDATE TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
GRANT SELECT, INSERT ON match_preguntas, match_opciones TO app_user;
GRANT UPDATE (texto, ayuda, orden, activa, obligatoria, max_selecciones, updated_at) ON match_preguntas TO app_user;
GRANT UPDATE (etiqueta, nota, orden, activa, criterio, objetivo, peso, estricto, mensaje) ON match_opciones TO app_user;

-- Cuestionario activo (sin contexto) para el portal publico.
CREATE FUNCTION cuestionario_match() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'clave', q.clave, 'texto', q.texto, 'ayuda', q.ayuda, 'tipo', q.tipo, 'obligatoria', q.obligatoria,
           'max_selecciones', q.max_selecciones,
           'opciones', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                 'valor', o.valor, 'etiqueta', o.etiqueta, 'nota', o.nota, 'criterio', o.criterio,
                                 'objetivo', o.objetivo, 'peso', o.peso, 'estricto', o.estricto, 'mensaje', o.mensaje)
                               ORDER BY o.orden), '[]'::jsonb)
                        FROM match_opciones o WHERE o.pregunta_id = q.id AND o.activa))
         ORDER BY q.orden), '[]'::jsonb)
  FROM match_preguntas q WHERE q.activa
$$;

-- Cuestionario de ejemplo (el del diseño, sin el paso de contacto: C-17).
-- Criterios: ENFOQUE/ESPECIALIDAD comparan con el perfil (sin mayusculas),
-- TIPO_ATENCION con los tipos aprobados, MODALIDAD y PREVISION (FONASA =
-- convenio FONASA; ISAPRE = boleta reembolsable o convenio de isapre).
INSERT INTO match_preguntas (clave, texto, ayuda, tipo, orden, max_selecciones) VALUES
  ('motivos', '¿Qué te trae al centro?', 'Marca todo lo que sientas que te está pasando. Puedes elegir varios.', 'MULTIPLE', 1, NULL),
  ('quien', '¿Para quién es la atención?', 'El equipo se organiza por edad y tipo de proceso.', 'UNICA', 2, 1),
  ('intensidad', '¿Qué tan fuerte lo sientes?', 'Piensa en las últimas dos semanas y en el motivo que más te pesa.', 'ESCALA', 3, 1),
  ('relato', 'Cuéntanos con tus palabras', 'No hace falta que sea largo ni ordenado. Lo lee solo el profesional que te atienda.', 'TEXTO', 4, NULL),
  ('dias', '¿Qué días puedes venir?', 'Elige hasta tres días.', 'DIAS', 5, 3),
  ('franjas', '¿En qué horario?', 'Elige hasta tres franjas.', 'FRANJAS', 6, 3),
  ('prevision', 'Previsión de salud', 'Te mostramos profesionales con los que efectivamente puedes atenderte.', 'UNICA', 7, 1),
  ('modalidad', 'Modalidad de atención', NULL, 'UNICA', 8, 1);
INSERT INTO match_opciones (pregunta_id, valor, etiqueta, nota, orden, criterio, objetivo, peso, estricto, mensaje)
SELECT q.id, o.valor, o.etiqueta, o.nota, o.orden, o.criterio::criterio_match, o.objetivo, o.peso, o.estricto, o.mensaje
FROM match_preguntas q JOIN (VALUES
  ('motivos', 'ansiedad', 'Ansiedad', NULL, 1, 'ENFOQUE', 'ansiedad', 3, false, NULL),
  ('motivos', 'estres', 'Estrés', NULL, 2, 'ENFOQUE', 'estrés', 3, false, NULL),
  ('motivos', 'animo', 'Ánimo bajo', NULL, 3, 'ENFOQUE', 'ánimo', 3, false, NULL),
  ('motivos', 'duelo', 'Duelo', NULL, 4, 'ENFOQUE', 'duelo', 3, false, NULL),
  ('motivos', 'sueno', 'Problemas de sueño', NULL, 5, 'ENFOQUE', 'sueño', 3, false, NULL),
  ('motivos', 'pareja', 'Conflictos de pareja', NULL, 6, 'ENFOQUE', 'pareja', 3, false, NULL),
  ('motivos', 'familia', 'Dinámica familiar', NULL, 7, 'ENFOQUE', 'familia', 3, false, NULL),
  ('motivos', 'trabajo', 'Trabajo o estudios', NULL, 8, 'ENFOQUE', 'trabajo', 2, false, NULL),
  ('motivos', 'autoestima', 'Autoestima', NULL, 9, 'ENFOQUE', 'autoestima', 2, false, NULL),
  ('motivos', 'conducta', 'Conducta de un hijo o hija', NULL, 10, 'ENFOQUE', 'conducta', 3, false, NULL),
  ('quien', 'adulto', 'Para mí', 'Persona adulta', 1, 'TIPO_ATENCION', 'Adultos', 5, true, NULL),
  ('quien', 'adolescente', 'Adolescente', 'Entre 14 y 17 años', 2, 'TIPO_ATENCION', 'Adolescentes', 5, true, NULL),
  ('quien', 'infantil', 'Niño o niña', 'Hasta los 13 años', 3, 'TIPO_ATENCION', 'Niños', 5, true, NULL),
  ('quien', 'pareja', 'En pareja', 'Sesiones de a dos', 4, 'TIPO_ATENCION', 'Parejas', 5, true, NULL),
  ('intensidad', '2', 'Apenas lo noto', 'Con orientación breve suele bastar.', 1, NULL, NULL, 0, false, NULL),
  ('intensidad', '4', 'Me molesta a ratos', 'Aparece en momentos puntuales.', 2, NULL, NULL, 0, false, NULL),
  ('intensidad', '6', 'Me afecta bastante', 'Está presente la mayoría de los días.', 3, NULL, NULL, 0, false, NULL),
  ('intensidad', '8', 'Me cuesta seguir el día', 'Interfiere con tu trabajo, estudios o relaciones.', 4, NULL, NULL, 0, false, NULL),
  ('intensidad', '10', 'Me supera', NULL, 5, NULL, NULL, 0, false,
   'Si estás en riesgo, llama a Salud Responde al 600 360 7777, disponible las 24 horas.'),
  ('dias', '1', 'Lunes', NULL, 1, NULL, NULL, 0, false, NULL),
  ('dias', '2', 'Martes', NULL, 2, NULL, NULL, 0, false, NULL),
  ('dias', '3', 'Miércoles', NULL, 3, NULL, NULL, 0, false, NULL),
  ('dias', '4', 'Jueves', NULL, 4, NULL, NULL, 0, false, NULL),
  ('dias', '5', 'Viernes', NULL, 5, NULL, NULL, 0, false, NULL),
  ('dias', '6', 'Sábado', NULL, 6, NULL, NULL, 0, false, NULL),
  ('franjas', '480-720', 'Mañana', '08:00 – 12:00', 1, NULL, NULL, 0, false, NULL),
  ('franjas', '720-900', 'Mediodía', '12:00 – 15:00', 2, NULL, NULL, 0, false, NULL),
  ('franjas', '900-1140', 'Tarde', '15:00 – 19:00', 3, NULL, NULL, 0, false, NULL),
  ('franjas', '1140-1260', 'Noche', '19:00 – 21:00', 4, NULL, NULL, 0, false, NULL),
  ('prevision', 'fonasa', 'FONASA', NULL, 1, 'PREVISION', 'FONASA', 3, true, NULL),
  ('prevision', 'isapre', 'Isapre', NULL, 2, 'PREVISION', 'ISAPRE', 3, true, NULL),
  ('prevision', 'particular', 'Particular', NULL, 3, NULL, NULL, 0, false, NULL),
  ('modalidad', 'online', 'Online', NULL, 1, 'MODALIDAD', 'ONLINE', 3, true, NULL),
  ('modalidad', 'presencial', 'Presencial', NULL, 2, 'MODALIDAD', 'PRESENCIAL', 3, true, NULL),
  ('modalidad', 'indistinto', 'Sin preferencia', NULL, 3, NULL, NULL, 0, false, NULL)
) AS o(clave, valor, etiqueta, nota, orden, criterio, objetivo, peso, estricto, mensaje) ON o.clave = q.clave;
UPDATE match_preguntas SET obligatoria = false WHERE clave IN ('dias', 'franjas');

-- Resultado anonimo (C-17: el match no guarda respuestas): solo el recomendado.
ALTER TABLE match_resultados ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_resultados FORCE ROW LEVEL SECURITY;
CREATE FUNCTION registrar_resultado_match(p_profesional_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO match_resultados (profesional_id) VALUES (p_profesional_id)
$$;

-- Metricas del match (ADMIN): completados, mas recomendados y coincidencias que agendaron.
CREATE FUNCTION metricas_match(p_dias int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_desde timestamptz := now() - make_interval(days => greatest(coalesce(p_dias, 30), 1));
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'metricas_match: solo ADMIN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'completados', (SELECT count(*) FROM match_resultados WHERE creado_en >= v_desde),
    'ranking', (SELECT coalesce(jsonb_agg(jsonb_build_object('profesional_id', x.profesional_id, 'nombre', x.nombre,
                                                             'recomendaciones', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                FROM (SELECT m.profesional_id, coalesce(p.nombre_publico, u.nombre) AS nombre, count(*) AS n
                      FROM match_resultados m JOIN usuarios u ON u.id = m.profesional_id
                      LEFT JOIN profesionales p ON p.usuario_id = u.id
                      WHERE m.creado_en >= v_desde GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10) x),
    'solicitudes_con_match', (SELECT count(*) FROM solicitudes_hora WHERE creada_en >= v_desde AND recomendado_id IS NOT NULL),
    'agendaron_con_recomendado', (SELECT count(*) FROM solicitudes_hora WHERE creada_en >= v_desde AND estado = 'CONCRETADA'
                                  AND recomendado_id = profesional_id));
END;
$$;

-- =============================================================================
-- 7. Reseñas (D-1). Una por paciente y profesional, con al menos una sesion
--    realizada; el autor (paciente adulto o adulto responsable) la edita
--    (vuelve a moderacion) o la retira. ADMIN modera antes de publicar y
--    oculta con motivo; cualquiera la reporta; todo queda en resenas_eventos.
--    Feedback privado: solo el profesional (ADMIN modera sin verlo). Se
--    eliminan con la baja del profesional.
-- =============================================================================

ALTER TABLE resenas ADD CONSTRAINT resenas_coherente
  CHECK (calificacion BETWEEN 1 AND 5 AND octet_length(texto) >= 49 AND octet_length(feedback_privado) >= 49
         AND (estado <> 'OCULTA' OR coalesce(btrim(motivo_ocultamiento), '') <> '')
         AND (moderada_en IS NULL) = (moderada_por_id IS NULL));
ALTER TABLE resenas_reportes ADD CONSTRAINT resenas_reportes_motivo CHECK (btrim(motivo) <> '' AND length(motivo) <= 500);
CREATE TRIGGER resenas_eventos_append_only BEFORE UPDATE OR DELETE ON resenas_eventos
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();

-- Sesion realizada: CONFIRMADA ya terminada y sin decision de inasistencia (tambien la usa Cobros, C-11).
CREATE FUNCTION cita_realizada(p_cita_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM citas c WHERE c.id = p_cita_id AND c.estado = 'CONFIRMADA' AND c.fin <= now()
                 AND NOT EXISTS (SELECT 1 FROM resoluciones_cita r WHERE r.cita_id = c.id AND r.decision = 'INASISTENCIA'))
$$;

CREATE FUNCTION registrar_evento_resena(p_resena_id uuid, p_accion text, p_motivo text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO resenas_eventos (resena_id, accion, actor_id, rol, motivo) VALUES (p_resena_id, p_accion, app_usuario_id(), app_rol(), p_motivo)
$$;

-- Autor valido para el paciente: el paciente adulto o el adulto responsable de un menor.
CREATE FUNCTION puede_resenar(p_paciente_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT acceso_vigente() AND p_paciente_id IN (SELECT app_pacientes_plenos())
$$;

-- texto y feedback llegan cifrados por la API con p_id (AAD resenas:<columna>:<id>).
CREATE FUNCTION crear_resena(p_id uuid, p_paciente_id uuid, p_profesional_id uuid, p_calificacion int, p_texto bytea,
                             p_feedback bytea, p_mostrar mostrar_resena) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT puede_resenar(p_paciente_id) THEN
    RAISE EXCEPTION 'Reseña el paciente adulto o su adulto responsable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id = p_paciente_id AND c.profesional_id = p_profesional_id
                 AND cita_realizada(c.id)) THEN
    RAISE EXCEPTION 'Solo con al menos una sesion realizada con ese profesional'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'resenas_requiere_sesion';
  END IF;
  INSERT INTO resenas (id, paciente_id, profesional_id, autor_id, calificacion, texto, feedback_privado, mostrar_como)
  VALUES (p_id, p_paciente_id, p_profesional_id, app_usuario_id(), p_calificacion, p_texto, p_feedback,
          coalesce(p_mostrar, 'ANONIMO'));
  PERFORM registrar_evento_resena(p_id, 'CREADA', NULL);
END;
$$;

-- Editar vuelve a moderacion (PENDIENTE). Solo el autor.
CREATE FUNCTION editar_resena(p_id uuid, p_calificacion int, p_texto bytea, p_feedback bytea, p_mostrar mostrar_resena)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r resenas%ROWTYPE;
BEGIN
  SELECT * INTO r FROM resenas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.autor_id IS DISTINCT FROM app_usuario_id() OR NOT puede_resenar(r.paciente_id) THEN
    RAISE EXCEPTION 'Reseña inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.estado = 'RETIRADA' THEN
    RAISE EXCEPTION 'La reseña fue retirada' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE resenas SET calificacion = p_calificacion, texto = p_texto, feedback_privado = p_feedback,
                     mostrar_como = coalesce(p_mostrar, mostrar_como), estado = 'PENDIENTE', motivo_ocultamiento = NULL,
                     moderada_por_id = NULL, moderada_en = NULL, editada_en = now()
  WHERE id = p_id;
  PERFORM registrar_evento_resena(p_id, 'EDITADA', NULL);
END;
$$;

CREATE FUNCTION retirar_resena(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE resenas SET estado = 'RETIRADA' WHERE id = p_id AND autor_id = app_usuario_id() AND estado <> 'RETIRADA'
    AND puede_resenar(paciente_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reseña inexistente o ya retirada' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM registrar_evento_resena(p_id, 'RETIRADA', NULL);
END;
$$;

-- ADMIN: publicar u ocultar (con motivo).
CREATE FUNCTION moderar_resena(p_id uuid, p_publicar boolean, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN modera' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE resenas SET estado = CASE WHEN p_publicar THEN 'PUBLICADA' ELSE 'OCULTA' END::estado_resena,
                     motivo_ocultamiento = CASE WHEN p_publicar THEN NULL ELSE p_motivo END,
                     moderada_por_id = app_usuario_id(), moderada_en = now()
  WHERE id = p_id AND estado <> 'RETIRADA';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reseña inexistente o retirada' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM registrar_evento_resena(p_id, CASE WHEN p_publicar THEN 'PUBLICADA' ELSE 'OCULTA' END, p_motivo);
END;
$$;

-- Reporte publico (sin contexto) de una reseña publicada.
CREATE FUNCTION reportar_resena(p_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM resenas WHERE id = p_id AND estado = 'PUBLICADA') THEN
    RAISE EXCEPTION 'Reseña inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO resenas_reportes (resena_id, motivo) VALUES (p_id, p_motivo);
  INSERT INTO resenas_eventos (resena_id, accion, motivo) VALUES (p_id, 'REPORTADA', p_motivo);
END;
$$;

-- Cola de moderacion (ADMIN): sin el feedback privado; con reportes.
CREATE FUNCTION resenas_para_moderar()
RETURNS TABLE (id uuid, profesional_id uuid, calificacion int, texto bytea, mostrar_como mostrar_resena, estado estado_resena,
               motivo_ocultamiento text, creada_en timestamptz, editada_en timestamptz, reportes jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente() OR app_rol() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'Solo ADMIN modera' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT r.id, r.profesional_id, r.calificacion::int, r.texto, r.mostrar_como, r.estado, r.motivo_ocultamiento, r.creada_en,
         r.editada_en,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('motivo', x.motivo, 'creado_en', x.creado_en) ORDER BY x.creado_en), '[]')
          FROM resenas_reportes x WHERE x.resena_id = r.id)
  FROM resenas r WHERE r.estado <> 'RETIRADA'
  ORDER BY (r.estado = 'PENDIENTE') DESC, r.creada_en;
END;
$$;

-- Publicas (sin contexto): "Nombre + inicial" o "Usuario anonimo".
CREATE FUNCTION resenas_publicas(p_profesional_id uuid)
RETURNS TABLE (id uuid, calificacion int, texto bytea, autor text, creada_en timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.calificacion::int, r.texto,
         CASE WHEN r.mostrar_como = 'NOMBRE_INICIAL' THEN p.nombre || ' ' || left(p.apellido, 1) || '.' ELSE 'Usuario anónimo' END,
         coalesce(r.editada_en, r.creada_en)
  FROM resenas r JOIN pacientes p ON p.id = r.paciente_id
  WHERE r.profesional_id = p_profesional_id AND r.estado = 'PUBLICADA'
  ORDER BY coalesce(r.editada_en, r.creada_en) DESC
$$;

-- resenas (A): leen el autor y el profesional (incluye su feedback privado).
-- ADMIN solo via resenas_para_moderar. Escritura solo via funciones.
ALTER TABLE resenas ENABLE ROW LEVEL SECURITY;
ALTER TABLE resenas FORCE ROW LEVEL SECURITY;
ALTER TABLE resenas_reportes ENABLE ROW LEVEL SECURITY;
ALTER TABLE resenas_reportes FORCE ROW LEVEL SECURITY;
ALTER TABLE resenas_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE resenas_eventos FORCE ROW LEVEL SECURITY;
CREATE POLICY resenas_select ON resenas FOR SELECT TO app_user
  USING (autor_id = (SELECT app_usuario_id())
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND profesional_id = (SELECT app_usuario_id())));
CREATE POLICY resenas_eventos_select ON resenas_eventos FOR SELECT TO app_user USING ((SELECT app_rol()) = 'ADMIN');
GRANT SELECT ON resenas, resenas_eventos TO app_user;

-- =============================================================================
-- 8. Clinica: acceso temporal (C-4, C-5), borradores (C-8), cierre de la
--    sesion (evolucion con cita), RUT del paciente del portal (D-2), alta,
--    contacto de emergencia.
-- =============================================================================

-- Contacto de emergencia (cifrado, IDENTIFICACION): lo editan ADMIN/GESTION y el tratante (pacientes_update).
ALTER TABLE pacientes ADD CONSTRAINT pacientes_contacto_emergencia_cifrado CHECK (octet_length(contacto_emergencia) >= 49);
-- posible_duplicado: ADMIN/GESTION marcan revisado (pacientes_update).
GRANT UPDATE (contacto_emergencia, posible_duplicado) ON pacientes TO app_user;

-- ---------------------------------------------------------------------------
-- Acceso clinico temporal (A, append-only): REEMPLAZO o INTERCONSULTA, con
-- alcance y termino; se corta solo al vencer. Otorgan ADMIN o el tratante
-- (PROFESIONAL); avisa al paciente (aviso legal) y se audita.
-- ---------------------------------------------------------------------------
ALTER TABLE accesos_clinicos_temporales ADD CONSTRAINT accesos_clinicos_temporales_validos
  CHECK (hasta > desde AND hasta <= desde + interval '180 days');
CREATE TRIGGER accesos_clinicos_temporales_append_only BEFORE UPDATE OR DELETE ON accesos_clinicos_temporales
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();

CREATE FUNCTION otorgar_acceso_temporal(p_paciente_id uuid, p_profesional_id uuid, p_motivo motivo_acceso_temporal,
                                        p_alcance alcance_acceso_temporal, p_desde timestamptz, p_hasta timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_tratante uuid;
BEGIN
  SELECT profesional_id INTO v_tratante FROM pacientes WHERE id = p_paciente_id;
  IF NOT acceso_vigente() OR v_tratante IS NULL
     OR NOT (app_rol() = 'ADMIN' OR (app_rol() = 'PROFESIONAL' AND v_tratante = app_usuario_id())) THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_profesional_id = v_tratante OR NOT tiene_rol(p_profesional_id, 'PROFESIONAL') THEN
    RAISE EXCEPTION 'El acceso temporal es para otro PROFESIONAL activo'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'accesos_clinicos_temporales_validos';
  END IF;
  INSERT INTO accesos_clinicos_temporales (paciente_id, profesional_id, motivo, alcance, desde, hasta, otorgado_por_id)
  VALUES (p_paciente_id, p_profesional_id, p_motivo, p_alcance, greatest(coalesce(p_desde, now()), now()), p_hasta,
          app_usuario_id())
  RETURNING id INTO v_id;
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), app_rol()::rol, p_paciente_id, 'accesos_clinicos_temporales', 'ACCESO_TEMPORAL');
  PERFORM encolar_notificacion('ACCESO_CLINICO_TEMPORAL', p_paciente_id, NULL, v_id, app_usuario_id());
  RETURN v_id;
END;
$$;

ALTER TABLE accesos_clinicos_temporales ENABLE ROW LEVEL SECURITY;
ALTER TABLE accesos_clinicos_temporales FORCE ROW LEVEL SECURITY;
CREATE POLICY accesos_clinicos_temporales_select ON accesos_clinicos_temporales FOR SELECT TO app_user
  USING ((SELECT app_rol()) = 'ADMIN'
         OR ((SELECT app_rol()) = 'PROFESIONAL' AND (profesional_id = (SELECT app_usuario_id())
                                                     OR es_profesional_de_paciente(paciente_id))));
GRANT SELECT ON accesos_clinicos_temporales TO app_user;

-- Lectura (y escritura de evoluciones, si el alcance lo permite) con acceso temporal.
DROP POLICY fichas_clinicas_select ON fichas_clinicas;
CREATE POLICY fichas_clinicas_select ON fichas_clinicas FOR SELECT TO app_user
  USING (es_profesional_de_paciente(paciente_id) OR (SELECT app_rol()) = 'ADMIN' OR acceso_temporal_vigente(paciente_id, false));
DROP POLICY evoluciones_select ON evoluciones;
CREATE POLICY evoluciones_select ON evoluciones FOR SELECT TO app_user
  USING (es_profesional_de_ficha(ficha_clinica_id) OR acceso_temporal_ficha(ficha_clinica_id, false));
DROP POLICY evoluciones_insert ON evoluciones;
CREATE POLICY evoluciones_insert ON evoluciones FOR INSERT TO app_user
  WITH CHECK (autor_id = (SELECT app_usuario_id())
              AND (es_profesional_de_ficha(ficha_clinica_id) OR acceso_temporal_ficha(ficha_clinica_id, true)));
DROP POLICY adjuntos_ficha_select ON adjuntos_ficha;
CREATE POLICY adjuntos_ficha_select ON adjuntos_ficha FOR SELECT TO app_user
  USING (es_profesional_de_paciente(paciente_id) OR acceso_temporal_vigente(paciente_id, false));

-- Evolucion que cierra una sesion: la cita es del mismo paciente. Paciente
-- llegado por el portal: RUT registrado antes de su primera evolucion (D-2).
CREATE FUNCTION validar_evolucion_cita() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_paciente uuid := (SELECT paciente_id FROM fichas_clinicas WHERE id = NEW.ficha_clinica_id);
BEGIN
  IF NEW.cita_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM citas WHERE id = NEW.cita_id AND paciente_id = v_paciente) THEN
    RAISE EXCEPTION 'La sesion no es de este paciente' USING ERRCODE = 'check_violation', CONSTRAINT = 'evoluciones_cita_del_paciente';
  END IF;
  IF NEW.corrige_a_id IS NULL
     AND EXISTS (SELECT 1 FROM pacientes WHERE id = v_paciente AND creado_por_solicitud AND rut IS NULL) THEN
    RAISE EXCEPTION 'Registre el RUT del paciente antes de su primera evolucion'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'evoluciones_paciente_requiere_rut';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evoluciones_cita_valida BEFORE INSERT ON evoluciones
  FOR EACH ROW EXECUTE FUNCTION validar_evolucion_cita();

-- ---------------------------------------------------------------------------
-- Borradores de evolucion (A): fuera de la ficha, solo su autor (tratante o
-- con acceso temporal de escritura). Se confirman (pasan a evolucion) o se
-- descartan; aqui si hay DELETE porque no son parte de la ficha.
-- ---------------------------------------------------------------------------
ALTER TABLE borradores_evolucion ADD CONSTRAINT borradores_evolucion_cifrado CHECK (octet_length(contenido) >= 49);
CREATE FUNCTION tocar_borrador() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  NEW.autor_id := OLD.autor_id;
  NEW.ficha_clinica_id := OLD.ficha_clinica_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER borradores_evolucion_actualizado BEFORE UPDATE ON borradores_evolucion
  FOR EACH ROW EXECUTE FUNCTION tocar_borrador();
ALTER TABLE borradores_evolucion ENABLE ROW LEVEL SECURITY;
ALTER TABLE borradores_evolucion FORCE ROW LEVEL SECURITY;
CREATE POLICY borradores_evolucion_autor ON borradores_evolucion FOR ALL TO app_user
  USING (autor_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE')
         AND (es_profesional_de_ficha(ficha_clinica_id) OR acceso_temporal_ficha(ficha_clinica_id, true)))
  WITH CHECK (autor_id = (SELECT app_usuario_id()) AND (SELECT app_rol()) IN ('PROFESIONAL', 'PRACTICANTE')
              AND (es_profesional_de_ficha(ficha_clinica_id) OR acceso_temporal_ficha(ficha_clinica_id, true)));
CREATE POLICY borradores_evolucion_consentimiento_practicante ON borradores_evolucion AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR ficha_clinica_id IN (SELECT id FROM fichas_clinicas))
  WITH CHECK ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR ficha_clinica_id IN (SELECT id FROM fichas_clinicas));
GRANT SELECT, INSERT, DELETE ON borradores_evolucion TO app_user;
GRANT UPDATE (contenido, cita_id) ON borradores_evolucion TO app_user;

-- ---------------------------------------------------------------------------
-- Alta del paciente (A, append-only): el tratante, con fecha y motivo
-- cifrado. La ficha se conserva; borra las respuestas del match (D-6) y
-- cierra su lista de espera.
-- ---------------------------------------------------------------------------
ALTER TABLE altas_paciente ADD CONSTRAINT altas_paciente_cifrado CHECK (octet_length(motivo) >= 49);
CREATE TRIGGER altas_paciente_append_only BEFORE UPDATE OR DELETE ON altas_paciente
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_registro();
ALTER TABLE altas_paciente ENABLE ROW LEVEL SECURITY;
ALTER TABLE altas_paciente FORCE ROW LEVEL SECURITY;
CREATE POLICY altas_paciente_select ON altas_paciente FOR SELECT TO app_user
  USING (es_profesional_de_paciente(paciente_id) OR acceso_temporal_vigente(paciente_id, false));
CREATE POLICY altas_paciente_consentimiento_practicante ON altas_paciente AS RESTRICTIVE FOR ALL TO app_user
  USING ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id))
  WITH CHECK ((SELECT app_rol()) IS DISTINCT FROM 'PRACTICANTE' OR consentimiento_practicante_vigente(paciente_id));
GRANT SELECT ON altas_paciente TO app_user;

CREATE FUNCTION registrar_alta(p_id uuid, p_paciente_id uuid, p_fecha date, p_motivo bytea) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente() OR NOT es_profesional_de_paciente(p_paciente_id)
     OR (app_rol() = 'PRACTICANTE' AND NOT consentimiento_practicante_vigente(p_paciente_id)) THEN
    RAISE EXCEPTION 'Paciente inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_fecha IS NULL OR p_fecha > (now() AT TIME ZONE 'America/Santiago')::date THEN
    RAISE EXCEPTION 'La fecha de alta no puede ser futura' USING ERRCODE = 'check_violation', CONSTRAINT = 'altas_paciente_fecha';
  END IF;
  INSERT INTO altas_paciente (id, paciente_id, fecha, motivo, registrada_por_id)
  VALUES (p_id, p_paciente_id, p_fecha, p_motivo, app_usuario_id());
  UPDATE solicitudes_hora SET respuestas = NULL WHERE paciente_id = p_paciente_id AND respuestas IS NOT NULL;
  UPDATE lista_espera SET estado = 'CANCELADA', cerrada_en = now() WHERE paciente_id = p_paciente_id AND estado = 'ACTIVA';
  INSERT INTO accesos_ficha (usuario_id, rol, paciente_id, recurso, accion)
  VALUES (app_usuario_id(), app_rol()::rol, p_paciente_id, 'altas_paciente', 'ESCRITURA');
END;
$$;

-- ---------------------------------------------------------------------------
-- Cobros (C-11): la liquidacion cuenta citas REALIZADAS del periodo (por la
-- fecha de la cita), sin depender de la ficha; opcional del centro: exigir
-- evolucion registrada (solo el dato si/no). Lo cobrado de citas no
-- realizadas (inasistencias) queda en el centro.
-- ---------------------------------------------------------------------------
CREATE FUNCTION cita_liquidable(p_cita_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cita_realizada(p_cita_id)
         AND (NOT (SELECT liquidar_exige_evolucion FROM configuracion_centro)
              OR EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = p_cita_id))
$$;

CREATE OR REPLACE FUNCTION generar_liquidacion(p_profesional_id uuid, p_desde date, p_hasta date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cobrado int;
  v_pct numeric(5,2);
  v_comision int;
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
  SELECT coalesce(sum(p.monto), 0) INTO v_cobrado
  FROM pagos p JOIN citas c ON c.id = p.cita_id
  WHERE c.profesional_id = p_profesional_id AND p.estado = 'REGISTRADO' AND p.cobrado_por = 'CENTRO'
    AND (c.inicio AT TIME ZONE 'America/Santiago')::date >= p_desde
    AND (c.inicio AT TIME ZONE 'America/Santiago')::date < p_hasta
    AND cita_liquidable(c.id);
  SELECT comision_centro_porcentaje INTO v_pct FROM configuracion_centro;
  v_comision := round(greatest(v_cobrado, 0) * v_pct / 100);
  SELECT coalesce(sum(monto), 0) INTO v_arriendos FROM arriendos
  WHERE profesional_id = p_profesional_id AND periodo_desde >= p_desde AND periodo_desde < p_hasta;

  SELECT id, estado INTO v_id, v_estado FROM liquidaciones
  WHERE profesional_id = p_profesional_id AND periodo_desde = p_desde AND periodo_hasta = p_hasta FOR UPDATE;
  IF v_estado IS NOT NULL AND v_estado <> 'BORRADOR' THEN
    RAISE EXCEPTION 'La liquidacion del periodo ya fue emitida' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO liquidaciones (profesional_id, periodo_desde, periodo_hasta, total_cobrado, comision_porcentaje, comision,
                               arriendos, total, creada_por_id)
    VALUES (p_profesional_id, p_desde, p_hasta, v_cobrado, v_pct, v_comision, v_arriendos,
            v_cobrado - v_comision - v_arriendos, app_usuario_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE liquidaciones SET total_cobrado = v_cobrado, comision_porcentaje = v_pct, comision = v_comision,
                             arriendos = v_arriendos, total = v_cobrado - v_comision - v_arriendos
    WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- Un pago de una cita de un periodo ya liquidado (emitido) no se anula.
CREATE OR REPLACE FUNCTION anular_pago(p_pago_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pago pagos%ROWTYPE;
  v_cita citas%ROWTYPE;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION') THEN
    RAISE EXCEPTION 'Solo ADMIN/GESTION anulan pagos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF btrim(coalesce(p_motivo, '')) = '' THEN
    RAISE EXCEPTION 'Anular exige motivo' USING ERRCODE = 'check_violation', CONSTRAINT = 'pagos_anulacion_coherente';
  END IF;
  SELECT * INTO v_pago FROM pagos WHERE id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_cita FROM citas WHERE id = v_pago.cita_id;
  IF v_pago.estado <> 'REGISTRADO'
     OR EXISTS (SELECT 1 FROM boletas WHERE cita_id = v_pago.cita_id)
     OR EXISTS (SELECT 1 FROM liquidaciones l WHERE l.profesional_id = v_cita.profesional_id AND l.estado <> 'BORRADOR'
                AND (v_cita.inicio AT TIME ZONE 'America/Santiago')::date >= l.periodo_desde
                AND (v_cita.inicio AT TIME ZONE 'America/Santiago')::date < l.periodo_hasta) THEN
    RAISE EXCEPTION 'El pago ya esta anulado, tiene boleta o esta liquidado'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE pagos SET estado = 'ANULADO', anulado_en = now(), anulado_por_id = app_usuario_id(), motivo_anulacion = btrim(p_motivo)
  WHERE id = p_pago_id;
END;
$$;

-- =============================================================================
-- 9. Reportes por rol (agregados, sin datos clinicos para ADMIN/GESTION),
--    avisos nuevos, bajas (rol y borradores), GRANTs.
-- =============================================================================

-- Dashboard por rol. ADMIN/GESTION: agregados del centro; PROFESIONAL y
-- PRACTICANTE: los suyos. Nunca contenido clinico (fichas por cerrar es un
-- conteo de citas realizadas sin evolucion vinculada: metadata).
CREATE FUNCTION reporte_dashboard() RETURNS jsonb
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

  SELECT coalesce(sum(extract(epoch FROM upper(r) - lower(r)) / 60), 0) INTO v_minutos_box
  FROM (SELECT tstzrange(minuto_local(v_hoy, coalesce(h.inicio_min, hc.inicio_min, 540)),
                         minuto_local(v_hoy, coalesce(h.fin_min, hc.fin_min, 1200)), '[)') AS r
        FROM espacios e
        LEFT JOIN horarios_espacio h ON h.espacio_id = e.id AND h.dia_semana = extract(isodow FROM v_hoy)
        LEFT JOIN horario_centro hc ON h.id IS NULL AND hc.dia_semana = extract(isodow FROM v_hoy)
        WHERE e.activo) x;
  SELECT coalesce(sum(extract(epoch FROM c.fin - c.inicio) / 60), 0) INTO v_minutos_ocupados
  FROM citas c WHERE c.estado = 'CONFIRMADA' AND c.modalidad = 'PRESENCIAL' AND c.inicio >= v_ini AND c.inicio < v_fin;

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
    'ocupacion_boxes_hoy', CASE WHEN v_minutos_box > 0 THEN round(100 * v_minutos_ocupados / v_minutos_box) ELSE 0 END,
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

-- Estado administrativo de las fichas de un profesional (vista administrativa):
-- ultima y proxima sesion y sesiones sin cerrar. ADMIN/GESTION o el propio.
CREATE FUNCTION estado_fichas_profesional(p_profesional_id uuid)
RETURNS TABLE (paciente_id uuid, ultima_sesion timestamptz, proxima_sesion timestamptz, sesiones_sin_cerrar int,
               alta_en date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT acceso_vigente()
     OR NOT (app_rol() IN ('ADMIN', 'GESTION') OR (app_rol() IN ('PROFESIONAL', 'PRACTICANTE') AND p_profesional_id = app_usuario_id())) THEN
    RAISE EXCEPTION 'estado_fichas_profesional: ADMIN/GESTION o el propio' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT p.id,
         (SELECT max(c.inicio) FROM citas c WHERE c.paciente_id = p.id AND c.estado = 'CONFIRMADA' AND c.inicio < now()),
         (SELECT min(c.inicio) FROM citas c WHERE c.paciente_id = p.id AND c.estado IN ('CONFIRMADA', 'SOLICITADA')
          AND c.inicio >= now()),
         (SELECT count(*)::int FROM citas c WHERE c.paciente_id = p.id AND c.profesional_id = p_profesional_id
          AND cita_realizada(c.id) AND NOT EXISTS (SELECT 1 FROM evoluciones e WHERE e.cita_id = c.id)),
         (SELECT max(a.fecha) FROM altas_paciente a WHERE a.paciente_id = p.id)
  FROM pacientes p WHERE p.profesional_id = p_profesional_id AND p.deleted_at IS NULL;
END;
$$;

-- Cobros por profesional y periodo (citas por fecha de inicio). ADMIN/GESTION
-- todos; PROFESIONAL los suyos. Sesiones = realizadas; cobrado = pagos
-- registrados; pendiente = saldo de las realizadas. Mas la distribucion por medio.
CREATE FUNCTION reporte_cobros(p_desde date, p_hasta date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ini timestamptz := p_desde::timestamp AT TIME ZONE 'America/Santiago';
  v_fin timestamptz := p_hasta::timestamp AT TIME ZONE 'America/Santiago';
  v_solo uuid := CASE WHEN app_rol() = 'PROFESIONAL' THEN app_usuario_id() END;
BEGIN
  IF NOT acceso_vigente() OR app_rol() NOT IN ('ADMIN', 'GESTION', 'PROFESIONAL') THEN
    RAISE EXCEPTION 'reporte_cobros: ADMIN, GESTION o el propio profesional' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta <= p_desde OR p_hasta - p_desde > 366 THEN
    RAISE EXCEPTION 'Periodo invalido (maximo un año)' USING ERRCODE = 'check_violation', CONSTRAINT = 'reporte_cobros_periodo';
  END IF;
  RETURN jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'profesionales', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'profesional_id', x.profesional_id, 'nombre', x.nombre, 'sesiones', x.sesiones, 'cobrado', x.cobrado,
               'pendiente', x.pendiente, 'comision_estimada', round(x.cobrado * cc.comision_centro_porcentaje / 100))
             ORDER BY x.nombre), '[]'::jsonb)
      FROM (SELECT c.profesional_id, coalesce(pf.nombre_publico, u.nombre) AS nombre,
                   count(*) FILTER (WHERE cita_realizada(c.id)) AS sesiones,
                   coalesce(sum(e.pagado), 0) AS cobrado,
                   coalesce(sum(e.saldo) FILTER (WHERE cita_realizada(c.id)), 0) AS pendiente
            FROM citas c
            JOIN usuarios u ON u.id = c.profesional_id
            LEFT JOIN profesionales pf ON pf.usuario_id = u.id
            CROSS JOIN LATERAL (
              SELECT coalesce((SELECT sum(p.monto) FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO'), 0) AS pagado,
                     greatest(coalesce(r.monto_exigible, CASE WHEN c.estado = 'CANCELADA' THEN 0 ELSE coalesce(c.monto, 0) END)
                              - coalesce((SELECT sum(p.monto) FROM pagos p WHERE p.cita_id = c.id AND p.estado = 'REGISTRADO'), 0)
                              + coalesce(r.monto_devolucion, 0), 0) AS saldo
              FROM (SELECT 1) z LEFT JOIN resoluciones_cita r ON r.cita_id = c.id) e
            WHERE c.inicio >= v_ini AND c.inicio < v_fin AND (v_solo IS NULL OR c.profesional_id = v_solo)
            GROUP BY 1, 2) x
      CROSS JOIN configuracion_centro cc),
    'medios', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('medio', y.medio, 'pagos', y.n, 'monto', y.monto) ORDER BY y.n DESC), '[]'::jsonb)
      FROM (SELECT p.medio_pago AS medio, count(*) AS n, sum(p.monto) AS monto FROM pagos p JOIN citas c ON c.id = p.cita_id
            WHERE p.estado = 'REGISTRADO' AND c.inicio >= v_ini AND c.inicio < v_fin
              AND (v_solo IS NULL OR c.profesional_id = v_solo)
            GROUP BY 1) y));
END;
$$;

-- ---------------------------------------------------------------------------
-- Avisos nuevos: plantillas (BANDEJA y CORREO), categoria y datos del job.
-- ---------------------------------------------------------------------------
INSERT INTO plantillas_mensaje (evento, destinatario, canal, asunto, cuerpo, asunto_ejemplo, cuerpo_ejemplo)
SELECT e.evento::tipo_notificacion, e.destinatario::destinatario_mensaje, c.canal::canal_mensaje,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END,
       e.asunto, e.cuerpo || CASE WHEN c.canal = 'CORREO' THEN E'\n\n{{nombre_centro}}' ELSE '' END
FROM (VALUES
  ('HORA_LIBERADA', 'PACIENTE', 'Se liberó una hora',
   'Hola {{nombre_paciente}}: se liberó una hora con {{nombre_profesional}}. Si le acomoda, pídala en el portal: {{enlace}}'),
  ('ACCESO_CLINICO_TEMPORAL', 'PACIENTE', 'Aviso: acceso temporal a su ficha',
   'Hola {{nombre_paciente}}: {{nombre_profesional}} tendrá acceso temporal a su ficha (reemplazo o interconsulta) para continuar su atención. Detalle en el portal: {{enlace}}'),
  ('SOLICITUD_HORA', 'EQUIPO', 'Solicitud de hora por aprobar',
   'Hola {{nombre_profesional}}: un paciente nuevo pidió hora para el {{fecha}} a las {{hora}}. Apruébela o cancélela en el sistema: {{enlace}}'),
  ('CIERRE_REQUERIDO', 'EQUIPO', 'Ficha de sesión por cerrar',
   'Hola {{nombre_profesional}}: la sesión del {{fecha}} a las {{hora}} sigue sin evolución registrada. Ciérrela en el sistema: {{enlace}}')
) AS e(evento, destinatario, asunto, cuerpo)
CROSS JOIN (VALUES ('BANDEJA'), ('CORREO')) AS c(canal);

CREATE OR REPLACE FUNCTION categoria_evento(p_tipo tipo_notificacion) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_tipo IN ('CONSENTIMIENTO_SOLICITADO', 'CONSENTIMIENTO_POR_VENCER', 'AVISO_CAMBIO_SUPERVISOR', 'DOCUMENTO_CLINICO',
                    'ACCESO_CLINICO_TEMPORAL')
      THEN 'LEGAL'
    WHEN p_tipo = 'RECORDATORIO_CITA' THEN 'RECORDATORIO'
    ELSE 'OPERATIVO'
  END
$$;

-- La BD crea los de lista de espera y acceso temporal; la API pide CIERRE_REQUERIDO.
CREATE OR REPLACE FUNCTION notificar(p_tipo tipo_notificacion, p_paciente_id uuid, p_usuario_id uuid, p_referencia_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT acceso_vigente()
     OR p_tipo IN ('DERIVACION_OFRECIDA', 'DERIVACION_ACTUALIZADA', 'RECORDATORIO_CITA', 'CONSENTIMIENTO_POR_VENCER',
                   'HORA_LIBERADA', 'ACCESO_CLINICO_TEMPORAL', 'SOLICITUD_HORA') THEN
    RAISE EXCEPTION 'Aviso no permitido desde la API' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM encolar_notificacion(p_tipo, p_paciente_id, p_usuario_id, p_referencia_id, app_usuario_id());
END;
$$;

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
                             'CIERRE_REQUERIDO') THEN t.referencia_id
             WHEN t.tipo = 'RECORDATORIO_CITA' THEN (SELECT r.cita_id FROM recordatorios_cita r WHERE r.id = t.referencia_id)
             WHEN t.tipo = 'PAGO_REGISTRADO' THEN (SELECT pg.cita_id FROM pagos pg WHERE pg.id = t.referencia_id)
             WHEN t.tipo = 'BOLETA_EMITIDA' THEN (SELECT b.cita_id FROM boletas b WHERE b.id = t.referencia_id)
           END AS cita_id,
           CASE
             WHEN t.tipo = 'HORA_LIBERADA' THEN (SELECT le.profesional_id FROM lista_espera le WHERE le.id = t.referencia_id)
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

-- ---------------------------------------------------------------------------
-- Bajas: de cuenta (ahora tambien con rol PROFESIONAL adicional) y de rol.
-- Una baja cumplida no se completa mientras el profesional tenga borradores
-- sin confirmar (C-8): queda pendiente y se alerta a ADMIN. Las reseñas del
-- profesional se eliminan con su baja (D-1).
-- ---------------------------------------------------------------------------
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
  IF p_usuario_id = app_usuario_id() THEN
    RAISE EXCEPTION 'Nadie inicia su propia baja' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT rol::text, activo INTO v_rol, v_activo FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_rol IN ('PACIENTE', 'RESPONSABLE') OR p_fecha_efectiva IS NULL THEN
    RAISE EXCEPTION 'Baja solo para cuentas de equipo, con fecha efectiva'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bajas_validas';
  END IF;
  IF NOT v_activo THEN
    RAISE EXCEPTION 'El usuario ya esta inactivo' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_rol = 'ADMIN' THEN
    PERFORM 1 FROM configuracion_centro FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.rol = 'ADMIN' AND u.activo AND u.id <> p_usuario_id
                   AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)) THEN
      RAISE EXCEPTION 'No se da de baja al ultimo ADMIN activo'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'usuarios_ultimo_admin';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM supervisiones s JOIN usuarios u ON u.id = s.practicante_id
             WHERE s.supervisor_id = p_usuario_id AND u.activo
               AND s.desde <= now() AND (s.hasta IS NULL OR s.hasta > now())) THEN
    RAISE EXCEPTION 'Supervisa practicantes activos: cambiar su supervisor antes de la baja'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO bajas (usuario_id, fecha_efectiva, iniciada_por_id)
  VALUES (p_usuario_id, p_fecha_efectiva, app_usuario_id());
  IF v_rol IN ('PROFESIONAL', 'PRACTICANTE') OR tiene_rol(p_usuario_id, 'PROFESIONAL') THEN
    INSERT INTO bloqueos_agenda (profesional_id, inicio, fin, motivo)
    VALUES (p_usuario_id, p_fecha_efectiva, NULL, 'BAJA');
  END IF;

  UPDATE citas SET estado = 'POR_REPROGRAMAR', updated_at = now()
  WHERE profesional_id = p_usuario_id AND estado IN ('CONFIRMADA', 'SOLICITADA') AND inicio >= p_fecha_efectiva;
  GET DIAGNOSTICS v_citas = ROW_COUNT;
  RETURN v_citas;
END;
$$;

CREATE FUNCTION eliminar_resenas_de(p_profesional_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO resenas_eventos (resena_id, accion) SELECT id, 'ELIMINADA_POR_BAJA' FROM resenas WHERE profesional_id = p_profesional_id;
  DELETE FROM resenas WHERE profesional_id = p_profesional_id;
END;
$$;

CREATE OR REPLACE FUNCTION cerrar_cuenta(p_usuario_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM eliminar_resenas_de(p_usuario_id);
  DELETE FROM profesional_tipos_atencion WHERE profesional_id = p_usuario_id;
  DELETE FROM tarifas WHERE profesional_id = p_usuario_id;
  DELETE FROM disponibilidad_profesional WHERE profesional_id = p_usuario_id;
  DELETE FROM profesional_trayectoria WHERE profesional_id = p_usuario_id;
  DELETE FROM profesional_datos_privados WHERE usuario_id = p_usuario_id;
  DELETE FROM profesionales WHERE usuario_id = p_usuario_id;
  UPDATE roles_adicionales SET activo = false, desactivado_en = now() WHERE usuario_id = p_usuario_id AND activo;
  UPDATE usuarios
  SET nombre = NULL, email = NULL, password_hash = NULL, telefono = NULL, totp_secreto = NULL, totp_activo = false,
      cerrada_en = now(), updated_at = now()
  WHERE id = p_usuario_id AND NOT activo AND cerrada_en IS NULL;
END;
$$;

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
    SELECT b.id, b.usuario_id, b.fecha_efectiva FROM bajas b
    WHERE b.procesada_en IS NULL AND b.fecha_efectiva <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (SELECT 1 FROM borradores_evolucion WHERE autor_id = r.usuario_id) THEN
      INSERT INTO alertas_internas (tipo, referencia_id, detalle)
      VALUES ('BAJA_CON_BORRADORES', r.id, 'Baja cumplida sin procesar: el profesional tiene borradores de evolucion sin confirmar.')
      ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
      CONTINUE;
    END IF;
    BEGIN
      PERFORM desactivar_tratante(r.usuario_id, r.fecha_efectiva);
      UPDATE bajas SET procesada_en = now() WHERE id = r.id;
      PERFORM cerrar_cuenta(r.usuario_id);
      v_total := v_total + 1;
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;
  END LOOP;

  -- Baja de un rol adicional: lo desactiva (corta sus sesiones) y elimina sus reseñas.
  FOR r IN
    SELECT ra.usuario_id, ra.rol FROM roles_adicionales ra
    WHERE ra.activo AND ra.fecha_baja <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (SELECT 1 FROM borradores_evolucion WHERE autor_id = r.usuario_id) THEN
      INSERT INTO alertas_internas (tipo, referencia_id, detalle)
      VALUES ('BAJA_CON_BORRADORES', r.usuario_id, 'Baja de rol cumplida sin procesar: hay borradores de evolucion sin confirmar.')
      ON CONFLICT (tipo, referencia_id) WHERE atendida_en IS NULL DO NOTHING;
      CONTINUE;
    END IF;
    UPDATE roles_adicionales SET activo = false, desactivado_en = now() WHERE usuario_id = r.usuario_id AND rol = r.rol;
    PERFORM eliminar_resenas_de(r.usuario_id);
    v_total := v_total + 1;
  END LOOP;

  UPDATE citas c SET estado = 'POR_REPROGRAMAR', updated_at = now()
  FROM bajas b
  WHERE c.profesional_id = b.usuario_id AND c.estado IN ('CONFIRMADA', 'SOLICITADA') AND c.inicio >= b.fecha_efectiva;

  FOR r IN
    SELECT u.id FROM usuarios u
    WHERE u.rol::text <> 'PACIENTE' AND NOT u.activo AND u.cerrada_en IS NULL
      AND u.desactivado_en <= now() - make_interval(days => (SELECT dias_gracia_cierre FROM configuracion_centro))
      AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.usuario_id = u.id)
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM cerrar_cuenta(r.id);
  END LOOP;

  RETURN v_total;
END;
$$;

-- ---------------------------------------------------------------------------
-- Acceso vigente (RESTRICTIVE) en toda tabla nueva y permisos de funciones.
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['roles_adicionales', 'tokens_correo', 'politicas', 'aceptaciones_politica', 'solicitudes_hora',
                           'imagenes_publicas', 'contenido_publico', 'match_preguntas', 'match_opciones', 'match_resultados',
                           'resenas', 'resenas_reportes', 'resenas_eventos', 'altas_paciente', 'horario_centro',
                           'horarios_espacio', 'lista_espera', 'accesos_clinicos_temporales', 'borradores_evolucion'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO app_user
                    USING ((SELECT acceso_vigente())) WITH CHECK ((SELECT acceso_vigente()))', t || '_acceso_vigente', t);
  END LOOP;
END $$;

-- aceptaciones_politica (A): ADMIN/GESTION, el paciente adulto, el adulto responsable y el tratante.
CREATE POLICY aceptaciones_politica_select ON aceptaciones_politica FOR SELECT TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')
         OR paciente_id IN (SELECT app_pacientes_plenos())
         OR es_profesional_de_paciente(paciente_id));
GRANT SELECT ON aceptaciones_politica TO app_user;

-- horario_centro / horarios_espacio (B): todo el equipo lee; ADMIN edita el del
-- centro, ADMIN/GESTION el de los boxes (reemplazo completo: DELETE + INSERT).
ALTER TABLE horario_centro ENABLE ROW LEVEL SECURITY;
ALTER TABLE horario_centro FORCE ROW LEVEL SECURITY;
ALTER TABLE horarios_espacio ENABLE ROW LEVEL SECURITY;
ALTER TABLE horarios_espacio FORCE ROW LEVEL SECURITY;
CREATE POLICY horario_centro_select ON horario_centro FOR SELECT TO app_user USING (true);
CREATE POLICY horario_centro_admin ON horario_centro FOR ALL TO app_user
  USING ((SELECT app_rol()) = 'ADMIN') WITH CHECK ((SELECT app_rol()) = 'ADMIN');
CREATE POLICY horarios_espacio_select ON horarios_espacio FOR SELECT TO app_user USING (true);
CREATE POLICY horarios_espacio_gestion ON horarios_espacio FOR ALL TO app_user
  USING ((SELECT app_rol()) IN ('ADMIN', 'GESTION')) WITH CHECK ((SELECT app_rol()) IN ('ADMIN', 'GESTION'));
GRANT SELECT, INSERT, DELETE ON horario_centro, horarios_espacio TO app_user;

-- Funciones internas (sin EXECUTE para app_user).
REVOKE EXECUTE ON FUNCTION
  validar_rol_adicional(), revocar_sesiones_de_rol(), coherencia_roles_usuario(), consumir_token(bytea, tipo_token_correo),
  emitir_token(tipo_token_correo, bytea, timestamptz, uuid, uuid, uuid, uuid, rol, text), versionar_politica(),
  validar_profesional_de_cita(), invitar_paciente_del_portal(uuid, bytea, timestamptz), avisar_hora_liberada(),
  validar_evolucion_cita(), tocar_borrador(), registrar_evento_resena(uuid, text, text), eliminar_resenas_de(uuid)
FROM PUBLIC;

-- Llamadas desde la API (con o sin contexto segun la funcion; cada una valida).
REVOKE EXECUTE ON FUNCTION
  tiene_rol(uuid, text), roles_cuenta(uuid), cambiar_rol_sesion(bytea, bytea, rol, timestamptz),
  otorgar_rol_adicional(uuid, rol), iniciar_baja_rol(uuid, rol, timestamptz), edad_paciente(uuid),
  crear_token_recuperacion(text, bytea, timestamptz), usar_token_recuperacion(bytea, text),
  crear_token_acceso(text, bytea, timestamptz), usar_token_acceso(bytea),
  crear_invitacion_equipo(uuid, bytea, timestamptz), crear_invitacion_paciente(uuid, text, bytea, timestamptz),
  crear_invitacion_responsable(uuid, text, bytea, timestamptz), activar_invitacion(bytea, text, uuid),
  crear_token_cambio_correo(text, bytea, timestamptz), usar_token_cambio_correo(bytea), actualizar_telefono_paciente(bytea),
  credenciales_login_rut(bytea), segundo_factor(uuid), guardar_totp(uuid, bytea), activar_totp(uuid), reiniciar_totp(uuid),
  politica_vigente(tipo_politica), registrar_aceptacion(tipo_politica, uuid, uuid, text),
  crear_token_consentimiento(uuid, bytea, timestamptz), consultar_token_consentimiento(bytea),
  responder_token_consentimiento(bytea, boolean, text), pacientes_a_cargo(), app_pacientes_plenos(),
  acceso_temporal_vigente(uuid, boolean), acceso_temporal_ficha(uuid, boolean), equipo_tratante_de(uuid),
  aprobar_cita_solicitada(uuid), invitar_tras_aprobar(uuid, bytea, timestamptz), espacio_libre(timestamptz, timestamptz),
  crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea, bytea, bytea,
                       text, text, bytea, bytea, uuid, boolean, uuid, uuid, bytea),
  datos_solicitud_hora(bytea), concretar_solicitud_hora(bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz),
  guardar_enlace_solicitud(uuid, bytea), respuestas_match_paciente(uuid), limpiar_solicitudes(),
  perfiles_publicos(), directorio_interno(), imagen_publica(uuid), modulos_activos(), contenido_publico_centro(),
  cuestionario_match(), registrar_resultado_match(uuid), metricas_match(int), cita_realizada(uuid), puede_resenar(uuid),
  crear_resena(uuid, uuid, uuid, int, bytea, bytea, mostrar_resena), editar_resena(uuid, int, bytea, bytea, mostrar_resena),
  retirar_resena(uuid), moderar_resena(uuid, boolean, text), reportar_resena(uuid, text), resenas_para_moderar(),
  resenas_publicas(uuid), otorgar_acceso_temporal(uuid, uuid, motivo_acceso_temporal, alcance_acceso_temporal, timestamptz, timestamptz),
  registrar_alta(uuid, uuid, date, bytea), cita_liquidable(uuid), reporte_dashboard(), estado_fichas_profesional(uuid),
  reporte_cobros(date, date)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  tiene_rol(uuid, text), roles_cuenta(uuid), cambiar_rol_sesion(bytea, bytea, rol, timestamptz),
  otorgar_rol_adicional(uuid, rol), iniciar_baja_rol(uuid, rol, timestamptz), edad_paciente(uuid),
  crear_token_recuperacion(text, bytea, timestamptz), usar_token_recuperacion(bytea, text),
  crear_token_acceso(text, bytea, timestamptz), usar_token_acceso(bytea),
  crear_invitacion_equipo(uuid, bytea, timestamptz), crear_invitacion_paciente(uuid, text, bytea, timestamptz),
  crear_invitacion_responsable(uuid, text, bytea, timestamptz), activar_invitacion(bytea, text, uuid),
  crear_token_cambio_correo(text, bytea, timestamptz), usar_token_cambio_correo(bytea), actualizar_telefono_paciente(bytea),
  credenciales_login_rut(bytea), segundo_factor(uuid), guardar_totp(uuid, bytea), activar_totp(uuid), reiniciar_totp(uuid),
  politica_vigente(tipo_politica), registrar_aceptacion(tipo_politica, uuid, uuid, text),
  crear_token_consentimiento(uuid, bytea, timestamptz), consultar_token_consentimiento(bytea),
  responder_token_consentimiento(bytea, boolean, text), pacientes_a_cargo(), app_pacientes_plenos(),
  acceso_temporal_vigente(uuid, boolean), acceso_temporal_ficha(uuid, boolean), equipo_tratante_de(uuid),
  aprobar_cita_solicitada(uuid), invitar_tras_aprobar(uuid, bytea, timestamptz), espacio_libre(timestamptz, timestamptz),
  crear_solicitud_hora(uuid, uuid, modalidad_atencion, timestamptz, timestamptz, text, text, date, text, bytea, bytea, bytea,
                       text, text, bytea, bytea, uuid, boolean, uuid, uuid, bytea),
  datos_solicitud_hora(bytea), concretar_solicitud_hora(bytea, uuid, uuid, bytea, bytea, bytea, bytea, bytea, timestamptz),
  guardar_enlace_solicitud(uuid, bytea), respuestas_match_paciente(uuid), limpiar_solicitudes(),
  perfiles_publicos(), directorio_interno(), imagen_publica(uuid), modulos_activos(), contenido_publico_centro(),
  cuestionario_match(), registrar_resultado_match(uuid), metricas_match(int), cita_realizada(uuid), puede_resenar(uuid),
  crear_resena(uuid, uuid, uuid, int, bytea, bytea, mostrar_resena), editar_resena(uuid, int, bytea, bytea, mostrar_resena),
  retirar_resena(uuid), moderar_resena(uuid, boolean, text), reportar_resena(uuid, text), resenas_para_moderar(),
  resenas_publicas(uuid), otorgar_acceso_temporal(uuid, uuid, motivo_acceso_temporal, alcance_acceso_temporal, timestamptz, timestamptz),
  registrar_alta(uuid, uuid, date, bytea), cita_liquidable(uuid), reporte_dashboard(), estado_fichas_profesional(uuid),
  reporte_cobros(date, date)
TO app_user;
