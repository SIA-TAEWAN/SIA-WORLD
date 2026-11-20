import sys
from PIL import Image
out=sys.argv[1]; names=sys.argv[2:]
S=320
sheet=Image.new('RGB',(len(names)*S,S),(120,180,140))
for i,n in enumerate(names):
    im=Image.open(f'art/raw/{n}.png').convert('RGBA'); im.thumbnail((S,S)); sheet.paste(im,(i*S,0),im)
sheet.save(out)
