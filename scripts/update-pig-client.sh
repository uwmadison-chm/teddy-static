#!/bin/sh
# Copies a build of pig's JavaScript client into Teddy.
#
#   scripts/update-pig-client.sh ../psych-ingestor
#
# Builds the client in that psych-ingestor checkout, then copies:
#   pig.js, pig-worker.js, and the type declarations -> src/vendor/pig/
# Vite bundles pig.js into Teddy, and copies pig-worker.js into the build as
# its own file, since a worker has to be loaded from a URL on the page's site.
# Commit the results. src/vendor/pig/VERSION records which client this is.
set -eu

checkout=${1:?usage: $0 path/to/psych-ingestor}
here=$(cd "$(dirname "$0")/.." && pwd)
client="$checkout/client"

(cd "$client" && npm ci --no-audit --no-fund && npm run build)

rm -rf "$here/src/vendor/pig"
mkdir -p "$here/src/vendor/pig"
cp "$client/dist/pig.js" "$here/src/vendor/pig/pig.js"
cp -r "$client/dist/types" "$here/src/vendor/pig/types"
printf 'export * from "./types/index.ts";\n' > "$here/src/vendor/pig/pig.d.ts"
cp "$client/dist/pig-worker.js" "$here/src/vendor/pig/pig-worker.js"

version=$(node -p "require('$client/package.json').version")
commit=$(git -C "$checkout" rev-parse --short HEAD)
printf 'psych-ingestor-client %s (psych-ingestor %s)\n' "$version" "$commit" > "$here/src/vendor/pig/VERSION"
echo "Copied client $version from psych-ingestor $commit"
