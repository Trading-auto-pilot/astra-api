// strategies/sma/index.js
require('dotenv').config();
const StrategyUtils = require('../../shared/utils');
const crypto = require('crypto');

(async () => {
  const {
    RUN_ID,
    SYMBOL,
    START_DATE,
    END_DATE,
    CAPITALE,
    SL,
    TP,
    MA,
    API_KEY,
    API_SECRET
  } = process.env;

  const connection = await StrategyUtils.getDbConnection();
  const Strategia = "SMA";
  const Ver = "1.0";

  const id = RUN_ID || crypto.createHash('sha256').update(`${SYMBOL}:${MA}:${SL}:${TP}:${CAPITALE}:${START_DATE}:${END_DATE}`).digest('hex').slice(0, 50);

  console.log(`[${id}] Avvio strategia SMA per ${SYMBOL}`);

  await connection.query(`INSERT INTO strategy_runs (id, strategy, symbol, mode, start_date, end_date, capital, status, params_json, started_at)
    VALUES (?, ?, ?, 'backtest', ?, ?, ?, 'running', ?, NOW())`,
    [id, Strategia+' '+Ver, SYMBOL, START_DATE, END_DATE, CAPITALE, JSON.stringify({ SL, TP, MA })]);

  try {
    const dataset = await StrategyUtils.backTest(SYMBOL, START_DATE, END_DATE, API_KEY, API_SECRET);
    console.log('Dimensione Backtest : '+dataset.length);
    console.log(dataset[0]);
    console.log(dataset[dataset.length -1]);
    const prices = dataset.map(d => d.c);
    const ma = StrategyUtils.calcSMA(prices, parseInt(MA));

    let capitaleLibero = parseFloat(CAPITALE);
    const capitaleNum = parseFloat(process.env.CAPITALE);
    let capitaleInvestito = 0;
    let comprato = 0;
    let daysFree = 0;
    let daysInvested = 0;
    let lastOp = new Date(dataset[0].t);
    let numOp = 0;
    let minDay = 9999999;
    let maxDay = 0;

    console.log('Capitale libero '+capitaleLibero);
    for (let i = MA + 1; i < dataset.length; i++) {
      const element = dataset[i];
      const currentDate = new Date(element.t);

      const media = ma[i];
      // Segnale di BUY -- Inserisco ordine di BUY
      if (element.c > media && capitaleLibero > 0) {
        comprato = element.c;
        capitaleInvestito = capitaleLibero;
        capitaleLibero = 0;

        if (lastOp) daysFree += (currentDate - lastOp) / (1000 * 60 * 60 * 24);
        await StrategyUtils.writeBuy(connection, id, currentDate, comprato, capitaleInvestito, media, comprato, 0, daysFree);
        lastOp = currentDate;
      }

      // Entro in questo IF solo se ho posizioni aperte (Quindi capitali gia investiti)
      if (capitaleInvestito > 0) {
        //console.log("Ho posizioni Aperte Verifico se ci sono le condizioni per chiudere. element.c "+element.c+" comprato "+comprato+" comprato * (1 - SL) "+ comprato * (1 - SL)+ " (comprato * (1 + TP)) "+(comprato * (1 + TP))+' TP: '+TP);
        console.log('element.c = '+element.c+' comprato ='+comprato+' TP = '+TP+' 1+TP= '+(1+Number(TP))+' (comprato * (1 + TP))='+(comprato * (1 + Number(TP))))
        if (element.c < (comprato * (1 - Number(SL))) || element.c > (comprato * (1 + Number(TP)))) {
          const trigger = element.c < comprato * (1 - SL) ? 'SL' : 'TP';
          const capitaleFinale = element.c / comprato * capitaleInvestito;
          const giorni = (currentDate - lastOp) / (1000 * 60 * 60 * 24);
          const profit = (element.c / comprato - 1);

          daysInvested += giorni;
          minDay = Math.min(minDay, giorni);
          maxDay = Math.max(maxDay, giorni);
          numOp++;

          await StrategyUtils.writeSell(connection, id, currentDate, element.c, capitaleFinale, profit, trigger, giorni);
          capitaleLibero = capitaleFinale;
          capitaleInvestito = 0;
          lastOp = currentDate;
        }
      }
    }

    const capitaleFinale = capitaleLibero + capitaleInvestito;
    const profitto = capitaleFinale / capitaleNum - 1;
    const profittoAnnuo = StrategyUtils.getAnnualizedProfit(START_DATE, END_DATE, profitto);
    
    const rapportoEfficienza = profitto === 0
      ? 0
      : daysFree / (profitto * 100);
    
    await connection.query(`
      UPDATE strategy_runs 
      SET status = 'done',
          completed_at = NOW(),
          profit = ?,
          efficienza = ?,
          dayMin = ?,
          dayMax = ?,
          profittoAnnuo = ?
      WHERE id = ?`,
      [profitto, rapportoEfficienza, minDay, maxDay, profittoAnnuo, id]);

    console.log(`[${id}] Strategia SMA completata con successo.`);
  } catch (err) {
    console.error(`[${id}] Errore durante l'esecuzione:`, err);
    await connection.query(`UPDATE strategy_runs SET status = 'failed', completed_at = NOW() WHERE id = ?`, [id]);
  }

  await connection.end();
})();
