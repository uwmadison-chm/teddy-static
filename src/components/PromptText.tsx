import * as React from "react";
import {useImperativeHandle, useRef} from "react";
import {buildStyles, CircularProgressbar, CircularProgressbarWithChildren} from "react-circular-progressbar";
import {interpolateColors} from "@/utils/utils.tsx";
import {Colors} from "@/utils/colors.tsx";

export interface PromptTextProps {
    className?: string;
    children?: React.ReactNode;
}

export interface PromptTextFunctions {
    showText: (text:string, duration?:number) => void;
    startTimer: () => void;
    hide: () => void;
}

export const PromptText = React.forwardRef<PromptTextFunctions, PromptTextProps>(({...props}, ref) => {

    const timerRef = useRef(null);
    const timerFillRef = useRef(null);
    const [isShown, setIsShown] = React.useState(false);
    const [text, setText] = React.useState("");
    const [duration, setDuration] = React.useState(0);
    const [showTimer, setShowTimer] = React.useState(false);
    const durationRef = useRef(0);

    useImperativeHandle(ref, () => ({
        showText: (text:string, duration?:number) => {
            timerFillRef.current.style = "";
            timerRef.current.className = timerRef.current.className.replace("filled","");
            setIsShown(true);
            setText(text)

            // Use a ref here in case we call startTimer before the next render
            durationRef.current = duration || 0;
            setDuration(duration || 0);
            setShowTimer(false);
        },
        startTimer: () => {
            if (durationRef.current) {
                setTimeout(()=> {
                    timerFillRef.current.style = `transition: ${durationRef.current}ms linear`;
                    timerRef.current.className = timerRef.current.className + "filled";
                },50)
                setShowTimer(true);
            }
        },
        hide: () => {
            setIsShown(false)
            setTimeout(()=> {
                setShowTimer(false);
                timerFillRef.current.style = "";
                timerRef.current.className = timerRef.current.className.replace("filled","");
            },320)
        },
    }));

    return (
        <div className={props.className || "prompt-text"}
             style={{
                 opacity:isShown ? 1 : 0,
             }}>
            <div className={"text"}>
                {text}
            </div>
            { props.children }

            <div className={"prompt-timer"} style={{
                "display": duration ? "block" : "none",
                "opacity": showTimer ? 1 : 0,
            }}>
                <div className={"timer "} ref={timerRef}>
                    <div className={"fill"} ref={timerFillRef} style={{
                        "transition": `linear`,
                    }}></div>
                </div>

            </div>

        </div>
    )
});
