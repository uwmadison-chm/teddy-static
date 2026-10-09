# TeddyWeb Static

This is a standalone, static adaptation of the [React version of Teddy(https://github.com/MITMediaLabAffectiveComputing/Teddy), written by Craig Ferguson at the MIT Media Lab.

This version of Teddy is intended to be launched via a link from REDCap (or survey software of your choosing) and to send data to an installation of [pig](https://github.com/uwmadison-chm/psych-ingestor).

## Setup

To run the dev server, first make sure you have Node and NPM installed and updated.

First, run `npm install` to install all requirements.

Run `npx vite` to start the development server. The page should be running and available at http://localhost:9000/. Static files are served from `public/`.

The dev server doesn't proxy `/api/` requests anywhere, so session and video uploads will fail locally unless you add a `server.proxy` entry in `vite.config.ts` pointing at a pig instance.

## Deployment configuration

`public/config.js` is copied to `dist/config.js` and loaded before the app. Edit it on the server to change settings without rebuilding:

- `apiUrl`: base URL of pig's API, e.g. `https://pig.example.edu/`. If pig is on a different origin, it must send CORS headers allowing this site.
- `debug`: when `true`, nothing is uploaded; uploads are logged to the console, and every screen shows a "Debug mode" banner. It can only be set here, not from a link, so a participant can't end up in a session that records nothing.
- `nextUrlHosts`: the hosts that the `nextURL` link parameter may point to, e.g. `["redcap.example.edu"]`. Teddy only follows `http` and `https` URLs, and when this list isn't empty, only URLs on these hosts. Any other `nextURL` is ignored, and the end screen tells the participant they can close the tab.
- `recording`: how recordings are made. `mimeTypes` is tried in order and the first one the browser can record wins, so WebM is preferred and Safari falls back to MP4. `videoBitsPerSecond` and `audioBitsPerSecond` set the size: the defaults (1 Mbps and 64 kbps) come to about 8 MB a minute. `width`, `height`, and `frameRate` are what Teddy asks the camera for. Any of these can be left out to use the default.

## Linking to Teddy

TODO: What URL parameters do we require?

`modules` lists the activities to run, in order, separated by `|`. Each can name its items after a colon: `modules=videolog:01,03|sentence:02|reels:01,02`. Video log prompts and sentences are chosen at random when the link doesn't name them. Reels never are: a link that includes `reels` has to name the reels to play, by the IDs in `src/data/reels.ts`, and Teddy shows a "something's wrong with this link" screen if it doesn't. Without `modules`, Teddy runs `sentence|videolog`.

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
