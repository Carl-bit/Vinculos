-- Puntos 40/44 (correcciones 2026-11-10/11): aviso al paciente cuando su
-- profesional le responde en la plataforma. Migracion propia (ADD VALUE).
ALTER TYPE "tipo_notificacion" ADD VALUE 'MENSAJE_PROFESIONAL';
