// The quality-check page: Teddy introduces it, then gets out of the way. The
// tester picks a format, bitrate and size, records each prompt with them, and
// watches each recording back to say whether it looks right. The video is the
// point here, so from setup on the page is as wide as the window, and a video
// bigger than the window can be seen at its actual size by scrolling.

import {useCallback, useEffect, useRef, useState} from "react";
import {FaThumbsDown, FaThumbsUp} from "react-icons/fa";
import {build, settings, type Format, type Size} from "virtual:quality-check-settings";
import {Teddy, type TeddyFunctions} from "@/components/Teddy.tsx";
import {TeddyAnimations} from "@/components/teddyAnimations.ts";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";
import {errorFields} from "@/data/log.ts";
import * as pig from "@/quality-check/pig.ts";
import {cleanTesterID, logEvent, QC_EVENT_SCHEMA, session} from "@/quality-check/session.ts";

type Stage = "intro" | "setup" | "record" | "review" | "end" | "sending" | "sent";

// What the tester picked for a run.
interface Choice {
    format: Format;
    bitrate: number;
    size: Size;
}

// What the browser says about recording a format, at the chosen bitrate and size.
interface Capability {
    canRecord: boolean;
    // From navigator.mediaCapabilities.encodingInfo(). Chrome only answers
    // for type "record" with experimental web platform features on, so it's
    // also asked about the same codec for "webrtc"; `source` says which answered.
    source: "record" | "webrtc" | null;
    supported: boolean | null;
    smooth: boolean | null;
    powerEfficient: boolean | null;
    // From WebCodecs: whether the browser has a hardware encoder for the codec
    // at this size and bitrate.
    hardwareEncoder: boolean | null;
}

// What the camera is actually sending.
interface CameraSettings {
    width: number | null;
    height: number | null;
    frameRate: number | null;
}

// One recording, kept on the page to play back.
interface Take {
    item: string;
    text: string;
    url: string;
    mimeType: string;
    bytes: number;
    durationMs: number;
}

// A prompt's ID, like 01.
function itemID(index: number): string {
    return String(index + 1).padStart(2, "0");
}

function kbps(bitsPerSecond: number): string {
    return `${Math.round(bitsPerSecond / 1000).toLocaleString()} kbps`;
}

// A format's video codec, as encodingInfo() for webrtc and WebCodecs name it.
const CODECS: [RegExp, string, string][] = [
    [/^vp0?8/i, "video/VP8", "vp8"],
    [/^vp0?9/i, "video/VP9", "vp09.00.10.08"],
    [/^av0?1/i, "video/AV1", "av01.0.08M.08"],
    [/^(avc1|avc3|h264)/i, "video/H264", "avc1.42E028"],
];

function videoCodec(mimeType: string): {webrtc: string, webcodecs: string} | null {
    const codecs = /codecs="?([^";]*)/i.exec(mimeType)?.[1].split(",").map(c => c.trim()) ?? [];
    for (const codec of codecs) {
        const match = CODECS.find(([pattern]) => pattern.test(codec));
        if (match) {
            return {webrtc: match[1], webcodecs: match[2]};
        }
    }
    return null;
}

async function capability(format: Format, bitrate: number, size: Size): Promise<Capability> {
    const canRecord = typeof MediaRecorder != "undefined" && MediaRecorder.isTypeSupported(format.mimeType);
    const result: Capability = {canRecord, source: null, supported: null, smooth: null, powerEfficient: null, hardwareEncoder: null};
    const video = {width: size.width, height: size.height, bitrate, framerate: settings.frameRate};
    const codec = videoCodec(format.mimeType);
    if (navigator.mediaCapabilities?.encodingInfo) {
        const attempts: ["record" | "webrtc", string | undefined][] = [["record", format.mimeType], ["webrtc", codec?.webrtc]];
        for (const [type, contentType] of attempts) {
            if (!contentType) {
                continue;
            }
            try {
                const info = await navigator.mediaCapabilities.encodingInfo({type, video: {contentType, ...video}});
                Object.assign(result, {source: type, supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient});
                break;
            } catch {
                // This browser doesn't know that type; try the next.
            }
        }
    }
    if (codec && typeof VideoEncoder != "undefined") {
        try {
            const config = {codec: codec.webcodecs, ...video, hardwareAcceleration: "prefer-hardware" as const};
            result.hardwareEncoder = (await VideoEncoder.isConfigSupported(config)).supported ?? null;
        } catch {
            // Leave it unknown.
        }
    }
    return result;
}

