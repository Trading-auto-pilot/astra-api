// strategies/doublema/index.js

const StrategyUtils = require('../../shared/utils');
const crypto = require('crypto');

(async () => {
  const {
    RUN_ID,
    SYMBOL = 'MSFT',
    START_DATE = '2024-01-01',
    END_DATE = '2025-04-01',
    CAPITALE = 100,
    SL = 0.04,
    TP = 0.1,
    SHORT = 15,
    LONG = 50,
    API_KEY,
    API_SECRET
  } = process.env;

  const connection = await StrategyUtils.getDbConnection();

  const id = RUN_ID || crypto.createHash('sha256').update(`${SYMBOL}:${SHORT}:${LONG}:${SL}:${TP}:${CAPITALE}:${START_DATE}:${END_DATE}`).digest('hex').slice(0, 50);

  console.log(`[${id}] Avvio strategia Double MA per ${SYMBOL}`);

  await connection.query(`INSERT INTO strategy_runs (id, strategy, symbol, mode, start_date, end_date, capital, status, params_json, started_at)
    VALUES (?, 'DoubleMA', ?, 'backtest', ?, ?, ?, 'running', ?, NOW())`,
    [id, SYMBOL, START_DATE, END_DATE, CAPITALE, JSON.stringify({ SL, TP, SHORT, LONG })]);

  try {
    const dataset = await StrategyUtils.backTest(SYMBOL, START_DATE, END_DATE, API_KEY, API_SECRET);
    const prices = dataset.map(d => d.c);
    const maShort = StrategyUtils.calcSMA(prices, parseInt(SHORT));
    const maLong = StrategyUtils.calcSMA(prices, parseInt(LONG));

    let capitaleLibero = parseFloat(CAPITALE);
    let capitaleInvestito = 0;
    let comprato = 0;
    let daysFree = 0;
    let daysInvested = 0;
    let lastOp;
    let numOp = 0;
    let minDay = 9999999;
    let maxDay = 0;

    for (let i = LONG + 1; i < dataset.length; i++) {
      const element = dataset[i];
      const currentDate = new Date(element.t);

      const goldenCross = maShort[i - 1] < maLong[i - 1] && maShort[i] >= maLong[i];

      if (goldenCross && capitaleLibero > 0) {
        comprato = element.c;
        capitaleInvestito = capitaleLibero;
        capitaleLibero = 0;
        const media = maShort[i];

        if (lastOp) daysFree += (currentDate - lastOp) / (1000 * 60 * 60 * 24);
        await StrategyUtils.writeBuy(connection, id, currentDate, comprato, capitaleInvestito, media, comprato, 0, daysFree);
        lastOp = currentDate;
      }

      if (capitaleInvestito > 0) {
        if (element.c < comprato * (1 - SL) || element.c > comprato * (1 + TP)) {
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
    const profittoAnnuo = StrategyUtils.getAnnualizedProfit(START_DATE, END_DATE, (capitaleFinale / CAPITALE - 1));
    const rapportoEfficienza = capitaleFinale === CAPITALE ? 0 : daysFree / ((capitaleFinale / CAPITALE - 1) * 100);

    await connection.query(`UPDATE strategy_runs SET status = 'done', completed_at = NOW(), profit = ?, efficienza = ? WHERE id = ?`,
      [(capitaleFinale / CAPITALE - 1), rapportoEfficienza, id]);

    console.log(`[${id}] Strategia completata con successo.`);
  } catch (err) {
    console.error(`[${id}] Errore durante l'esecuzione:`, err);
    await connection.query(`UPDATE strategy_runs SET status = 'failed', completed_at = NOW() WHERE id = ?`, [id]);
  }

  await connection.end();
})();
