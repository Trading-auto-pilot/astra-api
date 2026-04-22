"use strict";

const axios = require("axios");
const { getConfigString } = require("../../shared/loadSettings");

class TelegramClient {
  constructor({ logger }) {
    this.logger = logger;
    this.token = getConfigString("TELEGRAM_TOKEN", "");
    this.apiBase = getConfigString("TELEGRAM_API_BASE", "https://api.telegram.org");
    this.defaultChatId =
      getConfigString(["ALERTING_DEFAULT_TELEGRAM_CHAT_ID", "TELEGRAM_CHAT_ID"], "");
    this.defaultParseMode = getConfigString("TELEGRAM_PARSE_MODE", "");
  }

  isReady() {
    return Boolean(this.token);
  }

  async _call(method, payload) {
    if (!this.isReady()) {
      const error = "Telegram client not configured (missing TELEGRAM_TOKEN)";
      this.logger?.error?.(`[telegram] ${error}`);
      throw new Error(error);
    }

    const url = `${this.apiBase}/bot${this.token}/${method}`;
    const resp = await axios.post(url, payload, {
      timeout: 15000,
      validateStatus: () => true,
    });

    if (resp.status >= 400 || !resp.data?.ok) {
      const description = resp.data?.description || `HTTP ${resp.status}`;
      throw new Error(`Telegram API error: ${description}`);
    }

    return resp.data.result;
  }

  async sendMessage(payload = {}) {
    const chatId = payload.chatId || payload.chat_id || this.defaultChatId;
    const text = payload.text || payload.body || "";
    const parseMode = payload.parseMode || payload.parse_mode || this.defaultParseMode || undefined;

    if (!chatId) throw new Error("Missing Telegram chat_id");
    if (!text) throw new Error("Missing Telegram message text");

    const messagePayload = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    };
    if (parseMode) messagePayload.parse_mode = parseMode;

    this.logger?.info?.(`[telegram] sending message to chat_id=${chatId}`);
    const result = await this._call("sendMessage", messagePayload);
    this.logger?.debug?.(`[telegram] sent message_id=${result?.message_id}`);
    return result;
  }
}

module.exports = TelegramClient;
