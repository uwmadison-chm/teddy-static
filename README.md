# TeddyWeb Static

This is a standalone, static adaptation of the [React version of Teddy(https://github.com/MITMediaLabAffectiveComputing/Teddy), written by Craig Ferguson at the MIT Media Lab.

This version of Teddy is intended to be launched via a link from REDCap (or survey software of your choosing) and to send data to an installation of [pig](https://github.com/uwmadison-chm/psych-ingestor).

## Setup

To run the dev server, first make sure you have Node and NPM installed and updated.

First, run `npm install` to install all requirements.

Run `npx vite` to start the development server. The page should be running and available at http://localhost:5173/. You'll need to be running the Django server locally too, so it can serve the required static files.

Note that the React development server passes all relevant requests through to the Django development server, so you should now be able to access the Djando admin console through http://localhost:5173/admin/

## Linking to Teddy

TODO: What URL parameters do we require?

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