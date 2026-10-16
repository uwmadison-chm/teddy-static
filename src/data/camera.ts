// The camera and microphone stream, shared by every screen.
//
// The stream is opened once, the first time something asks for it, and stays
// open until the session ends. Screens come and go, but they all record from
// this one stream, so the camera isn't re-opened for each one, and every
// recording comes from the same capture clock.

import {Config} from "@/data/config.ts";
import {CurrentSessionData, errorFields} from "@/data/sessionData.tsx";

let stream: MediaStream | null = null;
let opening: Promise<MediaStream> | null = null;

function isLive(s: MediaStream): boolean {
    const tracks = s.getTracks();
    return tracks.length > 0 && tracks.every(t => t.readyState == "live");
}

// Resolves to the stream, opening it if it isn't open. Rejects with
// getUserMedia's error if the browser won't give us the camera and microphone.
// Each time it asks the browser, it logs camera_requested, then camera_started
// or camera_error.
export function getCameraStream(): Promise<MediaStream> {
    if (stream != null && isLive(stream)) {
        return Promise.resolve(stream);
    }
    if (opening == null) {
        stopCameraStream();
        CurrentSessionData.logEvent("camera_requested");
        opening = navigator.mediaDevices
            .getUserMedia({
                video: {
                    facingMode: "user",
                    width: {ideal: Config.recording.width},
                    height: {ideal: Config.recording.height},
                    frameRate: {ideal: Config.recording.frameRate},
                },
                audio: true,
            })
            .then((s) => {
                stream = s;
                const video = s.getVideoTracks()[0]?.getSettings() ?? {};
                CurrentSessionData.logEvent("camera_started", {
                    width: video.width ?? null,
                    height: video.height ?? null,
                    frame_rate: video.frameRate ?? null,
                });
                // A track ends on its own when the camera is unplugged or the
                // permission is taken away; stopCameraStream() doesn't count.
                for (const track of s.getTracks()) {
                    track.addEventListener("ended", () => {
                        CurrentSessionData.logEvent("camera_ended", {track: track.kind});
                    }, {once: true});
                }
                return s;
            }, (error) => {
                CurrentSessionData.logEvent("camera_error", {
                    ...errorFields(error),
                    // Which setting the camera couldn't meet, for an OverconstrainedError.
                    constraint: error?.constraint ?? null,
                });
                throw error;
            })
            .finally(() => {
                opening = null;
            });
    }
    return opening;
}

// Turns the camera and microphone off.
export function stopCameraStream(): void {
    if (stream != null) {
        for (const track of stream.getTracks()) {
            track.stop();
        }
        stream = null;
    }
}

// Options for a MediaRecorder on the camera stream, from config.js.
export function recorderOptions(): MediaRecorderOptions {
    const options: MediaRecorderOptions = {
        videoBitsPerSecond: Config.recording.videoBitsPerSecond,
        audioBitsPerSecond: Config.recording.audioBitsPerSecond,
    };
    const mimeType = Config.recording.mimeTypes.find(t => MediaRecorder.isTypeSupported(t));
    if (mimeType) {
        options.mimeType = mimeType;
    }
    return options;
}
