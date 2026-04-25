import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const iconsDir = join(process.cwd(), "icons");
mkdirSync(iconsDir, { recursive: true });

function createCrcTable() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((value & 1) === 1) {
        value = 0xedb88320 ^ (value >>> 1);
      } else {
        value >>>= 1;
      }
    }
    table[index] = value >>> 0;
  }

  return table;
}

const crcTable = createCrcTable();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function setPixel(buffer, size, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }

  const rowStart = y * (size * 4 + 1);
  const pixelStart = rowStart + 1 + x * 4;
  buffer[pixelStart] = r;
  buffer[pixelStart + 1] = g;
  buffer[pixelStart + 2] = b;
  buffer[pixelStart + 3] = a;
}

function fillRect(buffer, size, startX, startY, width, height, color) {
  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      setPixel(buffer, size, x, y, color[0], color[1], color[2], color[3]);
    }
  }
}

function fillCircle(buffer, size, centerX, centerY, radius, color) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if ((dx * dx) + (dy * dy) <= radius * radius) {
        setPixel(buffer, size, x, y, color[0], color[1], color[2], color[3]);
      }
    }
  }
}

function strokeLine(buffer, size, x0, y0, x1, y1, thickness, color) {
  const deltaX = Math.abs(x1 - x0);
  const stepX = x0 < x1 ? 1 : -1;
  const deltaY = -Math.abs(y1 - y0);
  const stepY = y0 < y1 ? 1 : -1;
  let error = deltaX + deltaY;
  let currentX = x0;
  let currentY = y0;

  while (true) {
    fillCircle(buffer, size, currentX, currentY, thickness, color);
    if (currentX === x1 && currentY === y1) {
      break;
    }
    const doubled = error * 2;
    if (doubled >= deltaY) {
      error += deltaY;
      currentX += stepX;
    }
    if (doubled <= deltaX) {
      error += deltaX;
      currentY += stepY;
    }
  }
}

function createIcon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1), 0);

  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
  }

  const backgroundA = [11, 109, 114, 255];
  const backgroundB = [13, 143, 138, 255];
  const accent = [216, 95, 52, 255];
  const warm = [245, 239, 228, 255];
  const deep = [18, 33, 45, 255];

  for (let y = 0; y < size; y += 1) {
    const blend = y / Math.max(size - 1, 1);
    const color = [
      Math.round(backgroundA[0] + ((backgroundB[0] - backgroundA[0]) * blend)),
      Math.round(backgroundA[1] + ((backgroundB[1] - backgroundA[1]) * blend)),
      Math.round(backgroundA[2] + ((backgroundB[2] - backgroundA[2]) * blend)),
      255
    ];
    fillRect(raw, size, 0, y, size, 1, color);
  }

  fillCircle(raw, size, Math.round(size * 0.34), Math.round(size * 0.32), Math.round(size * 0.22), [255, 255, 255, 24]);
  fillCircle(raw, size, Math.round(size * 0.44), Math.round(size * 0.43), Math.round(size * 0.26), warm);
  fillCircle(raw, size, Math.round(size * 0.44), Math.round(size * 0.43), Math.round(size * 0.18), [255, 255, 255, 255]);
  strokeLine(
    raw,
    size,
    Math.round(size * 0.56),
    Math.round(size * 0.56),
    Math.round(size * 0.76),
    Math.round(size * 0.76),
    Math.max(1, Math.round(size * 0.05)),
    deep
  );
  strokeLine(
    raw,
    size,
    Math.round(size * 0.28),
    Math.round(size * 0.43),
    Math.round(size * 0.4),
    Math.round(size * 0.54),
    Math.max(1, Math.round(size * 0.035)),
    accent
  );
  strokeLine(
    raw,
    size,
    Math.round(size * 0.4),
    Math.round(size * 0.54),
    Math.round(size * 0.61),
    Math.round(size * 0.3),
    Math.max(1, Math.round(size * 0.035)),
    accent
  );

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

for (const size of [16, 48, 128]) {
  writeFileSync(join(iconsDir, `${size}.png`), createIcon(size));
}
