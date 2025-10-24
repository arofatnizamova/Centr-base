const cron = require("node-cron");
const { exec } = require("child_process");

cron.schedule("0 */6 * * *", () => {
    exec("npm run run-all", (err, stdout, stderr) => {
        if (err) console.error(err);
        else console.log(stdout || stderr);
    });
});
