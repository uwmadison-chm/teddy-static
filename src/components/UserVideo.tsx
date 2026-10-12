import * as React from "react";
import {useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef, useState} from "react";
import * as events from "@/utils/events.tsx";
import {getCameraStream, recorderOptions} from "@/data/camera.ts";
import {useLocation} from "react-router";
import {useAnimatedNavigate} from "@/utils/utils";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import * as pig from "@/data/pig.ts";
import type {CameraHelpState} from "@/routes/CameraHelpScreen.tsx";

export interface UserVideoProps {
    onInitialized?: () => void;
}

// What a recording is, stored as its media item's event. `kind` is the sort of
// recording ("sentence", "reel", ...), `item` the sentence, reel, or prompt ID.
export interface RecordingInfo {
    kind: string;
    item?: string;
}

export interface UserVideoFunctions {
    record: (info: RecordingInfo, onComplete:() => void, timeout?:number) => void;
    stop: () => void;
    getIsRecording: () => boolean;
}

export const UserVideo = React.forwardRef<UserVideoFunctions, UserVideoProps>((props, ref) => {

    const navigate = useAnimatedNavigate();
    const location = useLocation();
    const videoElementRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder>(null);
    const recordingInfoRef = useRef<RecordingInfo>(null);
    const timeoutRef = useRef<number>(null);

    const [silhouetteShown, setSilhouetteShown] = useState<boolean>(localStorage.getItem("SilhouetteShown") == "true");
    const isRecording = useRef<boolean>(false);


    const startCamera = useEffectEvent(() => {
        getCameraStream()
            .then((localMediaStream) => {
                videoElementRef.current.srcObject = localMediaStream;
                if (props.onInitialized != null) {
                    props.onInitialized()
                }
            })
            .catch((error) => {
                // The camera worked when the session started, so something has
                // changed: a permission revoked, or a camera unplugged. Help the
                // participant fix it, then start this screen over.
                console.error("Couldn't get the camera", error);
                CurrentSessionData.logEvent("cameraError", error.name);
                const state: CameraHelpState = {errorName: error.name, returnTo: location.pathname};
                navigate("/camerahelp", {state});
            });
    });

    useEffect(() => {
        startCamera()
    }, [])

    // Each recording gets its own MediaRecorder, which pig's client starts and
    // sends to pig as one media item, in parts, as it records. A recorder
    // delivers its last part and its stop event a moment after stop() is
    // called, so nothing is shared between recordings.
    function startRecording(info: RecordingInfo, onComplete:()=>void, timeout?:number) {
        if (isRecording.current) {
            stopRecording();
        }
        const stream = videoElementRef.current.srcObject as MediaStream;
        const recorder = new MediaRecorder(stream, recorderOptions());
        recorder.addEventListener("stop", () => {
            CurrentSessionData.logEvent("recordingStopped", {...info});
            onComplete();
        });
        // This starts the recorder before it returns; the media item's event is
        // stamped with the moment the recorder says it started.
        pig.record(recorder, {...info, module: CurrentSessionData.currentModuleName()})
            .catch((error) => {
                console.error("Couldn't record:", error);
                CurrentSessionData.logEvent("recordingError", {...info, message: String(error)});
            });
        mediaRecorderRef.current = recorder;
        recordingInfoRef.current = info;

        if (timeoutRef.current != null) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        if (timeout) {
            timeoutRef.current = window.setTimeout(stopRecording, timeout);
        }
        events.emit("recordingnotificationstatus", true);
        isRecording.current = true;
    }

    const stopRecording = () => {
        if (! isRecording.current) {
            return;
        }
        if (timeoutRef.current != null) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        // Logged when stop is asked for, which is when the participant was done;
        // the recorder's own stop comes a little later.
        CurrentSessionData.logEvent("recordingStopRequested", {...recordingInfoRef.current});
        if (mediaRecorderRef.current.state != "inactive") {
            mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
        events.emit("recordingnotificationstatus", false);
        isRecording.current = false;
    }

    useImperativeHandle(ref, () => ({
        record: (info, onComplete, timeout) => {
            startRecording(info, onComplete, timeout);
        },
        stop: () => {
            stopRecording()
        },
        getIsRecording: () => {
            return isRecording.current
        }
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
                <div className={"icon outline-icon"} />
                <label className="switch">
                    <input type="checkbox"
                           checked={silhouetteShown}
                           onChange={(e) => {
                               setSilhouetteShown(e.target.checked)
                               localStorage.setItem("SilhouetteShown", String(e.target.checked));
                           }}/>
                    <span className="handle"></span>
                </label>
                <div className={"icon"} />
            </div>
        </div>
    )
});
