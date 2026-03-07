// modules/manualRoutesLoader.js
"use strict";

const fs = require("fs").promises;
const path = require("path");

class ManualRoutesLoader {
  constructor({ logger, routesDir }) {
    this.logger = logger;
    this.routesDir = routesDir || path.resolve(__dirname, "..", "routes");
  }

  /**
   * Load all manual routes from the routes directory
   * Each file should export a function that returns an Express router
   *
   * Example routes/customEndpoint.js:
   * module.exports = function({ logger, schemaReader }) {
   *   const router = require('express').Router();
   *   router.get('/custom', async (req, res) => { ... });
   *   return router;
   * }
   *
   * @returns {Promise<Array<{name: string, path: string, router: Router}>>}
   */
  async loadManualRoutes({ logger, schemaReader }) {
    try {
      // Check if routes directory exists
      try {
        await fs.access(this.routesDir);
      } catch {
        this.logger.info(
          `[manualRoutes] Routes directory not found: ${this.routesDir}. Creating it...`
        );
        await fs.mkdir(this.routesDir, { recursive: true });

        // Create a sample README
        await fs.writeFile(
          path.join(this.routesDir, "README.md"),
          `# Manual Routes

Place your custom route files here. Each file should export a function that returns an Express router.

## Example: routes/customEndpoint.js

\`\`\`javascript
module.exports = function({ logger, schemaReader }) {
  const express = require('express');
  const router = express.Router();

  // Custom endpoint
  router.get('/hello', async (req, res) => {
    res.json({ message: 'Hello from custom endpoint!' });
  });

  // Custom endpoint with database query
  router.get('/stats', async (req, res) => {
    const [rows] = await schemaReader.query('SELECT COUNT(*) as count FROM users');
    res.json({ userCount: rows[0].count });
  });

  return router;
};
\`\`\`

## Mounting

Routes are automatically mounted at \`/api/custom/{filename}\`

For example, \`routes/customEndpoint.js\` will be available at:
- GET /api/custom/customEndpoint/hello
- GET /api/custom/customEndpoint/stats
`
        );

        return [];
      }

      const files = await fs.readdir(this.routesDir);
      const jsFiles = files.filter(
        (f) => f.endsWith(".js") && f !== "index.js"
      );

      if (jsFiles.length === 0) {
        this.logger.info("[manualRoutes] No manual route files found");
        return [];
      }

      const routes = [];

      for (const file of jsFiles) {
        const filePath = path.join(this.routesDir, file);
        const routeName = path.basename(file, ".js");

        try {
          // Clear require cache to allow hot reload
          delete require.cache[require.resolve(filePath)];

          const routeFactory = require(filePath);

          if (typeof routeFactory !== "function") {
            this.logger.warning(
              `[manualRoutes] Skipping ${file}: must export a function`
            );
            continue;
          }

          const router = routeFactory({ logger, schemaReader });

          if (!router || typeof router !== "function") {
            this.logger.warning(
              `[manualRoutes] Skipping ${file}: factory must return an Express router`
            );
            continue;
          }

          routes.push({
            name: routeName,
            path: `/${routeName}`,
            router,
            file,
          });

          this.logger.info(
            `[manualRoutes] Loaded manual route: ${routeName} → /api/custom/${routeName}`
          );
        } catch (err) {
          this.logger.error(
            `[manualRoutes] Error loading ${file}: ${err?.message || String(err)}`
          );
        }
      }

      this.logger.info(
        `[manualRoutes] Loaded ${routes.length} manual route(s)`
      );

      return routes;
    } catch (err) {
      this.logger.error(
        `[manualRoutes] Error loading manual routes: ${err?.message || String(err)}`
      );
      return [];
    }
  }
}

module.exports = { ManualRoutesLoader };
