#!/bin/sh
# 쓰는 법: sh art/get.sh <이름> <asset_id> <sprite_url>  → art/raw/<이름>.png 저장 + art/ids.tsv 에 기록
d=$(dirname "$0")
curl -s -o "$d/raw/$1.png" "$3" && grep -v "^$1	" "$d/ids.tsv" 2>/dev/null > "$d/ids.tmp"; printf '%s\t%s\n' "$1" "$2" >> "$d/ids.tmp"; mv "$d/ids.tmp" "$d/ids.tsv"
