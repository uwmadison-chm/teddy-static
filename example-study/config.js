// Study settings. They're built into Teddy, so a change here needs a rebuild.
export default {
    // Pig's address, e.g. "https://pig.example.edu"
    pigServer: "",
    // The task code this deployment of Teddy sends data to, as pig's configuration names it.
    taskCode: "",
    // When true, nothing is sent to pig; events are logged to the console instead,
    // and every screen shows a "Debug mode" banner.
    debug: true,
    // Hosts the end screen may send participants to with nextURL, e.g.
    // ["redcap.example.edu"]. Empty means any http or https URL.
    nextUrlHosts: [],
    // When the camera can't be used, whether to offer a button to nextURL after
    // telling the participant to try another device. When false, the session
    // ends there and the participant is told to close the tab.
    nextUrlAfterCameraFailure: false,
    // Each module this study uses, and the CSV of its items, relative to this
    // folder. Links can only name these modules. Reel files are found relative
    // to the reels CSV.
    modules: {
        sentences: "sentences.csv",
        videologs: "videologs.csv",
        questions: "questions.csv",
        // reels: "reels/reels.csv",
    },
    // How recordings are made. Leave any of these out to use the default shown.
    recording: {
        // Tried in order; the first one this browser can record is used.
        mimeTypes: ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"],
        videoBitsPerSecond: 1000000,
        audioBitsPerSecond: 64000,
        // What to ask the camera for. The browser gets as close as the camera allows.
        width: 640,
        height: 480,
        frameRate: 30,
        // The longest any one recording can run, in seconds, so a session left
        // open doesn't record for hours. Modules may stop their recordings sooner.
        maxSeconds: 600,
    },
};
