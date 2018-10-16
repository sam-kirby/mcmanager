#!/usr/bin/env bash


### BEGIN INIT INFO
# Provides:          kf2server
# Required-Start:    $local_fs $network $syslog
# Required-Stop:     $local_fs $network $syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Killing Floor 2 Server
# Description:       Killing Floor 2 Server start-stop-daemon
### END INIT INFO

NAME="kf2server"
PATH="/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin"
APPDIR="/media/kf2ds/"
APPBIN="tmux"
SESSION=$NAME
USER="ec2-user"
CODE="kf2"
REGION="£REGION"
KF2CMD="./Binaries/Win64/KFGameSteamServer.bin.x86_64"

# Include functions
set -e
#. /lib/lsb/init-functions

start() {
  printf "Starting '$NAME'... "
  cd $APPDIR
  #Generate Config Files
  su $USER -c "$APPBIN new-session -d -s $SESSION \"$KF2CMD\""
  sleep 6
  $APPBIN -S /tmp/tmux-"$(id -u ${USER})"/default send-keys -t $SESSION.0 C-c

  #Update Config Files - Web
  sed -i 's/bEnabled.*/bEnabled=true/' /media/kf2ds/KFGame/Config/KFWeb.ini

  #Start Server
  su $USER -c "$APPBIN new-session -d -s $SESSION \"$KF2CMD\""

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
