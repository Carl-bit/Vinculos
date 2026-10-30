-- Aviso de revocacion de un acceso clinico temporal: migracion aparte porque
-- un ADD VALUE no se usa en la misma transaccion.
ALTER TYPE "tipo_notificacion" ADD VALUE 'ACCESO_CLINICO_REVOCADO';
