const pool = require('../src/db');

async function attempt(client, label, sql) {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(sql);
    console.log(`FAIL  ${label}: NOT blocked`);
  } catch (err) {
    console.log(`OK    ${label}: blocked (${err.message})`);
  }
  await client.query('ROLLBACK TO SAVEPOINT attempt');
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const a = await client.query(
      "INSERT INTO audit_log (action, outcome) VALUES ('test.one', 'allowed') RETURNING id, prev_hash, hash"
    );
    const b = await client.query(
      "INSERT INTO audit_log (action, outcome) VALUES ('test.two', 'denied') RETURNING id, prev_hash, hash"
    );
    console.log('Row 1 hash :', a.rows[0].hash);
    console.log('Row 2 prev :', b.rows[0].prev_hash);
    console.log(
      a.rows[0].hash === b.rows[0].prev_hash
        ? 'OK    chain linked: row 2 points to row 1'
        : 'FAIL  chain NOT linked'
    );

    await attempt(client, 'UPDATE  ', "UPDATE audit_log SET action = 'hacked'");
    await attempt(client, 'DELETE  ', 'DELETE FROM audit_log');
    await attempt(client, 'TRUNCATE', 'TRUNCATE audit_log');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
    console.log('Rolled back: no test rows were kept.');
  }
}

main().catch((err) => console.error('Test failed:', err.code, err.message));