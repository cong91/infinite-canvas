import type { AddressInfo } from "node:net";

import { createCanvasApplication } from "../../src/bootstrap.js";
import type { CanvasBffOverrides } from "../../src/app-overrides.js";
import type { CanvasBffConfig } from "../../src/config/config.js";
import type { SessionService } from "../../src/auth/session-service.js";
import type { Sub2ApiClient } from "../../src/auth/sub2api-client.js";
import type { ProjectRepository } from "../../src/projects/repository.js";
import type { ProviderRepository } from "../../src/providers/repository.js";
import type { ProviderSecretBox } from "../../src/crypto/secret-box.js";
import type { Sub2ApiCatalogAdapter } from "../../src/providers/sub2api-catalog.js";
import type { AssetRepository } from "../../src/assets/repository.js";
import type { ObjectStorage } from "../../src/storage/object-storage.js";
import type { GenerationRepository } from "../../src/generations/repository.js";
import type { GenerationService } from "../../src/generations/generation-domain.service.js";

export type TestDependencies = {
    auth?: { sessionService?: SessionService; sub2ApiClient?: Sub2ApiClient; secureCookies?: boolean };
    workspace?: {
        projects?: { projects: ProjectRepository };
        providers?: { providers: ProviderRepository; secretBox: ProviderSecretBox; catalog: Sub2ApiCatalogAdapter };
        assets?: { assets: AssetRepository; projects?: ProjectRepository; objectStorage?: ObjectStorage };
        generations?: { service?: GenerationService; generations?: GenerationRepository; assets?: AssetRepository; objectStorage?: ObjectStorage };
    };
};

export async function startTestApp(config: CanvasBffConfig, dependencies: TestDependencies = {}) {
    const overrides: CanvasBffOverrides = {
        secureCookies: dependencies.auth?.secureCookies,
        sessionService: dependencies.auth?.sessionService,
        sub2ApiClient: dependencies.auth?.sub2ApiClient,
        projects: dependencies.workspace?.projects?.projects,
        providers: dependencies.workspace?.providers?.providers,
        providerSecretBox: dependencies.workspace?.providers?.secretBox,
        catalog: dependencies.workspace?.providers?.catalog,
        assets: dependencies.workspace?.assets?.assets ?? dependencies.workspace?.generations?.assets,
        generations: dependencies.workspace?.generations?.generations,
        generationService: dependencies.workspace?.generations?.service,
        objectStorage: dependencies.workspace?.assets?.objectStorage ?? dependencies.workspace?.generations?.objectStorage,
    };
    const app = await createCanvasApplication(config, compactOverrides(overrides), { logger: false });
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    return { app, url: `http://127.0.0.1:${address.port}`, close: () => app.close() };
}

function compactOverrides(overrides: CanvasBffOverrides): CanvasBffOverrides {
    return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) as CanvasBffOverrides;
}
