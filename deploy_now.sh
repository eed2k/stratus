#!/bin/bash
cd /opt/stratus
docker compose build --no-cache stratus > /tmp/build.log 2>&1
echo "BUILD_EXIT=$?" >> /tmp/build.log
docker compose up -d --force-recreate stratus >> /tmp/build.log 2>&1
echo "UP_EXIT=$?" >> /tmp/build.log
echo "DONE_DEPLOY $(date)" >> /tmp/build.log
