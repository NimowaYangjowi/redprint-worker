#!/usr/bin/env node
'use strict';

// 메뉴바 상태 아이콘을 Tauri용 정적 PNG 파일로 생성한다.

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makePng(pixels, size = 18) {
  const raw = Buffer.allocUnsafe(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crcBuf]);
  }

  const ihdr = Buffer.from([0,0,0,size>>8 & 0xff, 0,0,0,size & 0xff, 8,6,0,0,0]);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIconPng(drawFn, size = 18) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (drawFn(x, y, size)) {
        const i = (y * size + x) * 4;
        buf[i] = 0; buf[i+1] = 0; buf[i+2] = 0; buf[i+3] = 255;
      }
    }
  }
  return makePng(buf, size);
}

const outDir = path.join(__dirname, 'src-tauri', 'icons');

// idle: 가는 원
const idle = makeIconPng((x, y, s) => {
  const cx = s / 2 - 0.5, cy = s / 2 - 0.5, r = s / 2 - 2.5;
  const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  return d >= r - 1.2 && d <= r + 0.3;
});
fs.writeFileSync(path.join(outDir, 'tray-idle.png'), idle);

// active: 채운 원
const active = makeIconPng((x, y, s) => {
  const cx = s / 2 - 0.5, cy = s / 2 - 0.5, r = s / 2 - 2.5;
  return Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) <= r + 0.3;
});
fs.writeFileSync(path.join(outDir, 'tray-active.png'), active);

// stopped: 채운 사각형
const stopped = makeIconPng((x, y, s) => {
  return x >= 4 && x <= s - 5 && y >= 4 && y <= s - 5;
});
fs.writeFileSync(path.join(outDir, 'tray-stopped.png'), stopped);

// app icon (32x32 placeholder — 큰 채운 원)
const appIcon = makeIconPng((x, y, s) => {
  const cx = s / 2 - 0.5, cy = s / 2 - 0.5, r = s / 2 - 2;
  return Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) <= r;
}, 32);
fs.writeFileSync(path.join(outDir, 'icon.png'), appIcon);

console.log('Generated tray icons:', fs.readdirSync(outDir).filter(f => f.endsWith('.png')));
