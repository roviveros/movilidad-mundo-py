// API — Movilidad Mundo Paraguay S.A.
// Netlify Function (v2) + Netlify Blobs.
// Rutas bajo /api/*. Autenticación por usuario + PIN, con token firmado (HMAC).

import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { calcularSolicitud, precioFinal, diaVacio, DIAS, ESTADOS, ROLES, semanaMes } from "../../public/calc.js";

export const config = { path: "/api/*" };

const TOKEN_HORAS = 12;
const MAX_FOTO_BYTES = 5.5 * 1024 * 1024;
const MAX_FOTOS = 40;

const datos = () => getStore({ name: "movilidad-mp", consistency: "strong" });
const comprobantes = () => getStore({ name: "movilidad-mp-comprobantes", consistency: "strong" });

/* ------------------------------------------------------------------ helpers */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) fail(500, "Falta configurar la variable AUTH_SECRET en Netlify (mínimo 16 caracteres).");
  return s;
};

const b64u = (buf) => Buffer.from(buf).toString("base64url");

function firmarToken(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function leerToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const esperado = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig || ""), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString("hex");
}
function nuevoPin(pin, debeCambiar) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashPin(pin, salt), debeCambiar: !!debeCambiar };
}
function pinCorrecto(reg, pin) {
  if (!reg) return false;
  const a = Buffer.from(hashPin(pin, reg.salt), "hex"), b = Buffer.from(reg.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const txt = (v, max = 120) => String(v ?? "").trim().slice(0, max);
const num = (v) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0; };
const ahora = () => new Date().toISOString();
const usuarioValido = (u) => /^[a-z0-9._-]{3,30}$/.test(u);

/* ------------------------------------------------------------ configuración */

const SEED_VEHICULOS = [
  { usuario: "ejara", nombre: "Enrique Jara", marca: "Volkswagen", modelo: "Amarok 2.0", combustible: "Diésel Mbarete", consumo: 16 },
  { usuario: "icolman", nombre: "Ignacio Colmán", marca: "Hyundai", modelo: "Tucson", combustible: "Diésel Mbarete", consumo: 10.5 },
  { usuario: "fflores", nombre: "Fredy Flores", marca: "Toyota", modelo: "New Vitz", combustible: "Nafta Aratiri 97", consumo: 10 },
  { usuario: "mlugo", nombre: "Miguel Lugo", marca: "Motocicleta", modelo: "Kenton GTR 150", combustible: "Nafta Aratiri 97", consumo: 5 },
  { usuario: "agonzalez", nombre: "Ariel Gonzalez", marca: "Motocicleta", modelo: "Kenton Dakar 150", combustible: "Nafta Aratiri 97", consumo: 3 },
];
const SEED_COMBUSTIBLES = [
  { producto: "Diésel Porã", tipo: "DIESEL", precio: 8200, adic: 0.05, vigencia: "2026-05-04" },
  { producto: "Diésel Mbarete", tipo: "DIESEL", precio: 10000, adic: 0.05, vigencia: "2026-05-04" },
  { producto: "Nafta Kape 88", tipo: "NAFTA", precio: 6690, adic: 0.05, vigencia: "2026-05-04" },
  { producto: "Nafta Oikoite 93", tipo: "NAFTA", precio: 7190, adic: 0.05, vigencia: "2026-05-04" },
  { producto: "Nafta Aratiri 97", tipo: "NAFTA", precio: 8540, adic: 0.05, vigencia: "2026-05-04" },
  { producto: "Ñande Gas/Kg", tipo: "GAS", precio: 7374, adic: 0.05, vigencia: "2025-05-23" },
  { producto: "Ñande Gas/Litro", tipo: "GAS", precio: 4240, adic: 0.05, vigencia: "2025-05-23" },
  { producto: "EcoFlex 85", tipo: "NAFTA", precio: 7730, adic: 0.05, vigencia: "2024-08-13" },
];

async function cargarConfig() {
  const store = datos();
  let cfg = await store.get("config", { type: "json" });
  if (cfg) return cfg;
  // Primera ejecución: se crean los parámetros iniciales y los PIN provisorios.
  let id = 1;
  const funcionarios = [
    ...SEED_VEHICULOS.map((v) => ({ id: id++, cargo: "VENDEDOR/A", rol: "VENDEDOR", activo: true, ...v })),
    { id: id++, usuario: "analista", nombre: "Analista Comercial", cargo: "ANALISTA COMERCIAL", rol: "ANALISTA", activo: true, marca: "", modelo: "", combustible: "", consumo: 0 },
    { id: id++, usuario: "admin", nombre: "Administración", cargo: "ADMINISTRACIÓN", rol: "ADMIN", activo: true, marca: "", modelo: "", combustible: "", consumo: 0 },
  ];
  let cid = 1;
  const combustibles = SEED_COMBUSTIBLES.map((c) => ({ id: cid++, fechaModif: c.vigencia, ...c }));
  cfg = { funcionarios, combustibles, actualizado: ahora() };
  const pinInicial = process.env.PIN_INICIAL || "1234";
  const pines = {};
  funcionarios.forEach((f) => { pines[f.usuario] = nuevoPin(pinInicial, true); });
  await store.setJSON("pines", pines);
  await store.setJSON("config", cfg);
  return cfg;
}

const cargarPines = async () => (await datos().get("pines", { type: "json" })) || {};

function vehiculoDe(cfg, usuario) {
  const f = cfg.funcionarios.find((x) => x.usuario === usuario);
  if (!f) return null;
  const c = cfg.combustibles.find((x) => x.producto === f.combustible);
  return {
    marca: f.marca || "", modelo: f.modelo || "", combustible: f.combustible || "",
    tipo: c ? c.tipo : "", consumo: num(f.consumo), precioL: c ? Math.round(precioFinal(c)) : 0,
  };
}

/* -------------------------------------------------------------- solicitudes */

const INDICE = "indice";
const cargarIndice = async () => (await datos().get(INDICE, { type: "json" })) || [];
const cargarSolicitud = async (id) => datos().get(`sol/${id}`, { type: "json" });

function resumen(s) {
  return {
    id: s.id, numero: s.numero, tipo: s.tipo, estado: s.estado,
    vendedorUsuario: s.vendedorUsuario, vendedorNombre: s.vendedorNombre,
    fechaDoc: s.fechaDoc, desde: s.desde, hasta: s.hasta, semana: s.semana,
    totales: { kms: s.totales.kms, movilidad: s.totales.movilidad, viatTot: s.totales.viatTot, total: s.totales.total, saldo: s.totales.saldo, anticipo: s.totales.anticipo },
    fotos: (s.fotos || []).length,
    pago: s.pago || null,
    creado: s.creado, actualizado: s.actualizado,
  };
}

async function guardarSolicitud(s) {
  s.actualizado = ahora();
  await datos().setJSON(`sol/${s.id}`, s);
  const idx = await cargarIndice();
  const r = resumen(s);
  const i = idx.findIndex((x) => x.id === s.id);
  if (i >= 0) idx[i] = r; else idx.push(r);
  await datos().setJSON(INDICE, idx);
}

async function siguienteNumero(tipo) {
  const store = datos();
  const c = (await store.get("contador", { type: "json" })) || { n: 0 };
  c.n += 1;
  await store.setJSON("contador", c);
  const pref = tipo === "rendicion" ? "RG" : "SA";
  return `${pref}-${new Date().getFullYear()}-${String(c.n).padStart(4, "0")}`;
}

// Limpia lo que envía el navegador: solo los campos permitidos, con tipos y tamaños acotados.
function limpiarDatos(input) {
  const tipo = input?.tipo === "rendicion" ? "rendicion" : "anticipo";
  const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
  const filasPeaje = (arr) => {
    const f = (Array.isArray(arr) ? arr : []).slice(0, 20).map((p) => ({ cant: Math.floor(num(p?.cant)), monto: num(p?.monto) }));
    return f.length ? f : [{ cant: 0, monto: 0 }];
  };
  const dias = DIAS.map((_, i) => {
    const d = input?.dias?.[i] || diaVacio();
    const clientes = (Array.isArray(d.clientes) ? d.clientes : []).slice(0, 50).map((c) => txt(c, 120));
    const v = d.viaticos || {};
    return {
      fecha: fecha(d.fecha), desde: txt(d.desde), hasta: txt(d.hasta), kms: num(d.kms),
      clientes: clientes.length ? clientes : [""],
      peajes: { ida: filasPeaje(d.peajes?.ida), vuelta: filasPeaje(d.peajes?.vuelta) },
      viaticos: { on: !!v.on, desayuno: num(v.desayuno), almuerzo: num(v.almuerzo), alojamiento: num(v.alojamiento) },
    };
  });
  const desde = fecha(input?.desde);
  return {
    tipo,
    fechaDoc: fecha(input?.fechaDoc),
    desde, hasta: fecha(input?.hasta),
    semana: Math.max(1, Math.min(6, Math.floor(num(input?.semana)) || Number(semanaMes(desde)) || 1)),
    dias,
    anticipoRecibido: tipo === "rendicion" ? num(input?.anticipoRecibido) : 0,
    observacionVendedor: txt(input?.observacionVendedor, 600),
  };
}

function puedeVer(user, s) {
  return user.rol !== "VENDEDOR" || s.vendedorUsuario === user.usuario;
}
const editable = (s) => s.estado === "BORRADOR" || s.estado === "DEVUELTA";

function registrar(s, user, accion, comentario = "") {
  s.historial = s.historial || [];
  s.historial.push({ fecha: ahora(), usuario: user.usuario, nombre: user.nombre, rol: user.rol, accion, comentario: txt(comentario, 1000) });
}

/* ------------------------------------------------------------------ routing */

async function autenticar(req, url) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("t");
  const p = leerToken(token);
  if (!p) fail(401, "Sesión vencida o inválida. Ingresá de nuevo.");
  const cfg = await cargarConfig();
  const f = cfg.funcionarios.find((x) => x.usuario === p.u);
  if (!f || f.activo === false) fail(401, "Tu usuario ya no está habilitado.");
  return { usuario: f.usuario, nombre: f.nombre, rol: f.rol, cfg };
}

