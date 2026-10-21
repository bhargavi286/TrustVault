const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  const res = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  console.log('Schema applied. Tables:', res.rows.map((r) => r.table_name).join(', '));
}

main()
  .catch((err) => console.error('Setup failed:', err.code, err.message))
  .finally(() => pool.end());