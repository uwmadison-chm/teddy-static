import {useEffect, useRef, useState} from "react";
import {Teddy, TeddyAnimations, type TeddyFunctions} from "@/components/Teddy.tsx";
import {VideoUploader} from "@/data/videoUploader.tsx";
import {CurrentSessionData, SetCanLeavePageSafely} from "@/data/sessionData.tsx";
import {
    FADING_PANEL_DEFAULT_LABEL,
    FadingPanel,
    type FadingPanelFunctions,
    FadingPanelSet
} from "@/components/FadingPanelSet.tsx";


export default function CompleteSessionScreen() {
    const teddyRef = useRef<TeddyFunctions>(null);
    const fadingPanelRef = useRef<FadingPanelFunctions>(null);

    const [sessionUploaded, setSessionUploaded] = useState<boolean>(false);
    const [waitingForVideoUploads, setWaitingForVideoUploads] = useState<boolean>(false);

    useEffect(() => {
        CurrentSessionData.complete()
        CurrentSessionData.uploadToServer("sessionComplete", ()=> {
            setSessionUploaded(true);
        })
    }, [teddyRef]);

    function onVideosCompletedUploaded(didUpload:boolean) {
        const nextURL = CurrentSessionData.nextURL;
        if (!nextURL) {
            SetCanLeavePageSafely()
        }
        setWaitingForVideoUploads(false);

            const firstText = didUpload ?
                ["Uploads complete! Hooray! Thank you for waiting."] :
                []
            const secondText = nextURL == null ?
                [
                    "You're all set! Thank you for your time. You may close this tab at any time. Bye bye!",
                ] :
                [
                    "Please press this button to continue your session. Bye!"
                ]
        teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
            firstText.concat(secondText),
            () => {
                if (nextURL) {
                    fadingPanelRef.current.showStartPanel()
                }
                teddyRef.current?.playAnimation(TeddyAnimations.WAVE)
            })
    }

    useEffect(() => {
        if (sessionUploaded) {
            const needToWaitOnUploads = VideoUploader.hasRemainingUploads()
            const teddyTexts = needToWaitOnUploads ?
                [
                    "We just have to wait for your video uploads to complete.",
                    "Do not close this window before your uploads finish."
                ] :
                [
                    "All of your data has been successfully uploaded!",
                ]

            teddyRef.current?.showTextSequence(TeddyAnimations.SLIGHTLY_HAPPY,
                [
                    "You're all finished! Hooray!",
                ].concat(teddyTexts),
                () => {
                    if (needToWaitOnUploads) {
                        setWaitingForVideoUploads(true);
                        VideoUploader.setOnComplete(()=> {
                            onVideosCompletedUploaded(true)
                        })
                    }
                    else {
                        onVideosCompletedUploaded(false)
                    }
                }
            );
        }
    }, [sessionUploaded]);

    return (
        <div className={"wrapper"}>
            <Teddy
                ref={teddyRef}
                initialAnimation={TeddyAnimations.SLIGHTLY_HAPPY}
            />

            <div className={"loader-wrapper"} style={{display: waitingForVideoUploads || !sessionUploaded ? "block" : "none"}}>
                <div className="loader"></div>
                Uploading...
            </div>

            <FadingPanelSet ref={fadingPanelRef}>
                <FadingPanel label={FADING_PANEL_DEFAULT_LABEL}>
                    <button
                            onClick={(_e)=>{
                                SetCanLeavePageSafely()
                                window.location.assign(CurrentSessionData.nextURL);
                            }}>
                        Continue to REDCap
                    </button>
                </FadingPanel>
            </FadingPanelSet>


        </div>
    );
}
