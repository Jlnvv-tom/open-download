#!/usr/bin/env python3
"""Generate the Chrome extension toolbar icons (16/48/128).

Preferred source: src/assets/icons/download.png, produced by
scripts/fetch-3dicons.py from 3dicons V1 (CC0). If Pillow or that source is
missing, fall back to the dependency-free blue download glyph below.
"""
import os
import struct
import zlib

SIZES = [16, 48, 128]
SOURCE = os.path.join('src', 'assets', 'icons', 'download.png')


def create_png(width, height, pixels):
    """Create a minimal PNG file from RGBA pixel data."""
    def chunk(chunk_type, data):
        payload = chunk_type + data
        crc = zlib.crc32(payload) & 0xffffffff
        return struct.pack('>I', len(data)) + payload + struct.pack('>I', crc)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # RGBA

    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter type: none
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(pixels[idx:idx + 4])

    return header + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def draw_icon(size):
    """Draw a download icon with blue background (fallback only)."""
    pixels = []
    cx, cy = size / 2.0, size / 2.0

    for y in range(size):
        for x in range(size):
            r = size * 0.15
            in_rect = True
            if x < r and y < r:
                in_rect = (r - x) ** 2 + (r - y) ** 2 <= r * r
            elif x >= size - r and y < r:
                in_rect = (size - r - 1 - x + r) ** 2 + (r - y) ** 2 <= r * r
            elif x < r and y >= size - r:
                in_rect = (r - x) ** 2 + (size - r - 1 - y + r) ** 2 <= r * r
            elif x >= size - r and y >= size - r:
                in_rect = (r - x) ** 2 + (size - r - 1 - y + r) ** 2 <= r * r

            if not in_rect:
                pixels.extend([0, 0, 0, 0])
                continue

            arrow_w = size * 0.12
            arrow_h = size * 0.35
            arrow_top = size * 0.2
            in_vert = (cx - arrow_w / 2 <= x <= cx + arrow_w / 2) and (arrow_top <= y <= arrow_top + arrow_h)
            base_w = size * 0.4
            base_y = arrow_top + arrow_h
            base_h = size * 0.1
            in_base = (cx - base_w / 2 <= x <= cx + base_w / 2) and (base_y <= y <= base_y + base_h)
            tray_w = size * 0.55
            tray_y = size * 0.72
            tray_h = size * 0.08
            in_tray = (cx - tray_w / 2 <= x <= cx + tray_w / 2) and (tray_y <= y <= tray_y + tray_h)

            pixels.extend([255, 255, 255, 255] if (in_vert or in_base or in_tray) else [59, 130, 246, 255])

    return pixels


def draw_from_3dicons(size, path):
    """Render a 3dicons PNG at the requested size with a small transparent margin."""
    from PIL import Image

    image = Image.open(SOURCE).convert('RGBA')
    bbox = image.getchannel('A').getbbox()
    if bbox:
        image = image.crop(bbox)
    width, height = image.size
    side = max(width, height)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(image, ((side - width) // 2, (side - height) // 2))

    inner = max(1, int(size * 0.94))
    icon = square.resize((inner, inner), Image.LANCZOS)
    if size <= 16:
        # 3D 材质缩到 16px 会发灰，轻度锐化让轮廓在工具栏上更可辨
        from PIL import ImageFilter
        icon = icon.filter(ImageFilter.UnsharpMask(radius=1, percent=180, threshold=2))
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(icon, ((size - inner) // 2, (size - inner) // 2))
    canvas.save(path, optimize=True)


os.makedirs('src/assets', exist_ok=True)
use_source = os.path.isfile(SOURCE)

for size in SIZES:
    path = f'src/assets/icon-{size}.png'
    if use_source:
        try:
            draw_from_3dicons(size, path)
            print(f'Generated {path} from 3dicons source ({os.path.getsize(path)} bytes)')
            continue
        except Exception as error:
            print(f'3dicons source failed ({error}); falling back to built-in glyph')
            use_source = False

    png_data = create_png(size, size, draw_icon(size))
    with open(path, 'wb') as handle:
        handle.write(png_data)
    print(f'Generated {path} (fallback, {len(png_data)} bytes)')
