import type { AssetRepository } from "./assets/repository.js";
import type { GenerationRepository } from "./generations/repository.js";
import type { ObjectStorage } from "./storage/object-storage.js";
import type { ProjectRepository } from "./projects/repository.js";
import type { ProviderRepository } from "./providers/repository.js";
import type { SessionRepository, SessionService } from "./auth/session-service.js";
import type { Sub2ApiClient } from "./auth/sub2api-client.js";
import type { ProviderSecretBox } from "./crypto/secret-box.js";
import type { Sub2ApiCatalogAdapter } from "./providers/sub2api-catalog.js";
import type { GenerationService } from "./generations/generation-domain.service.js";

export type CanvasBffOverrides = {
    secureCookies?: boolean;
    sessionRepository?: SessionRepository;
    sessionService?: SessionService;
    sub2ApiClient?: Sub2ApiClient;
    projects?: ProjectRepository;
    providers?: ProviderRepository;
    providerSecretBox?: ProviderSecretBox;
    catalog?: Sub2ApiCatalogAdapter;
    assets?: AssetRepository;
    generations?: GenerationRepository;
    generationService?: GenerationService;
    objectStorage?: ObjectStorage;
};
