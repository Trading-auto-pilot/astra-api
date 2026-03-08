---
sidebar_position: 7
---

# mysql

## Cosa fa

Database relazionale centrale per persistenza configurazioni e dati applicativi.

## Ruoli e responsabilita

- storage transazionale;
- base per tabelle core (es. configurazione servizi, dati operativi);
- dipendenza di `datahub` e altri servizi applicativi.

## Porta esposta

- `3306:3306`

## Configurazione (docker-compose.paper.yml)

```yaml
mysql:
  image: mysql:8.0
  restart: unless-stopped
  environment:
    MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    MYSQL_DATABASE: ${MYSQL_DATABASE}
    MYSQL_USER: ${MYSQL_USER}
    MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    MYSQL_PORT: ${MYSQL_PORT}
    MYSQL_HOST: ${MYSQL_HOST}
    ENV: ${ENV}
    TZ: ${TIMEZONE}
  ports:
    - "3306:3306"
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
```
