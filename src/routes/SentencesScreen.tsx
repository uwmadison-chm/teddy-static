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
import {sentences} from "virtual:teddy-study";
import {PromptText, type PromptTextFunctions} from "@/components/PromptText.tsx";
import {firstOf, useChoice, useScript} from "@/utils/script.ts";

const MAX_RECORDING_DURATION = 60 * 1000;

export default function SentencesScreen() {

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
    const start = useChoice();
    const done = useChoice();
    const next = useChoice();

    useScript(async (signal) => {
        const teddy = teddyRef.current;
        const panels = fadingPanelRef.current;
        const sentenceIDs = CurrentSessionData.getCurrentModuleArgs();

        console.log("Starting sentence module with sentences:", sentenceIDs)
        CurrentSessionData.startModule()

        const sentenceDescription = sentenceIDs.length == 1 ?
            "a sentence" : "a couple sentences";
        await teddy.say(TeddyAnimations.WAVE_SHORT,
            [`For this next part, I'm going to show you ${sentenceDescription}.`,
                `Please read it out loud, then press the button when you're done.`,
                "And please keep your face in frame the whole time!"],
            signal);

        for (let index = 0; index < sentenceIDs.length; index++) {
            const id = sentenceIDs[index];
            if (index > 0) {
                teddy.playAnimation(TeddyAnimations.IDLE);
                const remaining = sentenceIDs.length - index;
                const sentenceDescription = remaining == 1 ?
                    "one more sentence" : `${remaining} more sentences`;
                await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY,
                    ["That was perfect!",
                        `You only have ${sentenceDescription} to read. Let's go!`,
                        "Are you ready?"],
                    signal);
            }
            panels.showStartPanel();
            await start.next(signal);

            const recording = userVideoRef.current.record({kind: "sentence", item: id},
                {timeout: MAX_RECORDING_DURATION, signal});
            teddy.say(TeddyAnimations.LISTEN, "Please read this sentence out loud then press the button.",
                undefined, {skipAnimation: true});
            panels.showPanel("completeRecordingButton");
            const sentence = sentences[id];
            CurrentSessionData.logEvent("item_shown", {item: sentence.id, text: sentence.text})
            promptTextRef.current.showText(sentence.text, MAX_RECORDING_DURATION)
            promptTextRef.current.startTimer();

            // The participant says when they're done, or the recording runs out
            // of time. The button is there from the start: one that shows up
            // partway through reads as a hint to wrap up.
            await firstOf(signal,
                () => recording.done,
                async (signal) => {
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
            ["Amazing job!",
                hasMoreModules ? "Shall we go to the next module?" : "It's time to finish up our session."],
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
            >
                <UserVideo ref={userVideoRef} onInitialized={onVideoInitialized} />
            </Teddy>

            <MicrophoneLevelIndicator ref={microphoneIndicatorRef} />

            <PromptText ref={promptTextRef}
                        />

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button onClick={() => start.pick()}>
                        Let's Read!
                    </button>
                </FadingPanel>
                <FadingPanel label={"completeRecordingButton"}>
                    <button onClick={() => done.pick()}>
                        I've Read It Out Loud
                    </button>
                </FadingPanel>
                <FadingPanel label={"nextModule"}>
                    <button onClick={() => next.pick()}>
                        To The Next Module!
                    </button>
                </FadingPanel>
                <FadingPanel label={"finishSession"}>
                    <button onClick={() => next.pick()}>
                        Sounds Great!
                    </button>
                </FadingPanel>
            </FadingPanelSet>

        </div>

    );
}
