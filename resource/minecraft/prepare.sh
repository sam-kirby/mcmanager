#!/bin/bash
CODE="£CODE"
REGION="£REGION"
HOSTEDZONEID="£HOSTEDZONEID"
DOMAIN="£DOMAIN"
MCMP="£MCMP"
WORLD="£WORLD"

mkdir /media/mc
parted /dev/nvme1n1 --script mklabel gpt mkpart primary 0% 100%
sync
mkfs.ext4 /dev/nvme1n1p1 -L mc
sync
echo -e "LABEL=mc\t/media/mc\text4\tdefaults\t0\t0" >> /etc/fstab
mount -a
aws s3 sync s3://$MCMP/$CODE /media/mc --region $REGION --quiet
aws s3 sync s3://$WORLD/$CODE /media/mc/world --region $REGION --quiet
sync
chown -R ec2-user:ec2-user /media/mc
chmod -R 770 /media/mc
#update-rc.d mcserver.sh defaults
#update-rc.d monitor.sh defaults 100
systemctl daemon-reload
systemctl enable monitor.sh
systemctl enable mcserver.sh
(crontab -l 2>/dev/null; echo "*/30 * * * * /usr/sbin/service mcserver.sh backup") | crontab -
sync

IP=$(curl http://169.254.169.254/latest/meta-data/public-ipv4)
aws route53 change-resource-record-sets --hosted-zone-id $HOSTEDZONEID --change-batch "{\"Changes\": [{\"Action\": \"UPSERT\",\"ResourceRecordSet\": {\"Name\": \"$CODE.$DOMAIN\",\"Type\": \"A\", \"TTL\":15, \"ResourceRecords\": [ { \"Value\": \"$IP\" } ] } } ] }"

curl http://169.254.169.254/latest/meta-data/instance-id >> /id.txt
