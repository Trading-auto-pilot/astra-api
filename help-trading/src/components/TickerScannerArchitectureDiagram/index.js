import React from 'react';
import styles from './styles.module.css';

function Card({ title, text, tone = 'default', children }) {
  return (
    <div className={`${styles.card} ${styles[tone]}`}>
      <div className={styles.title}>{title}</div>
      {text ? <p>{text}</p> : null}
      {children}
    </div>
  );
}

export default function TickerScannerArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.rowTop}>
          <Card title="Frontend / Utenti" text="Invocano endpoint scanner e fundamentals" tone="clients" />
          <Card title="Scheduler" text="Invoca flussi automatici via job e x-job-key" tone="scheduler" />
        </div>

        <div className={styles.arrowDown}>REST API + async jobs</div>

        <div className={styles.rowCenter}>
          <Card title="tickerscanner" text="scan, scoring, market/user daily jobs" tone="service">
            <ul>
              <li>servizi: screener, fundamentals, momentum, scoring</li>
              <li>route interne ed esterne per job async</li>
              <li>autenticazione user e internal token</li>
            </ul>
          </Card>
        </div>

        <div className={styles.rowBottom}>
          <Card title="datahub" text="persistenza score/jobs/history" tone="datahub" />
          <Card title="cachemanager" text="supporto dati/market cache" tone="cache" />
          <Card title="AuthService" text="risoluzione user da token/api key" tone="auth" />
          <Card title="FMP API" text="dati fundamentals e screener esterni" tone="external" />
        </div>
      </div>
    </section>
  );
}
