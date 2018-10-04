#!/bin/bash
ID=$(cat /id.txt)
IP=$(curl http://169.254.169.254/latest/meta-data/public-ipv4)
CODE="£CODE"
REGION="£REGION"
ACCOUNT="£ACCOUNT"
HOSTEDZONEID="£HOSTEDZONEID"
DOMAIN="£DOMAIN"
FBTOKEN="£FBTOKEN"

SFR=$(aws ec2 describe-instances --instance-ids $ID --query "Reservations[0].Instances[0].Tags[0].Value" --output text --region $REGION)

terminate() {
  aws route53 change-resource-record-sets --hosted-zone-id $HOSTEDZONEID --change-batch "{\"Changes\": [{\"Action\": \"DELETE\",\"ResourceRecordSet\": {\"Name\": \"$CODE.$DOMAIN\",\"Type\": \"A\", \"TTL\":15, \"ResourceRecords\": [ { \"Value\": \"$IP\" } ] } } ] }"
  service mcserver.sh stop
  sleep 30
  aws ec2 cancel-spot-fleet-requests --spot-fleet-request-ids $SFR --terminate-instances --region $REGION
}

status() {
  curl -X POST -H "Content-Type: application/json" -d '{
    "recipient": { "id": '$1' },
    "message": { "text": "WIP FEATURE: Instance is still running...\nThis does not guarantee that Minecraft has not crashed" }
  }' "https://graph.facebook.com/v2.6/me/messages?access_token=$FBTOKEN"
}

(while true; do
  if [ "$(aws ec2 describe-spot-instance-requests --filter Name=instance-id,Values=$ID --query "SpotFleetRequests[0].Status.Code" --output text --region $REGION)" == "marked-for-termination" ]; then
    terminate
  fi
  command=$(aws sqs receive-message --queue-url https://sqs.$REGION.amazonaws.com/$ACCOUNT/$CODE --message-attribute-names cmd --query "Messages[0].{cmd : MessageAttributes.cmd.StringValue}" --region $REGION --output text)
  if [ command == "stop" ]; then
    aws sqs purge-queue --queue-url https://sqs.$REGION.amazonaws.com/$ACCOUNT/$CODE --region $REGION
    terminate
  fi
  if [ command == "status" ]; then
    user=$(aws sqs receive-message --queue-url https://sqs.$REGION.amazonaws.com/$ACCOUNT/$CODE --message-attribute-names user --query "Messages[0].{user : MessageAttributes.user.StringValue}" --region $REGION --output text)
    aws sqs purge-queue --queue-url https://sqs.$REGION.amazonaws.com/$ACCOUNT/$CODE --region $REGION
    status
  fi
  sleep 5
done) &