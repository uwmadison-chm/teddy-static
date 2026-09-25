import {useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef, useState} from "react";
import * as events from "@/utils/events.tsx";
import * as React from "react";
import { FaPlay } from "react-icons/fa";
import {TypeWriter} from "@/components/TypeWriter.tsx";

interface SpeechBubbleProps {
    initialText?: string;
    onComplete?: () => void;
    textStyleOverride?: object;
    bubbleStyleOverride?: object;
}

export interface SpeechBubbleFunctions {
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

    const onBlockerClicked = useEffectEvent(() => {
        blockerTapped();
    });

    const showInitialText = useEffectEvent(() => {
        if (props.initialText) {
            setIsTyping(true);
            setText(props.initialText);
            typeWriterRef.current.showText(props.initialText);
        }
    });

    useEffect(() => {
        const off = events.on("speechbubbleblockerclicked", () => onBlockerClicked());
        showInitialText();

        return () => {
            off();
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
            setTimeoutId(window.setTimeout(() => {
                setDidTimeout(true);
            }, maxTextDuration));
        }
    };

    const blockerTapped = () => {
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
    };

    const onMessageTimedOut = useEffectEvent(() => {
        blockerTapped();
        setDidTimeout(false);
    });

    useEffect(() => {
        if (didTimeout) {
            onMessageTimedOut();
        }
    }, [didTimeout]);

    const onTypingStarted = useEffectEvent(() => {
        setIsBlockerUp(true);
        setMessageTimeout();
    });

    useEffect(() => {
        if (isTyping) {
            onTypingStarted();
        }
    }, [isTyping]);

    useEffect(() => {
        events.emit("speechbubblestatus", isBlockerUp);
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
