#!/usr/bin/env bash
# Runs ON the EC2 instance (via ssh). Pulls latest master and rebuilds the console container.
set -e
cd /opt/field-to-ota
git fetch origin master
git reset --hard origin/master
echo "=== now at: $(git rev-parse --short HEAD) ==="
docker build -t field-to-fix-console:latest -f Dockerfile . >/tmp/build.log 2>&1 && echo "BUILD_OK" || { tail -15 /tmp/build.log; exit 1; }
docker rm -f f2f-console 2>/dev/null || true
docker run -d --name f2f-console --restart unless-stopped \
  -p 8000:8000 \
  -e AWS_REGION=us-east-1 \
  -e F2F_MODE=aws \
  -e DISCOVERY_AUTOSTART=1 \
  -e DISCOVERY_OEM=Stellantis \
  -e DISCOVERY_MODELS="Jeep,Dodge,RAM,Chrysler,Uconnect" \
  -e DISCOVERY_INTERVAL=900 \
  -e DISCOVERY_AGENTCORE_ARN="arn:aws:bedrock-agentcore:us-east-1:788953906715:harness/field_discovery_agent-khxNQ0iKW2" \
  -e RCA_AGENTCORE_ARN="arn:aws:bedrock-agentcore:us-east-1:788953906715:harness/harness_rca-I8ulwPsauK" \
  -e BEDROCK_MODEL_ID="us.amazon.nova-lite-v1:0" \
  field-to-fix-console:latest
echo "RUN_OK"
