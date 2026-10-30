import {useEffect, useImperativeHandle, useRef, useState} from "react";
import * as events from "@/utils/events.tsx";
import * as React from "react";
import { FaPlay } from "react-icons/fa";
import {TypeWriter, type TypeWriterFunctions} from "@/components/TypeWriter.tsx";

// A line to say: its text, or its text and something to do once it's all
// showing.
export type Line = string | [text: string, onShown: () => void];

export interface SpeechBubbleFunctions {
    // Shows each line in turn, typing it out. The participant taps (or presses
    // Enter) to skip the typing, and to move on to the next line. Resolves when
    // the last line is all showing, or when something else is said or the
    // bubble is hidden first. Calls onLine as each line starts to show.
    say: (lines: Line[], skipAnimation?: boolean, onLine?: (index: number) => void) => Promise<void>;
    hide: () => void;
    show: () => void;
}

export const SpeechBubble = React.forwardRef<SpeechBubbleFunctions>((_props, ref) => {

    const [isVisible, setIsVisible] = useState(false);
    const [isBlockerUp, setIsBlockerUp] = useState(false);
    const [text, setText] = useState("");
    const [hasNextText, setHasNextText] = useState(false);
    const typeWriterRef = useRef<TypeWriterFunctions>(null);
    const continueButtonRef = useRef<HTMLButtonElement>(null);

    // Counts what's been said, so a say() that's been replaced stops.
    const sayingRef = useRef(0);
    // Set while a line is all showing and the next one waits for a tap.
    const tappedRef = useRef<(() => void) | null>(null);

    function releaseTap() {
        const tapped = tappedRef.current;
        tappedRef.current = null;
        tapped?.();
    }

    useEffect(() => {
        return events.on("speechbubbleblockerclicked", () => {
            if (typeWriterRef.current?.isTyping()) {
                typeWriterRef.current.skipToEnd();
            } else {
                releaseTap();
            }
        });
    }, []);

    useEffect(() => {
        events.emit("speechbubblestatus", isBlockerUp);
    }, [isBlockerUp]);

    async function say(lines: Line[], skipAnimation = false, onLine?: (index: number) => void) {
        const saying = ++sayingRef.current;
        releaseTap();
        setIsVisible(true);
        setIsBlockerUp(true);
        for (let i = 0; i < lines.length; i++) {
            const isLast = i == lines.length - 1;
            const said = lines[i];
            const [line, onShown] = typeof said == "string" ? [said, undefined] : said;
            setText(line);
            setHasNextText(!isLast);
            events.announce(line);
            onLine?.(i);
            const typed = typeWriterRef.current.type(line);
            if (skipAnimation) {
                typeWriterRef.current.skipToEnd();
            }
            await typed;
            if (saying != sayingRef.current) {
                return;
            }
            onShown?.();
            if (!isLast) {
                await new Promise<void>((resolve) => {
                    tappedRef.current = resolve;
                });
                if (saying != sayingRef.current) {
                    return;
                }
            }
        }
        setHasNextText(false);
        setIsBlockerUp(false);
    }

    useImperativeHandle(ref, () => ({
        say: say,
        hide: () => {
            sayingRef.current++;
            typeWriterRef.current?.skipToEnd();
            releaseTap();
            setHasNextText(false);
            setIsBlockerUp(false);
            setIsVisible(false);
        },
        show: () => {
            setIsVisible(true);
        }
    }));

    // Put keyboard and screen reader users on the continue button as soon as
    // there's more to read, the way a tap anywhere works for everyone else.
    useEffect(() => {
        if (hasNextText) {
            continueButtonRef.current?.focus({preventScroll: true});
        }
    }, [hasNextText]);

    return (
        <div
            // Hidden but still taking its space, so nothing below moves
            className={"speechbubble" + (hasNextText ? " has-next-text" : "") + (isVisible ? "" : " invisible")}>
            <div className="speechbubble_tail_parent">
                <div className={"speechbubble_tail"}></div>
            </div>
            {/* Screen readers get each line whole, rather than as it types. The
                Announcer reads it out; this is for reading it again. */}
            <div className={"visually-hidden"}>{text}</div>
            <div aria-hidden={true}>
                <TypeWriter
                    ref={typeWriterRef}
                    delayMS={40}
                    />
            </div>
            {/* Taps and clicks anywhere are handled by SpeechBubbleBlocker, which
                leaves this button's own to it, so keys and screen readers work too. */}
            <button className={"speechbubble_next"}
                    ref={continueButtonRef}
                    onClick={() => events.emit("speechbubbleblockerclicked")}>
                    Tap to Continue
                <div className={"arrow"}><FaPlay aria-hidden={true} /></div>
            </button>
        </div>
    );
});
