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
import {FaceDetector, type FaceDetectorFunctions} from "@/components/FaceDetector.tsx";
import {MicrophoneLevelIndicator} from "@/components/MicrophoneLevelIndicator.tsx";
import {CountdownTimer, type CountdownTimerFunctions} from "@/components/CountdownTimer.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {chimeSource} from "@/data/chimePreload.ts";
import {errorFields} from "@/data/log.ts";
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
    const chimeCheck = useChoice<"heard" | "replay" | "notHeard">();
    const next = useChoice();

    useScript(async (signal) => {
        const teddy = teddyRef.current;
        const panels = fadingPanelRef.current;
        const video = userVideoRef.current;
        CurrentSessionData.calibrating = true;
        CurrentSessionData.startModule();

        // Look for a face. It's only there to help the participant frame
        // themselves, so after a while they can move on without one, and if
        // the detector can't run at all we just log it and carry on. Teddy said
        // what this is on the way in, and the face circle shows it, so he
        // stays quiet unless the participant needs tips.
        await abortable(video.ready(), signal);
        // Running out of time is how this recording usually ends.
        const faceRecording = video.record({kind: "face_check"}, {timeout: 15000, timeoutIsNormal: true, signal});
        CurrentSessionData.logEvent("face_check_started")
        const timerCompleteAudio = new Audio(chimeSource());
        // From the start each time, in case the last play hasn't finished.
        const playChime = (reason: string) => {
            timerCompleteAudio.currentTime = 0;
            timerCompleteAudio.play().catch((error) => {
                CurrentSessionData.logEvent("chime_play_failed", {reason, ...errorFields(error)}, "warning");
            });
        };
        const sawFace = await firstOf(signal,
            async (signal) => {
                const result = await faceDetectorRef.current.detect(signal, {
                    onTrouble: () => {
                        CurrentSessionData.logEvent("face_check_tips_shown")
                        teddy.say(TeddyAnimations.PEERING, "I can't quite see you yet. These might help.");
                    },
                });
                const summary = faceDetectorRef.current.summary();
                // Found despite a detector error or two is worth a look; not
                // running at all means the check didn't happen.
                CurrentSessionData.logEvent("face_check_result",
                    {result: result.found ? "found" : "unavailable", ...summary},
                    !result.found ? "error" : summary.detector_errors.length ? "warning" : "info")
                return result.found;
            },
            async (signal) => {
                await sleep(6000, signal);
                panels.showStartPanel();
                await bypass.next(signal);
                CurrentSessionData.logEvent("face_check_result", {result: "bypassed", ...faceDetectorRef.current.summary()}, "warning")
                return false;
            });

        panels.showPanel(null);
        faceDetectorRef.current.hide();
        // Keep a few seconds of the face, unless calibration starts first.
        sleep(5000, signal).then(() => faceRecording.stop("finished"), () => {});

        // This seems weird, but if we go straight from listening to success, his eyebrow loops. So we go to idle quickly first.
        teddy.playAnimation(TeddyAnimations.IDLE)
        await sleep(100, signal);

        // A session picked up on a revisit only needed the camera checked
        // again. It goes back to the start of the module it was on.
        if (CurrentSessionData.resuming) {
            await teddy.say(TeddyAnimations.SUCCESS,
                [
                    sawFace ?
                        "Your camera's working and I can see your face. You look great!" :
                        "I didn't see your face, but that's okay.",
                    "Let's pick up where you left off.",
                ],
                signal);
            panels.showPanel("nextModule");
            await next.next(signal);
            faceRecording.stop("finished");
            CurrentSessionData.navigateToNextModule(navigate);
            return;
        }

        await teddy.say(TeddyAnimations.SUCCESS,
            [
                // Only claim to see a face if the detector found one.
                sawFace ?
                    "Your camera's working and I can see your face. You look great!" :
                    "I didn't see your face, but that's okay. Let's keep going!",
                "Next, you'll see a countdown, during which you should close your eyes and relax your face.",
                // Play the chime once this line is all showing.
                ["Keep them closed and your face relaxed for about ten seconds, until you hear a chime, like this:",
                    () => playChime("sample")],
                "Did you hear the chime?",
            ],
            signal);

        // The chime is how they'll know to open their eyes, so make sure
        // their sound works. They can go on without it.
        let replays = 0;
        let heard: boolean;
        for (;;) {
            panels.showStartPanel(replays == 0 ? "chimeCheck" : "chimeCheckAgain");
            const answer = await chimeCheck.next(signal);
            if (answer != "replay") {
                heard = answer == "heard";
                break;
            }
            replays++;
            panels.showPanel(null);
            await teddy.say(TeddyAnimations.IDLE,
                [
                    "Make sure your sound is on and turned up.",
                    ["Here it is again:", () => playChime("replay")],
                    "Did you hear it that time?",
                ],
                signal);
        }
        CurrentSessionData.logEvent("chime_check_result",
            {result: heard ? "heard" : "not_heard", replays},
            heard ? "info" : "warning");

        panels.showPanel(null);
        await teddy.say(heard ? TeddyAnimations.SLIGHTLY_HAPPY : TeddyAnimations.IDLE,
            [
                heard ?
                    "Great!" :
                    "That's okay. Without the chime, count slowly to ten, then open your eyes.",
                "Ready?",
            ],
            signal);
        panels.showStartPanel("startFaceCalibration");
        await calibrate.next(signal);

        faceRecording.stop("finished");
        panels.showPanel(null);
        const calibrationRecording = video.record({kind: "eyes_closed"}, {signal});
        await teddy.say(TeddyAnimations.LISTEN, "Close your eyes and calm your face.", signal);
        CurrentSessionData.logEvent("eyes_closed_countdown_started")
        await abortable(calibrationPrepTimer.current.start(), signal);

        CurrentSessionData.logEvent("eyes_closed_started")
        teddy.say(TeddyAnimations.LISTEN, "Keep your eyes closed and face calm.")
        calibrationPrepTimer.current.hide()
        await abortable(calibrationTimer.current.start(), signal);

        CurrentSessionData.logEvent("eyes_closed_finished")
        playChime("finished");
        calibrationRecording.stop("finished")
        calibrationTimer.current.fadeOut()
        teddy.playAnimation(TeddyAnimations.IDLE);
        const hasMoreModules = CurrentSessionData.hasMoreModules()
        await teddy.say(TeddyAnimations.SLIGHTLY_HAPPY,
            [
                "Thanks, that looks great! You can open your eyes now.",
                hasMoreModules ?
                    "Let's continue to the next activity." :
                    "You're all done! Let's quickly finish up our session.",
            ],
            signal);
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
            >
                <UserVideo ref={userVideoRef} onInitialized={onVideoInitialized} />
            </Teddy>

            <MicrophoneLevelIndicator ref={microphoneIndicatorRef} />

            <FaceDetector
                ref={faceDetectorRef}
                detectionDuration={1000} />

            <CountdownTimer
                ref={calibrationPrepTimer}
                duration={3000}
                countUp={true}
                startColor={"var(--countdown-color)"}
                endColor={"var(--countdown-color-dark)"} />

            <CountdownTimer
                ref={calibrationTimer}
                duration={5000} />

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button onClick={() => bypass.pick()}>
                        Let's Continue Anyhow
                    </button>
                </FadingPanel>
                <FadingPanel label={"chimeCheck"}>
                    <button onClick={() => chimeCheck.pick("heard")}>
                        Yes, I Heard It!
                    </button>
                    <button onClick={() => chimeCheck.pick("replay")}>
                        Play It Again
                    </button>
                </FadingPanel>
                <FadingPanel label={"chimeCheckAgain"}>
                    <button onClick={() => chimeCheck.pick("heard")}>
                        Yes, I Heard It!
                    </button>
                    <button onClick={() => chimeCheck.pick("replay")}>
                        Play It Again
                    </button>
                    <button onClick={() => chimeCheck.pick("notHeard")}>
                        Continue Without Sound
                    </button>
                </FadingPanel>
                <FadingPanel label={"startFaceCalibration"}>
                    <button onClick={() => calibrate.pick()}>
                        Let's Do This!
                    </button>
                </FadingPanel>
                <FadingPanel label={"nextModule"}>
                    <button onClick={() => next.pick()}>
                        I'm Ready!
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
