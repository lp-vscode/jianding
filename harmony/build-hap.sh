#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEVECO="/Applications/DevEco-Studio.app"

bash "$HERE/build-webview.sh"

export DEVECO_SDK_HOME="$DEVECO/Contents/sdk"
export JAVA_HOME="$DEVECO/Contents/jbr/Contents/Home"
export PATH="$DEVECO/Contents/tools/node/bin:$DEVECO/Contents/tools/hvigor/bin:$JAVA_HOME/bin:$PATH"

cd "$HERE"
hvigorw --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon

ls -lh entry/build/default/outputs/default/
