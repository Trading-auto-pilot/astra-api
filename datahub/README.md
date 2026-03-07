# datahub

Datahub microservice built with BaseService framework.

## Quick Start

```bash
# Development
npm run dev

# Production
npm start
```

## Architecture

This service uses the centralized microservice framework:

- **BaseService** (modules/main.js): Business logic extends BaseService
- **serverFactory** (server.js): Express server with standard routes
- **No status.js**: Eliminated! Status routes provided by statusRouterFactory

## Code Reduction

Traditional approach: ~650 lines (main.js + server.js + status.js)
**This service: ~165 lines (75% reduction)**

## Standard Endpoints

- `GET /status/health` - Health check
- `GET /status/info` - Service information
- `GET /release` - Release information
- `GET /settings` - Current settings
- `POST /settings/reload` - Reload settings from DB

## Custom Endpoints

Add your custom routes in `server.js`:

```javascript
routes: [
  { path: '/api', router: apiRouter, protected: true }
]
```

## Development

Port: 3000

Access locally: http://localhost:3000

## Documentation

- [BaseService API](../shared/BaseService.README.md)
- [Server Factory](../shared/FACTORIES_README.md)
- [Migration Guide](../shared/MIGRATION_EXAMPLE.md)
