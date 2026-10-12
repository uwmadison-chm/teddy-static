import {getRandomItem, removeItem, saveBlob, useAnimatedNavigate} from "@/utils/utils"
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
import {FaceDetector} from "@/components/FaceDetector.tsx";
import {MicrophoneLevelIndicator} from "@/components/MicrophoneLevelIndicator.tsx";
import {CountdownTimer} from "@/components/CountdownTimer.tsx";
import {Colors} from "@/utils/colors.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {TeddySentences} from "@/data/sentences.ts";
import {PromptText, type PromptTextFunctions} from "@/components/PromptText.tsx";

const BUTTON_POPUP_DELAY = 5000;
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
    const sentenceIDs = useRef(CurrentSessionData.getCurrentModuleArgs());
    const currentSentenceIndex = useRef(0);

    const promptTextRef = useRef<PromptTextFunctions>(null);

    const completeButtonDelayTimeout = useRef(null);

    const [isRecording, setIsRecording] = useState(false);

    useEffect(() => {
        if (teddyRef != null) {

            if (!sentenceIDs.current.length) {
                sentenceIDs.current.push(getRandomItem(Object.keys(TeddySentences)))
            }

            console.log("Starting sentence module with sentences:", sentenceIDs.current)

            CurrentSessionData.logEvent("sentenceScreenStarted", sentenceIDs.current.toString())

            const sentenceDescription = sentenceIDs.current.length == 1 ?
                "a sentence" : "a couple sentences";
            const sentenceWord = sentenceIDs.current.length == 1 ?
                "sentences" : "sentences";
            teddyRef.current.showTextSequence(TeddyAnimations.WAVE_SHORT,
                [`For this next part, I'm going to show you ${sentenceDescription}.`,
                    `Please read it out loud, then press the button when you're done.`,
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
                    "Amazing job!",
                    "Shall we go to the next module?",
                ],
                () => {
                    CurrentSessionData.logEvent("sentenceScreenNextModule")
                    fadingPanelRef.current.showStartPanel("nextModule");
            });
        } else {
            teddyRef.current?.showTextSequence(TeddyAnimations.SUCCESS,
                [
                    "Amazing job!",
                    "It's time to finish up our session.",
                ],
                () => {
                    CurrentSessionData.logEvent("sentenceScreenFinishSession")
                    fadingPanelRef.current.showStartPanel("finishSession");
                });
        }
    }, [])

    const introduceNextSentence = useCallback(() => {
        currentSentenceIndex.current = currentSentenceIndex.current + 1;
        teddyRef.current.playAnimation(TeddyAnimations.IDLE);
        const remainingSentences = sentenceIDs.current.length - currentSentenceIndex.current;

        const sentenceDescription = remainingSentences == 1 ?
            "one more sentence" : `${remainingSentences} more sentences`;

        teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
            [
                "That was perfect!",
                `You only have ${sentenceDescription} to read. Let's go!`,
                "Are you ready?",
            ],
            () => {
                fadingPanelRef.current?.showStartPanel()
            }
        );

    }, [])

    function startSentence() {
        setIsRecording(true)
        if (completeButtonDelayTimeout.current != null) {
            clearTimeout(completeButtonDelayTimeout.current);
            completeButtonDelayTimeout.current = null
        }
        CurrentSessionData.logEvent("sentenceRecordingStarted", sentenceIDs.current[currentSentenceIndex.current])

        userVideoRef.current.record({kind: "sentence", item: sentenceIDs.current[currentSentenceIndex.current]}, ()=> {
            CurrentSessionData.logEvent("sentenceRecordingEnded", sentenceIDs.current[currentSentenceIndex.current])

            if (completeButtonDelayTimeout.current != null) {
                clearTimeout(completeButtonDelayTimeout.current);
                completeButtonDelayTimeout.current = null
            }
            fadingPanelRef.current?.showPanel(null, ()=>{});

            setIsRecording(false);
            promptTextRef.current.hide()
            if (currentSentenceIndex.current + 1 >= sentenceIDs.current.length) {
                completeModule();
            } else {
                introduceNextSentence();
            }
        }, MAX_RECORDING_DURATION)

        completeButtonDelayTimeout.current = setTimeout(() => {
            fadingPanelRef.current.showStartPanel("completeRecordingButton")
        }, BUTTON_POPUP_DELAY)

        teddyRef.current.showText(TeddyAnimations.LISTEN, "Please read this sentence out loud then press the button.", true)
        fadingPanelRef.current?.showPanel(null, ()=>{});

        promptTextRef.current.showText(TeddySentences[sentenceIDs.current[currentSentenceIndex.current]], MAX_RECORDING_DURATION)
        promptTextRef.current.startTimer();
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

            <PromptText ref={promptTextRef}
                        />

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button
                            onClick={(_e) => {
                                startSentence()
                            }}>
                        Let's Read!
                    </button>
                </FadingPanel>
                <FadingPanel label={"completeRecordingButton"}>
                    <button
                            onClick={(_e) => {
                                CurrentSessionData.logEvent("completeSentenceButton", sentenceIDs.current[currentSentenceIndex.current])
                                userVideoRef.current.stop()
                            }}>
                        I've Read It Out Loud
                    </button>
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
