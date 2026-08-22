#!/usr/bin/env bash
# Native signed-DMG install/upgrade/launch/uninstall smoke for the release runner.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
CURRENT_DMG="${1:-}"
VERSION="$(tr -d '\r\n' < "$ROOT/VERSION")"
PYTHON_BIN="${QUILTOR_SMOKE_PYTHON:-python3}"
command -v "$PYTHON_BIN" >/dev/null || {
  echo "$PYTHON_BIN is required for the native smoke" >&2
  exit 2
}
if [[ -z "$CURRENT_DMG" || ! -f "$CURRENT_DMG" ]]; then
  echo "usage: $0 <current-signed-notarized.dmg>" >&2
  exit 2
fi
CURRENT_DMG="$(cd "$(dirname "$CURRENT_DMG")" && pwd)/$(basename "$CURRENT_DMG")"

TEMP_BASE="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
mkdir -p "$TEMP_BASE"
TEMP_BASE="$(cd "$TEMP_BASE" && pwd -P)"
WORK="$(mktemp -d "$TEMP_BASE/quiltor-macos-native-smoke.XXXXXX")"
INSTALL_ROOT="$WORK/install"
INSTALLED_APP="$INSTALL_ROOT/Quiltor.app"
USER_ROOT="$WORK/user"
PREVIOUS_DMG="$WORK/previous.dmg"
PREVIOUS_METADATA="$WORK/previous.json"
ACTIVE_PID=""
ACTIVE_MOUNT=""
mkdir -p "$INSTALL_ROOT" "$USER_ROOT/home" "$USER_ROOT/data"

is_mounted() {
  mount | grep -F " on $1 " >/dev/null
}

cleanup() {
  if [[ -n "$ACTIVE_PID" ]] && kill -0 "$ACTIVE_PID" 2>/dev/null; then
    kill "$ACTIVE_PID" 2>/dev/null || true
    wait "$ACTIVE_PID" 2>/dev/null || true
  fi
  if [[ -n "$ACTIVE_MOUNT" ]] && is_mounted "$ACTIVE_MOUNT"; then
    hdiutil detach "$ACTIVE_MOUNT" -force >/dev/null 2>&1 || true
  fi
  case "$WORK" in
    "$TEMP_BASE"/quiltor-macos-native-smoke.*) rm -rf "$WORK" ;;
    *) echo "refusing unsafe smoke cleanup target: $WORK" >&2 ;;
  esac
}
trap cleanup EXIT INT TERM

team_identifier() {
  local details
  details="$(codesign -dvv "$1" 2>&1)"
  awk -F= '$1 == "TeamIdentifier" { print $2; exit }' <<< "$details"
}

metadata_version() {
  "$PYTHON_BIN" - "$ROOT/distribution/tooling" "$PREVIOUS_METADATA" <<'PY'
import json
import sys

sys.path.insert(0, sys.argv[1])
from previous_release import canonical_name, semantic_version

document = json.load(open(sys.argv[2], encoding="utf-8"))
version = semantic_version(document["version"])
valid = (
    set(document) == {"schemaVersion", "tag", "version", "kind", "asset"}
    and document["schemaVersion"] == 1
    and document["kind"] == "macos-dmg"
    and semantic_version(document["tag"]) == version
    and document["asset"] == canonical_name("macos-dmg", version)
)
if not valid:
    raise SystemExit("invalid predecessor metadata")
print(document["version"])
PY
}

require_previous_order() {
  "$PYTHON_BIN" - "$ROOT/distribution/tooling" "$1" "$VERSION" <<'PY' || {
import sys

sys.path.insert(0, sys.argv[1])
from previous_release import semantic_version

raise SystemExit(0 if semantic_version(sys.argv[2]) < semantic_version(sys.argv[3]) else 1)
PY
      echo "predecessor version $1 is not earlier than current $VERSION" >&2
      exit 1
    }
}

