#!/bin/sh

### BEGIN INIT INFO
# Provides:          mcserver
# Required-Start:    $local_fs $network $syslog
# Required-Stop:     $local_fs $network $syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Minecraft Server
# Description:       Minecraft Server start-stop-daemon
### END INIT INFO

NAME="mcserver"
PATH="/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin"
APPDIR="/media/mc"
APPBIN="tmux"
SESSION=$NAME
USER="ec2-user"
JAVACMD="java"
JAVAMAXMEM="£MAXMEM"
JARFILE="£JAR"
CODE="£CODE"
REGION="£REGION"
#MCARGS="$JAVACMD -server -Xms512M -Xmx$JAVAMAXMEM -XX:PermSize=256M -XX:+UseParNewGC -XX:+CMSIncrementalPacing -XX:+CMSClassUnloadingEnabled -XX:ParallelGCThreads=2 -XX:MinHeapFreeRatio=5 -XX:MaxHeapFreeRatio=10 -jar $JARFILE nogui"
MCARGS="$JAVACMD -server -Xms512M -Xmx$JAVAMAXMEM -XX:+UseG1GC -Dsun.rmi.dgc.server.gcInterval=2147483646 -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M -Dfml.readTimeout=180 -jar $JARFILE nogui"
BUCKET="s3://£WORLD/$CODE"
BACKUPBUCKET="s3://£BACKUPBUCKET/$CODE"

# Include functions
set -e
#. /lib/lsb/init-functions

start() {
  printf "Starting '$NAME'... "
  cd $APPDIR
  mkdir backups
  su $USER -c "$APPBIN new-session -d -s $SESSION \"$MCARGS\""
  printf "done\n"
}



stop() {
  printf "Stopping '$NAME'... "
  $APPBIN -S /tmp/tmux-"$(id -u ${USER})"/default send-keys -t $SESSION.0 "say Server is shutting down..." Enter
  sleep 5
  $APPBIN -S /tmp/tmux-"$(id -u ${USER})"/default send-keys -t $SESSION.0 "stop" Enter
  sleep 5
  aws s3 sync $APPDIR/world $BUCKET --delete --region $REGION
  sleep 1
  printf "done\n"
}

backup() {
  printf "Starting server backup of '$NAME'..."
  $APPBIN -S /tmp/tmux-"$(id -u ${USER})"/default send-keys -t $SESSION.0 "say Starting a server backup..." Enter "save-off" Enter
  cd $APPDIR/world
  CURRENT=backup-$(date +%y%m%d-%H%M%S).tar.gz
  tar -cjf ../backups/$CURRENT .
  $APPBIN -S /tmp/tmux-"$(id -u ${USER})"/default send-keys -t $SESSION.0 "save-on" Enter "say Server backup is complete! Uploading Now..." Enter
  aws s3 cp $APPDIR/backups/$CURRENT $BACKUPBUCKET --region $REGION
  $APPBIN -S /tmp/tmux-"$(id -u ${USER})"/default send-keys -t $SESSION.0 "say Upload successful!" Enter
  printf "done\n"
}

case "$1" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  backup)
    backup
    ;;
  restart)
    stop
    start
    ;;
  *)
    echo "Usage: $NAME {start|stop|restart|backup}" >&2
    exit 1
    ;;
esac

exit 0
