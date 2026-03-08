---
sidebar_position: 22
---

# ibkrgw-paper

## Cosa fa

Gateway IBKR (paper) usato come endpoint broker upstream per i microservizi `ibkr-*` e market data.

## Ruoli e responsabilita

- endpoint HTTPS verso Client Portal Gateway IBKR;
- base di connettivita per `ibkr-bridge` e `ibkr-keepalive`;
- terminazione/routing tramite Traefik su host dedicato.

## Porta esposta

- Mapping host/container: `5001:5000`
- Exposed host: `expopaper.localhost` (via Traefik websecure)

## Configurazione (docker-compose.paper.yml)

```yaml
ibkrgw-paper:
  image: expovin/ibkr-clientportal:${IBKRGW_VERSION}
  restart: unless-stopped
  networks:
    - trading_net
  ports:
    - "5001:5000"
  volumes:
    - ./IBKR_API_Gateway/conf.local.expopaper.yaml:/opt/ibkr/root/conf.yaml:ro
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.ibkrgw-expopaper.rule=Host(`expopaper.localhost`)"
    - "traefik.http.routers.ibkrgw-expopaper.entrypoints=websecure"
    - "traefik.http.routers.ibkrgw-expopaper.tls=true"
    - "traefik.http.services.ibkrgw-expopaper.loadbalancer.server.port=5000"
    - "traefik.http.services.ibkrgw-expopaper.loadbalancer.server.scheme=https"
```
