import {useEffect, useRef, useState} from "react";
import * as events from "@/utils/events.tsx";

// How many announcements to keep in the page. Screen readers read each one as
// it's added; older ones are dropped so the region doesn't grow forever.
const KEPT = 5;

interface Announcement {
    id: number;
    text: string;
}

// A live region for screen readers, there for the whole session so it's
// already in place when the first announcement arrives. Anything sent with
// events.announce() is added as its own line, so two announcements in a row are
// both read rather than one replacing the other.
export default function Announcer() {
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const nextId = useRef(0);

    useEffect(() => {
        return events.on("announce", (text) => {
            const id = nextId.current++;
            setAnnouncements((current) => [...current, {id, text}].slice(-KEPT));
        });
    }, []);

    return (
        <div className={"visually-hidden"} aria-live={"polite"} aria-relevant={"additions"}>
            {announcements.map((a) => <div key={a.id}>{a.text}</div>)}
        </div>
    );
}
