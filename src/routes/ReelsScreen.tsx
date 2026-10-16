import {useAnimatedNavigate} from "@/utils/utils"
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";
import {useCallback, useRef, useState} from "react";
import {UserVideo, type UserVideoFunctions} from "@/components/UserVideo.tsx";
import {MicrophoneLevelIndicator} from "@/components/MicrophoneLevelIndicator.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import {reels} from "virtual:teddy-study";
import {sleep, useChoice, useScript} from "@/utils/script.ts";

const MAX_RATING_RECORDING_DURATION = 15000;
const MAX_RECORDING_DURATION = 120 * 1000;

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
    const videoElementWrapperRef = useRef(null);
    const [videoWrapperShown, setVideoWrapperShown] = useState(false);
    const start = useChoice();
    const rate = useChoice<number>();
    const next = useChoice();

    useScript(async (signal) => {
        const teddy = teddyRef.current;
        const panels = fadingPanelRef.current;
        const reelIDs = CurrentSessionData.getCurrentModuleArgs();

        // Load every reel now, so each is ready when its turn comes.
        const videoElements = reelIDs.map((reelID) => {
            const videoElement = document.createElement('video');
            videoElement.setAttribute('src', reels[reelID].url);
            videoElement.setAttribute("playsinline", "true");
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
            return videoElement;
        });
        // A video taken out of the page keeps playing, so stop them all if the
        // screen goes.
        signal.addEventListener("abort", () => {
            for (const videoElement of videoElements) {
                videoElement.pause();
            }
        });

        console.log("Starting reels module with reels:", reelIDs)
        CurrentSessionData.logEvent("reelsScreenStarted", reelIDs.toString())

        const reelDescription = reelIDs.length == 1 ?
            "a funny video" : "a couple funny videos";
        const reelWord = reelIDs.length == 1 ?
            "video" : "videos";
        await teddy.say(TeddyAnimations.WAVE_SHORT,
            [`For this next part, I'm going to show you ${reelDescription}.`,
                `Please just watch the ${reelWord}, and rate it when it's done.`,
                "And please keep your face in frame the whole time!"],
            signal);
        panels.showStartPanel();
        await start.next(signal);

        for (let index = 0; index < reelIDs.length; index++) {
            const id = reelIDs[index];
            if (index > 0) {
                // Let the buttons fade out a bit, and let the recording finish
                await sleep(400, signal);
            }

            CurrentSessionData.logEvent("reelRecordingStarted", id)
            const recording = userVideoRef.current.record({kind: "reel", item: id},
                {timeout: MAX_RECORDING_DURATION, signal});
            teddy.playAnimation(TeddyAnimations.WATCH_MOVIE)
            teddy.hideTextbox()
            panels.showPanel(null);

            setVideoWrapperShown(true);
            const reel = reels[id];
            CurrentSessionData.logEvent("reelShown", {id: reel.id, file: reel.file})
            const video = videoElements[index];
            videoElementWrapperRef.current.innerHTML = "";
            videoElementWrapperRef.current.appendChild(video);
            video.addEventListener("ended", recording.stop, {once: true});
            console.log("playing reel", id, video.getAttribute("src"));
            video.play();

            // The recording ends with the reel, or at its time limit. Stop the
            // reel then too, so it isn't heard behind the rating.
            await recording.done;
            video.removeEventListener("ended", recording.stop);
            video.pause();
            CurrentSessionData.logEvent("reelRecordingEnded", id)
            setVideoWrapperShown(false);

            teddy.playAnimation(TeddyAnimations.IDLE);
            teddy.say(TeddyAnimations.LISTEN, "What did you think of that video?");
            panels.showStartPanel("rateReel");
            CurrentSessionData.logEvent("reelRatingRecordingStarted", id)
            const ratingRecording = userVideoRef.current.record({kind: "reelRating", item: id},
                {timeout: MAX_RATING_RECORDING_DURATION, signal});
            ratingRecording.done.then(() => {
                CurrentSessionData.logEvent("reelRatingRecordingEnded", id)
            });

            const rating = await rate.next(signal);
            ratingRecording.stop()
            CurrentSessionData.logEvent("ratedReel", {reel: id, rating: rating});
            console.log("Rated reel", id, rating);
            panels.showPanel(null);
        }

        teddy.playAnimation(TeddyAnimations.IDLE);
        const hasMoreModules = CurrentSessionData.hasMoreModules();
        await teddy.say(TeddyAnimations.SUCCESS,
            ["Thanks so much for your feedback!",
                hasMoreModules ? "Should we start the next module?" : "Let's quickly finish up our session."],
            signal);
        CurrentSessionData.logEvent(hasMoreModules ? "reelsScreenNextModule" : "reelsScreenFinishSession")
        panels.showStartPanel(hasMoreModules ? "nextModule" : "finishSession");
        await next.next(signal);
        CurrentSessionData.navigateToNextModule(navigate);
    });

    const onUserVideoInitialized = useCallback(() => {
        microphoneIndicatorRef.current.start()
    }, [])

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
                    <button onClick={() => start.pick()}>
                        Let's Watch!
                    </button>
                </FadingPanel>
                <FadingPanel label={"rateReel"}>
                    <button onClick={() => rate.pick(4)}>
                        <span aria-hidden={true}>🤣</span> Really Funny
                    </button>
                    <button onClick={() => rate.pick(3)}>
                        <span aria-hidden={true}>😄</span> Pretty Funny
                    </button>
                    <button onClick={() => rate.pick(2)}>
                        <span aria-hidden={true}>🫤</span> Not Funny
                    </button>
                    <button onClick={() => rate.pick(1)}>
                        <span aria-hidden={true}>😠</span> Hated It
                    </button>
                </FadingPanel>
                <FadingPanel label={"nextModule"}>
                    <button onClick={() => next.pick()}>
                        Let's Go!
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