function cameraSettings(stream: MediaStream | null): CameraSettings {
    const s = stream?.getVideoTracks()[0]?.getSettings() ?? {};
    return {width: s.width ?? null, height: s.height ?? null, frameRate: s.frameRate ?? null};
}

function videoConstraints(size: Size): MediaTrackConstraints {
    return {width: {ideal: size.width}, height: {ideal: size.height}, frameRate: {ideal: settings.frameRate}};
}

// A video, scaled down to fit the window, or at its actual size in a box that
// scrolls when it's bigger than the window.
function VideoFrame({stream, src, mirrored = false, label}: {stream?: MediaStream, src?: string, mirrored?: boolean, label: string}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [actualSize, setActualSize] = useState(false);

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <figure className={"qc-video"}>
            <div className={"qc-video-frame" + (actualSize ? " actual-size" : "")}>
                <video ref={videoRef}
                       className={mirrored ? "mirrored" : undefined}
                       src={src}
                       aria-label={label}
                       autoPlay={!!stream}
                       muted={!!stream}
                       playsInline
                       controls={!!src} />
            </div>
            <label className={"qc-actual-size"}>
                <input type={"checkbox"} checked={actualSize} onChange={(e) => setActualSize(e.target.checked)} />
                Actual pixels
            </label>
        </figure>
    );
}

function Intro({onDone}: {onDone: () => void}) {
    const teddyRef = useRef<TeddyFunctions>(null);
    const panelsRef = useRef<FadingPanelFunctions>(null);

    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            await teddyRef.current.say(TeddyAnimations.WAVE,
                ["Hi! This is a quality check, to see how recordings look on this device.",
                    "You'll pick how your camera records, then record a couple of short clips.",
                    "After each one, you'll watch it back and tell us whether it looks right."],
                controller.signal);
            panelsRef.current.showStartPanel();
        })().catch(() => {});
        return () => controller.abort();
    }, []);

    return (
        <main className={"phone-screen-wrapper"}>
            <div className={"wrapper"}>
                <Teddy ref={teddyRef} initialAnimation={TeddyAnimations.IDLE} />
                <FadingPanelSet ref={panelsRef}>
                    <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                        <button onClick={onDone}>Let's Set Up</button>
                    </FadingPanel>
                </FadingPanelSet>
            </div>
        </main>
    );
}

