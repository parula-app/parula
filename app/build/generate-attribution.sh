# Writes the licenses of the third-party packages that we ship to public/attribution.txt.gz
# Run from app/ directory, after `yarn install` in all projects below
[ ! -e build/generate-attribution.sh ] && echo "Please run from app/ directory" 1>&2 && exit 1
set -e
PROJECTS=". ../lib ../desktop ../desktop/backend ../mobile ../mobile/backend"
for PROJECT in $PROJECTS; do
  [ ! -d $PROJECT/node_modules ] && echo "Please run yarn install in $PROJECT" 1>&2 && exit 1
done
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

mkdir $TMP/tools
echo '{ "private": true }' > $TMP/tools/package.json
(cd $TMP/tools; yarn add --silent @metamask/oss-attribution-generator@^2.0.2 spdx-license-list@^6.12.0)

# devDependencies which are bundled into the app nevertheless
mkdir $TMP/bundled
node -e '
  let dev = { ...require("../desktop/package.json").devDependencies, ...require("./package.json").devDependencies };
  let bundled = ["svelte", "@composi/gestures", "simple-svelte-autocomplete", "svelte-popperjs", "electron"];
  console.log(JSON.stringify({ name: "bundled", version: "0.0.0", dependencies: Object.fromEntries(bundled.map(name => [name, dev[name]])) }));
' > $TMP/bundled/package.json
(cd $TMP/bundled; yarn install --silent --production --ignore-scripts)

# The generator fails with several projects at once, because it would list our own projects as packages
N=0
INPUTS=""
for PROJECT in $PROJECTS $TMP/bundled; do
  N=$((N+1))
  $TMP/tools/node_modules/.bin/generate-attribution -o $TMP/out$N -b $PROJECT > $TMP/log || { tail $TMP/log; exit 1; }
  INPUTS="$INPUTS $PROJECT $TMP/out$N/attribution.txt"
done
npx tsx build/complete-attribution.ts $TMP/tools/node_modules/spdx-license-list/spdx-full.json $TMP/attribution.txt $INPUTS
gzip -9 -n -c $TMP/attribution.txt > public/attribution.txt.gz
