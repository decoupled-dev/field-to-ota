#!/usr/bin/env bash
# Runs ON the EC2 instance (via ssh). Pulls latest master and rebuilds the console container.
set -e
cd /opt/field-to-ota
git fetch origin master
git reset --hard origin/master
echo "=== now at: $(git rev-parse --short HEAD) ==="
docker build -t field-to-fix-console:latest -f Dockerfile . >/tmp/build.log 2>&1 && echo "BUILD_OK" || { tail -15 /tmp/build.log; exit 1; }
docker rm -f f2f-console 2>/dev/null || true
# Settings live in /etc/f2f.env (written at launch by _launch.sh); edit it there to change region/ARNs.
docker run -d --name f2f-console --restart unless-stopped \
  -p 8000:8000 --env-file /etc/f2f.env \
  field-to-fix-console:latest
echo "RUN_OK"
