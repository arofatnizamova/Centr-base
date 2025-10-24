require("dotenv").config();

const { runGeneralClimate } = require("./adapters/generalclimate-json");
const { runEuroklimate } = require("./adapters/euroklimate-yml");
const { runMHI } = require("./adapters/mhi-json");

const map = {
    generalclimate: runGeneralClimate,
    euroklimate: runEuroklimate,
    mhi: runMHI,
};

async function main() {
    const args = process.argv.slice(2); // всё после node src/index.js
    const batchId = new Date().toISOString();

    // Поддерживаем оба синтаксиса:
    // 1) node src/index.js run <supplier>
    // 2) node src/index.js <supplier>
    // 3) node src/index.js run-all
    let cmd = args[0];
    let supplier = args[1];

    // если передали только код поставщика (например npm run run mhi), то cmd = "mhi"
    if (!supplier && map[cmd]) {
        supplier = cmd;
        cmd = "run";
    }

    if (cmd === "run" && supplier && map[supplier]) {
        await map[supplier](batchId);
        console.log(`Done: ${supplier}`);
        return;
    }

    if (cmd === "run-all") {
        for (const key of Object.keys(map)) {
            await map[key](batchId + "_" + key);
            console.log(`Done: ${key}`);
        }
        return;
    }

    console.log(`Usage:
  npm run run <supplier>        # пример: npm run run mhi
  npm run run -- <supplier>     # альтернативный способ для npm
  npm run run-all               # запустить всех
  Suppliers: ${Object.keys(map).join(", ")}
  `);
}

main();
