#!/bin/sh

### BEGIN INIT INFO
# Provides:          music
# Required-Start:    $local_fs $network $syslog
# Required-Stop:     $local_fs $network $syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Discord Music
# Description:       Discord Music start-stop-daemon
### END INIT INFO

NAME="music"
PATH="/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin"
APPBIN="tmux"
APPDIR="/home/ec2-user/MusicBot"
PYTHON="python3"
PYTHONAPP="run.py"
SESSION=$NAME
USER="ec2-user"

# Include functions
set -e
#. /lib/lsb/init-functions

start() {
  printf "Starting '$NAME'... "
  cd $APPDIR
  su $USER -c "$APPBIN new-session -d -s $SESSION \"$PYTHON $PYTHONAPP\""
  printf "done\n"
}



stop() {
  printf "Stopping '$NAME'... "
  $APPBIN -S /tmp/tmux-"$(id -u ${USER})"/default send-keys -t $SESSION.0 C-c
  printf "done\n"
}

case "$1" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start
    ;;
  *)
    echo "Usage: $NAME {start|stop|restart}" >&2
    exit 1
    ;;
esac

exit 0
