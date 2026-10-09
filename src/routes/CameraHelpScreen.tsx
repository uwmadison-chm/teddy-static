import {useEffect, useEffectEvent, useRef} from "react";
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
    const isTrying = useRef(false);

    function explain(errorName: string, isRetry: boolean) {
        const lines = explanation(errorName);
        if (isRetry) {
            lines.unshift("Hmm, that still didn't work.");
        }
        teddyRef.current?.showTextSequence(TeddyAnimations.SADNESS, lines, () => {
            fadingPanelRef.current?.showStartPanel();
        });
    }

    function tryAgain() {
        if (isTrying.current) {
            return;
        }
        isTrying.current = true;
        fadingPanelRef.current?.showPanel(null);
        CurrentSessionData.logEvent("cameraRetry");
        getCameraStream()
            .then(() => {
                CurrentSessionData.logEvent("cameraWorking");
                teddyRef.current?.showText(TeddyAnimations.SUCCESS, "That did it! Let's keep going.", false, () => {
                    navigate(state.returnTo);
                });
            })
            .catch((error) => {
                isTrying.current = false;
                CurrentSessionData.logEvent("cameraError", error.name);
                explain(error.name, true);
            });
    }

    function giveUp() {
        CurrentSessionData.logEvent("cameraUnavailable", state.errorName);
        CurrentSessionData.uploadToServer("cameraUnavailable");
        stopCameraStream();
        setCanLeavePageSafely();
        fadingPanelRef.current?.showPanel(null);
        const nextURL = CurrentSessionData.nextURL;
        if (nextURL) {
            teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
                ["That's okay. Thanks for trying!", "Press the button to continue."],
                () => {
                    fadingPanelRef.current?.showStartPanel("continue");
                });
        } else {
            teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
                ["That's okay. Thanks for trying!", "You can close this tab now."],
                () => {
                    teddyRef.current?.playAnimation(TeddyAnimations.WAVE);
                });
        }
    }

    const onMount = useEffectEvent((removers: (() => void)[]) => {
        explain(state.errorName, false);

        // Where the browser can tell us, try again on our own as soon as the
        // participant allows the camera and microphone in the browser's settings.
        for (const name of ["camera", "microphone"]) {
            navigator.permissions?.query({name: name as PermissionName})
                .then((status) => {
                    const onChange = () => {
                        if (status.state == "granted") {
                            tryAgain();
                        }
                    };
                    status.addEventListener("change", onChange);
                    removers.push(() => status.removeEventListener("change", onChange));
                })
                .catch(() => {
                    // This browser can't report this permission. The button still works.
                });
        }
    });

    useEffect(() => {
        const removers: (() => void)[] = [];
        onMount(removers);
        return () => {
            for (const remove of removers) {
                remove();
            }
        };
    }, []);

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SADNESS}
            />
            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button onClick={(_e) => { tryAgain(); }}>
                        Try Again
                    </button>
                    <button onClick={(_e) => { giveUp(); }}>
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
