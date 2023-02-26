/**
 * @param {string} message 需要解密的文本
 */
const CryptoJS = require("crypto-js");
const { aseKey } = require("../config/private");

module.exports = function aesDecrypt(message) {
  const decrptStr = CryptoJS.AES.decrypt(message, aseKey);
  return JSON.parse(decrptStr.toString(CryptoJS.enc.Utf8));
};
