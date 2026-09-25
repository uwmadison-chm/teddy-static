import { useEffect, useState } from "react";
import * as events from "@/utils/events.tsx";
import { IoVideocam } from "react-icons/io5";

const RecordingNotification = () => {
    const [isUp, setIsUp] = useState(false);

    useEffect(() => {
        const off = events.on("recordingnotificationstatus", (isShown) => {
            setIsUp(isShown);
        });
        return () => {
            off();
        };
    }, []);
    if (!isUp) {
        return <div />;
    }

    return (
        <div className={"recording-notification"}>
            <IoVideocam />
            Recording
    </div>
);
};

export default RecordingNotification;
