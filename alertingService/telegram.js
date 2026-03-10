"use strict";

const { Router } = require("express");
const TelegramClient = require("./modules/telegram");

module.exports = function buildTelegramRouter({ logger }) {
  const router = Router();
  const telegramClient = new TelegramClient({ logger });

  router.post("/send", async (req, res) => {
    const payload = req.body || {};

    if (!telegramClient.isReady()) {
      return res.status(500).json({
        ok: false,
        error: "Telegram client not configured",
      });
    }

    try {
      const message = await telegramClient.sendMessage(payload);
      return res.json({
        ok: true,
        messageId: message?.message_id,
        chatId: message?.chat?.id,
        date: message?.date,
      });
    } catch (err) {
      logger?.warning?.(`[telegram] send failed ${err?.message || String(err)}`);
      return res.status(500).json({
        ok: false,
        error: "Errore invio Telegram",
        message: err?.message || String(err),
      });
    }
  });

  return router;
};
