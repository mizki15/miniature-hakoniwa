# replace frames whose height != 1080 with the previous good frame
d=$1; prev=""; n=0
for f in $(ls $d/*.jpg); do h=$(ffprobe -v error -show_entries stream=height -of csv=p=0 "$f"); if [ "$h" != "1080" ]; then n=$((n+1)); if [ -n "$prev" ]; then cp "$prev" "$f"; fi; else prev="$f"; fi; done; echo "$d fixed $n"
