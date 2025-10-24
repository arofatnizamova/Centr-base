const { db } = require("./db");

function upsertBrand(name) {
    if (!name) return null;
    db.prepare(`INSERT INTO brand(name) VALUES (?) ON CONFLICT(name) DO NOTHING`).run(name);
    const row = db.prepare(`SELECT id FROM brand WHERE name=?`).get(name);
    return row?.id ?? null;
}

function upsertCategoryPath(names = []) {
    let parentId = null;
    const ids = [];
    for (const name of names) {
        const existing = db.prepare(
            `SELECT id FROM category WHERE name = ? AND IFNULL(parent_id,0)=IFNULL(?,0)`
        ).get(name, parentId ?? null);
        let id = existing?.id;
        if (!id) {
            db.prepare(`INSERT INTO category(name, parent_id) VALUES (?, ?)`).run(name, parentId);
            id = db.prepare(`SELECT last_insert_rowid() AS id`).get().id;
        }
        ids.push(id);
        parentId = id;
    }
    return ids;
}

function upsertProduct({ sku = null, title, brandId = null, barcode = null, description = null }) {
    if (barcode) {
        const byBarcode = db.prepare(`SELECT id FROM product WHERE barcode=?`).get(barcode);
        if (byBarcode?.id) {
            db.prepare(`UPDATE product SET title=?, brand_id=?, description=? WHERE id=?`)
                .run(title, brandId ?? null, description ?? null, byBarcode.id);
            return byBarcode.id;
        }
    }
    if (sku) {
        const bySku = db.prepare(`SELECT id FROM product WHERE sku=?`).get(sku);
        if (bySku?.id) {
            db.prepare(`UPDATE product SET title=?, brand_id=?, barcode=?, description=? WHERE id=?`)
                .run(title, brandId ?? null, barcode ?? null, description ?? null, bySku.id);
            return bySku.id;
        }
    }
    db.prepare(`INSERT INTO product(sku, title, brand_id, barcode, description) VALUES (?, ?, ?, ?, ?)`)
        .run(sku ?? null, title, brandId ?? null, barcode ?? null, description ?? null);
    return db.prepare(`SELECT last_insert_rowid() AS id`).get().id;
}

function linkProductToCategories(productId, categoryIds) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO product_category(product_id, category_id) VALUES (?, ?)`);
    for (const cid of categoryIds) stmt.run(productId, cid);
}

function upsertSupplierOffer(data) {
    const json = data.dataJson ? JSON.stringify(data.dataJson) : null;
    db.prepare(`
    INSERT INTO supplier_offer (supplier_id, supplier_sku, product_id, title, price, currency, stock, url, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supplier_id, supplier_sku) DO UPDATE SET
      product_id=excluded.product_id,
      title=COALESCE(excluded.title, supplier_offer.title),
      price=excluded.price,
      currency=excluded.currency,
      stock=excluded.stock,
      url=COALESCE(excluded.url, supplier_offer.url),
      data_json=excluded.data_json,
      updated_at=CURRENT_TIMESTAMP
  `).run(
        data.supplierId, data.supplierSku, data.productId, data.title ?? null,
        data.price ?? null, data.currency ?? null, data.stock ?? null, data.url ?? null, json
    );
}

function setProductProperty(productId, name, value) {
    db.prepare(`INSERT INTO property(name) VALUES (?) ON CONFLICT(name) DO NOTHING`).run(name);
    const prop = db.prepare(`SELECT id FROM property WHERE name=?`).get(name);
    let value_text = null, value_number = null, value_json = null;
    if (typeof value === "number") value_number = value;
    else if (typeof value === "boolean") value_json = JSON.stringify(value);
    else value_text = String(value);

    db.prepare(`
    INSERT INTO product_property(product_id, property_id, value_text, value_number, value_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(product_id, property_id) DO UPDATE SET
      value_text=excluded.value_text,
      value_number=excluded.value_number,
      value_json=excluded.value_json
  `).run(productId, prop.id, value_text, value_number, value_json);
}

function addImages(productId, urls) {
    const stmt = db.prepare(`INSERT INTO image(product_id, url, position) VALUES (?, ?, ?)`);
    urls.forEach((u, i) => stmt.run(productId, u, i));
}

module.exports = {
    upsertBrand,
    upsertCategoryPath,
    upsertProduct,
    linkProductToCategories,
    upsertSupplierOffer,
    setProductProperty,
    addImages
};
