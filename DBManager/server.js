const app = require('./endpoints');

const port = process.env.PORT || 3002;

app.listen(port, () => console.log('Server listening on port '+port));
