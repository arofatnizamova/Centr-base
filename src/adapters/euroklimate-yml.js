const { fetchWithTimeout } = require("../core/http");
const { XMLParser } = require("fast-xml-parser");
const { db } = require("../core/db");
const {
    upsertBrand, upsertProduct, linkProductToCategories,
    upsertSupplierOffer, setProductProperty, addImages,
    getOrCreateCategoryBySupplierPath
} = require("../core/upsert");
require("dotenv").config();

const DEC = v => v == null ? null : (n => Number.isFinite(n) ? n : null)(
    Number(String(v).replace(/\s+/g, "").replace(",", "."))
);
const STR = v => v == null ? null : String(v).trim();
const normCurrency = cur => !cur ? "RUB" : (cur.toUpperCase() === "RUR" ? "RUB" : cur.toUpperCase());

async function runEuroklimate(batchId) {
    const url = process.env.EK_YML_URL;
    if (!url) throw new Error("EK_YML_URL не задан в .env");

    const supplier = db.prepare(`SELECT id FROM supplier WHERE code=?`).get("euroklimate");
    if (!supplier) throw new Error("Добавьте поставщика euroklimate в таблицу supplier");
    const supplierId = supplier.id;

    const rawStmt = db.prepare(`INSERT INTO raw_import(supplier_id, batch_id, payload) VALUES (?,?,?)`);
    const logStmt = db.prepare(`INSERT INTO import_log(supplier_id, batch_id, status, message) VALUES (?,?,?,?)`);

    try {
        const res = await fetchWithTimeout(url, 60000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            parseTagValue: false,
            parseAttributeValue: false,
            trimValues: false
        });
        const yml = parser.parse(xml);
        const shop = yml?.yml_catalog?.shop;

        const categories = [].concat(shop?.categories?.category || []);
        const offers = [].concat(shop?.offers?.offer || []);


        const catById = new Map();
        categories.forEach(c => catById.set(String(c["@_id"]), {
            id: String(c["@_id"]),
            name: String(c["#text"] ?? "").trim(),
            parentId: c["@_parentId"] ? String(c["@_parentId"]) : undefined
        }));


        function buildCategoryPath(leafId) {
            if (!leafId) return [];
            const path = [];
            let cur = catById.get(leafId);
            while (cur) {
                path.unshift(cur.name);
                cur = cur.parentId ? catById.get(cur.parentId) : undefined;
            }
            return path;
        }

        let count = 0;
        for (const off of offers) {
            rawStmt.run(supplierId, batchId, JSON.stringify(off));

            const supplierSku = STR(off["@_id"]);
            const title = STR(off.name) ?? "Без названия";
            const brandId = upsertBrand(STR(off.vendor) ?? undefined);

            const price = DEC(off.price);
            const currency = normCurrency(STR(off.currencyId));


            const catPath = buildCategoryPath(STR(off.categoryId));
            const catIds = getOrCreateCategoryBySupplierPath(supplierId, catPath);

            const productId = upsertProduct({
                sku: null,
                title,
                brandId,
                barcode: null,
                description: STR(off.description) ?? null
            });
            if (catIds.length) linkProductToCategories(productId, catIds);

            upsertSupplierOffer({
                supplierId,
                supplierSku,
                productId,
                title,
                price,
                currency,
                stock: null,
                url: STR(off.url),
                dataJson: off
            });


            const pics = off.picture ? (Array.isArray(off.picture) ? off.picture : [off.picture]) : [];
            if (pics.length) addImages(productId, pics.filter(Boolean));


            const params = off.param ? (Array.isArray(off.param) ? off.param : [off.param]) : [];
            for (const p of params) {
                const name = STR(p["@_name"]); if (!name) continue;
                const unit = STR(p["@_unit"]);
                const val = STR(p["#text"]);
                const full = unit ? `${val} ${unit}`.trim() : val;
                if (full) setProductProperty(productId, name, full);
            }


            if (off.document) {
                const docs = Array.isArray(off.document) ? off.document : [off.document];
                docs.forEach((d, i) => {
                    const nm = STR(d?.["@_name"]) ?? `Документ ${i + 1}`;
                    const u = STR(d?.["#text"]);
                    if (u) setProductProperty(productId, nm, u);
                });
            }

            count++;
        }

        logStmt.run(supplierId, batchId, "ok", `Импортировано: ${count}`);
    } catch (e) {
        logStmt.run(supplierId, batchId, "error", e.message);
        throw e;
    }
}

module.exports = { runEuroklimate };
