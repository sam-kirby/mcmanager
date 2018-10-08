#!/bin/bash

### BEGIN INIT INFO
# Provides:          monitor
# Required-Start:    $local_fs $network $syslog
# Required-Stop:     $local_fs $network $syslog
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Monitors SQS
# Description:       Monitors SQS for commands for this Minecraft Server
### END INIT INFO

ID=$(cat /id.txt)
IP=$(curl http://169.254.169.254/latest/meta-data/public-ipv4)
CODE="£CODE"
REGION="£REGION"
ACCOUNT="£ACCOUNT"
HOSTEDZONEID="£HOSTEDZONEID"
DOMAIN="£DOMAIN"
FBTOKEN="£FBTOKEN"

SFR=$(aws ec2 describe-instances --instance-ids $ID --query "Reservations[0].Instances[0].Tags[0].Value"\
  --output text --region $REGION)

terminate() {
  aws route53 change-resource-record-sets --hosted-zone-id $HOSTEDZONEID --change-batch "{\"Changes\": [{\"Action\": \"DELETE\",\"ResourceRecordSet\": {\"Name\": \"$CODE.$DOMAIN\",\"Type\": \"A\", \"TTL\":15, \"ResourceRecords\": [ { \"Value\": \"$IP\" } ] } } ] }"
  service mcserver.sh stop
  sleep 30
  aws ec2 cancel-spot-fleet-requests --spot-fleet-request-ids $SFR --terminate-instances --region $REGION
}

status() {

  curl -X POST -H "Content-Type: application/json" -d\
  '{
    "messaging-type": "MESSAGE_TAG",
    "tag": "GAME_EVENT",
    "recipient": { "id": '$1' },
    "message": {
      "text": "Instance is still responding.\nChecking the status of Minecraft..."
    }
  }'\
  https://graph.facebook.com/v3.1/me/messages?access_token=$FBTOKEN

  pgrep java

  if [ $? == 1 ]; then
    curl -X POST -H "Content-Type: application/json" -d\
      '{
        "messaging-type": "MESSAGE_TAG",
        "tag": "GAME_EVENT",
        "recipient": { "id": '$1' },
        "message": {
          "text": "There appears to be no running JVM on this instance. Uploading latest log, then restarting..."
        }
      }'\
      https://graph.facebook.com/v3.1/me/messages?access_token=$FBTOKEN

    curl  \
      -F 'recipient={"id":"'$1'"}' \
      -F 'message={"attachment":{"type":"file", "payload":{}}}' \
      -F 'filedata=@/media/mc/logs/latest.log;type=text/plain' \
      https://graph.facebook.com/v3.1/me/messages\?access_token=$FBTOKEN

    sleep 5
    reboot
  else
    curl -X POST -H "Content-Type: application/json" -d\
      '{
        "messaging-type": "MESSAGE_TAG",
        "tag": "GAME_EVENT",
        "recipient": { "id": '$1' },
        "message": {
          "text": "JVM is still running, do you want to restart?",
          "quick_replies":[
            {
              "content_type":"text",
              "title":"Restart",
              "payload":"RESTART_'$code'"
          }]
        }
      }'\
      https://graph.facebook.com/v3.1/me/messages?access_token=$FBTOKEN
  fi
}

(while true; do
  if [ "$(aws ec2 describe-spot-instance-requests --filter Name=instance-id,Values=$ID\
   --query "SpotFleetRequests[0].Status.Code" --output text --region $REGION)" == "marked-for-termination" ]; then
    terminate
  fi
  message=$(aws sqs receive-message --queue-url https://sqs.$REGION.amazonaws.com/$ACCOUNT/$CODE\
    --message-attribute-names cmd user\
    --query "Messages[0].{cmd : MessageAttributes.cmd.StringValue, user : MessageAttributes.user.StringValue}"\
    --region $REGION --output text)
  commandArray=($message)
  if [ ${commandArray[0]} == "stop" ]; then
    aws sqs purge-queue --queue-url https://sqs.$REGION.amazonaws.com/$ACCOUNT/$CODE --region $REGION
    terminate
  fi
  if [ ${commandArray[0]} == "status" ]; then
    aws sqs purge-queue --queue-url https://sqs.$REGION.amazonaws.com/$ACCOUNT/$CODE --region $REGION
    status ${commandArray[1]}
  fi
  if [ ${commandArray[0]} == "restart" ]; then
    aws sqs purge-queue --queue-url https://sqs.$REGION.amazonaws.com/$ACCOUNT/$CODE --region $REGION
    service mcserver.sh stop
    sleep 5
    curl  \
      -F 'recipient={"id":"'${commandArray[1]}'"}' \
      -F 'message={"attachment":{"type":"file", "payload":{}}}' \
      -F 'filedata=@/media/mc/logs/latest.log;type=text/plain' \
      https://graph.facebook.com/v3.1/me/messages\?access_token=$FBTOKEN
    sleep 5
    reboot
  fi
  sleep 5
done) &