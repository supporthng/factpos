// Lector de respaldos .bak de SQL Server sin SQL Server (copiado de FumiPOS: src/lib/migracion/mdf.ts).
const PAGINA = 8192;
const B8 = BigInt(8);
const B16 = BigInt(16);
const B48 = BigInt(48);
const SYSALLOC = [
  { n: "auid", t: "i8", s: 8 },
  { n: "type", t: "u1", s: 1 },
  { n: "ownerid", t: "i8", s: 8 },
  { n: "status", t: "i4", s: 4 },
  { n: "fgid", t: "i2", s: 2 },
  { n: "pgfirst", t: "b", s: 6 },
  { n: "pgroot", t: "b", s: 6 },
  { n: "pgfirstiam", t: "b", s: 6 },
  { n: "pcused", t: "i8", s: 8 },
  { n: "pcdata", t: "i8", s: 8 },
  { n: "pcreserved", t: "i8", s: 8 },
  { n: "dbfragid", t: "i4", s: 4 }
];
const SYSROWSET = [
  { n: "rowsetid", t: "i8", s: 8 },
  { n: "ownertype", t: "u1", s: 1 },
  { n: "idmajor", t: "i4", s: 4 },
  { n: "idminor", t: "i4", s: 4 },
  { n: "numpart", t: "i4", s: 4 },
  { n: "status", t: "i4", s: 4 },
  { n: "fgidfs", t: "i2", s: 2 },
  { n: "rcrows", t: "i8", s: 8 }
];
const SYSSCH = [
  { n: "id", t: "i4", s: 4 },
  { n: "name", t: "var" },
  { n: "nsid", t: "i4", s: 4 },
  { n: "nsclass", t: "u1", s: 1 },
  { n: "status", t: "i4", s: 4 },
  { n: "type", t: "b", s: 2 }
];
const SYSCOL = [
  { n: "id", t: "i4", s: 4 },
  { n: "number", t: "i2", s: 2 },
  { n: "colid", t: "i4", s: 4 },
  { n: "name", t: "var" },
  { n: "xtype", t: "u1", s: 1 },
  { n: "utype", t: "i4", s: 4 },
  { n: "length", t: "i2", s: 2 },
  { n: "prec", t: "u1", s: 1 },
  { n: "scale", t: "u1", s: 1 }
];
const SYSRSCOL = [
  { n: "rsid", t: "i8", s: 8 },
  { n: "rscolid", t: "i4", s: 4 },
  { n: "hbcolid", t: "i4", s: 4 },
  { n: "rcmodified", t: "i8", s: 8 },
  { n: "ti", t: "i4", s: 4 },
  { n: "cid", t: "i4", s: 4 },
  { n: "ordkey", t: "i2", s: 2 },
  { n: "maxinrowlen", t: "i2", s: 2 },
  { n: "status", t: "i4", s: 4 },
  { n: "offset", t: "i4", s: 4 },
  { n: "nullbit", t: "i4", s: 4 },
  { n: "bitpos", t: "i2", s: 2 }
];
const EPOCA = Date.UTC(1900, 0, 1);
const DIA = 864e5;
class RespaldoSql {
  buf;
  porAu = /* @__PURE__ */ new Map();
  meta = null;
  constructor(buf) {
    this.buf = buf;
    if (buf.length < 1024 || buf.toString("latin1", 0, 4) !== "TAPE") throw new Error("No es un respaldo de SQL Server (.bak).");
    const cuenta = /* @__PURE__ */ new Map();
    for (let o = 0; o + PAGINA <= Math.min(buf.length, 64 * 1024 * 1024); o += 512) {
      if (this.pareceHoja(o)) cuenta.set(o % PAGINA, (cuenta.get(o % PAGINA) ?? 0) + 1);
    }
    const [alineacion, n] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    if (n < 10) throw new Error("El respaldo est\xE1 comprimido o cifrado. Haz el respaldo sin compresi\xF3n y vuelve a intentarlo.");
    for (let o = alineacion; o + PAGINA <= buf.length; o += PAGINA) {
      if (buf[o] !== 1 || buf[o + 1] !== 1) continue;
      const indice = BigInt(buf.readUInt16LE(o + 6));
      const objeto = BigInt(buf.readUInt32LE(o + 24));
      const au = indice << B48 | objeto << B16;
      const l = this.porAu.get(au);
      if (l) l.push(o);
      else this.porAu.set(au, [o]);
    }
  }
  pareceHoja(o) {
    const b = this.buf;
    if (b[o] !== 1) return false;
    const t = b[o + 1];
    if (![1, 2, 3, 4, 7, 8, 9, 10, 11, 13, 16, 17].includes(t)) return false;
    return b.readUInt16LE(o + 36) === 1;
  }
  /** Posiciones de los registros vigentes de una página (sin fantasmas ni punteros) */
  *registros(o) {
    const b = this.buf;
    const slots = b.readUInt16LE(o + 22);
    for (let i = 0; i < slots; i++) {
      const p = b.readUInt16LE(o + PAGINA - 2 * (i + 1));
      if (p < 96 || p >= PAGINA) continue;
      const st = b[o + p];
      const tipo = st >> 1 & 7;
      if (tipo === 0 || tipo === 1) yield [o + p, st];
    }
  }
  leerSis(r, st, cols) {
    const b = this.buf;
    const fin = b.readUInt16LE(r + 2);
    let pos = r + 4;
    const out = {};
    for (const c of cols) {
      if (c.t === "var") continue;
      out[c.n] = c.t === "i8" ? b.readBigInt64LE(pos) : c.t === "i4" ? b.readInt32LE(pos) : c.t === "i2" ? b.readInt16LE(pos) : c.t === "u1" ? b[pos] : b.subarray(pos, pos + c.s);
      pos += c.s;
    }
    const vars = cols.filter((c) => c.t === "var");
    if (vars.length) {
      const ncols = b.readUInt16LE(r + fin);
      let q = r + fin + 2 + Math.ceil(ncols / 8);
      if (st & 32) {
        const nv = b.readUInt16LE(q);
        let ini = q + 2 + 2 * nv - r;
        vars.forEach((c, i) => {
          if (i >= nv) return;
          const e = b.readUInt16LE(q + 2 + 2 * i) & 32767;
          out[c.n] = b.subarray(r + ini, r + e);
          ini = e;
        });
        q = 0;
      }
    }
    return out;
  }
  tablaSis(objid, cols) {
    const salida = [];
    for (const au of [BigInt(objid) << B16, BigInt(1) << B48 | BigInt(objid) << B16]) {
      for (const o of this.porAu.get(au) ?? []) for (const [r, st] of this.registros(o)) {
        try {
          salida.push(this.leerSis(r, st, cols));
        } catch {
        }
      }
    }
    return salida;
  }
  cargarMeta() {
    if (this.meta) return this.meta;
    const objetos = /* @__PURE__ */ new Map();
    for (const r of this.tablaSis(34, SYSSCH)) {
      const n = r.name;
      objetos.set(r.id, { nombre: n ? n.toString("utf16le") : "", tipo: r.type.toString("latin1") });
    }
    const columnas = /* @__PURE__ */ new Map();
    for (const r of this.tablaSis(41, SYSCOL)) {
      if (r.number !== 0) continue;
      const id = r.id;
      if (!columnas.has(id)) columnas.set(id, /* @__PURE__ */ new Map());
      columnas.get(id).set(r.colid, {
        nombre: r.name?.toString("utf16le") ?? "",
        xtype: r.xtype,
        largo: r.length,
        prec: r.prec,
        escala: r.scale
      });
    }
    const rowsets = this.tablaSis(5, SYSROWSET).map((r) => ({ rowsetid: r.rowsetid, idmajor: r.idmajor, idminor: r.idminor, filas: r.rcrows }));
    const rscols = /* @__PURE__ */ new Map();
    for (const r of this.tablaSis(3, SYSRSCOL)) {
      const k = r.rsid;
      if (!rscols.has(k)) rscols.set(k, []);
      rscols.get(k).push(r);
    }
    const alloc = this.tablaSis(7, SYSALLOC).map((r) => ({ auid: r.auid, type: r.type, ownerid: r.ownerid }));
    this.meta = { objetos, columnas, rowsets, rscols, alloc };
    return this.meta;
  }
  /** Tablas de usuario con su cantidad de filas */
  tablas() {
    const m = this.cargarMeta();
    return [...m.objetos.entries()].filter(([, o]) => o.tipo === "U ").map(([id, o]) => ({ nombre: o.nombre, filas: Number(m.rowsets.find((r) => r.idmajor === id && r.idminor <= 1)?.filas ?? 0) })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  /** Todas las filas de una tabla (vacío si no existe) */
  tabla(nombre) {
    const m = this.cargarMeta();
    const id = [...m.objetos.entries()].find(([, o]) => o.tipo === "U " && o.nombre.toLowerCase() === nombre.toLowerCase())?.[0];
    if (id === void 0) return [];
    const rs = m.rowsets.find((r) => r.idmajor === id && r.idminor <= 1);
    if (!rs) return [];
    const defs = [];
    for (const rc of (m.rscols.get(rs.rowsetid) ?? []).sort((a, b) => a.rscolid - b.rscolid)) {
      const c = m.columnas.get(id)?.get(rc.hbcolid);
      if (!c) continue;
      let off = rc.offset & 65535;
      if (off >= 32768) off -= 65536;
      defs.push({ nombre: c.nombre, xtype: c.xtype, largo: c.largo, prec: c.prec, escala: c.escala, off, nullbit: rc.nullbit, bitpos: rc.bitpos, fisico: rc.maxinrowlen });
    }
    const salida = [];
    for (const a of m.alloc.filter((x) => x.ownerid === rs.rowsetid && x.type === 1)) {
      for (const o of this.porAu.get(a.auid) ?? []) for (const [r, st] of this.registros(o)) {
        try {
          salida.push(this.fila(r, st, defs));
        } catch {
        }
      }
    }
    return salida;
  }
  fila(r, st, defs) {
    const b = this.buf;
    const fin = b.readUInt16LE(r + 2);
    const ncols = b.readUInt16LE(r + fin);
    const nb = Math.ceil(ncols / 8);
    const mapa = r + fin + 2;
    const q = mapa + nb;
    const varOffs = [];
    let inicioVar = 0;
    if (st & 32) {
      const nv = b.readUInt16LE(q);
      for (let i = 0; i < nv; i++) varOffs.push(b.readUInt16LE(q + 2 + 2 * i));
      inicioVar = q + 2 + 2 * nv - r;
    }
    const out = {};
    for (const c of defs) {
      const bit = c.nullbit - 1;
      if (bit >= 0 && bit < ncols && b[mapa + (bit >> 3)] >> (bit & 7) & 1) {
        out[c.nombre] = null;
        continue;
      }
      if (c.off > 0) {
        if (c.xtype === 104) {
          out[c.nombre] = (b[r + c.off] >> c.bitpos & 1) === 1;
          continue;
        }
        const t = TAMANO[c.xtype] ?? (c.xtype === 106 || c.xtype === 108 ? 1 + (c.prec <= 9 ? 4 : c.prec <= 19 ? 8 : c.prec <= 28 ? 12 : 16) : c.fisico > 0 ? c.fisico : c.largo);
        out[c.nombre] = this.valor(b.subarray(r + c.off, r + c.off + t), c);
      } else {
        const i = -c.off - 1;
        if (i >= varOffs.length) {
          out[c.nombre] = null;
          continue;
        }
        const ini = i === 0 ? inicioVar : varOffs[i - 1] & 32767;
        const fin2 = varOffs[i] & 32767;
        out[c.nombre] = varOffs[i] & 32768 ? null : this.valor(b.subarray(r + ini, r + fin2), c);
      }
    }
    return out;
  }
  valor(v, c) {
    switch (c.xtype) {
      case 48:
        return v[0];
      case 52:
        return v.readInt16LE(0);
      case 56:
        return v.readInt32LE(0);
      case 127:
        return Number(v.readBigInt64LE(0));
      case 167:
      case 175: {
        const t = v.toString("latin1");
        return c.xtype === 175 ? t.trimEnd() : t;
      }
      case 231:
      case 239: {
        const t = v.toString("utf16le");
        return c.xtype === 239 ? t.trimEnd() : t;
      }
      case 106:
      case 108: {
        let n = BigInt(0);
        for (let i = v.length - 1; i >= 1; i--) n = n << B8 | BigInt(v[i]);
        const x = Number(n) / 10 ** c.escala;
        return v[0] === 1 ? x : -x;
      }
      case 60:
        return Number(v.readBigInt64LE(0)) / 1e4;
      case 122:
        return v.readInt32LE(0) / 1e4;
      case 62:
        return v.readDoubleLE(0);
      case 59:
        return v.readFloatLE(0);
      case 61: {
        const d = EPOCA + v.readInt32LE(0) * DIA + Math.round(v.readUInt32LE(4) * 10 / 3);
        return Number.isFinite(d) ? new Date(d) : null;
      }
      case 58:
        return new Date(EPOCA + v.readUInt16LE(2) * DIA + v.readUInt16LE(0) * 6e4);
      case 40: {
        const dias = v[0] | v[1] << 8 | v[2] << 16;
        return new Date(-621355968e5 + dias * DIA);
      }
      case 36:
        return v.toString("hex");
      default:
        return null;
    }
  }
}
const TAMANO = { 56: 4, 52: 2, 48: 1, 127: 8, 60: 8, 122: 4, 62: 8, 59: 4, 61: 8, 58: 4, 40: 3, 36: 16 };
export {
  RespaldoSql
};
