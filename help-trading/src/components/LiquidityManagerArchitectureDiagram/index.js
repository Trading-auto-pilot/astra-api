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

export default function LiquidityManagerArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.rowTop}>
          <Card title="Operatori / Scheduler" text="Trigger recompute e query score" tone="clients" />
          <Card title="Traefik + AuthForward" text="Routing /liquidity-manager/*" tone="traefik" />
        </div>

        <div className={styles.arrowDown}>Liquidity score API</div>

        <div className={styles.rowCenter}>
          <Card title="liquidity-manager" text="Engine + TaskManager + Repository" tone="core">
            <ul>
              <li>calcolo liquidity score multi-provider</li>
              <li>task asincroni di recompute con progress</li>
              <li>history e provider health status</li>
            </ul>
          </Card>
        </div>

        <div className={styles.rowBottom}>
          <Card title="Provider esterni" text="VIX, SPY trend, DXY, credit spread" tone="providers" />
          <Card title="Repository" text="snapshot corrente + storico score" tone="repo" />
          <Card title="Redis/Data channel" text="pubblicazione progress task e telemetria" tone="redis" />
        </div>
      </div>
    </section>
  );
}
