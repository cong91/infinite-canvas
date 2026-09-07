import { randomUUID } from "node:crypto";

export type ProjectRecord = {
    id: string;
    accountId: string;
    name: string;
    data: Record<string, unknown>;
    revision: number;
    createdAt: Date;
    updatedAt: Date;
};

export interface ProjectRepository {
    list(accountId: string): ProjectRecord[];
    get(accountId: string, id: string): ProjectRecord | undefined;
    create(input: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt" | "revision">): ProjectRecord;
    update(accountId: string, id: string, patch: { name?: string; data?: Record<string, unknown>; revision?: number }): ProjectRecord | undefined;
    delete(accountId: string, id: string): boolean;
}

export class InMemoryProjectRepository implements ProjectRepository {
    private readonly records = new Map<string, ProjectRecord>();

    list(accountId: string): ProjectRecord[] {
        return [...this.records.values()].filter((record) => record.accountId === accountId).map(cloneProject);
    }

    get(accountId: string, id: string): ProjectRecord | undefined {
        const record = this.records.get(id);
        return record?.accountId === accountId ? cloneProject(record) : undefined;
    }

    create(input: Omit<ProjectRecord, "id" | "createdAt" | "updatedAt" | "revision">): ProjectRecord {
        const now = new Date();
        const record: ProjectRecord = { ...input, id: randomUUID(), revision: 1, createdAt: now, updatedAt: now };
        this.records.set(record.id, record);
        return cloneProject(record);
    }

    update(accountId: string, id: string, patch: { name?: string; data?: Record<string, unknown>; revision?: number }): ProjectRecord | undefined {
        const record = this.records.get(id);
        if (!record || record.accountId !== accountId) return undefined;
        if (patch.revision !== undefined && patch.revision !== record.revision) return undefined;
        if (patch.name !== undefined) record.name = patch.name;
        if (patch.data !== undefined) record.data = structuredClone(patch.data);
        record.revision += 1;
        record.updatedAt = new Date();
        return cloneProject(record);
    }

    delete(accountId: string, id: string): boolean {
        const record = this.records.get(id);
        return Boolean(record?.accountId === accountId && this.records.delete(id));
    }
}

function cloneProject(record: ProjectRecord): ProjectRecord {
    return { ...record, data: structuredClone(record.data), createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) };
}
