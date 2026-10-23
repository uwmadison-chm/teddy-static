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

// How long the participant waits for sending, from when this screen starts,
// before Teddy offers the way out anyway, so a slow connection doesn't hold
// them here. Sending carries on while the page is open, and whatever's left
// when it closes stays on the device, for pig's client to send the next time
// Teddy runs there.
const SEND_WAIT_MS = 15_000;


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
        const waitUntil = Date.now() + SEND_WAIT_MS;
        const sent = pig.finishRun((pending) => {
            setBytesLeft(pending.bytes);
            setBytesMost((most) => Math.max(most, pending.bytes));
        }).catch((error) => {
            console.error("Couldn't finish sending to pig:", error);
        }).finally(() => {
            setSending(false);
        });

        const nextURL = CurrentSessionData.nextURL;
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
                await firstOf(signal,
                    () => sent,
                    async (signal) => {
                        await sleep(Math.max(0, waitUntil - Date.now()), signal);
                        // Too late for an event: the run is finalized.
                        console.warn("Still sending; offering the way out");
                        setCanLeavePageSafely();
                        await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY,
                            [
                                "Your videos are taking a while to send.",
                                "They'll keep sending for as long as this page is open.",
                                nextURL == null ?
                                    "If you can't wait, you can close this tab." :
                                    "If you can't wait, press the button below to continue.",
                            ],
                            signal);
                        if (nextURL) {
                            fadingPanelRef.current.showStartPanel();
                        }
                        await sent;
                    });
                return true;
            });

        if (!nextURL) {
            setCanLeavePageSafely()
        }
        await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY,
            [
                ...(waited ? ["Uploads complete! Hooray! Thank you for waiting."] : []),
                nextURL == null ?
                    "You're all set! Thank you for your time. You may close this tab at any time. Bye bye!" :
                    "Please press the button below to continue back to the surveys. Bye!",
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
                        Continue to Surveys
                    </button>
                </FadingPanel>
            </FadingPanelSet>


        </div>
    );
}
