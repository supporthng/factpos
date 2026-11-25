-- Nuevo tipo de oferta: PAQUETE («3 por RD$2,500»). lleva = unidades del paquete, valor = precio total del paquete.
-- Se repite por cada grupo completo: con 7 botellas de un «3 por 2,500», 2 grupos llevan la oferta y 1 va a precio normal.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'ofertas'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%ARRAY%' AND pg_get_constraintdef(oid) LIKE '%LLEVA_PAGA%' AND pg_get_constraintdef(oid) LIKE '%tipo%'
  LOOP
    EXECUTE format('ALTER TABLE ofertas DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE ofertas ADD CONSTRAINT ofertas_tipo_check
  CHECK (tipo IN ('PORCENTAJE', 'PRECIO_ESPECIAL', 'LLEVA_PAGA', 'POR_VOLUMEN', 'PAQUETE'));
ALTER TABLE ofertas ADD CONSTRAINT ofertas_paquete_check
  CHECK (tipo <> 'PAQUETE' OR (lleva >= 2 AND valor > 0));
