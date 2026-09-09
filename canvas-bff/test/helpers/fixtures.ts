import type { SessionService } from "../../src/auth/session-service.js";
import { ProviderSecretBox } from "../../src/crypto/secret-box.js";
import type { ProjectRepository } from "../../src/projects/repository.js";
import { InMemoryProjectRepository } from "../../src/projects/repository.js";
import { InMemoryAssetRepository, type AssetRepository } from "../../src/assets/repository.js";
import { InMemoryProviderRepository, type ProviderRepository } from "../../src/providers/repository.js";
import { Sub2ApiCatalogAdapter } from "../../src/providers/sub2api-catalog.js";

export type AssetFixtureOptions = { assets: AssetRepository; projects: ProjectRepository; sessionService: SessionService };
export type ProviderFixtureOptions = { catalog: Sub2ApiCatalogAdapter; secretBox: ProviderSecretBox; providers: ProviderRepository; sessionService: SessionService };
export type ProjectFixtureOptions = { projects: ProjectRepository; sessionService: SessionService };

export function createDefaultAssetOptions(sessionService: SessionService, projects: ProjectRepository): AssetFixtureOptions {
    return { assets: new InMemoryAssetRepository(), projects, sessionService };
}

export function createDefaultProviderOptions(sessionService: SessionService, sub2ApiBaseUrl: string): ProviderFixtureOptions {
    return { catalog: new Sub2ApiCatalogAdapter(sub2ApiBaseUrl), secretBox: new ProviderSecretBox(Buffer.alloc(32, 7)), providers: new InMemoryProviderRepository(), sessionService };
}

export function createDefaultProjectOptions(sessionService: SessionService): ProjectFixtureOptions {
    return { projects: new InMemoryProjectRepository(), sessionService };
}
