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

export default function AlertingServiceArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.rowTop}>
          <Card title="Microservizi backend" text="Pubblicano logs/events su Redis" tone="sources" />
          <Card title="Client/Operatori" text="Gestiscono regole e trigger manuali via REST" tone="clients" />
        </div>

        <div className={styles.arrowDown}>Redis subscribe + REST API</div>

        <div className={styles.rowCenter}>
          <Card title="alertingservice (RuleEngine)" text="Match regole, dedup/throttle, dispatch canali" tone="engine">
            <ul>
              <li>source: logs + events</li>
              <li>azioni: email / whatsapp</li>
              <li>stateful windowing per rule</li>
            </ul>
          </Card>
        </div>

        <div className={styles.rowBottom}>
          <Card title="datahub" text="alerting-rules, alerting-state, alerting-deliveries" tone="datahub" />
          <Card title="SMTP" text="Invio email (nodemailer)" tone="smtp" />
          <Card title="Twilio" text="Invio WhatsApp/template" tone="twilio" />
          <Card title="Redis Bus" text="Pattern events/logs + catalog EVENTS:*" tone="redis" />
        </div>
      </div>
    </section>
  );
}
