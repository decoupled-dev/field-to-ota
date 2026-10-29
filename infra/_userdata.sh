#!/bin/bash
# EC2 user-data: install Docker, build the Field-to-Fix console image from source, run it on :8000.
set -xe
exec > /var/log/f2f-bootstrap.log 2>&1

dnf update -y
dnf install -y docker git
systemctl enable --now docker

cd /opt
rm -rf field-to-ota
git clone --depth 1 --branch master https://github.com/decoupled-dev/field-to-ota.git
cd field-to-ota

# Build the console image (React build + FastAPI) using the repo Dockerfile.
docker build -t field-to-fix-console:latest -f Dockerfile .

# App settings come from /etc/f2f.env, which _launch.sh writes ahead of this script. Launched some
# other way, fall back to the instance's own region with simulated integrations.
# DISCOVERY_AUTOSTART=1 starts the Field Discovery Agent loop in-process; it crawls complaint
# sources for the configured OEM and opens cases through the signal pipeline.
if [ ! -f /etc/f2f.env ]; then
  TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
  printf 'AWS_REGION=%s\nF2F_MODE=aws\nDISCOVERY_AUTOSTART=1\n' "$REGION" > /etc/f2f.env
fi

# Run it, restart on reboot/crash.
docker rm -f f2f-console 2>/dev/null || true
docker run -d --name f2f-console --restart unless-stopped \
  -p 8000:8000 --env-file /etc/f2f.env \
  field-to-fix-console:latest

echo "F2F_BOOTSTRAP_DONE"
