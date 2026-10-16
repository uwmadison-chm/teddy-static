import * as React from "react";
import {useEffect, useImperativeHandle, useRef} from "react";
import {buildStyles, CircularProgressbarWithChildren} from "react-circular-progressbar";
import {FaCheck, FaUser} from "react-icons/fa";
import {interpolateColors} from "@/utils/utils.tsx";
import {Colors} from "@/utils/colors.tsx";
import * as events from "@/utils/events.tsx";
import {loadFaceApi} from "@/utils/faceApi.ts";

export interface FaceDetectorProps {
    onDetected: () => void;
    detectionDuration: number;
}

export interface FaceDetectorFunctions {
    start: () => void;
    stop: () => void;
    hide: () => void;
}

export const FaceDetector = React.forwardRef<FaceDetectorFunctions, FaceDetectorProps>((props, ref) => {

    // Set while detecting. Each check waits for the last to finish, so slow
    // checks don't pile up.
    const timeoutRef = useRef<number | null>(null);
    const runningRef = useRef(false);
    const faceFirstSeenTimestampRef = useRef(null);
    const [progress, setProgress] = React.useState(0);
    const [isShown, setIsShown] = React.useState(false);
    const [isFadingOut, setIsFadingOut] = React.useState(false);

    function stopDetecting() {
        runningRef.current = false;
        if (timeoutRef.current != null) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }

    // Stop when the screen goes, too: the next screen has a #userVideo of its own.
    useEffect(() => stopDetecting, []);

    useImperativeHandle(ref, () => ({
        start: () => {
            setProgress(0)
            setIsShown(true);
            setIsFadingOut(false);
            const videoInput = document.getElementById('userVideo')
            stopDetecting();
            runningRef.current = true;
            const check = async () => {
                timeoutRef.current = null;
                const faceapi = await loadFaceApi()
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                const detection = await faceapi.detectSingleFace(videoInput, new faceapi.TinyFaceDetectorOptions({inputSize:224}))
                if (!runningRef.current) {
                    return;
                }

                if (detection != null && detection.score > .5) {
                    if (faceFirstSeenTimestampRef.current == null) {
                        faceFirstSeenTimestampRef.current = new Date().getTime()
                    }
                    const elapsed = new Date().getTime() - faceFirstSeenTimestampRef.current
                    setProgress(elapsed / props.detectionDuration)
                    if (elapsed > props.detectionDuration) {
                        stopDetecting()
                        events.announce("Face found")
                        props.onDetected()
                        setProgress(1)
                        return;
                    }
                } else {
                    // No face detected. Time to reset our counter
                    faceFirstSeenTimestampRef.current = null
                    setProgress(0)
                }
                timeoutRef.current = window.setTimeout(check, 100);
            };
            timeoutRef.current = window.setTimeout(check, 100);
        },
        stop: () => {
            stopDetecting()
            setProgress(0)
        },
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
