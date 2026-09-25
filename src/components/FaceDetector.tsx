import * as React from "react";
import {useImperativeHandle, useRef} from "react";
import * as faceapi from 'face-api.js';
import {buildStyles, CircularProgressbar, CircularProgressbarWithChildren} from "react-circular-progressbar";
import {interpolateColors} from "@/utils/utils.tsx";
import {Colors} from "@/utils/colors.tsx";

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

    const intervalRef = useRef(null);
    const faceFirstSeenTimestampRef = useRef(null);
    const [progress, setProgress] = React.useState(0);
    const [isShown, setIsShown] = React.useState(false);
    const [isFadingOut, setIsFadingOut] = React.useState(false);

    useImperativeHandle(ref, () => ({
        start: () => {
            setProgress(0)
            setIsShown(true);
            const videoInput = document.getElementById('userVideo')
            if (intervalRef.current != null) {
                clearInterval(intervalRef.current);
            }
            intervalRef.current = setInterval(async () => {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                const detection = await faceapi.detectSingleFace(videoInput, new faceapi.TinyFaceDetectorOptions({inputSize:224}))

                if (detection != null && detection.score > .5) {
                    if (faceFirstSeenTimestampRef.current == null) {
                        faceFirstSeenTimestampRef.current = new Date().getTime()
                    }
                    const elapsed = new Date().getTime() - faceFirstSeenTimestampRef.current
                    setProgress(elapsed / props.detectionDuration)
                    if (elapsed > props.detectionDuration) {
                        props.onDetected()
                        clearInterval(intervalRef.current)
                        setProgress(1)
                    }
                } else {
                    // No face detected. Time to reset our counter
                    faceFirstSeenTimestampRef.current = null
                    setProgress(0)
                }

            }, 100)

        },
        stop: () => {
            clearInterval(intervalRef.current)
            setProgress(0)
        },
        hide: () => {
            setInterval(()=>{
                setIsFadingOut(true)
                setInterval(() => {
                    setIsShown(false)
                }, 300)
            }, 300)
        }
    }));

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
                >{Math.ceil(props.detectionDuration*(1-progress)/1000)}</div>
            </CircularProgressbarWithChildren>
        </div>
    )
});
