FROM eclipse-temurin:17-jre-jammy

WORKDIR /opt/ibkr

RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip ca-certificates curl bash \
  && rm -rf /var/lib/apt/lists/*

COPY SW/clientportal.gw.zip /tmp/clientportal.gw.zip

RUN unzip /tmp/clientportal.gw.zip -d /opt/ibkr \
  && rm /tmp/clientportal.gw.zip \
  && chmod +x /opt/ibkr/bin/run.sh

EXPOSE 5000

# IMPORTANT: esegui da /opt/ibkr/root e passa conf relativo (evita il bug ..//)
CMD ["/bin/bash", "-lc", "cd /opt/ibkr && /opt/ibkr/bin/run.sh root/conf.yaml"]
