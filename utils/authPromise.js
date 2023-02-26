const { hash, compare } = require("bcryptjs");
// const { createHmac } = require("crypto");
const jwt = require("jsonwebtoken");
const privateSecret = require("../config/private").secret;

const { cypherEncryptChar } = require("../config/tool");
const { customAlphabet } = require("nanoid");
const genSalt = customAlphabet(cypherEncryptChar, 8);

/**
 *  return genSalt(saltBit).then(salt => {
        const hmac = createHmac('sha256', 'BlogSecret');
        hmac.update(password);
        return hmac.digest('hex');
    })

    生成加盐的密码的 hash 值
 **/
function encryptPwd(password = "") {
  return new Promise((resolve, reject) => {
    hash(password, genSalt(), (err, hash) => {
      err ? reject(err) : resolve(hash);
    });
  });
}

/**
 * 比较密码与 hsah 密码
 **/
async function isCorrectPwd(reqPassword = "", hashPassword = "") {
  return await compare(reqPassword, hashPassword);
}

/**
 * 生成 Token
 **/
function genToken(payload = {}, options = {}) {
  return new Promise((resolve, reject) => {
    jwt.sign(payload, privateSecret, options, (err, token) => {
      err ? reject(err) : resolve(token);
    });
  });
}

function decryptToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, privateSecret, (err, data) => {
      err ? reject(err) : resolve(data);
    });
  });
}

module.exports = {
  encryptPwd,
  isCorrectPwd,
  genToken,
  decryptToken,
};
