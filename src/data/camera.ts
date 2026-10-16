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

// Resolves to true when this device plainly has no camera or no microphone, so
// there's no point asking for them. Before the participant allows the camera,
// browsers still list one of each kind of device the device has (without its
// name), so an empty kind means there isn't one. An empty list, or a browser
// that can't list devices, proves nothing, and resolves to false: asking for
// the stream will tell.
export async function lacksCamera(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
        return true;
    }
    let devices: MediaDeviceInfo[];
    try {
        devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
        return false;
    }
    if (devices.length == 0) {
        return false;
    }
    const kinds = new Set(devices.map(d => d.kind));
    const missing = !kinds.has("videoinput") || !kinds.has("audioinput");
    if (missing) {
        CurrentSessionData.logEvent("camera_result", {
            result: "missing",
            video_inputs: devices.filter(d => d.kind == "videoinput").length,
            audio_inputs: devices.filter(d => d.kind == "audioinput").length,
        }, "error");
    }
    return missing;
}

// Resolves to the stream, opening it if it isn't open. Rejects with
// getUserMedia's error if the browser won't give us the camera and microphone,
// or with a NotSupportedError if this browser can't use a camera at all (an
// old browser, or a page not served over https). Each time it asks the
// browser, it logs camera_requested, then camera_result.
export function getCameraStream(): Promise<MediaStream> {
    if (stream != null && isLive(stream)) {
        return Promise.resolve(stream);
    }
    if (opening == null) {
        stopCameraStream();
        CurrentSessionData.logEvent("camera_requested");
        const request = navigator.mediaDevices?.getUserMedia ?
            navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "user",
                    width: {ideal: Config.recording.width},
                    height: {ideal: Config.recording.height},
                    frameRate: {ideal: Config.recording.frameRate},
                },
                audio: true,
            }) :
            Promise.reject(new DOMException("This browser can't use a camera here", "NotSupportedError"));
        opening = request
            .then((s) => {
                stream = s;
                const video = s.getVideoTracks()[0]?.getSettings() ?? {};
                CurrentSessionData.logEvent("camera_result", {
                    result: "started",
                    width: video.width ?? null,
                    height: video.height ?? null,
                    frame_rate: video.frameRate ?? null,
                });
                // A track ends on its own when the camera is unplugged or the
                // permission is taken away; stopCameraStream() doesn't count.
                for (const track of s.getTracks()) {
                    track.addEventListener("ended", () => {
                        CurrentSessionData.logEvent("camera_ended", {track: track.kind}, "error");
                    }, {once: true});
                }
                return s;
            }, (error) => {
                CurrentSessionData.logEvent("camera_result", {
                    result: "failed",
                    ...errorFields(error),
                    // Which setting the camera couldn't meet, for an OverconstrainedError.
                    constraint: error?.constraint ?? null,
                }, "error");
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
