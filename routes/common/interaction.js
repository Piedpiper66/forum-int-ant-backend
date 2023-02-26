const Router = require("koa-router");
const router = new Router();

const { io, socketMap } = require("../../utils/socket");
const Koapassport = require("koa-passport");
const blockIfForceLogout = require("../../middlewares/forceLogout");

const { customAlphabet } = require("nanoid");
const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 8);

// const TopicModel = require("../../models/Topic");
// const ReplyModel = require("../../models/Reply");
const UserModel = require("../../models/User");
// const CategoryModel = require("../../models/Category");
const PrivateMessage = require("../../models/PrivateMessage");

const { createResponseBody, copeUploadFiles } = require("../../utils/tool");
const { assertParams } = require("../../utils/exception");

const UserBasic = require("../../models/User/baisc");
const assert = require("assert");

// const inspect = require("util").inspect;

// const getObjectId = require("mongoose").Types.ObjectId;

/**************************  Defined end  ****************************/
router.post(
  "/interact/sendPrivate",
  Koapassport.authenticate("jwt", { session: false }),
  blockIfForceLogout,
  async (ctx) => {
    const { title, content, markdown, date, createDate } = ctx.request.body;

    const { forum_dev } = ctx.headers;

    let to = ctx.request.body.to;

    const fixDate = date ?? createDate;

    assertParams([
      // { name: "to", value: to, type: "number" },
      { name: "title", value: title, type: "string" },
      { name: "content", value: content, type: "string" },
    ]);

    if (Array.isArray(to) && (!to.length || to.length > 5)) {
      ctx.body = createResponseBody(
        400,
        `私信人数应在 1 -5 个之间，当前为${to.length}个`
      );
      return false;
    } else {
      const isChildNumber = typeof to[0] === "number";

      if (!isChildNumber) {
        to = to.map((item) => item.key);
      }
    }

    assert(+new Date() - fixDate <= 1e4, "invalid param createDate");

    const {
      userId: from,
      uploadTempImgs,
      username,
      avatar,
      fullname,
    } = ctx.state.user;

    const replacedContent = await copeUploadFiles(
      uploadTempImgs,
      content,
      markdown
    );

    const createdPrivateId = nanoid();

    const userQuene = to.map((toUserId) => {
      // const thisPrivateId = nanoid();
      return [
        toUserId,
        // 1. 私信集合
        new PrivateMessage({
          id: createdPrivateId,
          from: from,
          to: toUserId,
          title,
          content,
          markdown: replacedContent,
          createDate: fixDate,
        }).save(),
        // 2. 发送者的 msg_send
        UserModel.updateOne(
          { userId: from },
          {
            $push: { msg_send: createdPrivateId },
            $set: {
              user_draft: null,
              uploadTempImgs: [],
              contentImgReflect: {},
            },
          }
        ),
        // 3. 接收者的 msg_receive
        UserModel.updateOne(
          { userId: toUserId },
          { $push: { msg_receive: createdPrivateId } }
        ),
      ];
    });

    for (let i = 0; i < userQuene.length; i++) {
      const [to, PM] = await Promise.all(userQuene[i]);
      const { _doc } = PM;
      const updated = {
        ..._doc,
        from_user: { userId: from, username, avatar, fullname },
      };

      // 在响应成功后再发送，防阻塞，响应在微任务中完成，即在调用 nextTick 之前以成功响应
      process.nextTick(() => {
        const toSocketKeyName = [...socketMap.keys()].find((key) =>
          key.includes(`${to}`)
        );
        io.to(socketMap.get(toSocketKeyName)).emit("update_private", updated);
      });
    }
    // 第一版 to 只能一个人，第二版改为 1- 5 人，即数组

    ctx.body = createResponseBody(200, "success", {
      data: { status: "success" },
    });
  }
);

router.post(
  "/interact/removePrivate",
  Koapassport.authenticate("jwt", { session: false }),
  async (ctx) => {
    const { id, creator } = ctx.request.body;
    const { userId } = ctx.state.user;

    console.log(ctx.request.body);

    assertParams([{ name: "creator", value: creator, type: "number" }]);

    const opePropName = creator === userId ? "msg_send" : "msg_receive";

    const result = await UserModel.updateOne(
      { userId },
      { $pull: { [opePropName]: id } }
    );
    console.log("remove result", result);
    if (result.ok) {
      ctx.body = createResponseBody(200, "success");
    } else {
      ctx.error(400, "删除失败");
    }
  }
);

