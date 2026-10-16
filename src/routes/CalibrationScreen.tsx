import {useAnimatedNavigate} from "@/utils/utils"
import timerCompleteUrl from "@/assets/audio/timer_complete.mp3";
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
import {FaceDetector, type FaceDetectorFunctions} from "@/components/FaceDetector.tsx";
import {MicrophoneLevelIndicator} from "@/components/MicrophoneLevelIndicator.tsx";
import {CountdownTimer, type CountdownTimerFunctions} from "@/components/CountdownTimer.tsx";
import {Colors} from "@/utils/colors.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {abortable, firstOf, sleep, useChoice, useScript} from "@/utils/script.ts";

export default function CalibrationScreen() {
    const navigate = useAnimatedNavigate();
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);
    const userVideoRef = useRef<UserVideoFunctions>(null);
    const faceDetectorRef = useRef<FaceDetectorFunctions>(null);
    const microphoneIndicatorRef = useRef(null);
    const calibrationPrepTimer = useRef<CountdownTimerFunctions>(null);
    const calibrationTimer = useRef<CountdownTimerFunctions>(null);
    const bypass = useChoice();
    const calibrate = useChoice();
    const next = useChoice();

    useScript(async (signal) => {
        const teddy = teddyRef.current;
        const panels = fadingPanelRef.current;
        const video = userVideoRef.current;
        CurrentSessionData.calibrating = true;

        // Look for a face. If none turns up for a while, the participant can
        // say they're there.
        teddy.say(TeddyAnimations.PEERING, "Checking to see if I can detect your face...");
        await abortable(video.ready(), signal);
        const faceRecording = video.record({kind: "faceDetect"}, {timeout: 15000, signal});
        faceRecording.done.then(() => {
            CurrentSessionData.logEvent("faceDetectComplete")
        });
        CurrentSessionData.logEvent("faceDetectStart")
        const timerCompleteAudio = new Audio(timerCompleteUrl);
        await firstOf(signal,
            (signal) => faceDetectorRef.current.detect(signal),
            async (signal) => {
                await sleep(9000, signal);
                panels.showStartPanel();
                await bypass.next(signal);
                CurrentSessionData.logEvent("faceDetectBypassed")
            });

        CurrentSessionData.logEvent("faceDetected")
        panels.showPanel(null);
        faceDetectorRef.current.hide();
        // Keep a few seconds of the face, unless calibration starts first.
        sleep(5000, signal).then(faceRecording.stop, () => {});

        // This seems weird, but if we go straight from listening to success, his eyebrow loops. So we go to idle quickly first.
        teddy.playAnimation(TeddyAnimations.IDLE)
        await sleep(100, signal);
        await teddy.say(TeddyAnimations.SUCCESS,
            [
                "There you are! You look wonderful!",
                "Next, I'd like you to close your eyes and relax your face.",
                "You'll see a countdown, during which you should close your eyes.",
                "Keep them closed and keep your face relaxed until you hear a gong. (After about 8 seconds)",
                "Ready?",
            ],
            signal);
        panels.showStartPanel("startFaceCalibration");
        await calibrate.next(signal);

        faceRecording.stop();
        CurrentSessionData.logEvent("calibrationStart")
        panels.showPanel(null);
        const calibrationRecording = video.record({kind: "faceCalibration"}, {signal});
        calibrationRecording.done.then(() => {
            CurrentSessionData.logEvent("calibrationRecordComplete")
        });
        await teddy.say(TeddyAnimations.LISTEN, "Close your eyes and calm your face.", signal);
        await abortable(calibrationPrepTimer.current.start(), signal);

        CurrentSessionData.logEvent("calibrationRecordStart")
        teddy.say(TeddyAnimations.LISTEN, "Keep your eyes closed and face calm.")
        calibrationPrepTimer.current.hide()
        await abortable(calibrationTimer.current.start(), signal);

        CurrentSessionData.logEvent("calibrationComplete")
        timerCompleteAudio.play();
        calibrationRecording.stop()
        calibrationTimer.current.fadeOut()
        teddy.playAnimation(TeddyAnimations.IDLE);
        const hasMoreModules = CurrentSessionData.hasMoreModules()
        await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY,
            [
                "Keep it up!",
                hasMoreModules ?
                    "Let's continue to the next activity." :
                    "You're all done! Let's quickly finish up our session.",
            ],
            signal);
        CurrentSessionData.logEvent("calibrationScreenComplete")
        panels.showPanel(hasMoreModules ? "nextModule" : "finishSession");
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
                initialAnimation={TeddyAnimations.PEERING}
            />
            <UserVideo ref={userVideoRef} onInitialized={onVideoInitialized} />

            <MicrophoneLevelIndicator ref={microphoneIndicatorRef} />

            <FaceDetector
                ref={faceDetectorRef}
                detectionDuration={1000} />

            <CountdownTimer
                ref={calibrationPrepTimer}
                duration={3000}
                countUp={true}
                startColor={Colors.countdownTimer}
                endColor={Colors.countdownTimerDark} />

            <CountdownTimer
                ref={calibrationTimer}
                duration={5000} />

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button onClick={() => bypass.pick()}>
                        I'm Here!
                    </button>
                </FadingPanel>
                <FadingPanel label={"startFaceCalibration"}>
                    <button onClick={() => calibrate.pick()}>
                        Let's Do This!
                    </button>
                </FadingPanel>
                <FadingPanel label={"nextModule"}>
                    <button onClick={() => next.pick()}>
                        I'm So Ready!
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
