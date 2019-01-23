#!/bin/bash
REGION="£REGION"
BUCKET="£BUCKET"

curl http://169.254.169.254/latest/meta-data/instance-id >> /id.txt

#HACKY WAY TO GET AROUND AWS NOT ALLOWING THIS TO BE SPECIFIED IN SPOT FLEET REQUESTS....
ID=$(cat /id.txt)
aws ec2 modify-instance-credit-specification --instance-credit-specification "InstanceId=$ID,CpuCredits=standard"

yum -y groupinstall "Development Tools"

curl https://download.libsodium.org/libsodium/releases/LATEST.tar.gz | tar -xz
cd libsodium-stable/
./configure && make && make install
cd .. && rm -rf libsodium-stable

mkdir ffmpeg
curl https://johnvansickle.com/ffmpeg/builds/ffmpeg-git-amd64-static.tar.xz | tar -xJ -C ffmpeg --strip-components 1
mv ./ffmpeg/ffmpeg ./ffmpeg/ffprobe /usr/bin
rm -rf ffmpeg

cd /home/ec2-user

git clone https://github.com/Just-Some-Bots/MusicBot.git MusicBot -b master
cd MusicBot/
python3 -m pip install -U -r requirements.txt

aws s3 sync s3://$BUCKET /home/ec2-user/MusicBot

chown -R ec2-user:ec2-user /home/ec2-user/MusicBot
chmod -R 770 /home/ec2-user/MusicBot

systemctl daemon-reload
systemctl enable monitor.sh
systemctl enable music.sh
