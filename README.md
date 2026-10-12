# TeddyWeb Static

This is a standalone, static adaptation of the [React version of Teddy(https://github.com/MITMediaLabAffectiveComputing/Teddy), written by Craig Ferguson at the MIT Media Lab.

This version of Teddy is intended to be launched via a link from REDCap (or survey software of your choosing) and to send data to an installation of [pig](https://github.com/uwmadison-chm/psych-ingestor).

## Setup

To run the dev server, first make sure you have Node and NPM installed and updated.

First, run `npm install` to install all requirements.

Run `npx vite` to start the development server. The page should be running and available at http://localhost:9000/.

The dev server and the build use the study in `example-study/` unless `TEDDY_STUDY` names another (see below).

To send data while developing, run a pig (`pig serve` in a psych-ingestor checkout) with a task that has `media = true`, and point `pigServer` and `taskCode` in the study's `config.js` at it, with `debug: false`. Pig allows cross-origin requests by default.

## Studies

A study is a folder with Teddy's settings and the items each module can show. It's built into Teddy, so changing anything in it means rebuilding. The folder can live anywhere, such as its own repository; `example-study/` is a starting point.

```
my-study/
  config.js       settings
  sentence.csv    sentences for the sentence module
  videolog.csv    prompts for the videolog module
  reels/
    reels.csv     reels for the reels module
    *.mp4         the reel videos
```

Only `config.js` has a fixed name; it says where everything else is.

Build with `TEDDY_STUDY=path/to/my-study npm run build`, or run the dev server the same way with `npx vite`. The build checks the study and stops with a list of problems if anything's wrong: an unknown or mistyped setting, a missing `pigServer` or `taskCode` (unless `debug` is on), a module CSV that isn't there, is missing a column, or has an empty value or a repeated ID, or a reel file that isn't there.

### config.js

`config.js` exports its settings: `export default {pigServer: "...", ...}`.

- `pigServer`: pig's address, e.g. `https://pig.example.edu`. If pig's task configuration restricts which sites may send to it, this site has to be one of them.
- `taskCode`: the task this deployment sends data to, as pig's configuration names it. The task needs `media = true`.
- `debug`: when `true`, nothing is sent to pig; events are logged to the console, and every screen shows a "Debug mode" banner. It can only be set here, not from a link, so a participant can't end up in a session that records nothing.
- `nextUrlHosts`: the hosts that the `nextURL` link parameter may point to, e.g. `["redcap.example.edu"]`. Teddy only follows `http` and `https` URLs, and when this list isn't empty, only URLs on these hosts. Any other `nextURL` is ignored, and the end screen tells the participant they can close the tab.
- `modules`: the modules this study uses, and the CSV of items for each, relative to the study folder: `{sentence: "sentence.csv", reels: "reels/reels.csv"}`. A module left out isn't in this build, and a link that names it gets the "something's wrong with this link" screen. With no `modules`, links can only run the face check and calibration.
- `recording`: how recordings are made. `mimeTypes` is tried in order and the first one the browser can record wins, so WebM is preferred and Safari falls back to MP4. `videoBitsPerSecond` and `audioBitsPerSecond` set the size: the defaults (1 Mbps and 64 kbps) come to about 8 MB a minute. `width`, `height`, and `frameRate` are what Teddy asks the camera for. Any of these can be left out to use the default.

### Item CSVs

Each module's CSV has a header row and one item per row. `id` is what a link uses to name the item; IDs are text, so `01` and `1` are different. The other required columns:

- `sentence`: `text`, the sentence to read aloud.
- `videolog`: `text`, the prompt.
- `reels`: `file`, the video's path relative to the reels CSV (and inside its folder), or an `http(s)` URL to play it from somewhere else. The build copies each listed file to `assets/reels/`, with a hash in its name; files that the CSV doesn't list are left out.

Other columns are allowed and are kept with each item. Excel's UTF-8 CSV export works; use "CSV UTF-8" so curly quotes and accents survive.

## Linking to Teddy

Teddy passes every parameter in its link to pig when it starts the run. Which ones are required, and which identify the participant, is up to the task's definition in pig's configuration. Pig records the rest. If pig refuses the run (a required parameter is missing, or the task is closed), Teddy says so before asking for the camera.

Teddy also reads `nextURL` (where the end screen sends the participant), `expirationTime` (a time in milliseconds after which the link no longer works), and `modules`.

`modules` lists the activities to run, in order, separated by `|`. Each names its items, from the study's CSVs, after a colon: `modules=videolog:01,03|sentence:02|reels:01,02`. A module with no items, a module Teddy doesn't know or the study doesn't use, or an ID that isn't there gets the "something's wrong with this link" screen. A link with no `modules` runs the face check and calibration, then ends.

## What Teddy sends to pig

Each session is one pig run. It starts as soon as Teddy loads, with every link parameter, and is finalized on the end screen once everything has been sent. A session the participant leaves early is finalized the next time this browser opens Teddy, or expires on pig's schedule.

Everything Teddy logs is a pig event: `type` says what happened, `module` which module was running (`calibration` during calibration, and empty during the intro), and `detail` holds anything else, such as the sentence ID. When an item is shown, its event says what it was: `sentenceShown` and `videoLogPromptShown` have the item's `id` and `text`, and `reelShown` has its `id` and `file`. Pig's client adds the participant's clock time and `performance.now()` to each one.

Each recording is a media item, sent in 5-second parts as it records. Its event has `kind` (`faceDetect`, `faceCalibration`, `videoLog`, `sentence`, `reel`, or `reelRating`), `item` (the prompt, sentence, or reel ID), `module`, and `content_type`. It is stamped with the moment the recorder started, on the same `performance.now()` clock as the events, which is what lines recordings up with what happened. To get a playable file, join the parts in order:

```
cat media/00003/*.part > recording.webm
ffmpeg -i recording.webm -c copy recording-fixed.webm   # rebuilds the duration and seek index
```

## Updating pig's client

Pig's JavaScript client is copied into this repository, in `src/vendor/pig/`. Vite bundles it into Teddy, and copies `pig-worker.js` into the build as its own file, since a worker has to be loaded from Teddy's own site. `src/vendor/pig/VERSION` says which client it is. To update it, run `scripts/update-pig-client.sh path/to/psych-ingestor` and commit the result.

## Production Build

To build the production bundle, run `TEDDY_STUDY=path/to/my-study npm run build`. Without `TEDDY_STUDY`, it builds `example-study/`, which has `debug` on. Copy the contents of `dist/` to the web server; reels are included. For example, `rsync -a --delete dist/ server:/var/www/teddy/`.

Everything in `assets/` has a hash of its contents in its name, so it can be cached indefinitely. `index.html` doesn't, and needs to be served with `Cache-Control: no-cache` so browsers pick up new builds.

## Formatting videos

Video format matters a lot. As of September 2026, we generally recommend H.264 encoding for video with AAC for audio. Putting the index at the beginning of the file is extremely important to get files to start playing quickly.

This `ffmpeg` command will put the index at the start of a video without changing any data:

```
ffmpeg -i INPUT_FILE -c copy -movflags +faststart OUTPUT_FILE
```

## Credits

Teddy is copyright 2026 MIT Media Lab. This adaptation of Teddy was created by Nate Vack at the Center for Healthy Minds at UW-Madison. This code is released under the MIT license.

The animated Teddy character is shared under the CC-BY license and was created by [JcToon at Rive](https://rive.app/community/files/2244-7248-animated-login-character/).

NATE: What grant information should we credit here?
