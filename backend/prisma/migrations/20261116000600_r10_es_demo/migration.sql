-- R10 (Vinculos Control): marca de silo de demostracion. La fija solo el dueno
-- (identidad_silo.js con ES_DEMO=true al crear un silo de prueba); un silo
-- real nunca la tiene. Sin GRANT nuevo a app_user. demo_resembrar.js se niega
-- a correr sin ella.
ALTER TABLE identidad_silo ADD COLUMN es_demo boolean NOT NULL DEFAULT false;
