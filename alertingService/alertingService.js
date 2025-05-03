// AlertingService.js
const nodemailer = require('nodemailer');
const axios = require('axios');
const createLogger = require('../shared/logger');

const MODULE_NAME = 'AlertingService';
const MODULE_VERSION = '1.0';
const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL || 'info');

class AlertingService {
  constructor() {
    this.transporter = null;
  }

  // Recupera configurazione SMTP da DBManager
  async loadSettings() {
    const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
    const settings = {};
    const dbManagerUrl = process.env.DBMANAGER_URL || 'http://dbmanager:3002';
    logger.trace(`[loadSetting] Recupero settings da ${dbManagerUrl}`);

    for (const key of keys) {
        logger.trace(`[loadSetting] loop chiave ${key}`);
        try {
          logger.trace(`[loadSetting] Chiamo url ${dbManagerUrl}/getSetting/${key}`);
          const res = await axios.get(`${dbManagerUrl}/getSetting/${key}`);
          console.log(res.data.value);
          settings[key] = res.data.value;
          logger.trace(`[loadSetting] Setting variavile ${key} : ${settings[key]}`);
        } catch (err) {
          logger.error(`[loadSettings] Errore nella chiave ${key}: ${err.message}`);
          throw err;
        }
    }

    this.smtpFrom = settings.SMTP_FROM;

    this.transporter = nodemailer.createTransport({
      host: settings.SMTP_HOST,
      port: parseInt(settings.SMTP_PORT, 10),
      secure: false,
      auth: {
        user: settings.SMTP_USER,
        pass: settings.SMTP_PASSWORD
      }
    });

    logger.info(`[loadSetting] Configurazione SMTP caricata.`);
  }

  // Invio email
  async sendEmail({ to, subject, body }) {
      logger.log(`[sendEmail] richiamata con parametri ${to} ${subject} ${body}`);
      try {
        const info = await this.transporter.sendMail({
          from: this.smtpFrom,
          to:to,
          subject:subject,
          text: body
        });
        logger.log(`[${MODULE_NAME}][sendEmail] Email inviata a ${to}: ${info.messageId}`);
        return info;
      } catch (err) {
        logger.error(`[${MODULE_NAME}][sendEmail] Errore invio email: ${err.message}`);
        throw err;
      }
  }

  // Informazioni sul modulo
  getInfo() {
    return {
      module: MODULE_NAME,
      version: MODULE_VERSION,
      logLevel: process.env.LOG_LEVEL,
      status: 'OK'
    };
  }
}

module.exports = AlertingService;
