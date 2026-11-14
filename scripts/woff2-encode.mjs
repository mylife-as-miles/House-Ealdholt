// WOFF2 encoder for the menu's TrueType fonts (U-05), with no dependency beyond Node's own Brotli.
// It uses the null transform for every table (WOFF2 2018 recommendation, section 5: transform version 3 for
// glyf/loca, version 0 for the rest), so the decoded font is byte-for-byte the original tables. The glyf
// transform would save a few more kilobytes but needs a full glyph re-encoder; Brotli alone already does most
// of the work. Browsers decode this with the same OTS/woff2 code path as any other WOFF2 file.
import { brotliCompressSync, constants } from 'node:zlib';

const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln',
  'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf',
  'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
export const WOFF2_KNOWN_TAGS = Object.freeze(KNOWN_TAGS);

/** Reads an sfnt (TrueType) file's tables in directory order. */
export function readSfntTables(font) {
  const flavor = font.readUInt32BE(0);
  if (flavor !== 0x00010000 && flavor !== 0x74727565) throw new Error('Only TrueType-flavoured fonts are supported');
  const count = font.readUInt16BE(4), tables = [];
  for (let index = 0; index < count; index++) {
    const entry = 12 + index * 16, tag = font.toString('latin1', entry, entry + 4);
    const offset = font.readUInt32BE(entry + 8), length = font.readUInt32BE(entry + 12);
    if (offset + length > font.length) throw new Error(`Table ${tag} runs past the end of the font`);
    tables.push({ tag, data: font.subarray(offset, offset + length) });
  }
  return { flavor, tables };
}

export function encodeUIntBase128(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`UIntBase128 out of range: ${value}`);
  const bytes = [value & 0x7f];
  for (let rest = Math.floor(value / 128); rest > 0; rest = Math.floor(rest / 128)) bytes.unshift((rest & 0x7f) | 0x80);
  return Buffer.from(bytes);
}

const round4 = (value) => (value + 3) & ~3;

/** Encodes a TrueType font as WOFF2 (null transforms, Brotli quality 11, font mode). */
export function encodeWoff2(font) {
  const { flavor, tables } = readSfntTables(font);
  // Directory order is the source order (sfnt tables are sorted by tag, so glyf precedes loca as WOFF2 requires).
  const directory = [];
  for (const { tag, data } of tables) {
    const known = KNOWN_TAGS.indexOf(tag);
    // Transform version: 3 is the null transform for glyf and loca, 0 is the null transform for every other table.
    const version = tag === 'glyf' || tag === 'loca' ? 3 : 0;
    const flags = Buffer.from([(version << 6) | (known >= 0 ? known : 63)]);
    directory.push(flags, ...(known >= 0 ? [] : [Buffer.from(tag, 'latin1')]), encodeUIntBase128(data.length));
  }
  const compressed = brotliCompressSync(Buffer.concat(tables.map((table) => table.data)), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT, [constants.BROTLI_PARAM_LGWIN]: 24 },
  });
  const directoryBytes = Buffer.concat(directory);
  const headerLength = 48, unpadded = headerLength + directoryBytes.length + compressed.length, length = round4(unpadded);
  const totalSfntSize = 12 + 16 * tables.length + tables.reduce((sum, table) => sum + round4(table.data.length), 0);
  const header = Buffer.alloc(headerLength);
  header.write('wOF2', 0, 'latin1');
  header.writeUInt32BE(flavor, 4);
  header.writeUInt32BE(length, 8);
  header.writeUInt16BE(tables.length, 12);
  header.writeUInt16BE(0, 14);
  header.writeUInt32BE(totalSfntSize, 16);
  header.writeUInt32BE(compressed.length, 20);
  header.writeUInt16BE(1, 24); // majorVersion: the font's own version is not known here; 1.0 is the convention
  header.writeUInt16BE(0, 26);
  // metaOffset, metaLength, metaOrigLength, privOffset, privLength stay zero: no metadata, no private block.
  return Buffer.concat([header, directoryBytes, compressed, Buffer.alloc(length - unpadded)]);
}
