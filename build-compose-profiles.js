// scripts/build-compose-profiles.js
// Uso: node scripts/build-compose-profiles.js PAPER

const mysql = require('mysql2/promise');

async function main() {
  const env = process.argv[2] || 'PAPER';

  const {
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DATABASE,
  } = process.env;

  if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_DATABASE) {
    console.error('❌ Variabili MYSQL_* mancanti nell\'env');
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT || 3306,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
  });

  try {
    const [rows] = await connection.execute(
      `SELECT microservice, enabled
         FROM service_flags
        WHERE env = ?
        ORDER BY microservice`,
      [env]
    );

    const profilesSet = new Set();

    for (const row of rows) {
      if (!row.enabled) continue;

      const ms = row.microservice.toLowerCase();

      switch (ms) {
        case 'marketsimulator':
        case 'ordersimulator':
          profilesSet.add('simul');
          break;

        default:
          profilesSet.add(ms);
      }
    }

    const profiles = Array.from(profilesSet).join(',');

    // Output secco, così lo puoi catturare in shell
    console.log(profiles);
  } catch (err) {
    console.error('❌ Errore leggendo service_flags:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

main().catch(err => {
  console.error('❌ Errore generale:', err);
  process.exit(1);
});
