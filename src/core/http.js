// Без зависимостей: используем глобальный fetch (Node 18+)
async function fetchWithTimeout(url, ms, init = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(id);
    }
}

module.exports = { fetchWithTimeout };
