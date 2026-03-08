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

export default function MarketDataServiceArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.topRow}>
          <Card
            title="decision-engine / altri consumer"
            text="Gestione subscribe live e consumo eventi market-data"
            tone="consumers"
          />
        </div>

        <div className={styles.arrowDown}>HTTP control API</div>

        <div className={styles.centerRow}>
          <Card
            title="market-data-service"
            text="WS gateway client + snapshot loop + publish Redis"
            tone="service"
          >
            <ul>
              <li>subscriptions / fields</li>
              <li>ticker-conid mapping</li>
              <li>snapshot scheduler</li>
            </ul>
          </Card>
        </div>

        <div className={styles.bottomRow}>
          <Card title="IBKR Gateway" text="WS live feed (/v1/api/ws)" tone="gateway" />
          <Card title="ibkr-bridge" text="Snapshot HTTP endpoint" tone="bridge" />
          <Card title="Redis Bus" text="publish su ENV.market-data-service.data" tone="redis" />
          <Card title="datahub" text="settings + log persistenti" tone="datahub" />
        </div>
      </div>
    </section>
  );
}
