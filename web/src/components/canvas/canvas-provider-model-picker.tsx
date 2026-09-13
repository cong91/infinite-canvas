import { useEffect, useMemo, useRef } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

import { encodeCanvasModel } from "@/services/api/canvas-bff";
import { modelOptionName, type ModelCapability } from "@/stores/use-config-store";
import { useCanvasBffModelOptions } from "@/hooks/use-canvas-bff-model-options";

export function CanvasProviderModelPicker({ capability, value, onChange, className }: { capability: ModelCapability; value?: string; onChange: (value: string) => void; className?: string }) {
    const { providers, modelsByProvider, selectedProviderId, loading, load } = useCanvasBffModelOptions();
    const loadStartedRef = useRef(false);
    useEffect(() => {
        if (loadStartedRef.current) return;
        loadStartedRef.current = true;
        void load().catch(() => {
            loadStartedRef.current = false;
        });
    }, [load]);
    const options = useMemo(() => providers.flatMap((provider) => (modelsByProvider[provider.id] || []).map((model) => ({ provider, model }))), [modelsByProvider, providers]);
    const current = options.find((option) => encodeCanvasModel(option.provider.id, option.model) === value) || options.find((option) => option.provider.id === selectedProviderId && option.model === modelOptionName(value || "")) || options.find((option) => option.model === modelOptionName(value || ""));
    const selectedValue = current ? encodeCanvasModel(current.provider.id, current.model) : value || "";
    return (
        <div data-capability={capability} className={`grid min-w-0 gap-2 sm:grid-cols-2 ${className || ""}`}>
            <Select value={current?.provider.id || ""} onValueChange={(providerId) => {
                const option = options.find((item) => item.provider.id === providerId);
                if (option) onChange(encodeCanvasModel(option.provider.id, option.model));
            }}>
                <SelectTrigger className="h-8 min-w-0 w-full"><span className="truncate">{current?.provider.name || "Chọn nhà cung cấp"}</span></SelectTrigger>
                <SelectContent>{providers.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={selectedValue} disabled={loading || !current} onValueChange={onChange}>
                <SelectTrigger className="h-8 min-w-0 w-full"><span className="truncate">{current?.model || "Chọn model"}</span></SelectTrigger>
                <SelectContent>{options.filter((item) => item.provider.id === current?.provider.id).map((item) => <SelectItem key={item.model} value={encodeCanvasModel(item.provider.id, item.model)}>{item.model}</SelectItem>)}</SelectContent>
            </Select>
        </div>
    );
}
