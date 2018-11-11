#!/usr/bin/env bash
CODE="£CODE"
REGION="£REGION"
HOSTEDZONEID="£HOSTEDZONEID"
DOMAIN="£DOMAIN"
BUCKET="£BUCKET"


IP=$(curl http://169.254.169.254/latest/meta-data/public-ipv4)
aws route53 change-resource-record-sets --hosted-zone-id $HOSTEDZONEID --change-batch "{\"Changes\": [{\"Action\": \"UPSERT\",\"ResourceRecordSet\": {\"Name\": \"$CODE.$DOMAIN\",\"Type\": \"A\", \"TTL\":15, \"ResourceRecords\": [ { \"Value\": \"$IP\" } ] } } ] }"

curl http://169.254.169.254/latest/meta-data/instance-id >> /id.txt

mkdir /media/kf2ds
parted /dev/nvme1n1 --script mklabel gpt mkpart primary 0% 100%
sync
mkfs.ext4 /dev/nvme1n1p1 -L kf2ds
sync
echo -e "LABEL=kf2ds\t/media/kf2ds\text4\tdefaults\t0\t0" >> /etc/fstab
mount -a
sync
chown -R ec2-user:ec2-user /media/kf2ds

su - ec2-user -c 'curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar zxvf -
./steamcmd.sh +login anonymous +force_install_dir /media/kf2ds +app_update 232130 £BETA +exit
aws s3 sync s3://$BUCKET/ /media/kf2ds/KFGame/Config/
chmod -R 770 /media/kf2ds'

systemctl daemon-reload
systemctl enable monitor.sh
systemctl enable kf2server.sh
sync
