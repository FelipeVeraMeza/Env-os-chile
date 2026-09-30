-- Tarifas nuevas (pedido del cliente 30-09-2026): la cantidad de bultos no cambia el precio.
-- Estándar hasta 10 kg y 40×40×40 cm: $3.500 · sobredimensionado hasta 20 kg y 60×60×60 cm: +$2.000 · sobre eso no se recibe.
ALTER TABLE envio ADD COLUMN recargo_sobredimension INTEGER NOT NULL DEFAULT 0 CHECK (recargo_sobredimension >= 0);

-- Se quita el cobro por bulto adicional guardado en Ajustes (los valores nuevos se toman por defecto).
UPDATE config SET valor = valor - 'bulto_adicional_domicilio' - 'bulto_adicional_punto' WHERE clave = 'tarifas';
