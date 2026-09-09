let authenticated = false;

export function setCanvasAccountAuthenticated(value: boolean) {
    authenticated = value;
}

export function isCanvasAccountBacked() {
    return authenticated;
}
