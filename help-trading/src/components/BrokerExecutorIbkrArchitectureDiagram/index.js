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

export default function BrokerExecutorIbkrArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.rowTop}>
          <Card title="Decision-engine / Scheduler" text="Invocano esecuzione ordini" tone="callers" />
          <Card title="Traefik + AuthForward" text="Protegge /broker-executor-ibkr/*" tone="traefik" />
        </div>

        <div className={styles.arrowDown}>REST API ordini + status WS</div>

        <div className={styles.rowCenter}>
          <Card title="broker-executor-ibkr" text="Controller + IbkrOrdersService + WS listener" tone="core">
            <ul>
              <li>creazione/modifica/cancellazione bracket orders</li>
              <li>idempotenza su externalCorrelationId</li>
              <li>reconciliation ordini/posizioni da WS + snapshot</li>
            </ul>
          </Card>
        </div>

        <div className={styles.rowBottom}>
          <Card title="ibkr-bridge / IBKR GW" text="Mirror API e websocket ordini live" tone="ibkr" />
          <Card title="Redis" text="eventi stato ordini e update runtime" tone="redis" />
          <Card title="datahub" text="supporto configurazione/logging shared" tone="datahub" />
        </div>
      </div>
    </section>
  );
}
