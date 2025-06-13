const { publishCommand } = require('./shared/redisPublisher');
// server.js
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const REDIS_POSITIONS_KEY = 'alpaca:positions'; 
const REDIS_ORDERS_KEY = 'alpaca:orders';

// Middleware per parsing JSON (opzionale)
app.use(express.json());

// Endpoint semplice
app.post('/ping', (req, res) => {
    publishCommand({type:"Nopositions",positions:req.body.message},req.body.channel);
    res.send('pong');
});

// Avvio del server
app.listen(PORT, () => {
  console.log(`✅ Server REST in ascolto su http://localhost:${PORT}`);
});





