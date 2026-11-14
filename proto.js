// Protobuf encode/decode for the Meshtastic messages listed in schema.js.
//
//   PB.decode('FromRadio', bytes) -> plain object
//   PB.encode('ToRadio', object)  -> Uint8Array
//   PB.toJSON('Config.LoRaConfig', object) -> JSON-ready object
//
// Objects use the .proto field names. Enums are their names ('LONG_FAST'), bytes are
// Uint8Array, 64-bit numbers are Numbers when they fit and BigInt otherwise. Fields at
// their default value are left out, the way protobuf's own JSON form does it, so a
// settings backup made here matches one made by the desktop program. encode() also
// accepts that JSON form (base64 strings for bytes, enum numbers, numeric strings).
// Fields this schema doesn't know are kept in `_unknown` and written back unchanged,
// so saving a section never wipes a setting that only newer firmware has.
(function () {
  'use strict';
  const SCHEMA = window.MESH_SCHEMA;
  const PREFIX = 'meshtastic.protobuf.';
  const T = { DOUBLE: 1, FLOAT: 2, INT64: 3, UINT64: 4, INT32: 5, FIXED64: 6, FIXED32: 7, BOOL: 8,
    STRING: 9, MESSAGE: 11, BYTES: 12, UINT32: 13, ENUM: 14, SFIXED32: 15, SFIXED64: 16,
    SINT32: 17, SINT64: 18 };
  const REPEATED = 1, PRESENCE = 2;
  const utf8enc = new TextEncoder(), utf8dec = new TextDecoder();
  const cache = {};

  function full(name) { return name.startsWith(PREFIX) ? name : PREFIX + name; }

  function layout(name) {
    name = full(name);
    if (cache[name]) return cache[name];
    const raw = SCHEMA.messages[name];
    if (!raw) throw new Error('Unknown message type ' + name);
    const fields = raw.map((f) => ({ num: f[0], name: f[1], type: f[2], repeated: !!(f[3] & REPEATED),
      presence: !!(f[3] & PRESENCE), typeName: f[4], oneof: f[5] }));
    fields.sort((a, b) => a.num - b.num);             // write in field-number order, like every other protobuf library
    const byNum = {}, byName = {};
    fields.forEach((f) => { byNum[f.num] = f; byName[f.name] = f; });
    return (cache[name] = { fields, byNum, byName });
  }

  function enumTable(name) {
    const e = SCHEMA.enums[full(name)];
    if (!e) throw new Error('Unknown enum ' + name);
    if (!e.__byNum) {
      Object.defineProperty(e, '__byNum', { value: {}, enumerable: false });
      Object.keys(e).forEach((k) => { if (!(e[k] in e.__byNum)) e.__byNum[e[k]] = k; });
    }
    return e;
  }
  function enumNames(name) {
    const e = enumTable(name);
    return Object.keys(e).sort((a, b) => e[a] - e[b]);
  }
  function enumNumber(name, value) {
    if (typeof value === 'number') return value;
    const e = enumTable(name);
    if (value in e) return e[value];
    if (/^-?\d+$/.test(String(value))) return parseInt(value, 10);
    throw new Error('Unknown ' + name + ' value ' + value);
  }
  function enumName(name, number) {
    const n = enumTable(name).__byNum[number];
    return n === undefined ? number : n;
  }

  function b64ToBytes(text) {
    const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function asBytes(v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (Array.isArray(v)) return Uint8Array.from(v);
    if (typeof v === 'string') return b64ToBytes(v);
    throw new Error('Not bytes: ' + v);
  }

  // ── writing ───────────────────────────────────────────────────────────────
  function pushVarint(out, value) {
    let v = BigInt.asUintN(64, typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value))));
    while (v > 127n) { out.push(Number(v & 127n) | 128); v >>= 7n; }
    out.push(Number(v));
  }
  function pushFixed(out, size, setter, value) {
    const buf = new DataView(new ArrayBuffer(size));
    buf[setter](0, value, true);
    for (let i = 0; i < size; i++) out.push(buf.getUint8(i));
  }
  function pushAll(out, bytes) { for (let i = 0; i < bytes.length; i++) out.push(bytes[i]); }

  const WIRE = { 1: 1, 2: 5, 3: 0, 4: 0, 5: 0, 6: 1, 7: 5, 8: 0, 9: 2, 11: 2, 12: 2, 13: 0, 14: 0,
    15: 5, 16: 1, 17: 0, 18: 0 };

  function isDefault(f, v) {
    switch (f.type) {
      case T.STRING: return v === '';
      case T.BYTES: return asBytes(v).length === 0;
      case T.BOOL: return !v;
      case T.ENUM: return enumNumber(f.typeName, v) === 0;
      default: return (typeof v === 'bigint' ? v === 0n : Number(v) === 0);
    }
  }

  function writeScalar(out, f, v) {
    switch (f.type) {
      case T.DOUBLE: pushFixed(out, 8, 'setFloat64', Number(v)); break;
      case T.FLOAT: pushFixed(out, 4, 'setFloat32', Number(v)); break;
      case T.INT64: case T.UINT64: pushVarint(out, typeof v === 'string' ? BigInt(v) : v); break;
      case T.INT32: case T.UINT32: pushVarint(out, v); break;
      case T.ENUM: pushVarint(out, enumNumber(f.typeName, v)); break;
      case T.BOOL: out.push(v ? 1 : 0); break;
      case T.FIXED32: pushFixed(out, 4, 'setUint32', Number(v) >>> 0); break;
      case T.SFIXED32: pushFixed(out, 4, 'setInt32', Number(v) | 0); break;
      case T.FIXED64: pushFixed(out, 8, 'setBigUint64', BigInt.asUintN(64, BigInt(v))); break;
      case T.SFIXED64: pushFixed(out, 8, 'setBigInt64', BigInt.asIntN(64, BigInt(v))); break;
      case T.SINT32: { const n = Number(v) | 0; pushVarint(out, ((n << 1) ^ (n >> 31)) >>> 0); break; }
      case T.SINT64: { const n = BigInt(v); pushVarint(out, (n << 1n) ^ (n >> 63n)); break; }
      default: throw new Error('Bad scalar type ' + f.type);
    }
  }

  function writeField(out, f, v) {
    if (f.type === T.MESSAGE) {
      const body = encodeInto([], f.typeName, v);
      pushVarint(out, (f.num << 3) | 2); pushVarint(out, body.length); pushAll(out, body);
    } else if (f.type === T.STRING || f.type === T.BYTES) {
      const body = f.type === T.STRING ? utf8enc.encode(String(v)) : asBytes(v);
      pushVarint(out, (f.num << 3) | 2); pushVarint(out, body.length); pushAll(out, body);
    } else {
      pushVarint(out, (f.num << 3) | WIRE[f.type]);
      writeScalar(out, f, v);
    }
  }

  function encodeInto(out, typeName, obj) {
    const L = layout(typeName);
    obj = obj || {};
    for (const f of L.fields) {
      const v = obj[f.name];
      if (v === undefined || v === null) continue;
      if (f.repeated) {
        if (!v.length) continue;
        if (f.type === T.MESSAGE || f.type === T.STRING || f.type === T.BYTES) {
          for (const item of v) writeField(out, f, item);
        } else {                          // packed
          const body = [];
          for (const item of v) writeScalar(body, f, item);
          pushVarint(out, (f.num << 3) | 2); pushVarint(out, body.length); pushAll(out, body);
        }
      } else if (f.type === T.MESSAGE || f.presence || !isDefault(f, v)) {
        writeField(out, f, v);
      }
    }
    if (obj._unknown && obj._unknown.length) pushAll(out, asBytes(obj._unknown));
    return out;
  }

  function encode(typeName, obj) { return Uint8Array.from(encodeInto([], typeName, obj)); }

  // ── reading ───────────────────────────────────────────────────────────────
  function Reader(bytes) {
    this.b = bytes; this.p = 0;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  Reader.prototype.varint = function () {
    let v = 0n, shift = 0n;
    for (;;) {
      if (this.p >= this.b.length) throw new Error('Truncated message');
      const byte = this.b[this.p++];
      v |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return v;
      shift += 7n;
      if (shift > 70n) throw new Error('Bad varint');
    }
  };
  Reader.prototype.take = function (n) {
    if (this.p + n > this.b.length) throw new Error('Truncated message');
    const s = this.b.subarray(this.p, this.p + n);
    this.p += n;
    return s;
  };
  function safeNum(big) {
    return (big >= -9007199254740991n && big <= 9007199254740991n) ? Number(big) : big;
  }

  function readScalar(r, f) {
    switch (f.type) {
      case T.DOUBLE: { const v = r.view.getFloat64(r.p, true); r.p += 8; return v; }
      case T.FLOAT: { const v = r.view.getFloat32(r.p, true); r.p += 4; return v; }
      case T.FIXED32: { const v = r.view.getUint32(r.p, true); r.p += 4; return v; }
      case T.SFIXED32: { const v = r.view.getInt32(r.p, true); r.p += 4; return v; }
      case T.FIXED64: { const v = r.view.getBigUint64(r.p, true); r.p += 8; return safeNum(v); }
      case T.SFIXED64: { const v = r.view.getBigInt64(r.p, true); r.p += 8; return safeNum(v); }
      case T.INT32: return Number(BigInt.asIntN(32, r.varint()));
      case T.UINT32: return Number(BigInt.asUintN(32, r.varint()));
      case T.INT64: return safeNum(BigInt.asIntN(64, r.varint()));
      case T.UINT64: return safeNum(r.varint());
      case T.BOOL: return r.varint() !== 0n;
      case T.ENUM: return enumName(f.typeName, Number(BigInt.asIntN(32, r.varint())));
      case T.SINT32: { const n = Number(BigInt.asUintN(32, r.varint())); return (n >>> 1) ^ -(n & 1); }
      case T.SINT64: { const n = r.varint(); return safeNum((n >> 1n) ^ -(n & 1n)); }
      default: throw new Error('Bad scalar type ' + f.type);
    }
  }

  function skip(r, wire) {
    if (wire === 0) r.varint();
    else if (wire === 1) r.take(8);
    else if (wire === 2) r.take(Number(r.varint()));
    else if (wire === 5) r.take(4);
    else throw new Error('Unsupported wire type ' + wire);
  }

  function decode(typeName, bytes) {
    const L = layout(typeName);
    const r = new Reader(asBytes(bytes));
    const obj = {};
    const unknown = [];
    while (r.p < r.b.length) {
      const start = r.p;
      const tag = Number(r.varint());
      const num = tag >>> 3, wire = tag & 7;
      const f = L.byNum[num];
      if (!f) {
        skip(r, wire);
        pushAll(unknown, r.b.subarray(start, r.p));
        continue;
      }
      let value;
      if (f.type === T.MESSAGE) {
        value = decode(f.typeName, r.take(Number(r.varint())));
      } else if (f.type === T.STRING) {
        value = utf8dec.decode(r.take(Number(r.varint())));
      } else if (f.type === T.BYTES) {
        value = r.take(Number(r.varint())).slice();
      } else if (wire === 2 && f.repeated) {          // packed scalars
        const sub = new Reader(r.take(Number(r.varint())));
        if (!obj[f.name]) obj[f.name] = [];
        while (sub.p < sub.b.length) obj[f.name].push(readScalar(sub, f));
        continue;
      } else if (wire !== WIRE[f.type]) {             // wrong wire type: keep it, don't guess
        skip(r, wire);
        pushAll(unknown, r.b.subarray(start, r.p));
        continue;
      } else {
        value = readScalar(r, f);
      }
      if (f.repeated) (obj[f.name] || (obj[f.name] = [])).push(value);
      else {
        if (f.oneof) {                                // last member of a oneof wins
          for (const other of L.fields) if (other.oneof === f.oneof && other !== f) delete obj[other.name];
        }
        obj[f.name] = value;
      }
    }
    if (unknown.length) obj._unknown = Uint8Array.from(unknown);
    return obj;
  }

  // ── JSON form (matches protobuf's MessageToDict with original field names) ──
  function shortFloat(v) {
    if (!isFinite(v)) return v;
    for (let p = 1; p <= 9; p++) {
      const s = parseFloat(v.toPrecision(p));
      if (Math.fround(s) === Math.fround(v)) return s;
    }
    return v;
  }
  function jsonScalar(f, v) {
    switch (f.type) {
      case T.BYTES: return bytesToB64(asBytes(v));
      case T.FLOAT: return shortFloat(Number(v));
      case T.INT64: case T.UINT64: case T.FIXED64: case T.SFIXED64: case T.SINT64: return String(v);
      case T.ENUM: return typeof v === 'number' ? enumName(f.typeName, v) : v;
      case T.MESSAGE: return toJSON(f.typeName, v);
      default: return v;
    }
  }
  function toJSON(typeName, obj) {
    const L = layout(typeName);
    const out = {};
    for (const f of L.fields) {
      const v = obj ? obj[f.name] : undefined;
      if (v === undefined || v === null) continue;
      if (f.repeated) { if (v.length) out[f.name] = v.map((x) => jsonScalar(f, x)); continue; }
      if (f.type !== T.MESSAGE && !f.presence && isDefault(f, v)) continue;
      out[f.name] = jsonScalar(f, v);
    }
    return out;
  }

  function fieldNames(typeName) { return layout(typeName).fields.map((f) => f.name); }
  function hasField(typeName, name) { return name in layout(typeName).byName; }
  function fieldType(typeName, name) { const f = layout(typeName).byName[name]; return f ? f.typeName : null; }

  window.PB = { encode, decode, toJSON, enumNames, enumNumber, enumName, fieldNames, hasField, fieldType,
    b64ToBytes, bytesToB64, asBytes, version: SCHEMA.version };
})();