verify_dmg() {
  local dmg="$1"
  codesign --verify --strict --verbose=2 "$dmg"
  xcrun stapler validate "$dmg"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
}

install_dmg() {
  local dmg="$1"
  local mountpoint="$WORK/mount-$(date +%s)-$RANDOM"
  mkdir -p "$mountpoint"
  ACTIVE_MOUNT="$mountpoint"
  hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mountpoint" >/dev/null
  [[ -d "$mountpoint/Quiltor.app" ]] || {
    echo "DMG has no canonical Quiltor.app" >&2
    exit 1
  }
  codesign --verify --deep --strict --verbose=2 "$mountpoint/Quiltor.app"
  xcrun stapler validate "$mountpoint/Quiltor.app"
  spctl --assess --type execute --verbose=2 "$mountpoint/Quiltor.app"
  ditto --rsrc --extattr "$mountpoint/Quiltor.app" "$INSTALLED_APP"
  hdiutil detach "$mountpoint" >/dev/null
  ACTIVE_MOUNT=""
  rmdir "$mountpoint"
  codesign --verify --deep --strict --verbose=2 "$INSTALLED_APP"
}

assert_port_free() {
  if /usr/bin/curl --fail --silent --max-time 1 http://127.0.0.1:8843/api/version >/dev/null 2>&1; then
    echo "port 8843 is already serving before the native launch" >&2
    exit 1
  fi
}

launch_and_probe() {
  local expected="$1"
  local executable
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INSTALLED_APP/Contents/Info.plist")"
  [[ -x "$INSTALLED_APP/Contents/MacOS/$executable" ]] || {
    echo "installed bundle executable is missing" >&2
    exit 1
  }
  assert_port_free
  QUILTOR_HOME="$USER_ROOT/home" QUILTOR_DATA_DIR="$USER_ROOT/data" \
    "$INSTALLED_APP/Contents/MacOS/$executable" >"$WORK/app.stdout" 2>"$WORK/app.stderr" &
  ACTIVE_PID=$!
  local response="$WORK/version.json"
  local ready=0
  for _ in $(seq 1 60); do
    if ! kill -0 "$ACTIVE_PID" 2>/dev/null; then
      echo "installed Quiltor exited before its readiness probe" >&2
      sed -n '1,120p' "$WORK/app.stderr" >&2 || true
      exit 1
    fi
    if /usr/bin/curl --fail --silent --max-time 1 \
      http://127.0.0.1:8843/api/version -o "$response"; then
      if "$PYTHON_BIN" -c \
        'import json,sys; d=json.load(open(sys.argv[1])); raise SystemExit(0 if d == {"ok": True, "version": sys.argv[2]} else 1)' \
        "$response" "$expected"; then
        ready=1
        break
      fi
    fi
    sleep 1
  done
  [[ "$ready" == 1 ]] || {
    echo "installed Quiltor did not report expected version $expected" >&2
    exit 1
  }
  sleep 2
  kill -0 "$ACTIVE_PID"
  kill "$ACTIVE_PID"
  wait "$ACTIVE_PID" 2>/dev/null || true
  ACTIVE_PID=""
  assert_port_free
  if ps -axo command= | grep -F "$INSTALLED_APP/Contents/MacOS/" | grep -v grep >/dev/null; then
    echo "an installed Quiltor process survived the launch check" >&2
    exit 1
  fi
}

verify_dmg "$CURRENT_DMG"
CURRENT_TEAM="$(team_identifier "$CURRENT_DMG")"
[[ -n "$CURRENT_TEAM" ]] || {
  echo "current DMG has no Developer ID team identifier" >&2
  exit 1
}

BOOTSTRAP=0
PREVIOUS_EXPECTED_VERSION=""
if [[ -n "${QUILTOR_PREVIOUS_DMG:-}" ]]; then
  [[ -n "${QUILTOR_PREVIOUS_VERSION:-}" ]] || {
    echo "QUILTOR_PREVIOUS_VERSION is required with QUILTOR_PREVIOUS_DMG" >&2
    exit 2
  }
  cp "$QUILTOR_PREVIOUS_DMG" "$PREVIOUS_DMG"
  PREVIOUS_EXPECTED_VERSION="$QUILTOR_PREVIOUS_VERSION"
  require_previous_order "$PREVIOUS_EXPECTED_VERSION"
