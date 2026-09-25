import axios from "axios";
import {removeItem} from "@/utils/utils.tsx";
import {CurrentSessionData} from "@/data/sessionData.tsx";

class VideoUpload {
    videoID: string;
    video: Blob;
    status: string;
    UUID: string;
    extra?:string;

    constructor(videoID: string, video: Blob, extra?:string) {
        this.videoID = videoID;
        this.video = video;
        this.UUID = crypto.randomUUID();
        this.extra = extra;
        this.status = "uploading";
        if (!CurrentSessionData.recordingUUIDs.includes(this.UUID)) {
            CurrentSessionData.recordingUUIDs.push(this.UUID);
        }
    }
}

class VideoUploaderClass {
    uploads: VideoUpload[];
    onComplete: ()=>void;

    constructor() {
        this.uploads = [];
    }

    hasRemainingUploads() : boolean {
        for (const upload of this.uploads) {
            if (upload.status != "complete") {
                return true;
            }
        }
        return false;
    }

    upload(video:Blob, videoID:string, extra?:string): void {
        const videoUpload = new VideoUpload(videoID, video, extra)
        this.uploads.push(videoUpload);

        const data = new FormData();

        // In UserVideo we default to webm unless it's not supported. Then we use MP4.
        let extension = ".webm";
        if (!MediaRecorder.isTypeSupported("video/webm")) {
            extension = ".mp4";
        }

        data.append('video', video, videoID + extension);
        data.append('data', JSON.stringify({
            participantId: CurrentSessionData.participantID,
            uploadTimestamp: new Date().getTime(),
            studyID: CurrentSessionData.studyID,
            sessionUUID: CurrentSessionData.sessionUUID,
            videoID: videoID,
            videoUUID: videoUpload.UUID,
            extraData:extra,
        }));

        axios.post("/api/upload_video/", data)
            .then(function (response) {
                videoUpload.status = "complete";
                VideoUploader.checkIfShouldCallOnComplete()
            })
            .catch(function (error) {
                console.log(error);
                removeItem(VideoUploader.uploads, videoUpload);
                VideoUploader.upload(video, videoID, extra);
            })


    }

    setOnComplete(onComplete:()=>void): void {
        this.onComplete = onComplete;
        this.checkIfShouldCallOnComplete();
    }

    checkIfShouldCallOnComplete(): void {
        if (!this.hasRemainingUploads() && this.onComplete != null) {
            this.onComplete()
        }
    }
}

export const VideoUploader = new VideoUploaderClass();
