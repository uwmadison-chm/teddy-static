import { useEffect, useRef } from "react";
import * as events from "@/utils/events.tsx";

// Whether an event happened on the speech bubble's continue button, which
// handles its own clicks.
function onContinueButton(e: Event): boolean {
    return e.target instanceof Element && e.target.closest(".speechbubble_next") != null;
}

const SpeechBubbleBlocker = () => {
    const isUpRef = useRef(false);

    useEffect(() => {
        const off = events.on("speechbubblestatus", (isShown) => {
            isUpRef.current = isShown;
            if ('ontouchstart' in window) {
                window.document.body.ontouchstart = (e: TouchEvent) => {
                    if (!onContinueButton(e)) {
                        events.emit("speechbubbleblockerclicked");
                    }
                }
            } else {
                window.document.body.onclick = (e: PointerEvent) => {
                    if (e.pointerType && !onContinueButton(e)) {
                        events.emit("speechbubbleblockerclicked");
                    }
                }
            }
        });

        // Enter or Space moves Teddy along when nothing else has the keyboard,
        // as when the last line of a message is still typing out.
        const onKeyDown = (e: KeyboardEvent) => {
            const nothingFocused = document.activeElement == null || document.activeElement == document.body;
            if (isUpRef.current && nothingFocused && !e.repeat && (e.key == "Enter" || e.key == " ")) {
                e.preventDefault();
                events.emit("speechbubbleblockerclicked");
            }
        };
        document.addEventListener("keydown", onKeyDown);

        return () => {
            off();
            document.removeEventListener("keydown", onKeyDown);
            window.document.body.onclick = null;
            window.document.body.ontouchstart = null;
        };
    }, []);

    return <div />;
//     if (!isUp) {
//         return <div />;
//     }
//
//     return (
//         <div style={{
//             position: "absolute",
//                 zIndex: 10000,
//                 top: 0,
//                 left: 0,
//                 bottom: 0,
//                 right: 0
//         }}
//              onClick={()=> {
//                  events.emit("speechbubbleblockerclicked");
//              }}
//         >
//     </div>
// );
};

export default SpeechBubbleBlocker;
