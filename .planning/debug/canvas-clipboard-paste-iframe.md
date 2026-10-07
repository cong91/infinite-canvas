# Canvas Clipboard Paste Silently Fails in Sub2API iframe

**Opened:** 2026-10-07
**Status:** resolved (fix applied, pending UI verification)
**Reporter:** user

## Symptoms

- User báo "mất tính năng copy image/text từ clipboard để mang vào canvas".
- Ctrl/Cmd+V trên canvas không tạo node ảnh/text mới, không có toast feedback, không có lỗi hiển thị.

## Root Cause

`web/src/pages/canvas/project.tsx` (HEAD) `pasteSystemClipboard()` gọi `navigator.clipboard.read()` không có try/catch, được gọi qua `void pasteSystemClipboard()` tại keydown handler. App deploy trong Sub2API cross-origin iframe không có `allow="clipboard-read"` Permissions Policy → `navigator.clipboard.read()` reject với `NotAllowedError` → silently swallowed → user thấy paste "bi mất".

Bất đối xứng với 2 paste path khác ĐÃ hoạt động trong iframe:
- `web/src/pages/image/index.tsx:146-165` — có try/catch + toast.
- `web/src/components/agent/agent-chat-prompt-input.tsx:210-220` — dùng `event.clipboardData.files` đồng bộ (không bị Permissions Policy gate).

## Fix

Thay `navigator.clipboard.read()` async bằng synchronous `paste` event listener trên `window`, đọc `event.clipboardData.files` (ảnh) và `event.clipboardData.getData("text/plain")` (text). `ClipboardEvent.clipboardData` được browser populate đồng bộ khi user gesture, không cần `clipboard-read` permission → hoạt động trong iframe.

### Files changed

- `web/src/pages/canvas/project.tsx`:
  - Xóa `pasteSystemClipboard` useCallback (HEAD 1650-1667).
  - Thêm `handleSystemPaste` useCallback đọc `clipboardData.files` + `text/plain`.
  - Sửa Ctrl+V keydown handler: chỉ `preventDefault()` khi `pasteCopiedNodes()` trả true (có node nội bộ đã copy); ngược lại để native `paste` event bắn lên window.
  - Đăng ký `window.addEventListener("paste", handleSystemPaste)` trong cùng useEffect.

### Behavior

- Canvas có focus + image trong clipboard → tạo image node + toast `clipboardImageAdded`.
- Canvas có focus + text trong clipboard → tạo text node + toast `clipboardTextAdded`.
- Chat input (contentEditable) có focus + image → chat `onPaste` xử lý vào chat attachments (correct behavior, không thay đổi).
- Chat input có focus + text → chat tự xử lý text paste.
- Internal copy/paste nodes trong canvas (Ctrl+C → Ctrl+V) vẫn hoạt động qua `pasteCopiedNodes()` + `clipboardRef`.

## Eliminated Hypotheses

- **Removed entirely** — ELIMINATED. `git log -S "pasteSystemClipboard"` chỉ 1 commit (`443afab`, file creation). Cloud-restore commits không touch paste.
- **Gated by flag** — ELIMINATED. Không có flag, listener register unconditional.
- **Listener never attached** — ELIMINATED. Deps array đúng, useCallback stable.
- **`data-canvas-shortcuts-ignore` on AgentPanel blocks paste** — PARTIAL/INCORRECT. Khi chat input focus, `event.stopPropagation()` trong `onKeyDown` (agent-chat-prompt-input.tsx:222) mới là拦截者, không phải attribute. Và chat input là `contentEditable` nên đã match selector trước. Khi canvas focus, selector không match → paste chạy. Attribute này保护 agent panel khỏi canvas shortcuts (Delete, Backspace, Escape), KHÔNG nên remove.
- **`uploadImage` swallows node creation** — UNLIKELY. `storeImage` decode via object URL, `cloudBackupImage` tự catch lỗi.

## Verification

- TypeScript: `npx tsc --noEmit` — No errors found.
- Lint: `node scripts/lint.mjs` — passed.
- Tests: `bun test` — 24 pass / 0 fail.
- Independent verifier (agents-config:verify): CONFIRMED fix addresses true root cause.

Pending: user UI verification trong Sub2API iframe production.

## Regression Test (recommended)

1. Stub `navigator.clipboard.read` reject NotAllowedError; dispatch Ctrl+V keydown với target=document.body; assert không có unhandled rejection.
2. Dispatch `paste` event trên window với `clipboardData.files = [image File]`; assert `setNodes` called với Image node + `message.success` fires.
3. Dispatch `paste` event với `clipboardData.getData("text/plain") = "hello"`; assert text node created.
4. Dispatch `paste` event với target=contentEditable; assert canvas KHÔNG nhận (chat tự xử lý).
