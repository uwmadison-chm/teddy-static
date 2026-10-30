import {useAnimatedNavigate} from "@/utils/utils"
import {useRef} from "react";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {useNavigate} from "react-router";
import {askForCameraStream, lacksCamera} from "@/data/camera.ts";
import * as pig from "@/data/pig.ts";
import type {LinkProblemState} from "@/routes/LinkProblemScreen.tsx";
import type {CameraHelpState} from "@/routes/CameraHelpScreen.tsx";
import {abortable, Aborted, useChoice, useScript} from "@/utils/script.ts";


export default function IntroScreen() {
    const navigate = useAnimatedNavigate();
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);

    const hasExpired = CurrentSessionData.hasExpired();
    const hasLinkProblems = CurrentSessionData.linkProblems.length > 0;
    const noFadeNavigate = useNavigate();

    const go = useChoice();

    useScript(async (signal) => {
        if (hasExpired) {
            noFadeNavigate("sessionexpired");
            return;
        }
        if (hasLinkProblems) {
            noFadeNavigate("linkproblem");
            return;
        }
        const teddy = teddyRef.current;
        const panels = fadingPanelRef.current;

        // Start the run while Teddy talks, so it's usually ready by the time he's
        // done. pig refuses a run for a closed task or a link missing what the
        // task needs. Better to find out now than after the recordings.
        const started = pig.startRun();
        // A device with no camera can't do the session, so it shouldn't get
        // as far as the permission prompt.
        const noCamera = lacksCamera();
        await teddy.say(TeddyAnimations.WAVE,
            ["Hello there! It's great to see you!", "We'd like you to do a quick interaction using the camera.", "It should take a couple minutes and should be done in one sitting.", "When we start, your browser may ask to use your camera and microphone. Please allow both!"],
            signal);
        const failure = await abortable(started, signal);
        if (failure) {
            const state: LinkProblemState = {code: failure.code};
            navigate("linkproblem", {state});
            return;
        }
        if (await abortable(noCamera, signal)) {
            const state: CameraHelpState = {errorName: "NotFoundError", returnTo: "/calibration"};
            navigate("camerahelp", {state});
            return;
        }
        panels.showStartPanel();
        await go.next(signal);

        // Asking for the stream is the permission check: it works the same in
        // every browser, and it covers the microphone as well as the camera.
        // Teddy already said to allow it; anything he said now would be cut
        // off by the browser's prompt, so he waits quietly.
        panels.showPanel(null);
        teddy.hideTextbox();
        try {
            await abortable(askForCameraStream(), signal);
        } catch (error) {
            if (error instanceof Aborted) {
                throw error;
            }
            const state: CameraHelpState = {errorName: error.name, returnTo: "/calibration"};
            navigate("camerahelp", {state});
            return;
        }
        await teddy.say(TeddyAnimations.PEERING, "Now I'm going to check if I can see your face...", signal);
        navigate("calibration");
    });

    if (hasExpired || hasLinkProblems) {
        return (<div></div>)
    }

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.WAVE}
            />
            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button onClick={() => go.pick()}>
                        Okay! Let's Do It!
                    </button>
                </FadingPanel>
            </FadingPanelSet>

        </div>
    );
}
