// File: src/middleware/auth.js
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getUserById } = require('../utils/userManager');

module.exports.authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, config.jwtSecret, (err, user) => {
    if (err) return res.sendStatus(403);
    const _user = getUserById(user.id);
    if (_user.token !== token) return res.sendStatus(403);
    req.user = user;
    next();
  });
};