router.post(
  "/interact/getUserPrivateList",
  Koapassport.authenticate("jwt", { session: false }),
  blockIfForceLogout,
  async (ctx) => {
    const { skip, limit, type } = ctx.request.body;
    const { msg_receive, msg_send } = ctx.state.user;

    const total_receive = msg_receive.length;
    const total_send = msg_send.length;
    const isSend = type === 1;
    const currTotal = isSend ? total_send : total_receive;

    const result = await PrivateMessage.aggregate([
      {
        $match: {
          id: { $in: isSend ? msg_send : msg_receive },
        },
      },
      {
        $addFields: {
          total: { $sum: 1 },
        },
      },
      {
        $sort: { createDate: -1 },
      },
      {
        $skip: skip || 0,
      },
      {
        $limit: limit || 20,
      },
      {
        $project: { _id: 0, __v: 0 },
      },
      {
        $lookup: {
          from: "users",
          let: { id: "$from" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$userId", "$$id"],
                },
              },
            },
            {
              $project: {
                username: 1,
                avatar: 1,
                fullname: 1,
                userId: 1,
                _id: 0,
              },
            },
          ],
          as: "from_user",
        },
      },
    ]);

    result.forEach((private) => {
      private.from_user = private.from_user[0];
      private.total = currTotal;
    });

    ctx.body = createResponseBody(200, "success", {
      data: result,
      noMore: skip + result.length === currTotal || !result.length,
    });
  }
);

// 查询比 query 中的 日期大的所有 私信
router.get(
  "/interact/pollPrivate",
  Koapassport.authenticate("jwt", { session: false }),
  blockIfForceLogout,
  async (ctx) => {
    const { date, type, skip, limit, filter = 0 } = ctx.request.query;
    const { msg_receive, msg_send } = ctx.state.user;

    const result = await PrivateMessage.aggregate([
      {
        $match: {
          id: { $in: +filter === 1 ? msg_send : msg_receive },
          createDate: { $gt: +date },
          isChecked: type !== "latest",
        },
      },
      {
        $addFields: {
          total: { $sum: 1 },
        },
      },
      {
        $sort: { createDate: -1 },
      },
      {
        $skip: +skip || 0,
      },
      {
        $limit: +limit || 20,
      },
      {
        $project: { _id: 0, __v: 0 },
      },
      {
        $lookup: {
          from: "users",
          let: { id: "$from" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$userId", "$$id"],
                },
              },
            },
            {
              $project: {
                username: 1,
                avatar: 1,
                fullname: 1,
                userId: 1,
                _id: 0,
              },
            },
          ],
          as: "from_user",
        },
      },
    ]);

    ctx.body = createResponseBody(200, "success", { data: result });
  }
);

router.post(
  "/interact/setPrivateChecked",
  Koapassport.authenticate("jwt", { session: false }),
  blockIfForceLogout,
  async (ctx) => {
    const { ida } = ctx.request.body;

    assertParams([
      { name: "ida", value: ida, type: "array", subType: "string" },
    ]);

    const result = await PrivateMessage.updateMany(
      { id: { $in: ida } },
      { isChecked: true }
    );

    ctx.body = createResponseBody(200, "success", { data: result });
  }
);

router.get(
  "/interact/getPrivateDetail",
  Koapassport.authenticate("jwt", { session: false }),
  blockIfForceLogout,
  async (ctx) => {
    const { id } = ctx.request.query;
    // const { userId } = ctx.state.user;

    assertParams([{ name: "id", value: id, type: "string" }]);

    const result = await PrivateMessage.aggregate([
      {
        $match: { id },
      },
      {
        $project: { _id: 0, __v: 0 },
      },
      {
        $lookup: {
          from: "users",
          let: { id: "$from" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$userId", "$$id"],
                },
              },
            },
            {
              $project: {
                username: 1,
                avatar: 1,
                fullname: 1,
                userId: 1,
                _id: 0,
              },
            },
          ],
          as: "from_user",
        },
      },
      {
        $lookup: {
          from: "users",
          let: { id: "$to" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$userId", "$$id"],
                },
              },
            },
            {
              $project: {
                username: 1,
                avatar: 1,
                fullname: 1,
                userId: 1,
                _id: 0,
              },
            },
          ],
          as: "to_user",
        },
      },
    ]);

    const fixResult = (result && result[0]) || null;

    if (!fixResult) {
      ctx.error(400, `id 为 ${id} 的私信不存在`);
    }

    fixResult.from_user = fixResult.from_user.pop();
    fixResult.to_user = fixResult.to_user.pop();

    ctx.body = createResponseBody(200, "success", { data: fixResult });
  }
);

/**************************  router  ****************************/
module.exports = router;
