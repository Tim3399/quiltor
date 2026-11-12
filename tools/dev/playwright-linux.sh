#!/usr/bin/env bash
# Installs Chromium for Playwright on an Ubuntu runner: first the system packages through apt,
# with bounded time and exactly one switch of mirror, then the browser itself.
#
#   tools/dev/playwright-linux.sh
#
# `npx playwright install --with-deps chromium` did both in one step. Twice in a row (runs on
# 15e0b43 and 24cd57b) apt hung in it for 10-11 minutes on two or three of four slots:
# "Fetched 25.9 MB in 10min 36s (40.8 kB/s)" from azure.archive.ubuntu.com, while the other
# slots needed under a minute. A trickle like that never trips apt's own timeout, which only
# counts silence, so each attempt also has a wall-clock limit.
#
# The first attempt uses the runner's mirror list. If it does not finish in time, the list is
# replaced by Ubuntu's own archive and apt runs once more. If that fails too, the job fails:
# the visual baselines need the fonts apt installs, so a step that went on without them would
# compare wrong pixels instead of reporting the missing packages.
#
# A mirror that is not reachable at all (archive.ubuntu.com was down for more than 3.5 h on
# 2026-11-11, D-176) fails both attempts and used to turn every Linux slot red. The .deb files
# of a successful install are therefore kept in QUILTOR_APT_CACHE, which the workflows restore
# and save with actions/cache under a key of runner image and Playwright version. When the first
# attempt fails and that directory holds packages, they are installed from it with dpkg and no
# network: the very same files, so the same fonts and the same rendering. Without a cache the
# mirror switch below still applies. A cache from a different image is never restored, because
# the key has no fallback.
set -euo pipefail

FIRST_LIMIT=240   # s; the apt part normally takes 15-65 s
SECOND_LIMIT=300  # s; a fresh mirror, one chance
MIRRORS=/etc/apt/apt-mirrors.txt
FALLBACK_MIRROR=http://archive.ubuntu.com/ubuntu/
ARCHIVES=/var/cache/apt/archives
CACHE_DIR="${QUILTOR_APT_CACHE:-$HOME/.cache/quiltor-apt}"

# sudo drops APT_CONFIG from the environment, so the limits go where apt always reads.
printf '%s\n' \
  'Acquire::http::Timeout "30";' \
  'Acquire::https::Timeout "30";' \
  'Acquire::Retries "3";' \
  'APT::Keep-Downloaded-Packages "true";' |
  sudo tee /etc/apt/apt.conf.d/99quiltor-timeouts >/dev/null

has_cache() {
  compgen -G "$CACHE_DIR/*.deb" >/dev/null
}

# No network: dpkg takes the files of an earlier successful install. An attempt stopped
# mid-install may have left packages unconfigured.
install_from_cache() {
  has_cache || return 1
  sudo dpkg --configure -a
  sudo dpkg --skip-same-version --install "$CACHE_DIR"/*.deb
}

# The names of the packages in apt's archive, one per line, sorted.
archive_names() {
  [ -d "$ARCHIVES" ] || return 0
  sudo find "$ARCHIVES" -maxdepth 1 -name '*.deb' -printf '%f\n' | sort
}

# Keeps the packages this run downloaded, but only when there is no cache yet. They are found
# by name against the list from before the install, not by modification time: apt gives a
# downloaded file the Last-Modified time of the mirror, which is older than this run, so
# `find -newer` found none of the 21 MB (run 43099579638: "Kept 0 packages"). A run that keeps
# nothing says so and shows what apt's archive looks like; the workflow saves no cache then.
save_to_cache() {
  has_cache && return 0
  mkdir -p "$CACHE_DIR"
  local name
  while IFS= read -r name; do
    sudo cp --target-directory="$CACHE_DIR" "$ARCHIVES/$name"
  done < <(archive_names | comm -13 "$BEFORE" -)
  sudo chown -R "$(id -u):$(id -g)" "$CACHE_DIR"
  local kept
  kept="$(find "$CACHE_DIR" -name '*.deb' | wc -l)"
  echo "Kept $kept packages in $CACHE_DIR for the next run"
  if [ "$kept" -eq 0 ]; then
    echo "::warning::no downloaded package was found in $ARCHIVES; the apt cache stays empty"
    sudo ls -la --time-style=full-iso "$ARCHIVES" | head -20
    apt-config dump | grep -iE 'Keep-Downloaded|Clean' || echo "(no clean or keep rule in apt's configuration)"
  fi
}

# Runs as root so that timeout can stop apt-get itself, not only the npx that started it.
install_deps() {
  sudo env "PATH=$PATH" timeout --kill-after=15 "$1" npx playwright install-deps chromium
}

BEFORE="$(mktemp)"
archive_names > "$BEFORE"

if ! install_deps "$FIRST_LIMIT"; then
  if has_cache; then
    echo "::warning::apt did not finish within ${FIRST_LIMIT}s; installing the packages of the cache"
    install_from_cache
    npx playwright install chromium
    exit 0
  fi
  echo "::warning::apt did not finish within ${FIRST_LIMIT}s; switching once to ${FALLBACK_MIRROR}"
  if [ ! -f "$MIRRORS" ]; then
    echo "::error::$MIRRORS is missing; cannot switch the apt mirror"
    exit 1
  fi
  # An attempt stopped mid-install may leave packages unconfigured.
  sudo dpkg --configure -a
  echo "$FALLBACK_MIRROR" | sudo tee "$MIRRORS" >/dev/null
  if ! install_deps "$SECOND_LIMIT"; then
    echo "::error::apt failed on ${FALLBACK_MIRROR} as well; the browser's system packages are missing"
    exit 1
  fi
fi

save_to_cache

npx playwright install chromium
