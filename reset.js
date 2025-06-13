const axios = require('axios');

const dbManagerUrl = "http://localhost:3002";

async function main() {
  console.log("Inizio Procedura di Reset.");
  console.log("-------------------------------------");
  console.log('');
  console.log(" - Reset Lato Server : ");

  await axios.delete(`${dbManagerUrl}/simul/orders/all`);
  console.log("    Ordini Eliminati");

  await axios.delete(`${dbManagerUrl}/simul/positions/all`);
  console.log("    Posizioni Eliminate");

  await axios.put(`${dbManagerUrl}/simul/account`, {
    id: "f7a1b0d0-aaaa-bbbb-cccc-1a2b3c4d5e6f",
    cash: 100000
  });
  console.log("    Account Cash ristabilito a 100,000");

  console.log(" - Reset Lato Client : ");

  await axios.delete(`${dbManagerUrl}/positions/all`);
  console.log("    Posizioni Eliminate");

  await axios.delete(`${dbManagerUrl}/orders/all`);
  console.log("    Ordini Eliminati");

  await axios.delete(`${dbManagerUrl}/transactions/all`);
  console.log("    Transazioni Eliminate");

  await axios.put(`${dbManagerUrl}/strategies/10`, {
    id:10,
    CapitaleInvestito: 0,
    OpenOrders: 0,
    numAzioniBuy: 0,
    numAzioniSell: 0,
    NumeroOperazioni:0,
    NumeroOperazioniVincenti:0,
    AvgBuy:0,
    AvgSell:0,
    posizioneMercato: "OFF"
  });
  console.log("    Strategia Resettata");
}

main().catch(err => {
  console.error("Errore durante il reset:", err.message);
});
