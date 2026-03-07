# Datahub - Dynamic Database API Features

## Overview

Datahub è un microservizio dinamico che legge automaticamente lo schema del database MySQL e genera endpoint REST CRUD per ogni tabella e vista. Supporta anche endpoint personalizzati definiti manualmente.

## Architettura

```
┌─────────────────────────────────────────────────┐
│              Datahub Service                    │
├─────────────────────────────────────────────────┤
│  BaseService (shared framework)                 │
│  ├─ Redis Bus                                   │
│  ├─ Logger + DB Queue                          │
│  ├─ Settings Management                        │
│  └─ Standard Endpoints                         │
├─────────────────────────────────────────────────┤
│  Dynamic Features                               │
│  ├─ SchemaReader (MySQL schema introspection)  │
│  ├─ DynamicRouterGenerator (CRUD endpoints)    │
│  └─ ManualRoutesLoader (custom routes)        │
└─────────────────────────────────────────────────┘
```

## Generazione Automatica Endpoint

### Per ogni TABELLA nel database:

#### 1. **GET /api/table/{tableName}** - Lista tutti i record
- Supporta paginazione con `limit` (default: 100, max: 1000) e `offset`
- Restituisce count totale e parziale

**Esempio:**
```bash
curl "http://localhost:3000/api/table/users?limit=10&offset=20"
```

**Risposta:**
```json
{
  "ok": true,
  "data": [...],
  "count": 10,
  "total": 150,
  "limit": 10,
  "offset": 20
}
```

#### 2. **GET /api/table/{tableName}/{key}** - Get by Primary Key
- Supporta chiavi singole e composite
- Restituisce 404 se non trovato

**Esempio chiave singola:**
```bash
curl "http://localhost:3000/api/table/users/123"
```

**Esempio chiave composita:**
```bash
# Per tabella con PK (order_id, item_id)
curl "http://localhost:3000/api/table/order_items/1001/5"
```

#### 3. **POST /api/table/{tableName}** - Create
- Crea un nuovo record
- Restituisce il record inserito con l'ID generato

**Esempio:**
```bash
curl -X POST http://localhost:3000/api/table/users \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","email":"john@example.com","age":30}'
```

**Risposta:**
```json
{
  "ok": true,
  "insertedId": 124,
  "affectedRows": 1,
  "data": {
    "id": 124,
    "name": "John Doe",
    "email": "john@example.com",
    "age": 30,
    "created_at": "2026-02-20T10:00:00.000Z"
  }
}
```

#### 4. **PUT /api/table/{tableName}/{key}** - Update
- Aggiorna un record esistente
- Non può modificare la primary key
- Restituisce il record aggiornato

**Esempio:**
```bash
curl -X PUT http://localhost:3000/api/table/users/124 \
  -H "Content-Type: application/json" \
  -d '{"age":31,"email":"newemail@example.com"}'
```

#### 5. **DELETE /api/table/{tableName}/{key}** - Delete
- Elimina un record per chiave primaria
- Restituisce 404 se non trovato

**Esempio:**
```bash
curl -X DELETE http://localhost:3000/api/table/users/124
```

### Per ogni VISTA nel database:

Le viste sono esposte **solo in lettura**:
- ✅ **GET /api/table/{viewName}** - Lista record
- ✅ **GET /api/table/{viewName}/{key}** - Get by key (se la vista ha una PK)
- ❌ POST, PUT, DELETE non disponibili (viste read-only)

## Endpoint di Sistema

### GET /api/schema
Restituisce informazioni complete sullo schema caricato.

**Risposta:**
```json
{
  "ok": true,
  "tables": ["users", "orders", "products", "order_items", ...],
  "manualRoutes": [
    {"name": "example", "path": "/custom/example"}
  ],
  "lastRefresh": "2026-02-20T10:30:00.000Z",
  "totalEndpoints": 25
}
```

### POST /api/refresh
Ricarica lo schema del database e rigenera tutti gli endpoint senza riavviare il servizio.

