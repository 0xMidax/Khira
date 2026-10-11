#!/bin/sh
# Runs Khira's scheduled jobs (the same ones vercel.json runs on Vercel).
# busybox crond doesn't pass environment variables to jobs, so the secret is written into the crontab here.
set -eu
: "${CRON_SECRET:?CRON_SECRET must be set}"
APP_URL="${APP_URL:-http://app:3000}"
job() { echo "$1 curl -fsS -m 300 -H 'Authorization: Bearer ${CRON_SECRET}' ${APP_URL}/api/cron/$2 >/dev/null"; }
{
  job "*/15 * * * *" frequent
  job "0 7 * * 1-5" daily
  job "0 9 * * 1-5" standup
  job "30 2 * * *" backup
} > /etc/crontabs/root
chmod 600 /etc/crontabs/root
echo "Khira scheduler running (times are UTC) against ${APP_URL}"
exec crond -f -l 6
