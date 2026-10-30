# TeddyWeb Static

This is a standalone, static adaptation of the [React + Django version of Teddy](https://github.com/MITMediaLabAffectiveComputing/Teddy), by [Craig Ferguson](https://www.media.mit.edu/people/fergusoc/overview/) and [Nelson Hidalgo](https://www.media.mit.edu/people/nelsonh/overview/) at the MIT Media Lab.

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
  sentences.csv       sentences for the sentences module
  videologs.csv       prompts for the videologs module
  questions.csv       questions for the questions module
  reels/
    reels.csv         reels for the reels module
    *.mp4             the reel videos
```

Only `config.js` has a fixed name; it says where everything else is.

One way to set this up is a repository per study with this one as a git submodule. See our [study template](https://github.com/uwmadison-chm/teddy-study-example) for an example.

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
- `modules`: the modules this study uses, and the CSV of items for each, relative to the study folder: `{sentences: "sentences.csv", reels: "reels/reels.csv"}`. A module left out isn't in this build, and a link that names it gets the "something's wrong with this link" screen. With no `modules`, links can only run the face check and calibration.
- `recording`: how recordings are made. `mimeTypes` is tried in order and the first one the browser can record wins, so WebM is preferred and Safari falls back to MP4. `videoBitsPerSecond` and `audioBitsPerSecond` set the size: the defaults (1 Mbps and 64 kbps) come to about 8 MB a minute. `width`, `height`, and `frameRate` are what Teddy asks the camera for. `maxSeconds` is the longest any one recording can run (default 600, ten minutes), so a session left open doesn't keep recording; modules may stop their recordings sooner. Any of these can be left out to use the default.

### Item CSVs

Each module's CSV has a header row and one item per row. `id` is what a link uses to name the item; IDs are text, so `01` and `1` are different. The other required columns:

- `sentences`: `text`, the sentence to read aloud.
- `videologs`: `text`, the prompt.
- `questions`: `text`, the question, and `responses`, its answers in REDCap's choice format: `0, Not at all | 1, Slightly | 2, Very`. Each answer is a code, a comma, and the label shown on its button; labels may have commas of their own. The build stops if an answer has no code or label, or if a code is used twice in one question.
- `reels`: `file`, the video's path relative to the reels CSV (and inside its folder), or an `http(s)` URL to play it from somewhere else. The build copies each listed file to `assets/reels/`, with a hash in its name; files that the CSV doesn't list are left out. Teddy downloads the link's reels in the background from the start of the session, so they play without waiting; a reel at an `http(s)` URL on another host needs to be served with CORS headers (`Access-Control-Allow-Origin`) for that, and otherwise streams when it plays.

Other columns are allowed and are kept with each item. Excel's UTF-8 CSV export works; use "CSV UTF-8" so curly quotes and accents survive.

## Linking to Teddy

Teddy passes every parameter in its link to pig when it starts the run. Which ones are required, and which identify the participant, is up to the task's definition in pig's configuration. Pig records the rest. If pig refuses the run (a required parameter is missing, or the task is closed), Teddy says so before asking for the camera.

Teddy also reads `nextURL` (where the end screen sends the participant, and a session that ends early too, unless `nextUrlAfterFailure` is `false`), `expirationTime` (a time in milliseconds after which the link no longer works), and `modules`.

`modules` lists the activities to run, in order, separated by `|`. Each names its items, from the study's CSVs, after a colon: `modules=videologs:01,03|sentences:02|reels:01,02`. A module with no items, a module Teddy doesn't know or the study doesn't use, or an ID that isn't there gets the "something's wrong with this link" screen. A link with no `modules` runs the face check and calibration, then ends.

In a debug build, `?links` opens a link builder instead of a session; the debug banner links to it too. Pick modules and their items from the study, add `nextURL`, an expiry, and any parameters pig needs, and it writes the link. Paste a link into it to see what Teddy will make of it: each module's items, where the end screen goes, when it expires, which parameters only go to pig, and any problems. When a link has problems, the "something's wrong with this link" screen lists them in debug builds, with a link that opens the builder on it.

### Signed links

A participant can edit their link, and so change which modules they do, or their own ID. To stop that, have pig's task check signatures: list the parameters to sign under `signed_parameters` in pig's configuration, usually the ones that identify the participant plus `modules`, name the signing key under `signed_by`, and sign each link on pig's secure side with `pigsty sign`. The signature is one more parameter in the link, `sig`, which pig's client takes out of the parameters and sends to pig on its own. Teddy needs no setting for it. A link with no signature, or with a value changed since it was signed, gets the "something's wrong with this link" screen before the camera is asked for. See pig's [configuration.md](https://github.com/uwmadison-chm/psych-ingestor/blob/main/docs/configuration.md#parameter-signing).

`nextURL` and `expirationTime` can be signed the same way, or left out of the list so they stay free to change.

The link builder can't sign links, so a link it writes won't start a run for a task that checks signatures. `pigsty sign --url` makes a whole signed link to test with.

### REDCap randomization lists

`scripts/generate-lists.ts` writes REDCap randomization allocation tables of `modules` parameters, one CSV per event, with `redcap_randomization_number` and `redcap_randomization_group` both set to the row's `modules`:

```
node scripts/generate-lists.ts --study=../my-study --out-dir=lists/ --count=100 --events=base,pw1 \
    --modules='questions:1,2,3,4,5|reels:pick(3)|sentences:pick(3)|videologs:1,2'
```

This writes `lists/base.csv` and `lists/pw1.csv`, 100 rows each. `--modules` is a `modules` parameter, except a module's items can be `pick(N)`: N of the study's items for that module, drawn at random for each row with no repeats within the row. Each row of each event gets its own draw, so a participant can see an item again in a later event. Listed IDs are checked against the study, as the build would. Quote `--modules`, since `|` means something to the shell. `--study` is the study folder, the one holding `config.js`. `--seed=N` makes the lists the same each time. It needs Node 22.18 or later, which runs TypeScript directly, and Teddy's `npm ci`. A study with Teddy as a submodule can wrap this in a script, as [teddy-study-example](https://github.com/uwmadison-chm/teddy-study-example)'s `generate-lists.sh` does.

## What Teddy sends to pig

Each session is one pig run. It starts as soon as Teddy loads, with every link parameter, and is finalized on the end screen once everything has been sent. If sending takes more than 15 seconds, the end screen offers its way out anyway, and sending carries on while the page stays open. A session the participant leaves early is finalized the next time this browser opens Teddy, or expires on pig's schedule.

Everything Teddy logs is a pig event with a `type`, the `module` running, and the number of the `recording` running, if any. Each recording is a pig media item, stamped with the moment its recorder started on the same clock as every event, which is what lines events up with the video. The first event, `session_started`, says which version of Teddy and of the study made the run, and which version of the event schema its events follow. [docs/events.md](docs/events.md) describes every event and field, how to line events up with recordings, and how to join a recording's parts into a playable file.

## Updating pig's client

Teddy uses pig's JavaScript client from npm, [`@uwmadison-chm/pig-client`](https://www.npmjs.com/package/@uwmadison-chm/pig-client). Vite bundles it into Teddy, and copies `pig-worker.js` into the build as its own file, since a worker has to be loaded from Teddy's own site. Teddy needs 1.0 or later, which speaks pig's `/v1/` API; 0.2.0 can't talk to a current pig. Until 1.0.0 is released, its prereleases are under npm's `next` tag, so to update it, run `npm install @uwmadison-chm/pig-client@next` (`@latest` once 1.0.0 is out), check the client's changelog for anything that changes what Teddy sends, and commit `package.json` and `package-lock.json`.

## Quality check

`quality-check.html` is a separate page for trying recording settings on a device, not part of any study. Teddy introduces it, warns that the people checking recordings might know the tester, then steps aside. The tester enters an ID and picks a format, a video bitrate and a size, with a live view of what the camera is sending. They then record each prompt, watch the recording itself played back, and give it a thumbs up or down. Each set of settings is its own run: when the prompts are done, the page sends everything and finalizes the run, then "Try Other Settings" starts a new run with different choices and "I'm Done" ends the visit.

The setup screen shows the formats in a table, the ones this browser can't record last. For each format, it says whether this browser can record it, and what it says about encoding it at the chosen bitrate and size: whether it'll be smooth and power-efficient (`navigator.mediaCapabilities.encodingInfo()`), and whether there's a hardware encoder (WebCodecs). Chrome only answers `encodingInfo()` for `"record"` with experimental web platform features turned on, so the page also asks about the same codec for `"webrtc"`. That's the WebRTC encoder's answer, not MediaRecorder's, though in Chrome they likely use the same encoders. `encoding_info_type` in the data says which answered.

It also suggests a video bitrate for the chosen format at the size the camera is sending, from a rough bits-per-pixel figure for each codec (`CODECS` in `QualityCheck.tsx`).

The browser remembers the tester's ID and the settings tried on that device, with how many recordings got a thumbs up or down, so a tester who comes back sees what they've done; Teddy welcomes them back. This is only a convenience, kept in `localStorage`; pig has the real record.

It isn't built with a study. Build it on its own:

```
npm run build:quality-check                                 # into dist-quality-check/
QC_SETTINGS=path/to/settings.js npm run build:quality-check   # with other settings
npm run dev:quality-check                                   # dev server at http://localhost:9001/quality-check.html
```

Its settings are in `quality-check/settings.js`: pig's address and task code, `debug`, the formats, bitrates and sizes to offer, the frame rate and audio bitrate, the longest a recording can run, and the prompts. Testers can also type a bitrate. Nothing in a study's link or config can choose a recording's format or bitrate; only this page can.

The pig task needs `media = true` and one parameter, the tester's ID, which the page cleans up to letters, digits, `_` and `-`:

```toml
[task.teddy_qc]
path_parameters = ["tester"]
run_key_parameters = ["tester"]
media = true
open = true
```

Each set of settings is one run, so a tester who tries three gets runs 1 to 3 under their ID. Its events have `type`, `level`, `module` (`quality_check`) and `recording`, plus pig's `_client`. The schema is `1.0`, on `quality_check_started`:

| type | fields |
|---|---|
| `quality_check_started` | `schema`, `teddy` (version, commit, dirty), `debug` |
| `teddy_said` | as in a session |
| `camera_result` | `result` (`started` or `failed`); `width`, `height`, `frame_rate`; or `name`, `message` |
| `quality_check_settings` | `format` (`label`, `mime_type`), `video_bits_per_second`, `suggested_video_bits_per_second`, `audio_bits_per_second`, `size` (`label`, `width`, `height`), `frame_rate`, `camera` (what it's actually sending), `capabilities` (for every format: `can_record`, `encoding_info_type`, `supported`, `smooth`, `power_efficient`, `hardware_encoder`), `hardware_concurrency` |
| `item_shown` | `item` (the prompt, like `01`), `text` |
| `recording` | the media item: `kind` (`quality_check`), `item`, `limit_seconds`, the run's `format`, bitrates and `size`, `camera`, and `content_type` from pig's client |
| `recording_stopped` | `kind`, `item`, `reason` (`done_button`, `timed_out`, `failed`), `bytes`, `duration_ms` |
| `quality_rating` | `item`, `rating` (`up` or `down`) |
| `quality_check_finished` | `another` (whether the tester went on to try other settings) |
| `uncaught_exception` | `name`, `message`, `stack` |

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
