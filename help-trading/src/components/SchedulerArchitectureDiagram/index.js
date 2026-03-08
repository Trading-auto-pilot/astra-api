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

export default function SchedulerArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.rowTop}>
          <Card title="Operatori / Frontend" text="Gestione job via REST (/jobs, /reload, /run)" tone="clients" />
          <Card title="Traefik" text="Routing /scheduler/* + CORS + ForwardAuth" tone="traefik" />
        </div>

        <div className={styles.arrowDown}>HTTP API + internal orchestration</div>

        <div className={styles.rowCenter}>
          <Card title="scheduler" text="SchedulerCore + SchedulerEngine (cron, retry, async hooks)" tone="scheduler">
            <ul>
              <li>carica job da datahub (scheduler_jobs)</li>
              <li>firma token interni per endpoint /internal/*</li>
              <li>pubblica eventi TASK.* su Redis</li>
            </ul>
          </Card>
        </div>

        <div className={styles.rowBottom}>
          <Card title="datahub" text="CRUD scheduler_jobs + last_run persistito" tone="datahub" />
          <Card title="Redis" text="bus eventi + hook async + KV last-run" tone="redis" />
          <Card title="Microservizi target" text="decision-engine, tickerScanner, altri endpoint job" tone="targets" />
        </div>
      </div>
    </section>
  );
}
