import * as React from "react";
import {useImperativeHandle} from "react";
import {buildStyles, CircularProgressbarWithChildren} from "react-circular-progressbar";
import {FaCheck, FaUser} from "react-icons/fa";
import {interpolateColors} from "@/utils/utils.tsx";
import {Colors} from "@/utils/colors.tsx";
import * as events from "@/utils/events.tsx";
import {loadFaceApi} from "@/utils/faceApi.ts";
import {abortable, Aborted, sleep} from "@/utils/script.ts";

export interface FaceDetectorProps {
    detectionDuration: number;
}

export interface FaceDetectorFunctions {
    // Shows the detector and checks the camera until a face has been in view
    // for detectionDuration. Stops checking when `signal` fires.
    detect: (signal: AbortSignal) => Promise<void>;
    hide: () => void;
}

export const FaceDetector = React.forwardRef<FaceDetectorFunctions, FaceDetectorProps>((props, ref) => {

    const [progress, setProgress] = React.useState(0);
    const [isShown, setIsShown] = React.useState(false);
    const [isFadingOut, setIsFadingOut] = React.useState(false);

    // Each check waits for the last to finish, so slow checks don't pile up.
    async function detect(signal: AbortSignal) {
        setProgress(0)
        setIsShown(true);
        setIsFadingOut(false);
        const videoInput = document.getElementById('userVideo')
        let firstSeen: number | null = null;
        for (;;) {
            await sleep(100, signal);
            let detection: {score: number} | undefined;
            try {
                const faceapi = await abortable(loadFaceApi(), signal)
                detection = await abortable<{score: number} | undefined>(
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-expect-error
                    faceapi.detectSingleFace(videoInput, new faceapi.TinyFaceDetectorOptions({inputSize:224})),
                    signal);
            } catch (error) {
                if (error instanceof Aborted) {
                    throw error;
                }
                // Keep trying. If it never works, the participant can skip it.
                console.error("Couldn't check for a face:", error);
                continue;
            }
            if (detection != null && detection.score > .5) {
                firstSeen ??= Date.now();
                const elapsed = Date.now() - firstSeen;
                setProgress(elapsed / props.detectionDuration)
                if (elapsed > props.detectionDuration) {
                    events.announce("Face found")
                    setProgress(1)
                    return;
                }
            } else {
                // No face detected. Time to reset our counter
                firstSeen = null;
                setProgress(0)
            }
        }
    }

    useImperativeHandle(ref, () => ({
        detect,
        hide: () => {
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

    return (
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
    )
});
