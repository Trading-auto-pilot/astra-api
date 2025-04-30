#!/bin/bash

# Script per eseguire un file .sql su un database MySQL

# Funzione per mostrare l'uso corretto
usage() {
  echo "Utilizzo: $0 -h host -P porta -u utente -d database -f file.sql"
  exit 1
}

# Parsing dei parametri
while getopts ":h:P:u:p:d:f:" opt; do
  case ${opt} in
    h ) DB_HOST=$OPTARG ;;
    P ) DB_PORT=$OPTARG ;;
    u ) DB_USER=$OPTARG ;;
    p ) DB_PASS=$OPTARG ;;
    d ) DB_NAME=$OPTARG ;;
    f ) SQL_FILE=$OPTARG ;;
    \? ) usage ;;
  esac
done

# Verifica dei parametri obbligatori
if [ -z "$DB_HOST" ] || [ -z "$DB_PORT" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ] || [ -z "$SQL_FILE" ]; then
  usage
fi

# Verifica dell'esistenza del file SQL
if [ ! -f "$SQL_FILE" ]; then
  echo "Errore: il file $SQL_FILE non esiste."
  exit 1
fi

# Esecuzione del file SQL
if [ -z "$DB_PASS" ]; then
  # Se la password non è fornita, chiede all'utente di inserirla
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p "$DB_NAME" < "$SQL_FILE"
else
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$SQL_FILE"
fi

# Verifica dell'esito dell'operazione
if [ $? -eq 0 ]; then
  echo "Script SQL eseguito con successo su $DB_NAME."
else
  echo "Errore durante l'esecuzione dello script SQL."
  exit 1
fi
