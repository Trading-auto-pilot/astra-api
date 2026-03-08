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

export default function RedisWsBridgeArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.rowTop}>
          <Card title="Microservizi backend" text="Pubblicano eventi su Redis channel/pattern" tone="services" />
          <Card title="Frontend / realtime clients" text="Consumano stream via WebSocket /ws" tone="clients" />
        </div>

        <div className={styles.arrowDown}>Redis psubscribe + WS dispatch</div>

        <div className={styles.rowCenter}>
          <Card title="redis-ws-bridge" text="Bridge Redis -> WebSocket con filtri e aggregazione" tone="bridge">
            <ul>
              <li>filtri: topics/symbols/types</li>
              <li>aggregate: throttle, lastPerSymbol, tickToBar1s</li>
              <li>metriche client e stato bus</li>
            </ul>
          </Card>
        </div>

        <div className={styles.rowBottom}>
          <Card title="Redis Bus" text="Sorgente eventi (pattern configurati)" tone="redis" />
          <Card title="datahub" text="settings + log persistenti" tone="datahub" />
        </div>
      </div>
    </section>
  );
}
