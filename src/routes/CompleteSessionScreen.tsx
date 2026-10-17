import {useRef, useState} from "react";
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
import {firstOf, sleep, useScript} from "@/utils/script.ts";


export default function CompleteSessionScreen() {
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);

    // Bytes still to send, and the most there have been, for the progress bar.
    const [bytesLeft, setBytesLeft] = useState<number>(0);
    const [bytesMost, setBytesMost] = useState<number>(0);
    const [sending, setSending] = useState<boolean>(true);

    useScript(async (signal) => {
        const teddy = teddyRef.current;
        CurrentSessionData.complete()
        stopCameraStream()
        const sent = pig.finishRun((pending) => {
            setBytesLeft(pending.bytes);
            setBytesMost((most) => Math.max(most, pending.bytes));
        }).catch((error) => {
            console.error("Couldn't finish sending to pig:", error);
        }).finally(() => {
            setSending(false);
        });

        await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY, "You're all finished! Hooray!", signal);
        // Still sending: say so, rather than go quiet.
        const waited = await firstOf(signal,
            () => sent.then(() => false),
            async (signal) => {
                await sleep(500, signal);
                teddy.say(TeddyAnimations.SLIGHTLY_HAPPY,
                    [
                        "We just have to wait for your videos to finish sending.",
                        "Please don't close this window until they're done.",
                    ]);
                await sent;
                return true;
            });

        const nextURL = CurrentSessionData.nextURL;
        if (!nextURL) {
            setCanLeavePageSafely()
        }
        await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY,
            [
                ...(waited ? ["Uploads complete! Hooray! Thank you for waiting."] : []),
                nextURL == null ?
                    "You're all set! Thank you for your time. You may close this tab at any time. Bye bye!" :
                    "Please press this button to continue your session. Bye!",
            ],
            signal);
        if (nextURL) {
            fadingPanelRef.current.showStartPanel()
        }
        teddy.playAnimation(TeddyAnimations.WAVE)
    });

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SLIGHTLY_HAPPY}
            />

            <div className={"loader-wrapper"} hidden={!sending}>
                <div className="loader"></div>
                Sending...
                {bytesMost > 0 && <div className={"send-progress"}
                                       role={"progressbar"}
                                       aria-label={"Upload progress"}
                                       aria-valuemin={0}
                                       aria-valuemax={100}
                                       aria-valuenow={Math.round(100 * (1 - bytesLeft / bytesMost))}>
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
