#!/bin/sh
curl -s -o /dev/null -w "$1 %{http_code}\n" -X PUT -H "Content-Type: image/png" --data-binary @"$(dirname "$0")/../../../shared/images/zodiac/full/$1.png" "https://api.spritecook.ai/v1/uploads/mcp-assets/$2?token=$3"
