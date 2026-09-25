import {saveBlob, useAnimatedNavigate} from "@/utils/utils"
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

export default function CalibrationScreen() {
    const navigate = useAnimatedNavigate();
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);
    const userVideoRef = useRef<UserVideoFunctions>(null);
    const faceDetectorRef = useRef(null);
    const microphoneIndicatorRef = useRef(null);

    const timerCompleteAudioRef = useRef(null);
    const calibrationPrepTimer = useRef(null);
    const calibrationTimer = useRef(null);

    const faceDetectButtonDelayTimeout = useRef(null);

    const [tryingToDetectFace, setTryingToDetectFace] = useState<boolean>(true);
    const postDetectFaceTimeoutRef = useRef<any>(null);


    useEffect(() => {
        teddyRef.current?.showTextSequence(TeddyAnimations.PEERING,
            ["Checking to see if I can detect your face..."],
            () => {
            }
        );
        if (teddyRef != null && faceDetectButtonDelayTimeout.current == null) {
            faceDetectButtonDelayTimeout.current = setTimeout(() => {
                fadingPanelRef.current.showStartPanel()
            }, 9000);
        }
        return () => {
            if (postDetectFaceTimeoutRef.current != null) {
                userVideoRef.current.stop();
                clearTimeout(postDetectFaceTimeoutRef.current);
            }
        }
    }, [teddyRef])

    const onVideoInitialized = useCallback(() => {
        userVideoRef.current.record((blob)=>{
            CurrentSessionData.logEvent("faceDetectComplete")
            VideoUploader.upload(blob, "faceDetect")
        }, 15000)

        CurrentSessionData.logEvent("faceDetectStart")

        faceDetectorRef.current.start()
        microphoneIndicatorRef.current.start()

        if (timerCompleteAudioRef.current == null) {
            timerCompleteAudioRef.current = new Audio("/static/audio/timer_complete.mp3")
        }
    }, [])

    function afterFaceDetected() {

        // This seems weird, but if we go straight from listening to success, his eyebrow loops. So we go to idle quickly first.
        teddyRef.current?.playAnimation(TeddyAnimations.IDLE)
        setTimeout(()=>{
            teddyRef.current?.showTextSequence(TeddyAnimations.SUCCESS,
                [
                    "There you are! You look wonderful!",
                    "Next, I'd like you to close your eyes and relax your face.",
                    "You'll see a countdown, during which you should close your eyes.",
                    "Keep them closed and keep your face relaxed until you hear a gong. (After about 8 seconds)",
                    "Ready?",
                ],
                () => {
                    fadingPanelRef.current.showStartPanel("startFaceCalibration");
                }
            );
        }, 100)
    }

    useEffect(() => {
        if (!tryingToDetectFace) {
            // Face detected!

            CurrentSessionData.logEvent("faceDetected")
            clearTimeout(faceDetectButtonDelayTimeout.current)
            faceDetectButtonDelayTimeout.current = null

            fadingPanelRef.current.showPanel(null, ()=> {
            })
            faceDetectorRef.current.hide();


            if (userVideoRef.current.getIsRecording()) {
                postDetectFaceTimeoutRef.current = setTimeout(() => {
                    userVideoRef.current.stop();
                    postDetectFaceTimeoutRef.current = null;
                }, 5000)
            }
            afterFaceDetected()
        }
    }, [tryingToDetectFace]);

    const startFaceCalibrationPrep = () => {

        if (postDetectFaceTimeoutRef.current != null) {
            clearTimeout(postDetectFaceTimeoutRef.current);
            postDetectFaceTimeoutRef.current = null;
            userVideoRef.current.stop();
        }

        CurrentSessionData.logEvent("calibrationStart")
        fadingPanelRef.current.showPanel(null, ()=> {})
        teddyRef.current?.showText(TeddyAnimations.LISTEN, "Close your eyes and calm your face.", false, () => {
            calibrationPrepTimer.current.start()
        })
        userVideoRef.current.record((blob)=>{
            CurrentSessionData.logEvent("calibrationRecordComplete")
            VideoUploader.upload(blob, "faceCalibration")
        })
    }
    const onCalibrationPrepComplete = () => {
        CurrentSessionData.logEvent("calibrationRecordStart")
        teddyRef.current?.showText(TeddyAnimations.LISTEN, "Keep your eyes closed and face calm.")
        calibrationPrepTimer.current.hide()
        calibrationTimer.current.start()
    }
    const onCalibrationComplete = () => {
        CurrentSessionData.logEvent("calibrationComplete")
        timerCompleteAudioRef.current.play();
        userVideoRef.current.stop()
        calibrationTimer.current.fadeOut()

        teddyRef.current?.playAnimation(TeddyAnimations.IDLE);

        const hasMoreModules = CurrentSessionData.hasMoreModules()
        const teddyTexts = hasMoreModules ?
            [
                "Let's continue to the next activity."
            ] :
            [
                "You're all done! Let's quickly finish up our session."
            ]

        teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
            [
                "Keep it up!",
            ].concat(teddyTexts),
            () => {
                CurrentSessionData.logEvent("calibrationScreenComplete")
                if (hasMoreModules) {
                    fadingPanelRef.current.showPanel("nextModule", ()=> {})
                } else {
                    fadingPanelRef.current.showPanel("finishSession", ()=> {})
                }
            }
        );

    }

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                isSmallTeddy={true}
                initialAnimation={TeddyAnimations.PEERING}
            />
            <UserVideo ref={userVideoRef} onInitialized={onVideoInitialized} />

            <MicrophoneLevelIndicator ref={microphoneIndicatorRef} />

            <FaceDetector
                ref={faceDetectorRef}
                          detectionDuration={3000}
                          onDetected={() => {
                setTryingToDetectFace(false)
            }} />

            <CountdownTimer
                ref={calibrationPrepTimer}
                duration={3000}
                countUp={true}
                startColor={Colors.countdownTimer}
                endColor={Colors.countdownTimerDark}
                onComplete={() => {
                    onCalibrationPrepComplete()
                }} />

            <CountdownTimer
                ref={calibrationTimer}
                duration={5000}
                onComplete={() => {
                    onCalibrationComplete()
                }} />

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button
                            onClick={(_e) => {
                                CurrentSessionData.logEvent("faceDetectBypassed")
                                setTryingToDetectFace(false)
                            }}>
                        I'm Here!
                    </button>
                </FadingPanel>
                <FadingPanel label={"startFaceCalibration"}>
                    <button
                            onClick={(_e) => {
                                startFaceCalibrationPrep()
                            }}>
                        Let's Do This!
                    </button>
                </FadingPanel>
                <FadingPanel label={"nextModule"}>
                    <button
                            onClick={(_e) => {
                                CurrentSessionData.navigateToNextModule(navigate)
                            }}>
                        I'm So Ready!
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
