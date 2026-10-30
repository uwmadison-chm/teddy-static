# Teddy's events

Event schema **1.3**. Everything Teddy sends to pig is described here. Processing scripts should check `schema` on each run's `session_started` event.

## Versioning

`schema` is `major.minor`, and changes independently of Teddy's own version.

- **Minor** (`1.0` → `1.1`): something is added, such as a new event type or a new field. Existing events and fields keep their names and meanings. A script written for `1.0` still works; it just doesn't see the new data.
- **Major** (`1.x` → `2.0`): something is renamed, removed, or changes meaning. A script written for `1.x` should refuse to process a `2.x` run.

Every change gets a line in the changelog at the bottom, and `EVENT_SCHEMA` in `src/data/sessionData.tsx` is bumped in the same commit.

## Every event

Each session is one pig run. Every event Teddy sends has:

- `type`: what happened, in snake_case. See [Naming](#naming).
- `level`: how it went this time: `info`, `warning` (the session carried on, but its data may be affected), or `error` (something didn't work). The same type can have different levels; a `face_check_result` is `info` when a face was found and `error` when the detector couldn't run. Filtering on `level` finds a run's problems without knowing every type. See [Levels](#levels).
- `module`: the module running: `null` on the intro and camera screens before calibration, `calibration`, then the module name (`sentences`, `videologs`, `questions`, `reels`), and `null` again on the end screen.
- `recording`: the number of the recording running when the event happened, or `null` if none was. Recordings are numbered from 1 within the session.

pig's client adds `_client`, with `wall_time` (the participant's clock, with its UTC offset) and `performance_now` (milliseconds on the page's monotonic clock). The session stays on one page, so `performance_now` is comparable across the whole run. pig's own first event in each run (`_client.event: "run_start"`) has the browser, screen and window size, and the pig client's version.

Field names are snake_case, and a name means the same thing on every event it appears on: `item` is an item ID from the study's CSVs, `items` a list of them, `text` the words the participant saw, `name` and `message` an error's.

## Naming

- A type names what happened. Related types share a prefix: `camera_`, `face_check_`, `eyes_closed_`, `recording_`, `module_`, `session_`, `tab_`, `reel_`. Whether it went well is the event's `level`, not its name; no type ends in `_error`.
- Something that can go more than one way gets one `…_result` event with a `result` field, rather than one type per outcome: `camera_result`, `camera_help_result`, `face_check_result`.
- Fields are snake_case too.

## Levels

Every event is `info` unless listed here.

| type | `warning` when | `error` when |
|---|---|---|
| `camera_result` | | `result` is `failed` or `missing` |
| `camera_ended` | | always |
| `camera_help_shown` | always | |
| `camera_help_result` | | `result` is `given_up` or `unusable` |
| `face_check_result` | `result` is `bypassed`, or `found` after a detector error | `result` is `unavailable` |
| `recording_stopped` | `reason` is `left_screen`, or `timed_out` on a sentence, videolog, reel or questions recording | `reason` is `failed` |
| `reel_stalled` | always | |
| `tab_hidden` | a recording was running | |
| `uncaught_exception` | | always |

## Recordings and timing

Each recording is a pig media item. Its event is `type: "recording"`, with:

- `kind`: `face_check`, `eyes_closed`, `sentence`, `videolog`, `questions`, `reel`, or `reel_rating`
- `item` (or `items`, for `questions`, which records the whole module): what was being recorded; absent for calibration
- `limit_seconds`: the longest this recording could run
- `content_type`: the recording's format, added by pig's client

Its `_client.performance_now` is the moment the recorder started, which is the video's time 0. An event's time into a video is `event._client.performance_now - recording._client.performance_now`, in milliseconds. Every event during a recording carries its number in `recording`, so a script can group by it.

Each recording ends with a `recording_stopped` event, logged when Teddy asked the recorder to stop. The recorder delivers its last frames a moment later.

To get a playable file, join a media item's parts in order and remux it. In a `pig organize` tree, the item's directory is named for its event ID:

```
cat media/37/*.part > recording.webm
ffmpeg -i recording.webm -c copy recording-fixed.webm   # rebuilds the duration and seek index
```

[teddy-study-example](https://github.com/uwmadison-chm/teddy-study-example)'s `prepare.py` does this for every recording in an organized tree, and turns the events into CSVs, with `recording_ms` already worked out. It's a starting point to copy and change.

## Event types

### Session

**`session_started`**: the page has loaded and read its link. This is the first event in each run.

| field | |
|---|---|
| `schema` | this document's version, like `"1.0"` |
| `teddy` | `{version, commit, dirty}`: Teddy's `package.json` version, its git commit, and whether the checkout had changes, at build time |
| `study` | `{task_code, commit, dirty, hash}`: the study's pig task code, the study folder's git commit and whether it had changes (not counting Teddy as a submodule), and a SHA-256 of `config.js`, the CSVs and the reel files. Two builds with the same `hash` showed participants the same things. |
| `debug` | whether this was a debug build. Debug builds don't send to pig, so this is always `false` in pig's data. |
| `modules` | the modules the link asked for, in order, each as `{"module_name": ["item", ...]}`, like `[{"sentences": ["00", "01"]}, {"questions": ["relaxed"]}]` |
| `link_problems` | sentences describing what's wrong with the link, if anything. A link with problems doesn't start a pig run, so this is normally empty. |
| `next_url` | where the end screen sends the participant, or `null` |
| `next_url_rejected` | the link's `nextURL`, when it wasn't allowed; otherwise `null` |
| `expiration_time` | the link's `expirationTime`, or `null` |
| | `commit` and `dirty` are `null` for a build made outside git. |

**`session_finished`**: the end screen has started. After it, Teddy finalizes the run; anything that happens later is only logged to the browser console.

**`tab_hidden`**, **`tab_shown`**: the browser tab was hidden (the participant switched tabs or apps, minimized the browser, or locked their phone) or shown again.

**`uncaught_exception`**: an error that nothing else in Teddy caught. When it stopped a screen, the participant is sent to the problem screen (or, if the page itself broke, a plain page) with a way out, and the session ends there. `name`, `message`, and `stack` (its first few lines), when there is one. Only the first 20 in a session are sent.

### Camera

**`camera_requested`**: Teddy asked the browser for the camera and microphone. This is where the browser shows its permission prompt, the first time.

**`camera_result`**: how getting the camera went.

| `result` | fields |
|---|---|
| `started` | the browser gave Teddy the camera. `width`, `height`, `frame_rate`: what the camera is actually sending, which may differ from what `config.js` asked for. |
| `failed` | the browser wouldn't give Teddy the camera. `name` (like `NotAllowedError`), `message`, and `constraint` (the setting the camera couldn't meet, for an `OverconstrainedError`; otherwise `null`). |
| `missing` | before asking, Teddy found that the device has no camera or no microphone, and went straight to the camera help screen; there's no `camera_requested` before it. `video_inputs`, `audio_inputs`: how many of each the browser listed. |

**`camera_ended`**: a camera or microphone track stopped on its own, such as when a camera was unplugged or permission was revoked mid-session. `track`: `video` or `audio`. If it happens on a screen showing the camera, the camera help screen follows.

**`camera_help_shown`**: the camera help screen started. `name`: the error, `NotFoundError` after a `camera_result` of `missing`, `ended` after a `camera_ended`, or `TimeoutError` when the browser hadn't answered 30 seconds after a `camera_requested` (usually a permission prompt left unanswered). The request stays open after a `TimeoutError`, so its `camera_result` can still come later.

**`camera_help_result`**: how the camera help screen ended.

| `result` | |
|---|---|
| `working` | a retry got the camera, and the session goes back to where it was |
| `given_up` | the participant gave up; the session ends there. `name`: the last error. |
| `unusable` | there was nothing to try again, because the device has no camera or microphone (`NotFoundError`, `OverconstrainedError`) or the browser can't use one (`NotSupportedError`); the session ends there. `name`: the error. |

### Modules

**`module_started`**: a module's screen has started. `items`: its item IDs, in order (empty for calibration).

**`module_finished`**: the participant pressed the button to move on from a module.

### Calibration

**`face_check_started`**: Teddy started looking for the participant's face.

**`face_check_tips_shown`**: no face had been held in view for 2 seconds, so tips for being seen (centering, lighting, background, a clean camera) came up.

**`face_check_result`**: the face check ended.

| field | |
|---|---|
| `result` | `found`: a face was in view for a second. `bypassed`: no face was found, and the participant pressed "Let's Continue Anyhow". `unavailable`: the face detector couldn't load, or three checks in a row failed, so the check ended without telling the participant |
| `best_score` | the face detector's highest score for a face during the check, 0 to 1; `null` if it never saw one scoring at least 0.2. A face counts as found above 0.5 |
| `centered` | whether the last check saw a face in the middle of the camera preview |
| `light_ok` | whether the last check found the face (or the middle of the picture, without one) neither too dark nor washed out |
| `tips_shown` | whether the tips had come up |
| `detector_backend` | TensorFlow.js's backend for the face detector, which runs in a worker: `webgl`, or `cpu` where a worker can't use WebGL (Safari before 17), which makes each check slower; `null` if it never loaded |
| `detector_errors` | each time the face detector failed during the check, up to 10, as `{stage, name, message, stack}`. `stage` is `load` (face-api or its model wouldn't load or start) or `detect` (one check of the camera failed). Empty when nothing went wrong. |

**`eyes_closed_countdown_started`**: the countdown before the eyes-closed period started; the participant should be closing their eyes.

**`eyes_closed_started`**: the eyes-closed period started.

**`eyes_closed_finished`**: the gong; the eyes-closed period is over.

### Items and responses

**`item_shown`**: an item appeared.

| module | fields |
|---|---|
| `sentences` | `item`, `text` |
| `videologs` | `item`, `text`. The prompt shows before recording starts, so the participant can think about it. |
| `questions` | `item`, `text`, `responses` (as the CSV has them), `choices` (a list of `{code, label}`), `number` and `of` (its position in the module) |
| `reels` | `item`, `file`, `preloaded` (whether it played from the copy downloaded earlier in the session, rather than streaming) |

**`response`**: the participant answered a question or rated a reel. One per answer, so filtering on `type == "response"` gives a table of every answer in the run.

| field | |
|---|---|
| `item` | the question or reel ID |
| `text` | what was asked |
| `value` | the code of the answer picked, as text |
| `label` | the label on the button they pressed |
| `choices` | every answer that was offered, as a list of `{code, label}` |

Reel ratings are `4` Really Funny, `3` Pretty Funny, `2` Not Funny, `1` Hated It; the question is "What did you think of that video?".

**`reel_playing`**, **`reel_stalled`**, **`reel_ended`**: the reel's video started or resumed playing, stopped to wait for data, or reached its end. `item`.

**`reel_preloaded`**, **`reel_preload_failed`**: Teddy downloads every reel the link names, one at a time, from the start of the session, so each plays without waiting. `reel_preloaded` is sent when one is in, with `item`, `bytes`, and `seconds` (how long the download took). `reel_preload_failed` has `item`, `name` and `message`; that reel streams when it plays instead. A reel whose turn comes before its download is done streams too, and its download is dropped without an event. A reel that two IDs share is downloaded once, under the first ID.

### Recordings

**`recording`**: a recording started. See [Recordings and timing](#recordings-and-timing).

**`recording_stopped`**: Teddy stopped a recording. `kind` and `item`/`items` as on its `recording` event, and `reason`:

| reason | |
|---|---|
| `done_button` | the participant pressed the button saying they were done ("I've Read It Out Loud", "I'm Done") |
| `timed_out` | it reached `limit_seconds` |
| `reel_ended` | the reel it was recording finished |
| `answered` | the participant rated the reel (reel_rating) |
| `finished` | the step it was recording ended (calibration, the last question answered) |
| `replaced` | another recording started |
| `left_screen` | the screen it was on went away, such as for the camera help screen |
| `failed` | pig's client couldn't start the recording; `name` and `message` say why. If it fails after Teddy had already stopped it, the recording has a second `recording_stopped` with this reason. |

### Teddy

**`teddy_said`**: one of Teddy's lines started to show in his speech bubble. The participant taps through his lines, so each line is its own event.

| field | |
|---|---|
| `text` | the line |
| `line`, `lines` | which line this is of the ones Teddy said together |
| `animation` | what Teddy was doing as he said it, like `wave` or `is_listening`; `null` if he carried on with what he was already doing |

## Changelog

- **1.0**: the first version.
- **1.1**: `camera_help_shown` can have `name` `TimeoutError`. `uncaught_exception` is now also sent for a screen that fails, which ends the session.
- **1.2**: `face_check_result` has `detector_backend`.
- **1.3**: `reel_preloaded` and `reel_preload_failed`. `item_shown` for a reel has `preloaded`.
