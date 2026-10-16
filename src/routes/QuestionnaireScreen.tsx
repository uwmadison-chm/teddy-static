import {useAnimatedNavigate} from "@/utils/utils"
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";
import * as React from "react";
import {useCallback, useRef, useState} from "react";
import {UserVideo, type UserVideoFunctions} from "@/components/UserVideo.tsx";
import {MicrophoneLevelIndicator} from "@/components/MicrophoneLevelIndicator.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {questions, type Choice, type QuestionItem} from "virtual:teddy-study";
import {useChoice, useScript} from "@/utils/script.ts";

// Self-report questions, asked one at a time in Teddy's speech bubble, each
// answered with one of its choices. The whole module is one recording, which
// stops at the study's recording limit if the participant takes that long;
// the questions carry on without it.
export default function QuestionnaireScreen() {

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
    const start = useChoice();
    const answers = useChoice<Choice>();
    const next = useChoice();

    // The question whose answers are showing, and where it is in the module.
    const [shown, setShown] = useState<{question: QuestionItem, number: number, of: number} | null>(null);

    useScript(async (signal) => {
        const teddy = teddyRef.current;
        const panels = fadingPanelRef.current;
        const questionIDs = CurrentSessionData.getCurrentModuleArgs();

        console.log("Starting questionnaire module with questions:", questionIDs)
        CurrentSessionData.startModule()

        const questionDescription = questionIDs.length == 1 ?
            "a quick question" : "a few quick questions";
        await teddy.say(TeddyAnimations.WAVE_SHORT,
            [`For this next part, I have ${questionDescription} for you.`,
                "Just pick the answer that fits best.",
                "And please keep your face in frame the whole time!"],
            signal);
        panels.showStartPanel();
        await start.next(signal);

        const recording = userVideoRef.current.record({kind: "questions", items: questionIDs}, {signal});

        // Teddy asks each question, and its answers appear once the question
        // has finished typing out (or been tapped through) and the last
        // answers have gone.
        for (let index = 0; index < questionIDs.length; index++) {
            const question = questions[questionIDs[index]];
            CurrentSessionData.logEvent("item_shown", {
                item: question.id,
                text: question.text,
                responses: question.responses,
                choices: question.choices,
                number: index + 1,
                of: questionIDs.length,
            })
            await Promise.all([
                panels.showPanel(null),
                teddy.say(TeddyAnimations.LISTEN, question.text, signal),
            ]);
            setShown({question, number: index + 1, of: questionIDs.length});
            panels.showPanel("answers");
            const choice = await answers.next(signal);
            CurrentSessionData.logEvent("response", {
                item: question.id,
                text: question.text,
                value: choice.code,
                label: choice.label,
                choices: question.choices,
            });
        }

        recording.stop("finished");
        panels.showPanel(null);
        teddy.playAnimation(TeddyAnimations.IDLE);
        const hasMoreModules = CurrentSessionData.hasMoreModules();
        await teddy.say(TeddyAnimations.SUCCESS,
            ["Thanks for sharing that with me!",
                hasMoreModules ? "Shall we go to the next module?" : "It's time to finish up our session."],
            signal);
        panels.showStartPanel(hasMoreModules ? "nextModule" : "finishSession");
        await next.next(signal);
        CurrentSessionData.navigateToNextModule(navigate);
    });

    const onVideoInitialized = useCallback(() => {
        microphoneIndicatorRef.current.start()
    }, [])

    // Up and down arrows move between the answers, wrapping around; Enter or
    // Space picks the focused one, as with any button.
    function onAnswersKeyDown(e: React.KeyboardEvent<HTMLElement>) {
        const buttons = Array.from(e.currentTarget.querySelectorAll("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next: number;
        switch (e.key) {
            case "ArrowDown":
                next = (index + 1) % buttons.length;
                break;
            case "ArrowUp":
                next = index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = buttons.length - 1;
                break;
            default:
                return;
        }
        e.preventDefault();
        buttons[next]?.focus();
    }

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                isSmallTeddy={true}
                initialAnimation={TeddyAnimations.IDLE}
            />
            <UserVideo ref={userVideoRef} onInitialized={onVideoInitialized} />

            <MicrophoneLevelIndicator ref={microphoneIndicatorRef} />

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button onClick={() => start.pick()}>
                        Okay
                    </button>
                </FadingPanel>
                {/* The question's text is in Teddy's speech bubble; the group's
                    label repeats it for screen readers, which land on the first
                    answer. */}
                <FadingPanel label={"answers"}
                             role={"group"}
                             onKeyDown={onAnswersKeyDown}
                             aria-label={shown ?
                                 `Question ${shown.number} of ${shown.of}: ${shown.question.text}` :
                                 undefined}>
                    {shown?.question.choices.map((choice) =>
                        <button key={shown.number + "|" + choice.code}
                                onClick={() => answers.pick(choice)}>
                            {choice.label}
                        </button>
                    )}
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
