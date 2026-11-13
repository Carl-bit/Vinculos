-- Punto 38 (correcciones 2026-11-10/11): aviso al paciente para que agregue un
-- contacto de emergencia. Migracion propia: un ADD VALUE no se usa en la misma
-- transaccion.
ALTER TYPE "tipo_notificacion" ADD VALUE 'CONTACTO_EMERGENCIA_PENDIENTE';
