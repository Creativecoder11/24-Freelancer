#!/usr/bin/env bash
# Show the latest one-time codes printed by the dev OTP driver.
grep -aoE '\[(sms|email)\] → [^ ]+ \([a-z_]+\): [0-9]{6}' /tmp/fl-api.log | tail -${1:-3}
