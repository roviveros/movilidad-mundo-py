// Movilidad Mundo Paraguay S.A. — interfaz por rol (Vendedor · Control de gestión · Administración)
import {
  DIAS, ROLES, ESTADOS, TIPOS, calcularDia, calcularSolicitud, diaVacio, fmtGs, precioFinal, semanaMes, AA_POR_KM,
} from "./calc.js";

/* ============================================================ utilidades */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hoy = () => new Date().toLocaleDateString("en-CA");
const fFecha = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const fFechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const clon = (o) => JSON.parse(JSON.stringify(o));
const nz = (v) => (Number(v) ? v : "");
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
  del: (k) => { try { sessionStorage.removeItem(k); } catch {} },
};

const S = {
  token: ss.get("mp_token"),
  user: null,
  config: null,
  lista: [],
  vista: "",
  sol: null,        // solicitud en edición (vendedor)
  detalle: null,    // solicitud abierta en modo lectura / revisión
  cfgEdit: null,    // copia de trabajo de Parámetros
  filtros: { vendedor: "", tipo: "", estado: "" },
  lb: null,         // visor de comprobantes
};

class ApiError extends Error {}
async function api(method, path, body, extra = {}) {
  const headers = { ...(extra.headers || {}) };
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  let payload = body;
  if (body !== undefined && !(body instanceof Blob)) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/api/${path}`, { method, headers, body: payload }); }
  catch { throw new ApiError("No hay conexión con el servidor. Revisá tu internet e intentá de nuevo."); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== "login") { cerrarSesion(); throw new ApiError(data?.error || "Tu sesión venció. Ingresá de nuevo."); }
  if (!res.ok) throw new ApiError(data?.error || `Error ${res.status}`);
  return data;
}

function toast(msg, error = false) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast" + (error ? " error" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), error ? 6000 : 3200);
}

function confirmar({ titulo, texto, ok = "Confirmar", clase = "btn-azul" }) {
  return new Promise((resolve) => {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${esc(titulo)}</h3><div style="font-size:.85rem;color:#3C5068;">${texto}</div>
      <div class="acciones-row" style="margin-top:6px;justify-content:flex-end;">
        <button class="btn btn-outline" data-r="0">Cancelar</button>
        <button class="btn ${clase}" data-r="1">${esc(ok)}</button>
      </div></div>`;
    bg.addEventListener("click", (e) => {
      const r = e.target.dataset?.r;
      if (r !== undefined || e.target === bg) { bg.remove(); resolve(r === "1"); }
    });
    document.body.appendChild(bg);
    bg.querySelector('[data-r="1"]').focus();
  });
}

const pillEstado = (e) => `<span class="pill-est est-${e}">${esc(ESTADOS[e] || e)}</span>`;
const pillTipo = (t) => (t === "rendicion" ? `<span class="pill pill-rend">RENDICIÓN</span>` : `<span class="pill pill-antic">ANTICIPO</span>`);
const pillRol = (r) => `<span class="pill rol-${r}">${esc(ROLES[r] || r)}</span>`;
const fotoUrl = (solId, fid) => `/api/solicitudes/${solId}/fotos/${fid}?t=${encodeURIComponent(S.token)}`;

function vehiculoActual() {
  const f = S.config?.funcionarios.find((x) => x.usuario === S.user?.usuario);
  if (!f) return null;
  const c = S.config.combustibles.find((x) => x.producto === f.combustible);
  return { marca: f.marca, modelo: f.modelo, combustible: f.combustible, tipo: c ? c.tipo : "", consumo: Number(f.consumo) || 0, precioL: c ? Math.round(precioFinal(c)) : 0 };
}

/* ============================================================ sesión */
function renderLogin(msg = "") {
  document.title = "Ingresar · Movilidad Mundo Paraguay";
  $("root").innerHTML = `
  <div class="login-wrap">
    <form class="login-card" id="login-form" autocomplete="on">
      <img src="logo.jpg" alt="Mundo Paraguay">
      <h1>Cálculo de Movilidad · Vehículo Propio</h1>
      <p class="sub">Solicitud de anticipo y rendición de gastos</p>
      ${msg ? `<div class="error-msg">${esc(msg)}</div>` : ""}
      <label class="field">Usuario
        <input type="text" id="login-usuario" autocomplete="username" autocapitalize="none" required>
      </label>
      <label class="field">PIN
        <input type="password" id="login-pin" inputmode="numeric" autocomplete="current-password" required>
      </label>
      <button class="btn btn-azul" type="submit" id="login-btn">Ingresar</button>
    </form>
  </div>`;
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("login-btn");
    btn.disabled = true; btn.textContent = "Ingresando…";
    try {
      const r = await api("POST", "login", { usuario: $("login-usuario").value, pin: $("login-pin").value });
      S.token = r.token; ss.set("mp_token", r.token);
      S.user = r.user;
      await iniciarApp();
    } catch (err) {
      renderLogin(err.message);
    }
  });
  $("login-usuario").focus();
}

function cerrarSesion() {
  S.token = null; S.user = null; S.sol = null; S.detalle = null; S.lista = [];
  ss.del("mp_token");
  renderLogin();
}

