"use strict";

const http = require("http");
const { Router } = require("express");
const WebSocket = require("ws");

// Fetch CDP targets from Chromium debug port
function getCdpTargets() {
  return new Promise((resolve, reject) => {
    http
      .get("http://127.0.0.1:9222/json", (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("CDP target list parse failed: " + e.message));
          }
        });
      })
      .on("error", (e) => reject(new Error("CDP unreachable: " + e.message)));
  });
}

// Execute JS in the Chromium page via CDP WebSocket
function cdpEval(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("CDP eval timeout"));
    }, 8000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: false },
        })
      );
    });

    ws.on("message", (data) => {
      clearTimeout(timer);
      ws.close();
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error("CDP message parse failed"));
      }
    });

    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error("CDP WS error: " + e.message));
    });
  });
}

module.exports = function buildCredentialsRouter({ logger, getService }) {
  const router = Router();

  // GET /credentials — returns saved username and whether a password is stored
  router.get("/", (_req, res) => {
    try {
      const settings = getService().getAllSettings();
      res.json({
        username: settings["ibkr_username"] || "",
        hasPassword: !!settings["ibkr_password"],
      });
    } catch (err) {
      logger.warning("[credentials GET] " + err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /credentials — save username and/or password
  router.post("/", async (req, res) => {
    try {
      const { username, password } = req.body || {};
      const svc = getService();
      if (username !== undefined) await svc.persistSetting("ibkr_username", String(username));
      if (password) await svc.persistSetting("ibkr_password", String(password));
      res.json({ ok: true });
    } catch (err) {
      logger.warning("[credentials POST] " + err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /credentials/fill — inject credentials into Chromium via CDP
  router.post("/fill", async (_req, res) => {
    try {
      const settings = getService().getAllSettings();
      const username = settings["ibkr_username"] || "";
      const password = settings["ibkr_password"] || "";

      if (!username && !password) {
        return res.status(400).json({ error: "Nessuna credenziale salvata" });
      }

      const targets = await getCdpTargets();
      const target = targets.find((t) => t.type === "page") || targets[0];
      if (!target?.webSocketDebuggerUrl) {
        return res.status(503).json({ error: "Nessun target CDP disponibile" });
      }

      // Inject via native input value setter to work with React/Angular forms
      const js = `
        (function() {
          var setVal = function(el, val) {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          var u = document.querySelector('input[id="username"], input[name="username"], input[autocomplete="username"], input[type="text"]');
          var p = document.querySelector('input[id="password"], input[name="password"], input[autocomplete="current-password"], input[type="password"]');
          if (u) setVal(u, ${JSON.stringify(username)});
          if (p) setVal(p, ${JSON.stringify(password)});
          return { username: !!u, password: !!p };
        })()
      `;

      const result = await cdpEval(target.webSocketDebuggerUrl, js);
      const value = result?.result?.value || {};

      logger.info(`[credentials/fill] filled username=${value.username} password=${value.password}`);
      res.json({ ok: true, filled: value });
    } catch (err) {
      logger.warning("[credentials/fill] " + err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
