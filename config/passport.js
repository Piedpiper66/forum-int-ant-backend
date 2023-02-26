const UserModel = require("../models/User");
const { Strategy, ExtractJwt } = require("passport-jwt");
const { secret } = require("./private");

const opts = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: secret,
};

module.exports = (passport) => {
  // 在 jwt.sign 中匹配的信息
  passport.use(
    new Strategy(opts, function (payload, done) {
      UserModel.findById(payload.id, null, { lean: true }).then((user) => {
        // 是否完成认证
        return user ? done(null, user) : done(null, false);
      });
    })
  );
};
