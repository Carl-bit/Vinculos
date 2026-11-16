-- MVP sin pagos ni finanzas (decision del usuario 2026-11-16): fuera tambien la
-- categoria de llaves FINANCIERO. Cifraba solo datos de cobros (cuenta bancaria
-- del centro y de los profesionales, comprobantes de transferencia), que se
-- borraron en 20261116000000_mvp_sin_cobros.
--
-- La KEK y las partes Shamir de recuperacion no cambian: envuelven la KEK, no
-- cada DEK. Solo se borran las DEK FINANCIERO (todas sus versiones) y el valor
-- del enum. Antes se comprueba en la propia BD que ningun dato cifrado las use
-- (la cabecera de cada valor cifrado lleva el id de su DEK, bytes 2 a 17); si
-- alguno las usa, la migracion falla sin cambios.

-- 1. Ningun dato cifrado con una DEK FINANCIERO.
DO $$
DECLARE
  c record;
  n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM llaves_datos WHERE categoria = 'FINANCIERO') THEN
    RETURN;
  END IF;
  FOR c IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'bytea'
      AND table_name NOT IN ('llaves_datos', '_prisma_migrations')
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I t WHERE octet_length(t.%I) >= 17 AND get_byte(t.%I, 0) = 1
         AND substring(t.%I FROM 2 FOR 16) IN (SELECT uuid_send(id) FROM llaves_datos WHERE categoria = ''FINANCIERO'')',
      c.table_name, c.column_name, c.column_name, c.column_name) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'La DEK FINANCIERO aun cifra % valores en %.%: no se retira', n, c.table_name, c.column_name;
    END IF;
  END LOOP;
END;
$$;

-- 2. Retiro de las DEK FINANCIERO (llaves_datos nunca se borra por la API ni
--    por el dueño: el trigger se desactiva solo para este retiro) y bitacora.
INSERT INTO eventos_llaves (tipo, detalle, actor)
SELECT 'RETIRO_CATEGORIA',
       'Categoria FINANCIERO retirada (MVP sin cobros, 2026-11-16): ' || count(*) || ' DEK sin datos cifrados; KEK y partes sin cambios',
       'migracion 20261116000200_sin_llave_financiero'
FROM llaves_datos WHERE categoria = 'FINANCIERO'
HAVING count(*) > 0;

ALTER TABLE llaves_datos DISABLE TRIGGER llaves_datos_protegidas;
DELETE FROM llaves_datos WHERE categoria = 'FINANCIERO';
ALTER TABLE llaves_datos ENABLE TRIGGER llaves_datos_protegidas;

-- 3. categoria_llave sin FINANCIERO: se recrea el tipo (Postgres no borra
--    valores). llaves_vigentes() lo tiene en la firma: se recrea con sus permisos.
CREATE TABLE pg_temp.acl_llaves_vigentes AS
  SELECT p.proacl AS acl FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'llaves_vigentes';

DROP FUNCTION llaves_vigentes();

ALTER TYPE categoria_llave RENAME TO categoria_llave_anterior;
CREATE TYPE categoria_llave AS ENUM ('IDENTIFICACION', 'CLINICO', 'HMAC');
ALTER TABLE llaves_datos ALTER COLUMN categoria TYPE categoria_llave USING categoria::text::categoria_llave;
DROP TYPE categoria_llave_anterior;

CREATE FUNCTION llaves_vigentes()
  RETURNS TABLE(id uuid, categoria categoria_llave, version integer, activa boolean, dek_por_kek bytea, huella_kek text, canario bytea)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id, categoria, version, activa, dek_por_kek, huella_kek, canario
  FROM llaves_datos ORDER BY categoria, version
$$;

DO $$
DECLARE
  v_acl aclitem[] := (SELECT acl FROM pg_temp.acl_llaves_vigentes);
  g oid;
BEGIN
  IF v_acl IS NULL THEN
    RETURN;
  END IF;
  REVOKE ALL ON FUNCTION llaves_vigentes() FROM PUBLIC;
  FOR g IN SELECT DISTINCT a.grantee FROM aclexplode(v_acl) a WHERE a.privilege_type = 'EXECUTE' LOOP
    IF g = 0 THEN
      GRANT EXECUTE ON FUNCTION llaves_vigentes() TO PUBLIC;
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION llaves_vigentes() TO %s', g::regrole);
    END IF;
  END LOOP;
END;
$$;
DROP TABLE pg_temp.acl_llaves_vigentes;
