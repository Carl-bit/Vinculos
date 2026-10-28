-- =============================================================================
-- Feriados de Chile 2027 para el plazo en dias habiles (AUD-01 E2.3a).
-- La carga el operador como dueño, en cada silo, ANTES del 1 de enero de 2027.
--
-- ESTADO: BORRADOR POR VERIFICAR. Al 2026-10-28 no hay calendario oficial
-- publicado y las fuentes privadas no coinciden en todas las fechas. Antes de
-- cargarlo, verificar cada linea contra el Diario Oficial / Direccion del
-- Trabajo y descomentar o corregir las marcadas "VERIFICAR".
--
--   docker compose -f infra/docker-compose.yml --env-file infra/.env exec -T db \
--     sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < infra/scripts/continuidad/feriados_2027.sql
-- =============================================================================
INSERT INTO feriados (fecha, nombre) VALUES
  ('2027-01-01', 'Año Nuevo'),
  ('2027-03-26', 'Viernes Santo'),
  ('2027-03-27', 'Sábado Santo'),
  ('2027-05-01', 'Día Nacional del Trabajo'),
  ('2027-05-21', 'Día de las Glorias Navales'),
  ('2027-07-16', 'Día de la Virgen del Carmen'),
  ('2027-08-15', 'Asunción de la Virgen'),
  ('2027-09-18', 'Independencia Nacional'),
  ('2027-09-19', 'Día de las Glorias del Ejército'),
  ('2027-10-31', 'Día de las Iglesias Evangélicas y Protestantes'),
  ('2027-11-01', 'Día de Todos los Santos'),
  ('2027-12-08', 'Inmaculada Concepción'),
  ('2027-12-25', 'Navidad')
ON CONFLICT (fecha) DO NOTHING;

-- VERIFICAR (fechas con traslado o en discusion entre fuentes):
-- ('2027-06-21', 'Día Nacional de los Pueblos Indígenas'),   -- solsticio de invierno (Ley 21.357): 20 o 21 de junio
-- ('2027-06-28', 'San Pedro y San Pablo'),                   -- 29-06 cae martes: ¿se traslada al lunes 28?
-- ('2027-09-17', 'Feriado adicional de Fiestas Patrias'),    -- algunas fuentes lo incluyen
-- ('2027-10-11', 'Encuentro de Dos Mundos'),                 -- 12-10 cae martes: ¿se traslada al lunes 11?
