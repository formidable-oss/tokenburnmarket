/**
 * Renders the tokenburnmarket pixel mark (apps/web/public/logo.svg) to PNG/ICO.
 * Run from the repo root: `node apps/web/scripts/generate-brand-assets.mjs`.
 * Dependency-free: hand-rolled nearest-neighbour raster + PNG/ICO encoders, so the
 * integer pixel grid stays crisp at every size.
 */
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const YELLOW = [0xff,0xd9,0x00,255];
const EMBER  = [0xc4,0x1e,0x3a,255];
const RAIL   = [0x84,0x84,0x8c,255];  // #f0f0f5 at 55% over the #050510 canvas
const CANVAS = [0x05,0x05,0x10,255];
const NONE   = [0,0,0,0];

const BARS = { 2:3, 3:5, 4:9, 5:6, 6:4 };  // column -> bar height, baseline at y=9

/** 11x11 mark from logo.svg; `bg` fills every empty cell. */
function grid(bg) {
  const g = Array.from({length:11}, () => Array.from({length:11}, () => bg));
  for (let y=0;y<=3;y++) g[y][0] = RAIL;
  for (let x=0;x<=3;x++) g[0][x] = RAIL;
  for (let y=7;y<=10;y++) g[y][10] = RAIL;
  for (let x=7;x<=10;x++) g[10][x] = RAIL;
  for (const [xs,h] of Object.entries(BARS)) {
    const x = Number(xs);
    for (let i=0;i<h;i++) {
      const y = 9-i;
      g[y][x] = (x===4 && y===1) ? EMBER : YELLOW;
    }
  }
  return g;
}

let T=null;
function crc32(buf){
  if(!T){T=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;T[n]=c;}}
  let c=-1; for(let i=0;i<buf.length;i++) c=T[(c^buf[i])&0xff]^(c>>>8); return (c^-1)>>>0;
}
function chunk(type,data){
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td=Buffer.concat([Buffer.from(type,"ascii"),data]);
  const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len,td,crc]);
}
/** Nearest-neighbour raster of a `cells`-wide grid (grid + `pad` margin cells) at `size` px. */
function png(g, size, pad, bg) {
  const cells = 11 + pad*2;
  const raw = Buffer.alloc((size*4+1)*size);
  let p=0;
  for(let py=0;py<size;py++){
    raw[p++]=0;
    for(let px=0;px<size;px++){
      const gx = Math.floor(px*cells/size)-pad;
      const gy = Math.floor(py*cells/size)-pad;
      const c = (gx>=0&&gx<11&&gy>=0&&gy<11) ? g[gy][gx] : bg;
      raw[p++]=c[0]; raw[p++]=c[1]; raw[p++]=c[2]; raw[p++]=c[3];
    }
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4);
  ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
    chunk("IHDR",ihdr), chunk("IDAT",zlib.deflateSync(raw,{level:9})), chunk("IEND",Buffer.alloc(0)),
  ]);
}

const dark = grid(CANVAS);
const clear = grid(NONE);
const out = "apps/web/public/brand";
mkdirSync(out,{recursive:true});

const files = [
  ["logo-1024.png",        1024, clear, 0, NONE],
  ["logo-on-dark-1024.png",1024, dark,  1, CANVAS],
  ["icon-512.png",          512, dark,  0, CANVAS],
  ["icon-256.png",          256, dark,  0, CANVAS],
  ["icon-192.png",          192, dark,  0, CANVAS],
  ["apple-touch-icon-180.png",180,dark, 1, CANVAS],
  ["favicon-64.png",         64, dark,  0, CANVAS],
  ["favicon-32.png",         32, dark,  0, CANVAS],
];
for (const [name,size,g,pad,bg] of files) {
  writeFileSync(`${out}/${name}`, png(g,size,pad,bg));
  console.log(name, size);
}

// --- favicons the browser can find without any metadata: /favicon.ico and /favicon.png ---
const pub = "apps/web/public";
/** ICO container holding PNG-encoded entries (supported by every browser since IE11). */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = [], blobs = [];
  for (const [size, data] of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length; dir.push(e); blobs.push(data);
  }
  return Buffer.concat([header, ...dir, ...blobs]);
}

/** Small sizes drop the corner rails (they turn to mush under 48px) and centre the bars. */
function smallGrid() {
  const g = Array.from({length:11}, () => Array.from({length:11}, () => CANVAS));
  for (const [xs,h] of Object.entries(BARS)) {
    const x = Number(xs) + 1;
    for (let i=0;i<h;i++) {
      const y = 9-i;
      g[y][x] = (x===5 && y===1) ? EMBER : YELLOW;
    }
  }
  return g;
}
const small = smallGrid();
writeFileSync(`${pub}/favicon.png`, png(small, 48, 0, CANVAS));
writeFileSync(`${pub}/favicon-16.png`, png(small, 16, 0, CANVAS));
writeFileSync(`${out}/favicon-32.png`, png(small, 32, 0, CANVAS));
writeFileSync(`${pub}/favicon.ico`, ico([16, 32, 48].map((s) => [s, png(small, s, 0, CANVAS)])));
console.log("favicon.ico / favicon.png / favicon-16.png");