const soloRol = (user, ...roles) => { if (!roles.includes(user.rol)) fail(403, "Tu rol no tiene permiso para esta acción."); };

export default async (req) => {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const m = req.method;
    const body = async () => { try { return await req.json(); } catch { return {}; } };

    /* ---- sesión ---- */
    if (parts[0] === "login" && m === "POST") {
      secret();
      const { usuario, pin } = await body();
      const u = txt(usuario, 30).toLowerCase();
      const cfg = await cargarConfig();
      const pines = await cargarPines();
      const f = cfg.funcionarios.find((x) => x.usuario === u);
      if (!f || f.activo === false || !pinCorrecto(pines[u], pin)) {
        await new Promise((r) => setTimeout(r, 600));
        fail(401, "Usuario o PIN incorrecto.");
      }
      const token = firmarToken({ u, exp: Date.now() + TOKEN_HORAS * 3600e3 });
      return json({ token, user: { usuario: u, nombre: f.nombre, rol: f.rol, debeCambiarPin: !!pines[u].debeCambiar } });
    }

    const user = await autenticar(req, url);
    const cfg = user.cfg;

    if (parts[0] === "me" && m === "GET") {
      const pines = await cargarPines();
      return json({ user: { usuario: user.usuario, nombre: user.nombre, rol: user.rol, debeCambiarPin: !!pines[user.usuario]?.debeCambiar } });
    }

    if (parts[0] === "cambiar-pin" && m === "POST") {
      const { pinActual, pinNuevo } = await body();
      const pines = await cargarPines();
      if (!pinCorrecto(pines[user.usuario], pinActual)) fail(400, "El PIN actual no es correcto.");
      if (!/^\d{4,8}$/.test(String(pinNuevo || ""))) fail(400, "El PIN nuevo debe tener entre 4 y 8 números.");
      if (String(pinNuevo) === String(process.env.PIN_INICIAL || "1234")) fail(400, "Elegí un PIN distinto al provisorio.");
      pines[user.usuario] = nuevoPin(pinNuevo, false);
      await datos().setJSON("pines", pines);
      return json({ ok: true });
    }

    /* ---- parámetros ---- */
    if (parts[0] === "config") {
      if (m === "GET") return json(cfg);
      if (m === "PUT") {
        soloRol(user, "ADMIN");
        const inp = await body();
        const pines = await cargarPines();
        const vistos = new Set();
        let maxId = Math.max(0, ...cfg.funcionarios.map((f) => f.id || 0));
        const funcionarios = (Array.isArray(inp.funcionarios) ? inp.funcionarios : []).map((f) => {
          const usuario = txt(f.usuario, 30).toLowerCase();
          if (!usuarioValido(usuario)) fail(400, `El usuario "${usuario || "(vacío)"}" no es válido: usá 3 a 30 letras minúsculas, números, punto o guion.`);
          if (vistos.has(usuario)) fail(400, `El usuario "${usuario}" está repetido.`);
          vistos.add(usuario);
          const rol = ROLES[f.rol] ? f.rol : "VENDEDOR";
          const pin = String(f.pinNuevo || "").trim();
          if (pin && !/^\d{4,8}$/.test(pin)) fail(400, `El PIN de ${usuario} debe tener entre 4 y 8 números.`);
          if (pin) pines[usuario] = nuevoPin(pin, true);
          else if (!pines[usuario]) fail(400, `Asigná un PIN provisorio al usuario nuevo "${usuario}".`);
          return {
            id: Number(f.id) || ++maxId, usuario, nombre: txt(f.nombre, 80) || usuario, cargo: txt(f.cargo, 60), rol,
            activo: f.activo !== false,
            marca: txt(f.marca, 60), modelo: txt(f.modelo, 60), combustible: txt(f.combustible, 60), consumo: num(f.consumo),
          };
        });
        if (!funcionarios.some((f) => f.rol === "ADMIN" && f.activo)) fail(400, "Tiene que quedar al menos un usuario activo con rol Administración.");
        if (!funcionarios.some((f) => f.usuario === user.usuario && f.rol === "ADMIN")) fail(400, "No podés quitarte a vos mismo el rol de Administración.");
        let maxC = Math.max(0, ...cfg.combustibles.map((c) => c.id || 0));
        const combustibles = (Array.isArray(inp.combustibles) ? inp.combustibles : []).map((c) => {
          const prev = cfg.combustibles.find((x) => x.id === c.id);
          const precio = num(c.precio), adic = num(c.adic);
          const cambio = !prev || prev.precio !== precio || prev.adic !== adic;
          return {
            id: Number(c.id) || ++maxC, producto: txt(c.producto, 60), tipo: ["DIESEL", "NAFTA", "GAS"].includes(c.tipo) ? c.tipo : "NAFTA",
            precio, adic, vigencia: /^\d{4}-\d{2}-\d{2}$/.test(c.vigencia || "") ? c.vigencia : "",
            fechaModif: cambio ? ahora().slice(0, 10) : (prev.fechaModif || ""),
          };
        });
        Object.keys(pines).forEach((u) => { if (!vistos.has(u)) delete pines[u]; });
        const nuevo = { funcionarios, combustibles, actualizado: ahora(), actualizadoPor: user.usuario };
        await datos().setJSON("pines", pines);
        await datos().setJSON("config", nuevo);
        return json(nuevo);
      }
    }

    /* ---- solicitudes ---- */
    if (parts[0] === "solicitudes") {
      const id = parts[1];

      // Lista
      if (!id && m === "GET") {
        const idx = await cargarIndice();
        const visibles = idx.filter((s) => puedeVer(user, s) && (user.rol === "VENDEDOR" || s.estado !== "BORRADOR"));
        visibles.sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
        return json(visibles);
      }

      // Crear (vendedor)
      if (!id && m === "POST") {
        soloRol(user, "VENDEDOR");
        const d = limpiarDatos(await body());
        const veh = vehiculoDe(cfg, user.usuario);
        const s = {
          id: crypto.randomUUID(), numero: await siguienteNumero(d.tipo),
          ...d, vendedorUsuario: user.usuario, vendedorNombre: user.nombre, vehiculo: veh,
          estado: "BORRADOR", fotos: [], historial: [], creado: ahora(),
        };
        s.totales = calcularSolicitud(s, veh);
        registrar(s, user, "Creó el borrador");
        await guardarSolicitud(s);
        return json(s, 201);
      }

      const s = id ? await cargarSolicitud(id) : null;
      if (id && (!s || !puedeVer(user, s))) fail(404, "No se encontró la solicitud.");

      if (id && parts.length === 2) {
        if (m === "GET") return json(s);

        if (m === "PUT") {
          soloRol(user, "VENDEDOR");
          if (!editable(s)) fail(409, "Esta solicitud ya fue enviada y no se puede modificar.");
          const d = limpiarDatos(await body());
          if (d.tipo !== s.tipo) {
            if (s.estado !== "BORRADOR") fail(409, "No se puede cambiar el tipo de una solicitud devuelta.");
            s.numero = (d.tipo === "rendicion" ? "RG" : "SA") + s.numero.slice(2);
          }
          Object.assign(s, d);
          s.vehiculo = vehiculoDe(cfg, user.usuario);
          s.totales = calcularSolicitud(s, s.vehiculo);
          await guardarSolicitud(s);
          return json(s);
        }

        if (m === "DELETE") {
          soloRol(user, "VENDEDOR");
          if (s.estado !== "BORRADOR") fail(409, "Solo se pueden eliminar borradores.");
          for (const f of s.fotos || []) await comprobantes().delete(`${s.id}/${f.id}`);
          await datos().delete(`sol/${s.id}`);
          const idx = (await cargarIndice()).filter((x) => x.id !== s.id);
          await datos().setJSON(INDICE, idx);
          return json({ ok: true });
        }
      }

      // Acciones del flujo
      if (id && parts[2] === "accion" && m === "POST") {
        const { accion, comentario, checklist, pago } = await body();
        const coment = txt(comentario, 1000);
        const checklistCompleto = (c) => c && ["recorrido", "peajes", "viaticos"].every((k) => c[k] === true) && (s.tipo !== "rendicion" || c.comprobantes === true);

        if (accion === "enviar") {
          soloRol(user, "VENDEDOR");
          if (!editable(s)) fail(409, "Esta solicitud ya fue enviada.");
          s.vehiculo = vehiculoDe(cfg, user.usuario);
          s.totales = calcularSolicitud(s, s.vehiculo);
          if (!s.fechaDoc || !s.desde) fail(400, "Completá la fecha del documento y la fecha desde.");
          if (s.totales.total <= 0) fail(400, "La solicitud no tiene importes: cargá al menos un recorrido, peaje o viático.");
          if (s.tipo === "rendicion" && !(s.fotos || []).length) fail(400, "Para enviar una rendición tenés que subir las fotos de tus facturas.");
          const reenvio = s.estado === "DEVUELTA";
          s.estado = "PENDIENTE_ANALISTA";
          registrar(s, user, reenvio ? "Corrigió y reenvió a revisión" : "Envió a revisión del analista comercial", coment);
        } else if (accion === "aprobar") {
          if (user.rol === "ANALISTA" && s.estado === "PENDIENTE_ANALISTA") {
            if (!checklistCompleto(checklist)) fail(400, "Marcá todas las verificaciones antes de aprobar.");
            s.estado = "PENDIENTE_ADMIN";
            registrar(s, user, "Verificó y aprobó · pasa a Administración", coment);
          } else if (user.rol === "ADMIN" && s.estado === "PENDIENTE_ADMIN") {
            if (!checklistCompleto(checklist)) fail(400, "Marcá todas las verificaciones antes de aprobar.");
            s.estado = "APROBADA";
            registrar(s, user, s.tipo === "rendicion" ? "Aprobó la rendición" : "Aprobó el anticipo", coment);
          } else fail(409, "Esta solicitud no está pendiente de tu aprobación.");
        } else if (accion === "devolver" || accion === "rechazar") {
          const turno = (user.rol === "ANALISTA" && s.estado === "PENDIENTE_ANALISTA") || (user.rol === "ADMIN" && s.estado === "PENDIENTE_ADMIN");
          if (!turno) fail(409, "Esta solicitud no está pendiente de tu revisión.");
          if (coment.length < 5) fail(400, accion === "devolver" ? "Escribí qué tiene que corregir el vendedor." : "Escribí el motivo del rechazo.");
          s.estado = accion === "devolver" ? "DEVUELTA" : "RECHAZADA";
          registrar(s, user, accion === "devolver" ? "Devolvió al vendedor para corregir" : "Rechazó la solicitud", coment);
        } else if (accion === "registrar_pago") {
          soloRol(user, "ADMIN");
          if (s.estado !== "APROBADA") fail(409, "Solo se registra el pago de solicitudes aprobadas.");
          const fechaPago = /^\d{4}-\d{2}-\d{2}$/.test(pago?.fecha || "") ? pago.fecha : "";
          if (!fechaPago) fail(400, "Indicá la fecha del pago.");
          s.pago = { importe: num(pago?.importe), fecha: fechaPago, referencia: txt(pago?.referencia, 80), registradoPor: user.usuario };
          s.estado = "PAGADA";
          registrar(s, user, s.totales.saldo < 0 ? "Registró la devolución del vendedor" : "Registró el pago / reintegro", coment);
        } else fail(400, "Acción no reconocida.");

        await guardarSolicitud(s);
        return json(s);
      }

      // Comprobantes (fotos de facturas)
      if (id && parts[2] === "fotos") {
        const fid = parts[3];
        if (!fid && m === "POST") {
          soloRol(user, "VENDEDOR");
          if (!editable(s)) fail(409, "La solicitud ya fue enviada; no se pueden agregar comprobantes.");
          if ((s.fotos || []).length >= MAX_FOTOS) fail(400, `Máximo ${MAX_FOTOS} comprobantes por rendición.`);
          const ct = (req.headers.get("content-type") || "").split(";")[0].trim();
          if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(ct) && ct !== "application/pdf") fail(415, "Formato no admitido: subí fotos (JPG, PNG, WEBP) o PDF.");
          const buf = await req.arrayBuffer();
          if (!buf.byteLength) fail(400, "El archivo está vacío.");
          if (buf.byteLength > MAX_FOTO_BYTES) fail(413, "El archivo supera 5,5 MB.");
          const nombre = txt(decodeURIComponent(req.headers.get("x-filename") || "comprobante"), 120);
          const foto = { id: crypto.randomUUID(), nombre, tipo: ct, size: buf.byteLength, fecha: ahora(), subidoPor: user.usuario };
          await comprobantes().set(`${s.id}/${foto.id}`, buf, { metadata: { contentType: ct, nombre } });
          s.fotos = [...(s.fotos || []), foto];
          await guardarSolicitud(s);
          return json(s, 201);
        }
        if (fid && m === "GET") {
          if (!(s.fotos || []).some((f) => f.id === fid)) fail(404, "Comprobante no encontrado.");
          const r = await comprobantes().getWithMetadata(`${s.id}/${fid}`, { type: "arrayBuffer" });
          if (!r) fail(404, "Comprobante no encontrado.");
          return new Response(r.data, {
            headers: {
              "content-type": r.metadata?.contentType || "application/octet-stream",
              "cache-control": "private, max-age=3600",
              "content-disposition": `inline; filename="${encodeURIComponent(r.metadata?.nombre || "comprobante")}"`,
            },
          });
        }
        if (fid && m === "DELETE") {
          soloRol(user, "VENDEDOR");
          if (!editable(s)) fail(409, "La solicitud ya fue enviada; no se pueden quitar comprobantes.");
          await comprobantes().delete(`${s.id}/${fid}`);
          s.fotos = (s.fotos || []).filter((f) => f.id !== fid);
          await guardarSolicitud(s);
          return json(s);
        }
      }
    }

    fail(404, "Ruta no encontrada.");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Error interno del servidor. Intentá de nuevo." }, 500);
  }
};
