const express = require('express');
const persist = require('node-persist');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3006;
const API_KEY = process.env.API_KEY || "mySecretApiKey";

app.use(express.json());
app.use(cors());

// Health check endpoint (sin autenticación para monitoring)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'llaves-backend'
  });
});

// Middleware para validar el API key en todas las peticiones protegidas.
app.use((req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: API key incorrecto o ausente" });
  }
  next();
});

// Inicializar node-persist en la carpeta "storage"
persist.init({
  dir: 'storage',
  stringify: JSON.stringify,
  parse: JSON.parse,
  encoding: 'utf8',
  logging: false,
  continuous: true,
  interval: false
}).then(async () => {
  let gavetas = await persist.getItem('gavetas');
  if (!gavetas) {
    gavetas = [
      { id: 1, estado: 'disponible' },
      { id: 2, estado: 'disponible' },
      { id: 3, estado: 'disponible' },
      { id: 4, estado: 'disponible' },
      { id: 5, estado: 'disponible' }
    ];
    await persist.setItem('gavetas', gavetas);
  }

  let asignaciones = await persist.getItem('asignaciones');
  if (!asignaciones) {
    asignaciones = {};
    await persist.setItem('asignaciones', asignaciones);
  }

  app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
  });
});

/**
 * Endpoint: /asignarGaveta
 * Recibe: { email, nombre, apellido, telefono, turno }
 */
app.post('/asignarGaveta', async (req, res) => {
  const { email, nombre, apellido, telefono, turno } = req.body;
  if (!email || !nombre || !apellido || !telefono || !turno) {
    return res.status(400).json({ error: "Faltan datos del cliente" });
  }

  let gavetas = await persist.getItem('gavetas');
  let asignaciones = await persist.getItem('asignaciones');

  const gavetaDisponible = gavetas.find(g => g.estado === 'disponible');
  if (!gavetaDisponible) {
    return res.status(400).json({ error: "No hay gavetas disponibles" });
  }

  // Generar código único de 4 dígitos que no esté en uso
  let codigoApertura;
  do {
    codigoApertura = Math.floor(1000 + Math.random() * 9000).toString();
  } while (asignaciones[codigoApertura] && !asignaciones[codigoApertura].usado);

  const fechaCaducidad = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const qrURL = `https://api.qrserver.com/v1/create-qr-code/?data=${codigoApertura}&size=300x300`;

  gavetas = gavetas.map(g => (g.id === gavetaDisponible.id ? { ...g, estado: 'ocupada' } : g));
  await persist.setItem('gavetas', gavetas);

  asignaciones[codigoApertura] = {
    email,
    nombre,
    apellido,
    telefono,
    turno,
    idGaveta: gavetaDisponible.id,
    codigoApertura,
    fechaCaducidad,
    qrURL,
    usado: false
  };
  await persist.setItem('asignaciones', asignaciones);

  res.json({
    email,
    nombre,
    apellido,
    telefono,
    turno,
    gaveta: gavetaDisponible.id,
    codigoApertura,
    fechaCaducidad,
    qrURL
  });
});

/**
 * Endpoint: /validarCodigo
 * Recibe: { codigo: "1234" }
 */
app.post('/validarCodigo', async (req, res) => {
  const { codigo } = req.body;
  let asignaciones = await persist.getItem('asignaciones');
  const asignacion = asignaciones[codigo];

  if (!asignacion || asignacion.usado) {
    return res.json({
      valido: false,
      mensaje: "Código no válido"
    });
  }

  res.json({
    valido: true,
    gaveta: asignacion.idGaveta,
    mensaje: "Aquí tiene sus llaves. Muchas gracias!"
  });
});

/**
 * Endpoint: /actualizarEstado
 * Recibe: { idGaveta, codigo }
 */
app.post('/actualizarEstado', async (req, res) => {
  const { idGaveta, codigo } = req.body;
  if (!idGaveta || !codigo) {
    return res.status(400).json({ error: "idGaveta y codigo son requeridos" });
  }

  let gavetas = await persist.getItem('gavetas');
  let asignaciones = await persist.getItem('asignaciones');
  const gaveta = gavetas.find(g => g.id === idGaveta);
  if (!gaveta) {
    return res.status(400).json({ error: "Gaveta no encontrada" });
  }

  if (asignaciones[codigo]) {
    asignaciones[codigo].usado = true;
    await persist.setItem('asignaciones', asignaciones);
  }

  gavetas = gavetas.map(g => (g.id === idGaveta ? { ...g, estado: 'disponible' } : g));
  await persist.setItem('gavetas', gavetas);
  res.json({ mensaje: "Gaveta actualizada a disponible" });
});

/**
 * Endpoint: /estadoGavetas
 * Devuelve el estado de todas las gavetas
 */
app.get('/estadoGavetas', async (req, res) => {
  let gavetas = await persist.getItem('gavetas');
  let asignaciones = await persist.getItem('asignaciones');

  const estadoGavetas = gavetas.map(g => {
    if (g.estado === 'disponible') {
      return { idGaveta: g.id, estado: g.estado };
    } else {
      const asignacion = Object.values(asignaciones).find(a => a.idGaveta === g.id && !a.usado);
      return {
        idGaveta: g.id,
        estado: g.estado,
        fechaCaducidad: asignacion ? asignacion.fechaCaducidad : null,
        codigoApertura: asignacion ? asignacion.codigoApertura : null,
        qrURL: asignacion ? asignacion.qrURL : null,
        email: asignacion ? asignacion.email : null,
        nombre: asignacion ? asignacion.nombre : null,
        apellido: asignacion ? asignacion.apellido : null,
        telefono: asignacion ? asignacion.telefono : null,
        turno: asignacion ? asignacion.turno : null
      };
    }
  });

  res.json(estadoGavetas);
});