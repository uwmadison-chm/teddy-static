import * as React from "react";
import {useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef, useState} from "react";
import * as events from "@/utils/events.tsx";
import {getCameraStream, recorderOptions} from "@/data/camera.ts";
import {useLocation} from "react-router";
import {useAnimatedNavigate} from "@/utils/utils";
import {CurrentSessionData} from "@/data/sessionData.tsx";
import type {CameraHelpState} from "@/routes/CameraHelpScreen.tsx";

export interface UserVideoProps {
    onInitialized?: () => void;
}

export interface UserVideoFunctions {
    record: (onComplete:(result:Blob) => void, timeout?:number) => void;
    stop: () => void;
    getIsRecording: () => boolean;
}

export const UserVideo = React.forwardRef<UserVideoFunctions, UserVideoProps>((props, ref) => {

    const navigate = useAnimatedNavigate();
    const location = useLocation();
    const videoElementRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder>(null);
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

    // Each recording gets its own MediaRecorder, chunk list, and callback. A
    // recorder delivers its last chunk and its stop event a moment after stop()
    // is called, so anything shared between recordings could get the end of one
    // mixed into the next.
    function startRecording(onComplete:(result:Blob)=>void, timeout?:number) {
        if (isRecording.current) {
            stopRecording();
        }
        const stream = videoElementRef.current.srcObject as MediaStream;
        const recorder = new MediaRecorder(stream, recorderOptions());
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                chunks.push(event.data);
            }
        }
        recorder.onstop = () => {
            // recorder.mimeType is what was actually recorded, which isn't
            // always what we asked for.
            onComplete(new Blob(chunks, {type: recorder.mimeType}));
        }
        recorder.start();
        mediaRecorderRef.current = recorder;

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
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
        events.emit("recordingnotificationstatus", false);
        isRecording.current = false;
    }

    useImperativeHandle(ref, () => ({
        record: (onComplete, timeout) => {
            startRecording(onComplete, timeout);
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
