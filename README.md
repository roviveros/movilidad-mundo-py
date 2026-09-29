# Movilidad · Mundo Paraguay S.A.

Herramienta web para **solicitar anticipos** y **rendir gastos** de movilidad por uso de vehículo propio. Cada solicitud o rendición pasa por un circuito de aprobación:

```
Vendedor  →  Control de gestión  →  Administración  →  Aprobada  →  Pagada / reintegrada
   ↑                │                      │
   └── devuelta ────┴──────────────────────┘      (o rechazada: cierra el trámite)
```

- **Vendedor**: carga la solicitud de anticipo o la rendición de gastos (recorrido, clientes visitados, peajes y viáticos por día). En una rendición, además sube las **fotos de sus facturas**, que son obligatorias para enviarla. Puede guardarla como borrador y la envía a revisión. Si se la devuelven, la corrige y la reenvía.
- **Control de gestión**: revisa todo lo cargado y las fotos, marca la lista de verificación y después **aprueba** (pasa a Administración), **devuelve** al vendedor con un comentario o **rechaza**.
- **Administración**: vuelve a verificar y hace la **aprobación final**, o devuelve o rechaza. Después registra el **pago del anticipo o el reintegro**, con importe, fecha y referencia, y así se cierra el circuito. También administra los **Parámetros**: funcionarios, roles, PIN, vehículos y precios de combustible.

Cada paso queda registrado en el **historial del trámite**, con fecha, persona, rol y comentario.

---

## Cómo está armada

| Parte | Qué es |
|---|---|
| `public/` | La página web: `index.html`, `app.js`, `styles.css`, `calc.js` y el logo |
| `public/calc.js` | Fórmulas de cálculo. Las usan la página y el servidor, y el servidor **recalcula siempre** los importes |
| `netlify/functions/api.mjs` | API (`/api/*`): ingreso, permisos por rol, circuito de aprobación y fotos |
| Netlify Blobs | Donde se guardan los parámetros, las solicitudes y las fotos. No hace falta una base de datos aparte |

**Fórmulas** (las mismas de la planilla original):
- Combustible = kms × consumo/100 km ÷ 100 × precio por litro (precio Petropar + 5 %)
- Adicional AA = kms × Gs. 150, solo de **octubre a abril**
- Total importe movilidad = combustible + adicional AA + peajes (ida y vuelta)
- Total importe viáticos = desayuno + almuerzo/cena + alojamiento
- En una rendición: **saldo = total rendido − anticipo recibido**. Si es positivo, se reintegra al vendedor; si es negativo, el vendedor devuelve la diferencia a la empresa.

---

## Publicar en Netlify

> El despliegue por "arrastrar y soltar" (Netlify Drop) **no** publica la API. Usá una de estas dos opciones.

### Opción A: desde un repositorio (recomendada)
1. Subí esta carpeta a un repositorio de GitHub, GitLab o Bitbucket.
2. En Netlify, elegí **Add new site → Import an existing project** y seleccioná el repositorio. Netlify toma la configuración de `netlify.toml`, así que no hace falta cambiar nada en los pasos de build.
3. Cargá las **variables de entorno** (ver abajo) y volvé a desplegar.

### Opción B: con Netlify CLI
```bash
npm install
npx netlify login
npx netlify init        # crea o vincula el sitio
npx netlify env:set AUTH_SECRET "una-clave-larga-y-aleatoria"
npx netlify env:set PIN_INICIAL "un-pin-provisorio"
npx netlify deploy --prod
```

### Variables de entorno (Site configuration → Environment variables)
| Variable | Obligatoria | Para qué sirve |
|---|---|---|
| `AUTH_SECRET` | **Sí** | Clave para firmar las sesiones. Usá al menos 32 caracteres aleatorios y no la compartas. Si la cambiás, todas las sesiones abiertas se cierran. |
| `PIN_INICIAL` | Recomendada | PIN provisorio de los usuarios iniciales (si no se carga, es `1234`). Solo se usa la **primera vez** que arranca la herramienta. |

Netlify Blobs se activa solo, sin configuración.

---

## Primer ingreso

La primera vez que alguien entra, se crean estos usuarios con el **PIN provisorio** (`PIN_INICIAL`). Cada persona tiene que cambiarlo en su primer ingreso.

| Usuario | Nombre | Rol |
|---|---|---|
| `admin` | Administración | Administración |
| `control` | Control de Gestión | Control de gestión |
| `ejara` | Enrique Jara | Vendedor |
| `icolman` | Ignacio Colmán | Vendedor |
| `fflores` | Fredy Flores | Vendedor |
| `mlugo` | Miguel Lugo | Vendedor |
| `agonzalez` | Ariel Gonzalez | Vendedor |

**Pasos recomendados:**
1. Ingresá como `admin` y cambiá el PIN.
2. En **Parámetros**, cargá los nombres reales de Control de gestión y de Administración. Podés renombrar los usuarios, agregar personas y asignar a cada una su rol y un PIN provisorio.
3. Revisá los vehículos (marca, modelo, combustible, consumo) y los precios de combustible vigentes, y después tocá **Guardar parámetros**.
4. Pasale a cada persona la dirección del sitio, su usuario y su PIN provisorio.

Para quitarle el acceso a alguien sin perder su historial, desmarcá **Activo**.

> **Cambio de rol (29/09/2026):** el rol "Analista comercial" pasó a llamarse **"Control de gestión"**. En un sitio que ya estaba funcionando, la herramienta convierte sola los datos guardados: el usuario con rol Analista pasa a Control de gestión y las solicitudes pendientes del analista quedan pendientes de Control de gestión. El **nombre de usuario** existente (por ejemplo `analista`) y su PIN no cambian; si querés, renombralo desde **Parámetros**.

---

## Límites y buenas prácticas

- **Fotos**: las imágenes se reducen en el celular antes de subirse (lado mayor de 1800 px). Cada archivo puede pesar hasta 5,5 MB, y cada rendición admite hasta 40 comprobantes. Se aceptan JPG, PNG, WEBP y PDF.
- **Precios**: cuando se cambia un precio, se aplica a las solicitudes que se guarden o envíen desde ese momento. Las que ya se enviaron conservan el precio con el que se calcularon.
- **Seguridad**: el ingreso es con usuario y PIN. Los PIN se guardan cifrados (scrypt) y las sesiones duran 12 horas. Para un uso más amplio, se puede sumar el bloqueo después de varios intentos fallidos o el ingreso con correo corporativo.
- **Respaldo**: desde **Resumen Histórico** se exporta la lista a CSV, y cada solicitud se puede exportar a CSV o imprimir en PDF.

## Probar en tu computadora
```bash
npm install
npx netlify dev     # abre http://localhost:8888 con la API y Blobs locales
```
Antes, creá un archivo `.env` con `AUTH_SECRET=...`.
