import type { CanvasAccount } from "./session-service.js";

export type AuthenticatedContext = {
    account: CanvasAccount;
    sessionExpiresAt: Date;
};
