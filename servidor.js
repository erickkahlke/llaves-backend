const express = require('express');
const persist = require('node-persist');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "mySecretApiKey";

app.use(express.json());

// Agregar CORS para permitir solicitudes de otros orígenes.
app.use(cors());

// Middleware para validar el API key en todas las peticiones.
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
  // Inicializar valores por defecto si no existen
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
 * Recibe: { idCliente: "cliente001" }
 * Responde: { idCliente, gaveta, codigoApertura, fechaCaducidad, qrURL }
 */
app.post('/asignarGaveta', async (req, res) => {
  const { idCliente } = req.body;
  if (!idCliente) {
    return res.status(400).json({ error: "idCliente es requerido" });
  }
  
  let gavetas = await persist.getItem('gavetas');
  let asignaciones = await persist.getItem('asignaciones');
  
  // Buscar la primera gaveta disponible
  const gavetaDisponible = gavetas.find(g => g.estado === 'disponible');
  if (!gavetaDisponible) {
    return res.status(400).json({ error: "No hay gavetas disponibles" });
  }
  
  // Generar un código de 6 dígitos
  const codigoApertura = Math.floor(100000 + Math.random() * 900000).toString();
  // Fecha de caducidad a 24 horas desde ahora
  const fechaCaducidad = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  // Generar URL de QR con dimensiones 300x300
  const qrURL = `https://api.qrserver.com/v1/create-qr-code/?data=${codigoApertura}&size=300x300`;
  
  // Actualizar el estado de la gaveta a "ocupada"
  gavetas = gavetas.map(g => (g.id === gavetaDisponible.id ? { ...g, estado: 'ocupada' } : g));
  await persist.setItem('gavetas', gavetas);
  
  // Guardar la asignación sin marcarla como usada
  asignaciones[codigoApertura] = {
    idCliente,
    idGaveta: gavetaDisponible.id,
    codigoApertura,
    fechaCaducidad,
    qrURL,
    usado: false
  };
  await persist.setItem('asignaciones', asignaciones);
  
  res.json({
    idCliente,
    gaveta: gavetaDisponible.id,
    codigoApertura,
    fechaCaducidad,
    qrURL
  });
});

/**
 * Endpoint: /validarCodigo
 * Recibe: { codigo: "123456" }
 * Responde:
 *   Si válido:
 *     { valido: true, gaveta, mensaje: "Aquí tiene sus llaves. Muchas gracias!" }
 *   Si no:
 *     { valido: false, mensaje: "Código no válido" }
 * Nota: No se marca el código como usado; esa acción se realiza en /actualizarEstado.
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
 * Recibe: { idGaveta: 1, codigo: "123456" } para liberar la gaveta.
 * Esta acción marca el código como usado y libera la gaveta.
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
  
  // Marcar la asignación como usada, si existe
  if (asignaciones[codigo]) {
    asignaciones[codigo].usado = true;
    await persist.setItem('asignaciones', asignaciones);
  }
  
  // Liberar la gaveta
  gavetas = gavetas.map(g => (g.id === idGaveta ? { ...g, estado: 'disponible' } : g));
  await persist.setItem('gavetas', gavetas);
  res.json({ mensaje: "Gaveta actualizada a disponible" });
});

/**
 * Endpoint: /estadoGavetas
 * Devuelve el listado de todas las gavetas y, si están ocupadas, la información de la asignación.
 */
app.get('/estadoGavetas', async (req, res) => {
  let gavetas = await persist.getItem('gavetas');
  let asignaciones = await persist.getItem('asignaciones');
  const estadoGavetas = gavetas.map(g => {
    if (g.estado === 'disponible') {
      return { idGaveta: g.id, estado: g.estado };
    } else {
      // Buscar la asignación correspondiente donde 'usado' sea false
      const asignacion = Object.values(asignaciones).find(a => a.idGaveta === g.id && !a.usado);
      return {
        idGaveta: g.id,
        estado: g.estado,
        fechaCaducidad: asignacion ? asignacion.fechaCaducidad : null,
        codigoApertura: asignacion ? asignacion.codigoApertura : null,
        qrURL: asignacion ? asignacion.qrURL : null,
        idCliente: asignacion ? asignacion.idCliente : null
      };
    }
  });
  res.json(estadoGavetas);
});