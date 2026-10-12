# TeddyWeb Static

This is a standalone, static adaptation of the [React version of Teddy(https://github.com/MITMediaLabAffectiveComputing/Teddy), written by Craig Ferguson at the MIT Media Lab.

This version of Teddy is intended to be launched via a link from REDCap (or survey software of your choosing) and to send data to an installation of [pig](https://github.com/uwmadison-chm/psych-ingestor).

## Setup

To run the dev server, first make sure you have Node and NPM installed and updated.

First, run `npm install` to install all requirements.

Run `npx vite` to start the development server. The page should be running and available at http://localhost:9000/. Static files are served from `public/`.

To send data while developing, run a pig (`pig serve` in a psych-ingestor checkout) with a task that has `media = true`, and point `pigServer` and `taskCode` in `public/config.js` at it, with `debug: false`. Pig allows cross-origin requests by default.

## Deployment configuration

`public/config.js` is copied to `dist/config.js` and loaded before the app. Edit it on the server to change settings without rebuilding:

- `pigServer`: pig's address, e.g. `https://pig.example.edu`. If pig's task configuration restricts which sites may send to it, this site has to be one of them.
- `taskCode`: the task this deployment sends data to, as pig's configuration names it. The task needs `media = true`.
- `debug`: when `true`, nothing is sent to pig; events are logged to the console, and every screen shows a "Debug mode" banner. It can only be set here, not from a link, so a participant can't end up in a session that records nothing.
- `nextUrlHosts`: the hosts that the `nextURL` link parameter may point to, e.g. `["redcap.example.edu"]`. Teddy only follows `http` and `https` URLs, and when this list isn't empty, only URLs on these hosts. Any other `nextURL` is ignored, and the end screen tells the participant they can close the tab.
- `recording`: how recordings are made. `mimeTypes` is tried in order and the first one the browser can record wins, so WebM is preferred and Safari falls back to MP4. `videoBitsPerSecond` and `audioBitsPerSecond` set the size: the defaults (1 Mbps and 64 kbps) come to about 8 MB a minute. `width`, `height`, and `frameRate` are what Teddy asks the camera for. Any of these can be left out to use the default.

## Linking to Teddy

Teddy passes every parameter in its link to pig when it starts the run. Which ones are required, and which identify the participant, is up to the task's definition in pig's configuration. Pig records the rest. If pig refuses the run (a required parameter is missing, or the task is closed), Teddy says so before asking for the camera.

Teddy also reads `nextURL` (where the end screen sends the participant), `expirationTime` (a time in milliseconds after which the link no longer works), and `modules`.

`modules` is required. It lists the activities to run, in order, separated by `|`. Each can name its items after a colon: `modules=videolog:01,03|sentence:02|reels:01,02`. Video log prompts and sentences are chosen at random when the link doesn't name them; reels have to be named. The IDs are in `src/data/videoLogPrompts.ts`, `src/data/sentences.ts`, and `src/data/reels.ts`. A link with no `modules`, a module Teddy doesn't know, or an ID that isn't there gets the "something's wrong with this link" screen.

## What Teddy sends to pig

Each session is one pig run. It starts as soon as Teddy loads, with every link parameter, and is finalized on the end screen once everything has been sent. A session the participant leaves early is finalized the next time this browser opens Teddy, or expires on pig's schedule.

Everything Teddy logs is a pig event: `type` says what happened, `module` which module was running (`calibration` during calibration, and empty during the intro), and `detail` holds anything else, such as the sentence ID. Pig's client adds the participant's clock time and `performance.now()` to each one.

Each recording is a media item, sent in 5-second parts as it records. Its event has `kind` (`faceDetect`, `faceCalibration`, `videoLog`, `sentence`, `reel`, or `reelRating`), `item` (the prompt, sentence, or reel ID), `module`, and `content_type`. It is stamped with the moment the recorder started, on the same `performance.now()` clock as the events, which is what lines recordings up with what happened. To get a playable file, join the parts in order:

```
cat media/00003/*.part > recording.webm
ffmpeg -i recording.webm -c copy recording-fixed.webm   # rebuilds the duration and seek index
```

## Updating pig's client

Pig's JavaScript client is copied into this repository, in `src/vendor/pig/`. Vite bundles it into Teddy, and copies `pig-worker.js` into the build as its own file, since a worker has to be loaded from Teddy's own site. `src/vendor/pig/VERSION` says which client it is. To update it, run `scripts/update-pig-client.sh path/to/psych-ingestor` and commit the result.

## Production Build

To build the production bundle, run this command: `npx vite build`

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
