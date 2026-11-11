/**
 * Demo pública de FactPOS (/demo): recorre las pantallas del sistema con datos de ejemplo, todo dentro del navegador.
 * No habla con ningún servidor ni toca datos reales; lo que se «vende» aquí desaparece al recargar.
 * OJO: es una plantilla de texto: sin comillas invertidas, sin «${» y sin barras invertidas en el HTML ni en el script.
 */
export const PAGINA_DEMO = /* html */ `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo · FactPOS</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.ico">
<style>
:root{--fondo:#f3f5f8;--panel:#fff;--borde:#e2e7ee;--texto:#101a24;--suave:#66768a;--pri:#2563eb;--pri2:#60a5fa;--suavepri:#e3f5f2;--ok:#15803d;--oksuave:#e4f6ea;--av:#b45309;--avsuave:#fff1e0;--mal:#b91c1c;--malsuave:#fde8e8;--lateral:#0b1218}
@media (prefers-color-scheme:dark){:root{--fondo:#0f151c;--panel:#172029;--borde:#263341;--texto:#e7edf3;--suave:#93a4b6;--pri:#60a5fa;--suavepri:#12332f;--ok:#4ade80;--oksuave:#12301f;--av:#fbbf24;--avsuave:#3a2a10;--mal:#f87171;--malsuave:#3a1818}}
*{box-sizing:border-box}
body{margin:0;font-family:"Segoe UI",system-ui,-apple-system,Roboto,sans-serif;background:var(--fondo);color:var(--texto);-webkit-font-smoothing:antialiased}
button{font:inherit;cursor:pointer}
.app{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:100vh}
.sc{overflow-x:auto}
aside{background:var(--lateral);color:#cbd8e5;padding:16px 12px;position:sticky;top:0;height:100vh;overflow:auto}
.marca{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;color:#fff;padding:4px 8px 16px;text-decoration:none}
.marca b{color:#60a5fa}
aside nav{display:grid;gap:2px}
aside h4{margin:14px 8px 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6f8396;font-weight:700}
aside button.nv{display:flex;gap:10px;align-items:center;width:100%;text-align:left;padding:9px 10px;border:0;border-radius:9px;background:transparent;color:#cbd8e5;font-size:14.5px}
aside button.nv:hover{background:rgba(255,255,255,.07)}
aside button.nv.on{background:rgba(96,165,250,.16);color:#fff}
.top{display:flex;align-items:center;gap:12px;padding:12px 24px;background:var(--panel);border-bottom:1px solid var(--borde);position:sticky;top:0;z-index:5}
.top .emp{color:var(--suave);font-size:14px}
.top .esp{flex:1}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:9px;border:1px solid var(--borde);background:var(--panel);color:var(--texto);font-weight:600;font-size:14px;text-decoration:none}
.btn.p{background:var(--pri2);border-color:var(--pri2);color:#06182e}
.btn.g{padding:6px 10px;font-size:13px}
.aviso{background:var(--suavepri);color:var(--pri);padding:8px 24px;font-size:13.5px;border-bottom:1px solid var(--borde)}
main{padding:22px 24px 60px;max-width:1180px}
h1{margin:0 0 4px;font-size:26px;letter-spacing:-.02em}
.sub{margin:0 0 18px;color:var(--suave)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
.kpi{background:var(--panel);border:1px solid var(--borde);border-radius:14px;padding:16px 18px}
.kpi span{color:var(--suave);font-size:13px}
.kpi b{display:block;font-size:26px;letter-spacing:-.5px;margin-top:2px}
.kpi small{color:var(--ok);font-weight:600}
.dos{display:grid;grid-template-columns:3fr 2fr;gap:16px}
.tarj{background:var(--panel);border:1px solid var(--borde);border-radius:14px;padding:16px 18px;margin-bottom:16px}
.tarj h3{margin:0 0 10px;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:14.5px}
th{text-align:left;color:var(--suave);font-size:12px;text-transform:uppercase;letter-spacing:.04em;padding:8px 10px;border-bottom:1px solid var(--borde)}
td{padding:10px;border-bottom:1px solid var(--borde)}
tr:last-child td{border-bottom:0}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tbody tr.clic{cursor:pointer}
tbody tr.clic:hover{background:var(--fondo)}
.pil{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700}
.pil.ok{background:var(--oksuave);color:var(--ok)}.pil.av{background:var(--avsuave);color:var(--av)}.pil.mal{background:var(--malsuave);color:var(--mal)}.pil.n{background:var(--fondo);color:var(--suave)}
input.bus,select{padding:9px 12px;border:1px solid var(--borde);border-radius:9px;background:var(--panel);color:var(--texto);font:inherit;min-width:230px}
.barras{display:flex;align-items:flex-end;gap:10px;height:170px;padding-top:8px}
.barras div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;height:100%}
.barras i{display:block;width:100%;border-radius:7px 7px 0 0;background:linear-gradient(var(--pri2),var(--pri))}
.barras small{color:var(--suave);font-size:12px}
.hbar{height:9px;border-radius:99px;background:var(--fondo);overflow:hidden;min-width:90px}
.hbar i{display:block;height:100%;background:var(--pri2)}
.hbar.bajo i{background:var(--mal)}
.pos{display:grid;grid-template-columns:1fr 340px;gap:16px}
.prods{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.prod{text-align:left;padding:12px;border-radius:12px;border:1px solid var(--borde);background:var(--panel);color:var(--texto)}
.prod:hover{border-color:var(--pri2);box-shadow:0 8px 18px -12px var(--pri)}
.prod b{display:block;font-size:14px;margin-bottom:6px}
.prod span{color:var(--pri);font-weight:700}
.prod small{display:block;color:var(--suave);font-size:12px;margin-top:2px}
.carro{position:sticky;top:76px;align-self:start}
.lin{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--borde);font-size:14px}
.lin .nom{flex:1}
.lin button{width:26px;height:26px;border-radius:7px;border:1px solid var(--borde);background:var(--panel);color:var(--texto)}
.tot{display:flex;justify-content:space-between;padding:4px 0;color:var(--suave)}
.tot.g{color:var(--texto);font-size:22px;font-weight:700;padding-top:10px}
.pagos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}
.pagos button{padding:11px 6px;border-radius:10px;border:0;background:var(--pri2);color:#06182e;font-weight:700}
.pagos button:disabled{opacity:.4;cursor:not-allowed}
.vacio{color:var(--suave);padding:14px 0;text-align:center}
.grid3{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.oferta{border:1px dashed var(--pri2);border-radius:14px;padding:16px;background:var(--suavepri)}
.oferta b{display:block;font-size:17px;margin-bottom:4px}
.verif{max-width:520px;margin:0 auto;text-align:center}
.verif .res{margin-top:18px;padding:22px;border-radius:16px;background:var(--panel);border:1px solid var(--borde);min-height:130px}
.verif .precio{font-size:44px;font-weight:800;color:var(--pri);letter-spacing:-1px}
.chips{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px}
.chips button{padding:5px 11px;border-radius:999px;border:1px solid var(--borde);background:var(--panel);color:var(--texto);font-size:13px}
.det{background:var(--fondo);border-radius:12px;padding:14px;margin-top:10px}
.menu{display:none;position:fixed;bottom:14px;right:14px;z-index:20;padding:12px 16px;border-radius:999px;border:0;background:var(--pri2);color:#06182e;font-weight:700;box-shadow:0 10px 24px -8px rgba(0,0,0,.5)}
@media(max-width:900px){.app{grid-template-columns:minmax(0,1fr)}aside{position:fixed;inset:0 40% 0 0;z-index:30;transform:translateX(-105%);transition:transform .2s;height:100vh}aside.ab{transform:none}.menu{display:block}.kpis{grid-template-columns:1fr 1fr}.dos,.pos{grid-template-columns:1fr}.carro{position:static}main{padding:18px 14px 80px}.top{padding:10px 14px}.aviso{padding:8px 14px}.top .emp{display:none}}
@media(max-width:520px){.kpis{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="app">
  <aside id="lat">
    <a class="marca" href="/"><span>Fact<b>POS</b></span></a>
    <nav id="nav"></nav>
  </aside>
  <div>
    <div class="top"><span class="emp">Supermercado Ejemplo · Sucursal Principal</span><span class="esp"></span><a class="btn" href="/">Ver la página</a><a class="btn p" href="/entrar#inicio">Iniciar sesión</a></div>
    <div class="aviso"><b>Demo con datos de ejemplo.</b> Todo lo que haga aquí es de práctica y se borra al recargar la página.</div>
    <main id="vista"></main>
  </div>
</div>
<button class="menu" id="menu" aria-label="Menú">☰ Menú</button>
<script>
(function(){
  var RD = function(n){ return "RD$ " + Number(n).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var $ = function(id){ return document.getElementById(id); };
  function h(tag, attrs, kids){
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === "t") e.textContent = attrs[k]; else if (k === "c") e.className = attrs[k]; else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function(x){ if (x != null) e.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
    return e;
  }
  function pil(txt, tono){ return h("span", { c: "pil " + tono, t: txt }); }

  // ---------------- Datos de ejemplo
  var PRODUCTOS = [
    { sku: "RON001", n: "Ron añejo 700 ml", cat: "Licores", p: 750, c: 520, st: 36, min: 12, itbis: true, cod: "7460001000017" },
    { sku: "CER001", n: "Cerveza 650 ml", cat: "Licores", p: 150, c: 105, st: 240, min: 120, itbis: true, cod: "7460002000016" },
    { sku: "REF001", n: "Refresco cola 2 L", cat: "Bebidas", p: 95, c: 68, st: 48, min: 24, itbis: true, cod: "7460003000015" },
    { sku: "ARR001", n: "Arroz selecto 1 lb", cat: "Despensa", p: 40, c: 32, st: 200, min: 50, itbis: false, cod: "7460004000014" },
    { sku: "HAB001", n: "Habichuelas rojas 15 oz", cat: "Despensa", p: 65, c: 48, st: 10, min: 24, itbis: false, cod: "7460005000013" },
    { sku: "SAL001", n: "Salami (por libra)", cat: "Embutidos", p: 175, c: 120, st: 40, min: 10, itbis: true, cod: "00123" },
    { sku: "AGU001", n: "Agua 5 galones", cat: "Bebidas", p: 120, c: 70, st: 60, min: 20, itbis: false, cod: "7460006000012" },
    { sku: "PAN001", n: "Pan de agua (unidad)", cat: "Panadería", p: 10, c: 6, st: 150, min: 60, itbis: false, cod: "7460007000011" },
    { sku: "LEC001", n: "Leche entera 1 L", cat: "Lácteos", p: 85, c: 62, st: 8, min: 24, itbis: false, cod: "7460008000010" },
    { sku: "ACE001", n: "Aceite vegetal 1 L", cat: "Despensa", p: 190, c: 150, st: 55, min: 20, itbis: true, cod: "7460009000019" }
  ];
  var CLIENTES = [
    { n: "Colmado Don Pepe", rnc: "131-45678-1", tel: "809-555-0101", lim: 50000, saldo: 18450, mov: [["02 nov", "Factura E320000014", 12300], ["28 oct", "Abono", -5000], ["20 oct", "Factura E320000009", 11150]] },
    { n: "Restaurante La Esquina", rnc: "101-23456-7", tel: "809-555-0145", lim: 100000, saldo: 0, mov: [["30 oct", "Abono", -42000], ["15 oct", "Factura E320000006", 42000]] },
    { n: "Ferretería El Progreso", rnc: "130-98765-2", tel: "829-555-0188", lim: 30000, saldo: 27900, mov: [["05 nov", "Factura E320000016", 27900]] },
    { n: "Cliente de contado", rnc: "—", tel: "—", lim: 0, saldo: 0, mov: [] }
  ];
  var FACTURAS = [
    { num: "E320000016", cli: "Ferretería El Progreso", tot: 27900, est: "Aceptado", hora: "05 nov 10:42" },
    { num: "E320000015", cli: "Cliente de contado", tot: 1245.5, est: "Aceptado", hora: "05 nov 10:15" },
    { num: "E320000014", cli: "Colmado Don Pepe", tot: 12300, est: "Aceptado", hora: "02 nov 16:03" },
    { num: "E320000013", cli: "Cliente de contado", tot: 380, est: "Aceptado", hora: "02 nov 11:20" },
    { num: "E320000012", cli: "Restaurante La Esquina", tot: 8620, est: "Aceptado", hora: "01 nov 18:47" }
  ];
  var DIAS = [["Lun", 41200], ["Mar", 38900], ["Mié", 45600], ["Jue", 52100], ["Vie", 68400], ["Sáb", 79300], ["Dom", 57800]];
  var SUCURSALES = [{ n: "Sucursal Principal", cajas: ["Caja 1", "Caja 2"], est: "En línea" }, { n: "Sucursal Santiago", cajas: ["Caja 1"], est: "En línea" }, { n: "Almacén Norte", cajas: [], est: "Sin internet · trabajando solo" }];
  var OFERTAS = [["2x1 en cerveza 650 ml", "Lleva 2, paga 1 · hasta agotar 120 unidades"], ["Aceite vegetal -15 %", "Todos los viernes · de 8:00 a 20:00"], ["Caja de refrescos a precio especial", "Desde 3 cajas: RD$ 95 c/u"], ["Cupón BIENVENIDO10", "10 % de descuento en la primera compra"]];
  var carro = [];
  var enCaja = { n: 16 };

  // ---------------- Pantallas
  var PAGS = [
    ["Operación", [["resumen", "Resumen"], ["caja", "Caja de venta"], ["facturas", "Facturas"], ["clientes", "Clientes"]]],
    ["Inventario", [["productos", "Productos"], ["existencias", "Existencias"], ["ofertas", "Ofertas"], ["verificador", "Verificador de precios"]]],
    ["Negocio", [["fiscal", "Facturación electrónica"], ["sucursales", "Sucursales y cajas"], ["reportes", "Reportes"]]]
  ];
  var titulos = {};
  PAGS.forEach(function(g){ g[1].forEach(function(p){ titulos[p[0]] = p[1]; }); });

  function encabezado(t, s){ return [h("h1", { t: t }), h("p", { c: "sub", t: s })]; }
  function tabla(cols, filas, onFila){
    var t = h("table"), cab = h("tr");
    cols.forEach(function(c){ cab.appendChild(h("th", { c: c.n ? "n" : "", t: c.t })); });
    t.appendChild(h("thead", null, [cab]));
    var cuerpo = h("tbody");
    filas.forEach(function(f){
      var tr = h("tr", onFila ? { c: "clic" } : null);
      f.forEach(function(v, i){ var td = h("td", { c: cols[i].n ? "n" : "" }); if (v instanceof Node) td.appendChild(v); else td.textContent = v; tr.appendChild(td); });
      if (onFila) tr.addEventListener("click", function(){ onFila(f); });
      cuerpo.appendChild(tr);
    });
    t.appendChild(cuerpo);
    return h("div", { c: "sc" }, [t]);
  }

  var V = {};
  V.resumen = function(){
    var total = DIAS.reduce(function(a, d){ return a + d[1]; }, 0), max = Math.max.apply(null, DIAS.map(function(d){ return d[1]; }));
    var bajo = PRODUCTOS.filter(function(p){ return p.st < p.min; });
    var kp = h("div", { c: "kpis" }, [
      [ "Ventas de la semana", RD(total), "+8 % vs. la anterior" ], [ "Facturas emitidas", String(FACTURAS.length + 118), "e-CF aceptados" ], [ "Ticket promedio", RD(total / 124), "" ], [ "Por cobrar a clientes", RD(CLIENTES.reduce(function(a, c){ return a + c.saldo; }, 0)), "" ]
    ].map(function(k){ return h("div", { c: "kpi" }, [h("span", { t: k[0] }), h("b", { t: k[1] }), h("small", { t: k[2] })]); }));
    var barras = h("div", { c: "barras" }, DIAS.map(function(d){ return h("div", null, [h("small", { t: Math.round(d[1] / 1000) + " mil" }), h("i", { style: "height:" + Math.round(d[1] / max * 130) + "px" }), h("small", { t: d[0] })]); }));
    var top = tabla([{ t: "Más vendidos" }, { t: "Unid.", n: 1 }], [["Cerveza 650 ml", "412"], ["Arroz selecto 1 lb", "305"], ["Refresco cola 2 L", "188"], ["Pan de agua", "176"]]);
    var alertas = bajo.length ? tabla([{ t: "Por reponer" }, { t: "Hay", n: 1 }, { t: "Mínimo", n: 1 }], bajo.map(function(p){ return [p.n, String(p.st), String(p.min)]; })) : h("p", { c: "vacio", t: "Nada por reponer." });
    return encabezado("Buenos días", "Así va el negocio esta semana.").concat([kp,
      h("div", { c: "dos" }, [h("div", { c: "tarj" }, [h("h3", { t: "Ventas por día" }), barras]), h("div", { c: "tarj" }, [top])]),
      h("div", { c: "tarj" }, [h("h3", { t: "Alertas de existencias" }), alertas])]);
  };

  V.caja = function(){
    var izq = h("div", null, [h("div", { c: "tarj" }, [h("h3", { t: "Toque un producto para agregarlo" }), h("div", { c: "prods" }, PRODUCTOS.map(function(p){
      return h("button", { c: "prod", onclick: function(){ agregar(p); } }, [h("b", { t: p.n }), h("span", { t: RD(p.p) }), h("small", { t: p.itbis ? "Con ITBIS 18 %" : "Exento" })]);
    }))])]);
    var der = h("div", { c: "tarj carro", id: "carro" });
    return encabezado("Caja de venta", "Pruebe la caja: agregue productos y cobre.").concat([h("div", { c: "pos" }, [izq, der])]);
  };
  function agregar(p){
    var l = carro.filter(function(x){ return x.p.sku === p.sku; })[0];
    if (l) l.q++; else carro.push({ p: p, q: 1 });
    pintarCarro();
  }
  function totales(){
    var sub = 0, itb = 0;
    carro.forEach(function(l){ var b = l.p.itbis ? l.p.p / 1.18 : l.p.p; sub += b * l.q; if (l.p.itbis) itb += (l.p.p - b) * l.q; });
    return { sub: sub, itb: itb, tot: sub + itb };
  }
  function pintarCarro(){
    var c = $("carro"); if (!c) return;
    c.textContent = "";
    c.appendChild(h("h3", { t: "Venta actual" }));
    if (!carro.length) c.appendChild(h("p", { c: "vacio", t: "Todavía no hay productos." }));
    carro.forEach(function(l, i){
      c.appendChild(h("div", { c: "lin" }, [
        h("span", { c: "nom", t: l.p.n }),
        h("button", { "aria-label": "Quitar uno", onclick: function(){ l.q--; if (l.q <= 0) carro.splice(i, 1); pintarCarro(); }, t: "−" }),
        h("b", { t: String(l.q) }),
        h("button", { "aria-label": "Agregar uno", onclick: function(){ l.q++; pintarCarro(); }, t: "+" }),
        h("span", { t: RD(l.p.p * l.q) })
      ]));
    });
    var t = totales();
    c.appendChild(h("div", { c: "tot" }, [h("span", { t: "Subtotal" }), h("span", { t: RD(t.sub) })]));
    c.appendChild(h("div", { c: "tot" }, [h("span", { t: "ITBIS 18 %" }), h("span", { t: RD(t.itb) })]));
    c.appendChild(h("div", { c: "tot g" }, [h("span", { t: "Total" }), h("span", { t: RD(t.tot) })]));
    var pagos = h("div", { c: "pagos" });
    ["Efectivo", "Tarjeta", "Crédito"].forEach(function(m){
      var b = h("button", { t: m, onclick: function(){ cobrar(m); } }); if (!carro.length) b.disabled = true; pagos.appendChild(b);
    });
    c.appendChild(pagos);
  }
  function cobrar(m){
    var t = totales(); enCaja.n++;
    var num = "E3200000" + enCaja.n;
    FACTURAS.unshift({ num: num, cli: m === "Crédito" ? "Colmado Don Pepe" : "Cliente de contado", tot: t.tot, est: "Aceptado", hora: "Ahora" });
    carro.forEach(function(l){ l.p.st = Math.max(0, l.p.st - l.q); });
    carro = [];
    var c = $("carro"); c.textContent = "";
    c.appendChild(h("h3", { t: "Venta cobrada" }));
    c.appendChild(h("p", { t: "Pago: " + m + ". Total " + RD(t.tot) + "." }));
    c.appendChild(h("p", null, [pil("e-CF " + num + " enviado a la DGII", "ok")]));
    c.appendChild(h("p", { c: "sub", t: "El inventario bajó solo. Mírelo en Existencias y Facturas." }));
    c.appendChild(h("button", { c: "btn p", t: "Nueva venta", onclick: pintarCarro }));
  }

  V.facturas = function(){
    return encabezado("Facturas", "Comprobantes fiscales electrónicos (e-CF) enviados a la DGII.").concat([h("div", { c: "tarj" }, [tabla(
      [{ t: "e-CF" }, { t: "Cliente" }, { t: "Fecha" }, { t: "Total", n: 1 }, { t: "DGII" }],
      FACTURAS.map(function(f){ return [f.num, f.cli, f.hora, RD(f.tot), pil(f.est, "ok")]; }))])]);
  };

  V.clientes = function(){
    var det = h("div");
    var t = tabla([{ t: "Cliente" }, { t: "RNC" }, { t: "Límite", n: 1 }, { t: "Debe", n: 1 }], CLIENTES.map(function(c){ return [c.n, c.rnc, c.lim ? RD(c.lim) : "—", c.saldo ? RD(c.saldo) : pil("Al día", "ok")]; }), function(f){
      var c = CLIENTES.filter(function(x){ return x.n === f[0]; })[0];
      det.textContent = "";
      det.appendChild(h("div", { c: "det" }, [h("b", { t: c.n }), h("p", { c: "sub", t: "Tel. " + c.tel }),
        c.mov.length ? tabla([{ t: "Fecha" }, { t: "Detalle" }, { t: "Monto", n: 1 }], c.mov.map(function(m){ return [m[0], m[1], RD(m[2])]; })) : h("p", { c: "vacio", t: "Sin movimientos." })]));
    });
    return encabezado("Clientes", "Crédito, límites y estado de cuenta. Toque un cliente para ver sus movimientos.").concat([h("div", { c: "tarj" }, [t, det])]);
  };

  V.productos = function(){
    var cuerpo = h("div");
    var bus = h("input", { c: "bus", placeholder: "Buscar por nombre o código…", "aria-label": "Buscar" });
    function pintar(){
      var q = bus.value.trim().toLowerCase();
      var l = PRODUCTOS.filter(function(p){ return !q || (p.n + " " + p.sku + " " + p.cod + " " + p.cat).toLowerCase().indexOf(q) >= 0; });
      cuerpo.textContent = "";
      cuerpo.appendChild(tabla([{ t: "Código" }, { t: "Producto" }, { t: "Categoría" }, { t: "Costo", n: 1 }, { t: "Precio", n: 1 }, { t: "Margen", n: 1 }, { t: "Hay", n: 1 }],
        l.map(function(p){ return [p.sku, p.n, p.cat, RD(p.c), RD(p.p), Math.round((1 - p.c / (p.itbis ? p.p / 1.18 : p.p)) * 100) + " %", String(p.st)]; })));
    }
    bus.addEventListener("input", pintar); pintar();
    return encabezado("Productos", "Fichas con códigos de barra, precios por nivel, impuestos y margen.").concat([h("div", { c: "tarj" }, [bus, h("div", { style: "margin-top:12px" }, [cuerpo])])]);
  };

  V.existencias = function(){
    var f = PRODUCTOS.map(function(p){
      var pc = Math.min(100, Math.round(p.st / (p.min * 3) * 100)), bajo = p.st < p.min;
      return [p.n, h("div", { c: "hbar" + (bajo ? " bajo" : "") }, [h("i", { style: "width:" + pc + "%" })]), String(p.st), String(p.min), bajo ? pil("Reponer", "mal") : pil("Bien", "ok")];
    });
    return encabezado("Existencias", "Lo que hay en cada sucursal, con aviso cuando baja del mínimo. Cobre en la caja y vuelva: verá cómo baja.").concat([h("div", { c: "tarj" }, [tabla([{ t: "Producto" }, { t: "Nivel" }, { t: "Hay", n: 1 }, { t: "Mínimo", n: 1 }, { t: "Estado" }], f)]),
      h("div", { c: "tarj" }, [h("h3", { t: "También incluye" }), h("p", { c: "sub", t: "Compras a proveedores, traspasos entre sucursales al costo, conteos físicos a ciegas, ajustes por merma, lotes con vencimiento y kardex con costo promedio." })])]);
  };

  V.ofertas = function(){
    return encabezado("Ofertas y cupones", "Porcentaje, precio especial, 2x1, por volumen y por horario, con tope de unidades.").concat([h("div", { c: "grid3" }, OFERTAS.map(function(o){ return h("div", { c: "oferta" }, [h("b", { t: o[0] }), h("span", { t: o[1] })]); }))]);
  };

  V.verificador = function(){
    var res = h("div", { c: "res" }, [h("p", { c: "sub", t: "Escriba o toque un código para ver su precio, como lo vería el cliente." })]);
    var ent = h("input", { c: "bus", placeholder: "Código de barras", inputmode: "numeric", "aria-label": "Código" });
    function ver(cod){
      var p = PRODUCTOS.filter(function(x){ return x.cod === cod.trim() || x.sku.toLowerCase() === cod.trim().toLowerCase(); })[0];
      res.textContent = "";
      if (!p) { res.appendChild(h("p", { c: "sub", t: cod.trim() ? "Ese código no tiene precio." : "Escriba o toque un código para ver su precio." })); return; }
      res.appendChild(h("b", { t: p.n })); res.appendChild(h("div", { c: "precio", t: RD(p.p) })); res.appendChild(h("p", { c: "sub", t: p.itbis ? "ITBIS incluido" : "Exento de ITBIS" }));
    }
    ent.addEventListener("input", function(){ ver(ent.value); });
    var chips = h("div", { c: "chips" }, PRODUCTOS.slice(0, 4).map(function(p){ return h("button", { t: p.cod, onclick: function(){ ent.value = p.cod; ver(p.cod); } }); }));
    return [h("div", { c: "verif" }, encabezado("Verificador de precios", "En pantallas de la tienda y desde el celular del cliente con un QR.").concat([ent, chips, res]))];
  };

  V.fiscal = function(){
    return encabezado("Facturación electrónica", "Comprobantes e-CF firmados y enviados a la DGII, con sus rangos de numeración.").concat([
      h("div", { c: "kpis" }, [["Enviados este mes", "118"], ["Aceptados", "117"], ["En cola", "1"], ["Rechazados", "0"]].map(function(k){ return h("div", { c: "kpi" }, [h("span", { t: k[0] }), h("b", { t: k[1] })]); })),
      h("div", { c: "tarj" }, [tabla([{ t: "Tipo" }, { t: "Rango autorizado" }, { t: "Usados", n: 1 }, { t: "Quedan", n: 1 }], [["E31 · Crédito fiscal", "E310000001 – E310000500", "74", "426"], ["E32 · Consumo", "E320000001 – E320001000", String(enCaja.n), String(1000 - enCaja.n)], ["E34 · Nota de crédito", "E340000001 – E340000100", "3", "97"]])])]);
  };

  V.sucursales = function(){
    return encabezado("Sucursales y cajas", "Cada tienda trabaja sola aunque se caiga el internet y se sincroniza al volver.").concat([h("div", { c: "grid3" }, SUCURSALES.map(function(s){
      return h("div", { c: "tarj" }, [h("h3", { t: s.n }), h("p", null, [pil(s.est, s.est === "En línea" ? "ok" : "av")]), h("p", { c: "sub", t: s.cajas.length ? s.cajas.join(" · ") : "Sin cajas (solo almacén)" })]);
    }))]);
  };

  V.reportes = function(){
    var cat = {}; PRODUCTOS.forEach(function(p){ cat[p.cat] = (cat[p.cat] || 0) + p.p * (p.st < 100 ? 40 : 90); });
    var ks = Object.keys(cat), max = Math.max.apply(null, ks.map(function(k){ return cat[k]; }));
    return encabezado("Reportes", "Ventas, márgenes, cierres de caja, cuentas por cobrar y más, por sucursal o de todas juntas.").concat([h("div", { c: "tarj" }, [h("h3", { t: "Ventas por categoría (ejemplo)" }),
      tabla([{ t: "Categoría" }, { t: "" }, { t: "Ventas", n: 1 }], ks.map(function(k){ return [k, h("div", { c: "hbar" }, [h("i", { style: "width:" + Math.round(cat[k] / max * 100) + "%" })]), RD(cat[k])]; }))])]);
  };

  // ---------------- Navegación
  var actual = "resumen";
  function ir(id){
    actual = V[id] ? id : "resumen";
    try { history.replaceState(null, "", "#" + actual); } catch (e) { /* sin historial */ }
    var v = $("vista"); v.textContent = "";
    V[actual]().forEach(function(n){ v.appendChild(n); });
    if (actual === "caja") pintarCarro();
    Array.prototype.forEach.call(document.querySelectorAll("button.nv"), function(b){ b.classList.toggle("on", b.getAttribute("data-id") === actual); });
    $("lat").classList.remove("ab");
    document.title = titulos[actual] + " · Demo FactPOS";
    window.scrollTo(0, 0);
  }
  PAGS.forEach(function(g){
    $("nav").appendChild(h("h4", { t: g[0] }));
    g[1].forEach(function(p){ $("nav").appendChild(h("button", { c: "nv", "data-id": p[0], t: p[1], onclick: function(){ ir(p[0]); } })); });
  });
  $("menu").addEventListener("click", function(){ $("lat").classList.toggle("ab"); });
  ir(location.hash.slice(1) || "resumen");
})();
</script>
</body>
</html>`;
