import {useEffect, useImperativeHandle, useRef, useState} from "react";
import * as React from "react";
import {prefersReducedMotion} from "@/utils/utils.tsx";

export interface TypeWriterFunctions {
    // Types out `text`, resolving once it's all showing: typed out, skipped to
    // the end, or replaced by the next line.
    type: (text: string) => Promise<void>;
    skipToEnd: () => void;
    isTyping: () => boolean;
}

interface Props {
    delayMS: number;
}

export const TypeWriter = React.forwardRef<TypeWriterFunctions, Props>(({delayMS}, ref) => {
    const [currentProgress, setCurrentProgress] = useState(0);
    const [displayString, setDisplayString] = useState("");
    const intervalRef = useRef<number>(null);
    const progressRef = useRef(0);
    // The interval reads the text from here, not from state, so it always sees
    // the text it's typing rather than the one from the render that started it.
    const textRef = useRef("");
    // Resolves the line being typed. Set only while typing.
    const doneRef = useRef<(() => void) | null>(null);

    // Stops typing where it is, and resolves the line being typed.
    function finish() {
        if (intervalRef.current != null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        const done = doneRef.current;
        doneRef.current = null;
        done?.();
    }

    useEffect(() => finish, []);

    useImperativeHandle(ref, () => ({
        type: (newText) => {
            finish();
            textRef.current = newText || "";
            progressRef.current = 0;
            setDisplayString(textRef.current);
            setCurrentProgress(0);
            return new Promise<void>((resolve) => {
                doneRef.current = resolve;
                intervalRef.current = window.setInterval(() => {
                    // With reduced motion, the whole line appears on the first tick.
                    progressRef.current += prefersReducedMotion() ? textRef.current.length : 1;
                    setCurrentProgress(progressRef.current);
                    if (progressRef.current >= textRef.current.length) {
                        finish();
                    }
                }, delayMS);
            });
        },
        skipToEnd: () => {
            progressRef.current = Number.POSITIVE_INFINITY;
            setCurrentProgress(Number.POSITIVE_INFINITY);
            finish();
        },
        isTyping: () => doneRef.current != null,
    }));

    return (
        <span>
            <span>{displayString.substring(0, currentProgress)}</span><span style={{
                color: "transparent",
            }}>{displayString.substring(currentProgress, displayString.length)}</span>
        </span>
    );
});
