import {useAnimatedNavigate} from "@/utils/utils"
import {useEffect, useEffectEvent, useRef} from "react";
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


export default function IntroScreen() {
    const navigate = useAnimatedNavigate();
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);

    const hasExpired = CurrentSessionData.hasExpired();
    const hasLinkProblems = CurrentSessionData.linkProblems.length > 0;
    const noFadeNavigate = useNavigate();

    const onMount = useEffectEvent(() => {
        if (hasExpired) {
            noFadeNavigate("sessionexpired");
            return;
        }
        if (hasLinkProblems) {
            noFadeNavigate("linkproblem");
            return;
        }

        teddyRef.current?.showTextSequence(TeddyAnimations.WAVE,
          ["Hello there! It's great to see you!", "We'd like you to do a quick interaction using the camera.", "It should take a couple minutes and should be done in one sitting."],
          () => {
              // pig refuses a run for a closed task or a link missing what the
              // task needs. Better to find out now than after the recordings.
              pig.startRun().then((failure) => {
                  if (failure) {
                      const state: LinkProblemState = {code: failure.code};
                      navigate("linkproblem", {state});
                  } else {
                      fadingPanelRef.current.showStartPanel()
                  }
              });
          }
        );
        // Start the run while Teddy talks, so it's usually ready by the time he's done.
        pig.startRun();
    });

    useEffect(() => {
        onMount();
    }, [])

    // Asking for the stream is the permission check: it works the same in every
    // browser, and it covers the microphone as well as the camera.
    function startCamera() {
        fadingPanelRef.current?.showPanel(null);
        teddyRef.current?.showText(null,
            "Your browser may ask to use your camera and microphone. Please allow both!",
            false);
        getCameraStream()
            .then(() => {
                teddyRef.current?.showText(TeddyAnimations.SLIGHTLY_HAPPY,
                    "Great! Let's start up that camera!",
                    false,
                    () => {
                        CurrentSessionData.logEvent("introComplete")
                        navigate("calibration");
                    }
                );
            })
            .catch((error) => {
                CurrentSessionData.logEvent("cameraError", error.name)
                const state: CameraHelpState = {errorName: error.name, returnTo: "/calibration"};
                navigate("camerahelp", {state});
            });
    }

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
                    <button
                            onClick={(_e)=>{
                                startCamera()
                            }}>
                        Okay! Let's Do It!
                    </button>
                </FadingPanel>
            </FadingPanelSet>

        </div>
    );
}
