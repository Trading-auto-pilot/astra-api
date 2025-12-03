#!/usr/bin/env node

/**
 * Utility: genera un hash bcrypt a partire da una password in chiaro.
 *
 * Uso:
 *   node hash-password.js "mypassword"
 */

const bcrypt = require("bcrypt");

async function main() {
  const plain = process.argv[2];

  if (!plain) {
    console.error("❌ Errore: devi passare la password in chiaro.\n");
    console.error("Uso:");
    console.error("  node hash-password.js \"tuaPassword\"");
    process.exit(1);
  }

  try {
    const saltRounds = 12; // robusto per produzione
    const hash = await bcrypt.hash(plain, saltRounds);

    console.log("\n🔐 Password in chiaro:");
    console.log(plain);

    console.log("\n🔑 Hashed password (da inserire in tabella users.password_hash):");
    console.log(hash + "\n");
  } catch (err) {
    console.error("❌ Errore durante la generazione dell'hash:", err.message);
    process.exit(1);
  }
}

main();
