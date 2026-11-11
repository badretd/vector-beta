"""Regenerate the application icons from the original 12x12 Vector sprite.

The source is ``examples/Happy.png`` — the exact 12x12 smile frame shown in the
README.  Only two colours are used: a black background and white sprite pixels.
Each icon size is scaled by a whole-number factor so the pixels stay crisp.

Run from the repository root:

    python packaging/make_icons.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SPRITE_PATH = REPO_ROOT / "examples" / "Happy.png"
OUT = Path(__file__).resolve().parent / "icons"

BLACK = (0, 0, 0)
WHITE = (255, 255, 255)

# The sprite occupies 75% of the canvas, leaving a calm 12.5% margin on each
# side.  These sizes divide evenly, so every icon uses integer-scaled pixels.
COVERAGE = 0.75
ICO_SIZES = (16, 32, 48, 64, 128, 256)
ICNS_SIZES = (32, 64, 128, 256, 512, 1024)
PNG_SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)


def load_sprite() -> Image.Image:
    sprite = Image.open(SPRITE_PATH).convert("RGBA")
    if sprite.size != (12, 12):
        raise ValueError(f"expected a 12x12 sprite, got {sprite.size}: {SPRITE_PATH}")
    return sprite


def render(size: int, sprite: Image.Image) -> Image.Image:
    """Draw the sprite, nearest-neighbour scaled, centred on a black square."""
    scale = max(1, int(size * COVERAGE) // sprite.width)
    art = sprite.resize(
        (sprite.width * scale, sprite.height * scale),
        Image.Resampling.NEAREST,
    )
    mask = art.getchannel("A").point(lambda alpha: 255 if alpha > 127 else 0)

    canvas = Image.new("RGB", (size, size), BLACK)
    offset = ((size - art.width) // 2, (size - art.height) // 2)
    canvas.paste(Image.new("RGB", art.size, WHITE), offset, mask)
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sprite = load_sprite()
    images = {size: render(size, sprite) for size in PNG_SIZES}

    images[1024].save(OUT / "vector.png")
    for size, image in images.items():
        image.save(OUT / f"vector-{size}.png")

    images[256].save(
        OUT / "vector.ico",
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
        append_images=[images[size] for size in ICO_SIZES],
    )
    images[1024].save(
        OUT / "vector.icns",
        format="ICNS",
        append_images=[images[size] for size in ICNS_SIZES],
    )
    print(f"Wrote black-and-white 12x12 icons to {OUT}")


if __name__ == "__main__":
    main()
