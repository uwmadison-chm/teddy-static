import * as React from "react";
import {useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef, useState} from "react";
import * as events from "@/utils/events.tsx";
import {getCameraStream, recorderOptions} from "@/data/camera.ts";
import {Config} from "@/data/config.ts";
import {useLocation} from "react-router";
import {useAnimatedNavigate} from "@/utils/utils";
import {CurrentSessionData, errorFields} from "@/data/sessionData.tsx";
import * as pig from "@/data/pig.ts";
import type {CameraHelpState} from "@/routes/CameraHelpScreen.tsx";

export interface UserVideoProps {
    onInitialized?: () => void;
}

// What a recording is, stored as its media item's event. `kind` is the sort of
// recording ("sentence", "reel", ...), `item` the sentence, reel, or prompt ID,
// or `items` for a recording of several (the questionnaire's).
export interface RecordingInfo {
    kind: string;
    item?: string;
    items?: string[];
}

// Why a recording stopped, for its recording_stopped event. See docs/events.md.
export type StopReason = "done_button" | "timed_out" | "reel_ended" | "answered" | "finished" | "replaced" | "left_screen";

export interface RecordOptions {
    // The longest this recording may run, in milliseconds. The study's limit
    // applies too.
    timeout?: number;
    // Stops the recording when it fires.
    signal?: AbortSignal;
}

// One recording. Starting another stops this one.
export interface Recording {
    // Resolves when the recorder has stopped and handed over its last part,
    // however it was stopped.
    done: Promise<void>;
    // Stops this recording, if it's still going. Safe to call more than once;
    // only the first call's reason is logged.
    stop: (reason: StopReason) => void;
}

export interface UserVideoFunctions {
    record: (info: RecordingInfo, options?: RecordOptions) => Recording;
    // Resolves once the camera is showing.
    ready: () => Promise<void>;
}

export const UserVideo = React.forwardRef<UserVideoFunctions, UserVideoProps>((props, ref) => {

    const navigate = useAnimatedNavigate();
    const location = useLocation();
    const videoElementRef = useRef<HTMLVideoElement>(null);
    const currentRef = useRef<Recording>(null);
    // Resolved once the camera is showing.
    const [ready] = useState(() => {
        let resolve: () => void;
        const promise = new Promise<void>((r) => { resolve = r; });
        return {promise, resolve: () => resolve()};
    });

    const [silhouetteShown, setSilhouetteShown] = useState<boolean>(localStorage.getItem("SilhouetteShown") == "true");


    const startCamera = useEffectEvent(() => {
        getCameraStream()
            .then((localMediaStream) => {
                videoElementRef.current.srcObject = localMediaStream;
                ready.resolve();
                if (props.onInitialized != null) {
                    props.onInitialized()
                }
            })
            .catch((error) => {
                // The camera worked when the session started, so something has
                // changed: a permission revoked, or a camera unplugged. Help the
                // participant fix it, then start this screen over.
                console.error("Couldn't get the camera", error);
                const state: CameraHelpState = {errorName: error.name, returnTo: location.pathname};
                navigate("/camerahelp", {state});
            });
    });

    useEffect(() => {
        startCamera()
        // Nothing records past its screen.
        return () => currentRef.current?.stop("left_screen");
    }, [])

    // Each recording gets its own MediaRecorder, which pig's client starts and
    // sends to pig as one media item, in parts, as it records. A recorder
    // delivers its last part and its stop event a moment after stop() is
    // called, so nothing is shared between recordings.
    function startRecording(info: RecordingInfo, options: RecordOptions = {}): Recording {
        currentRef.current?.stop("replaced");
        const stream = videoElementRef.current.srcObject as MediaStream;
        const recorder = new MediaRecorder(stream, recorderOptions());
        const done = new Promise<void>((resolve) => {
            recorder.addEventListener("stop", () => resolve());
        });
        // No recording runs past the study's limit, whatever the module asks for.
        const limit = Math.min(options.timeout || Infinity, Config.recording.maxSeconds * 1000);

        // Every event from here until it stops carries this recording's number.
        const number = CurrentSessionData.startRecording();
        // This starts the recorder before it returns; the media item's event is
        // stamped with the moment the recorder says it started, which is the
        // start of the video.
        pig.record(recorder, CurrentSessionData.event("recording", {...info, limit_seconds: limit / 1000}))
            .catch((error) => {
                console.error("Couldn't record:", error);
                CurrentSessionData.logEvent("recording_error", {...info, recording: number, ...errorFields(error)});
            });

        let stopped = false;
        const stop = (reason: StopReason) => {
            if (stopped) {
                return;
            }
            stopped = true;
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onAbort);
            // Logged when stop is asked for, which is when the participant was
            // done; the recorder's own stop comes a little later.
            CurrentSessionData.logEvent("recording_stopped", {...info, recording: number, reason});
            if (CurrentSessionData.currentRecording == number) {
                CurrentSessionData.currentRecording = null;
            }
            if (recorder.state != "inactive") {
                recorder.stop();
            }
            if (currentRef.current == recording) {
                currentRef.current = null;
                events.emit("recordingnotificationstatus", false);
            }
        };
        const onAbort = () => stop("left_screen");

        const timer = window.setTimeout(() => stop("timed_out"), limit);
        options.signal?.addEventListener("abort", onAbort, {once: true});

        const recording: Recording = {done, stop};
        currentRef.current = recording;
        events.emit("recordingnotificationstatus", true);
        return recording;
    }

    useImperativeHandle(ref, () => ({
        record: startRecording,
        ready: () => ready.promise,
    }));

    return (
        <div className={"user-video"}>
            <div className={"user-video-cover"}>
                <div className={"outline"} style={{opacity: silhouetteShown?0:.4}} />
                <div className={"silhouette"} style={{opacity: silhouetteShown?1:0}} />
                <video id="userVideo" ref={videoElementRef} playsInline autoPlay muted />
                <div className={"bg"} />
            </div>
            <div className={"silhouette-controls"}>
                <div className={"icon outline-icon"} aria-hidden={true} />
                <label className="switch">
                    <input type="checkbox"
                           role="switch"
                           aria-label="Show a silhouette over your video"
                           checked={silhouetteShown}
                           onChange={(e) => {
                               setSilhouetteShown(e.target.checked)
                               localStorage.setItem("SilhouetteShown", String(e.target.checked));
                           }}/>
                    <span className="handle"></span>
                </label>
                <div className={"icon"} aria-hidden={true} />
            </div>
        </div>
    )
});
