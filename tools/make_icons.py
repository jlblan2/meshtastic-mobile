"""Draw the app icons: python tools/make_icons.py (needs Pillow)."""
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))


def make_icon(size, path):
    img = Image.new("RGBA", (size, size), (10, 25, 41, 255))
    d = ImageDraw.Draw(img)
    # three mesh nodes joined by links, inside the maskable safe zone
    r = size * 0.27
    cx, cy = size / 2, size * 0.53
    pts = [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))) for a in (-90, 30, 150)]
    w = max(3, size // 28)
    for i in range(3):
        d.line([pts[i], pts[(i + 1) % 3]], fill=(46, 196, 182, 255), width=w)
    dot = size * 0.085
    for i, (x, y) in enumerate(pts):
        fill = (255, 159, 28, 255) if i == 0 else (234, 242, 251, 255)
        d.ellipse([x - dot, y - dot, x + dot, y + dot], fill=fill, outline=(10, 25, 41, 255), width=max(2, size // 64))
    img.save(path)


os.makedirs(os.path.join(HERE, "..", "icons"), exist_ok=True)
for s in (192, 512):
    make_icon(s, os.path.join(HERE, "..", "icons", f"icon-{s}.png"))
print("done")
