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

const RATING_QUESTION = "What did you think of that video?";
// The rating buttons, best first. Codes and labels go to pig with each rating,
// like a question's choices.
const RATINGS = [
    {code: "4", label: "Really Funny", emoji: "🤣"},
    {code: "3", label: "Pretty Funny", emoji: "😄"},
    {code: "2", label: "Not Funny", emoji: "🫤"},
    {code: "1", label: "Hated It", emoji: "😠"},
];

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
    const rate = useChoice<typeof RATINGS[number]>();
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
                CurrentSessionData.logEvent("reel_playing", {item: reelID});
            })
            videoElement.addEventListener("stalled", ()=> {
                CurrentSessionData.logEvent("reel_stalled", {item: reelID}, "warning");
            })
            videoElement.addEventListener("ended", ()=> {
                CurrentSessionData.logEvent("reel_ended", {item: reelID});
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
        CurrentSessionData.startModule()

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

            const recording = userVideoRef.current.record({kind: "reel", item: id},
                {timeout: MAX_RECORDING_DURATION, signal});
            teddy.playAnimation(TeddyAnimations.WATCH_MOVIE)
            teddy.hideTextbox()
            panels.showPanel(null);

            setVideoWrapperShown(true);
            const reel = reels[id];
            CurrentSessionData.logEvent("item_shown", {item: reel.id, file: reel.file})
            const video = videoElements[index];
            videoElementWrapperRef.current.innerHTML = "";
            videoElementWrapperRef.current.appendChild(video);
            const stopAtEnd = () => recording.stop("reel_ended");
            video.addEventListener("ended", stopAtEnd, {once: true});
            console.log("playing reel", id, video.getAttribute("src"));
            video.play();

            // The recording ends with the reel, or at its time limit. Stop the
            // reel then too, so it isn't heard behind the rating.
            await recording.done;
            video.removeEventListener("ended", stopAtEnd);
            video.pause();
            setVideoWrapperShown(false);

            teddy.playAnimation(TeddyAnimations.IDLE);
            teddy.say(TeddyAnimations.LISTEN, RATING_QUESTION);
            panels.showStartPanel("rateReel");
            const ratingRecording = userVideoRef.current.record({kind: "reel_rating", item: id},
                {timeout: MAX_RATING_RECORDING_DURATION, timeoutIsNormal: true, signal});

            const rating = await rate.next(signal);
            CurrentSessionData.logEvent("response", {
                item: id,
                text: RATING_QUESTION,
                value: rating.code,
                label: rating.label,
                choices: RATINGS.map(({code, label}) => ({code, label})),
            });
            ratingRecording.stop("answered")
            console.log("Rated reel", id, rating);
            panels.showPanel(null);
        }

        teddy.playAnimation(TeddyAnimations.IDLE);
        const hasMoreModules = CurrentSessionData.hasMoreModules();
        await teddy.say(TeddyAnimations.SUCCESS,
            ["Thanks so much for your feedback!",
                hasMoreModules ? "Should we start the next module?" : "Let's quickly finish up our session."],
            signal);
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
                 className={"video-reel" + (videoWrapperShown ? "" : " faded")}>
            </div>

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button onClick={() => start.pick()}>
                        Let's Watch!
                    </button>
                </FadingPanel>
                <FadingPanel label={"rateReel"}>
                    {RATINGS.map((rating) => (
                        <button key={rating.code} onClick={() => rate.pick(rating)}>
                            <span aria-hidden={true}>{rating.emoji}</span> {rating.label}
                        </button>
                    ))}
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
