#!/usr/bin/env bash
# Launch the Field-to-Fix console on EC2. Every value is overridable via env; nothing is region-specific.
#   AWS_REGION        default: `aws configure get region`, else ap-southeast-2
#   AMI               default: latest Amazon Linux 2023 (x86_64) from SSM public parameters
#   SUBNET / SG       default: a default-VPC subnet / the f2f-console-sg group (created if missing)
#   INGRESS_CIDR      who may reach :22 and :8000 (default: this machine's public IP /32)
#   KEY_NAME          default field-to-fix-key (created if missing; private key saved to infra/<name>.pem)
#   INSTANCE_PROFILE  default f2f-console-agentcore-profile (created via _agentcore_role.sh if missing)
#   INSTANCE_TYPE     default t3.small
# App settings forwarded to the container (written to /etc/f2f.env on the instance):
#   BEDROCK_MODEL_ID, DISCOVERY_AGENTCORE_ARN, RCA_AGENTCORE_ARN, DISCOVERY_OEM, DISCOVERY_MODELS, DISCOVERY_INTERVAL
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)

REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"
export AWS_REGION="${REGION:-ap-southeast-2}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
KEY_NAME="${KEY_NAME:-field-to-fix-key}"
INSTANCE_PROFILE="${INSTANCE_PROFILE:-f2f-console-agentcore-profile}"
SG_NAME="${SG_NAME:-f2f-console-sg}"
ec2() { aws ec2 --region "$AWS_REGION" "$@"; }

AMI="${AMI:-$(aws ssm get-parameter --region "$AWS_REGION" \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text)}"
VPC=$(ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBNET="${SUBNET:-$(ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true \
  --query 'Subnets[0].SubnetId' --output text)}"

if [ -z "${SG:-}" ]; then
  SG=$(ec2 describe-security-groups --filters Name=vpc-id,Values="$VPC" Name=group-name,Values="$SG_NAME" \
    --query 'SecurityGroups[0].GroupId' --output text)
  if [ "$SG" = "None" ]; then
    CIDR="${INGRESS_CIDR:-$(curl -s https://checkip.amazonaws.com)/32}"
    SG=$(ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC" \
      --description "Field-to-Fix console: SSH + :8000" --query GroupId --output text)
    for port in 22 8000; do
      ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port "$port" --cidr "$CIDR" >/dev/null
    done
    echo "created $SG_NAME ($SG), ingress from $CIDR" >&2
  fi
fi

if ! ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  umask 077
  ec2 create-key-pair --key-name "$KEY_NAME" --query KeyMaterial --output text > "$HERE/$KEY_NAME.pem"
  echo "created key pair $KEY_NAME -> $HERE/$KEY_NAME.pem" >&2
fi

if ! aws iam get-instance-profile --instance-profile-name "$INSTANCE_PROFILE" >/dev/null 2>&1; then
  PROFILE="$INSTANCE_PROFILE" "$HERE/_agentcore_role.sh" >&2
fi

# User data = shebang + /etc/f2f.env with the app settings + _userdata.sh.
UD=$(mktemp); trap 'rm -f "$UD"' EXIT
{
  echo '#!/bin/bash'
  echo "cat > /etc/f2f.env <<'F2F_ENV'"
  echo "AWS_REGION=$AWS_REGION"
  echo "F2F_MODE=aws"
  echo "DISCOVERY_AUTOSTART=1"
  echo "DISCOVERY_OEM=${DISCOVERY_OEM:-Stellantis}"
  echo "DISCOVERY_MODELS=${DISCOVERY_MODELS:-Jeep,Dodge,RAM,Chrysler,Uconnect}"
  echo "DISCOVERY_INTERVAL=${DISCOVERY_INTERVAL:-900}"
  for v in BEDROCK_MODEL_ID DISCOVERY_AGENTCORE_ARN RCA_AGENTCORE_ARN; do
    [ -n "${!v:-}" ] && echo "$v=${!v}"
  done
  echo "F2F_ENV"
  tail -n +2 "$HERE/_userdata.sh"
} > "$UD"

ec2 run-instances \
  --image-id "$AMI" \
  --instance-type "$INSTANCE_TYPE" \
  --subnet-id "$SUBNET" \
  --security-group-ids "$SG" \
  --key-name "$KEY_NAME" \
  --iam-instance-profile Name="$INSTANCE_PROFILE" \
  --associate-public-ip-address \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3,DeleteOnTermination=true}' \
  --user-data "file://$UD" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=field-to-fix-console},{Key=app,Value=field-to-fix}]' \
  --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' \
  --query 'Instances[0].InstanceId' --output text
