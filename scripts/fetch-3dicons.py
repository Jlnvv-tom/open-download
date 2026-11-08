#!/usr/bin/env python3
"""下载 3dicons V1（CC0）高分辨率 3D 图标，规范化为项目使用的透明 PNG。

来源：https://3dicons.co/  ·  V1 为 CC0，可商用、无需署名。
镜像：https://github.com/LanzeG/3D-ICONS  （ICONS HERE!/<dir>/<name>-dynamic-<style>.png）
原图约 2400x2400，这里按 alpha 包围盒裁切、居中补正方形、缩放到 256x256。

用法：
    python3 scripts/fetch-3dicons.py [--style color|clay|gradient|premium] [--out src/assets/icons]
"""

import argparse
import io
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

from PIL import Image

RAW = 'https://raw.githubusercontent.com/LanzeG/3D-ICONS/main/'
SIZE = 256

# 项目语义名 -> (仓库目录, 文件名前缀)
ICONS = {
    # 大尺寸展示位
    'download': ('folder', 'folder'),
    'image': ('picture', 'picture'),
    'play-square': ('play', 'play'),
    'radar': ('target', 'target'),
    'plan': ('file', 'file'),
    'result': ('tick', 'tick'),
}


def source_url(directory, stem, style):
    path = f'ICONS HERE!/{directory}/{stem}-dynamic-{style}.png'
    return RAW + quote(path, safe='/')


def fetch(url):
    request = Request(url, headers={'User-Agent': 'open-download-icon-fetch/1.0'})
    with urlopen(request, timeout=60) as response:
        return response.read()


def normalize(data):
    image = Image.open(io.BytesIO(data)).convert('RGBA')
    bbox = image.getchannel('A').getbbox()
    if bbox:
        image = image.crop(bbox)
    width, height = image.size
    side = max(width, height)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(image, ((side - width) // 2, (side - height) // 2))
    return square.resize((SIZE, SIZE), Image.LANCZOS), (width, height)


def build_preview(outdir, names, background):
    cell = 110
    preview = Image.new('RGBA', (len(names) * cell, cell), background)
    for index, name in enumerate(names):
        path = outdir / f'{name}.png'
        if not path.exists():
            continue
        icon = Image.open(path).convert('RGBA').resize((96, 96), Image.LANCZOS)
        preview.alpha_composite(icon, (index * cell + 7, 7))
    suffix = 'dark' if sum(background[:3]) < 300 else 'light'
    preview.convert('RGB').save(Path(__file__).parent / f'_3dicons-preview-{suffix}.png')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--style', default='color', choices=['color', 'clay', 'gradient', 'premium'])
    parser.add_argument('--out', default='src/assets/icons')
    args = parser.parse_args()

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    for name, (directory, stem) in ICONS.items():
        url = source_url(directory, stem, args.style)
        data = fetch(url)
        icon, original = normalize(data)
        icon.save(outdir / f'{name}.png', optimize=True)
        print(f'{name:14s} {original[0]}x{original[1]} -> {SIZE}x{SIZE}  ({len(data) // 1024} KB source)')

    names = list(ICONS)
    build_preview(outdir, names, (245, 247, 250, 255))
    build_preview(outdir, names, (26, 27, 38, 255))
    print(f'Wrote {len(names)} icons to {outdir} (style={args.style})')


if __name__ == '__main__':
    main()