export default function QualityCheck() {
    const [stage, setStage] = useState<Stage>("intro");
    const [rawTester, setRawTester] = useState("");
    const [runStarted, setRunStarted] = useState(false);
    const [formatIndex, setFormatIndex] = useState<number | null>(null);
    const [bitrate, setBitrate] = useState(settings.bitrates[Math.floor(settings.bitrates.length / 2)]);
    const [customBitrate, setCustomBitrate] = useState("");
    const [sizeIndex, setSizeIndex] = useState(0);
    const [capabilities, setCapabilities] = useState<Capability[]>([]);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [camera, setCamera] = useState<CameraSettings>({width: null, height: null, frameRate: null});
    const [problem, setProblem] = useState<string | null>(null);
    const [promptIndex, setPromptIndex] = useState(0);
    const [recording, setRecording] = useState(false);
    const [take, setTake] = useState<Take | null>(null);
    const [bytesLeft, setBytesLeft] = useState<number | null>(null);
    const [choice, setChoice] = useState<Choice | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const stopRef = useRef<(reason: string) => void>(() => {});

    const tester = cleanTesterID(rawTester);
    const size = settings.sizes[sizeIndex];
    const typedBitrate = Number(customBitrate) * 1000;
    const chosenBitrate = customBitrate != "" ? typedBitrate : bitrate;
    const bitrateOK = Number.isFinite(chosenBitrate) && chosenBitrate >= 50_000;

    // The camera, from setup to the end, at the chosen size.
    const needsCamera = stage == "setup" || stage == "record" || stage == "review" || stage == "end";
    useEffect(() => {
        if (!needsCamera || stream) {
            return;
        }
        let cancelled = false;
        navigator.mediaDevices.getUserMedia({video: videoConstraints(size), audio: true}).then((s) => {
            if (cancelled) {
                s.getTracks().forEach(t => t.stop());
                return;
            }
            setStream(s);
            setCamera(cameraSettings(s));
            const actual = cameraSettings(s);
            logEvent("camera_result", {result: "started", width: actual.width, height: actual.height, frame_rate: actual.frameRate});
        }, (error) => {
            setProblem(`The camera didn't start: ${error.name}. ${error.message}`);
            logEvent("camera_result", {result: "failed", ...errorFields(error)}, "error");
        });
        return () => {
            cancelled = true;
        };
    }, [needsCamera, stream, size]);

    // A new size goes to the camera that's already running.
    useEffect(() => {
        const track = stream?.getVideoTracks()[0];
        if (!track) {
            return;
        }
        track.applyConstraints(videoConstraints(size))
            .catch((error) => console.warn("The camera didn't take the new size:", error))
            .finally(() => setCamera(cameraSettings(stream)));
    }, [stream, size]);

    // What the browser says about each format at the chosen bitrate and size.
    useEffect(() => {
        if (stage != "setup" || !bitrateOK) {
            return;
        }
        let cancelled = false;
        Promise.all(settings.formats.map(f => capability(f, chosenBitrate, size))).then((caps) => {
            if (!cancelled) {
                setCapabilities(caps);
                // Start on the first format the browser can record.
                setFormatIndex((index) => index != null && caps[index]?.canRecord ? index : (() => {
                    const first = caps.findIndex(c => c.canRecord);
                    return first < 0 ? null : first;
                })());
            }
        });
        return () => {
            cancelled = true;
        };
    }, [stage, chosenBitrate, bitrateOK, size]);

    const start = useCallback(async () => {
        setProblem(null);
        if (!runStarted) {
            session.recordings = 0;
            logEvent("quality_check_started", {schema: QC_EVENT_SCHEMA, teddy: build.teddy, debug: settings.debug});
            const failure = await pig.startRun(tester);
            if (failure) {
                setProblem(`Couldn't start sending to pig: ${failure}`);
                return;
            }
            setRunStarted(true);
        }
        const format = settings.formats[formatIndex];
        setChoice({format, bitrate: chosenBitrate, size});
        logEvent("quality_check_settings", {
            format: {label: format.label, mime_type: format.mimeType},
            video_bits_per_second: chosenBitrate,
            audio_bits_per_second: settings.audioBitsPerSecond,
            size: {label: size.label, width: size.width, height: size.height},
            frame_rate: settings.frameRate,
            camera: {width: camera.width, height: camera.height, frame_rate: camera.frameRate},
            capabilities: settings.formats.map((f, i) => ({
                label: f.label,
                mime_type: f.mimeType,
                can_record: capabilities[i]?.canRecord ?? null,
                encoding_info_type: capabilities[i]?.source ?? null,
                supported: capabilities[i]?.supported ?? null,
                smooth: capabilities[i]?.smooth ?? null,
                power_efficient: capabilities[i]?.powerEfficient ?? null,
                hardware_encoder: capabilities[i]?.hardwareEncoder ?? null,
            })),
            hardware_concurrency: navigator.hardwareConcurrency ?? null,
        });
        setPromptIndex(0);
        setStage("record");
    }, [runStarted, tester, formatIndex, chosenBitrate, size, camera, capabilities]);

    const startRecording = useCallback(async () => {
        const item = itemID(promptIndex);
        const text = settings.prompts[promptIndex];
        let recorder: MediaRecorder;
        try {
            recorder = new MediaRecorder(stream, {
                mimeType: choice.format.mimeType,
                videoBitsPerSecond: choice.bitrate,
                audioBitsPerSecond: settings.audioBitsPerSecond,
            });
        } catch (error) {
            setProblem(`The browser wouldn't record ${choice.format.label}: ${error.message}`);
            logEvent("recording_stopped", {kind: "quality_check", item, reason: "failed", ...errorFields(error)}, "error");
            return;
        }
        const chunks: Blob[] = [];
        recorder.addEventListener("dataavailable", (e) => chunks.push(e.data));
        let startedAt = 0;
        recorder.addEventListener("start", () => startedAt = performance.now(), {once: true});
        session.recordings += 1;
        session.recording = session.recordings;
        const now = cameraSettings(stream);
        const timer = window.setTimeout(() => stopRef.current("timed_out"), settings.maxSeconds * 1000);
        stopRef.current = (reason: string) => {
            stopRef.current = () => {};
            window.clearTimeout(timer);
            recorder.addEventListener("stop", () => {
                const durationMs = performance.now() - startedAt;
                const blob = new Blob(chunks, {type: recorder.mimeType});
                logEvent("recording_stopped", {kind: "quality_check", item, reason, bytes: blob.size, duration_ms: Math.round(durationMs)},
                    reason == "timed_out" ? "warning" : "info");
                session.recording = null;
                setRecording(false);
                setTake({item, text, url: URL.createObjectURL(blob), mimeType: recorder.mimeType, bytes: blob.size, durationMs});
                setStage("review");
            }, {once: true});
            recorder.stop();
        };
        recorderRef.current = recorder;
        setRecording(true);
        logEvent("item_shown", {item, text});
        try {
            await pig.record(recorder, {
                type: "recording",
                level: "info",
                module: "quality_check",
                recording: session.recording,
                kind: "quality_check",
                item,
                limit_seconds: settings.maxSeconds,
                format: {label: choice.format.label, mime_type: choice.format.mimeType},
                video_bits_per_second: choice.bitrate,
                audio_bits_per_second: settings.audioBitsPerSecond,
                size: {label: choice.size.label, width: choice.size.width, height: choice.size.height},
                camera: {width: now.width, height: now.height, frame_rate: now.frameRate},
            });
        } catch (error) {
            window.clearTimeout(timer);
            stopRef.current = () => {};
            session.recording = null;
            setRecording(false);
            setProblem(`The recording didn't start: ${error.message}`);
            logEvent("recording_stopped", {kind: "quality_check", item, reason: "failed", ...errorFields(error)}, "error");
        }
    }, [promptIndex, stream, choice]);

    const rate = useCallback((rating: "up" | "down") => {
        logEvent("quality_rating", {item: take.item, rating, recording: session.recordings});
        URL.revokeObjectURL(take.url);
        setTake(null);
        if (promptIndex + 1 < settings.prompts.length) {
            setPromptIndex(promptIndex + 1);
            setStage("record");
        } else {
            setStage("end");
        }
    }, [take, promptIndex]);

    // Sends everything and finalizes the run. Other settings go in a new run,
    // so it's done after each set of prompts either way.
    const finish = useCallback(async (another: boolean) => {
        setStage("sending");
        logEvent("quality_check_finished", {another});
        if (!another) {
            stream?.getTracks().forEach(t => t.stop());
            setStream(null);
        }
        try {
            await pig.finishRun((pending) => setBytesLeft(pending.bytes));
            setRunStarted(false);
            setBytesLeft(null);
            setStage(another ? "setup" : "sent");
        } catch (error) {
            setProblem(`Couldn't finish sending: ${error.message}`);
        }
    }, [stream]);

    if (stage == "intro") {
        return <Intro onDone={() => setStage("setup")} />;
    }

    return (
        <main className={"qc-page"}>
            <h1>Recording quality check</h1>
            {problem && <p className={"qc-problem"} role={"alert"}>{problem}</p>}

            {stage == "setup" && <>
                <div className={"qc-columns"}>
                    <div className={"qc-settings"}>
                        <label className={"qc-field"}>
                            Your ID, so we can find your recordings
                            <input type={"text"} value={rawTester}
                                   onChange={(e) => setRawTester(e.target.value)} />
                        </label>
                        {rawTester && <p className={"qc-note"}>Saved as <strong>{tester || "(nothing usable yet)"}</strong></p>}

                        <fieldset>
                            <legend>Format</legend>
                            {settings.formats.map((format, i) => {
                                const cap = capabilities[i];
                                const notes = !cap ? [] : !cap.canRecord ? ["this browser can't record it"] : [
                                    cap.smooth == null ? null : cap.smooth ? "smooth" : "may stutter",
                                    cap.powerEfficient == null ? null : cap.powerEfficient ? "power-efficient" : "not power-efficient",
                                    cap.hardwareEncoder == null ? null : cap.hardwareEncoder ? "hardware encoder" : "software encoder",
                                ].filter(Boolean);
                                return <label key={format.mimeType} className={cap && !cap.canRecord ? "unavailable" : undefined}>
                                    <input type={"radio"} name={"format"} checked={formatIndex == i}
                                           disabled={!cap?.canRecord} onChange={() => setFormatIndex(i)} />
                                    {format.label}
                                    {notes.length > 0 && <span className={"qc-note"}> ({notes.join(", ")})</span>}
                                </label>;
                            })}
                        </fieldset>

                        <fieldset>
                            <legend>Video bitrate</legend>
                            {settings.bitrates.map((b) => (
                                <label key={b}>
                                    <input type={"radio"} name={"bitrate"} checked={customBitrate == "" && bitrate == b}
                                           onChange={() => {
                                               setBitrate(b);
                                               setCustomBitrate("");
                                           }} />
                                    {kbps(b)}
                                </label>
                            ))}
                            <label>
                                Other:
                                <input type={"number"} min={50} step={50} inputMode={"numeric"} value={customBitrate}
                                       onChange={(e) => setCustomBitrate(e.target.value)} />
                                kbps
                            </label>
                            {customBitrate != "" && !bitrateOK && <p className={"qc-note"}>At least 50 kbps, please.</p>}
                        </fieldset>

                        <fieldset>
                            <legend>Size</legend>
                            {settings.sizes.map((s, i) => (
                                <label key={s.label}>
                                    <input type={"radio"} name={"size"} checked={sizeIndex == i} onChange={() => setSizeIndex(i)} />
                                    {s.label}
                                </label>
                            ))}
                        </fieldset>
                    </div>

                    <div className={"qc-preview"}>
                        {stream ? <VideoFrame stream={stream} mirrored label={"Your camera"} /> : <p>Waiting for the camera…</p>}
                        <p className={"qc-note"}>
                            The camera is sending {camera.width ?? "?"} × {camera.height ?? "?"} at {camera.frameRate ? Math.round(camera.frameRate) : "?"} fps.
                            This is the camera itself; you'll see how the recording looks after each clip.
                        </p>
                    </div>
                </div>
                <button className={"qc-primary"} disabled={!tester || formatIndex == null || !bitrateOK || !stream} onClick={start}>
                    Start Recording With These Settings
                </button>
            </>}

            {stage == "record" && <>
                <p className={"qc-round"}>{choice.format.label}, {kbps(choice.bitrate)}, {choice.size.label} · prompt {promptIndex + 1} of {settings.prompts.length}</p>
                <p className={"qc-prompt"}>{settings.prompts[promptIndex]}</p>
                {stream && <VideoFrame stream={stream} mirrored label={"Your camera"} />}
                {recording ?
                    <button className={"qc-primary qc-recording"} onClick={() => stopRef.current("done_button")}>Stop Recording</button> :
                    <button className={"qc-primary"} onClick={startRecording}>Start Recording</button>}
                {recording && <p className={"qc-note"} role={"status"}>Recording. It stops on its own after {settings.maxSeconds} seconds.</p>}
            </>}

            {stage == "review" && take && <>
                <p className={"qc-round"}>{choice.format.label}, {kbps(choice.bitrate)}, {choice.size.label} · prompt {promptIndex + 1} of {settings.prompts.length}</p>
                <p>Here's what was recorded. Play it back, then tell us whether it looks and sounds right.</p>
                <VideoFrame src={take.url} label={"Your recording"} />
                <p className={"qc-note"}>
                    {take.mimeType}, {(take.bytes / 1_000_000).toFixed(1)} MB over {(take.durationMs / 1000).toFixed(1)} s,
                    about {kbps(take.bytes * 8 / (take.durationMs / 1000))} in all
                </p>
                <div className={"qc-rating"}>
                    <button onClick={() => rate("up")}><FaThumbsUp aria-hidden={true} /> Looks Good</button>
                    <button onClick={() => rate("down")}><FaThumbsDown aria-hidden={true} /> Something's Wrong</button>
                </div>
            </>}

            {stage == "end" && <>
                <p>That's every prompt for these settings. You can try other settings, or finish up.</p>
                <div className={"qc-rating"}>
                    <button onClick={() => finish(true)}>Try Other Settings</button>
                    <button onClick={() => finish(false)}>I'm Done</button>
                </div>
            </>}

            {stage == "sending" && <p role={"status"}>
                Sending your recordings{bytesLeft != null && bytesLeft > 0 ? `: ${(bytesLeft / 1_000_000).toFixed(1)} MB to go` : ""}. Please keep this tab open.
            </p>}

            {stage == "sent" && <p role={"status"}>
                All sent{settings.debug ? " (debug mode: nothing actually left this browser)" : ""}. Thank you! You can close this tab.
            </p>}

            {settings.debug && <div className={"debug-banner"}>Debug mode: nothing is uploaded</div>}
        </main>
    );
}
