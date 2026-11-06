-- 03c (2026-11-05): marca del centro por zona. La cuenta madre (ADMIN) elige el
-- color principal y el de fondo del sitio publico, del portal del paciente y
-- del panel del equipo. Las tarjetas siguen en crema (#F5EAD8): por eso el
-- color principal debe leerse sobre crema y el fondo debe dejar leer la tinta.
-- Tabla contenido_publico (C, fila unica): mismas politicas y RLS de 03a.
-- color_marca (ya existente) = color principal del sitio publico.

-- Contraste WCAG 2.x entre dos colores #RRGGBB (1 a 21).
CREATE FUNCTION luminancia_relativa(p_hex text) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
  SELECT 0.2126 * c[1] + 0.7152 * c[2] + 0.0722 * c[3]
  FROM (SELECT array_agg(CASE WHEN v <= 0.04045 THEN v / 12.92 ELSE power((v + 0.055) / 1.055, 2.4) END ORDER BY i) AS c
        FROM (SELECT i, ('x' || lpad(substr(p_hex, 2 * i, 2), 8, '0'))::bit(32)::int / 255.0 AS v
              FROM generate_series(1, 3) AS i) canales) l
$$;

CREATE FUNCTION contraste_wcag(p_a text, p_b text) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT SET search_path = public, pg_temp AS $$
  SELECT (greatest(luminancia_relativa(p_a), luminancia_relativa(p_b)) + 0.05)
       / (least(luminancia_relativa(p_a), luminancia_relativa(p_b)) + 0.05)
$$;

ALTER TABLE contenido_publico
  ADD COLUMN color_fondo_publico text,
  ADD COLUMN color_portal text,
  ADD COLUMN color_fondo_portal text,
  ADD COLUMN color_panel text,
  ADD COLUMN color_fondo_panel text;

-- Un color de marca anterior que no cumple el contraste vuelve al del sistema
-- (antes solo se avisaba en pantalla; ninguna pantalla lo aplicaba).
UPDATE contenido_publico SET color_marca = NULL
 WHERE color_marca IS NOT NULL
   AND (color_marca !~ '^#[0-9A-Fa-f]{6}$' OR contraste_wcag(color_marca, '#F5EAD8') < 4.5);

-- Principal: texto o boton sobre las tarjetas crema y texto blanco encima (AA 4.5).
-- Fondo: la tinta (#2B2420) se lee a 10:1 o mas (fondo claro, como el lienzo).
ALTER TABLE contenido_publico ADD CONSTRAINT contenido_publico_colores CHECK (
  (color_marca IS NULL OR (color_marca ~ '^#[0-9A-Fa-f]{6}$' AND contraste_wcag(color_marca, '#F5EAD8') >= 4.5))
  AND (color_portal IS NULL OR (color_portal ~ '^#[0-9A-Fa-f]{6}$' AND contraste_wcag(color_portal, '#F5EAD8') >= 4.5))
  AND (color_panel IS NULL OR (color_panel ~ '^#[0-9A-Fa-f]{6}$' AND contraste_wcag(color_panel, '#F5EAD8') >= 4.5))
  AND (color_fondo_publico IS NULL OR (color_fondo_publico ~ '^#[0-9A-Fa-f]{6}$' AND contraste_wcag(color_fondo_publico, '#2B2420') >= 10))
  AND (color_fondo_portal IS NULL OR (color_fondo_portal ~ '^#[0-9A-Fa-f]{6}$' AND contraste_wcag(color_fondo_portal, '#2B2420') >= 10))
  AND (color_fondo_panel IS NULL OR (color_fondo_panel ~ '^#[0-9A-Fa-f]{6}$' AND contraste_wcag(color_fondo_panel, '#2B2420') >= 10))
);

GRANT UPDATE (color_fondo_publico, color_portal, color_fondo_portal, color_panel, color_fondo_panel) ON contenido_publico TO app_user;
-- contenido_publico_centro() usa to_jsonb(cp): las columnas nuevas ya salen en publico/centro.
