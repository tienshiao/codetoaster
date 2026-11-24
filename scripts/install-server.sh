#!/usr/bin/env bash
# Install the built server binary and restart the daemon on it.
#
#   scripts/install-server.sh [--build] [--port N] [--dest PATH] [--no-restart]
#
#   --build       run `bun run build:server` first
#   --port N      the daemon to restart (default 4000)
#   --dest PATH   where the binary is installed (default ~/bin/codetoaster)
#   --no-restart  install only
#
# Safe to run from a shell tab or an agent session inside CodeToaster. Stopping
# the daemon closes every terminal it owns, this one included, so the stop and
# start run in a process of their own: forked into a new session (perl's
# setsid; macOS ships no setsid command), with no terminal and SIGHUP ignored.
# Its output goes to ~/.codetoaster/restart.log.
#
# The new daemon gets the flags the running one was started with, read off its
# command line, and starts in the directory the running one was in (the
# default cwd of a task with no project, and what a relative --db is resolved
# against), not in whatever task worktree this was run from. A flag value
# containing a space would be split; none of the daemon's flags take one in
# practice.
#
# The old binary is moved aside before the copy rather than overwritten: macOS
# kills a binary copied over an existing one in place, apparently because it
# caches the code signature against the file. A rename, like a removal, makes
# the copy a new file, and keeps the old one to put back if the copy will not
# run: the running daemon's agents call `<dest> hook`, so a broken binary left
# at dest breaks them even though the daemon itself is not restarted.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port=4000
dest="$HOME/bin/codetoaster"
build=0
restart=1

while [ $# -gt 0 ]; do
  case "$1" in
    --build) build=1 ;;
    --no-restart) restart=0 ;;
    --port) port="${2:?--port needs a value}"; shift ;;
    --dest) dest="${2:?--dest needs a value}"; shift ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

src="$repo/dist-executables/codetoaster"
state="$HOME/.codetoaster"
log="$state/restart.log"

if [ "$build" = 1 ]; then
  (cd "$repo" && bun run build:server)
fi
[ -x "$src" ] || { echo "no built binary at $src (try --build)" >&2; exit 1; }
if [ -e "$dest" ] && [ "$src" -ef "$dest" ]; then
  echo "--dest is the built binary itself ($src); pick another path" >&2
  exit 2
fi
# Refuse a build that does not run before touching what is installed.
"$src" help >/dev/null 2>&1 || { echo "the built binary at $src does not run; nothing installed" >&2; exit 1; }

# The running daemon, captured before anything changes: its pid (to wait for
# its exit before starting the new one), its flags (everything after
# `foreground`, or `fg`, on its command line is what `start` takes too) and its
# working directory.
args=()
old_pid=""
old_cwd=""
pidfile="$state/codetoaster.$port.pid"
if [ "$restart" = 1 ] && [ -f "$pidfile" ]; then
  pid="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$pidfile")"
  cmdline=""
  [ -n "$pid" ] && cmdline="$(ps -ww -o command= -p "$pid" 2>/dev/null || true)"
  rest=""
  daemon=0
  case "$cmdline" in
    *" foreground "*|*" foreground") daemon=1; rest="${cmdline#* foreground}" ;;
    *" fg "*|*" fg") daemon=1; rest="${cmdline#* fg}" ;;
    *) echo "pid file names ${pid:-nothing}, which is not a running daemon; starting with --port $port" >&2 ;;
  esac
  if [ "$daemon" = 1 ]; then
    old_pid="$pid"
    old_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
    [ -n "$rest" ] && read -r -a args <<<"$rest"
  fi
fi
[ ${#args[@]} -gt 0 ] || args=(--port "$port")
[ -n "$old_cwd" ] || old_cwd="$HOME"

mkdir -p "$(dirname "$dest")"
backup=""
if [ -e "$dest" ]; then
  backup="$dest.old.$$"
  mv -f "$dest" "$backup"
fi
# Refuse to stop a working daemon in favour of a binary that will not run, and
# put the old binary back so the running daemon's hooks keep working.
if ! cp "$src" "$dest" || ! "$dest" help >/dev/null 2>&1; then
  rm -f "$dest"
  [ -z "$backup" ] || mv -f "$backup" "$dest"
  echo "the installed binary at $dest does not run; previous binary restored, daemon left alone" >&2
  exit 1
fi
[ -z "$backup" ] || rm -f "$backup"
echo "installed $dest ($(wc -c <"$dest" | tr -d ' ') bytes)"

[ "$restart" = 1 ] || exit 0

echo "restarting: $dest ${args[*]}"
echo "log: $log (this terminal closes if it belongs to the daemon)"
mkdir -p "$state"
# `stop` gives up waiting after a second and falls back to SIGTERM, while a
# shutdown that drains a harvest tick can take longer, so the start waits for
# the old process to be gone: started while it still holds the port, the new
# daemon would fail to bind and leave nothing running.
# shellcheck disable=SC2016 # expanded by the inner sh, from its arguments
nohup perl -MPOSIX -e 'fork and exit; POSIX::setsid(); exec @ARGV' \
  sh -c '
    dest=$1 port=$2 old=$3 dir=$4; shift 4
    sleep 1
    "$dest" stop --port "$port"
    i=0
    while [ -n "$old" ] && kill -0 "$old" 2>/dev/null; do
      i=$((i + 1))
      if [ "$i" -gt 300 ]; then
        echo "pid $old still running 30s after stop; not starting a second daemon"
        exit 1
      fi
      sleep 0.1
    done
    cd "$dir" 2>/dev/null || cd "$HOME"
    exec "$dest" "$@"
  ' \
  sh "$dest" "$port" "$old_pid" "$old_cwd" "${args[@]}" \
  </dev/null >"$log" 2>&1 &
