import {useEffect, useEffectEvent, useImperativeHandle, useRef, useState} from "react";
import * as React from "react";

export interface TypeWriterFunctions {
    showText: (text: string) => void;
    skipToEnd: () => void;
}

interface Props {
    onTypingComplete: () => void;
    delayMS: number;
}

export const TypeWriter = React.forwardRef<TypeWriterFunctions, Props>(({onTypingComplete, delayMS}, ref) => {
    const [isTyping, setIsTyping] = useState(false);
    const [currentProgress, setCurrentProgress] = useState(0);
    const [displayString, setDisplayString] = useState("");
    const intervalRef = useRef<number>(null);
    const currentProgressRef = useRef<number>(0);
    // The interval reads the text from here, not from state, so it always sees
    // the text it's typing rather than the one from the render that started it.
    const textRef = useRef("");

    function stopInterval() {
        if (intervalRef.current != null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }

    useEffect(() => {
        return stopInterval;
    }, []);

    const onTypingStopped = useEffectEvent(() => {
        onTypingComplete()
    });

    useEffect(() => {
        if (!isTyping) {
            onTypingStopped();
        }
    }, [isTyping]);

    // The interval is started and stopped right here, rather than from an effect
    // after the next render. Otherwise a tick that was already queued could undo
    // a skip, leaving the text cut off partway with typing marked as finished.
    useImperativeHandle(ref, () => ({
        showText: (newText) => {
            stopInterval();
            textRef.current = newText || "";
            currentProgressRef.current = 0;
            setDisplayString(textRef.current);
            setCurrentProgress(0);
            setIsTyping(true);
            intervalRef.current = window.setInterval(() => {
                currentProgressRef.current += 1;
                setCurrentProgress(currentProgressRef.current);
                if (currentProgressRef.current >= textRef.current.length) {
                    stopInterval();
                    setIsTyping(false);
                }
            }, delayMS);
        },
        skipToEnd: () => {
            stopInterval();
            currentProgressRef.current = Number.POSITIVE_INFINITY;
            setCurrentProgress(Number.POSITIVE_INFINITY);
            setIsTyping(false);
        },
    }));

    return (
        <span>
            <span>{displayString.substring(0, currentProgress)}</span><span style={{
                color: "transparent",
            }}>{displayString.substring(currentProgress, displayString.length)}</span>
        </span>
    );
});
