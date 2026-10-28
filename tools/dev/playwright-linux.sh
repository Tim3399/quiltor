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
set -euo pipefail

FIRST_LIMIT=240   # s; the apt part normally takes 15-65 s
SECOND_LIMIT=300  # s; a fresh mirror, one chance
MIRRORS=/etc/apt/apt-mirrors.txt
FALLBACK_MIRROR=http://archive.ubuntu.com/ubuntu/

# sudo drops APT_CONFIG from the environment, so the limits go where apt always reads.
printf '%s\n' \
  'Acquire::http::Timeout "30";' \
  'Acquire::https::Timeout "30";' \
  'Acquire::Retries "3";' |
  sudo tee /etc/apt/apt.conf.d/99quiltor-timeouts >/dev/null

# Runs as root so that timeout can stop apt-get itself, not only the npx that started it.
install_deps() {
  sudo env "PATH=$PATH" timeout --kill-after=15 "$1" npx playwright install-deps chromium
}

if ! install_deps "$FIRST_LIMIT"; then
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

npx playwright install chromium
