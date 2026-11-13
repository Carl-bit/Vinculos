-- =============================================================================
-- R11 (Vinculos Control, 2026-11-13): identidad del silo dentro de su BD.
-- Mismo esqueleto para todos los centros: la imagen es comun y todo lo propio
-- del centro entra por el .env. Esta fila ata la BD a su slug: el servicio
-- migrate (prisma/scripts/identidad_silo.js, como dueño) la crea la primera vez
-- y desde ahi se niega a correr si el .env apunta a otra BD (por ejemplo, un
-- respaldo de otro centro restaurado en este silo).
--
-- interno_token_sha256: hash del token por silo de /api/internal/* (plano de
-- control). Lo fija identidad_silo.js desde INTERNO_TOKEN_SHA256 del .env; se
-- rota cambiando el .env y volviendo a correr migrate. Nunca el token en claro.
--
-- Categoria B (sin datos de personas). Sin GRANT a app_user: RLS sin
-- politicas, como las tablas de llaves. Solo el dueño (BYPASSRLS) la lee; la
-- API solo valida tokens con interno_token_valido() (SECURITY DEFINER).
-- El slug es inmutable (desde APROBADO en Vinculos Control).
-- =============================================================================

CREATE TABLE "identidad_silo" (
    "id" BOOLEAN NOT NULL DEFAULT true,
    "slug" TEXT NOT NULL,
    "interno_token_sha256" TEXT,
    "creada_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identidad_silo_pkey" PRIMARY KEY ("id")
);

ALTER TABLE identidad_silo ADD CONSTRAINT identidad_silo_una_fila CHECK (id);
-- Mismo formato que CLIENTE_SLUG (nombre del stack Docker y de sus redes).
ALTER TABLE identidad_silo ADD CONSTRAINT identidad_silo_slug_valido
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$');
ALTER TABLE identidad_silo ADD CONSTRAINT identidad_silo_token_hash
  CHECK (interno_token_sha256 IS NULL OR interno_token_sha256 ~ '^[0-9a-f]{64}$');

-- Solo cambia el hash del token (rotacion); slug, id y fecha nunca. Sin DELETE.
CREATE FUNCTION bloquear_cambio_identidad_silo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.slug IS DISTINCT FROM OLD.slug OR NEW.creada_en IS DISTINCT FROM OLD.creada_en
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'identidad_silo es inmutable: la BD pertenece al silo %', OLD.slug
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER identidad_silo_inmutable BEFORE UPDATE OR DELETE ON identidad_silo
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambio_identidad_silo();

ALTER TABLE identidad_silo ENABLE ROW LEVEL SECURITY;
ALTER TABLE identidad_silo FORCE ROW LEVEL SECURITY;
REVOKE ALL ON identidad_silo FROM PUBLIC;

-- Token de /api/internal/* valido para este silo. Sin hash configurado: siempre
-- false (falla cerrado). Solo compara hashes: el token no queda en la BD.
CREATE FUNCTION interno_token_valido(p_token text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT interno_token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     FROM identidad_silo WHERE interno_token_sha256 IS NOT NULL AND length(p_token) >= 32),
    false)
$$;
REVOKE EXECUTE ON FUNCTION interno_token_valido(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION interno_token_valido(text) TO app_user;
