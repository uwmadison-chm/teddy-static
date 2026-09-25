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
import * as React from "react";

const MAX_RATING_RECORDING_DURATION = 15000;
const MAX_RECORDING_DURATION = 120 * 1000;

// FIXME populate with your reels and their associated IDs.
const TeddyReels = {
    '01': '01.mp4',
}

export default function ReelsScreen() {

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
    const reelIDs = useRef(CurrentSessionData.getCurrentModuleArgs());
    const currentReelIndex = useRef(0);

    const videoElementsRef = useRef([]);
    const videoElementWrapperRef = useRef(null);
    const [videoWrapperShown, setVideoWrapperShown] = useState(false);

    const [isRecording, setIsRecording] = useState(false);

    useEffect(() => {
        if (teddyRef != null) {

            if (!reelIDs.current.length) {
                reelIDs.current.push(getRandomItem(Object.keys(TeddyReels)))
                const remainingReels = Object.keys(TeddyReels).slice()
                removeItem(remainingReels, reelIDs.current[0])
                reelIDs.current.push(getRandomItem(remainingReels))
            }

            if (!videoElementsRef.current.length) {
                for (const reelID of reelIDs.current) {
                    const videoElement = document.createElement('video');
                    videoElement.setAttribute('src', "/static/reels/" + TeddyReels[reelID]);
                    videoElement.load()
                    videoElement.addEventListener("playing", ()=> {
                        CurrentSessionData.logEvent("reelPlaying", reelID);
                    })
                    videoElement.addEventListener("stalled", ()=> {
                        CurrentSessionData.logEvent("reelStalled", reelID);
                    })
                    videoElement.addEventListener("ended", ()=> {
                        CurrentSessionData.logEvent("reelEnding", reelID);
                    })
                    videoElementsRef.current.push(videoElement);
                }
            }

            console.log("Starting reels module with reels:", reelIDs.current)

            CurrentSessionData.logEvent("reelsScreenStarted", reelIDs.current.toString())

            const reelDescription = reelIDs.current.length == 1 ?
                "a funny video" : "a couple funny videos";
            const reelWord = reelIDs.current.length == 1 ?
                "video" : "videos";
            teddyRef.current.showTextSequence(TeddyAnimations.WAVE_SHORT,
                [`For this next part, I'm going to show you ${reelDescription}.`,
                    `Please just watch the ${reelWord}, and rate it when it's done.`,
                    "And please keep your face in frame the whole time!"],
                () => {
                    fadingPanelRef.current?.showStartPanel()
                }
            );
        }
    }, [teddyRef])

    const onUserVideoInitialized = useCallback(() => {
        microphoneIndicatorRef.current.start()
    }, [])

    const completeModule = useCallback(() => {
        const hasMoreModules = CurrentSessionData.hasMoreModules()
        teddyRef.current.playAnimation(TeddyAnimations.IDLE);
        if (hasMoreModules) {
            teddyRef.current?.showTextSequence(TeddyAnimations.SUCCESS,
                [
                    "Thanks so much for your feedback!",
                    "Should we start the next module?",
                ],
                () => {
                    CurrentSessionData.logEvent("reelsScreenNextModule")
                    fadingPanelRef.current.showStartPanel("nextModule");
            });
        } else {
            teddyRef.current?.showTextSequence(TeddyAnimations.SUCCESS,
                [
                    "Thanks so much for your feedback!",
                    "Let's quickly finish up our session.",
                ],
                () => {
                    CurrentSessionData.logEvent("reelsScreenFinishSession")
                    fadingPanelRef.current.showStartPanel("finishSession");
                });
        }
    }, [])

    const rateReel = () => {
        teddyRef.current.playAnimation(TeddyAnimations.IDLE);
        teddyRef.current?.showText(TeddyAnimations.LISTEN, "What did you think of that video?",);
        fadingPanelRef.current?.showStartPanel("rateReel");

        setIsRecording(true);
        CurrentSessionData.logEvent("reelRatingRecordingStarted", reelIDs.current[currentReelIndex.current])
        const currentVideoID = reelIDs.current[currentReelIndex.current]
        userVideoRef.current.record((blob)=> {
            CurrentSessionData.logEvent("reelRatingRecordingEnded", currentVideoID)
            VideoUploader.upload(blob, "reelRating", currentVideoID)

            setIsRecording(false);
        }, MAX_RATING_RECORDING_DURATION)

    }

    const onRateCurrentReel = (rating:number) => {

        userVideoRef.current.stop()
        CurrentSessionData.rateReel(reelIDs.current[currentReelIndex.current], rating)
        CurrentSessionData.logEvent("ratedReel", reelIDs.current[currentReelIndex.current] + "|" + rating);
        console.log("Rated reel", reelIDs.current[currentReelIndex.current], rating);
        currentReelIndex.current = currentReelIndex.current + 1;
        fadingPanelRef.current.showPanel(null);

        if (currentReelIndex.current >= reelIDs.current.length) {
            completeModule();
        } else {
            // Let the buttons fade out a bit, and let the recording finish
            setTimeout(()=> {
                startReel()
            }, 400)
        }

    }

    function startReel() {
        setIsRecording(true)

        CurrentSessionData.logEvent("reelRecordingStarted", reelIDs.current[currentReelIndex.current])

        userVideoRef.current.record((blob)=> {
            CurrentSessionData.logEvent("reelRecordingEnded", reelIDs.current[currentReelIndex.current])
            VideoUploader.upload(blob, "reel", reelIDs.current[currentReelIndex.current])

            setIsRecording(false);

            setVideoWrapperShown(false);

            rateReel();

        }, MAX_RECORDING_DURATION)

        teddyRef.current.playAnimation(TeddyAnimations.WATCH_MOVIE)
        teddyRef.current.hideTextbox()
        fadingPanelRef.current?.showPanel(null, ()=>{});

        setVideoWrapperShown(true);
        const currentReel = videoElementsRef.current[currentReelIndex.current];
        currentReel.setAttribute("playsinline", true);
        currentReel.setAttribute("autoplay", true);
        videoElementWrapperRef.current.innerHTML = "";
        videoElementWrapperRef.current.appendChild(currentReel);
        currentReel.addEventListener("ended", () => {
            userVideoRef.current.stop()
        })
        console.log("playing reel", reelIDs.current[currentReelIndex.current], currentReel.getAttribute("src"));
        currentReel.play();
    }

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                isSmallTeddy={true}
                initialAnimation={TeddyAnimations.IDLE}
            />
            <UserVideo ref={userVideoRef} onInitialized={onUserVideoInitialized} />

            <MicrophoneLevelIndicator ref={microphoneIndicatorRef} />

            <div ref={videoElementWrapperRef}
                 style={{opacity: videoWrapperShown ? 1 : 0}}
                        className={"video-reel"}
                        >
            </div>

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button
                            onClick={(_e) => {
                                startReel()
                            }}>
                        Let's Watch!
                    </button>
                </FadingPanel>
                <FadingPanel label={"rateReel"}>
                    <button
                            onClick={(_e) => {
                                onRateCurrentReel(4)
                            }}>
                        🤣 Really Funny
                    </button>
                    <button
                        onClick={(_e) => {
                            onRateCurrentReel(3)
                        }}>
                        😄 Pretty Funny
                    </button>
                    <button
                        onClick={(_e) => {
                            onRateCurrentReel(2)
                        }}>
                        🫤 Not Funny
                    </button>
                    <button
                        onClick={(_e) => {
                            onRateCurrentReel(1)
                        }}>
                        😠 Hated It
                    </button>
                </FadingPanel>
                <FadingPanel label={"nextModule"}>
                    <button
                        onClick={(_e) => {
                            CurrentSessionData.navigateToNextModule(navigate)
                        }}>
                        Let's Go!
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
