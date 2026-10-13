-- Pedido del cliente del 11-10-2026: sección "Bolsas" donde el cliente pide bolsas de envío por color y medida.
-- El 12-10 el cliente la dejó en pausa: queda apagada (operacion.bolsas = false) hasta que la active en Tarifas y reglas.
-- Cada color tiene su precio; se parte con las fucsia (paquetes de 100) y más adelante se agregan negro, blanco, etc.
-- Los precios los define administración (igual que las tarifas de envío).
CREATE TABLE IF NOT EXISTS bolsa_producto (
  id             SERIAL PRIMARY KEY,
  color          TEXT NOT NULL,
  medida         TEXT NOT NULL,                       -- ancho x alto en cm, p. ej. "17x30"
  unidades       INTEGER NOT NULL DEFAULT 100 CHECK (unidades BETWEEN 1 AND 10000), -- bolsas por paquete
  precio         INTEGER NOT NULL CHECK (precio BETWEEN 1 AND 10000000),         -- precio de venta del paquete
  costo          INTEGER CHECK (costo IS NULL OR costo BETWEEN 0 AND 10000000),  -- lo que le cuesta a la empresa (solo administración)
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  orden          INTEGER NOT NULL DEFAULT 0,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (color, medida, unidades)
);
ALTER TABLE bolsa_producto ENABLE ROW LEVEL SECURITY;

-- Precios al costo de la lista del proveedor (11-10) + $2.000 por paquete para cubrir el IVA, como pidió el cliente.
INSERT INTO bolsa_producto (color, medida, unidades, costo, precio, orden) VALUES
  ('Fucsia', '17x30', 100, 2150, 4150, 1),
  ('Fucsia', '20x30', 100, 2500, 4500, 2),
  ('Fucsia', '25x35', 100, 3750, 5750, 3),
  ('Fucsia', '30x42', 100, 5450, 7450, 4),
  ('Fucsia', '35x45', 100, 6800, 8800, 5),
  ('Fucsia', '40x55', 100, 9400, 11400, 6),
  ('Fucsia', '45x60', 100, 11250, 13250, 7),
  ('Fucsia', '60x80', 100, 23500, 25500, 8)
ON CONFLICT (color, medida, unidades) DO NOTHING;

-- Pedido de bolsas: se paga por transferencia con comprobante (como los envíos) y administración lo aprueba y entrega.
CREATE TABLE IF NOT EXISTS pedido_bolsas (
  id                  SERIAL PRIMARY KEY,
  folio               TEXT NOT NULL UNIQUE,              -- BOL-2026-000001
  cliente_id          INTEGER NOT NULL REFERENCES usuario(id),
  estado              TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'en_revision', 'pagado', 'entregado', 'anulado')),
  total               INTEGER NOT NULL CHECK (total > 0),
  entrega_direccion   TEXT NOT NULL,
  entrega_comuna_id   INTEGER NOT NULL REFERENCES comuna(id),
  observaciones       TEXT,
  comprobante_ruta    TEXT,
  comprobante_mime    TEXT,
  comprobante_nombre  TEXT,
  comprobante_referencia TEXT,
  comprobante_subido_en  TIMESTAMPTZ,
  motivo_rechazo      TEXT,
  motivo_anulacion    TEXT,
  pagado_en           TIMESTAMPTZ,
  entregado_en        TIMESTAMPTZ,
  anulado_en          TIMESTAMPTZ,
  revisado_por        INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pedido_bolsas_cliente_idx ON pedido_bolsas (cliente_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS pedido_bolsas_estado_idx ON pedido_bolsas (estado, creado_en DESC);
ALTER TABLE pedido_bolsas ENABLE ROW LEVEL SECURITY;

-- Cada línea guarda el color, la medida y el precio del momento: si después cambia el precio, el pedido no cambia.
CREATE TABLE IF NOT EXISTS pedido_bolsas_item (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER NOT NULL REFERENCES pedido_bolsas(id) ON DELETE CASCADE,
  bolsa_id        INTEGER REFERENCES bolsa_producto(id) ON DELETE SET NULL,
  color           TEXT NOT NULL,
  medida          TEXT NOT NULL,
  unidades        INTEGER NOT NULL,
  precio_unitario INTEGER NOT NULL,
  cantidad        INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 100),
  subtotal        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pedido_bolsas_item_pedido_idx ON pedido_bolsas_item (pedido_id);
ALTER TABLE pedido_bolsas_item ENABLE ROW LEVEL SECURITY;
