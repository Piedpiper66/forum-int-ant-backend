const { throwExceptionBody, dealCatchedError } = require("../utils/exception");
const { decryptToken } = require("../utils/authPromise");
const UserModel = require("../models/User");
async function blockIfNotAdmin(ctx, next) {
  try {
    let token = (ctx.headers.authorization || "").trim();

    !token && throwExceptionBody(401, "Unauthrization");

    token = token.replace(/^Bearer /, "");

    const { id } = await decryptToken(token);

    const result = await UserModel.findOne({ userId: id });

    !result &&
      throwExceptionBody(400, "user is not exist or has been deactivated");

    !["admin", "super"].includes(result.role) &&
      throwExceptionBody(401, "you have no authorization to access");

    await next();
  } catch (error) {
    dealCatchedError(ctx, error);
  }
}

module.exports = {
  blockIfNotAdmin,
};
