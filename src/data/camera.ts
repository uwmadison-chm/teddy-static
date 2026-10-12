// The camera and microphone stream, shared by every screen.
//
// The stream is opened once, the first time something asks for it, and stays
// open until the session ends. Screens come and go, but they all record from
// this one stream, so the camera isn't re-opened for each one, and every
// recording comes from the same capture clock.

import {Config} from "@/data/config.ts";

let stream: MediaStream | null = null;
let opening: Promise<MediaStream> | null = null;

function isLive(s: MediaStream): boolean {
    const tracks = s.getTracks();
    return tracks.length > 0 && tracks.every(t => t.readyState == "live");
}

// Resolves to the stream, opening it if it isn't open. Rejects with
// getUserMedia's error if the browser won't give us the camera and microphone.
export function getCameraStream(): Promise<MediaStream> {
    if (stream != null && isLive(stream)) {
        return Promise.resolve(stream);
    }
    if (opening == null) {
        stopCameraStream();
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
                return s;
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
