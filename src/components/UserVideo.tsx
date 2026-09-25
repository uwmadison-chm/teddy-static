import * as React from "react";
import {useCallback, useEffect, useImperativeHandle, useRef, useState} from "react";
import Cookies from "js-cookie";
import emitter from "tiny-emitter/instance";

export interface UserVideoProps {
    onInitialized?: () => void;
}

export interface UserVideoFunctions {
    record: (onComplete:(result:Blob) => void, timeout?:number) => void;
    stop: () => void;
    getIsRecording: () => boolean;
}

export const UserVideo = React.forwardRef<UserVideoFunctions, UserVideoProps>((props, ref) => {

    const videoElementRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder>(null);
    const recordingChunksRef = useRef([]);
    const onRecordingCompleteRef = useRef<(result:Blob)=>void>(null);
    const timeoutRef = useRef<number>(null);

    const [silhouetteShown, setSilhouetteShown] = useState<boolean>(Cookies.get("SilhouetteShown") == "true");
    const isRecording = useRef<boolean>(false);


    const startCamera = () => {
        navigator.mediaDevices
            .getUserMedia({ video: {facingMode: 'user', height: {ideal: 600}}, audio: true, })
            .then((localMediaStream) => {
                videoElementRef.current.srcObject = localMediaStream;

                const options = { mimeType: MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "video/mp4" };
                mediaRecorderRef.current = new MediaRecorder(localMediaStream, options);
                mediaRecorderRef.current.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        recordingChunksRef.current.push(event.data);
                    }
                }
                mediaRecorderRef.current.onstop = (event) => {
                    const recording = new Blob(recordingChunksRef.current, {
                        type: "video/webm",
                    });
                    recordingChunksRef.current.length = 0;
                    if (onRecordingCompleteRef.current != null) {
                        onRecordingCompleteRef.current(recording)
                    }
                }
                if (props.onInitialized != null) {
                    props.onInitialized()
                }
            })
            .catch((error) => {
                console.log("Rejected!", error);
            });
    }

    useEffect(() => {
        startCamera()
    }, [])

    function startRecording(onComplete:(result:Blob)=>void, timeout?:number) {
        recordingChunksRef.current.length = 0;
        mediaRecorderRef.current.start();
        onRecordingCompleteRef.current = onComplete;
        if (timeoutRef.current != null) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        if (timeout) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            timeoutRef.current = setTimeout(stopRecording, timeout);
        }
        emitter.emit("recordingnotificationstatus", true);
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
        emitter.emit("recordingnotificationstatus", false);
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
                               Cookies.set("SilhouetteShown", e.target.checked);
                           }}/>
                    <span className="handle"></span>
                </label>
                <div className={"icon"} />
            </div>
        </div>
    )
});
