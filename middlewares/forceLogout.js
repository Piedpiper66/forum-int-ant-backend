// const { decryptToken } = require("../utils/authPromise");
// const UserModel = require("../models/User");

module.exports = async function blockIfForceLogout(ctx, next) {
  const cookie = ctx.headers.cookie;
  const reg = new RegExp("DEV_ID=\\S{10}");
  const matched = cookie.match(reg);
  const { user } = ctx.state;

  if (matched && user) {
    const result = matched[0];
    const [_, devId] = result.split("=");
    const { userLoginDevices } = user;

    const target = userLoginDevices.find(({ id }) => devId === id);
    if (target) {
      const isLogin = target.isLogin;
      if (!isLogin) {
        ctx.status = 401;
      } else await next();
    } else {
      await next();
    }
  } else {
    await next();
  }
};
