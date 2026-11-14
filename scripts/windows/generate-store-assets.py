"""Generate branded Windows Store package tile assets from the master logo."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "appx"
BACKGROUND = (16, 18, 22, 255)


def fit(image: Image.Image, box: tuple[int, int]) -> Image.Image:
    image = image.copy()
    image.thumbnail(box, Image.Resampling.LANCZOS)
    return image


def tile(size: int, mark: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    icon = fit(mark, (round(size * 0.72), round(size * 0.72)))
    canvas.alpha_composite(
        icon,
        ((size - icon.width) // 2, (size - icon.height) // 2),
    )
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    mark = Image.open(ROOT / "assets" / "brand" / "symbol-white.png").convert("RGBA")
    mark = mark.crop(mark.getbbox())

    for filename, size in (
        ("StoreLogo.png", 50),
        ("Square44x44Logo.png", 44),
        ("Square150x150Logo.png", 150),
    ):
        tile(size, mark).save(OUT / filename, optimize=True)

    wide = Image.new("RGBA", (310, 150), BACKGROUND)
    lockup = Image.open(
        ROOT / "assets" / "brand" / "lockup-horizontal-white.png"
    ).convert("RGBA")
    lockup = lockup.crop(lockup.getbbox())
    lockup = fit(lockup, (270, 108))
    wide.alpha_composite(
        lockup,
        ((wide.width - lockup.width) // 2, (wide.height - lockup.height) // 2),
    )
    wide.save(OUT / "Wide310x150Logo.png", optimize=True)


if __name__ == "__main__":
    main()
