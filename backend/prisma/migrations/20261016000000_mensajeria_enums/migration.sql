-- =============================================================================
-- 02i (1/2): valores de enum de la mensajeria. Migracion aparte: un valor
-- agregado con ADD VALUE no se puede usar en la misma transaccion, y la 2/2
-- carga las plantillas de ejemplo con ellos. Corre como dueño.
-- =============================================================================

-- AlterEnum: eventos nuevos del catalogo (recordatorio, consentimiento por
-- vencer, pago registrado, boleta emitida).
ALTER TYPE "tipo_notificacion" ADD VALUE 'RECORDATORIO_CITA';
ALTER TYPE "tipo_notificacion" ADD VALUE 'CONSENTIMIENTO_POR_VENCER';
ALTER TYPE "tipo_notificacion" ADD VALUE 'PAGO_REGISTRADO';
ALTER TYPE "tipo_notificacion" ADD VALUE 'BOLETA_EMITIDA';

-- AlterEnum: estados de la cola de salida (PENDIENTE | ENVIADO | FALLIDO).
ALTER TYPE "estado_notificacion" RENAME VALUE 'ENVIADA' TO 'ENVIADO';
ALTER TYPE "estado_notificacion" RENAME VALUE 'FALLIDA' TO 'FALLIDO';

-- CreateEnum
CREATE TYPE "canal_mensaje" AS ENUM ('BANDEJA', 'CORREO', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "destinatario_mensaje" AS ENUM ('PACIENTE', 'EQUIPO');

-- CreateEnum
CREATE TYPE "respuesta_recordatorio" AS ENUM ('CONFIRMADA', 'CANCELADA');
