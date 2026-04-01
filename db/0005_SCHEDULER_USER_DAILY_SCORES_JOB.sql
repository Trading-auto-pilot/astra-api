-- Migration 0005: Aggiunge job EOD per user-daily-scores nel scheduler
-- Calcola daily_scores per le pipe utente (pipe_id > 0) dopo update-market-daily e ranking/daily
-- Eseguito ogni giorno feriale alle 22:30 (dopo ranking/daily che tipicamente è alle 22:00-22:15)

-- Inserisce il job solo se non esiste già (idempotente)
INSERT INTO `scheduler_jobs` (`job_key`, `description`, `enabled`, `method`, `url`, `headers`, `body`)
SELECT
  'eod-user-daily-scores',
  'EOD: calcola scores daily per pipe utente (pipe_id > 0) — chiama internal/fundamentals/user-daily-scores per ogni utente attivo',
  1,
  'POST',
  'http://tickerscanner:3013/internal/fundamentals/user-daily-scores',
  NULL,
  '{"all_users": true}'
WHERE NOT EXISTS (
  SELECT 1 FROM `scheduler_jobs` WHERE `job_key` = 'eod-user-daily-scores'
);

-- Aggiunge la regola cron per il job appena inserito (lun-ven alle 22:30)
INSERT INTO `scheduler_rules` (`job_id`, `rule_type`, `days_of_week`, `time_hhmm`)
SELECT
  j.id,
  'daily',
  'Monday,Tuesday,Wednesday,Thursday,Friday',
  '22:30'
FROM `scheduler_jobs` j
WHERE j.job_key = 'eod-user-daily-scores'
  AND NOT EXISTS (
    SELECT 1 FROM `scheduler_rules` r WHERE r.job_id = j.id AND r.time_hhmm = '22:30'
  );
