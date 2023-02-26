const Router = require("koa-router");
const router = new Router();
const UserModel = require("../../models/User");
const { assertParams } = require("../../utils/exception");
const { createResponseBody } = require("../../utils/tool");

router.post("/logout", async (ctx) => {
  const { userId, devId } = ctx.request.body;

  assertParams([{ name: "userId", value: userId, type: "number" }]);

  const isUserExist = await UserModel.exists({ userId });

  if (isUserExist) {
    const result = await UserModel.updateOne(
      { userId },
      {
        $set: {
          "userLoginDevices.$[el].isLogin": false,
        },
      },
      { arrayFilters: [{ "el.id": devId }] }
    );

    ctx.body = createResponseBody(200, "logout success", { data: result });
  } else {
    ctx.error(400, `user with userId: ${userId} is not exist`);
  }
});

module.exports = router;
