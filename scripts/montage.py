import sys, glob
from PIL import Image
pat, out, cols = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 6
files = sorted(glob.glob(pat))
ims = [Image.open(f) for f in files]
w = 300; hs = [int(im.height * w / im.width) for im in ims]; hmax = max(hs)
rows = (len(ims) + cols - 1) // cols
M = Image.new('RGB', (cols * (w + 8), rows * (hmax + 8)), (40, 40, 40))
for i, im in enumerate(ims):
    M.paste(im.convert('RGB').resize((w, hs[i])), ((i % cols) * (w + 8), (i // cols) * (hmax + 8)))
M.save(out); print(out, len(ims), [f[-40:] for f in files])
