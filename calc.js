// Cálculo de movilidad — Mundo Paraguay S.A.
// Módulo compartido entre el navegador y la API (el servidor recalcula siempre los totales).

export const DIAS = ["LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
export const AA_POR_KM = 150; // Gs. por km, solo de octubre a abril

export const ROLES = {
  VENDEDOR: "Vendedor",
  CONTROL: "Control de gestión",
  ADMIN: "Administración",
};

export const ESTADOS = {
  BORRADOR: "Borrador",
  PENDIENTE_CONTROL: "Pendiente Control de gestión",
  DEVUELTA: "Devuelta al vendedor",
  PENDIENTE_ADMIN: "Pendiente Administración",
  APROBADA: "Aprobada",
  PAGADA: "Pagada / reintegrada",
  RECHAZADA: "Rechazada",
};

export const TIPOS = {
  anticipo: "Solicitud de anticipo",
  rendicion: "Rendición de gastos",
};

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

export function precioFinal(c) {
  return (Number(c?.precio) || 0) * (1 + (Number(c?.adic) || 0));
}

export function semanaMes(fechaISO) {
  const dia = Number(String(fechaISO || "").split("-")[2]);
  return dia ? Math.ceil(dia / 7) : "";
}

export function aplicaAA(fechaISO) {
  const mes = Number(String(fechaISO || "").split("-")[1]);
  return !!mes && (mes >= 10 || mes <= 4);
}

export function diaVacio() {
  return {
    fecha: "", desde: "", hasta: "", kms: 0,
    clientes: [""],
    peajes: { ida: [{ cant: 0, monto: 0 }], vuelta: [{ cant: 0, monto: 0 }] },
    viaticos: { on: false, desayuno: 0, almuerzo: 0, alojamiento: 0 },
  };
}

export function totalPeajes(filas) {
  return (filas || []).reduce((s, p) => s + n(p.cant) * n(p.monto), 0);
}

// veh: { consumo, precioL }
export function calcularDia(d, veh) {
  const kms = n(d?.kms);
  const consumo = n(veh?.consumo);
  const precioL = n(veh?.precioL);
  const adicional = aplicaAA(d?.fecha) ? kms * AA_POR_KM : 0;
  const combustible = ((kms * consumo) / 100) * precioL;
  const peajesIda = totalPeajes(d?.peajes?.ida);
  const peajesVuelta = totalPeajes(d?.peajes?.vuelta);
  const v = d?.viaticos || {};
  const on = !!v.on;
  const des = on ? n(v.desayuno) : 0;
  const alm = on ? n(v.almuerzo) : 0;
  const alo = on ? n(v.alojamiento) : 0;
  return {
    kms, adicional,
    combustible: Math.round(combustible),
    combAA: Math.round(combustible + adicional),
    peajesIda, peajesVuelta, peajes: peajesIda + peajesVuelta,
    viaticosOn: on, des, alm, alo, viaticos: des + alm + alo,
  };
}

export function calcularSolicitud(sol, veh) {
  const t = { kms: 0, adic: 0, combustible: 0, combAA: 0, pIda: 0, pVuelta: 0, des: 0, alm: 0, alo: 0 };
  (sol?.dias || []).forEach((d) => {
    const c = calcularDia(d, veh);
    t.kms += c.kms; t.adic += c.adicional; t.combustible += c.combustible; t.combAA += c.combAA;
    t.pIda += c.peajesIda; t.pVuelta += c.peajesVuelta;
    t.des += c.des; t.alm += c.alm; t.alo += c.alo;
  });
  t.peajesTot = t.pIda + t.pVuelta;
  t.movilidad = t.combAA + t.peajesTot;
  t.viatTot = t.des + t.alm + t.alo;
  t.total = t.movilidad + t.viatTot;
  t.anticipo = sol?.tipo === "rendicion" ? n(sol?.anticipoRecibido) : 0;
  t.saldo = sol?.tipo === "rendicion" ? t.total - t.anticipo : 0;
  return t;
}

export function fmtGs(v) {
  return Math.round(Number(v) || 0).toLocaleString("es-PY");
}
