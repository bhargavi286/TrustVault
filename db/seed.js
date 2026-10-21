const bcrypt = require('bcrypt');
const pool = require('../src/db');

// Demo accounts only. These passwords are public (they go in the README).
const users = [
  { email: 'admin@trustvault.test', password: 'Admin-Demo-2026!', role: 'admin' },
  { email: 'alice@trustvault.test', password: 'Alice-Demo-2026!', role: 'owner' },
  { email: 'bob@trustvault.test', password: 'Bob-Demo-2026!', role: 'owner' },
  { email: 'carol@trustvault.test', password: 'Carol-Demo-2026!', role: 'viewer' },
  { email: 'dave@trustvault.test', password: 'Dave-Demo-2026!', role: 'viewer' },
];

async function main() {
  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 12);
    const res = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING`,
      [u.email, hash, u.role]
    );
    console.log(`${res.rowCount ? 'created' : 'exists '} ${u.role.padEnd(6)} ${u.email}`);
  }
}

main()
  .catch((err) => console.error('Seed failed:', err.code, err.message))
  .finally(() => pool.end());