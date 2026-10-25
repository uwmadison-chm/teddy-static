import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import "../index.css";
import "./quality-check.css";
import {RuntimeLoader} from "@rive-app/react-canvas-lite";
import riveWasmUrl from "@rive-app/canvas-lite/rive.wasm?url";
import riveFallbackWasmUrl from "@rive-app/canvas-lite/rive_fallback.wasm?url";
import SpeechBubbleBlocker from "@/components/SpeechBubbleBlocker.tsx";
import Announcer from "@/components/Announcer.tsx";
import {errorFields} from "@/data/log.ts";
import {build, settings} from "virtual:quality-check-settings";
import {logEvent, QC_EVENT_SCHEMA} from "@/quality-check/session.ts";
import QualityCheck from "@/quality-check/QualityCheck.tsx";

// Serve Rive's WASM ourselves instead of from its default CDNs
RuntimeLoader.setWasmUrl(riveWasmUrl);
RuntimeLoader.setWasmFallbackUrl(riveFallbackWasmUrl);

logEvent("quality_check_started", {schema: QC_EVENT_SCHEMA, teddy: build.teddy, debug: settings.debug});
window.addEventListener("error", (e) => logEvent("uncaught_exception", errorFields(e.error ?? e.message), "error"));
window.addEventListener("unhandledrejection", (e) => logEvent("uncaught_exception", errorFields(e.reason), "error"));

createRoot(document.getElementById("root")!, {
    onUncaughtError: (error) => logEvent("uncaught_exception", errorFields(error), "error"),
}).render(
    <StrictMode>
        <QualityCheck />
        <SpeechBubbleBlocker />
        <Announcer />
    </StrictMode>,
);
