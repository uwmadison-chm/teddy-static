import {useAnimatedNavigate} from "@/utils/utils"
import {useEffect, useRef} from "react";
import {Teddy, TeddyAnimations, type TeddyFunctions} from "@/components/Teddy.tsx";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {useNavigate} from "react-router";


export default function IntroScreen() {
    const navigate = useAnimatedNavigate();
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);
    const hasAskedForPermissions = useRef(false)

    const hasExpired = CurrentSessionData.hasExpired();
    const noFadeNavigate = useNavigate();

    useEffect(() => {
        if (hasExpired) {
            noFadeNavigate("sessionexpired");
        }

        hasAskedForPermissions.current = false;
        teddyRef.current?.showTextSequence(TeddyAnimations.WAVE,
          ["Hello there! It's great to see you!", "We'd like you to do a quick interaction using the camera.", "It should take a couple minutes and should be done in one sitting."],
          () => {
              fadingPanelRef.current.showStartPanel()
          }
        );

    }, [])

    async function checkForCameraPermissions() {
        const status = await navigator.permissions.query({name: "camera"});
        if (status.state == "prompt") {
            const firstPromptText = "Your browser is about to ask for camera permissions. Please allow it or this won't work!";
            const subsequentPromptText = "Let's try this again! Please allow camera permissions."
            teddyRef.current?.showText(null,
                hasAskedForPermissions.current ? subsequentPromptText : firstPromptText,
                false,
                () => {
                    hasAskedForPermissions.current = true;
                    navigator.mediaDevices
                        .getUserMedia({ video: true, audio: true })
                        .then((localMediaStream) => {
                            checkForCameraPermissions()
                        })
                        .catch((error) => {
                            checkForCameraPermissions()
                        });
                }
            );

        }
        if (status.state == "granted") {
            teddyRef.current?.showText(TeddyAnimations.SLIGHTLY_HAPPY,
                "Great! Let's start up that camera!",
                false,
                () => {
                    CurrentSessionData.logEvent("introComplete")
                    CurrentSessionData.uploadToServer("introComplete")
                    navigate("calibration");
                }
            );
        }
        if (status.state == "denied") {
            teddyRef.current?.showTextSequence(TeddyAnimations.SADNESS,
                ["Looks like you denied camera access", "Please enable camera access for this page or we can't continue!"],
                () => {
                    status.addEventListener("change", (evt) => {
                        checkForCameraPermissions()
                    }, { once: true });
                }
            );
        }
    }

    if (hasExpired) {
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
                                checkForCameraPermissions().then(()=> {
                                })
                            }}>
                        Okay! Let's Do It!
                    </button>
                </FadingPanel>
            </FadingPanelSet>

        </div>
    );
}
