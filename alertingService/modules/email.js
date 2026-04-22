"use strict";

const nodemailer = require("nodemailer");
const { getConfigString } = require("../../shared/loadSettings");

class EmailClient {
  constructor({ logger }) {
    this.logger = logger;
    this.smtpHost = getConfigString("SMTP_HOST", "");
    this.smtpPort = getConfigString("SMTP_PORT", "");
    this.smtpUser = getConfigString("SMTP_USER", "");
    this.smtpPassword = getConfigString("SMTP_PASSWORD", "");
    this.smtpFrom = getConfigString("SMTP_FROM", "");

    // Log configuration status
    const configStatus = {
      SMTP_HOST: this.smtpHost ? '✓' : '✗',
      SMTP_PORT: this.smtpPort ? '✓' : '✗',
      SMTP_USER: this.smtpUser ? '✓' : '✗',
      SMTP_PASSWORD: this.smtpPassword ? '✓' : '✗',
      SMTP_FROM: this.smtpFrom ? '✓' : '✗',
    };

    const port = Number(this.smtpPort);
    if (this.smtpHost && this.smtpUser && this.smtpPassword && Number.isFinite(port)) {
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port,
        secure: port === 465,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPassword,
        },
        // Increased timeouts for better reliability
        connectionTimeout: 30000,  // 30 seconds
        greetingTimeout: 10000,    // 10 seconds
        socketTimeout: 30000,      // 30 seconds
        // Force IPv4 to avoid DNS resolution issues
        family: 4,
        // Enable debug logging for connection issues
        logger: this.logger?.debug ? true : false,
        debug: this.logger?.debug ? true : false,
      });
      this.logger?.info?.(`[EmailClient] SMTP configured: ${this.smtpUser}@${this.smtpHost}:${port} | from=${this.smtpFrom}`);
    } else {
      this.transporter = null;
      // Find which variables are missing
      const missing = [];
      if (!this.smtpHost) missing.push('SMTP_HOST');
      if (!this.smtpUser) missing.push('SMTP_USER');
      if (!this.smtpPassword) missing.push('SMTP_PASSWORD');
      if (!Number.isFinite(port)) missing.push('SMTP_PORT (invalid or missing)');

      this.logger?.error?.(
        `[EmailClient] SMTP NOT configured - Missing: ${missing.join(', ')} | Config: ${JSON.stringify(configStatus)}`
      );
    }
  }

  isReady() {
    return Boolean(this.transporter && this.smtpFrom);
  }

  async sendEmail({ to, subject, body }) {
    if (!this.transporter || !this.smtpFrom) {
      const missingParts = [];
      if (!this.transporter) missingParts.push('transporter (check SMTP_HOST/USER/PASSWORD/PORT)');
      if (!this.smtpFrom) missingParts.push('SMTP_FROM');

      const error = `SMTP client not configured: Missing ${missingParts.join(' and ')}`;
      this.logger?.error?.(`[email.sendEmail] ${error}`);
      throw new Error(error);
    }
    if (!to || !subject || !body) {
      const error = `Missing required fields - to: ${!!to}, subject: ${!!subject}, body: ${!!body}`;
      this.logger?.error?.(`[email.sendEmail] ${error}`);
      throw new Error(error);
    }

    this.logger?.info?.(`[email] sending to=${to} subject="${subject}"`);
    try {
      const info = await this.transporter.sendMail({
        from: this.smtpFrom,
        to,
        subject,
        text: body,
      });
      this.logger?.debug?.(`[email] sent messageId=${info.messageId}`);
      return info;
    } catch (err) {
      this.logger?.error?.(`[email] send failed ${err?.message || String(err)}`);
      throw err;
    }
  }
}

module.exports = EmailClient;
