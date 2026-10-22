require('./config');
const path = require('path');
const express = require('express');
const helmet = require('helmet');

const app = express();
app.set('trust proxy', 1); // Render puts exactly one proxy in front of the app
app.disable('x-powered-by');
app.use(helmet());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '10kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/documents', require('./routes/documents'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Never leak stack traces or internals to the client
app.use((err, req, res, next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err.message);
  res.status(status).json({ error: status === 500 ? 'Internal server error' : 'Bad request' });
});

module.exports = app;