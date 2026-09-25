"""Regenerate the figure embedded in `sample.ipynb`.

The fixture originally carried a 1x1 pixel, which made an image output render as an
invisible speck and hid a real styling bug behind "the figure looks wrong". This
draws a small matplotlib-shaped plot instead, so an image output is verifiable at a
glance, and writes it next to this script as `sample-figure.png`.

The canvas is deliberately wider than a preview pane, so the "show actual size"
control has something to reveal. That makes the **font size a real concern**: Pillow's
`draw.text` without a `font` uses a fixed-size bitmap face (~11 px), which on an
1800 px canvas made the labels look tiny — a fixture defect that read as a plugin
defect. A TrueType face is therefore loaded at a size proportional to the canvas.

Run it, then re-embed the bytes into the notebook fixtures:

    python test/fixtures/make-sample-figure.py            # prints the byte count

The fixture stores the image inline as `display_data` base64, exactly as a real
notebook does, so the PNG file itself is only a reference copy.
"""
from __future__ import annotations

import base64
import io
import pathlib

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1800, 1000
LEFT, TOP, RIGHT, BOTTOM = 190, 96, WIDTH - 60, HEIGHT - 130
AXIS = (170, 176, 186)
GRID = (232, 235, 240)
CURVE = (31, 119, 180)
INK = (70, 74, 82)
# Proportional to the canvas, not a fixed bitmap size.
TITLE_PX, LABEL_PX, TICK_PX = 38, 36, 28


def load_font(size: int):
    """A TrueType face at `size`, falling back to Pillow's scalable default.

    The fallback chain matters: the bitmap default this used to get silently renders
    ~11 px whatever the canvas is, which is what made the labels look tiny.
    """
    for name in ("arial.ttf", "segoeui.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            font = ImageFont.truetype(name, size)
            print(f"font: {name} at {size}px")
            return font
        except OSError:
            continue
    try:
        font = ImageFont.load_default(size=size)
        print(f"font: Pillow default at {size}px")
        return font
    except TypeError:
        print("font: Pillow bitmap default (scalable default unavailable)")
        return ImageFont.load_default()


def build() -> bytes:
    image = Image.new("RGB", (WIDTH, HEIGHT), "white")
    draw = ImageDraw.Draw(image)
    title = load_font(TITLE_PX)
    label = load_font(LABEL_PX)
    tick = load_font(TICK_PX)

    draw.rectangle([LEFT, TOP, RIGHT, BOTTOM], outline=AXIS)
    for step in range(1, 5):
        y = TOP + (BOTTOM - TOP) * step // 5
        draw.line([LEFT, y, RIGHT, y], fill=GRID)
        draw.text((LEFT - 90, y - TICK_PX // 2), str(step), fill=INK, font=tick)

    points = []
    for index in range(201):
        fraction = index / 200
        x = LEFT + (RIGHT - LEFT) * fraction
        y = BOTTOM - (BOTTOM - TOP) * (0.12 + 0.8 * fraction ** 2)
        points.append((x, y))
    draw.line(points, fill=CURVE, width=4)
    for index in range(0, 201, 25):
        x, y = points[index]
        draw.ellipse([x - 8, y - 8, x + 8, y + 8], fill=CURVE)

    # Tick labels along x, so the figure carries text at the size a real plot would.
    for index, value in enumerate(range(0, 101, 20)):
        x = LEFT + (RIGHT - LEFT) * index / 5
        draw.text((x - 30, BOTTOM + 18), str(value), fill=INK, font=tick)

    draw.text((LEFT, 30), "demo figure — 1800x1000, wider than the pane", fill=INK, font=title)
    draw.text(((LEFT + RIGHT) // 2 - 12, HEIGHT - 60), "x", fill=INK, font=label)
    draw.text((40, (TOP + BOTTOM) // 2), "y", fill=INK, font=label)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def main() -> None:
    payload = build()
    target = pathlib.Path(__file__).with_name("sample-figure.png")
    target.write_bytes(payload)
    print(f"wrote {target.name}: {len(payload)} bytes")
    print(base64.b64encode(payload).decode())


if __name__ == "__main__":
    main()
