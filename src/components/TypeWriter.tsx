import {useCallback, useEffect, useImperativeHandle, useRef, useState} from "react";
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

    useEffect(() => {
        return () => {
            clearInterval(intervalRef.current || 0)
        };
    }, []);

    useEffect(() => {
        if (isTyping) {
            currentProgressRef.current = 0
            intervalRef.current = setInterval(() => {
                currentProgressRef.current += 1;
                setCurrentProgress(currentProgressRef.current)
                if (currentProgressRef.current >= displayString.length) {
                    setIsTyping(false)
                }
            }, delayMS);

        } else {
            clearInterval(intervalRef.current)
            onTypingComplete()
        }

    }, [isTyping]);

    const onSkipToEnd = useCallback(() => {
        setIsTyping(false);
        setCurrentProgress(Number.POSITIVE_INFINITY)
    }, [isTyping, displayString])

    useImperativeHandle(ref, () => ({
        showText: (newText) => {
            setDisplayString(newText || "");
            setCurrentProgress(0)
            setIsTyping(true)
        },
        skipToEnd: () => {
            onSkipToEnd()
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
