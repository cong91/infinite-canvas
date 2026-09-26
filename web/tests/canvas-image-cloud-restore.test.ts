import { beforeEach, expect, test } from "bun:test";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
    },
});

const requests: string[] = [];
const responses = new Map<string, unknown>();
Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        requests.push(url);
        const body = responses.get(url);
        if (!body) return new Response("not found", { status: 404 });
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
});

import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

class FileReaderStub {
    result = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
        this.result = "data:application/octet-stream;base64,c3R1Yg==";
        queueMicrotask(() => this.onload?.());
    }
    readAsArrayBuffer() {
        this.result = "";
        queueMicrotask(() => this.onload?.());
    }
    readAsText() {
        this.result = "";
        queueMicrotask(() => this.onload?.());
    }
}
Object.defineProperty(globalThis, "FileReader", { configurable: true, value: FileReaderStub });
if (!("createObjectURL" in URL) || typeof URL.createObjectURL !== "function") {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:stub" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
}

const deadBlob = "blob:https://canvas.v-claw.org/dead";

function imageNode(metadata: Record<string, unknown>): CanvasNodeData {
    return { id: "image-1", type: CanvasNodeType.Image, title: "img", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: metadata as CanvasNodeData["metadata"] };
}

async function setAccountStatus(status: "authenticated" | "unauthenticated") {
    const { useCanvasAccountStore } = await import("../src/stores/use-canvas-account-store");
    const { setCanvasAccountAuthenticated } = await import("../src/stores/canvas/account-runtime");
    setCanvasAccountAuthenticated(status === "authenticated");
    useCanvasAccountStore.setState({ status });
}

beforeEach(() => {
    requests.length = 0;
    responses.clear();
});

test("hydrate keeps node content when the local image blob is available", async () => {
    await setAccountStatus("authenticated");
    const { hydrateCanvasImages } = await import("../src/lib/canvas/canvas-generation-helpers");
    const { setImageBlob } = await import("../src/services/image-storage");
    const node = imageNode({ content: deadBlob, storageKey: "image:cached", assetId: "asset-1" });
    await setImageBlob("image:cached", new Blob(["local"], { type: "image/png" }));

    const [restored] = await hydrateCanvasImages([node]);
    expect(restored.metadata?.content).toContain("blob:");
    expect(requests).toEqual([]);
});

test("hydrate restores a missing image from the cloud asset when canvas-authenticated", async () => {
    await setAccountStatus("authenticated");
    const { hydrateCanvasImages } = await import("../src/lib/canvas/canvas-generation-helpers");
    const node = imageNode({ content: deadBlob, storageKey: "image:cloud", assetId: "asset-42" });
    responses.set("/api/v1/assets/asset-42", {
        data: { id: "asset-42", kind: "image", metadata: {}, signedUrl: "https://media.test/signed" },
    });
    responses.set("https://media.test/signed", { data: "binary" });

    const [restored] = await hydrateCanvasImages([node]);
    expect(restored.metadata?.content).toContain("blob:");
    expect(requests.some((url) => url.endsWith("/v1/assets/asset-42"))).toBe(true);
    expect(requests.some((url) => url === "https://media.test/signed")).toBe(true);
});

test("hydrate falls back to matching a legacy node by exact byte size against account assets", async () => {
    await setAccountStatus("authenticated");
    const { hydrateCanvasImages } = await import("../src/lib/canvas/canvas-generation-helpers");
    const node = imageNode({ content: deadBlob, storageKey: "image:legacy", bytes: 1332350, status: "success", mimeType: "image/png" });
    responses.set("/api/v1/assets", {
        data: [
            { id: "asset-small", kind: "image", metadata: { size: 999 }, signedUrl: "https://media.test/wrong" },
            { id: "asset-match", kind: "image", metadata: { size: 1332350 }, signedUrl: "https://media.test/legacy" },
        ],
    });
    responses.set("https://media.test/legacy", { data: "binary" });

    const [restored] = await hydrateCanvasImages([node]);
    expect(restored.metadata?.content).toContain("blob:");
    expect(requests.some((url) => url === "/api/v1/assets")).toBe(true);
    expect(requests.some((url) => url === "https://media.test/legacy")).toBe(true);
    expect(requests.some((url) => url === "https://media.test/wrong")).toBe(false);
});

test("hydrate falls back to stored content without an asset link or session", async () => {
    await setAccountStatus("unauthenticated");
    const { hydrateCanvasImages } = await import("../src/lib/canvas/canvas-generation-helpers");
    const node = imageNode({ content: deadBlob, storageKey: "image:missing" });

    const [restored] = await hydrateCanvasImages([node]);
    expect(restored.metadata?.content).toBe(deadBlob);
    expect(requests).toEqual([]);
});

test("imageMetadata carries the cloud assetId onto node metadata", async () => {
    const { imageMetadata } = await import("../src/lib/canvas/canvas-node-factory");
    const uploaded = { url: "blob:local", storageKey: "image:abc", width: 10, height: 10, bytes: 3, mimeType: "image/png" };

    expect(imageMetadata(uploaded, "asset-9").assetId).toBe("asset-9");
    expect("assetId" in imageMetadata(uploaded)).toBe(false);
});
