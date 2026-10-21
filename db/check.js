const pool = require('../src/db');

pool
  .query('SELECT now() AS time, version() AS version')
  .then((res) => {
    console.log('Connected to Neon!');
    console.log(res.rows[0]);
    return pool.end();
  })
  .catch((err) => {
    console.error('Connection failed:', err.code, err.message, err.errors);
    return pool.end();
  });