module.exports = async (data) => {
  const axios = require('axios');
  const createLogger = require('../../shared/logger');
  const MODULE_NAME = 'defaultHandler';
  const MODULE_VERSION = '1.0';
  const logger = createLogger(MODULE_NAME, process.env.LOG_LEVEL);
  const alertingUrl = process.env.ALERTINGMANAGER_URL || 'http://localhost:3008';

    logger.warning('⚠️ Event not handled:', data.event);

    try{
      // Invio cominicazione via email
      logger.trace(`[FILL] Invio email richiamando ${alertingUrl}/email/send Handler non gestito ${data.event}`);
      await axios.post(`${alertingUrl}/email/send`, {
          to: 'expovin@gmail.com',
          subject: `Evento ordine ${data.event} Non getito`,
          body: `Evento non Gestito ${JSON.stringify(data)}`
      });
    } catch (err) {
      logger.error(`[invioComunicazione] Errore durante invio email `, err.message);
      return null;
    }

  };
  