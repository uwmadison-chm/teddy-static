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
import {CurrentSessionData, setCanLeavePageSafely} from "@/data/sessionData.tsx";
import {getCameraStream, stopCameraStream} from "@/data/camera.ts";
import * as pig from "@/data/pig.ts";
import {abortable, Aborted, useChoice, useScript} from "@/utils/script.ts";

export interface CameraHelpState {
    // The name of the error getUserMedia failed with, like "NotAllowedError".
    errorName: string;
    // Where to go once the camera works.
    returnTo: string;
}

// What to tell the participant, by the name of getUserMedia's error.
function explanation(errorName: string): string[] {
    switch (errorName) {
        case "NotAllowedError":
        case "SecurityError":
            return [
                "It looks like your browser is blocking the camera or microphone.",
                "Look for a camera or lock icon next to the web address, and set both the camera and the microphone to allow.",
                "Then tap \"Try Again\". If that doesn't work, reloading the page can help.",
            ];
        case "NotFoundError":
        case "OverconstrainedError":
            return [
                "I can't find a camera or microphone on this device.",
                "If one is plugged in or turned off, check it, then tap \"Try Again\".",
            ];
        case "NotReadableError":
        case "AbortError":
            return [
                "Your camera or microphone seems to be busy.",
                "Close any other apps or tabs that might be using it, then tap \"Try Again\".",
            ];
        default:
            return [
                "I'm having trouble starting your camera and microphone.",
                "Tap \"Try Again\" to give it another go.",
            ];
    }
}

// Walks the participant through getting the camera and microphone working,
// and lets them move on without it if they can't.
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

        // Where the browser can tell us, try again on our own as soon as the
        // participant allows the camera and microphone in the browser's settings.
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

        let errorName = state.errorName;
        CurrentSessionData.logEvent("camera_help_shown", {name: errorName});
        for (let isRetry = false; ; isRetry = true) {
            const lines = explanation(errorName);
            if (isRetry) {
                lines.unshift("Hmm, that still didn't work.");
            }
            // Listen from the start: the permission can change while Teddy talks.
            const chosen = help.next(signal);
            teddy.say(TeddyAnimations.SADNESS, lines, signal)
                .then(() => panels.showStartPanel(), () => {});
            if (await chosen == "giveUp") {
                break;
            }
            panels.showPanel(null);
            try {
                await abortable(getCameraStream(), signal);
            } catch (error) {
                if (error instanceof Aborted) {
                    throw error;
                }
                errorName = error.name;
                continue;
            }
            await teddy.say(TeddyAnimations.SUCCESS, "That did it! Let's keep going.", signal);
            navigate(state.returnTo);
            return;
        }

        CurrentSessionData.logEvent("camera_given_up", {name: errorName});
        stopCameraStream();
        panels.showPanel(null);
        // There's no recording to wait for, just a few events, so this is quick.
        const sent = pig.finishRun(() => {}).catch((error) => {
            console.error("Couldn't finish sending to pig:", error);
        });
        await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY, "That's okay. Thanks for trying!", signal);
        await abortable(sent, signal);
        setCanLeavePageSafely();
        if (CurrentSessionData.nextURL) {
            await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY, "Press the button to continue.", signal);
            panels.showStartPanel("continue");
        } else {
            teddy.say(TeddyAnimations.WAVE, "You can close this tab now.");
        }
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
                <FadingPanel label={"continue"}>
                    <button
                            onClick={(_e)=>{
                                window.location.assign(CurrentSessionData.nextURL);
                            }}>
                        Continue
                    </button>
                </FadingPanel>
            </FadingPanelSet>
        </div>
    );
}
