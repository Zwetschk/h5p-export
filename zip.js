/**
 * zip.js – minimaler ZIP-Leser/-Schreiber für den Browser (ohne externe Pakete).
 * Entspricht tools/h5p-check.js (Lesen) und tools/h5p-coreapi-patch.js (Schreiben).
 * Nutzt DecompressionStream/CompressionStream ("deflate-raw") des Browsers.
 *
 * ZipReader:  const z = await ZipReader.open(arrayBuffer); z.names(); await z.bytes(name); await z.text(name)
 * ZipWriter:  const w = new ZipWriter(); await w.add(name, bytes); const blob = w.finish();
 */
(function (root) {
  'use strict';

  const utf8 = new TextDecoder('utf-8');
  const enc = new TextEncoder();

  async function streamThrough(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const inflateRaw = (b) => streamThrough(b, new DecompressionStream('deflate-raw'));
  const deflateRaw = (b) => streamThrough(b, new CompressionStream('deflate-raw'));

  class ZipReader {
    constructor(buf, entries) { this.buf = buf; this.entries = entries; }

    static async open(arrayBuffer) {
      const buf = new Uint8Array(arrayBuffer);
      const dv = new DataView(arrayBuffer);
      let eocd = -1;
      for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) throw new Error('Keine gültige ZIP-Datei. Ist die Datei wirklich eine .h5p-Datei?');
      const count = dv.getUint16(eocd + 10, true);
      let offset = dv.getUint32(eocd + 16, true);
      if (count === 0xffff || offset === 0xffffffff) throw new Error('ZIP64-Archive (über 4 GB) werden nicht unterstützt.');
      const entries = new Map();
      for (let i = 0; i < count; i++) {
        if (dv.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP-Struktur unerwartet (Central Directory).');
        const method = dv.getUint16(offset + 10, true);
        const compSize = dv.getUint32(offset + 20, true);
        const size = dv.getUint32(offset + 24, true);
        const nameLen = dv.getUint16(offset + 28, true);
        const extraLen = dv.getUint16(offset + 30, true);
        const commentLen = dv.getUint16(offset + 32, true);
        const localOffset = dv.getUint32(offset + 42, true);
        const name = utf8.decode(buf.subarray(offset + 46, offset + 46 + nameLen)).replace(/\\/g, '/');
        offset += 46 + nameLen + extraLen + commentLen;
        if (name.endsWith('/')) continue;
        if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error('ZIP-Struktur unerwartet (Local Header).');
        const start = localOffset + 30 + dv.getUint16(localOffset + 26, true) + dv.getUint16(localOffset + 28, true);
        entries.set(name, { start, compSize, size, method });
      }
      return new ZipReader(buf, entries);
    }

    names() { return [...this.entries.keys()]; }
    has(name) { return this.entries.has(name); }

    async bytes(name) {
      const e = this.entries.get(name);
      if (!e) throw new Error('Nicht im Archiv: ' + name);
      const raw = this.buf.subarray(e.start, e.start + e.compSize);
      let data;
      if (e.method === 0) data = raw;
      else if (e.method === 8) data = await inflateRaw(raw);
      else throw new Error('Nicht unterstützte Kompressionsmethode ' + e.method + ' für ' + name);
      if (data.length !== e.size) throw new Error('Größenprüfung fehlgeschlagen für ' + name);
      return data;
    }

    async text(name) { return utf8.decode(await this.bytes(name)); }
    async json(name) { return JSON.parse(await this.text(name)); }
  }

  // ---------------------------------------------------------------- Schreiben

  const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Bereits komprimierte Formate werden nur gespeichert (spart viel Zeit bei Videos/Bildern).
  const STORE_ONLY = /\.(png|jpe?g|gif|webp|mp4|webm|ogg|ogv|mp3|m4a|aac|wav|zip|h5p|woff2?|pdf)$/i;

  class ZipWriter {
    constructor() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; }

    async add(name, data) {
      if (typeof data === 'string') data = enc.encode(data);
      const nameBuf = enc.encode(name);
      const crc = crc32(data);
      let payload = data, method = 0;
      if (!STORE_ONLY.test(name) && data.length > 64) {
        const d = await deflateRaw(data);
        if (d.length < data.length) { payload = d; method = 8; }
      }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, payload.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameBuf.length, true); lh.setUint16(28, 0, true);
      this.parts.push(lh.buffer, nameBuf, payload);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true); ch.setUint16(12, 0, true);
      ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, payload.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, nameBuf.length, true);
      ch.setUint32(42, this.offset, true);
      this.central.push(ch.buffer, nameBuf);
      this.offset += 30 + nameBuf.length + payload.length;
      this.count++;
      if (this.offset > 0xffffffff || this.count > 0xffff) throw new Error('Ergebnis zu groß für ein ZIP-Archiv (über 4 GB).');
    }

    finish() {
      const centralSize = this.central.reduce((n, p) => n + p.byteLength, 0);
      const eocd = new DataView(new ArrayBuffer(22));
      eocd.setUint32(0, 0x06054b50, true);
      eocd.setUint16(8, this.count, true); eocd.setUint16(10, this.count, true);
      eocd.setUint32(12, centralSize, true); eocd.setUint32(16, this.offset, true);
      return new Blob([...this.parts, ...this.central, eocd.buffer], { type: 'application/zip' });
    }
  }

  root.ZipReader = ZipReader;
  root.ZipWriter = ZipWriter;
})(typeof self !== 'undefined' ? self : this);
