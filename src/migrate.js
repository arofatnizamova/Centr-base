const { db } = require("./core/db");

const sql = `
CREATE TABLE IF NOT EXISTS supplier (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brand (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_code TEXT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  FOREIGN KEY (parent_id) REFERENCES category(id)
);
CREATE TABLE IF NOT EXISTS product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  brand_id INTEGER,
  barcode TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES brand(id)
);
CREATE TRIGGER IF NOT EXISTS trg_product_updated_at
AFTER UPDATE ON product FOR EACH ROW
BEGIN
  UPDATE product SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
CREATE TABLE IF NOT EXISTS product_category (
  product_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (product_id, category_id),
  FOREIGN KEY (product_id) REFERENCES product(id),
  FOREIGN KEY (category_id) REFERENCES category(id)
);
CREATE TABLE IF NOT EXISTS supplier_offer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  supplier_sku TEXT NOT NULL,
  product_id INTEGER,
  title TEXT,
  price NUMERIC,
  currency TEXT,
  stock INTEGER,
  url TEXT,
  data_json TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (supplier_id, supplier_sku),
  FOREIGN KEY (supplier_id) REFERENCES supplier(id),
  FOREIGN KEY (product_id) REFERENCES product(id)
);
CREATE TRIGGER IF NOT EXISTS trg_supplier_offer_updated_at
AFTER UPDATE ON supplier_offer FOR EACH ROW
BEGIN
  UPDATE supplier_offer SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
CREATE TABLE IF NOT EXISTS property (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS product_property (
  product_id INTEGER NOT NULL,
  property_id INTEGER NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_json TEXT,
  PRIMARY KEY (product_id, property_id),
  FOREIGN KEY (product_id) REFERENCES product(id),
  FOREIGN KEY (property_id) REFERENCES property(id)
);
CREATE TABLE IF NOT EXISTS image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES product(id)
);
CREATE TABLE IF NOT EXISTS raw_import (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  batch_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES supplier(id)
);
CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  batch_id TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES supplier(id)
);
`;
db.exec(sql);

const ins = db.prepare("INSERT OR IGNORE INTO supplier(code, name) VALUES (?, ?)");
ins.run("generalclimate", "General Climate");
ins.run("euroklimate", "Euroklimat (EK)");
ins.run("mhi", "Mitsubishi Heavy Industries (MHI)");
console.log("Migration complete");
