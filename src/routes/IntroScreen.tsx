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
import {getCameraStream} from "@/data/camera.ts";
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
        await teddy.say(TeddyAnimations.WAVE,
            ["Hello there! It's great to see you!", "We'd like you to do a quick interaction using the camera.", "It should take a couple minutes and should be done in one sitting."],
            signal);
        const failure = await abortable(started, signal);
        if (failure) {
            const state: LinkProblemState = {code: failure.code};
            navigate("linkproblem", {state});
            return;
        }
        panels.showStartPanel();
        await go.next(signal);

        // Asking for the stream is the permission check: it works the same in
        // every browser, and it covers the microphone as well as the camera.
        panels.showPanel(null);
        teddy.say(null, "Your browser may ask to use your camera and microphone. Please allow both!");
        try {
            await abortable(getCameraStream(), signal);
        } catch (error) {
            if (error instanceof Aborted) {
                throw error;
            }
            CurrentSessionData.logEvent("cameraError", error.name)
            const state: CameraHelpState = {errorName: error.name, returnTo: "/calibration"};
            navigate("camerahelp", {state});
            return;
        }
        await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY, "Great! Let's start up that camera!", signal);
        CurrentSessionData.logEvent("introComplete")
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
