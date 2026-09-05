#!/bin/sh
set -eu

# Named volumes created by older releases are commonly owned by root. Repair
# only the application data volume, then permanently drop privileges before
# migrations and the web server start.
if [ "$(id -u)" = "0" ]; then
    chown -R caspian:caspian /data
    exec gosu caspian "$@"
fi

exec "$@"
