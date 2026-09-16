import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const nginxConfigPath = fileURLToPath(new URL("../../deploy/ovh-sing/nginx.canvas.v-claw.org.conf", import.meta.url));

test("media proxy removes upstream CORS headers before adding its canonical policy", async () => {
    const config = await readFile(nginxConfigPath, "utf8");
    const mediaServer = config.split("server {").find((block) => block.includes("server_name media.canvas.v-claw.org;"));

    assert.ok(mediaServer, "media server block is missing");
    for (const header of [
        "Access-Control-Allow-Origin",
        "Access-Control-Allow-Credentials",
        "Access-Control-Allow-Headers",
        "Access-Control-Allow-Methods",
        "Access-Control-Expose-Headers",
    ]) {
        assert.match(mediaServer, new RegExp(`proxy_hide_header ${header};`));
    }
    assert.equal((mediaServer.match(/add_header Access-Control-Allow-Origin/g) ?? []).length, 1);
});
