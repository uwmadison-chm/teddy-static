import {type RefObject, useCallback, useEffect, useImperativeHandle, useRef, useState} from "react";
import emitter from "tiny-emitter/instance";
import * as React from "react";
import { FaPlay } from "react-icons/fa";
import {TypeWriter} from "@/components/TypeWriter.tsx";

interface SpeechBubbleProps {
    initialText?: string;
    onComplete?: () => void;
    textStyleOverride?: object;
    bubbleStyleOverride?: object;
}

interface SpeechBubbleFunctions {
    showText: (text: string, autoShow?: boolean, callback?: () => void, maxTimeout?: number) => void;
    showTextSequence: (textArray: Array<string>, callback?: () => void, maxTimeout?: number) => void;
    blockerTapped: () => void;
    hide: () => void;
    show: () => void;
}

export const SpeechBubble = React.forwardRef<SpeechBubbleFunctions, SpeechBubbleProps>((props, ref) => {


    const [isVisible, setIsVisible] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [isBlockerUp, setIsBlockerUp] = useState(false);
    const [text, setText] = useState("");
    const [queuedText, setQueuedText] = useState<string[]>([]);
    const [onAnimationFinishCallback, setOnAnimationFinishCallback] = useState<null | (undefined | (() => (() => void)))>(null);
    const [maxTextDuration, setMaxTextDuration] = useState<number | undefined | null>(null);
    const [timeoutId, setTimeoutId] = useState<number | null>(null);
    const [didTimeout, setDidTimeout] = useState(false);
    const typeWriterRef = useRef(null);

    useEffect(() => {
        emitter.on("speechbubbleblockerclicked", function() {
            (ref as RefObject<SpeechBubbleFunctions>).current.blockerTapped();
        });
        if (props.initialText) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsTyping(true);
            setText(props.initialText);
            typeWriterRef.current.showText(props.initialText);
        }

        return () => {
            emitter.off("speechbubbleblockerclicked");
        };
    }, []);

    const cancelMessageTimeout = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            setTimeoutId(null);
        }

    };

    const setMessageTimeout = () => {
        cancelMessageTimeout();
        if (maxTextDuration) {
            setTimeoutId(setTimeout(() => {
                setDidTimeout(true);
            }, maxTextDuration));
        }
    };

    const blockerTapped = useCallback(() => {
        if (isTyping) {
            setIsTyping(false);
            typeWriterRef.current.skipToEnd()
        } else {
            cancelMessageTimeout();
            if (queuedText.length > 0) {
                const newText = queuedText.shift() as unknown as string
                setText(newText);
                typeWriterRef.current.showText(newText);
                setIsTyping(true);
                setQueuedText([...queuedText]);
            } else {
                setIsBlockerUp(false);
            }
        }
    }, [isTyping, queuedText]);

    useEffect(() => {
        if (didTimeout) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            blockerTapped();
            setDidTimeout(false);
        }
    }, [didTimeout]);

    useEffect(() => {
        if (isTyping) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setIsBlockerUp(true);
            setMessageTimeout();
        }
    }, [isTyping]);

    useEffect(() => {
        emitter.emit("speechbubblestatus", isBlockerUp);
    }, [isBlockerUp]);

    useImperativeHandle(ref, () => ({
        showText: (newText, skipAnimation=false, callback, maxTextDuration) => {
            setText(newText);
            typeWriterRef.current.showText(newText);
            if (skipAnimation) {
                typeWriterRef.current.skipToEnd();
            }
            setOnAnimationFinishCallback(() => callback);
            setMaxTextDuration(maxTextDuration);
            setIsTyping(!skipAnimation);
            setIsVisible(true);
        },
        showTextSequence: (textArray, callback, maxTextDuration) => {
            const newText = textArray.shift() as string
            setText(newText);
            typeWriterRef.current.showText(newText);
            setOnAnimationFinishCallback(() => callback);
            setMaxTextDuration(maxTextDuration);
            setIsTyping(true);
            setIsVisible(true);
            setQueuedText([...textArray]);
        },
        blockerTapped: () => {
            blockerTapped();
        },
        hide: () => {
            cancelMessageTimeout();
            setIsTyping(false);
            setIsBlockerUp(false);
            setIsVisible(false);
            typeWriterRef.current.skipToEnd();
        },
        show: () => {
            setIsVisible(true);
        }
    }));

    return (
        <div
            className={"speechbubble " + (queuedText.length > 0 && text ? "has-next-text" : "")}
            style={{
                display: isVisible ? "flex" : "none",
            }}>
            <div className="speechbubble_tail_parent">
                <div className={"speechbubble_tail"}></div>
            </div>
            <div>
                <TypeWriter
                    ref={typeWriterRef}
                    onTypingComplete={useCallback(()=> {
                                setIsTyping(false);
                                if (queuedText.length == 0) {
                                    if (onAnimationFinishCallback) {
                                        onAnimationFinishCallback();
                                    }
                                    setIsBlockerUp(false);
                                }
                            }, [queuedText, onAnimationFinishCallback])}
                    delayMS={40}
                    />
            </div>
            <div className={"speechbubble_next"}>
                    Tap to Continue
                <div className={"arrow"}><FaPlay /></div>
            </div>
        </div>
    );
});
