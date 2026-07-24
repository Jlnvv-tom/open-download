#!/usr/bin/env python3
"""Generate PNG icons for the Chrome extension."""
import struct
import zlib
import os

def create_png(width, height, pixels):
    """Create a minimal PNG file from RGBA pixel data."""
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = zlib.crc32(c) & 0xffffffff
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # RGBA

    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter type: none
        for x in range(width):
            idx = (y * width + x) * 4
            raw += bytes(pixels[idx:idx+4])

    idat = zlib.compress(raw)

    return header + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

def draw_icon(size):
    """Draw a download icon with blue background."""
    pixels = []
    cx, cy = size / 2.0, size / 2.0

    for y in range(size):
        for x in range(size):
            r = size * 0.15  # corner radius
            in_rect = True
            if x < r and y < r:
                in_rect = (r - x) ** 2 + (r - y) ** 2 <= r * r
            elif x >= size - r and y < r:
                in_rect = (size - r - 1 - x + r) ** 2 + (r - y) ** 2 <= r * r
            elif x < r and y >= size - r:
                in_rect = (r - x) ** 2 + (size - r - 1 - y + r) ** 2 <= r * r
            elif x >= size - r and y >= size - r:
                in_rect = (size - r - 1 - x + r) ** 2 + (size - r - 1 - y + r) ** 2 <= r * r

            if not in_rect:
                pixels.extend([0, 0, 0, 0])
                continue

            # Draw download arrow
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

            if in_vert or in_base or in_tray:
                pixels.extend([255, 255, 255, 255])
            else:
                pixels.extend([59, 130, 246, 255])

    return pixels

os.makedirs('assets', exist_ok=True)

for size in [16, 48, 128]:
    px = draw_icon(size)
    png_data = create_png(size, size, px)
    path = f'assets/icon-{size}.png'
    with open(path, 'wb') as f:
        f.write(png_data)
    print(f'Generated {path} ({len(png_data)} bytes)')
