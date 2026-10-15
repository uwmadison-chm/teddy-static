import {useAnimatedNavigate} from "@/utils/utils"
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";
import {useCallback, useEffect, useRef, useState} from "react";
import {UserVideo, type UserVideoFunctions} from "@/components/UserVideo.tsx";
import {MicrophoneLevelIndicator} from "@/components/MicrophoneLevelIndicator.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {questions, type Choice, type QuestionItem} from "virtual:teddy-study";

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
    const questionIDs = useRef(CurrentSessionData.getCurrentModuleArgs());
    const currentQuestionIndex = useRef(0);

    // The question whose answers are showing, and where it is in the module.
    const [shown, setShown] = useState<{question: QuestionItem, number: number, of: number} | null>(null);

    useEffect(() => {
        if (teddyRef != null) {

            console.log("Starting questionnaire module with questions:", questionIDs.current)

            CurrentSessionData.logEvent("questionnaireScreenStarted", questionIDs.current.toString())

            const questionDescription = questionIDs.current.length == 1 ?
                "a quick question" : "a few quick questions";
            teddyRef.current.showTextSequence(TeddyAnimations.WAVE_SHORT,
                [`For this next part, I have ${questionDescription} for you.`,
                    "Just pick the answer that fits best.",
                    "And please keep your face in frame the whole time!"],
                () => {
                    fadingPanelRef.current?.showStartPanel()
                }
            );
        }
    }, [teddyRef])

    const onVideoInitialized = useCallback(() => {
        microphoneIndicatorRef.current.start()
    }, [])

    const completeModule = useCallback(() => {
        const hasMoreModules = CurrentSessionData.hasMoreModules()
        teddyRef.current.playAnimation(TeddyAnimations.IDLE);
        if (hasMoreModules) {
            teddyRef.current?.showTextSequence(TeddyAnimations.SUCCESS,
                [
                    "Thanks for sharing that with me!",
                    "Shall we go to the next module?",
                ],
                () => {
                    CurrentSessionData.logEvent("questionnaireScreenNextModule")
                    fadingPanelRef.current.showStartPanel("nextModule");
            });
        } else {
            teddyRef.current?.showTextSequence(TeddyAnimations.SUCCESS,
                [
                    "Thanks for sharing that with me!",
                    "It's time to finish up our session.",
                ],
                () => {
                    CurrentSessionData.logEvent("questionnaireScreenFinishSession")
                    fadingPanelRef.current.showStartPanel("finishSession");
                });
        }
    }, [])

    function startQuestionnaire() {
        CurrentSessionData.logEvent("questionnaireRecordingStarted", questionIDs.current.toString())
        userVideoRef.current.record({kind: "questionnaire", item: questionIDs.current.toString()}, () => {
            CurrentSessionData.logEvent("questionnaireRecordingEnded", questionIDs.current.toString())
        })
        askCurrentQuestion();
    }

    // Teddy asks the question, and its answers appear once the question has
    // finished typing out (or been tapped through).
    function askCurrentQuestion() {
        const index = currentQuestionIndex.current;
        const current = questions[questionIDs.current[index]];
        fadingPanelRef.current?.showPanel(null, () => {});
        CurrentSessionData.logEvent("questionShown",
            {id: current.id, text: current.text, responses: current.responses, choices: current.choices})
        teddyRef.current.showText(TeddyAnimations.LISTEN, current.text, false, () => {
            // Unless the participant has somehow moved on since
            if (currentQuestionIndex.current == index) {
                setShown({question: current, number: index + 1, of: questionIDs.current.length});
                fadingPanelRef.current?.showPanel("answers");
            }
        })
    }

    function answer(current: QuestionItem, choice: Choice) {
        CurrentSessionData.logEvent("questionAnswered", {
            id: current.id,
            text: current.text,
            responses: current.responses,
            choices: current.choices,
            code: choice.code,
            label: choice.label,
        });
        currentQuestionIndex.current += 1;
        if (currentQuestionIndex.current >= questionIDs.current.length) {
            userVideoRef.current.stop();
            fadingPanelRef.current?.showPanel(null, () => {});
            completeModule();
        } else {
            askCurrentQuestion();
        }
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
                    <button
                            onClick={(_e) => {
                                startQuestionnaire()
                            }}>
                        Okay
                    </button>
                </FadingPanel>
                {/* The question's text is in Teddy's speech bubble; the group's
                    label repeats it for screen readers, which land on the first
                    answer. */}
                <FadingPanel label={"answers"}
                             role={"group"}
                             aria-label={shown ?
                                 `Question ${shown.number} of ${shown.of}: ${shown.question.text}` :
                                 undefined}>
                    {shown?.question.choices.map((choice) =>
                        <button key={shown.number + "|" + choice.code}
                                onClick={(_e) => {
                                    answer(shown.question, choice)
                                }}>
                            {choice.label}
                        </button>
                    )}
                </FadingPanel>
                <FadingPanel label={"nextModule"}>
                    <button
                            onClick={(_e) => {
                                CurrentSessionData.navigateToNextModule(navigate)
                            }}>
                        To The Next Module!
                    </button>
                </FadingPanel>
                <FadingPanel label={"finishSession"}>
                    <button
                            onClick={(_e) => {
                                CurrentSessionData.navigateToNextModule(navigate)
                            }}>
                        Sounds Great!
                    </button>
                </FadingPanel>
            </FadingPanelSet>

        </div>

    );
}
