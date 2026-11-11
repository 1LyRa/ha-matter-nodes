#!/bin/sh
echo "===================================================="
echo " Starting Matter Multi-Node Add-on for Home Assistant"
echo "===================================================="

# Ensure persistent storage directory exists
mkdir -p /data/matter

exec node /app/src/index.js
