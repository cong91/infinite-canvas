import { canvasBff, type CanvasProject as BffCanvasProject } from "@/services/api/canvas-bff";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasProject as LocalCanvasProject } from "@/stores/canvas/use-canvas-store";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

const DEFAULT_VIEWPORT: ViewportTransform = { x: 0, y: 0, k: 1 };

export type CanvasProjectInput = {
    name: string;
    data: Record<string, unknown>;
};

/** Serialize the local canvas shape without making the BFF understand canvas internals. */
export function toBffCanvasProject(project: LocalCanvasProject): CanvasProjectInput {
    const { id: _id, remoteRevision: _remoteRevision, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshot } = project;
    return {
        name: project.title,
        data: { version: 1, canvasProject: snapshot },
    };
}

/** Convert an account-scoped BFF project into the shape consumed by the canvas store. */
export function fromBffCanvasProject(remote: BffCanvasProject): LocalCanvasProject {
    const data = isRecord(remote.data) ? remote.data : {};
    const payload = isRecord(data.canvasProject) ? data.canvasProject : data;
    const now = new Date().toISOString();

    return {
        id: remote.id,
        title: nonEmptyString(payload.title) || remote.name,
        createdAt: nonEmptyString(remote.createdAt) || now,
        updatedAt: nonEmptyString(remote.updatedAt) || now,
        nodes: asArray(payload.nodes, isCanvasNodeData),
        connections: asArray(payload.connections, isCanvasConnection),
        chatSessions: asArray(payload.chatSessions, isCanvasAssistantSession),
        activeChatId: typeof payload.activeChatId === "string" ? payload.activeChatId : null,
        backgroundMode: isBackgroundMode(payload.backgroundMode) ? payload.backgroundMode : "lines",
        showImageInfo: payload.showImageInfo === true,
        viewport: isViewportTransform(payload.viewport) ? payload.viewport : DEFAULT_VIEWPORT,
        remoteRevision: remote.revision,
    };
}

export async function saveCanvasProject(project: LocalCanvasProject): Promise<LocalCanvasProject> {
    const payload = toBffCanvasProject(project);
    const remote = await canvasBff.updateProject(project.id, { ...payload, ...(project.remoteRevision !== undefined ? { revision: project.remoteRevision } : {}) });
    return fromBffCanvasProject(remote);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
}

function asArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
    return Array.isArray(value) ? value.filter(guard) : [];
}

function isBackgroundMode(value: unknown): value is CanvasBackgroundMode {
    return value === "dots" || value === "lines" || value === "blank";
}

function isViewportTransform(value: unknown): value is ViewportTransform {
    if (!isRecord(value)) return false;
    return typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) && typeof value.k === "number" && Number.isFinite(value.k) && value.k > 0;
}

function isCanvasNodeData(value: unknown): value is CanvasNodeData {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string" || typeof value.title !== "string") return false;
    return isPosition(value.position) && isFiniteNumber(value.width) && isFiniteNumber(value.height) && (value.metadata === undefined || isRecord(value.metadata));
}

function isCanvasConnection(value: unknown): value is CanvasConnection {
    return isRecord(value) && typeof value.id === "string" && typeof value.fromNodeId === "string" && typeof value.toNodeId === "string";
}

function isCanvasAssistantSession(value: unknown): value is CanvasAssistantSession {
    return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && Array.isArray(value.messages) && typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function isPosition(value: unknown): value is { x: number; y: number } {
    return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}
