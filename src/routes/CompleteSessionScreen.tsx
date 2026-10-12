import {useEffect, useRef, useState} from "react";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import * as pig from "@/data/pig.ts";
import {CurrentSessionData, setCanLeavePageSafely} from "@/data/sessionData.tsx";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";
import {stopCameraStream} from "@/data/camera.ts";


export default function CompleteSessionScreen() {
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);

    // Bytes still to send, and the most there have been, for the progress bar.
    const [bytesLeft, setBytesLeft] = useState<number>(0);
    const [bytesMost, setBytesMost] = useState<number>(0);
    const [sending, setSending] = useState<boolean>(true);
    const sentRef = useRef<Promise<void>>(null);

    function onVideosCompletedUploaded(didUpload:boolean) {
        const nextURL = CurrentSessionData.nextURL;
        if (!nextURL) {
            setCanLeavePageSafely()
        }

            const firstText = didUpload ?
                ["Uploads complete! Hooray! Thank you for waiting."] :
                []
            const secondText = nextURL == null ?
                [
                    "You're all set! Thank you for your time. You may close this tab at any time. Bye bye!",
                ] :
                [
                    "Please press this button to continue your session. Bye!"
                ]
        teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
            firstText.concat(secondText),
            () => {
                if (nextURL) {
                    fadingPanelRef.current.showStartPanel()
                }
                teddyRef.current?.playAnimation(TeddyAnimations.WAVE)
            })
    }

    useEffect(() => {
        CurrentSessionData.complete()
        stopCameraStream()
        sentRef.current = pig.finishRun((pending) => {
            setBytesLeft(pending.bytes);
            setBytesMost((most) => Math.max(most, pending.bytes));
        }).catch((error) => {
            console.error("Couldn't finish sending to pig:", error);
        }).finally(() => {
            setSending(false);
        });

        teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
            ["You're all finished! Hooray!"],
            () => {
                let waited = false;
                const timer = window.setTimeout(() => {
                    // Still sending: say so, rather than go quiet.
                    waited = true;
                    teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
                        [
                            "We just have to wait for your videos to finish sending.",
                            "Please don't close this window until they're done.",
                        ]);
                }, 500);
                sentRef.current.then(() => {
                    clearTimeout(timer);
                    onVideosCompletedUploaded(waited);
                });
            }
        );
    }, [teddyRef]);

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SLIGHTLY_HAPPY}
            />

            <div className={"loader-wrapper"} style={{display: sending ? "block" : "none"}}>
                <div className="loader"></div>
                Sending...
                {bytesMost > 0 && <div className={"send-progress"}>
                    <div className={"bar"} style={{width: (100 * (1 - bytesLeft / bytesMost)) + "%"}} />
                </div>}
                {bytesLeft > 0 && <div className={"send-progress-text"}>{(bytesLeft / 1e6).toFixed(1)} MB to go</div>}
            </div>

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button
                            onClick={(_e)=>{
                                setCanLeavePageSafely()
                                window.location.assign(CurrentSessionData.nextURL);
                            }}>
                        Continue to REDCap
                    </button>
                </FadingPanel>
            </FadingPanelSet>


        </div>
    );
}
