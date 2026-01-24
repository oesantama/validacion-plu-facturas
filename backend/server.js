const express = require('express');
const cors = require('cors');
const { sequelize, Record } = require('./database');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Obtener todos los registros
app.get('/api/records', async (req, res) => {
  try {
    const records = await Record.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Guardar nuevos registros (batch)
app.post('/api/records', async (req, res) => {
  try {
    const newRecords = req.body;
    if (!Array.isArray(newRecords)) {
      return res.status(400).json({ error: 'Se esperaba un array de registros' });
    }
    
    // Usamos bulkCreate para eficiencia
    const created = await Record.bulkCreate(newRecords, {
      ignoreDuplicates: true // Evita errores si ya existe el ID
    });
    
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar un registro
app.delete('/api/records/:id', async (req, res) => {
  try {
    await Record.destroy({
      where: { id: req.params.id }
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Limpiar todo el historial
app.delete('/api/records', async (req, res) => {
  try {
    await Record.destroy({ where: {}, truncate: true });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor y sincronizar base de datos
sequelize.sync().then(() => {
  console.log('Base de datos sincronizada');
  app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Error al sincronizar DB:', err);
});
