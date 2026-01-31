const mysql = require('mysql2');
const config = require('./config');

const pool = mysql.createPool(config.db);

const promisePool = pool.promise();

const testConnection = async () => {
  try {
    const connection = await promisePool.getConnection();
    console.log('✅ Database connected successfully');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

const query = async (sql, params = []) => {
  try {
    const [rows] = await promisePool.query(sql, params);
    return rows;
  } catch (error) {
    console.error('Query Error:', error.message);
    throw error;
  }
};

const queryOne = async (sql, params = []) => {
  try {
    const [rows] = await promisePool.query(sql, params);
    return rows[0] || null;
  } catch (error) {
    console.error('Query Error:', error.message);
    throw error;
  }
};

const beginTransaction = async () => {
  const connection = await promisePool.getConnection();
  await connection.beginTransaction();
  return connection;
};

module.exports = {
  pool,
  promisePool,
  testConnection,
  query,
  queryOne,
  beginTransaction
};