import React from 'react';
import styles from './styles.module.css';

function Block({ title, text, tone = 'default', children }) {
  return (
    <div className={`${styles.block} ${styles[tone]}`}>
      <div className={styles.title}>{title}</div>
      {text ? <p>{text}</p> : null}
      {children}
    </div>
  );
}

export default function DecisionEngineArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.rowTop}>
          <Block title="Scheduler" text="Trigger job interni /internal/spot-finder/*" tone="scheduler" />
          <Block title="Client/Microservizi" text="Richieste API /decision-engine/spot-finder/*" tone="clients" />
        </div>

        <div className={styles.arrowDown}>HTTP + x-internal-token</div>

        <div className={styles.rowCenter}>
          <Block title="decision-engine" text="Analisi spot-finder, job async, live mode" tone="engine">
            <ul>
              <li>calcolo segnali multi-timeframe</li>
              <li>snapshot job/live su Redis</li>
              <li>orchestrazione ticker per pipe utente</li>
            </ul>
          </Block>
        </div>

        <div className={styles.rowBottom}>
          <Block title="datahub" text="Settings + log persistenti" tone="datahub" />
          <Block title="cachemanager" text="Candles storiche L3/L2/L1" tone="cache" />
          <Block title="tickerScanner" text="Ticker filtrati per user/pipe" tone="scanner" />
        </div>

        <div className={styles.pills}>
          <span>read settings da datahub</span>
          <span>write log su datahub (/logs)</span>
          <span>invocabile da scheduler</span>
        </div>
      </div>
    </section>
  );
}
