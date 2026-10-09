-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateEnum
CREATE TYPE "rol" AS ENUM ('ADMIN', 'PROFESIONAL', 'PRACTICANTE');

-- CreateEnum
CREATE TYPE "estado_cita" AS ENUM ('CONFIRMADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "modalidad" AS ENUM ('PRESENCIAL', 'ONLINE', 'MIXTA');

-- CreateEnum
CREATE TYPE "accion_acceso" AS ENUM ('OTORGADO', 'REVOCADO');

-- CreateEnum
CREATE TYPE "medio_pago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_expiracion_acceso" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "apellido" TEXT NOT NULL,
    "rut" TEXT,
    "fecha_nacimiento" DATE NOT NULL,
    "email" TEXT,
    "telefono" TEXT,
    "profesional_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adultos_responsables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "parentesco" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adultos_responsables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fichas_clinicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paciente_id" UUID NOT NULL,
    "fecha_apertura" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fichas_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evoluciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ficha_clinica_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "contenido" TEXT NOT NULL,
    "corrige_a_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evoluciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derivaciones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ficha_clinica_id" UUID NOT NULL,
    "profesional_origen_id" UUID NOT NULL,
    "profesional_destino_id" UUID NOT NULL,
    "motivo" TEXT NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "derivaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "espacios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "espacios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "espacio_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6) NOT NULL,
    "estado" "estado_cita" NOT NULL DEFAULT 'CONFIRMADA',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "citas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueos_temporales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "espacio_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6) NOT NULL,
    "expira_en" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueos_temporales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profesionales" (
    "usuario_id" UUID NOT NULL,
    "especialidad" TEXT NOT NULL,
    "enfoque_terapeutico" TEXT,
    "tarifa" INTEGER NOT NULL,
    "modalidad" "modalidad" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profesionales_pkey" PRIMARY KEY ("usuario_id")
);

-- CreateTable
CREATE TABLE "practicantes" (
    "usuario_id" UUID NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_termino_practica" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practicantes_pkey" PRIMARY KEY ("usuario_id")
);

-- CreateTable
CREATE TABLE "accesos_temporales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "practicante_id" UUID NOT NULL,
    "otorgado_por_id" UUID NOT NULL,
    "accion" "accion_acceso" NOT NULL,
    "fecha_expiracion" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accesos_temporales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arriendos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profesional_id" UUID NOT NULL,
    "monto" INTEGER NOT NULL,
    "porcentaje_comision" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arriendos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cita_id" UUID NOT NULL,
    "monto" INTEGER NOT NULL,
    "medio_pago" "medio_pago" NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boletas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pago_id" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "pdf_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boletas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_rut_key" ON "pacientes"("rut");

-- CreateIndex
CREATE INDEX "pacientes_profesional_id_idx" ON "pacientes"("profesional_id");

-- CreateIndex
CREATE INDEX "adultos_responsables_paciente_id_idx" ON "adultos_responsables"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "fichas_clinicas_paciente_id_key" ON "fichas_clinicas"("paciente_id");

-- CreateIndex
CREATE UNIQUE INDEX "evoluciones_corrige_a_id_key" ON "evoluciones"("corrige_a_id");

-- CreateIndex
CREATE INDEX "evoluciones_ficha_clinica_id_created_at_idx" ON "evoluciones"("ficha_clinica_id", "created_at");

-- CreateIndex
CREATE INDEX "derivaciones_profesional_destino_id_activa_idx" ON "derivaciones"("profesional_destino_id", "activa");

-- CreateIndex
CREATE INDEX "derivaciones_ficha_clinica_id_idx" ON "derivaciones"("ficha_clinica_id");

-- CreateIndex
CREATE UNIQUE INDEX "espacios_nombre_key" ON "espacios"("nombre");

-- CreateIndex
CREATE INDEX "citas_paciente_id_idx" ON "citas"("paciente_id");

-- CreateIndex
CREATE INDEX "bloqueos_temporales_espacio_id_expira_en_idx" ON "bloqueos_temporales"("espacio_id", "expira_en");

-- CreateIndex
CREATE INDEX "accesos_temporales_practicante_id_created_at_idx" ON "accesos_temporales"("practicante_id", "created_at");

-- CreateIndex
CREATE INDEX "arriendos_profesional_id_idx" ON "arriendos"("profesional_id");

-- CreateIndex
CREATE INDEX "pagos_cita_id_idx" ON "pagos"("cita_id");

-- CreateIndex
CREATE UNIQUE INDEX "boletas_pago_id_key" ON "boletas"("pago_id");

-- CreateIndex
CREATE UNIQUE INDEX "boletas_numero_key" ON "boletas"("numero");

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adultos_responsables" ADD CONSTRAINT "adultos_responsables_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fichas_clinicas" ADD CONSTRAINT "fichas_clinicas_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evoluciones" ADD CONSTRAINT "evoluciones_ficha_clinica_id_fkey" FOREIGN KEY ("ficha_clinica_id") REFERENCES "fichas_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evoluciones" ADD CONSTRAINT "evoluciones_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evoluciones" ADD CONSTRAINT "evoluciones_corrige_a_id_fkey" FOREIGN KEY ("corrige_a_id") REFERENCES "evoluciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_ficha_clinica_id_fkey" FOREIGN KEY ("ficha_clinica_id") REFERENCES "fichas_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_profesional_origen_id_fkey" FOREIGN KEY ("profesional_origen_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derivaciones" ADD CONSTRAINT "derivaciones_profesional_destino_id_fkey" FOREIGN KEY ("profesional_destino_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_espacio_id_fkey" FOREIGN KEY ("espacio_id") REFERENCES "espacios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citas" ADD CONSTRAINT "citas_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_temporales" ADD CONSTRAINT "bloqueos_temporales_espacio_id_fkey" FOREIGN KEY ("espacio_id") REFERENCES "espacios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueos_temporales" ADD CONSTRAINT "bloqueos_temporales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practicantes" ADD CONSTRAINT "practicantes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_temporales" ADD CONSTRAINT "accesos_temporales_practicante_id_fkey" FOREIGN KEY ("practicante_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesos_temporales" ADD CONSTRAINT "accesos_temporales_otorgado_por_id_fkey" FOREIGN KEY ("otorgado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arriendos" ADD CONSTRAINT "arriendos_profesional_id_fkey" FOREIGN KEY ("profesional_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_cita_id_fkey" FOREIGN KEY ("cita_id") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boletas" ADD CONSTRAINT "boletas_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pagos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

