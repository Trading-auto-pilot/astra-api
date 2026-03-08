import React from 'react';
import styles from './styles.module.css';

function Block({ title, text, small, children, tone = 'default' }) {
  return (
    <div className={`${styles.block} ${styles[tone]}`}>
      <div className={styles.title}>{title}</div>
      {text ? <p>{text}</p> : null}
      {small ? <small>{small}</small> : null}
      {children}
    </div>
  );
}

export default function AuthServiceArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={styles.row}>
          <Block
            title="Microservizi Backend"
            text="scheduler, scanner, cache, market-data, ..."
            small="richieste API protette"
            tone="services"
          />
        </div>

        <div className={styles.arrowDown}>HTTP API</div>

        <div className={styles.row}>
          <Block title="Traefik" text="Gateway + routing" tone="traefik" />
        </div>

        <div className={styles.arrowDown}>ForwardAuth /auth/validate</div>

        <div className={styles.row}>
          <Block
            title="authservice"
            text="Login, renew, validate"
            tone="auth"
          >
            <ul>
              <li>JWT + API key</li>
              <li>Permission matching</li>
              <li>Header X-User-Id / X-Api-Key-Id</li>
            </ul>
          </Block>
        </div>

        <div className={styles.arrowDown}>DATAHUB_URL</div>

        <div className={styles.row}>
          <Block
            title="datahub"
            text="Utenti, permessi, API keys"
            small="layer dati centralizzato"
            tone="datahub"
          />
        </div>

        <div className={styles.arrowDown}>SQL</div>

        <div className={styles.row}>
          <Block title="MySQL" text="Persistenza utenti/permessi" tone="mysql" />
        </div>
      </div>
    </section>
  );
}
