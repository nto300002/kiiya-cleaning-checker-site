const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function write32(view: DataView, offset: number, value: number) { view.setUint32(offset, value, true); }

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function storedZip(files: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    if (!/^(?:manifest\.json|schema\/[a-z.]+|data\/[a-z_]+\.jsonl|assets\/[0-9]{6}\.bin)$/.test(file.name)) throw new Error('Invalid archive entry');
    const name = encoder.encode(file.name);
    const size = file.bytes.byteLength;
    if (size > 0xffffffff || offset + size + 30 + name.length > 0xffffffff) throw new Error('Archive exceeds ZIP32 limit');
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    write32(lv, 0, 0x04034b50); write16(lv, 4, 20); write16(lv, 6, 0x0800);
    write16(lv, 8, 0); write32(lv, 14, crc); write32(lv, 18, size); write32(lv, 22, size);
    write16(lv, 26, name.length); local.set(name, 30);
    parts.push(local, file.bytes);
    const entry = new Uint8Array(46 + name.length);
    const ev = new DataView(entry.buffer);
    write32(ev, 0, 0x02014b50); write16(ev, 4, 20); write16(ev, 6, 20);
    write16(ev, 8, 0x0800); write16(ev, 10, 0); write32(ev, 16, crc);
    write32(ev, 20, size); write32(ev, 24, size); write16(ev, 28, name.length);
    write32(ev, 42, offset); entry.set(name, 46); central.push(entry);
    offset += local.length + size;
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  if (files.length > 65535 || offset + directorySize + 22 > 0xffffffff) throw new Error('Archive exceeds ZIP32 limit');
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  write32(view, 0, 0x06054b50); write16(view, 8, files.length); write16(view, 10, files.length);
  write32(view, 12, directorySize); write32(view, 16, offset);
  const output = new Uint8Array(offset + directorySize + end.length);
  let position = 0;
  for (const part of [...parts, ...central, end]) { output.set(part, position); position += part.length; }
  return output;
}

export function streamedZip(files: AsyncIterable<{ name: string; bytes: Uint8Array }>): ReadableStream<Uint8Array> {
  const iterator = files[Symbol.asyncIterator]();
  const central: Uint8Array[] = [];
  let offset = 0;
  let finished = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) { controller.close(); return; }
      try {
        const next = await iterator.next();
        if (next.done) {
          const directorySize = central.reduce((sum, part) => sum + part.length, 0);
          if (central.length > 65535 || offset + directorySize + 22 > 0xffffffff) throw new Error('Archive exceeds ZIP32 limit');
          const end = new Uint8Array(22);
          const view = new DataView(end.buffer);
          write32(view, 0, 0x06054b50); write16(view, 8, central.length); write16(view, 10, central.length);
          write32(view, 12, directorySize); write32(view, 16, offset);
          for (const entry of central) controller.enqueue(entry);
          controller.enqueue(end);
          finished = true; controller.close();
          return;
        }
        const { name: nameText, bytes } = next.value;
        if (!/^(?:manifest\.json|schema\/[a-z.]+|data\/[a-z_]+\.jsonl|assets\/[0-9]{6}\.bin)$/.test(nameText)) throw new Error('Invalid archive entry');
        const name = encoder.encode(nameText);
        const size = bytes.byteLength;
        if (size > 0xffffffff || offset + size + 30 + name.length > 0xffffffff) throw new Error('Archive exceeds ZIP32 limit');
        let crc = 0xffffffff;
        for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
        crc = (crc ^ 0xffffffff) >>> 0;
        const local = new Uint8Array(30 + name.length);
        const lv = new DataView(local.buffer);
        write32(lv, 0, 0x04034b50); write16(lv, 4, 20); write16(lv, 6, 0x0800);
        write16(lv, 8, 0); write32(lv, 14, crc); write32(lv, 18, size); write32(lv, 22, size);
        write16(lv, 26, name.length); local.set(name, 30);
        const entry = new Uint8Array(46 + name.length);
        const ev = new DataView(entry.buffer);
        write32(ev, 0, 0x02014b50); write16(ev, 4, 20); write16(ev, 6, 20);
        write16(ev, 8, 0x0800); write16(ev, 10, 0); write32(ev, 16, crc);
        write32(ev, 20, size); write32(ev, 24, size); write16(ev, 28, name.length);
        write32(ev, 42, offset); entry.set(name, 46); central.push(entry);
        offset += local.length + size;
        controller.enqueue(local); controller.enqueue(bytes);
      } catch (error) { controller.error(error); }
    },
  });
}
