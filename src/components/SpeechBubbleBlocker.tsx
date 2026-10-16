import { useEffect, useRef } from "react";
import * as events from "@/utils/events.tsx";

// Whether an event happened on a button or other control, which handles its
// own clicks. The speech bubble's continue button is one. A panel button is
// another: it often starts Teddy's next line, which the same click would
// otherwise skip as it bubbles up.
function onControl(e: Event): boolean {
    return e.target instanceof Element &&
        e.target.closest("button, a, input, label, select, textarea") != null;
}

const SpeechBubbleBlocker = () => {
    const isUpRef = useRef(false);

    useEffect(() => {
        const off = events.on("speechbubblestatus", (isShown) => {
            isUpRef.current = isShown;
        });

        // A click or tap anywhere else moves Teddy along. Clicks from the
        // keyboard have no pointerType; keys are handled below.
        const onClick = (e: PointerEvent) => {
            if (e.pointerType && !onControl(e)) {
                events.emit("speechbubbleblockerclicked");
            }
        };
        document.addEventListener("click", onClick);

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
            document.removeEventListener("click", onClick);
            document.removeEventListener("keydown", onKeyDown);
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
