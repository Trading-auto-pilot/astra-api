# delete-microservice.js - Safe Microservice Deletion

## Overview

Script per eliminare in modo sicuro un microservizio esistente dal sistema, eseguendo tutte le operazioni di pulizia necessarie.

## ⚠️ Importante

- Lo script **NON elimina** la cartella del microservizio, ma la **rinomina** in `.DELETED_<serviceName>_<timestamp>`
- Richiede **conferma esplicita** dall'utente prima di procedere
- Tutte le operazioni sono **logged** in modo dettagliato

---

## 🚀 Quick Start

```bash
# Elimina un microservizio
node delete-microservice.js <serviceName>

# Esempi
node delete-microservice.js MarketListener
node delete-microservice.js liquidity-manager
```

---

## 📋 Operazioni Eseguite

Lo script esegue automaticamente le seguenti operazioni:

### 1. **Conferma Utente**
- Richiede conferma esplicita digitando `yes`
- Cancellazione sicura per evitare eliminazioni accidentali

### 2. **Docker Compose**
- ✅ Rimuove il servizio da `docker-compose.yml`
- ✅ Rimuove il servizio da `docker-compose.local.yml`

### 3. **Ports Configuration**
- ✅ Rimuove la porta da `doc/ports.json`
- ✅ Libera la porta per essere riutilizzata

### 4. **Environment Variables**
- ✅ Rimuove da `.env`
- ✅ Rimuove da `.env.local`
- ✅ Rimuove da `.env.paper`
- Variabili rimosse:
  - `<SERVICE>_VERSION`
  - `<SERVICE>_URL`

### 5. **Deployment Configuration**
- ✅ Rimuove da `.github/workflows/deploy.yml`
- ✅ Aggiorna la lista dei servizi deployabili

### 6. **Database**
- ✅ Elimina il record dalla tabella `service_flags`
- ✅ Usa `ENV` dalla variabile d'ambiente (default: "local")

### 7. **Frontend Pages**
- ✅ Elimina `<ClassName>MicroservicePage.tsx`
- ✅ Rimuove l'import da `AdminMicroserviceDetailPage.tsx`
- ✅ Rimuove il case dal switch di routing

### 8. **Service Directory**
- ✅ Rinomina la cartella in `.DELETED_<serviceName>_<timestamp>`
- ✅ **NON elimina** i file (backup automatico)

---

## 📊 Output Example

```bash
$ node delete-microservice.js TestService

🗑️  Deleting microservice: TestService
   Service key: test-service
   Class name:  TestService

⚠️  Are you sure you want to delete microservice "TestService"? (yes/no): yes

📋 Starting deletion process...

🐳 Removing from Docker Compose files...
   ✓ Removed from docker-compose.yml
   ✓ Removed from docker-compose.local.yml

📋 Removing from ports.json...
   ✓ Removed from doc/ports.json

📄 Removing from .env files...
   ✓ Updated .env files

📦 Removing from deploy.yml...
   ✓ Removed from deploy.yml

💾 Removing from database...
   ✓ Removed from database (1 row(s) deleted)

🎨 Removing frontend page...
   ✓ Removed TestServiceMicroservicePage.tsx
   ✓ Removed import from AdminMicroserviceDetailPage.tsx
   ✓ Removed route case from AdminMicroserviceDetailPage.tsx

📁 Renaming service directory...
   ✓ Renamed directory to .DELETED_TestService_20260216_143025

✅ Microservice deleted successfully!

📊 Summary:
   Name:         TestService
   Service key:  test-service
   Class:        TestService

   Removed from:
   • docker-compose.yml
   • docker-compose.local.yml
   • doc/ports.json
   • .env files
   • .github/workflows/deploy.yml
   • Database: service_flags table (ENV=local)
   • Frontend: ../astraai (page and route)
   • Directory renamed to: .DELETED_TestService_20260216_143025

💡 Notes:
   • The service directory has been renamed, not deleted
   • You can manually delete the .DELETED_* directory when you're sure
   • If the service was running, you may need to stop it manually
```

---

