import * as React from "react";
import {useImperativeHandle} from "react";
import {buildStyles, CircularProgressbarWithChildren} from "react-circular-progressbar";
import {FaCheck, FaUser} from "react-icons/fa";
import {interpolateColors} from "@/utils/utils.tsx";
import {Colors} from "@/utils/colors.tsx";
import * as events from "@/utils/events.tsx";
import {loadFaceApi} from "@/utils/faceApi.ts";
import {abortable, Aborted, sleep} from "@/utils/script.ts";

// A face counts when the detector is at least this sure of it.
const FACE_SCORE = 0.5;
// Fainter guesses than that still say where a face probably is, for the tips.
const GUESS_SCORE = 0.2;
// How long to look without holding a face before showing tips.
const TROUBLE_AFTER_MS = 2000;
// Checks that fail this many times in a row mean the detector doesn't work here.
const MAX_FAILED_CHECKS = 3;
// Mean brightness, 0-255, that a face (or the middle of the picture, if there's
// no face to measure) should fall between.
const MIN_LIGHT = 60;
const MAX_LIGHT = 235;

export interface FaceDetectorProps {
    detectionDuration: number;
}

// How detect() ended: a face held in view, or the detector couldn't run here.
export interface FaceCheckResult {
    found: boolean;
    error?: unknown;
}

// What the checks found, for the event log.
export type FaceCheckSummary = {
    // The highest score any check gave a face, or null if none found one.
    best_score: number | null;
    // Whether the last check found a face roughly in the middle of the
    // camera's circle.
    centered: boolean;
    // Whether the last check found the face (or the middle of the picture,
    // without one) neither too dark nor washed out.
    light_ok: boolean;
    tips_shown: boolean;
};

export interface FaceDetectorOptions {
    // Called once, if a face hasn't been held in view for a while and the tips
    // have come up.
    onTrouble?: () => void;
}

export interface FaceDetectorFunctions {
    // Shows the detector and checks the camera until a face has been in view
    // for detectionDuration, or until the detector proves it can't run. Stops
    // checking when `signal` fires.
    detect: (signal: AbortSignal, options?: FaceDetectorOptions) => Promise<FaceCheckResult>;
    summary: () => FaceCheckSummary;
    hide: () => void;
}

interface Box {x: number, y: number, width: number, height: number}

// The part of the camera's picture the participant sees in the circle: the
// biggest centered square, since the video is shown with object-fit: cover.
function visibleSquare(video: HTMLVideoElement): Box {
    const w = video.videoWidth, h = video.videoHeight;
    const side = Math.min(w, h);
    return {x: (w - side) / 2, y: (h - side) / 2, width: side, height: side};
}

// Whether a face's box sits in the middle half of the circle, and is big
// enough that the participant isn't far from the camera.
function isCentered(face: Box, square: Box): boolean {
    const cx = (face.x + face.width / 2 - square.x) / square.width;
    const cy = (face.y + face.height / 2 - square.y) / square.height;
    return cx > 0.25 && cx < 0.75 && cy > 0.25 && cy < 0.75 && face.width > square.width * 0.15;
}

// Mean brightness of part of the video, 0-255, from a small copy of it.
function brightness(video: HTMLVideoElement, area: Box, canvas: HTMLCanvasElement): number | null {
    const size = 32;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", {willReadFrequently: true});
    if (context == null || area.width <= 0 || area.height <= 0) {
        return null;
    }
    context.drawImage(video, area.x, area.y, area.width, area.height, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        total += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    }
    return total / (pixels.length / 4);
}

interface Tip {
    text: string;
    // Whether the camera's picture seems to satisfy this tip; undefined for
    // tips we can't check.
    ok?: boolean;
}

