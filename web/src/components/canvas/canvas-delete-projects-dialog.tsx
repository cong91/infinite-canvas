import { App, Button, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { canvasBff } from "@/services/api/canvas-bff";
import { useCanvasAccountStore } from "@/stores/use-canvas-account-store";

export function CanvasDeleteProjectsDialog() {
    const { t } = useTranslation();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const accountStatus = useCanvasAccountStore((state) => state.status);
    const { message } = App.useApp();
    const confirm = async () => {
        if (accountStatus === "authenticated") {
            const results = await Promise.allSettled(ids.map((id) => canvasBff.deleteProject(id)));
            const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
            if (failure) {
                message.error(failure.reason instanceof Error ? failure.reason.message : t("canvas.project.deleteFailed", { defaultValue: "Canvas project could not be deleted" }));
                return;
            }
        }
        deleteProjects(ids);
        cleanupImages();
        removeSelectedIds(ids);
        setDeleteIds([]);
    };

    return (
        <Modal
            title={t("canvas.project.deleteTitle")}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>{t("common.cancel")}</Button>
                    <Button danger type="primary" onClick={() => void confirm()}>
                        {t("common.delete")}
                    </Button>
                </>
            }
        >
            <p className="text-sm text-stone-500">{t("canvas.project.deleteDescription", { count: ids.length })}</p>
        </Modal>
    );
}
