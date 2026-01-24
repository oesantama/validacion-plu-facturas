const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

// Configuración de la base de datos (PostgreSQL por defecto, fallback a SQLite para desarrollo rápido)
const sequelize = process.env.DATABASE_URL 
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: false,
      dialectOptions: process.env.DB_SSL === 'true' ? {
        ssl: {
          require: true,
          rejectUnauthorized: false
        }
      } : {}
    })
  : new Sequelize({
      dialect: 'sqlite',
      storage: './database.sqlite',
      logging: false
    });

const Record = sequelize.define('Record', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  archivo: DataTypes.STRING,
  pedido: DataTypes.STRING,
  cedula: DataTypes.STRING,
  cliente: DataTypes.STRING,
  plu: DataTypes.STRING,
  articulo: DataTypes.TEXT,
  direccion: DataTypes.TEXT,
  fecha1: DataTypes.STRING,
  fecha2: DataTypes.STRING,
  ciudad_barrio: DataTypes.STRING,
  placa: DataTypes.STRING,
  notas: DataTypes.TEXT
}, {
  tableName: 'registros_logistica',
  timestamps: true
});

module.exports = { sequelize, Record };
