import { copyFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const sourceIconsDir = join(process.cwd(), "chrome-extension-icons");
const iconsDir = join(process.cwd(), "icons");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft;
  const leftDistance = Math.abs(p - left);
  const upDistance = Math.abs(p - up);
  const upLeftDistance = Math.abs(p - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }

  if (upDistance <= upLeftDistance) {
    return up;
  }

  return upLeft;
}

function decodePng(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.length < pngSignature.length || !buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`Unsupported PNG signature in ${filePath}`);
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let compression = 0;
  let filter = 0;
  let interlace = 0;
  const idatParts = [];

  let offset = pngSignature.length;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;

    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    offset += 4;

    const data = buffer.subarray(offset, offset + length);
    offset += length;

    offset += 4;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      compression = data[10];
      filter = data[11];
      interlace = data[12];
    } else if (type === "IDAT") {
      idatParts.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PNG dimensions in ${filePath}`);
  }

  if (bitDepth !== 8 || colorType !== 6 || compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error(`Unsupported PNG format in ${filePath}`);
  }

  const inflated = inflateSync(Buffer.concat(idatParts));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const expectedLength = height * (stride + 1);

  if (inflated.length !== expectedLength) {
    throw new Error(`Unexpected PNG payload size in ${filePath}`);
  }

  const rgba = Buffer.alloc(width * height * bytesPerPixel);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[sourceOffset];
    sourceOffset += 1;

    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset];
      sourceOffset += 1;

      const left = x >= bytesPerPixel ? rgba[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? rgba[rowStart - stride + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? rgba[rowStart - stride + x - bytesPerPixel] : 0;

      let recon = raw;
      if (filterType === 1) {
        recon = (raw + left) & 0xff;
      } else if (filterType === 2) {
        recon = (raw + up) & 0xff;
      } else if (filterType === 3) {
        recon = (raw + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        recon = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      } else if (filterType !== 0) {
        throw new Error(`Unsupported PNG filter type ${filterType} in ${filePath}`);
      }

      rgba[rowStart + x] = recon;
    }
  }

  return { width, height, rgba };
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1));

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    const pixelStart = y * width * 4;
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, pixelStart, pixelStart + width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    pngSignature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function toGray(rgba) {
  const gray = Buffer.from(rgba);

  for (let index = 0; index < gray.length; index += 4) {
    const value = Math.round((gray[index] * 0.299) + (gray[index + 1] * 0.587) + (gray[index + 2] * 0.114));
    gray[index] = value;
    gray[index + 1] = value;
    gray[index + 2] = value;
  }

  return gray;
}

function getSourceIcons() {
  return readdirSync(sourceIconsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .map((name) => name.match(/^(\d+)\.png$/))
    .filter((match) => match !== null)
    .map((match) => ({
      size: Number.parseInt(match[1], 10),
      fileName: `${match[1]}.png`
    }))
    .sort((left, right) => left.size - right.size);
}

for (const entry of readdirSync(iconsDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".png")) {
    unlinkSync(join(iconsDir, entry.name));
  }
}

for (const icon of getSourceIcons()) {
  const sourcePath = join(sourceIconsDir, icon.fileName);
  const colorTargetPath = join(iconsDir, icon.fileName);
  const grayTargetPath = join(iconsDir, `${icon.size}-gray.png`);

  copyFileSync(sourcePath, colorTargetPath);
  const decoded = decodePng(sourcePath);
  writeFileSync(grayTargetPath, encodePng(decoded.width, decoded.height, toGray(decoded.rgba)));
}
