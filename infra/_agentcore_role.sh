#!/usr/bin/env bash
# Create the console instance role (AgentCore invoke + Bedrock) and instance profile; optionally attach it.
#   infra/_agentcore_role.sh [instance-id]     # AWS_REGION, ROLE, PROFILE overridable via env
set -e
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || echo ap-southeast-2)}"
ROLE="${ROLE:-f2f-console-agentcore-role}"
PROFILE="${PROFILE:-f2f-console-agentcore-profile}"
INSTANCE="${1:-${INSTANCE:-}}"

TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
PERMS='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["bedrock-agentcore:InvokeHarness","bedrock-agentcore:InvokeAgentRuntime","bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream","bedrock:Converse","bedrock:ConverseStream"],"Resource":"*"}]}'

echo "=== create role ==="
aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" --query 'Role.Arn' --output text 2>&1 || echo "(role may exist)"
aws iam put-role-policy --role-name "$ROLE" --policy-name f2f-agentcore --policy-document "$PERMS" 2>&1 || true

echo "=== create instance profile + add role ==="
aws iam create-instance-profile --instance-profile-name "$PROFILE" 2>&1 || echo "(profile may exist)"
aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE" --role-name "$ROLE" 2>&1 || echo "(role may already be in profile)"
sleep 10  # allow the profile to propagate

if [ -n "$INSTANCE" ]; then
  echo "=== associate with $INSTANCE ($REGION) ==="
  aws ec2 associate-iam-instance-profile --region "$REGION" --instance-id "$INSTANCE" \
    --iam-instance-profile Name="$PROFILE" --query 'IamInstanceProfileAssociation.State' --output text 2>&1 || echo "(may already be associated)"
fi

echo "DONE"
