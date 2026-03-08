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

export default function ServiceControlPlaneArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.rowTop}>
          <Card title="Operatori / Frontend" text="Gestiscono feature flag e stato operativo" tone="clients" />
          <Card title="Traefik + AuthForward" text="Protegge /servicecontrolplane/*" tone="traefik" />
        </div>

        <div className={styles.arrowDown}>REST API control-plane</div>

        <div className={styles.rowCenter}>
          <Card title="servicecontrolplane" text="ServiceControlPlane + ServiceFlags router/client" tone="core">
            <ul>
              <li>CRUD flag per env/microservice</li>
              <li>standard status/settings endpoints</li>
              <li>Redis bus + logger shared</li>
            </ul>
          </Card>
        </div>

        <div className={styles.rowBottom}>
          <Card title="datahub" text="tabella service_flags via /api/table/*" tone="datahub" />
          <Card title="Redis" text="status, metrics, logs e canali runtime" tone="redis" />
          <Card title="Microservizi backend" text="consumano i flag per comportamento runtime" tone="services" />
        </div>
      </div>
    </section>
  );
}
