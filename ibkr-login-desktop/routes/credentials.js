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
  return cdpCall(wsUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
}

function cdpCall(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const requestId = Math.floor(Math.random() * 1_000_000_000);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`CDP ${method} timeout`));
    }, 8000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          id: requestId,
          method,
          params,
        })
      );
    });

    ws.on("message", (data) => {
      try {
        const payload = JSON.parse(data);
        if (payload.id !== requestId) {
          return;
        }

        clearTimeout(timer);
        ws.close();

        if (payload.error) {
          reject(new Error(`CDP ${method} error: ${payload.error.message || "unknown"}`));
          return;
        }

        resolve(payload);
      } catch (e) {
        clearTimeout(timer);
        ws.close();
        reject(new Error("CDP message parse failed"));
      }
    });

    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error("CDP WS error: " + e.message));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pickPageTargetOrThrow() {
  const targets = await getCdpTargets();
  const target = targets.find((t) => t.type === "page") || targets[0];
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("Nessun target CDP disponibile");
  }
  return target;
}

async function resetBrowserSession(wsUrl) {
  // Best effort: not all domains expose all CDP methods at all times.
  try { await cdpCall(wsUrl, "Network.enable", {}); } catch (_e) {}
  try { await cdpCall(wsUrl, "Network.clearBrowserCookies", {}); } catch (_e) {}
  try { await cdpCall(wsUrl, "Network.clearBrowserCache", {}); } catch (_e) {}
  try {
    await cdpCall(wsUrl, "Storage.clearDataForOrigin", {
      origin: "https://localhost:5000",
      storageTypes: "all",
    });
  } catch (_e) {}

  await cdpCall(wsUrl, "Page.navigate", { url: "https://localhost:5000" });
  await delay(1200);
}

async function fillCredentials(wsUrl, username, password) {
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
      return { username: !!u, password: !!p, href: location.href, title: document.title };
    })()
  `;
  const result = await cdpEval(wsUrl, js);
  return result?.result?.value || {};
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

      const target = await pickPageTargetOrThrow();
      let value = await fillCredentials(target.webSocketDebuggerUrl, username, password);

      // If the IBKR page is in "Login done" (or any non-login screen), reset session and retry once.
      if (!value.username || !value.password) {
        logger.info("[credentials/fill] login fields not found, resetting browser session and retrying once");
        await resetBrowserSession(target.webSocketDebuggerUrl);
        value = await fillCredentials(target.webSocketDebuggerUrl, username, password);
      }

      logger.info(`[credentials/fill] filled username=${value.username} password=${value.password}`);
      res.json({ ok: true, filled: value });
    } catch (err) {
      logger.warning("[credentials/fill] " + err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /credentials/reset-session — clear browser session/cookies and reopen login page
  router.post("/reset-session", async (_req, res) => {
    try {
      const target = await pickPageTargetOrThrow();
      await resetBrowserSession(target.webSocketDebuggerUrl);
      logger.info("[credentials/reset-session] browser session cleared and login page reloaded");
      return res.json({ ok: true });
    } catch (err) {
      logger.warning("[credentials/reset-session] " + err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
};
