const fs = require('fs');
const config = require('../config');

class TokenManager {
  constructor() {
    this.tokens = {};
    this.load();
  }

  load() {
    try {
      const data = fs.readFileSync(config.userTokensPath, 'utf8');
      this.tokens = JSON.parse(data);
    } catch (error) {
      console.error('Error loading user tokens:', error);
      this.tokens = {};
    }
  }

  getUser(token) {
    return Object.keys(this.tokens).find(userId => this.tokens[userId] === token);
  }
}

module.exports = new TokenManager();
