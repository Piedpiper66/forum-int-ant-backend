const nodemailer = require("nodemailer");
const { mailConfig } = require("../config/private");
const { frontHost } = require("../config/host");
// 创建一个SMTP客户端配置
const config = {
  host: "smtp.163.com",
  port: 25,
  auth: {
    user: mailConfig.account, //刚才注册的邮箱账号
    pass: mailConfig.auth, //邮箱的授权码，不是注册时的密码
  },
};

// 创建一个SMTP客户端对象
const transporter = nodemailer.createTransport(config);

const typeEnum = {
  REGISTER: 1,
  RESETPASSWORD: 2,
  RESETEMAIL: 3,
  RESETPASSWORDFROMACCOUNT: 4,
  VALIDATE: 5,
};

module.exports = {
  typeEnum,
  // 发送邮件
  /**
   * @param { string } username 用户名
   * @param { string } to 用户邮箱
   * @param { string } code 验证码
   * @param { 1 | 2 | 3 | 4 | 5 } resetType 文本类型
   */
  sendMail(username, to, code, resetType) {
    let content = "";

    switch (resetType) {
      case 1:
        content = createRegisterMailContent(code);
        break;
      case 2:
        content = createResetPasswordMailContent(username, code);
        break;
      case 3:
        content = createResetEmailContent(username, code);
        break;
      case 4:
        content = createLinkResetPassword(username, code);
        break;
      case 5:
        content = validateAccount(username, code);
        break;
      default:
        throw new TypeError("邮件的创建类型不存在");
    }

    return transporter.sendMail({
      subject: "[Rao Forum] 邮箱验证",
      from: mailConfig.account,
      to,
      html: content,
    });
  },
};

// 注册
function createRegisterMailContent(code) {
  return `
    你正在通过邮箱激活 [Rao Forum] 账号。<br />\
    你的验证码为<b style="font-size: 2rem">${code}</b>。（10分钟内有效）
  `;
}

// 重置密码
function createResetPasswordMailContent(username, code) {
  return `
    <h1 style="font-style: bold; font-size: 1.5rem;">你正在通过邮箱更改用户 ${username} [Rao Forum] 的账号密码。</h1>
    <p>如果该邮件不是您发送的, 请忽略</p>
    <br />
    你的验证码为<b style="font-size: 2rem">${code}</b>。（10分钟内有效）
  `;
}

// 账户页面重置密码
function createLinkResetPassword(username, code) {
  const resetLink = `${frontHost}/user/pwd-reset/${code}`;

  return `
    <h1>您正在通过邮件重置用户${username}的密码</h1>
    <br />
    <p>如果该邮件不是您发送的, 请忽略</p>
    <br />
    点击<a href="${resetLink}" style="color: '#26d362'; font-weight: 600; margin: 0 .5rem;">该链接</a>重置你的密码;
  `;
}

// 重置邮箱
function createResetEmailContent(username, code) {
  return `
    [Vue Forum]: 你正在更改用户<b>${username}</b>的邮箱。<br />
    <p>如果该邮件不是您发送的, 请忽略</p>
    你的验证码为<b style="font-size: 2rem">${code}</b>。（10分钟内有效）
  `;
}

// 验证账号
function validateAccount(username, code) {
  return `
    [Vue Forum]: 你正在验证用户<b>${username}</b>的邮箱。<br />
    <p>如果该邮件不是您发送的, 请忽略</p>
    你的验证码为<b style="font-size: 2rem">${code}</b>。（10分钟内有效）
  `;
}
