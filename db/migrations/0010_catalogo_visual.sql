-- =====================================================================
-- 0010 · Catálogo visual de la terminal
-- Foto del producto (opcional) y color/ícono de la categoría para las
-- tarjetas del modo Catálogo.
-- =====================================================================
ALTER TABLE productos  ADD COLUMN imagen TEXT CHECK (imagen IS NULL OR imagen ~ '^(https?://|data:image/)');
ALTER TABLE categorias ADD COLUMN color VARCHAR(7) CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE categorias ADD COLUMN icono VARCHAR(20);   -- botella, vino, cerveza, lata, refresco, saco, embutido, servicio…
ALTER TABLE categorias ADD COLUMN orden SMALLINT NOT NULL DEFAULT 0;
