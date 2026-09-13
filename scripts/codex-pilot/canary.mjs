import { deflateSync } from 'node:zlib';
// A generated, synthetic PNG with a unique metadata canary. It contains no
// file uploaded by a user and is never saved to disk by the pilot.
export function canaryPng(marker) {
  function crc(buffer) { let c = 0xffffffff; for (const byte of buffer) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
  function chunk(type, data) { const t = Buffer.from(type), length = Buffer.alloc(4), sum = Buffer.alloc(4); length.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([length, t, data, sum]); }
  const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(32 * 97, 255); for (let i = 0; i < 32; i++) raw[i * 97] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('tEXt', Buffer.from(`Comment\0${marker}`)), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