## 🛡️ Safety Features

### 1. **Confirmation Required**
Lo script richiede conferma esplicita prima di procedere:
```
⚠️  Are you sure you want to delete microservice "TestService"? (yes/no):
```

### 2. **Backup Automatico**
La cartella del servizio viene **rinominata**, non eliminata:
```
TestService/ → .DELETED_TestService_20260216_143025/
```

### 3. **Error Handling**
Ogni operazione è wrappata in try-catch con logging dettagliato:
- ✅ Se un'operazione fallisce, continua con le successive
- ⚠️ Mostra warnings per operazioni non riuscite
- ❌ Mostra errori dettagliati se necessario

### 4. **Graceful Degradation**
Se un file non esiste o un'operazione fallisce:
- Lo script continua con le altre operazioni
- Mostra un warning informativo
- Non blocca il processo di eliminazione

---

## 🔄 Ripristino Manuale

Se vuoi ripristinare un microservizio eliminato:

### 1. **Rinomina la cartella**
```bash
mv .DELETED_TestService_20260216_143025 TestService
```

### 2. **Ri-crea il microservizio**
```bash
node create-microservice-v2.js TestService --port=<original-port>
```

Oppure aggiungi manualmente le configurazioni ai file che erano stati modificati.

---

## ⚙️ Variabili d'Ambiente

Lo script usa le stesse variabili d'ambiente di `create-microservice-v2.js`:

```bash
# Database connection (per rimuovere da service_flags)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=trading_user
MYSQL_PASSWORD=trading_pass
MYSQL_DATABASE=Trading

# Environment (per filtrare i record nel database)
ENV=local
```

---

## 📝 Logging

### Success (✓)
```
   ✓ Removed from docker-compose.yml
   ✓ Removed from database
```

### Warning (⚠️)
```
   ⚠️  Service "test-service" not found in ports.json
   ⚠️  Frontend directory not found, skipping
```

### Error (❌)
```
   ❌ Failed to remove from deploy.yml: Permission denied
```

---

## 🚨 Cosa NON fa lo Script

1. **NON ferma il servizio** se è in esecuzione
   - Devi farlo manualmente: `pkill -f "node.*TestService"`

2. **NON elimina i volumi Docker**
   - Se hai volumi specifici, eliminali manualmente

3. **NON fa commit Git**
   - Le modifiche ai file vanno committate manualmente

4. **NON elimina definitivamente** la cartella
   - Viene solo rinominata per sicurezza

---

## 💡 Best Practices

### Prima di Eliminare
1. ✅ Assicurati che il servizio non sia in uso
2. ✅ Fai backup del database se necessario
3. ✅ Verifica che nessun altro servizio dipenda da quello che stai eliminando

### Dopo l'Eliminazione
1. ✅ Verifica che il servizio non sia più in esecuzione
2. ✅ Controlla che i file siano stati aggiornati correttamente
3. ✅ Testa che gli altri servizi funzionino ancora
4. ✅ Elimina manualmente la cartella `.DELETED_*` quando sei sicuro

---

## 🔍 Troubleshooting

### Il servizio non viene trovato
```
⚠️  Service "test-service" not found in ports.json
```
**Soluzione:** Il servizio potrebbe essere stato già eliminato o avere un nome diverso.

### Database connection failed
```
⚠️  Database deletion failed: connect ECONNREFUSED
```
**Soluzione:** Assicurati che MySQL sia in esecuzione e le credenziali siano corrette.

### Permission denied
```
❌ Failed to rename directory: Permission denied
```
**Soluzione:** Verifica i permessi della cartella o che il servizio non sia in esecuzione.

---

## 📚 See Also

- **Create Script:** [CREATE_MICROSERVICE_V2_README.md](./CREATE_MICROSERVICE_V2_README.md)
- **BaseService API:** [shared/BaseService.README.md](./shared/BaseService.README.md)
- **Factories:** [shared/FACTORIES_README.md](./shared/FACTORIES_README.md)

---

**Version:** 1.0.0
**Created:** 2026-02-16
**Status:** ✅ Ready for Production
