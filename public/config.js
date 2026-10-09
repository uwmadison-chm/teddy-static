// Deployment configuration. Edit this file on the server; no rebuild needed.
window.TEDDY_CONFIG = {
    // Base URL for pig's API, e.g. "https://wilbur.chm.wisc.edu/api/"
    apiUrl: "",
    // When true, nothing is uploaded; uploads are logged to the console instead,
    // and every screen shows a "Debug mode" banner.
    debug: true,
    // Hosts the end screen may send participants to with nextURL, e.g.
    // ["redcap.example.edu"]. Empty means any http or https URL.
    nextUrlHosts: [],
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
    },
};
