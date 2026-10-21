require('dotenv').config();

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error('JWT_SECRET is missing or too short (minimum 32 characters)');
}

module.exports = { jwtSecret: secret, jwtExpiresIn: '1h' };