**Nota:** Per applicare completamente i nuovi endpoint, è necessario riavviare il server dopo il refresh.

**Risposta:**
```json
{
  "ok": true,
  "message": "Schema refreshed successfully. Restart server to apply route changes.",
  "tables": 20,
  "manualRoutes": 2,
  "lastRefresh": "2026-02-20T10:35:00.000Z"
}
```

## Endpoint Personalizzati

### Creazione di Route Custom

1. Crea un file nella cartella `routes/`, esempio `routes/analytics.js`

2. Esporta una funzione factory che restituisce un router Express:

```javascript
// routes/analytics.js
module.exports = function({ logger, schemaReader }) {
  const express = require('express');
  const router = express.Router();

  /**
   * GET /api/custom/analytics/user-stats
   * Statistiche aggregate sugli utenti
   */
  router.get('/user-stats', async (req, res) => {
    try {
      const [stats] = await schemaReader.query(`
        SELECT
          COUNT(*) as total_users,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_users,
          AVG(age) as avg_age
        FROM users
      `);

      res.json({
        ok: true,
        data: stats[0]
      });
    } catch (err) {
      logger.error(`[analytics/user-stats] Error: ${err.message}`);
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  });

  /**
   * GET /api/custom/analytics/orders-by-date
   * Report ordini per data
   */
  router.get('/orders-by-date', async (req, res) => {
    try {
      const { startDate, endDate } = req.query;

      const [results] = await schemaReader.query(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as order_count,
          SUM(total_amount) as total_revenue
        FROM orders
        WHERE created_at BETWEEN ? AND ?
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `, [startDate, endDate]);

      res.json({
        ok: true,
        data: results,
        count: results.length
      });
    } catch (err) {
      logger.error(`[analytics/orders-by-date] Error: ${err.message}`);
      res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  });

  return router;
};
```

3. Gli endpoint saranno disponibili a:
   - `GET /api/custom/analytics/user-stats`
   - `GET /api/custom/analytics/orders-by-date`

4. Per ricaricare le route custom:
   - Chiama `POST /api/refresh`
   - Riavvia il server

### Best Practices per Route Custom

1. **Usa prepared statements** per prevenire SQL injection:
   ```javascript
   // ✅ CORRETTO
   await schemaReader.query('SELECT * FROM users WHERE id = ?', [userId]);

   // ❌ PERICOLOSO
   await schemaReader.query(`SELECT * FROM users WHERE id = ${userId}`);
   ```

2. **Gestisci gli errori** appropriatamente:
   ```javascript
   try {
     // ... query
   } catch (err) {
     logger.error(`[endpoint] Error: ${err.message}`);
     return res.status(500).json({ ok: false, error: err.message });
   }
   ```

3. **Valida gli input** prima di eseguire query:
   ```javascript
   router.get('/data', async (req, res) => {
     const limit = parseInt(req.query.limit) || 100;

     if (limit < 1 || limit > 1000) {
       return res.status(400).json({
         ok: false,
         error: 'limit must be between 1 and 1000'
       });
     }
     // ... continue
   });
   ```

## Configurazione

### Variabili d'Ambiente

```env
# MySQL Connection (REQUIRED)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=trading_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=trading

# Server Configuration
PORT=3000
ENV=DEV
LOG_LEVEL=info

# Redis (from BaseService)
REDIS_URL=redis://localhost:6379

# Other standard BaseService env vars...
```

## Sicurezza

### SQL Injection Prevention
- ✅ Tutti gli endpoint usano **prepared statements**
- ✅ I parametri sono sempre escaped da mysql2

### Autenticazione
- Gli endpoint possono essere protetti tramite Traefik middleware
- Modifica `protected: true` nelle route definition in server.js

### Limitazioni
- Limite di 1000 record per richiesta GET
- Timeout delle query configurabile nel pool MySQL

## Performance

### Connection Pooling
```javascript
// In SchemaReader
connectionLimit: 10,  // Max 10 connessioni simultanee
queueLimit: 0,        // Nessun limite alla coda
```

### Caching
Per migliorare le performance su query frequenti, considera di:
1. Usare Redis per cachare risultati
2. Implementare cache nelle route custom
3. Creare indici appropriati nel database

### Paginazione
Usa sempre `limit` e `offset` per tabelle grandi:
```bash
# Prima pagina
curl "http://localhost:3000/api/table/users?limit=100&offset=0"

