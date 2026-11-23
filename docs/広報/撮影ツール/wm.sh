# usage: wm.sh in out   (image or frames dir -> mp4)
WM="scale=trunc(iw/2)*2:trunc(ih/2)*2,drawtext=fontfile='C\:/Windows/Fonts/arialbd.ttf':text='@MiniHakoniwa':fontcolor=white@0.85:fontsize=30:borderw=2:bordercolor=black@0.35:x=w-tw-28:y=h-th-24"
if [ -d "$1" ]; then ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$1/f%05d.jpg" -vf "$WM" -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart "$2"
else ffmpeg -hide_banner -loglevel error -y -i "$1" -vf "$WM" "$2"; fi
