-- R10 (Vinculos Control, 2026-11-19): en un silo de demostracion el login no
-- pide segundo factor (las cuentas son ficticias y el demo se comparte fuera
-- del entorno del host). La API lo consulta solo con ES_DEMO=true en su entorno
-- y exige ademas esta marca de la BD (identidad_silo.es_demo, que fija solo el
-- dueno al crear un silo de prueba): un .env copiado a un silo real no basta.
-- Categoria C (booleano del silo, sin datos de personas). Solo lectura; app_user
-- sigue sin leer identidad_silo (caso 68 y 182).
CREATE FUNCTION silo_es_demo() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT es_demo FROM identidad_silo LIMIT 1), false)
$$;
REVOKE EXECUTE ON FUNCTION silo_es_demo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION silo_es_demo() TO app_user;
