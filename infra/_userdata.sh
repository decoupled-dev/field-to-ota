#!/bin/bash
# EC2 user-data: install Docker, build the Field-to-Fix console image from source, run it on :8000.
set -xe
exec > /var/log/f2f-bootstrap.log 2>&1

dnf update -y
dnf install -y docker git
systemctl enable --now docker

cd /opt
rm -rf field-to-ota
git clone --depth 1 --branch feat/field-discovery https://github.com/decoupled-dev/field-to-ota.git
cd field-to-ota

# Build the console image (React build + FastAPI) using the repo Dockerfile.
docker build -t field-to-fix-console:latest -f Dockerfile .

# Run it, restart on reboot/crash. Bedrock/other integrations wired later via instance role + env.
# DISCOVERY_AUTOSTART=1 starts the Field Discovery Agent loop in-process; it crawls complaint
# sources for the configured OEM and opens cases through the signal pipeline.
docker rm -f f2f-console 2>/dev/null || true
docker run -d --name f2f-console --restart unless-stopped \
  -p 8000:8000 \
  -e AWS_REGION=us-east-1 \
  -e DISCOVERY_AUTOSTART=1 \
  -e DISCOVERY_OEM=Stellantis \
  -e DISCOVERY_MODELS="Jeep,Dodge,RAM,Chrysler,Uconnect" \
  -e DISCOVERY_INTERVAL=900 \
  field-to-fix-console:latest

echo "F2F_BOOTSTRAP_DONE"