export const FaceDetector = React.forwardRef<FaceDetectorFunctions, FaceDetectorProps>((props, ref) => {

    const [progress, setProgress] = React.useState(0);
    const [isShown, setIsShown] = React.useState(false);
    const [isFadingOut, setIsFadingOut] = React.useState(false);
    const [tipsShown, setTipsShown] = React.useState(false);
    const [centered, setCentered] = React.useState(false);
    const [lightOk, setLightOk] = React.useState(false);
    const summaryRef = React.useRef<FaceCheckSummary>({best_score: null, centered: false, light_ok: false, tips_shown: false});
    const canvasRef = React.useRef<HTMLCanvasElement>(null);

    // Each check waits for the last to finish, so slow checks don't pile up.
    async function detect(signal: AbortSignal, options: FaceDetectorOptions = {}): Promise<FaceCheckResult> {
        setProgress(0)
        setIsShown(true);
        setIsFadingOut(false);
        setTipsShown(false);
        summaryRef.current = {best_score: null, centered: false, light_ok: false, tips_shown: false};
        canvasRef.current ??= document.createElement("canvas");
        const video = document.getElementById('userVideo') as HTMLVideoElement;

        let faceapi;
        try {
            faceapi = await abortable(loadFaceApi(), signal);
        } catch (error) {
            if (error instanceof Aborted) {
                throw error;
            }
            console.error("Couldn't load the face detector:", error);
            return {found: false, error};
        }
        const detectorOptions = new faceapi.TinyFaceDetectorOptions({inputSize: 224, scoreThreshold: GUESS_SCORE});

        let firstSeen: number | null = null;
        // Since when we've been looking without holding a face.
        let lookingSince = Date.now();
        let failedChecks = 0;
        for (;;) {
            await sleep(100, signal);
            let detection: {score: number, box: Box} | undefined;
            let light: number | null;
            try {
                detection = await abortable(faceapi.detectSingleFace(video, detectorOptions).run(), signal);
                const square = visibleSquare(video);
                light = brightness(video, detection?.box ?? square, canvasRef.current);
                failedChecks = 0;
            } catch (error) {
                if (error instanceof Aborted) {
                    throw error;
                }
                console.error("Couldn't check for a face:", error);
                if (++failedChecks >= MAX_FAILED_CHECKS) {
                    return {found: false, error};
                }
                continue;
            }

            const summary = summaryRef.current;
            summary.centered = detection != null && isCentered(detection.box, visibleSquare(video));
            summary.light_ok = light != null && light >= MIN_LIGHT && light <= MAX_LIGHT;
            if (detection != null) {
                summary.best_score = Math.max(summary.best_score ?? 0, detection.score);
            }
            setCentered(summary.centered);
            setLightOk(summary.light_ok);

            if (detection != null && detection.score > FACE_SCORE) {
                firstSeen ??= Date.now();
                const elapsed = Date.now() - firstSeen;
                setProgress(elapsed / props.detectionDuration)
                if (elapsed > props.detectionDuration) {
                    events.announce("Face found")
                    setProgress(1)
                    return {found: true};
                }
            } else {
                // No face detected. Time to reset our counter
                if (firstSeen != null) {
                    lookingSince = Date.now();
                }
                firstSeen = null;
                setProgress(0)
                if (!summary.tips_shown && Date.now() - lookingSince > TROUBLE_AFTER_MS) {
                    summary.tips_shown = true;
                    setTipsShown(true);
                    options.onTrouble?.();
                }
            }
        }
    }

    useImperativeHandle(ref, () => ({
        detect,
        summary: () => ({...summaryRef.current}),
        hide: () => {
            setTipsShown(false);
            // Leave the checkmark up long enough to read as confirmation
            setTimeout(()=>{
                setIsFadingOut(true)
                setTimeout(() => {
                    setIsShown(false)
                }, 300)
            }, 1200)
        }
    }));

    const detected = progress >= 1;
    const tips: Tip[] = [
        {text: "Center your face in the circle", ok: centered},
        {text: "Make sure your face is well lit", ok: lightOk},
        {text: "Move somewhere you stand out from the background"},
        {text: "Wipe off your camera"},
    ];

    return (
        <>
            <div className={"face-detector"}
            style={{
                display:isShown ? 'block' : 'none',
                opacity:isFadingOut? 0 : 1,
                transition: 'all 0.3s ease',
            }}>
                <CircularProgressbarWithChildren
                    value={progress*100}
                    maxValue={100}
                    strokeWidth={10}
                    styles={buildStyles({
                        backgroundColor: '#ccc',
                        pathTransition: 'all .5s',
                        strokeLinecap: 'round',
                        pathColor: interpolateColors(Colors.primary, Colors.primaryDark, progress),
                    })}
                >
                    <div
                        className={"circle-progress-text"}
                        style={{color: interpolateColors(Colors.primary, Colors.primaryDark, progress)}}
                    >{detected ? <FaCheck aria-hidden={true} /> : <FaUser aria-hidden={true} style={{opacity: 0.4}} />}</div>
                </CircularProgressbarWithChildren>
            </div>
            <div className={"face-tips" + (tipsShown ? " shown" : "")} hidden={!isShown}>
                {tipsShown && <>
                    <ul>
                        {tips.map((tip) => (
                            <li key={tip.text} className={tip.ok === undefined ? "unchecked" : tip.ok ? "ok" : "not-ok"}>
                                <span className={"box"} aria-hidden={true}>{tip.ok && <FaCheck />}</span>
                                {tip.text}
                                {tip.ok && <span className={"visually-hidden"}> (looks good)</span>}
                            </li>
                        ))}
                    </ul>
                    <p>Sometimes this just doesn't work, and that's fine.</p>
                </>}
            </div>
        </>
    )
});
