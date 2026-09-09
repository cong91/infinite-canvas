import { createCanvasApplication } from "./bootstrap.js";
import { loadConfig } from "./config/config.js";

export async function bootstrap() {
    const config = loadConfig();
    const app = await createCanvasApplication(config);
    await app.listen(config.port, "0.0.0.0");
    return app;
}

if (process.env.NODE_ENV !== "test") void bootstrap();
