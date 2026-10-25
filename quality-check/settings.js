// Settings for the quality-check page (quality-check.html), which lets a tester
// record with a format, bitrate and size of their choosing and rate how it
// looks. It's separate from any study: build it with
//
//     npm run build:quality-check
//
// or another settings file with QC_SETTINGS=path/to/settings.js. See the
// README's "Quality check" section.
export default {
    // pig's address, and the task the recordings go to. The task needs
    // media = true, and run_key = ["tester"].
    pigServer: "",
    taskCode: "teddy_qc",
    // When true, nothing is sent to pig; events go to the browser console.
    debug: true,

    // The formats to offer, in order. A format the browser can't record is
    // shown but can't be picked.
    formats: [
        {label: "H.264, MP4", mimeType: "video/mp4;codecs=avc1,opus"},
        {label: "H.264, MP4 (AAC audio)", mimeType: "video/mp4;codecs=avc1,mp4a.40.2"},
        {label: "H.264, WebM", mimeType: "video/webm;codecs=h264,opus"},
        {label: "VP9", mimeType: "video/webm;codecs=vp9,opus"},
        {label: "VP8", mimeType: "video/webm;codecs=vp8,opus"},
        {label: "AV1", mimeType: "video/webm;codecs=av01,opus"},
    ],
    // Video bitrates to offer, in bits per second. The tester can also type one.
    bitrates: [250_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_500_000],
    // Sizes to ask the camera for. It gets as close as it can; the page shows
    // what it actually sends.
    sizes: [
        {label: "640 × 480", width: 640, height: 480},
        {label: "1280 × 720", width: 1280, height: 720},
        {label: "1920 × 1080", width: 1920, height: 1080},
    ],
    frameRate: 30,
    audioBitsPerSecond: 64_000,
    // The longest one recording can run.
    maxSeconds: 60,

    // What the tester is asked to talk about, one recording each.
    prompts: [
        "Tell us what you had for breakfast today.",
        "Describe the room you're in right now.",
    ],
};
