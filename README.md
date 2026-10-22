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
  config.js           settings
  sentence.csv        sentences for the sentence module
  videolog.csv        prompts for the videolog module
  questions.csv       questions for the questions module
  reels/
    reels.csv         reels for the reels module
    *.mp4             the reel videos
```

Only `config.js` has a fixed name; it says where everything else is.

One way to set this up is a repository per study with this one as a git submodule, which pins the version of Teddy the study runs:

```
my-study/
  config.js, CSVs, reels/
  teddy/          this repository, as a submodule
  deploy.sh       cd teddy && npm ci && TEDDY_STUDY=.. npm run build && rsync -a --delete dist/ server:/var/www/teddy/
```

Build with `TEDDY_STUDY=path/to/my-study npm run build`, or run the dev server the same way with `npx vite`. The build checks the study and stops with a list of problems if anything's wrong: an unknown or mistyped setting, a missing `pigServer` or `taskCode` (unless `debug` is on), a module CSV that isn't there, is missing a column, or has an empty value or a repeated ID, or a reel file that isn't there.

### config.js

`config.js` exports its settings: `export default {pigServer: "...", ...}`.

- `pigServer`: pig's address, e.g. `https://pig.example.edu`. If pig's task configuration restricts which sites may send to it, this site has to be one of them.
- `taskCode`: the task this deployment sends data to, as pig's configuration names it. The task needs `media = true`.
- `debug`: when `true`, nothing is sent to pig; events are logged to the console, and every screen shows a "Debug mode" banner. It can only be set here, not from a link, so a participant can't end up in a session that records nothing.
- `nextUrlHosts`: the hosts that the `nextURL` link parameter may point to, e.g. `["redcap.example.edu"]`. Teddy only follows `http` and `https` URLs, and when this list isn't empty, only URLs on these hosts. Any other `nextURL` is ignored, and the end screen tells the participant they can close the tab.
- `nextUrlAfterFailure`: what happens when the session ends early: the camera can't be used (there isn't one, or the participant gives up on getting it working), the link is bad or expired, pig won't start the run, or something in Teddy breaks. Teddy always says what went wrong and what the participant can do about it. When this is `true` (the default) and the link has a `nextURL`, he then offers a button to it; when `false`, he tells the participant to close the tab.
- `modules`: the modules this study uses, and the CSV of items for each, relative to the study folder: `{sentence: "sentence.csv", reels: "reels/reels.csv"}`. A module left out isn't in this build, and a link that names it gets the "something's wrong with this link" screen. With no `modules`, links can only run the face check and calibration.
- `recording`: how recordings are made. `mimeTypes` is tried in order and the first one the browser can record wins, so WebM is preferred and Safari falls back to MP4. `videoBitsPerSecond` and `audioBitsPerSecond` set the size: the defaults (1 Mbps and 64 kbps) come to about 8 MB a minute. `width`, `height`, and `frameRate` are what Teddy asks the camera for. `maxSeconds` is the longest any one recording can run (default 600, ten minutes), so a session left open doesn't keep recording; modules may stop their recordings sooner. Any of these can be left out to use the default.

### Item CSVs

Each module's CSV has a header row and one item per row. `id` is what a link uses to name the item; IDs are text, so `01` and `1` are different. The other required columns:

- `sentence`: `text`, the sentence to read aloud.
- `videolog`: `text`, the prompt.
- `questions`: `text`, the question, and `responses`, its answers in REDCap's choice format: `0, Not at all | 1, Slightly | 2, Very`. Each answer is a code, a comma, and the label shown on its button; labels may have commas of their own. The build stops if an answer has no code or label, or if a code is used twice in one question.
- `reels`: `file`, the video's path relative to the reels CSV (and inside its folder), or an `http(s)` URL to play it from somewhere else. The build copies each listed file to `assets/reels/`, with a hash in its name; files that the CSV doesn't list are left out.

Other columns are allowed and are kept with each item. Excel's UTF-8 CSV export works; use "CSV UTF-8" so curly quotes and accents survive.

## Linking to Teddy

