#!/usr/bin/env bash
set -euo pipefail
REGION=us-east-1
AMI=ami-04b938437b69a2c9c
SUBNET=subnet-e4495da9
SG=sg-02b555e6b49b62bd6
UD=/home/ubuntu/abhinav/field-to-ota/infra/_userdata.sh

aws ec2 run-instances \
  --region "$REGION" \
  --image-id "$AMI" \
  --instance-type t3.small \
  --subnet-id "$SUBNET" \
  --security-group-ids "$SG" \
  --associate-public-ip-address \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}' \
  --user-data "file://$UD" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=field-to-fix-console},{Key=app,Value=field-to-fix}]' \
  --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' \
  --query 'Instances[0].InstanceId' --output text
