const { db } = require("../core/db");
const {
    upsertBrand, upsertCategoryPath, upsertProduct, linkProductToCategories,
    upsertSupplierOffer, setProductProperty, addImages
} = require("../core/upsert");
const { fetchWithTimeout } = require("../core/http");
require("dotenv").config();

// helpers
const STR = v => v == null ? null : String(v).trim();
const DEC = v => {
    if (v == null) return null;
    const s = String(v).replace(/\s+/g, "").replace(",", "."); // "10,5" -> "10.5"
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
};
const BOOL = v => {
    if (typeof v === "boolean") return v;
    if (v == null) return null;
    const s = String(v).trim().toLowerCase();
    if (["да", "yes", "true", "1"].includes(s)) return true;
    if (["нет", "no", "false", "0", ""].includes(s)) return false;
    return null;
};

function unique(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
}

function collectImages(item) {
    const pics = [];
    if (item.PREVIEW_PICTURE) pics.push(item.PREVIEW_PICTURE);
    if (item.DETAIL_PICTURE) pics.push(item.DETAIL_PICTURE);
    const more = item.PROPERTIES && item.PROPERTIES.MORE_PHOTO ? item.PROPERTIES.MORE_PHOTO : null;
    if (more) pics.push(more);
    return unique(pics);
}

function categoryPath(item) {
    // В JSON есть блок SECTIONS: SECTION_1 / SECTION_2 / SECTION_3
    // Соберём путь в иерархии из доступных полей:
    const s = item.SECTIONS || {};
    return [STR(s.SECTION_1), STR(s.SECTION_2), STR(s.SECTION_3)].filter(Boolean);
}

function priceFromBase(BASE_PRICE) {
    // В примере BASE_PRICE пустой. Если появится число — парсим.
    const p = DEC(BASE_PRICE);
    return { price: p, currency: p != null ? "RUB" : null };
}

function mapProperties(props = {}, outCb) {
    // Пробегаем все ключи PROPERTIES и выгружаем как свойства товара.
    // Числа – где очевидно числа, остальное как текст.
    const numericKeys = new Set([
        "POWER_CONS_COOL", "POWER_CONS_HEAT", "COEF_EER", "COEF_COP", "SEER", "SCOP",
        "CURRENT_MAX", "NOISE_PRESS_COOL", "NOISE_PRESS_HEAT", "WEIGHT",
        "PIPE_MAX_LENGTH", "PIPE_SUM_LENGTH", "PIPE_MAX_TO_FIRST_INDOOR",
    ]);
    for (const [k, raw] of Object.entries(props)) {
        if (raw == null || raw === "") continue;
        const key = k; // можно позже сделать человекочитаемый маппинг
        const val = numericKeys.has(k) ? DEC(raw) : STR(raw);
        if (val !== null && val !== "") outCb(key, val);
    }
}

async function fetchAllFeeds(urls, timeoutMs = 60000) {
    const allItems = [];
    for (const url of urls) {
        const res = await fetchWithTimeout(url, timeoutMs);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const json = await res.json();
        // у MHI файлы обычно — массивы элементов
        if (Array.isArray(json)) allItems.push(...json);
        else if (Array.isArray(json?.items)) allItems.push(...json.items);
        else {
            // если формат иной — сохраняем как есть для отладки
            allItems.push(json);
        }
    }
    return allItems;
}

async function runMHI(batchId) {
    const supplier = db.prepare(`SELECT id FROM supplier WHERE code=?`).get("mhi");
    if (!supplier) throw new Error("Добавьте поставщика 'mhi' в таблицу supplier");
    const supplierId = supplier.id;

    const env = process.env.MHI_URLS || "";
    const urls = env.split(",").map(s => s.trim()).filter(Boolean);
    if (!urls.length) throw new Error("MHI_URLS не задан в .env");

    const rawStmt = db.prepare(`INSERT INTO raw_import(supplier_id, batch_id, payload) VALUES (?,?,?)`);
    const logStmt = db.prepare(`INSERT INTO import_log(supplier_id, batch_id, status, message) VALUES (?,?,?,?)`);

    try {
        const items = await fetchAllFeeds(urls, 60000);

        let count = 0;
        for (const item of items) {
            rawStmt.run(supplierId, batchId, JSON.stringify(item));

            const title = STR(item.NAME) || "Без названия";
            // Бренд тут всегда MHI, но иногда в фидах не указан — проставим явно
            const brandId = upsertBrand("Mitsubishi Heavy Industries");

            const catIds = upsertCategoryPath(categoryPath(item));

            // У MHI есть коды: ID (число), CODE (slug). Берём ID как supplierSku (стабилен).
            const supplierSku = STR(item.ID) || STR(item.CODE) || title;

            // Цена: часто пустая. Если появится — парсим.
            const { price, currency } = priceFromBase(item.BASE_PRICE);

            const productId = upsertProduct({
                sku: STR(item.CODE),      // твой глобальный SKU (можно заменить стратегию позднее)
                title,
                brandId,
                barcode: null,
                description: STR(item.PREVIEW_TEXT) || STR(item.DETAIL_TEXT)
            });
            if (catIds.length) linkProductToCategories(productId, catIds);

            upsertSupplierOffer({
                supplierId,
                supplierSku,
                productId,
                title,
                price,
                currency,
                stock: null,   // в фидах MHI обычно нет остатков
                url: null,
                dataJson: item
            });

            // Свойства из PROPERTIES
            mapProperties(item.PROPERTIES || {}, (k, v) => setProductProperty(productId, k, v));

            // Картинки
            const imgs = collectImages(item);
            if (imgs.length) addImages(productId, imgs);

            count++;
        }

        logStmt.run(supplierId, batchId, "ok", `Импортировано: ${count}`);
    } catch (e) {
        logStmt.run(supplierId, batchId, "error", e.message);
        throw e;
    }
}

module.exports = { runMHI };