else
  set +e
  "$PYTHON_BIN" "$ROOT/distribution/tooling/previous_release.py" \
    --kind macos-dmg --current-version "$VERSION" --output "$PREVIOUS_DMG" \
    --metadata-output "$PREVIOUS_METADATA"
  lookup_status=$?
  set -e
  if [[ "$lookup_status" == 3 ]]; then
    BOOTSTRAP=1
    echo "BOOTSTRAP: exercising clean install plus same-version overwrite; no predecessor exists."
  elif [[ "$lookup_status" != 0 ]]; then
    echo "previous stable DMG lookup failed; refusing to skip the upgrade gate" >&2
    exit "$lookup_status"
  else
    PREVIOUS_EXPECTED_VERSION="$(metadata_version)"
    require_previous_order "$PREVIOUS_EXPECTED_VERSION"
  fi
fi

if [[ "$BOOTSTRAP" == 0 ]]; then
  verify_dmg "$PREVIOUS_DMG"
  PREVIOUS_TEAM="$(team_identifier "$PREVIOUS_DMG")"
  [[ "$PREVIOUS_TEAM" == "$CURRENT_TEAM" ]] || {
    echo "previous and current DMGs do not share the signing team" >&2
    exit 1
  }
  install_dmg "$PREVIOUS_DMG"
  PREVIOUS_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INSTALLED_APP/Contents/Info.plist")"
  [[ "$PREVIOUS_VERSION" == "$PREVIOUS_EXPECTED_VERSION" ]] || {
    echo "predecessor bundle version $PREVIOUS_VERSION does not match selected release $PREVIOUS_EXPECTED_VERSION" >&2
    exit 1
  }
  launch_and_probe "$PREVIOUS_EXPECTED_VERSION"
  printf 'upgrade-preserves-user-data\n' > "$USER_ROOT/data/native-smoke-marker"
else
  install_dmg "$CURRENT_DMG"
  launch_and_probe "$VERSION"
  printf 'bootstrap-reinstall-preserves-user-data\n' > "$USER_ROOT/data/native-smoke-marker"
fi

# ditto onto the existing bundle exercises the same overwrite shape as a drag-copy upgrade.
install_dmg "$CURRENT_DMG"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INSTALLED_APP/Contents/Info.plist")" == "$VERSION" ]]
[[ -f "$USER_ROOT/data/native-smoke-marker" ]]
launch_and_probe "$VERSION"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[[ -x "$LSREGISTER" ]] || {
  echo "LaunchServices registration tool is unavailable" >&2
  exit 1
}
"$LSREGISTER" -f "$INSTALLED_APP" >/dev/null
"$LSREGISTER" -dump > "$WORK/launchservices-registered.txt"
if ! grep -F "$INSTALLED_APP" "$WORK/launchservices-registered.txt" >/dev/null; then
  echo "LaunchServices did not register the isolated Quiltor app" >&2
  exit 1
fi
"$LSREGISTER" -u "$INSTALLED_APP" >/dev/null
"$LSREGISTER" -dump > "$WORK/launchservices-unregistered.txt"
if grep -F "$INSTALLED_APP" "$WORK/launchservices-unregistered.txt" >/dev/null; then
  echo "LaunchServices still registers the isolated Quiltor app" >&2
  exit 1
fi
rm -rf "$INSTALLED_APP"
[[ ! -e "$INSTALLED_APP" ]]
assert_port_free
if mount | grep -F "$WORK/mount-" >/dev/null; then
  echo "DMG remained mounted after uninstall smoke" >&2
  exit 1
fi
echo "macOS native install/upgrade/launch/uninstall smoke passed for $VERSION"