Teddy passes every parameter in its link to pig when it starts the run. Which ones are required, and which identify the participant, is up to the task's definition in pig's configuration. Pig records the rest. If pig refuses the run (a required parameter is missing, or the task is closed), Teddy says so before asking for the camera.

Teddy also reads `nextURL` (where the end screen sends the participant, and a session that ends early too, unless `nextUrlAfterFailure` is `false`), `expirationTime` (a time in milliseconds after which the link no longer works), and `modules`.

`modules` lists the activities to run, in order, separated by `|`. Each names its items, from the study's CSVs, after a colon: `modules=videolog:01,03|sentence:02|reels:01,02`. A module with no items, a module Teddy doesn't know or the study doesn't use, or an ID that isn't there gets the "something's wrong with this link" screen. A link with no `modules` runs the face check and calibration, then ends.

In a debug build, `?links` opens a link builder instead of a session; the debug banner links to it too. Pick modules and their items from the study, add `nextURL`, an expiry, and any parameters pig needs, and it writes the link. Paste a link into it to see what Teddy will make of it: each module's items, where the end screen goes, when it expires, which parameters only go to pig, and any problems. When a link has problems, the "something's wrong with this link" screen lists them in debug builds, with a link that opens the builder on it.

## What Teddy sends to pig

Each session is one pig run. It starts as soon as Teddy loads, with every link parameter, and is finalized on the end screen once everything has been sent. If sending makes no progress for a minute (the participant is likely offline), the end screen offers its way out anyway, and sending carries on while the page stays open. A session the participant leaves early is finalized the next time this browser opens Teddy, or expires on pig's schedule.

Everything Teddy logs is a pig event with a `type`, the `module` running, and the number of the `recording` running, if any. Each recording is a pig media item, stamped with the moment its recorder started on the same clock as every event, which is what lines events up with the video. The first event, `session_started`, says which version of Teddy and of the study made the run, and which version of the event schema its events follow. [docs/events.md](docs/events.md) describes every event and field, how to line events up with recordings, and how to join a recording's parts into a playable file.

## Updating pig's client

Pig's JavaScript client is copied into this repository, in `src/vendor/pig/`. Vite bundles it into Teddy, and copies `pig-worker.js` into the build as its own file, since a worker has to be loaded from Teddy's own site. `src/vendor/pig/VERSION` says which client it is. To update it, run `scripts/update-pig-client.sh path/to/psych-ingestor` and commit the result.

## Production Build

To build the production bundle, run `TEDDY_STUDY=path/to/my-study npm run build`. Without `TEDDY_STUDY`, it builds `example-study/`, which has `debug` on. Copy the contents of `dist/` to the web server; reels are included. For example, `rsync -a --delete dist/ server:/var/www/teddy/`.

Everything in `assets/` has a hash of its contents in its name, so it can be cached indefinitely. `index.html` doesn't, and needs to be served with `Cache-Control: no-cache` so browsers pick up new builds.

The build also writes a gzip (`.gz`) and a brotli (`.br`) copy of each file that compresses well (JavaScript, CSS, WebAssembly, the Rive animation, the face model), next to the original. Images, audio and video don't get one. Copy them to the server along with everything else, and have the server send them to browsers that accept them. With nginx:

```nginx
gzip_static on;
brotli_static on;  # needs the ngx_brotli module
gzip_vary on;      # sends Vary: Accept-Encoding, so caches keep the copies apart
```

## Formatting videos

Video format matters a lot. As of September 2026, we generally recommend H.264 encoding for video with AAC for audio. Putting the index at the beginning of the file is extremely important to get files to start playing quickly.

The build warns about any MP4 reel whose index isn't at the start. This `ffmpeg` command will put the index at the start of a video without changing any data:

```
ffmpeg -i INPUT_FILE -c copy -movflags +faststart OUTPUT_FILE
```

## Credits

Teddy is copyright 2026 MIT Media Lab. This adaptation of Teddy was created by Nate Vack at the Center for Healthy Minds at UW-Madison. This code is released under the MIT license.

The animated Teddy character is shared under the CC-BY license and was created by [JcToon at Rive](https://rive.app/community/files/2244-7248-animated-login-character/).

NATE: What grant information should we credit here?
