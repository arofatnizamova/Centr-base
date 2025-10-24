const { fetchWithTimeout } = require("../core/http");
const { db } = require("../core/db");
const {
    upsertBrand, upsertCategoryPath, upsertProduct, linkProductToCategories,
    upsertSupplierOffer, setProductProperty, addImages
} = require("../core/upsert");
require("dotenv").config();

const DEC = v => v == null ? null : (n => Number.isFinite(n) ? n : null)(Number(String(v).replace(/\s+/g, "").replace(",", ".")));
const BOOL = v => {
    if (v == null) return null;
    const s = String(v).trim().toLowerCase();
    if (["да", "yes", "true", "1"].includes(s)) return true;
    if (["нет", "no", "false", "0", ""].includes(s)) return false;
    return null;
};
const STR = v => v == null ? null : String(v).trim();

function parsePrice(priceField, currencyField) {
    const priceNum = DEC(String(priceField ?? "").replace("#CURRENCY#", ""));
    const currency = String(currencyField ?? "").includes("8381") ? "RUB" : "RUB";
    return { price: priceNum, currency };
}
const collectImages = item => [item.DETAIL_PICTURE, item.PREVIEW_PICTURE].filter(Boolean);
const categoryPath = item => [STR(item.TYPE_oborud), STR(item.SERIES)].filter(Boolean);

async function runGeneralClimate(batchId) {
    const url = process.env.GENERAL_CLIMATE_URL;
    if (!url) throw new Error("GENERAL_CLIMATE_URL не задан в .env");

    const supplier = db.prepare(`SELECT id FROM supplier WHERE code=?`).get("generalclimate");
    if (!supplier) throw new Error("Добавьте поставщика generalclimate в таблицу supplier");
    const supplierId = supplier.id;

    const rawStmt = db.prepare(`INSERT INTO raw_import(supplier_id, batch_id, payload) VALUES (?,?,?)`);
    const logStmt = db.prepare(`INSERT INTO import_log(supplier_id, batch_id, status, message) VALUES (?,?,?,?)`);

    try {
        const res = await fetchWithTimeout(url, 30000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        let count = 0;
        for (const item of json) {
            rawStmt.run(supplierId, batchId, JSON.stringify(item));

            const title = STR(item.NAME) ?? "Без названия";
            const brandId = upsertBrand(STR(item.BRAND) ?? undefined);
            const catIds = upsertCategoryPath(categoryPath(item));

            const { price, currency } = parsePrice(item.PRICE, item.PRICE_CURRENCY);

            const productId = upsertProduct({
                sku: STR(item.CODE),
                title,
                brandId,
                barcode: null,
                description: STR(item.PREVIEW_TEXT) ?? null
            });
            if (catIds.length) linkProductToCategories(productId, catIds);

            upsertSupplierOffer({
                supplierId,
                supplierSku: STR(item.EXTID) ?? STR(item.ID) ?? title,
                productId,
                title,
                price,
                currency,
                stock: null,
                url: null,
                dataJson: item
            });

            const props = {
                "Тип оборудования": STR(item.TYPE_oborud),
                "Серия": STR(item.SERIES),
                "Только холод": BOOL(item.Only_cool),
                "Хладагент": STR(item.HLAD),
                "EER": DEC(item.EER),
                "COP": DEC(item.COP),
                "Производительность (охл), кВт": DEC(item.cooling_capacity),
                "Страна производитель": STR(item.PROIZVODSTVO),
                "Уровень шума, дБА": DEC(item.LEVEL),
                "Питание": STR(item.ELEKTROPITANIE),
                "Расход воздуха, м3/ч": DEC(item.AIR_max),
                "Вес нетто, кг": DEC(item.ves_netto),
                "Вес брутто, кг": DEC(item.ves_brutto),
                "Размер блока": STR(item.size_blok),
                "Диапазон температур (холод)": STR(item.range_temp_holod),
                "Заправка хладагента, кг": DEC(item.zapravka),
                "Компрессор": STR(item.brand_compres),
                "Тип компрессора": STR(item.type_compres)
            };
            for (const [k, v] of Object.entries(props)) {
                if (v !== null && v !== undefined && v !== "") setProductProperty(productId, k, v);
            }

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
module.exports = { runGeneralClimate };
