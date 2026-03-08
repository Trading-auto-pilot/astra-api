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

export default function IbkrBridgeArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.rowTop}>
          <Card title="Microservizi interni" text="market-data-service, brokerExecutor, altri consumer broker" tone="services" />
        </div>

        <div className={styles.arrowDown}>HTTP API (/mirror, /accounts, /account)</div>

        <div className={styles.rowCenter}>
          <Card title="ibkr-bridge" text="Proxy API + connectivity loop + reauth SSO" tone="bridge">
            <ul>
              <li>auth status, tickle, ssodh init</li>
              <li>fallback reauth su 401</li>
              <li>telemetria su Redis bus</li>
            </ul>
          </Card>
        </div>

        <div className={styles.rowBottom}>
          <Card title="IBKR Gateway" text="Endpoint /v1/api/* (broker API)" tone="gateway" />
          <Card title="SSO Dispatcher" text="Re-auth URL (IBKRGW_SSO_URL)" tone="sso" />
          <Card title="Redis Bus" text="telemetry/status del bridge" tone="redis" />
          <Card title="datahub" text="settings + log persistenti" tone="datahub" />
        </div>
      </div>
    </section>
  );
}
