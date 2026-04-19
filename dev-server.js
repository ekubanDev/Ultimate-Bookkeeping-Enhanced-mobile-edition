/**
 * Local development server that serves the frontend static files
 * and proxies /api requests to the FastAPI backend.
 *
 * This mimics the production setup where Firebase Hosting rewrites
 * /api/** to Cloud Run, so no CORS is needed.
 *
 * Usage: node dev-server.js
 * Requires: npm install express http-proxy-middleware (dev deps at root)
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const PORT = process.env.PORT || 5004;
const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

const app = express();

app.use('/api', createProxyMiddleware({
    target: BACKEND,
    changeOrigin: true,
}));

app.use(express.static(path.join(__dirname, 'frontend', 'build')));

// Serve the bookkeeping SPA routes. Express 5 / path-to-regexp
// requires either a named splat parameter (rest*) or a custom
// regexp like (.*) instead of a bare "*" segment.
app.get(['/bookkeeping', '/bookkeeping/:rest(.*)'], (req, res) => {
    const rest = req.params.rest || '';
    const filePath = path.join(__dirname, 'frontend', 'build', 'bookkeeping', rest);

    res.sendFile(filePath, (err) => {
        if (err) {
            res.sendFile(path.join(__dirname, 'frontend', 'build', 'bookkeeping', 'index.html'));
        }
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'build', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Dev server running at http://localhost:${PORT}`);
    console.log(`API requests proxied to ${BACKEND}`);
    console.log(`Serving static files from frontend/build`);
});