function modalCambiarPin(obligatorio) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<form class="modal" id="pin-form">
    <h3>${obligatorio ? "Elegí tu PIN personal" : "Cambiar PIN"}</h3>
    ${obligatorio ? `<div class="banner info" style="font-size:.8rem;">Estás usando un PIN provisorio. Para continuar, elegí uno personal de 4 a 8 números.</div>` : ""}
    <div id="pin-msg"></div>
    <label class="field">PIN actual <input type="password" id="pin-actual" inputmode="numeric" required></label>
    <label class="field">PIN nuevo <input type="password" id="pin-nuevo" inputmode="numeric" required></label>
    <label class="field">Repetí el PIN nuevo <input type="password" id="pin-nuevo2" inputmode="numeric" required></label>
    <div class="acciones-row" style="justify-content:flex-end;margin-top:4px;">
      ${obligatorio ? `<button type="button" class="btn btn-outline" id="pin-salir">Salir</button>` : `<button type="button" class="btn btn-outline" id="pin-cancelar">Cancelar</button>`}
      <button class="btn btn-azul" type="submit">Guardar PIN</button>
    </div></form>`;
  document.body.appendChild(bg);
  $("pin-actual").focus();
  bg.querySelector("#pin-cancelar")?.addEventListener("click", () => bg.remove());
  bg.querySelector("#pin-salir")?.addEventListener("click", () => { bg.remove(); cerrarSesion(); });
  $("pin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("pin-nuevo").value !== $("pin-nuevo2").value) { $("pin-msg").innerHTML = `<div class="error-msg">Los PIN nuevos no coinciden.</div>`; return; }
    try {
      await api("POST", "cambiar-pin", { pinActual: $("pin-actual").value, pinNuevo: $("pin-nuevo").value });
      S.user.debeCambiarPin = false;
      bg.remove();
      toast("PIN actualizado.");
    } catch (err) { $("pin-msg").innerHTML = `<div class="error-msg">${esc(err.message)}</div>`; }
  });
}

/* ============================================================ estructura */
function tabsDeRol() {
  const r = S.user.rol;
  if (r === "VENDEDOR") return { params: [], main: [["editor", "🧮 Solicitud / Rendición"], ["historial", "📊 Resumen Histórico"]] };
  if (r === "CONTROL") return { params: [], main: [["bandeja", "📥 Bandeja de revisión"], ["historial", "📊 Resumen Histórico"]] };
  return { params: [["parametros", "⚙️ Parámetros"]], main: [["bandeja", "📥 Bandeja de revisión"], ["historial", "📊 Resumen Histórico"]] };
}

function renderShell() {
  const t = tabsDeRol();
  const btn = ([id, label]) => `<button class="tab-btn" data-tab="${id}" onclick="App.go('${id}')">${label}<span class="tab-count" id="count-${id}" hidden></span></button>`;
  document.title = "Mundo Paraguay S.A. · Cálculo de Movilidad";
  $("root").innerHTML = `
  <header class="top">
    <img class="logo" src="logo.jpg" alt="Mundo Paraguay">
    <div class="titulos">
      <h1>Cálculo de Movilidad · Vehículo Propio</h1>
      <p>Solicitud de anticipo y rendición de gastos por uso de vehículo propio</p>
    </div>
    <div class="nav-wrap">
      ${t.params.length ? `<nav class="tabs tabs-params">${t.params.map(btn).join("")}</nav><div class="nav-divider"></div>` : ""}
      <nav class="tabs">${t.main.map(btn).join("")}</nav>
      <div class="user-chip">
        <div><strong>${esc(S.user.nombre)}</strong><span>${esc(ROLES[S.user.rol])}</span></div>
        <button class="btn btn-ghost btn-sm" onclick="App.cambiarPin()" title="Cambiar PIN">🔑</button>
        <button class="btn btn-ghost btn-sm" onclick="App.salir()">Salir</button>
      </div>
    </div>
  </header>
  <main id="main"></main>
  <footer class="pie">Mundo Paraguay S.A. · Herramienta interna de movilidad · Circuito: Vendedor → Control de gestión → Administración</footer>`;
}

function actualizarContadores() {
  const set = (id, n) => { const el = $(`count-${id}`); if (el) { el.textContent = n; el.hidden = !n; } };
  const r = S.user.rol;
  if (r === "CONTROL") set("bandeja", S.lista.filter((s) => s.estado === "PENDIENTE_CONTROL").length);
  if (r === "ADMIN") set("bandeja", S.lista.filter((s) => s.estado === "PENDIENTE_ADMIN" || s.estado === "APROBADA").length);
  if (r === "VENDEDOR") set("historial", S.lista.filter((s) => s.estado === "DEVUELTA").length);
}

async function cargarLista() {
  S.lista = await api("GET", "solicitudes");
  actualizarContadores();
}

async function iniciarApp() {
  try {
    if (!S.user) S.user = (await api("GET", "me")).user;
    S.config = await api("GET", "config");
    await cargarLista();
  } catch (err) {
    if (!S.token) return;
    renderLogin(err.message);
    return;
  }
  renderShell();
  actualizarContadores();
  go(S.user.rol === "VENDEDOR" ? "editor" : "bandeja");
  if (S.user.debeCambiarPin) modalCambiarPin(true);
}

function go(vista) {
  S.vista = vista;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === vista));
  const main = $("main");
  if (!main) return;
  window.scrollTo(0, 0);
  if (vista === "editor") return renderEditor();
  if (vista === "historial") return renderHistorial();
  if (vista === "bandeja") return renderBandeja();
  if (vista === "parametros") return renderParametros();
  if (vista === "detalle") return renderDetalle();
}

/* ============================================================ bloques compartidos */
function filasPeaje(sol, i, tr, ed) {
  return sol.dias[i].peajes[tr].map((p, j) => `
    <tr>
      <td><input type="number" min="0" value="${nz(p.cant)}" placeholder="0" ${ed ? `oninput="App.pea(${i},'${tr}',${j},'cant',this.value)"` : "disabled"}></td>
      <td><input type="number" min="0" value="${nz(p.monto)}" placeholder="0" ${ed ? `oninput="App.pea(${i},'${tr}',${j},'monto',this.value)"` : "disabled"}></td>
      <td class="subt" id="p-${i}-${tr}-sub-${j}">${fmtGs((Number(p.cant) || 0) * (Number(p.monto) || 0))}</td>
      <td class="col-del">${ed ? `<button type="button" class="btn btn-rojo btn-sm" onclick="App.delPea(${i},'${tr}',${j})" title="Eliminar fila">✕</button>` : ""}</td>
    </tr>`).join("");
}

function panelPeaje(sol, i, tr, ed) {
  const titulo = tr === "ida" ? "Peajes de ida" : "Peajes de vuelta";
  return `
    <div class="peaje-panel">
      <div class="peaje-head"><h3>${titulo}</h3>
        ${ed ? `<button type="button" class="btn btn-outline btn-sm" onclick="App.addPea(${i},'${tr}')">+ Agregar fila</button>` : ""}
      </div>
      <table class="tabla-peajes">
        <thead><tr><th style="width:90px;">Cantidad</th><th>Monto por peaje (Gs.)</th><th style="text-align:right;">Subtotal (Gs.)</th><th class="col-del"></th></tr></thead>
        <tbody id="body-pea-${i}-${tr}">${filasPeaje(sol, i, tr, ed)}</tbody>
        <tfoot><tr><td colspan="2">TOTAL ${tr.toUpperCase()}</td><td id="tot-pea-${i}-${tr}">${fmtGs(sol.dias[i].peajes[tr].reduce((a, p) => a + (Number(p.cant) || 0) * (Number(p.monto) || 0), 0))}</td><td class="col-del"></td></tr></tfoot>
      </table>
    </div>`;
}

function listaClientes(sol, i, ed) {
  const cl = sol.dias[i].clientes;
  if (!ed) {
    const llenos = cl.filter((c) => c.trim());
    return llenos.length ? llenos.map((c, j) => `<div class="cliente-item"><span class="num">${j + 1}.</span><span>${esc(c)}</span></div>`).join("") : `<span class="muted" style="font-size:.8rem;">Sin clientes cargados.</span>`;
  }
  return cl.map((c, j) => `
    <div class="cliente-item">
      <span class="num">${j + 1}.</span>
      <input type="text" id="cli-${i}-${j}" value="${esc(c)}" placeholder="Nombre del cliente" oninput="App.cli(${i},${j},this.value)">
      <button type="button" class="btn btn-rojo btn-sm" onclick="App.delCli(${i},${j})" title="Quitar">✕</button>
    </div>`).join("");
}

function filaDia(sol, i, ed, veh) {
  const d = sol.dias[i];
  const c = calcularDia(d, veh);
  const dis = ed ? "" : "disabled";
  const nCli = d.clientes.filter((x) => x.trim()).length;
  const nPea = ["ida", "vuelta"].reduce((s, t) => s + d.peajes[t].reduce((a, p) => a + (Number(p.cant) || 0), 0), 0);
  const abrirCli = !ed && nCli > 0;
  const abrirPea = !ed && c.peajes > 0;
  const on = d.viaticos.on;
  return `
    <tr>
      <td style="font-weight:700;color:var(--azul-oscuro);">${DIAS[i]}</td>
      <td><input type="date" value="${d.fecha}" ${dis} oninput="App.d(${i},'fecha',this.value)"></td>
      <td><input type="text" value="${esc(d.desde)}" placeholder="Origen" ${dis} oninput="App.d(${i},'desde',this.value)"></td>
      <td><input type="text" value="${esc(d.hasta)}" placeholder="Destino" ${dis} oninput="App.d(${i},'hasta',this.value)"></td>
      <td><input type="number" min="0" value="${nz(d.kms)}" placeholder="0" ${dis} oninput="App.d(${i},'kms',this.value)"></td>
      <td><input type="text" id="r-adic-${i}" readonly value="${fmtGs(c.adicional)}"></td>
      <td><input type="text" id="r-total-${i}" readonly value="${fmtGs(c.combAA)}"></td>
      <td class="td-monto ${c.peajes ? "" : "off"}" id="r-pea-${i}">${c.peajes ? fmtGs(c.peajes) : "—"}</td>
      <td class="td-viatico ${on ? "" : "off"}" id="r-via-${i}">${on ? fmtGs(c.viaticos) : "—"}</td>
      <td class="col-detalle">
        <button type="button" class="icon-btn ${abrirCli ? "open" : ""}" id="btn-cli-${i}" onclick="App.toggleRow('cli',${i})" title="Clientes visitados" aria-expanded="${abrirCli}">👥<span class="badge" id="badge-cli-${i}">${nCli || ""}</span></button>
        <button type="button" class="icon-btn ${abrirPea ? "open" : ""}" id="btn-pea-${i}" onclick="App.toggleRow('pea',${i})" title="Peajes" aria-expanded="${abrirPea}">🛣️<span class="badge" id="badge-pea-${i}">${nPea || ""}</span></button>
        <button type="button" class="icon-btn ${on ? "on" : ""}" id="btn-via-${i}" onclick="${ed ? `App.toggleVia(${i})` : `App.toggleRow('via',${i})`}" title="${ed ? (on ? "Deshabilitar viáticos" : "Habilitar viáticos") : "Viáticos"}" aria-pressed="${on}">🍽️</button>
      </td>
    </tr>
    <tr class="detalle-row" id="row-cli-${i}" ${abrirCli ? "" : "hidden"}>
      <td colspan="10"><div class="detalle-box">
        <div class="detalle-titulo">👥 Clientes visitados · ${DIAS[i]}
          ${ed ? `<button type="button" class="btn btn-outline btn-sm" onclick="App.addCli(${i})">+ Agregar cliente</button>` : ""}
        </div>
        <div class="clientes-lista" id="lista-cli-${i}">${listaClientes(sol, i, ed)}</div>
      </div></td>
    </tr>
    <tr class="detalle-row" id="row-pea-${i}" ${abrirPea ? "" : "hidden"}>
      <td colspan="10"><div class="detalle-box peajes">
        <div class="detalle-titulo">🛣️ Peajes · ${DIAS[i]}<span class="dia-total">Total peajes del día: <strong id="v-pea-sub-${i}">Gs. ${fmtGs(c.peajes)}</strong></span></div>
        <div class="peajes-wrap">${panelPeaje(sol, i, "ida", ed)}${panelPeaje(sol, i, "vuelta", ed)}</div>
      </div></td>
    </tr>
    <tr class="detalle-row" id="row-via-${i}" ${on ? "" : "hidden"}>
      <td colspan="10"><div class="detalle-box viaticos">
        <div class="detalle-titulo">🍽️ Viáticos · ${DIAS[i]}${!ed && !on ? ` <span class="muted" style="text-transform:none;font-weight:400;">(sin viáticos este día)</span>` : ""}</div>
        <div class="via-grid">
          <label class="field">Desayuno (Gs.)<input type="number" min="0" value="${nz(d.viaticos.desayuno)}" placeholder="0" ${dis} oninput="App.via(${i},'desayuno',this.value)"></label>
          <label class="field">Almuerzo / cena (Gs.)<input type="number" min="0" value="${nz(d.viaticos.almuerzo)}" placeholder="0" ${dis} oninput="App.via(${i},'almuerzo',this.value)"></label>
          <label class="field">Alojamiento (Gs.)<input type="number" min="0" value="${nz(d.viaticos.alojamiento)}" placeholder="0" ${dis} oninput="App.via(${i},'alojamiento',this.value)"></label>
          <div class="sub-total">Total viáticos del día<span id="v-sub-${i}">Gs. ${fmtGs(c.viaticos)}</span></div>
        </div>
      </div></td>
    </tr>`;
}

function recorridoHTML(sol, ed, veh) {
  const t = calcularSolicitud(sol, veh);
  const rend = sol.tipo === "rendicion";
  return `
  <div class="card">
    <div class="card-head">
      <h2>🚗 ${rend ? "Recorrido realizado" : "Recorrido presupuestado"}</h2>
      <span class="sub">👥 clientes visitados · 🛣️ peajes · 🍽️ ${ed ? "habilitar viáticos del día" : "viáticos"}</span>
    </div>
    <div class="card-body">
      <div style="overflow-x:auto;">
      <table id="tabla-recorrido">
        <thead><tr>
          <th style="width:88px;">Día</th>
          <th style="width:128px;">Fecha</th>
          <th>Destino desde</th>
          <th>Destino hasta</th>
          <th style="width:78px;">${rend ? "Total kms recorridos" : "Total kms a recorrer"}</th>
          <th style="width:92px;">Adicional AA (Gs.)</th>
          <th style="width:104px;">Importe combustible + AA (Gs.)</th>
          <th style="width:80px;text-align:right;">Peajes (Gs.)</th>
          <th style="width:80px;text-align:right;">Viáticos (Gs.)</th>
          <th class="col-detalle">Detalle</th>
        </tr></thead>
        <tbody>${DIAS.map((_, i) => filaDia(sol, i, ed, veh)).join("")}</tbody>
        <tfoot><tr>
          <td colspan="4" style="text-align:right;">TOTALES</td>
          <td id="tot-kms">${fmtGs(t.kms)}</td>
          <td id="tot-adic">${fmtGs(t.adic)}</td>
          <td id="tot-importe">${fmtGs(t.combAA)}</td>
          <td id="tot-peajes" style="text-align:right;">${fmtGs(t.peajesTot)}</td>
          <td id="tot-viaticos" style="text-align:right;">${fmtGs(t.viatTot)}</td>
          <td class="col-detalle"></td>
        </tr></tfoot>
      </table>
      </div>
      <div class="nota">⚠ El <strong>adicional AA (Gs. ${AA_POR_KM}/km)</strong> se aplica automáticamente solo cuando la fecha del día cae entre <strong>octubre y abril</strong>.</div>
      <div id="totales-box">${totalesHTML(t, sol.tipo)}</div>
      ${balanceHTML(sol, t, ed)}
    </div>
  </div>`;
}

function totalesHTML(t, tipo) {
  return `
    <div class="resumen-totales">
      <div class="stat">
        <div class="lbl">${tipo === "rendicion" ? "TOTAL KMS RECORRIDO" : "TOTAL KMS PRESUPUESTADO"}</div>
        <div class="val">${fmtGs(t.kms)}</div>
      </div>
      <div class="stat alt">
        <div class="lbl">TOTAL IMPORTE MOVILIDAD</div>
        <div class="val">Gs. ${fmtGs(t.movilidad)}</div>
        <div class="desglose">Combustible Gs. ${fmtGs(t.combustible)} · Adicional AA Gs. ${fmtGs(t.adic)} · Peajes Gs. ${fmtGs(t.peajesTot)}</div>
      </div>
      <div class="stat viat">
        <div class="lbl">TOTAL IMPORTE VIÁTICOS</div>
        <div class="val">Gs. ${fmtGs(t.viatTot)}</div>
        <div class="desglose">Desayuno Gs. ${fmtGs(t.des)} · Almuerzo/cena Gs. ${fmtGs(t.alm)} · Alojamiento Gs. ${fmtGs(t.alo)}</div>
      </div>
    </div>`;
}

const textoSaldo = (s) => (s > 0 ? "SALDO A REINTEGRAR AL VENDEDOR" : s < 0 ? "SALDO A DEVOLVER A LA EMPRESA" : "SIN SALDO PENDIENTE");

function balanceHTML(sol, t, ed) {
  const rend = sol.tipo === "rendicion";
  return `
    <div class="balance">
      <div class="bal-item">
        <span class="bal-lbl">${rend ? "TOTAL RENDIDO" : "TOTAL ANTICIPO SOLICITADO"}</span>
        <span class="bal-val" id="bal-total">Gs. ${fmtGs(t.total)}</span>
        <span class="bal-sub">Total importe movilidad + total importe viáticos</span>
      </div>
      ${rend ? `
      <div class="bal-op">−</div>
      <div class="bal-item">
        <label class="bal-lbl" for="f-anticipo">ANTICIPO RECIBIDO (Gs.)</label>
        ${ed ? `<input type="number" min="0" id="f-anticipo" value="${nz(sol.anticipoRecibido)}" placeholder="0" oninput="App.f('anticipoRecibido',this.value)">`
             : `<span class="bal-val">Gs. ${fmtGs(t.anticipo)}</span>`}
      </div>
      <div class="bal-op">=</div>
      <div class="bal-item saldo ${t.saldo < 0 ? "neg" : ""}" id="bal-saldo-box">
        <span class="bal-lbl" id="bal-saldo-lbl">${textoSaldo(t.saldo)}</span>
        <span class="bal-val" id="bal-saldo">Gs. ${fmtGs(Math.abs(t.saldo))}</span>
      </div>` : ""}
    </div>`;
}

function comprobantesHTML(sol, ed) {
  const fotos = sol.fotos || [];
  const thumbs = fotos.map((f, k) => {
    const esImg = f.tipo.startsWith("image/");
    return `<div class="thumb" onclick="App.verFoto(${k})" title="${esc(f.nombre)}">
      <div class="img" style="${esImg && sol.id ? `background-image:url('${fotoUrl(sol.id, f.id)}')` : ""}">${esImg ? "" : "📄"}</div>
      <div class="cap">${esc(f.nombre)}</div>
      ${ed ? `<button type="button" class="btn btn-rojo btn-sm del" onclick="event.stopPropagation();App.borrarFoto('${f.id}')" title="Quitar comprobante">✕</button>` : ""}
    </div>`;
  }).join("");
  return `
  <div class="card">
    <div class="card-head">
      <h2>🧾 Comprobantes · fotos de facturas</h2>
      <span class="sub">${fotos.length} archivo${fotos.length === 1 ? "" : "s"}${ed ? " · obligatorio para enviar la rendición" : ""}</span>
    </div>
    <div class="card-body">
      ${ed ? `
      <label class="dropzone" id="dropzone">
        <input type="file" id="file-input" accept="image/*,application/pdf" multiple hidden onchange="App.subir(this.files);this.value='';">
        📷 <strong>Tocá para sacar o elegir fotos</strong> o arrastralas acá
        <small>Fotos JPG, PNG o PDF. Las fotos se reducen automáticamente antes de subirlas.</small>
      </label>` : ""}
      <div class="galeria" id="galeria">${thumbs || `<div class="galeria-vacia">${ed ? "Todavía no subiste comprobantes." : "Sin comprobantes."}</div>`}</div>
    </div>
  </div>`;
}

/* ============================================================ EDITOR (vendedor) */
function solNueva() {
  const h = hoy();
  return {
    tipo: "anticipo", fechaDoc: h, desde: h, hasta: "", semana: semanaMes(h),
    dias: DIAS.map(diaVacio), anticipoRecibido: 0, observacionVendedor: "",
    fotos: [], estado: "BORRADOR", historial: [],
  };
}

function renderEditor() {
  if (!S.sol || !(S.sol.estado === "BORRADOR" || S.sol.estado === "DEVUELTA")) S.sol = solNueva();
  const sol = S.sol;
  const veh = vehiculoActual();
  const rend = sol.tipo === "rendicion";
  const devuelta = sol.estado === "DEVUELTA";
  const ultimaDev = [...(sol.historial || [])].reverse().find((h) => h.accion.startsWith("Devolvió"));
  $("main").innerHTML = `
  <section>
    ${devuelta && ultimaDev ? `<div class="banner devuelta" style="margin-bottom:18px;">↩️<div><strong>${esc(ultimaDev.nombre)} (${esc(ROLES[ultimaDev.rol])}) te devolvió esta ${rend ? "rendición" : "solicitud"} para corregir</strong>${esc(ultimaDev.comentario)}<div class="muted" style="font-size:.72rem;margin-top:4px;">${fFechaHora(ultimaDev.fecha)}</div></div></div>` : ""}
    ${!veh || !veh.consumo ? `<div class="banner rechazada" style="margin-bottom:18px;">⚠️<div><strong>Tu vehículo no está configurado</strong>Pedile a Administración que cargue marca, modelo, combustible y consumo en Parámetros; sin esos datos el importe de combustible queda en cero.</div></div>` : ""}
    <div class="card">
      <div class="card-head">
        <h2>🗓️ ${rend ? "Datos de la rendición de gastos" : "Datos de la solicitud de anticipo"}</h2>
        <span class="sub">${sol.id ? `N° ${esc(sol.numero)} · ${ESTADOS[sol.estado]}` : "Nueva · todavía no guardada"}</span>
      </div>
      <div class="card-body">
        <div class="tipo-switch" role="radiogroup" aria-label="Tipo de trámite">
          <button type="button" class="tipo-opt ${!rend ? "active" : ""}" role="radio" aria-checked="${!rend}" ${devuelta ? "disabled" : ""} onclick="App.setTipo('anticipo')">
            <strong>💵 Solicitud de anticipo</strong><span>Gastos presupuestados, antes de salir a ruta</span>
          </button>
          <button type="button" class="tipo-opt ${rend ? "active" : ""}" role="radio" aria-checked="${rend}" ${devuelta ? "disabled" : ""} onclick="App.setTipo('rendicion')">
            <strong>🧾 Rendición de gastos</strong><span>Gastos realizados, para reintegro de la empresa</span>
          </button>
        </div>
        <div class="grid grid-4">
          <label class="field">${rend ? "Fecha rendición" : "Fecha solicitud"}<input type="date" value="${sol.fechaDoc}" oninput="App.f('fechaDoc',this.value)"></label>
          <label class="field">Fecha desde<input type="date" value="${sol.desde}" oninput="App.f('desde',this.value)"></label>
          <label class="field">Fecha hasta<input type="date" value="${sol.hasta}" oninput="App.f('hasta',this.value)"></label>
          <label class="field">Semana / Mes<input type="number" id="f-semana" min="1" max="6" value="${sol.semana}" oninput="App.f('semana',this.value)"></label>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>🧑‍💼 Datos del vendedor</h2></div>
      <div class="card-body">
        <div class="grid grid-3" style="margin-bottom:14px;">
          <label class="field">Vendedor<input type="text" readonly value="${esc(S.user.nombre)}"></label>
          <label class="field">Marca vehículo<input type="text" readonly value="${esc(veh?.marca || "")}"></label>
          <label class="field">Modelo<input type="text" readonly value="${esc(veh?.modelo || "")}"></label>
        </div>
        <div class="grid grid-4">
          <label class="field">Tipo combustible<input type="text" readonly value="${esc(veh?.tipo || "")}"></label>
          <label class="field">Combustible<input type="text" readonly value="${esc(veh?.combustible || "")}"></label>
          <label class="field">Consumo /100km<input type="text" readonly value="${veh ? `${veh.consumo} L` : ""}"></label>
          <label class="field">Precio Gs./L<input type="text" readonly value="Gs. ${fmtGs(veh?.precioL)}"></label>
        </div>
      </div>
    </div>

    <div id="recorrido-wrap">${recorridoHTML(sol, true, veh)}</div>
    ${rend ? `<div id="comprobantes-wrap">${comprobantesHTML(sol, true)}</div>` : ""}

    <div class="card">
      <div class="card-head"><h2>💬 Comentario para el revisor <span class="sub">— opcional</span></h2></div>
      <div class="card-body">
        <textarea id="f-obs" placeholder="Aclaraciones sobre el recorrido, gastos o comprobantes" oninput="App.f('observacionVendedor',this.value)">${esc(sol.observacionVendedor)}</textarea>
        <div class="acciones-row">
          <button class="btn btn-outline" onclick="App.guardar()">💾 Guardar borrador</button>
          <button class="btn btn-azul" onclick="App.enviar()">📤 ${devuelta ? "Reenviar corregida" : "Enviar a revisión"}</button>
          ${sol.id && sol.estado === "BORRADOR" ? `<button class="btn btn-rojo" onclick="App.eliminar()">🗑️ Eliminar borrador</button>` : ""}
          ${sol.id ? `<button class="btn btn-outline" onclick="App.nueva()">➕ Nueva</button>` : ""}
          <button class="btn btn-outline" onclick="window.print()">🖨️ Imprimir / PDF</button>
        </div>
      </div>
    </div>
  </section>`;
  refrescarCalculo();
  if (rend) activarDropzone();
}

function refrescarCalculo() {
  const sol = S.sol;
  if (!sol || S.vista !== "editor") return;
  const veh = vehiculoActual();
  sol.dias.forEach((d, i) => {
    const c = calcularDia(d, veh);
    $(`r-adic-${i}`).value = fmtGs(c.adicional);
    $(`r-total-${i}`).value = fmtGs(c.combAA);
    const tp = $(`r-pea-${i}`); tp.textContent = c.peajes ? fmtGs(c.peajes) : "—"; tp.classList.toggle("off", !c.peajes);
    const tv = $(`r-via-${i}`); tv.textContent = d.viaticos.on ? fmtGs(c.viaticos) : "—"; tv.classList.toggle("off", !d.viaticos.on);
    $(`v-sub-${i}`).textContent = `Gs. ${fmtGs(c.viaticos)}`;
    $(`v-pea-sub-${i}`).textContent = `Gs. ${fmtGs(c.peajes)}`;
    ["ida", "vuelta"].forEach((tr) => {
      d.peajes[tr].forEach((p, j) => { const el = $(`p-${i}-${tr}-sub-${j}`); if (el) el.textContent = fmtGs((Number(p.cant) || 0) * (Number(p.monto) || 0)); });
      $(`tot-pea-${i}-${tr}`).textContent = fmtGs(tr === "ida" ? c.peajesIda : c.peajesVuelta);
    });
    const nPea = ["ida", "vuelta"].reduce((s, t) => s + d.peajes[t].reduce((a, p) => a + (Number(p.cant) || 0), 0), 0);
    $(`badge-pea-${i}`).textContent = nPea || "";
    $(`badge-cli-${i}`).textContent = d.clientes.filter((x) => x.trim()).length || "";
  });
  const t = calcularSolicitud(sol, veh);
  $("tot-kms").textContent = fmtGs(t.kms);
  $("tot-adic").textContent = fmtGs(t.adic);
  $("tot-importe").textContent = fmtGs(t.combAA);
  $("tot-peajes").textContent = fmtGs(t.peajesTot);
  $("tot-viaticos").textContent = fmtGs(t.viatTot);
  $("totales-box").innerHTML = totalesHTML(t, sol.tipo);
  $("bal-total").textContent = `Gs. ${fmtGs(t.total)}`;
  if (sol.tipo === "rendicion") {
    $("bal-saldo-lbl").textContent = textoSaldo(t.saldo);
    $("bal-saldo").textContent = `Gs. ${fmtGs(Math.abs(t.saldo))}`;
    $("bal-saldo-box").classList.toggle("neg", t.saldo < 0);
  }
}

function activarDropzone() {
  const dz = $("dropzone");
  if (!dz) return;
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", (e) => { if (e.dataTransfer?.files?.length) App.subir(e.dataTransfer.files); });
}

function datosParaGuardar(sol) {
  const { tipo, fechaDoc, desde, hasta, semana, dias, anticipoRecibido, observacionVendedor } = sol;
  return { tipo, fechaDoc, desde, hasta, semana, dias, anticipoRecibido, observacionVendedor };
}

async function guardarSol({ silencioso = false } = {}) {
  const sol = S.sol;
  const r = sol.id ? await api("PUT", `solicitudes/${sol.id}`, datosParaGuardar(sol)) : await api("POST", "solicitudes", datosParaGuardar(sol));
  S.sol = r;
  cargarLista().catch(() => {});
  if (!silencioso) { toast(`Borrador ${r.numero} guardado.`); renderEditor(); }
  return r;
}

// Reduce las fotos a un tamaño razonable (lado mayor 1800 px, JPEG) antes de subirlas.
async function prepararArchivo(file) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 1800;
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.82));
    if (!blob) return file;
    const nombre = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nombre, { type: "image/jpeg" });
  } catch {
    return file; // si el navegador no puede leerla (p. ej. HEIC), se sube tal cual
  }
}

/* ============================================================ LISTAS */
function filaLista(s) {
  const t = s.totales || {};
  const saldo = s.tipo === "rendicion"
    ? `<span style="color:${t.saldo < 0 ? "var(--rojo)" : "var(--verde)"};font-weight:700;">${fmtGs(Math.abs(t.saldo))}</span><br><span class="muted" style="font-size:.66rem;">${t.saldo > 0 ? "a reintegrar" : t.saldo < 0 ? "a devolver" : "sin saldo"}</span>`
    : `<span class="muted">—</span>`;
  return `<tr class="link-row" onclick="App.abrir('${s.id}')">
    <td style="font-weight:700;color:var(--azul-oscuro);white-space:nowrap;">${esc(s.numero)}</td>
    <td>${pillTipo(s.tipo)}</td>
    <td>${esc(s.semana)}</td>
    <td>${esc(s.vendedorNombre)}</td>
    <td style="white-space:nowrap;">${fFecha(s.fechaDoc)}</td>
    <td class="num">${fmtGs(t.kms)}</td>
    <td class="num">${fmtGs(t.movilidad)}</td>
    <td class="num">${fmtGs(t.viatTot)}</td>
    <td class="num" style="font-weight:700;">${fmtGs(t.total)}</td>
    <td class="num">${saldo}</td>
    <td>${pillEstado(s.estado)}</td>
    <td class="num">${s.pago ? `${fmtGs(s.pago.importe)}<br><span class="muted" style="font-size:.66rem;">${fFecha(s.pago.fecha)}</span>` : `<span class="muted">—</span>`}</td>
    <td class="no-print"><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();App.abrir('${s.id}')">${S.user.rol === "VENDEDOR" && (s.estado === "BORRADOR" || s.estado === "DEVUELTA") ? "Editar" : "Ver"}</button></td>
  </tr>`;
}

function tablaLista(items, vacio) {
  return `<div style="overflow-x:auto;"><table id="tabla-historial">
    <thead><tr>
      <th>N°</th><th>Tipo</th><th>Semana / Mes</th><th>Vendedor</th><th>Fecha</th>
      <th class="num">Total kms</th><th class="num">Total importe movilidad (Gs.)</th><th class="num">Total importe viáticos (Gs.)</th>
      <th class="num">Total solicitado / rendido (Gs.)</th><th class="num">Saldo rendición (Gs.)</th><th>Estado</th><th class="num">Total importe reintegro (Gs.)</th><th class="no-print"></th>
    </tr></thead>
    <tbody>${items.length ? items.map(filaLista).join("") : `<tr><td colspan="13" style="text-align:center;color:var(--gris);padding:22px;">${vacio}</td></tr>`}</tbody>
  </table></div>`;
}

function renderHistorial() {
  const f = S.filtros;
  const vendedores = [...new Set(S.lista.map((s) => s.vendedorNombre))].sort();
  const items = S.lista.filter((s) => (!f.vendedor || s.vendedorNombre === f.vendedor) && (!f.tipo || s.tipo === f.tipo) && (!f.estado || s.estado === f.estado));
  const esVend = S.user.rol === "VENDEDOR";
  $("main").innerHTML = `
  <section><div class="card">
    <div class="card-head"><h2>📊 Resumen Histórico</h2><span class="sub">${items.length} de ${S.lista.length} registros</span></div>
    <div class="card-body">
      <div class="toolbar no-print">
        ${esVend ? "" : `<label class="field">Filtrar por vendedor<select onchange="App.filtro('vendedor',this.value)"><option value="">Todos los vendedores</option>${vendedores.map((v) => `<option ${v === f.vendedor ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`}
        <label class="field">Filtrar por tipo<select onchange="App.filtro('tipo',this.value)">
          <option value="">Anticipos y rendiciones</option>
          <option value="anticipo" ${f.tipo === "anticipo" ? "selected" : ""}>Solo solicitudes de anticipo</option>
          <option value="rendicion" ${f.tipo === "rendicion" ? "selected" : ""}>Solo rendiciones de gastos</option>
        </select></label>
        <label class="field">Filtrar por estado<select onchange="App.filtro('estado',this.value)">
          <option value="">Todos los estados</option>
          ${Object.entries(ESTADOS).filter(([k]) => !esVend ? k !== "BORRADOR" : true).map(([k, v]) => `<option value="${k}" ${f.estado === k ? "selected" : ""}>${v}</option>`).join("")}
        </select></label>
      </div>
      ${tablaLista(items, S.lista.length ? "No hay registros para el filtro seleccionado." : esVend ? "Todavía no cargaste solicitudes ni rendiciones." : "Todavía no hay solicitudes enviadas.")}
      <div class="acciones-row">
        <button class="btn btn-outline" onclick="App.recargar()">🔄 Actualizar</button>
        <button class="btn btn-outline" onclick="App.csvLista()">⬇️ Exportar CSV</button>
        <button class="btn btn-outline" onclick="window.print()">🖨️ Imprimir / PDF</button>
      </div>
    </div>
  </div></section>`;
}

function renderBandeja() {
  const r = S.user.rol;
  const pend = S.lista.filter((s) => s.estado === (r === "CONTROL" ? "PENDIENTE_CONTROL" : "PENDIENTE_ADMIN"));
  const pagos = r === "ADMIN" ? S.lista.filter((s) => s.estado === "APROBADA") : [];
  $("main").innerHTML = `
  <section>
    <div class="card">
      <div class="card-head"><h2>📥 Pendientes de tu revisión</h2><span class="sub">${r === "CONTROL" ? "Enviadas por los vendedores" : "Ya verificadas por Control de gestión"}</span></div>
      <div class="card-body">
        ${tablaLista(pend, "No tenés solicitudes pendientes de revisión. 🎉")}
        <div class="acciones-row"><button class="btn btn-outline" onclick="App.recargar()">🔄 Actualizar</button></div>
      </div>
    </div>
    ${r === "ADMIN" ? `
    <div class="card">
      <div class="card-head"><h2>💳 Aprobadas · pendientes de pago o reintegro</h2></div>
      <div class="card-body">${tablaLista(pagos, "No hay aprobadas pendientes de pago.")}</div>
    </div>` : ""}
  </section>`;
}

/* ============================================================ DETALLE / REVISIÓN */
function flujoHTML(s) {
  const pasos = ["Vendedor", "Control de gestión", "Administración", s.estado === "PAGADA" ? "Pagada" : s.estado === "RECHAZADA" ? "Rechazada" : "Aprobada"];
  let actual = 0, hechos = 0, error = -1;
  switch (s.estado) {
    case "BORRADOR": case "DEVUELTA": actual = 0; hechos = 0; break;
    case "PENDIENTE_CONTROL": actual = 1; hechos = 1; break;
    case "PENDIENTE_ADMIN": actual = 2; hechos = 2; break;
    case "APROBADA": actual = 3; hechos = 3; break;
    case "PAGADA": actual = -1; hechos = 4; break;
    case "RECHAZADA": {
      const rech = [...(s.historial || [])].reverse().find((h) => h.accion.startsWith("Rechaz"));
      error = rech?.rol === "ADMIN" ? 2 : 1; hechos = error; actual = -1; break;
    }
  }
  return `<div class="flujo" aria-label="Circuito de aprobación">${pasos.map((p, k) => {
    const cls = k === error ? "error" : k < hechos ? "hecho" : k === actual ? "actual" : "";
    const icono = k === error ? "✕" : k < hechos ? "✓" : k + 1;
    return `${k ? `<span class="linea ${k <= hechos ? "hecho" : ""}"></span>` : ""}<span class="paso ${cls}"><span class="dot">${icono}</span>${p}${k === 3 && s.estado === "APROBADA" ? " · pago pendiente" : ""}</span>`;
  }).join("")}</div>`;
}

function timelineHTML(s) {
  return `<ul class="timeline">${[...(s.historial || [])].reverse().map((h) => `
    <li><span class="tl-dot ${h.rol}"></span><div>
      <div class="tl-t">${esc(h.accion)}</div>
      <div class="tl-m">${esc(h.nombre)} · ${esc(ROLES[h.rol] || h.rol)} · ${fFechaHora(h.fecha)}</div>
      ${h.comentario ? `<div class="tl-c">${esc(h.comentario)}</div>` : ""}
    </div></li>`).join("")}</ul>`;
}

function turnoDe(s) {
  const r = S.user.rol;
  return (r === "CONTROL" && s.estado === "PENDIENTE_CONTROL") || (r === "ADMIN" && s.estado === "PENDIENTE_ADMIN");
}

function revisionHTML(s) {
  const r = S.user.rol;
  const rend = s.tipo === "rendicion";
  const items = [
    ["recorrido", "Recorrido, fechas, destinos y kms verificados"],
    ["peajes", "Peajes verificados"],
    ["viaticos", "Viáticos verificados"],
    ...(rend ? [["comprobantes", "Fotos de facturas verificadas y coinciden con los montos"]] : []),
  ];
  const aprobar = r === "CONTROL" ? "✅ Aprobar y pasar a Administración" : rend ? "✅ Aprobar rendición" : "✅ Aprobar anticipo";
  return `
  <div class="revision">
    <div class="rev-head">🔍 Revisión · ${esc(ROLES[r])}</div>
    <div class="rev-body">
      <div class="checklist">${items.map(([k, l]) => `<label><input type="checkbox" class="chk" data-k="${k}" onchange="App.chk()"> ${l}</label>`).join("")}</div>
      <label class="field">Comentario<textarea id="rev-coment" placeholder="Obligatorio para devolver o rechazar. Opcional al aprobar."></textarea></label>
      <div class="acciones-row" style="margin-top:0;">
        <button class="btn btn-verde" id="btn-aprobar" disabled onclick="App.accion('aprobar')">${aprobar}</button>
        <button class="btn btn-naranja" onclick="App.accion('devolver')">↩️ Devolver al vendedor</button>
        <button class="btn btn-rojo-solid" onclick="App.accion('rechazar')">⛔ Rechazar</button>
      </div>
      <div class="muted" style="font-size:.74rem;">Para aprobar, marcá todas las verificaciones. <strong>Devolver</strong> permite que el vendedor corrija y reenvíe; <strong>Rechazar</strong> cierra el trámite.</div>
    </div>
  </div>`;
}

function pagoHTML(s) {
  const t = s.totales;
  const rend = s.tipo === "rendicion";
  const importe = rend ? Math.abs(t.saldo) : t.total;
  const titulo = !rend ? "💳 Registrar pago del anticipo" : t.saldo > 0 ? "💳 Registrar reintegro al vendedor" : t.saldo < 0 ? "💳 Registrar devolución recibida del vendedor" : "💳 Cerrar rendición (sin saldo)";
  return `
  <div class="revision" style="border-color:var(--verde);">
    <div class="rev-head" style="background:var(--verde);">${titulo}</div>
    <div class="rev-body">
      <div class="grid grid-3">
        <label class="field">Importe (Gs.)<input type="number" id="pago-importe" min="0" value="${importe}"></label>
        <label class="field">Fecha<input type="date" id="pago-fecha" value="${hoy()}"></label>
        <label class="field">Referencia (N° transferencia, recibo)<input type="text" id="pago-ref" maxlength="80"></label>
      </div>
      <label class="field">Comentario<textarea id="pago-coment" placeholder="Opcional"></textarea></label>
      <div class="acciones-row" style="margin-top:0;"><button class="btn btn-verde" onclick="App.registrarPago()">Registrar y cerrar el circuito</button></div>
    </div>
  </div>`;
}

function renderDetalle() {
  const s = S.detalle;
  if (!s) return go("historial");
  const veh = s.vehiculo || {};
  const rend = s.tipo === "rendicion";
  const ult = (pref) => [...(s.historial || [])].reverse().find((h) => h.accion.startsWith(pref));
  const dev = s.estado === "DEVUELTA" ? ult("Devolvió") : null;
  const rech = s.estado === "RECHAZADA" ? ult("Rechaz") : null;
  $("main").innerHTML = `
  <section>
    <div class="acciones-row no-print" style="margin:0 0 14px;">
      <button class="btn btn-outline" onclick="App.volver()">← Volver</button>
      <button class="btn btn-outline" onclick="window.print()">🖨️ Imprimir / PDF</button>
      <button class="btn btn-outline" onclick="App.csvDetalle()">⬇️ Exportar CSV</button>
    </div>
    <div class="card">
      <div class="card-head"><h2>${rend ? "🧾 Rendición de gastos" : "💵 Solicitud de anticipo"}</h2><span class="sub">Última actualización ${fFechaHora(s.actualizado)}</span></div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:14px;">
        <div class="doc-head">
          <div><div class="doc-num">N° ${esc(s.numero)}</div><div class="doc-meta">${esc(s.vendedorNombre)} · creada ${fFechaHora(s.creado)}</div></div>
          <div>${pillEstado(s.estado)}</div>
        </div>
        ${flujoHTML(s)}
        ${dev ? `<div class="banner devuelta">↩️<div><strong>Devuelta por ${esc(dev.nombre)} (${esc(ROLES[dev.rol])})</strong>${esc(dev.comentario)}</div></div>` : ""}
        ${rech ? `<div class="banner rechazada">⛔<div><strong>Rechazada por ${esc(rech.nombre)} (${esc(ROLES[rech.rol])})</strong>${esc(rech.comentario)}</div></div>` : ""}
        ${s.pago ? `<div class="banner ok">✅<div><strong>${rend && s.totales.saldo < 0 ? "Devolución registrada" : "Pago / reintegro registrado"}: Gs. ${fmtGs(s.pago.importe)} el ${fFecha(s.pago.fecha)}</strong>${s.pago.referencia ? `Referencia: ${esc(s.pago.referencia)}` : ""}</div></div>` : ""}
        <div class="kv">
          <div>${rend ? "Fecha rendición" : "Fecha solicitud"}<span>${fFecha(s.fechaDoc) || "—"}</span></div>
          <div>Fecha desde<span>${fFecha(s.desde) || "—"}</span></div>
          <div>Fecha hasta<span>${fFecha(s.hasta) || "—"}</span></div>
          <div>Semana / Mes<span>${esc(s.semana)}</span></div>
          <div>Vehículo<span>${esc([veh.marca, veh.modelo].filter(Boolean).join(" ") || "—")}</span></div>
          <div>Combustible<span>${esc(veh.combustible || "—")} ${veh.tipo ? `(${esc(veh.tipo)})` : ""}</span></div>
          <div>Consumo /100km<span>${veh.consumo || 0} L</span></div>
          <div>Precio Gs./L<span>Gs. ${fmtGs(veh.precioL)}</span></div>
        </div>
      </div>
    </div>
    ${recorridoHTML(s, false, veh)}
    ${rend ? comprobantesHTML(s, false) : ""}
    ${s.observacionVendedor ? `<div class="card"><div class="card-head"><h2>💬 Comentario del vendedor</h2></div><div class="card-body" style="white-space:pre-wrap;font-size:.86rem;">${esc(s.observacionVendedor)}</div></div>` : ""}
    ${turnoDe(s) ? `<div style="margin-bottom:22px;">${revisionHTML(s)}</div>` : ""}
    ${S.user.rol === "ADMIN" && s.estado === "APROBADA" ? `<div style="margin-bottom:22px;">${pagoHTML(s)}</div>` : ""}
    <div class="card">
      <div class="card-head"><h2>🕓 Historial del trámite</h2></div>
      <div class="card-body">${timelineHTML(s)}</div>
    </div>
  </section>`;
}

/* ============================================================ VISOR DE COMPROBANTES */
function renderLightbox() {
  document.querySelector(".lightbox")?.remove();
  if (!S.lb) return;
  const { sol, k } = S.lb;
  const f = sol.fotos[k];
  const url = fotoUrl(sol.id, f.id);
  const esImg = f.tipo.startsWith("image/");
  const el = document.createElement("div");
  el.className = "lightbox";
  el.innerHTML = `
    ${sol.fotos.length > 1 ? `<button class="lb-nav lb-prev" aria-label="Anterior" data-a="prev">‹</button><button class="lb-nav lb-next" aria-label="Siguiente" data-a="next">›</button>` : ""}
    ${esImg ? `<img src="${url}" alt="${esc(f.nombre)}">` : `<div style="color:#fff;font-size:3rem;">📄</div>`}
    <div class="lb-bar">
      <span>${k + 1} / ${sol.fotos.length} · ${esc(f.nombre)}</span>
      <a href="${url}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Abrir en pestaña nueva</a>
      <button class="btn btn-ghost btn-sm" data-a="close">Cerrar ✕</button>
    </div>`;
  el.addEventListener("click", (e) => {
    const a = e.target.dataset?.a;
    if (a === "prev") App.lbMover(-1);
    else if (a === "next") App.lbMover(1);
    else if (a === "close" || e.target === el) App.lbCerrar();
  });
  document.body.appendChild(el);
}
document.addEventListener("keydown", (e) => {
  if (!S.lb) return;
  if (e.key === "Escape") App.lbCerrar();
  if (e.key === "ArrowLeft") App.lbMover(-1);
  if (e.key === "ArrowRight") App.lbMover(1);
});

/* ============================================================ PARÁMETROS (Administración) */
function renderParametros() {
  if (!S.cfgEdit) S.cfgEdit = clon(S.config);
  const c = S.cfgEdit;
  const optsComb = (sel) => `<option value="">—</option>` + c.combustibles.map((x) => `<option ${x.producto === sel ? "selected" : ""}>${esc(x.producto)}</option>`).join("");
  $("main").innerHTML = `
  <section>
    <div class="card">
      <div class="card-head">
        <h2>👤 Funcionarios, usuarios y vehículos <span class="sub">— editable</span></h2>
        <button class="btn btn-ghost btn-sm" onclick="App.addFunc()">+ Agregar funcionario</button>
      </div>
      <div class="card-body" style="overflow-x:auto;">
        <table id="tabla-usuarios">
          <thead><tr>
            <th style="width:36px;">ID</th><th>Usuario</th><th>Nombre completo</th><th>Cargo</th><th>Rol</th>
            <th>Marca vehículo</th><th>Modelo</th><th>Combustible</th><th style="width:80px;">Consumo /100km (L)</th>
            <th style="width:100px;">PIN nuevo</th><th style="width:54px;">Activo</th><th class="col-del"></th>
          </tr></thead>
          <tbody>${c.funcionarios.map((f, i) => `
            <tr>
              <td>${f.id || "nuevo"}</td>
              <td><input type="text" value="${esc(f.usuario)}" autocapitalize="none" oninput="App.pf(${i},'usuario',this.value.toLowerCase())"></td>
              <td><input type="text" value="${esc(f.nombre)}" oninput="App.pf(${i},'nombre',this.value)"></td>
              <td><input type="text" value="${esc(f.cargo)}" oninput="App.pf(${i},'cargo',this.value)"></td>
              <td><select onchange="App.pf(${i},'rol',this.value)">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === f.rol ? "selected" : ""}>${v}</option>`).join("")}</select></td>
              <td><input type="text" value="${esc(f.marca)}" oninput="App.pf(${i},'marca',this.value)"></td>
              <td><input type="text" value="${esc(f.modelo)}" oninput="App.pf(${i},'modelo',this.value)"></td>
              <td><select onchange="App.pf(${i},'combustible',this.value)">${optsComb(f.combustible)}</select></td>
              <td><input type="number" step="0.1" min="0" value="${f.consumo}" oninput="App.pf(${i},'consumo',this.value)"></td>
              <td><input type="password" inputmode="numeric" value="${esc(f.pinNuevo || "")}" placeholder="${f.id ? "sin cambios" : "obligatorio"}" oninput="App.pf(${i},'pinNuevo',this.value)"></td>
              <td style="text-align:center;"><input type="checkbox" ${f.activo !== false ? "checked" : ""} onchange="App.pf(${i},'activo',this.checked)" style="width:18px;height:18px;"></td>
              <td class="col-del"><button class="btn btn-rojo btn-sm" onclick="App.delFunc(${i})" title="Eliminar">✕</button></td>
            </tr>`).join("")}
          </tbody>
        </table>
        <div class="nota">🔑 El <strong>rol</strong> define qué ve cada persona: el <strong>vendedor</strong> carga solicitudes y rendiciones, <strong>Control de gestión</strong> las verifica y <strong>Administración</strong> las aprueba y registra el pago. Al asignar un <strong>PIN nuevo</strong>, la persona deberá cambiarlo en su primer ingreso. Para quitar el acceso sin perder el historial, desmarcá <strong>Activo</strong>.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>⛽ Combustibles y Precios <span class="sub">— editable</span></h2>
        <button class="btn btn-ghost btn-sm" onclick="App.addComb()">+ Agregar combustible</button>
      </div>
      <div class="card-body" style="overflow-x:auto;">
        <table id="tabla-combustibles">
          <thead><tr><th style="width:40px;">ID</th><th>Producto</th><th>Tipo</th><th>Precio vigente (Gs.)</th><th>% adicional</th><th>Precio final (Gs.)</th><th>Vigencia</th><th>Fecha últ. modificación</th><th class="col-del"></th></tr></thead>
          <tbody>${c.combustibles.map((x, i) => `
            <tr>
              <td>${x.id || "nuevo"}</td>
              <td><input type="text" value="${esc(x.producto)}" oninput="App.pc(${i},'producto',this.value)"></td>
              <td><select onchange="App.pc(${i},'tipo',this.value)">${["DIESEL", "NAFTA", "GAS"].map((t) => `<option ${t === x.tipo ? "selected" : ""}>${t}</option>`).join("")}</select></td>
              <td><input type="number" value="${x.precio}" oninput="App.pc(${i},'precio',this.value)"></td>
              <td><input type="number" step="0.01" value="${x.adic}" oninput="App.pc(${i},'adic',this.value)"></td>
              <td style="font-weight:700;color:var(--azul-oscuro);" id="pf-${i}">Gs. ${fmtGs(precioFinal(x))}</td>
              <td><input type="date" value="${x.vigencia || ""}" oninput="App.pc(${i},'vigencia',this.value)"></td>
              <td class="muted">${fFecha(x.fechaModif) || "se completa al guardar"}</td>
              <td class="col-del"><button class="btn btn-rojo btn-sm" onclick="App.delComb(${i})" title="Eliminar">✕</button></td>
            </tr>`).join("")}
          </tbody>
        </table>
        <div class="nota">💡 Lista de precios vigentes publicados por Petropar y que se le adiciona al precio un 5% del valor. Los cambios de precio aplican a las solicitudes que se guarden o envíen desde ahora; las ya enviadas conservan el precio con el que se calcularon.</div>
      </div>
    </div>
    <div class="acciones-row" style="margin-top:0;">
      <button class="btn btn-azul" onclick="App.guardarParams()">💾 Guardar parámetros</button>
      <button class="btn btn-outline" onclick="App.descartarParams()">Descartar cambios</button>
    </div>
  </section>`;
}

/* ============================================================ CSV */
function descargarCSV(nombre, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================ acciones (window.App) */
const App = {
  go,
  salir: async () => { if (await confirmar({ titulo: "Cerrar sesión", texto: "¿Querés salir de la herramienta?", ok: "Salir" })) cerrarSesion(); },
  cambiarPin: () => modalCambiarPin(false),

  // ---- editor ----
  f(campo, v) {
    const sol = S.sol;
    if (["semana", "anticipoRecibido"].includes(campo)) v = Number(v) || 0;
    sol[campo] = v;
    if (campo === "desde" && v) { sol.semana = semanaMes(v); const el = $("f-semana"); if (el) el.value = sol.semana; }
    if (campo === "anticipoRecibido") refrescarCalculo();
  },
  setTipo(t) { if (S.sol.tipo === t) return; S.sol.tipo = t; if (t !== "rendicion") S.sol.anticipoRecibido = 0; renderEditor(); },
  d(i, campo, v) { S.sol.dias[i][campo] = campo === "kms" ? Number(v) || 0 : v; refrescarCalculo(); },
  cli(i, j, v) { S.sol.dias[i].clientes[j] = v; refrescarCalculo(); },
  addCli(i) { S.sol.dias[i].clientes.push(""); $(`lista-cli-${i}`).innerHTML = listaClientes(S.sol, i, true); $(`cli-${i}-${S.sol.dias[i].clientes.length - 1}`)?.focus(); },
  delCli(i, j) { const c = S.sol.dias[i].clientes; c.splice(j, 1); if (!c.length) c.push(""); $(`lista-cli-${i}`).innerHTML = listaClientes(S.sol, i, true); refrescarCalculo(); },
  pea(i, tr, j, campo, v) { S.sol.dias[i].peajes[tr][j][campo] = Number(v) || 0; refrescarCalculo(); },
  addPea(i, tr) { S.sol.dias[i].peajes[tr].push({ cant: 0, monto: 0 }); $(`body-pea-${i}-${tr}`).innerHTML = filasPeaje(S.sol, i, tr, true); refrescarCalculo(); },
  delPea(i, tr, j) { const p = S.sol.dias[i].peajes[tr]; p.splice(j, 1); if (!p.length) p.push({ cant: 0, monto: 0 }); $(`body-pea-${i}-${tr}`).innerHTML = filasPeaje(S.sol, i, tr, true); refrescarCalculo(); },
  via(i, campo, v) { S.sol.dias[i].viaticos[campo] = Number(v) || 0; refrescarCalculo(); },
  toggleVia(i) {
    const v = S.sol.dias[i].viaticos; v.on = !v.on;
    $(`row-via-${i}`).hidden = !v.on;
    const b = $(`btn-via-${i}`); b.classList.toggle("on", v.on); b.setAttribute("aria-pressed", String(v.on));
    b.title = v.on ? "Deshabilitar viáticos" : "Habilitar viáticos";
    refrescarCalculo();
  },
  toggleRow(k, i) {
    const row = $(`row-${k}-${i}`); row.hidden = !row.hidden;
    const b = $(`btn-${k}-${i}`);
    if (k !== "via") { b.classList.toggle("open", !row.hidden); b.setAttribute("aria-expanded", String(!row.hidden)); }
  },
  async guardar() { try { await guardarSol(); } catch (e) { toast(e.message, true); } },
  async enviar() {
    const rend = S.sol.tipo === "rendicion";
    if (rend && !(S.sol.fotos || []).length) { toast("Para enviar una rendición tenés que subir las fotos de tus facturas.", true); $("dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const t = calcularSolicitud(S.sol, vehiculoActual());
    const ok = await confirmar({
      titulo: rend ? "Enviar rendición a revisión" : "Enviar solicitud de anticipo a revisión",
      texto: `Total ${rend ? "rendido" : "solicitado"}: <strong>Gs. ${fmtGs(t.total)}</strong>.<br>Pasará a Control de gestión y ya no podrás modificarla, salvo que te la devuelvan para corregir.`,
      ok: "Enviar",
    });
    if (!ok) return;
    try {
      await guardarSol({ silencioso: true });
      const r = await api("POST", `solicitudes/${S.sol.id}/accion`, { accion: "enviar" });
      toast(`${r.numero} enviada a Control de gestión.`);
      S.sol = null;
      await cargarLista();
      go("historial");
    } catch (e) { toast(e.message, true); }
  },
  async eliminar() {
    if (!(await confirmar({ titulo: "Eliminar borrador", texto: `Se eliminará el borrador ${esc(S.sol.numero)} y sus comprobantes. No se puede deshacer.`, ok: "Eliminar", clase: "btn-rojo-solid" }))) return;
    try { await api("DELETE", `solicitudes/${S.sol.id}`); S.sol = null; await cargarLista(); toast("Borrador eliminado."); renderEditor(); }
    catch (e) { toast(e.message, true); }
  },
  async nueva() {
    S.sol = null; renderEditor();
  },
  async subir(files) {
    const lista = [...(files || [])];
    if (!lista.length) return;
    try {
      if (!S.sol.id) await guardarSol({ silencioso: true });
      const gal = $("galeria");
      for (const [k, original] of lista.entries()) {
        const temp = document.createElement("div");
        temp.className = "thumb subiendo";
        temp.innerHTML = `<div class="img">⏳</div><div class="cap">Subiendo ${k + 1} de ${lista.length}…</div>`;
        gal.querySelector(".galeria-vacia")?.remove();
        gal.appendChild(temp);
        const file = await prepararArchivo(original);
        const r = await api("POST", `solicitudes/${S.sol.id}/fotos`, file, { headers: { "content-type": file.type || "application/octet-stream", "x-filename": encodeURIComponent(file.name) } });
        S.sol.fotos = r.fotos;
        S.sol.numero = r.numero;
      }
      renderEditor();
      toast(lista.length === 1 ? "Comprobante subido." : `${lista.length} comprobantes subidos.`);
      cargarLista().catch(() => {});
    } catch (e) {
      toast(e.message, true);
      $("comprobantes-wrap").innerHTML = comprobantesHTML(S.sol, true);
      activarDropzone();
    }
  },
  async borrarFoto(fid) {
    if (!(await confirmar({ titulo: "Quitar comprobante", texto: "¿Quitar este comprobante de la rendición?", ok: "Quitar", clase: "btn-rojo-solid" }))) return;
    try {
      const r = await api("DELETE", `solicitudes/${S.sol.id}/fotos/${fid}`);
      S.sol.fotos = r.fotos;
      $("comprobantes-wrap").innerHTML = comprobantesHTML(S.sol, true);
      activarDropzone();
    } catch (e) { toast(e.message, true); }
  },
  verFoto(k) {
    const sol = S.vista === "editor" ? S.sol : S.detalle;
    if (!sol?.id) return;
    S.lb = { sol, k }; renderLightbox();
  },
  lbMover(d) { const n = S.lb.sol.fotos.length; S.lb.k = (S.lb.k + d + n) % n; renderLightbox(); },
  lbCerrar() { S.lb = null; renderLightbox(); },

  // ---- listas ----
  filtro(k, v) { S.filtros[k] = v; renderHistorial(); },
  async recargar() { try { await cargarLista(); go(S.vista); toast("Lista actualizada."); } catch (e) { toast(e.message, true); } },
  async abrir(id) {
    try {
      const s = await api("GET", `solicitudes/${id}`);
      if (S.user.rol === "VENDEDOR" && (s.estado === "BORRADOR" || s.estado === "DEVUELTA")) { S.sol = s; go("editor"); return; }
      S.detalle = s; S.volverA = S.vista === "detalle" ? S.volverA : S.vista;
      go("detalle");
    } catch (e) { toast(e.message, true); }
  },
  volver() { go(S.volverA || (S.user.rol === "VENDEDOR" ? "historial" : "bandeja")); },

  // ---- revisión ----
  chk() {
    const all = [...document.querySelectorAll(".chk")];
    $("btn-aprobar").disabled = !all.every((c) => c.checked);
  },
  async accion(accion) {
    const s = S.detalle;
    const comentario = $("rev-coment").value.trim();
    const checklist = {};
    document.querySelectorAll(".chk").forEach((c) => { checklist[c.dataset.k] = c.checked; });
    if ((accion === "devolver" || accion === "rechazar") && comentario.length < 5) {
      toast(accion === "devolver" ? "Escribí en el comentario qué tiene que corregir el vendedor." : "Escribí en el comentario el motivo del rechazo.", true);
      $("rev-coment").focus(); return;
    }
    const textos = {
      aprobar: S.user.rol === "CONTROL" ? ["Aprobar y pasar a Administración", `La ${esc(s.numero)} pasará a Administración para su aprobación final.`, "btn-verde", "Aprobar"]
        : ["Aprobación final", `Se aprobará la ${esc(s.numero)} por <strong>Gs. ${fmtGs(s.totales.total)}</strong>. Luego podrás registrar el pago.`, "btn-verde", "Aprobar"],
      devolver: ["Devolver al vendedor", `La ${esc(s.numero)} vuelve a ${esc(s.vendedorNombre)} para que la corrija y la reenvíe.`, "btn-naranja", "Devolver"],
      rechazar: ["Rechazar", `La ${esc(s.numero)} quedará <strong>rechazada</strong> y se cierra el trámite. El vendedor tendrá que cargar una nueva si corresponde.`, "btn-rojo-solid", "Rechazar"],
    }[accion];
    if (!(await confirmar({ titulo: textos[0], texto: textos[1], clase: textos[2], ok: textos[3] }))) return;
    try {
      S.detalle = await api("POST", `solicitudes/${s.id}/accion`, { accion, comentario, checklist });
      await cargarLista();
      toast({ aprobar: "Aprobada.", devolver: "Devuelta al vendedor.", rechazar: "Rechazada." }[accion]);
      renderDetalle();
    } catch (e) { toast(e.message, true); }
  },
  async registrarPago() {
    const s = S.detalle;
    const pago = { importe: Number($("pago-importe").value) || 0, fecha: $("pago-fecha").value, referencia: $("pago-ref").value };
    if (!(await confirmar({ titulo: "Registrar y cerrar", texto: `Se registrará <strong>Gs. ${fmtGs(pago.importe)}</strong> el ${fFecha(pago.fecha)} y la ${esc(s.numero)} quedará cerrada.`, ok: "Registrar", clase: "btn-verde" }))) return;
    try {
      S.detalle = await api("POST", `solicitudes/${s.id}/accion`, { accion: "registrar_pago", pago, comentario: $("pago-coment").value });
      await cargarLista();
      toast("Pago registrado. Circuito cerrado.");
      renderDetalle();
    } catch (e) { toast(e.message, true); }
  },

  // ---- parámetros ----
  pf(i, k, v) { S.cfgEdit.funcionarios[i][k] = k === "consumo" ? Number(v) || 0 : v; },
  pc(i, k, v) {
    const c = S.cfgEdit.combustibles[i];
    c[k] = k === "precio" || k === "adic" ? Number(v) || 0 : v;
    if (k === "precio" || k === "adic") $(`pf-${i}`).textContent = `Gs. ${fmtGs(precioFinal(c))}`;
  },
  addFunc() { S.cfgEdit.funcionarios.push({ usuario: "", nombre: "", cargo: "VENDEDOR/A", rol: "VENDEDOR", marca: "", modelo: "", combustible: "", consumo: 0, activo: true, pinNuevo: "" }); renderParametros(); },
  delFunc(i) { S.cfgEdit.funcionarios.splice(i, 1); renderParametros(); },
  addComb() { S.cfgEdit.combustibles.push({ producto: "Nuevo combustible", tipo: "NAFTA", precio: 0, adic: 0.05, vigencia: hoy() }); renderParametros(); },
  delComb(i) { S.cfgEdit.combustibles.splice(i, 1); renderParametros(); },
  async guardarParams() {
    try {
      S.config = await api("PUT", "config", S.cfgEdit);
      S.cfgEdit = null;
      toast("Parámetros guardados.");
      renderParametros();
    } catch (e) { toast(e.message, true); }
  },
  descartarParams() { S.cfgEdit = null; renderParametros(); toast("Cambios descartados."); },

  // ---- exportar ----
  csvLista() {
    const f = S.filtros;
    const items = S.lista.filter((s) => (!f.vendedor || s.vendedorNombre === f.vendedor) && (!f.tipo || s.tipo === f.tipo) && (!f.estado || s.estado === f.estado));
    const rows = [["N°", "TIPO", "SEMANA/MES", "VENDEDOR", "FECHA", "TOTAL KMS", "TOTAL IMPORTE MOVILIDAD", "TOTAL IMPORTE VIATICOS", "TOTAL SOLICITADO/RENDIDO", "ANTICIPO RECIBIDO", "SALDO", "ESTADO", "IMPORTE PAGADO", "FECHA PAGO"]];
    items.forEach((s) => rows.push([s.numero, TIPOS[s.tipo], s.semana, s.vendedorNombre, fFecha(s.fechaDoc), fmtGs(s.totales.kms), fmtGs(s.totales.movilidad), fmtGs(s.totales.viatTot), fmtGs(s.totales.total),
      s.tipo === "rendicion" ? fmtGs(s.totales.anticipo) : "", s.tipo === "rendicion" ? fmtGs(s.totales.saldo) : "", ESTADOS[s.estado], s.pago ? fmtGs(s.pago.importe) : "", s.pago ? fFecha(s.pago.fecha) : ""]));
    descargarCSV(`resumen_movilidad_${hoy()}.csv`, rows);
  },
  csvDetalle() {
    const s = S.detalle;
    const t = s.totales;
    const rows = [
      ["N°", s.numero], ["TIPO", TIPOS[s.tipo]], ["ESTADO", ESTADOS[s.estado]], ["VENDEDOR", s.vendedorNombre], ["SEMANA / MES", s.semana],
      [s.tipo === "rendicion" ? "FECHA RENDICIÓN" : "FECHA SOLICITUD", fFecha(s.fechaDoc)], ["FECHA DESDE", fFecha(s.desde), "FECHA HASTA", fFecha(s.hasta)], [],
      ["DIA", "FECHA", "DESTINO DESDE", "DESTINO HASTA", "KMS", "ADICIONAL AA", "IMPORTE COMBUSTIBLE + AA", "PEAJES IDA", "PEAJES VUELTA", "CLIENTES VISITADOS", "DESAYUNO", "ALMUERZO/CENA", "ALOJAMIENTO", "TOTAL VIATICOS DIA"],
    ];
    s.dias.forEach((d, i) => {
      const c = calcularDia(d, s.vehiculo);
      rows.push([DIAS[i], fFecha(d.fecha), d.desde, d.hasta, d.kms, fmtGs(c.adicional), fmtGs(c.combAA), fmtGs(c.peajesIda), fmtGs(c.peajesVuelta),
        d.clientes.filter((x) => x.trim()).join(" | "), c.viaticosOn ? fmtGs(c.des) : "", c.viaticosOn ? fmtGs(c.alm) : "", c.viaticosOn ? fmtGs(c.alo) : "", c.viaticosOn ? fmtGs(c.viaticos) : ""]);
    });
    rows.push([], ["DETALLE PEAJES", "DIA", "TRAMO", "CANTIDAD", "MONTO POR PEAJE", "SUBTOTAL"]);
    s.dias.forEach((d, i) => ["ida", "vuelta"].forEach((tr) => d.peajes[tr].forEach((p) => { if (p.cant || p.monto) rows.push(["", DIAS[i], tr.toUpperCase(), p.cant, fmtGs(p.monto), fmtGs(p.cant * p.monto)]); })));
    rows.push([], [s.tipo === "rendicion" ? "TOTAL KMS RECORRIDO" : "TOTAL KMS PRESUPUESTADO", fmtGs(t.kms)],
      ["TOTAL IMPORTE MOVILIDAD", fmtGs(t.movilidad), "Combustible", fmtGs(t.combustible), "Adicional AA", fmtGs(t.adic), "Peajes", fmtGs(t.peajesTot)],
      ["TOTAL IMPORTE VIATICOS", fmtGs(t.viatTot), "Desayuno", fmtGs(t.des), "Almuerzo/cena", fmtGs(t.alm), "Alojamiento", fmtGs(t.alo)],
      [s.tipo === "rendicion" ? "TOTAL RENDIDO" : "TOTAL ANTICIPO SOLICITADO", fmtGs(t.total)]);
    if (s.tipo === "rendicion") rows.push(["ANTICIPO RECIBIDO", fmtGs(t.anticipo)], [textoSaldo(t.saldo), fmtGs(Math.abs(t.saldo))], ["COMPROBANTES ADJUNTOS", (s.fotos || []).length]);
    rows.push([], ["HISTORIAL", "FECHA", "USUARIO", "ROL", "ACCIÓN", "COMENTARIO"]);
    (s.historial || []).forEach((h) => rows.push(["", fFechaHora(h.fecha), h.nombre, ROLES[h.rol], h.accion, h.comentario]));
    descargarCSV(`${s.numero}_${s.vendedorNombre.replace(/\s+/g, "_")}.csv`, rows);
  },
};
window.App = App;

/* ============================================================ inicio */
if (S.token) iniciarApp(); else renderLogin();
