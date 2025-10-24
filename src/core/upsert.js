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
// --- НОРМАЛИЗАЦИЯ ---
function normName(s) {
    return String(s)
        .trim()
        .replace(/\s+/g, " ")
        .replace(/ё/g, "е")
        .replace(/Ё/g, "Е")
        .toLowerCase();
}
function normPath(arr) {
    return arr.map(normName).filter(Boolean).join(">");
}

// --- ПОЛУЧИТЬ / СОЗДАТЬ КАТЕГОРИЮ С УЧЁТОМ МАППИНГА ПОСТАВЩИКА ---
function getOrCreateCategoryBySupplierPath(supplierId, rawPathArr = []) {
    const key = normPath(rawPathArr);
    if (!key) return [];

    // 1) проверить в supplier_category_map
    const mapping = db.prepare(`
    SELECT category_id FROM supplier_category_map
    WHERE supplier_id = ? AND path = ?
  `).get(supplierId, key);

    if (mapping?.category_id) {
        // восстановить всю иерархию до этого узла (или просто вернуть [category_id] если не требуется)
        // Мы всё равно поддерживаем product_category как связь, достаточно вернуть хвостовую категорию.
        return [mapping.category_id];
    }

    // 2) если нет маппинга — создать/найти путь в category (с нормализованными именами, но сохраняем "как пришло" в name)
    let parentId = null;
    let lastId = null;
    for (const rawName of rawPathArr) {
        if (!rawName) continue;
        const name = String(rawName).trim();
        // ищем по (normName, parentId)
        const row = db.prepare(`
      SELECT c.id
      FROM category c
      WHERE c.name_normalized = ? AND IFNULL(c.parent_id,0) = IFNULL(?,0)
    `).get(normName(name), parentId ?? null);

        if (row?.id) {
            lastId = row.id;
            parentId = row.id;
        } else {
            // если столбца name_normalized ещё нет — добавим (один раз)
            try {
                db.exec(`ALTER TABLE category ADD COLUMN name_normalized TEXT`);
            } catch (e) {
                // уже добавлен — ок
            }
            db.prepare(`
        INSERT INTO category(name, parent_id, name_normalized)
        VALUES (?, ?, ?)
      `).run(name, parentId, normName(name));
            lastId = db.prepare(`SELECT last_insert_rowid() AS id`).get().id;
            parentId = lastId;
        }
    }

    // 3) записать маппинг, чтобы в следующий раз сразу попадать в тот же category_id
    if (lastId) {
        db.prepare(`
      INSERT OR IGNORE INTO supplier_category_map(supplier_id, path, category_id)
      VALUES (?, ?, ?)
    `).run(supplierId, key, lastId);
        return [lastId];
    }

    return [];
}

// ПАТЧ: обновим upsertCategoryPath, чтобы он тоже использовал нормализацию (на будущее)
function upsertCategoryPathNormalized(names = []) {
    let parentId = null;
    const ids = [];
    // подготовим столбец normal, если ещё не создан
    try {
        db.exec(`ALTER TABLE category ADD COLUMN name_normalized TEXT`);
    } catch (e) { }
    for (const raw of names) {
        if (!raw) continue;
        const name = String(raw).trim();
        const n = normName(name);
        const existing = db.prepare(
            `SELECT id FROM category WHERE name_normalized = ? AND IFNULL(parent_id,0)=IFNULL(?,0)`
        ).get(n, parentId ?? null);
        let id = existing?.id;
        if (!id) {
            db.prepare(`INSERT INTO category(name, parent_id, name_normalized) VALUES (?, ?, ?)`)
                .run(name, parentId, n);
            id = db.prepare(`SELECT last_insert_rowid() AS id`).get().id;
        }
        ids.push(id);
        parentId = id;
    }
    return ids;
}

module.exports = {
    upsertBrand,
    upsertCategoryPath,
    upsertProduct,
    linkProductToCategories,
    upsertSupplierOffer,
    setProductProperty,
    addImages,
    normName,
    normPath,
    getOrCreateCategoryBySupplierPath,
    upsertCategoryPathNormalized,
};
