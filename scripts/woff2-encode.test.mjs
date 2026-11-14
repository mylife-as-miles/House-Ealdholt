import assert from 'node:assert/strict';
import test from 'node:test';
import { brotliDecompressSync } from 'node:zlib';
import { WOFF2_KNOWN_TAGS, encodeUIntBase128, encodeWoff2, readSfntTables } from './woff2-encode.mjs';

// A minimal sfnt with a known tag, glyf/loca (null-transform tables) and an unknown tag.
function sfnt(tables) {
  const header = Buffer.alloc(12 + tables.length * 16);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(tables.length, 4);
  let offset = header.length;
  const bodies = [];
  tables.forEach(([tag, data], index) => {
    const entry = 12 + index * 16;
    header.write(tag, entry, 'latin1');
    header.writeUInt32BE(offset, entry + 8);
    header.writeUInt32BE(data.length, entry + 12);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}

function readUIntBase128(bytes, offset) {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    const byte = bytes[offset + index];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return [value, offset + index + 1];
  }
  throw new Error('UIntBase128 longer than five bytes');
}

// An independent reader following the WOFF2 table directory rules, used to round-trip the encoder's output.
function decodeWoff2(file) {
  assert.equal(file.toString('latin1', 0, 4), 'wOF2');
  assert.equal(file.readUInt32BE(8), file.length, 'header length is the file length');
  assert.equal(file.length % 4, 0, 'the file is padded to four bytes');
  const count = file.readUInt16BE(12);
  let offset = 48;
  const entries = [];
  for (let index = 0; index < count; index++) {
    const flags = file[offset++], known = flags & 63, version = flags >> 6;
    let tag;
    if (known === 63) { tag = file.toString('latin1', offset, offset + 4); offset += 4; } else tag = WOFF2_KNOWN_TAGS[known];
    let length;
    [length, offset] = readUIntBase128(file, offset);
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    assert.equal(transformed, false, `${tag} must use the null transform`);
    entries.push({ tag, length });
  }
  const stream = brotliDecompressSync(file.subarray(offset, offset + file.readUInt32BE(20)));
  let position = 0;
  return { totalSfntSize: file.readUInt32BE(16), tables: entries.map(({ tag, length }) => ({ tag, data: stream.subarray(position, position += length) })), streamLength: stream.length };
}

test('UIntBase128 uses the shortest big-endian form', () => {
  assert.deepEqual([...encodeUIntBase128(0)], [0]);
  assert.deepEqual([...encodeUIntBase128(127)], [127]);
  assert.deepEqual([...encodeUIntBase128(128)], [0x81, 0]);
  assert.deepEqual([...encodeUIntBase128(63)], [63]);
  assert.deepEqual([...encodeUIntBase128(0xffffffff)], [0x8f, 0xff, 0xff, 0xff, 0x7f]);
  assert.throws(() => encodeUIntBase128(-1));
});

test('WOFF2 output round-trips every table byte for byte', () => {
  const tables = [['cmap', Buffer.from('cmap-table')], ['glyf', Buffer.from('glyph outlines, odd length')], ['head', Buffer.alloc(54, 7)],
    ['loca', Buffer.from([0, 0, 0, 4, 0, 9])], ['zzzz', Buffer.from('an unknown table')]];
  const font = sfnt(tables);
  const decoded = decodeWoff2(encodeWoff2(font));
  assert.deepEqual(decoded.tables.map(({ tag, data }) => [tag, data.toString('hex')]), readSfntTables(font).tables.map(({ tag, data }) => [tag, data.toString('hex')]));
  assert.equal(decoded.streamLength, tables.reduce((sum, [, data]) => sum + data.length, 0), 'tables are packed without padding in the stream');
  assert.equal(decoded.totalSfntSize, font.length, 'totalSfntSize is the padded sfnt size');
});

test('only TrueType-flavoured fonts are accepted', () => {
  const font = sfnt([['head', Buffer.alloc(4)]]);
  font.write('OTTO', 0, 'latin1');
  assert.throws(() => encodeWoff2(font), /TrueType/);
});
