import {getRandomItem, removeItem, saveBlob, useAnimatedNavigate} from "@/utils/utils"
import {Teddy, TeddyAnimations, type TeddyFunctions} from "@/components/Teddy.tsx";
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
import {VideoUploader} from "@/data/videoUploader.tsx";
import {PromptText, type PromptTextFunctions} from "@/components/PromptText.tsx";
import * as React from "react";
import {FaQuestion, FaQuestionCircle} from "react-icons/fa";

const BUTTON_POPUP_DELAY = 5000;
const MAX_RECORDING_DURATION = 90 * 1000;

const TeddyVideoLogPrompts = {
    "01": "What were you just doing and how are you feeling?",
    "02": "Please, tell me about an emotional experience, pleasant or unpleasant, that you had in the last week. Describe how it made you feel.",
    "03": "What are you looking forward to today?",
    "04": "What are you looking forward to this week?",
}

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
    const promptIDs = useRef(CurrentSessionData.getCurrentModuleArgs());
    const currentPromptIndex = useRef(0);

    const promptTextRef = useRef<PromptTextFunctions>(null);

    const completeButtonDelayTimeout = useRef(null);

    const [isRecording, setIsRecording] = useState(false);

    useEffect(() => {
        if (teddyRef != null) {

            if (!promptIDs.current.length) {
                promptIDs.current.push(getRandomItem(Object.keys(TeddyVideoLogPrompts)))
                const remainingPrompts = Object.keys(TeddyVideoLogPrompts).slice()
                removeItem(remainingPrompts, promptIDs.current[0])
                promptIDs.current.push(getRandomItem(remainingPrompts))
            }

            console.log("Starting videoLog module with prompts:", promptIDs.current)

            CurrentSessionData.logEvent("videoLogScreenStarted", promptIDs.current.toString())

            const promptDescription = promptIDs.current.length == 1 ?
                "a prompt" : "a couple prompts";
            const promptWord = promptIDs.current.length == 1 ?
                "prompt" : "prompts";
            teddyRef.current.showTextSequence(TeddyAnimations.WAVE_SHORT,
                [`For this next part, I'm going to ask you ${promptDescription}.`,
                    `Please talk about the ${promptWord} as long as you need.`,
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
                    "I knew you could do it!",
                    "Are you ready for the next module?",
                ],
                () => {
                    CurrentSessionData.logEvent("videoLogScreenNextModule")
                    fadingPanelRef.current.showStartPanel("nextModule");
            });
        } else {
            teddyRef.current?.showTextSequence(TeddyAnimations.SUCCESS,
                [
                    "I knew you could do it!",
                    "Now all we have to do is finish up our session.",
                ],
                () => {
                    CurrentSessionData.logEvent("videoLogScreenFinishSession")
                    fadingPanelRef.current.showStartPanel("finishSession");
                });
        }
    }, [])

    const introduceNextPrompt = useCallback(() => {
        currentPromptIndex.current = currentPromptIndex.current + 1;
        teddyRef.current.playAnimation(TeddyAnimations.IDLE);
        const remainingPrompts = promptIDs.current.length - currentPromptIndex.current;

        const promptDescription = remainingPrompts == 1 ?
            "one more prompt" : `${remainingPrompts} more prompts`;

        teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
            [
                "Keep it up!",
                `You have ${promptDescription} to go. Let's go!`,
                "Ready?",
            ],
            () => {
                fadingPanelRef.current?.showStartPanel()
            }
        );

    }, [])

    function showPrompt() {
        if (completeButtonDelayTimeout.current != null) {
            clearTimeout(completeButtonDelayTimeout.current);
            completeButtonDelayTimeout.current = null
        }
        CurrentSessionData.logEvent("videoLogPromptShown", promptIDs.current[currentPromptIndex.current])

        teddyRef.current.showText(TeddyAnimations.IDLE, "Please think about the following prompt and press the button when you're ready.")

        promptTextRef.current.showText(TeddyVideoLogPrompts[promptIDs.current[currentPromptIndex.current]], MAX_RECORDING_DURATION)

        fadingPanelRef.current?.showPanel(null)
        setTimeout(()=>{
            fadingPanelRef.current?.showPanel("startRecordingButton");
        }, 2000)

    }

    function startPromptRecording() {
        setIsRecording(true)
        promptTextRef.current.startTimer();

        CurrentSessionData.logEvent("videoLogRecordingStarted", promptIDs.current[currentPromptIndex.current])
        userVideoRef.current.record((blob)=> {
            CurrentSessionData.logEvent("videoLogRecordingEnded", promptIDs.current[currentPromptIndex.current])
            VideoUploader.upload(blob, "videoLog", promptIDs.current[currentPromptIndex.current])

            if (completeButtonDelayTimeout.current != null) {
                clearTimeout(completeButtonDelayTimeout.current);
                completeButtonDelayTimeout.current = null
            }
            fadingPanelRef.current?.showPanel(null, ()=>{});

            promptTextRef.current.hide()

            setIsRecording(false);
            promptTextRef.current.hide()
            if (currentPromptIndex.current + 1 >= promptIDs.current.length) {
                completeModule();
            } else {
                introduceNextPrompt();
            }
        }, MAX_RECORDING_DURATION)

        completeButtonDelayTimeout.current = setTimeout(() => {
            fadingPanelRef.current.showStartPanel("completeRecordingButton")
        }, BUTTON_POPUP_DELAY)

        teddyRef.current.showText(TeddyAnimations.LISTEN, "Please answer the prompt out loud.", true)
        fadingPanelRef.current?.showPanel(null, ()=>{});

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
                        className={"prompt-text videolog-prompt"}
                        children={<div className="prompt-icon">
                            <FaQuestionCircle />
                        </div>}
                        >
            </PromptText>

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button
                            onClick={(_e) => {
                                showPrompt()
                            }}>
                        I'm Ready!
                    </button>
                </FadingPanel>
                <FadingPanel label={"startRecordingButton"}>
                    <button
                        onClick={(_e) => {
                            startPromptRecording()
                        }}>
                        Let's Start Recording
                    </button>
                </FadingPanel>
                <FadingPanel label={"completeRecordingButton"}>
                    <button
                            onClick={(_e) => {
                                CurrentSessionData.logEvent("completePromptButton", promptIDs.current[currentPromptIndex.current])
                                userVideoRef.current.stop()
                            }}>
                        I'm Done
                    </button>
                </FadingPanel>
                <FadingPanel label={"nextModule"}>
                    <button
                            onClick={(_e) => {
                                CurrentSessionData.navigateToNextModule(navigate)
                            }}>
                        Let's Do This!
                    </button>
                </FadingPanel>
                <FadingPanel label={"finishSession"}>
                    <button
                            onClick={(_e) => {
                                CurrentSessionData.navigateToNextModule(navigate)
                            }}>
                        Let's Finish Up!
                    </button>
                </FadingPanel>
            </FadingPanelSet>

        </div>

    );
}
