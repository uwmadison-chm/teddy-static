import {useAnimatedNavigate} from "@/utils/utils"
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";
import {useCallback, useRef} from "react";
import {UserVideo, type UserVideoFunctions} from "@/components/UserVideo.tsx";
import {MicrophoneLevelIndicator} from "@/components/MicrophoneLevelIndicator.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {videoLogPrompts} from "virtual:teddy-study";
import {PromptText, type PromptTextFunctions} from "@/components/PromptText.tsx";
import {FaQuestionCircle} from "react-icons/fa";
import {firstOf, sleep, useChoice, useScript} from "@/utils/script.ts";

const BUTTON_POPUP_DELAY = 5000;
const MAX_RECORDING_DURATION = 90 * 1000;

export default function VideoLogScreen() {

    // Use this to test module outside of normal flow
    if (CurrentSessionData.currentModule < 0) {
        // eslint-disable-next-line react-hooks/immutability
        CurrentSessionData.currentModule = 0;
    }

    const navigate = useAnimatedNavigate();
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);
    const userVideoRef = useRef<UserVideoFunctions>(null);
    const microphoneIndicatorRef = useRef(null);
    const promptTextRef = useRef<PromptTextFunctions>(null);
    const ready = useChoice();
    const startRecording = useChoice();
    const done = useChoice();
    const next = useChoice();

    useScript(async (signal) => {
        const teddy = teddyRef.current;
        const panels = fadingPanelRef.current;
        const promptIDs = CurrentSessionData.getCurrentModuleArgs();

        console.log("Starting videoLog module with prompts:", promptIDs)
        CurrentSessionData.startModule()

        const promptDescription = promptIDs.length == 1 ?
            "a prompt" : "a couple prompts";
        const promptWord = promptIDs.length == 1 ?
            "prompt" : "prompts";
        await teddy.say(TeddyAnimations.WAVE_SHORT,
            [`For this next part, I'm going to ask you ${promptDescription}.`,
                `Please talk about the ${promptWord} as long as you need.`,
                "And please keep your face in frame the whole time!"],
            signal);

        for (let index = 0; index < promptIDs.length; index++) {
            const id = promptIDs[index];
            if (index > 0) {
                teddy.playAnimation(TeddyAnimations.IDLE);
                const remaining = promptIDs.length - index;
                const promptDescription = remaining == 1 ?
                    "one more prompt" : `${remaining} more prompts`;
                await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY,
                    ["Keep it up!",
                        `You have ${promptDescription} to go. Let's go!`,
                        "Ready?"],
                    signal);
            }
            panels.showStartPanel();
            await ready.next(signal);

            // The prompt, and a moment to think about it before recording.
            const prompt = videoLogPrompts[id];
            CurrentSessionData.logEvent("item_shown", {item: prompt.id, text: prompt.text})
            teddy.say(TeddyAnimations.IDLE, "Please think about the following prompt and press the button when you're ready.")
            promptTextRef.current.showText(prompt.text, MAX_RECORDING_DURATION)
            panels.showPanel(null)
            await sleep(2000, signal);
            panels.showPanel("startRecordingButton");
            await startRecording.next(signal);

            promptTextRef.current.startTimer();
            const recording = userVideoRef.current.record({kind: "videolog", item: id},
                {timeout: MAX_RECORDING_DURATION, signal});
            teddy.say(TeddyAnimations.LISTEN, "Please answer the prompt out loud.", undefined, {skipAnimation: true})
            panels.showPanel(null);

            // The participant says when they're done, once the button shows up,
            // or the recording runs out of time.
            await firstOf(signal,
                () => recording.done,
                async (signal) => {
                    await sleep(BUTTON_POPUP_DELAY, signal);
                    panels.showStartPanel("completeRecordingButton");
                    await done.next(signal);
                    recording.stop("done_button");
                    await recording.done;
                });
            panels.showPanel(null);
            promptTextRef.current.hide()
        }

        teddy.playAnimation(TeddyAnimations.IDLE);
        const hasMoreModules = CurrentSessionData.hasMoreModules();
        await teddy.say(TeddyAnimations.SUCCESS,
            ["I knew you could do it!",
                hasMoreModules ? "Are you ready for the next module?" : "Now all we have to do is finish up our session."],
            signal);
        panels.showStartPanel(hasMoreModules ? "nextModule" : "finishSession");
        await next.next(signal);
        CurrentSessionData.navigateToNextModule(navigate);
    });

    const onVideoInitialized = useCallback(() => {
        microphoneIndicatorRef.current.start()
    }, [])

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                isSmallTeddy={true}
                initialAnimation={TeddyAnimations.IDLE}
            />
            <UserVideo ref={userVideoRef} onInitialized={onVideoInitialized} />

            <MicrophoneLevelIndicator ref={microphoneIndicatorRef} />

            <PromptText ref={promptTextRef}
                        className={"prompt-text videolog-prompt"}
                        children={<div className="prompt-icon">
                            <FaQuestionCircle aria-hidden={true} />
                        </div>}
                        >
            </PromptText>

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button onClick={() => ready.pick()}>
                        I'm Ready!
                    </button>
                </FadingPanel>
                <FadingPanel label={"startRecordingButton"}>
                    <button onClick={() => startRecording.pick()}>
                        Let's Start Recording
                    </button>
                </FadingPanel>
                <FadingPanel label={"completeRecordingButton"}>
                    <button onClick={() => done.pick()}>
                        I'm Done
                    </button>
                </FadingPanel>
                <FadingPanel label={"nextModule"}>
                    <button onClick={() => next.pick()}>
                        Let's Do This!
                    </button>
                </FadingPanel>
                <FadingPanel label={"finishSession"}>
                    <button onClick={() => next.pick()}>
                        Let's Finish Up!
                    </button>
                </FadingPanel>
            </FadingPanelSet>

        </div>

    );
}
