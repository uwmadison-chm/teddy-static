import {useRef} from "react";
import {useLocation} from "react-router";
import {useAnimatedNavigate} from "@/utils/utils";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {askForCameraStream} from "@/data/camera.ts";
import {WAY_OUT_PANEL, WayOutPanel} from "@/components/WayOutPanel.tsx";
import {endSessionEarly, showWayOut} from "@/utils/wayOut.ts";
import {abortable, Aborted, useChoice, useScript} from "@/utils/script.ts";

export interface CameraHelpState {
    // The name of the error getUserMedia failed with, like "NotAllowedError";
    // "NotFoundError" when the device has no camera or microphone; "ended"
    // when the camera stopped partway through a screen; or "TimeoutError" when
    // the browser's question about the camera went unanswered.
    errorName: string;
    // Where to go once the camera works.
    returnTo: string;
}

interface Explanation {
    lines: string[];
    // Whether trying again could help. When it can't, the participant goes
    // straight to the way out.
    canRetry: boolean;
}

// What to tell the participant, by the name of getUserMedia's error.
function explanation(errorName: string): Explanation {
    switch (errorName) {
        case "NotAllowedError":
        case "SecurityError":
            return {canRetry: true, lines: [
                "It looks like your browser is blocking the camera or microphone.",
                "Look for a camera or lock icon next to the web address, and set both the camera and the microphone to allow.",
                "Then tap \"Try Again\". If that doesn't work, reloading the page can help.",
            ]};
        case "NotReadableError":
        case "AbortError":
            return {canRetry: true, lines: [
                "Your camera or microphone seems to be busy.",
                "Close any other apps or tabs that might be using it, then tap \"Try Again\".",
            ]};
        case "TimeoutError":
            return {canRetry: true, lines: [
                "I'm still waiting for your browser to let me use the camera and microphone.",
                "Look for a question from your browser, or a camera icon next to the web address, and allow both.",
                "Then tap \"Try Again\". If you can't find it, reloading the page can help.",
            ]};
        case "ended":
            return {canRetry: true, lines: [
                "Your camera or microphone stopped working.",
                "Check that it's still plugged in and allowed in your browser, then tap \"Try Again\".",
            ]};
        case "NotFoundError":
        case "OverconstrainedError":
            return {canRetry: false, lines: [
                "I can't find a camera and microphone on this device.",
            ]};
        case "NotSupportedError":
            return {canRetry: false, lines: [
                "This browser can't use a camera here.",
                "If you opened the link inside another app, opening it in your regular web browser might work.",
            ]};
        default:
            return {canRetry: true, lines: [
                "I'm having trouble starting your camera and microphone.",
                "Tap \"Try Again\" to give it another go.",
            ]};
    }
}

// Walks the participant through getting the camera and microphone working.
// The session can't go on without them, so when they can't get it working, or
// the device has no camera at all, it tells them to use their link on another
// device or to ask the study for help, and the session ends there (going on to
// nextURL, unless config.js says not to).
export default function CameraHelpScreen() {
    const navigate = useAnimatedNavigate();
    const location = useLocation();
    const state = (location.state || {errorName: "", returnTo: "/calibration"}) as CameraHelpState;
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);
    const help = useChoice<"retry" | "giveUp">();

    useScript(async (signal) => {
        const teddy = teddyRef.current;
        const panels = fadingPanelRef.current;

        let errorName = state.errorName;
        CurrentSessionData.logEvent("camera_help_shown", {name: errorName}, "warning");

        // Where the browser can tell us, try again on our own as soon as the
        // participant allows the camera and microphone in the browser's settings.
        if (explanation(errorName).canRetry) {
            for (const name of ["camera", "microphone"]) {
                navigator.permissions?.query({name: name as PermissionName})
                    .then((status) => {
                        const onChange = () => {
                            if (status.state == "granted") {
                                help.pick("retry");
                            }
                        };
                        status.addEventListener("change", onChange);
                        signal.addEventListener("abort", () => status.removeEventListener("change", onChange));
                    })
                    .catch(() => {
                        // This browser can't report this permission. The button still works.
                    });
            }
        }

        let gaveUp = false;
        for (let isRetry = false; ; isRetry = true) {
            const {lines, canRetry} = explanation(errorName);
            if (!canRetry) {
                await teddy.say(TeddyAnimations.SADNESS, lines, signal);
                break;
            }
            if (isRetry) {
                lines.unshift("Hmm, that still didn't work.");
            }
            // Listen from the start: the permission can change while Teddy talks.
            const chosen = help.next(signal);
            teddy.say(TeddyAnimations.SADNESS, lines, signal)
                .then(() => panels.showStartPanel(), () => {});
            if (await chosen == "giveUp") {
                gaveUp = true;
                break;
            }
            panels.showPanel(null);
            try {
                await abortable(askForCameraStream(), signal);
            } catch (error) {
                if (error instanceof Aborted) {
                    throw error;
                }
                errorName = error.name;
                continue;
            }
            CurrentSessionData.logEvent("camera_help_result", {result: "working"});
            await teddy.say(TeddyAnimations.SUCCESS, "That did it! Let's keep going.", signal);
            navigate(state.returnTo);
            return;
        }

        CurrentSessionData.logEvent("camera_help_result", {result: gaveUp ? "given_up" : "unusable", name: errorName}, "error");
        panels.showPanel(null);
        // There's no recording to wait for, just a few events, so this is quick.
        const ended = endSessionEarly();
        await teddy.say(TeddyAnimations.SADNESS, [
            "This activity needs a working camera and microphone.",
            "Please try again on another device with a camera, like a phone, using the same link the study sent you.",
            "If you need help, please contact your study coordinator.",
        ], signal);
        await showWayOut(teddy, panels, ended, signal);
    });

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SADNESS}
            />
            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button onClick={() => help.pick("retry")}>
                        Try Again
                    </button>
                    <button onClick={() => help.pick("giveUp")}>
                        I Can't Get This Working
                    </button>
                </FadingPanel>
                <WayOutPanel label={WAY_OUT_PANEL} />
            </FadingPanelSet>
        </div>
    );
}
