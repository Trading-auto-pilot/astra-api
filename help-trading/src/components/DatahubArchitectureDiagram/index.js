import React from 'react';
import styles from './styles.module.css';

export default function DatahubArchitectureDiagram() {
  return (
    <section className={styles.wrapper}>
      <div className={styles.canvas}>
        <div className={`${styles.block} ${styles.mysql}`}>
          <div className={styles.title}>MySQL</div>
          <p>Schema, tabelle, viste</p>
        </div>

        <div className={`${styles.block} ${styles.redis}`}>
          <div className={styles.title}>Redis</div>
          <p>Cache, eventi, stato volatile</p>
        </div>

        <div className={`${styles.block} ${styles.datahub}`}>
          <div className={styles.title}>datahub</div>
          <p>API dinamiche + route manuali</p>
          <ul>
            <li>Schema reader</li>
            <li>CRUD generator</li>
            <li>Manual routes loader</li>
          </ul>
        </div>

        <div className={`${styles.block} ${styles.services}`}>
          <div className={styles.title}>Altri Microservizi</div>
          <p>auth, scheduler, scanner, cachemanager, alerting, ...</p>
          <small>consumano datahub via DATAHUB_URL</small>
        </div>

        <div className={`${styles.block} ${styles.traefik}`}>
          <div className={styles.title}>Traefik</div>
          <p>Routing esterno /datahub/*</p>
        </div>

        <div className={`${styles.arrow} ${styles.aMySql}`}><span>SQL</span></div>
        <div className={`${styles.arrow} ${styles.aRedis}`}><span>cache</span></div>
        <div className={`${styles.arrow} ${styles.aServices}`}><span>HTTP interno</span></div>
        <div className={`${styles.arrow} ${styles.aTraefik}`}><span>ingress</span></div>
      </div>
    </section>
  );
}
