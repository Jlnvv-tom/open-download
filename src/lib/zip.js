import { generateFilename, sanitizeFilename } from './utils.js';

const textEncoder = new TextEncoder();

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function dateToDosTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

export function uniqueZipFilename(filename, usedNames) {
  const safeName = sanitizeFilename(filename || 'media');
  if (!usedNames.has(safeName)) {
    usedNames.add(safeName);
    return safeName;
  }

  const dotIndex = safeName.lastIndexOf('.');
  const base = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const ext = dotIndex > 0 ? safeName.slice(dotIndex) : '';
  let counter = 1;
  let candidate = `${base}-${counter}${ext}`;
  while (usedNames.has(candidate)) {
    counter++;
    candidate = `${base}-${counter}${ext}`;
  }
  usedNames.add(candidate);
  return candidate;
}

function makeLocalHeader(entry) {
  const header = new Uint8Array(30 + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 0x0800);
  writeUint16(view, 8, 0);
  writeUint16(view, 10, entry.dosTime);
  writeUint16(view, 12, entry.dosDate);
  writeUint32(view, 14, entry.crc);
  writeUint32(view, 18, entry.size);
  writeUint32(view, 22, entry.size);
  writeUint16(view, 26, entry.nameBytes.length);
  writeUint16(view, 28, 0);
  header.set(entry.nameBytes, 30);
  return header;
}

function makeCentralHeader(entry) {
  const header = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, 20);
  writeUint16(view, 6, 20);
  writeUint16(view, 8, 0x0800);
  writeUint16(view, 10, 0);
  writeUint16(view, 12, entry.dosTime);
  writeUint16(view, 14, entry.dosDate);
  writeUint32(view, 16, entry.crc);
  writeUint32(view, 20, entry.size);
  writeUint32(view, 24, entry.size);
  writeUint16(view, 28, entry.nameBytes.length);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, entry.offset);
  header.set(entry.nameBytes, 46);
  return header;
}

function makeEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, centralSize);
  writeUint32(view, 16, centralOffset);
  writeUint16(view, 20, 0);
  return header;
}

export async function createMediaZip(mediaItems, {
  fileNaming = 'original',
  fetchFn = fetch,
  now = new Date(),
} = {}) {
  if (!mediaItems.length) {
    throw new Error('没有可打包的资源');
  }

  const usedNames = new Set();
  const entries = [];
  const chunks = [];
  const errors = [];
  let offset = 0;

  for (let index = 0; index < mediaItems.length; index++) {
    const media = mediaItems[index];
    try {
      const response = await fetchFn(media.url);
      if (!response?.ok) {
        throw new Error(`HTTP ${response?.status || 0}`);
      }

      const data = new Uint8Array(await response.arrayBuffer());
      const filename = uniqueZipFilename(
        generateFilename(media.url, fileNaming, index, media.domain),
        usedNames
      );
      const nameBytes = textEncoder.encode(filename);
      const { dosTime, dosDate } = dateToDosTime(now);
      const entry = {
        name: filename,
        nameBytes,
        data,
        crc: crc32(data),
        size: data.byteLength,
        offset,
        dosTime,
        dosDate,
        media,
      };

      const localHeader = makeLocalHeader(entry);
      chunks.push(localHeader, data);
      offset += localHeader.byteLength + data.byteLength;
      entries.push(entry);
    } catch (error) {
      errors.push({
        media,
        error: error.message,
      });
    }
  }

  if (entries.length === 0) {
    throw new Error('所有资源打包失败');
  }

  const centralOffset = offset;
  const centralChunks = entries.map(entry => makeCentralHeader(entry));
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const end = makeEndOfCentralDirectory(entries.length, centralSize, centralOffset);

  const blob = new Blob([...chunks, ...centralChunks, end], { type: 'application/zip' });
  return {
    blob,
    entries,
    succeeded: entries.length,
    failed: errors.length,
    errors,
  };
}

export function makeZipFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
  return `open-download-${stamp}.zip`;
}