# Seconda pagina
curl "http://localhost:3000/api/table/users?limit=100&offset=100"
```

## Limitazioni Conosciute

1. **Tabelle senza Primary Key**
   - Solo endpoint GET per lista disponibile
   - GET by key, PUT, DELETE non disponibili

2. **Viste del Database**
   - Solo operazioni read-only (GET)
   - Modifiche devono essere fatte sulla tabella base

3. **Hot Reload**
   - `/api/refresh` ricarica lo schema ma richiede restart server per applicare route changes

4. **Relazioni tra Tabelle**
   - Gli endpoint sono flat (non supportano join automatici)
   - Usa route custom per query con join

## Troubleshooting

### Errore: "MySQL pool not initialized"
**Causa:** SchemaReader non connesso
**Soluzione:** Verifica le variabili d'ambiente MySQL e che il server MySQL sia raggiungibile

### Schema vuoto dopo /api/refresh
**Causa:** Database vuoto o permessi insufficienti
**Soluzione:**
1. Verifica che `MYSQL_DATABASE` contenga tabelle
2. L'utente deve avere accesso a `INFORMATION_SCHEMA`

### Route custom non caricate
**Causa:** Errore nel file della route
**Soluzione:**
1. Verifica che il file esporti una funzione
2. La funzione deve restituire un Express Router
3. Controlla i log per errori di sintassi

## Migrazione da dbManager

### Vantaggi di Datahub

| Feature | dbManager | Datahub |
|---------|-----------|---------|
| Endpoint per tabella | Manuale | ✅ Automatico |
| Supporto viste | ❌ No | ✅ Sì (read-only) |
| Hot reload schema | ❌ No | ✅ Sì (con restart) |
| Paginazione | Manuale | ✅ Automatica |
| Primary key composite | Manuale | ✅ Automatica |
| Custom endpoints | Manuale | ✅ Coesistono |

### Passi per Migrazione

1. **Backup**: Salva gli endpoint custom di dbManager
2. **Convert**: Converti gli endpoint in formato Datahub (routes/*.js)
3. **Test**: Verifica gli endpoint generati automaticamente
4. **Update**: Cambia `DBMANAGER_URL` in `DATAHUB_URL` nei microservizi
5. **Deploy**: Sostituisci dbManager con datahub

## Testing

### Test Endpoint Dinamici

```bash
# Schema info
curl http://localhost:3000/api/schema

# Lista tabelle
curl http://localhost:3000/api/table/users?limit=5

# Get by ID
curl http://localhost:3000/api/table/users/1

# Create
curl -X POST http://localhost:3000/api/table/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@test.com"}'

# Update
curl -X PUT http://localhost:3000/api/table/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Name"}'

# Delete
curl -X DELETE http://localhost:3000/api/table/users/1

# Refresh schema
curl -X POST http://localhost:3000/api/refresh
```

## File Principali

```
datahub/
├── modules/
│   ├── main.js                      # BaseService esteso con logica datahub
│   ├── schemaReader.js              # Lettura schema MySQL
│   ├── dynamicRouterGenerator.js   # Generazione endpoint CRUD
│   └── manualRoutesLoader.js       # Caricamento route custom
├── routes/
│   ├── example.js                   # Esempio route custom
│   └── README.md                    # Guida route custom
├── server.js                        # Express server con serverFactory
├── package.json
├── README.md                        # Documentazione base
└── DATAHUB_FEATURES.md             # Questo file
```
