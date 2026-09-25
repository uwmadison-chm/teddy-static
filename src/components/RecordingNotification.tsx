import { useEffect, useState } from "react";
import emitter from "tiny-emitter/instance";
import { IoVideocam } from "react-icons/io5";

const RecordingNotification = () => {
    const [isUp, setIsUp] = useState(false);

    useEffect(() => {
        emitter.on("recordingnotificationstatus", (isShown: boolean) => {
            setIsUp(isShown);
        });
        return () => {
            emitter.off("recordingnotificationstatus");
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
