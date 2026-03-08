import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const guideCards = [
  {
    title: '1. Guida Utente',
    description: 'Setup account, onboarding, uso operativo e troubleshooting di primo livello.',
    link: '/docs/utente/overview',
  },
  {
    title: '2. Developer',
    description: 'Autenticazione, endpoint, payload e best practice per integrazioni esterne.',
    link: '/docs/developer-esterno-api/overview',
  },
  {
    title: '3. Amministratore',
    description: 'Operazioni amministrative, gestione accessi, monitoraggio e runbook.',
    link: '/docs/amministratore/overview',
  },
  {
    title: '4. API',
    description: 'Mappa del codice, standard e flussi di sviluppo del monorepo trading-system.',
    link: '/docs/developer-interno/overview',
  },
  {
    title: '5. Release Notes',
    description: 'Versioni, date di rilascio e changelog dettagliato di tutti i componenti backend.',
    link: '/docs/release-notes/overview',
  },
];

export default function Home() {
  return (
    <Layout
      title="Trading System Help"
      description="Portale documentazione per utenti, API esterne, amministratori e developer interni.">
      <header className={clsx(styles.heroBanner)}>
        <div className={styles.heroBackdrop} />
        <div className="container">
          <p className={styles.kicker}>Trading Platform Documentation</p>
          <h1 className={styles.heroTitle}>Trading System Help Center</h1>
          <p className={styles.heroSubtitle}>
            Documentazione organizzata per ruoli e cartelle: trovi subito cosa ti serve, dal primo accesso
            fino ai dettagli interni del codice.
          </p>
          <div className={styles.heroActions}>
            <Link className="button button--lg button--primary" to="/docs/">
              Apri panoramica
            </Link>
            <Link className="button button--lg button--secondary" to="/docs/developer-interno/mappa-cartelle">
              Vedi struttura codice
            </Link>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <section className="container">
          <div className={styles.grid}>
            {guideCards.map((card) => (
              <Link key={card.title} className={styles.card} to={card.link}>
                <h2>{card.title}</h2>
                <p>{card.description}</p>
                <span>Apri guida</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}
