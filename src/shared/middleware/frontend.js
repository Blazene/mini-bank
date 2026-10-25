const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Docker puts the compiled client here. An API-only host dev checkout can omit it.
module.exports = function mountFrontend(
  app,
  { directory = path.resolve(__dirname, '../../../public') } = {}
) {
  directory = path.resolve(directory);
  const index = path.join(directory, 'index.html');
  if (!fs.existsSync(index)) return false;
  const assets = path.join(directory, 'assets') + path.sep;
  const files = express.static(directory, {
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    setHeaders(res, file) {
      res.setHeader(
        'Cache-Control',
        file.startsWith(assets)
          ? 'public, max-age=31536000, immutable'
          : file === index
            ? 'no-store'
            : 'public, max-age=0, must-revalidate'
      );
    },
  });
  // Never turn an API typo (including future API versions) into an HTML response.
  app.use((req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    return files(req, res, next);
  });
  app.get(/^\/(?:login\/?|(?:app|demo)(?:\/.*)?)?$/, (req, res, next) => {
    // Missing file requests must remain 404, not receive a cached SPA shell.
    if (!req.accepts('html') || path.extname(req.path)) return next();
    res.set('Cache-Control', 'no-store');
    return res.sendFile(index);
  });
  return true;
};
