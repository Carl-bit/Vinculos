-- Propuesta de cambio de hora (correcciones 2026-11-11, punto 7). Va en su
-- propia migracion: un ADD VALUE no se usa en la misma transaccion.

-- Hora alternativa que ofrece el profesional al no aceptar la solicitud del
-- paciente. Ocupa la hora (EXCLUDE) hasta que el paciente elige o vence.
ALTER TYPE "estado_cita" ADD VALUE 'PROPUESTA';

-- Aviso al paciente: su profesional le propone otras horas.
ALTER TYPE "tipo_notificacion" ADD VALUE 'CAMBIO_HORA_PROPUESTO';
