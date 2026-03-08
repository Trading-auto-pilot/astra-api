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

export default function CacheManagerArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.band}>
          <Card
            title="Microservizi interni"
            text="decision-engine, tickerScanner, scheduler, market-data-service, ..."
            tone="services"
          />
          <div className={styles.pill}>HTTP interno (CACHEMANAGER_URL)</div>
        </div>

        <div className={styles.coreGrid}>
          <div className={styles.leftCol}>
            <Card title="Broker/Provider esterni" tone="brokers">
              <ul>
                <li>FMP</li>
                <li>Alpaca</li>
                <li>IBKR (via ibkr-bridge)</li>
              </ul>
            </Card>
            <div className={styles.arrowRight}>L1 fetch</div>
          </div>

          <div className={styles.centerCol}>
            <Card
              title="cachemanager"
              text="Orchestrazione cache a livelli L3 -> L2 -> L1"
              tone="cachemanager"
            >
              <ul>
                <li>merge e normalizzazione candele</li>
                <li>scrittura su Redis e file cache</li>
                <li>monitor soglie e cleanup</li>
              </ul>
            </Card>
          </div>

          <div className={styles.rightCol}>
            <div className={styles.arrowLeft}>cache hit/miss</div>
            <Card title="Redis (L3)" text="Cache in-memory key candles:{symbol}:{tf}" tone="redis" />
            <Card title="Filesystem (L2)" text="/app/cache (file mensili JSON per simbolo/tf)" tone="fs">
              <small>volume persistente: cachemanager_data:/app/cache</small>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
