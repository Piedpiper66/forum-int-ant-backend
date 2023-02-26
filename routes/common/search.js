const Router = require("koa-router");
const router = new Router();

const TopicModel = require("../../models/Topic");
const ReplyModel = require("../../models/Reply");
const UserModel = require("../../models/User");
const CategoryModel = require("../../models/Category");

const { createResponseBody } = require("../../utils/tool");
const { assertParams } = require("../../utils/exception");

const UserBasic = require("../../models/User/baisc");

const inspect = require("util").inspect;

const getObjectId = require("mongoose").Types.ObjectId;

/**************************  Defined end  ****************************/

// 通过查询字符串模糊查询用户简讯
router.get("/search/user", async (ctx) => {
  const { key } = ctx.request.query;
  let regexp = new RegExp(key, "i");
  const result = await UserModel.find(
    {
      $or: [{ userId: { $eq: +key || 0 } }, { username: { $regex: regexp } }],
    },
    { _id: 0, username: 1, avatar: 1, userId: 1, fullname: 1 }
  );

  ctx.body = createResponseBody(200, "success", { data: result });
});

module.exports = router;
