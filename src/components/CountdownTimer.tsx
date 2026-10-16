import * as React from "react";
import {useEffect, useImperativeHandle, useRef} from "react";
import {buildStyles, CircularProgressbar, CircularProgressbarWithChildren} from "react-circular-progressbar";
import {interpolateColors} from "@/utils/utils.tsx";
import {Colors} from "@/utils/colors.tsx";

export interface CountdownTimerProps {
    duration: number;
    countUp?: boolean;
    startColor?: string;
    endColor?: string;
}

export interface CountdownTimerFunctions {
    // Shows the timer and runs it. Resolves when it runs out.
    start: () => Promise<void>;
    cancel: () => void;
    hide: () => void;
    fadeOut: () => void;
}

export const CountdownTimer = React.forwardRef<CountdownTimerFunctions, CountdownTimerProps>(({duration, countUp, startColor, endColor, ...props}, ref) => {

    const intervalRef = useRef(null);

    useEffect(() => () => clearInterval(intervalRef.current), []);
    const startedTimestampRef = useRef(null);
    const [circleProgress, setCircleProgress] = React.useState(0);
    const [elapsedTime, setElapsedTime] = React.useState(0);
    const [isShown, setIsShown] = React.useState(false);
    const [isFadingOut, setIsFadingOut] = React.useState(false);

    useImperativeHandle(ref, () => ({
        start: () => new Promise<void>((resolve) => {
            setElapsedTime(0)
            setCircleProgress(0)
            setIsShown(true);
            setIsFadingOut(false);
            startedTimestampRef.current = new Date().getTime()
            if (intervalRef.current != null) {
                clearInterval(intervalRef.current);
            }
            intervalRef.current = setInterval(async () => {
                setCircleProgress(1)

                const elapsed = new Date().getTime() - startedTimestampRef.current
                setElapsedTime(elapsed)
                if (elapsed >= duration) {
                    setElapsedTime(elapsed)
                    clearInterval(intervalRef.current)
                    resolve()
                }

            }, 10)
        }),
        cancel: () => {
            clearInterval(intervalRef.current)
            setCircleProgress(0)
            setElapsedTime(0)
        },
        hide: () => {
            setIsShown(false)
            setCircleProgress(0)
        },
        fadeOut: () => {
            setTimeout(()=>{
                setIsFadingOut(true)
                setTimeout(() => {
                    setIsShown(false)
                    setCircleProgress(0)
                }, 300)
            }, 300)
        }
    }));

    const displayText = countUp ?
        Math.ceil((duration-elapsedTime)/1000) :
        Math.floor((elapsedTime)/1000);

    return (
        <div className={"countdown-timer"}
        style={{
            display:isShown ? 'block' : 'none',
            opacity:isFadingOut? 0 : 1,
            transition: 'all 0.3s ease',
        }}>
            <CircularProgressbarWithChildren
                value={circleProgress*100}
                maxValue={100}
                strokeWidth={10}
                styles={buildStyles({
                    backgroundColor: '#fff',
                    trailColor: '#fff',
                    strokeLinecap: 'round',
                    pathTransition: `all ${duration/1000}s linear`,
                    pathColor: interpolateColors(startColor || Colors.primary, endColor || Colors.primaryDark, circleProgress),
                })}
            >
                <div
                    className={"circle-progress-text"}
                    style={{
                        color: interpolateColors(startColor || Colors.primary, endColor || Colors.primaryDark, circleProgress),
                        transitionDuration: `${duration/1000}s`,
                        transitionTimingFunction: 'linear',
                    }}
                >{displayText}</div>
            </CircularProgressbarWithChildren>
        </div>
    )
});
