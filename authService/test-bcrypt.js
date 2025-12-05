const bcrypt = require("bcryptjs"); // o 'bcrypt' se usi quello

const plain = "METTI_QUI_PASSWORD_ADMIN";          // la password in chiaro che stai usando
const hash  = "$2b$12$Q2Xt2urDYcW9xzDnoEa.I.OtO6f65Tsx3IqQFsMAhz9/NfrqkbzyC";

(async () => {
  const ok = await bcrypt.compare(plain, hash);
  console.log("password match? ->", ok);
})();
