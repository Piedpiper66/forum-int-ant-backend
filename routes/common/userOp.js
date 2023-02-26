const Router = require("koa-router");
const router = new Router();
const Koapassport = require("koa-passport");
const blockIfForceLogout = require("../../middlewares/forceLogout");
// const cheerio = require("cheerio");
// const fsPromise = require("fs/promises");
const { io, socketMap } = require("../../utils/socket");

const CategoryModel = require("../../models/Category");
const TopicModel = require("../../models/Topic");
const ReplyModel = require("../../models/Reply");
const UserModel = require("../../models/User");
const { nanoid } = require("nanoid");
const path = require("path");
const { unlink } = require("fs/promises");

const mongoose = require("mongoose");
const getObjectId = mongoose.Types.ObjectId;
const isValidObjectId = mongoose.isValidObjectId;
const { assertParams } = require("../../utils/exception");
const {
  createResponseBody,
  generateOrUpdateImage,
  copeUploadFiles,
  isUpdated,
  userAvatarPath,
  topicImgPath,
  bgImgPath,
  draftImgPath,
  getUserLoginDevId,
} = require("../../utils/tool");

// 允许上传的图片类型
const validImageTypes = ["jpg", "jpeg", "png", "webp"];

router.use(Koapassport.authenticate("jwt", { session: false }));
router.use(blockIfForceLogout);

router
  // 创建主题
  .post("/u/sendTopic", async (ctx) => {
    const {
      title,
      categoryId,
      content = "",
      markdown = "",
      date,
    } = ctx.request.body;
    let tags = ctx.request.body.tags;
    const { userId, avatar, username, fullname, uploadTempImgs } =
      ctx.state.user;
    // console.log("userId", userId);
    // console.log("uploadTempImgs", uploadTempImgs);

    // assertParams([
    //   { name: "categoryId", value: categoryId, type: "string" },
    //   // { name: "title", value: title, type: "string" },
    //   { name: "tags", value: tags, type: "array" },
    //   // { name: "content", value: content, type: "string" },
    //   { name: "date", value: date, type: "number" },
    // ]);

    const reExamine = await CategoryModel.findById(
      categoryId,
      { tags: 1 },
      { lean: true }
    );

    // 验证 cateogory 合法
    !reExamine && ctx.error(400, `category with ${categoryId} is not exist`);

    if (tags.length > 0) {
      // 验证 tag 是否合法，并过滤重置
      const { tags: dbTags } = reExamine;

      tags = tags.filter((tag) => dbTags.includes(tag));
    }

    // !tags.length && tags.push(dbTags[0]);

    // 如果存在上传的图片
    const replacedContent = await copeUploadFiles(
      uploadTempImgs,
      content,
      markdown
    );
    // console.log(replacedContent);

    const topic = {
      title,
      creatorId: userId,
      createDate: date,
      content,
      markdown: replacedContent,
      lastActivity: date,
      categoryId,
      tags,
      replies: [],
      supports: [],
      avatar,
      username,
      fullname,
    };
    await new TopicModel(topic).save();

    await CategoryModel.updateOne(
      { _id: getObjectId(categoryId) },
      { $inc: { topicSum: 1 } }
    );
    await UserModel.updateOne(
      { userId },
      {
        user_draft: null,
        lastPostDate: date,
        uploadTempImgs: [],
        contentImgReflect: {},
      }
    );
    ctx.body = createResponseBody(200, "上传成功", {
      data: { status: "success" },
    });
  })
  // 回复主题
  .post("/u/reply", async (ctx) => {
    const {
      date,
      content,
      markdown,
      topicId,
      // to = 0,
      categoryId,
    } = ctx.request.body;
    const { userId, uploadTempImgs } = ctx.state.user;

    assertParams([
      { name: "date", value: date, type: "number" },
      { name: "content", value: content, type: "string" },
      { name: "topicId", value: topicId, type: "string" },
      // { name: "to", value: to, type: "number" },
    ]);

    !isValidObjectId(categoryId) && ctx.error(400, "invalid cateogryId");

    const replacedContent = await copeUploadFiles(
      uploadTempImgs,
      content,
      markdown
    );

    const reply = {
      topicId: topicId,
      reply_user: userId,
      // username,
      // avatar,
      // to: to ? to : null,
      createTime: date,
      content,
      markdown: replacedContent,
      support: [],
      lastModify: 0,
      categoryId,
    };
    const replyModel = new ReplyModel(reply);
    await replyModel.save();

    const newReplyId = replyModel._id;

    const result = await TopicModel.findOneAndUpdate(
      { _id: getObjectId(topicId) },
      {
        $push: { replies: { _id: newReplyId } },
        $inc: { replyLen: 1 },
        lastActivity: date,
      },
      {
        lean: true,
        projection: { subscribers: 1 },
      }
    );
    console.log(result);
    process.nextTick(async () => {
      const subscribers = result.subscribers;
      // const targetSockets = [];
      // subscribers.forEach((user) => {
      //   const socketId = socketMap.get(user);
      //   socketId && targetSockets.push(socketId);
      // });

      const subsIds = await getUserLoginDevId(subscribers);

      subsIds.forEach((socket) => {
        io.to(socket).emit("addSubscribeLatest", topicId);
      });
    });

    await UserModel.updateOne(
      { userId },
      { $set: { user_draft: null, uploadTempImgs: [], contentImgReflect: {} } }
    );
    // !result && ctx.error(400, `topic with id ${topicId} is not exist`);

    ctx.body = createResponseBody(200, "success", {
      data: { status: "success" },
    });
  })
  // 回复某条回复
  .post("/u/replyPost", async (ctx) => {
    const { userId, uploadTempImgs } = ctx.state.user;
    const { content, markdown, date, to, topicId, categoryId } =
      ctx.request.body;

    assertParams([
      { name: "content", value: content, type: "string" },
      { name: "date", value: date, type: "number" },
      { name: "to", value: to, type: "object" },
    ]);

    const replacedContent = await copeUploadFiles(
      uploadTempImgs,
      content,
      markdown
    );
    // console.log(content, date, targetInfo);

    try {
      // 存入该条回复
      const reply = {
        categoryId,
        topicId,
        reply_user: userId,
        // username,
        // avatar,
        createTime: date,
        content,
        markdown: replacedContent,
        support: [],
        lastModify: 0,
        to: {
          replyId: to.replyId,
          userId: to.userId,
          createTime: to.createTime,
        },
      };
      const saveRes = await new ReplyModel(reply).save();
      const { _id } = saveRes;

      await TopicModel.updateOne(
        { _id: topicId },
        {
          $push: { replies: { _id } },
          $inc: { replyLen: 1 },
          lastActivity: date,
        }
      );
      await UserModel.updateOne(
        { userId },
        {
          $set: {
            user_draft: null,
            lastPostTime: date,
            uploadTempImgs: [],
            contentImgReflect: {},
          },
        }
      );

      ctx.body = createResponseBody(200, "success", {
        data: { status: "success" },
      });
    } catch (error) {
      ctx.error(500, error || error.message);
    }
  })
  // 点赞主题或回复
  .post("/u/support", async (ctx) => {
    const { id, topic, to, ope, theme } = ctx.request.body;
    // userId: 赞的人， to: 被赞的人
    const { userId } = ctx.state.user;

    assertParams([
      { name: "theme", value: theme, type: "boolean" },
      { name: "to", value: to, type: "number" },
      { name: "ope", value: ope, type: "number" },
    ]);

    if (!(await UserModel.exists({ userId: to }))) {
      ctx.error(400, `user with userId ${to} is not exist`);
    }

    if (!isValidObjectId(id)) {
      ctx.error(400, `reply id in invalid!`);
    }

    let userUpdateObj = null;
    let replyUpdateObj = null;
    let opeModel = theme ? TopicModel : ReplyModel;

    const replyObjectId = getObjectId(id);

    const opeType = theme ? "topic" : "reply";

    // 根据 ope 来判断是点赞还是取消点赞，1：点赞，0：取消点赞
    if (ope === 1) {
      userUpdateObj = {
        //
        me: {
          $push: {
            likes_to: {
              to,
              type: opeType,
              id: replyObjectId,
            },
          },
        },
        to: {
          $push: {
            likes_receive: {
              from: userId,
              type: opeType,
              id: replyObjectId,
            },
          },
        },
      };

      replyUpdateObj = {
        query: { _id: replyObjectId, supports: { $ne: userId } },
        update: {
          $push: { supports: userId },
        },
      };
    } else if (ope === 0) {
      userUpdateObj = {
        me: { $pull: { likes_to: { id: replyObjectId } } },
        to: { $pull: { likes_receive: { id: replyObjectId } } },
      };

      replyUpdateObj = {
        query: { _id: getObjectId(id) },
        update: {
          $pull: { supports: userId },
        },
      };
    } else {
      ctx.error(400, `params ope is invalid, only 0, 1 will be accepted`);
    }

    // prettier-ignore
    await UserModel.updateOne({ userId }, userUpdateObj.me)
    await UserModel.updateOne({ userId: to }, userUpdateObj.to);

    await opeModel.findByIdAndUpdate(
      replyUpdateObj.query,
      replyUpdateObj.update
    );

    ctx.body = createResponseBody(200, "success", {
      data: { status: "success" },
    });
  })
  .post("/u/bookmark", async (ctx) => {
    const { type, id, date, ope, isTheme } = ctx.request.body;
    const { userId } = ctx.state.user;

    !isValidObjectId(id) && ctx.error(400, "invalid objectId");

    if (
      "Invalid Date" === new Date(date).toString() ||
      +new Date() - +new Date(date) > 10000
    ) {
      ctx.error(400, "invalid date");
    }

    const ObjectId = getObjectId(id);
    const opeType = isTheme ? "topic" : "reply";

    const config = {
      query: ope ? { userId, "bookmarks.id": { $ne: ObjectId } } : { userId },
      update: ope
        ? {
            $push: { bookmarks: { type: opeType, id: ObjectId, date } },
          }
        : { $pull: { bookmarks: { id: ObjectId } } },
    };

    await UserModel.updateOne(config.query, config.update);

    ctx.body = createResponseBody(200, "success", {
      data: { status: "success" },
    });
  })
  // 是否关注了该主题,
  // .get("/u/isSubscribe", (async) => {})
  // 订阅主题
  .post("/u/subscribe", async (ctx) => {
    const { themeId, type } = ctx.request.body;
    const { userId } = ctx.state.user;

    // 在用户离开当前主题时，记录时间戳，返回比该时间戳大的回复个数

    const isValid = isValidObjectId(themeId);

    if (!isValid) {
      ctx.error(400, "invalid themeid");
    } else {
      const themeObjectId = getObjectId(themeId);

      const updateField = type === 1 ? "$push" : "$pull";

      const topicUpdateQuery = {
        [updateField]: { subscribers: userId },
      };

      const userUpdateQuery = {
        [updateField]: {
          subscribes:
            type === 1
              ? {
                  themeId: themeObjectId,
                  lastViewTime: Date.now(),
                }
              : { themeId: themeObjectId },
        },
      };

      const result1 = await TopicModel.updateOne(
        { _id: themeObjectId },
        topicUpdateQuery
      );

      const result2 = await UserModel.updateOne(
        {
          userId,
        },
        userUpdateQuery
      );

      // console.log(topicUpdateQuery, result1, userUpdateQuery, result2);

      const isSuccess = isUpdated([result1, result2]);

      if (isSuccess) {
        ctx.body = createResponseBody(200, "success", { data: "success" });
      } else {
        ctx.body = createResponseBody(400, "error", { data: "error" });
      }
    }
  })
  .get("/u/getSubscribes", async (ctx) => {
    const { skip, limit } = ctx.request.query;
    const { userId, subscribes } = ctx.state.user;

    const subIds = [],
      subTime = [];

    subscribes.forEach(({ themeId, lastViewTime }) => {
      subIds.push(themeId);
      subTime.push(lastViewTime);
    });

    const results = await TopicModel.aggregate([
      {
        $match: { _id: { $in: subIds } },
      },
      {
        $lookup: {
          from: "replies",
          let: { id: "$replies" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ["$_id", "$$id"],
                },
              },
            },
            {
              $project: {
                createTime: 1,
                _id: 0,
              },
            },
            {
              $sort: {
                createTime: -1,
              },
            },
            {
              $skip: +skip,
            },
            {
              $limit: +limit,
            },
          ],
          as: "replies",
        },
      },
      {
        $project: { replies: 1, title: 1 },
      },
      {
        $addFields: { themeId: "$_id", id: "$_id" },
      },
      {
        $unset: "_id",
      },
    ]);

    results.reverse().forEach((res, index) => {
      const endTime = subTime[index];
      const replies = res.replies;
      const len = replies.length;
      let sum = 0;

      for (let i = 0; i < len; i++) {
        if (replies[i].createTime < endTime) break;
        sum++;
      }

      delete res.replies;

      res.latest = sum;
    });

    ctx.body = {
      code: 200,
      data: results,
    };
  })
  // 话题编辑时上传的图片
  .post("/u/contentImage", async (ctx) => {
    const { image } = ctx.request.files;
    const { userId } = ctx.state.user;
    // 判断 image 是否是文件
    if (image) {
      // console.log("is File");
      // 判断图片尾缀是否合法, jpg 、jpeg、png、webp
      const suffix = image.type.split("/")[1];
      const isValidSuffix = validImageTypes.includes(suffix);
      !isValidSuffix &&
        ctx.error(
          400,
          "invalid image type, image should within ['jpg', 'jpeg', 'png', 'webp']"
        );
      // 判断文件是否超出 2MB 在 app.js 中已经使用 koa-body 设置了拦截

      // 根据路径生成图片路径
      const imgName = nanoid();
      // 图片接收后的临时存储位置
      const sourcePath = image.path;
      // 图片生成时的放置路径
      const fullFilename = `${imgName}.${suffix}`;
      const targetPath = path.resolve(draftImgPath, fullFilename);
      // 生成图片
      try {
        await generateOrUpdateImage(sourcePath, targetPath);

        // 将临时上传的图片的文件信息保存，当上传话题时
        // 对比已上传图片列表和临时上传列表的差异，删除上传但未添加至话题的图片
        await UserModel.updateOne(
          { userId },
          { $push: { uploadTempImgs: fullFilename } }
        );

        // 返回图片路径的响应
        const imgSrc = `http://${process.env.host}/temp/${fullFilename}`;
        ctx.body = createResponseBody(200, "success", {
          data: {
            src: imgSrc,
            filename: fullFilename,
          },
        });
      } catch (error) {
        ctx.error(500, error.message);
      }
    }
  })
  // 当用户删除图片时同步删除对应路径的文件
  .post("/u/rmContentImage", async (ctx) => {
    const { filename } = ctx.request.body;
    const { userId } = ctx.state.user;

    (!filename || typeof filename !== "string" || filename.length < 25) &&
      ctx.error(400, "invalid param filename");

    try {
      const result = await unlink(path.resolve(draftImgPath, filename));

      await UserModel.updateOne(
        { userId },
        { $pull: { uploadTempImgs: filename } },
        { lean: true }
      );
      !result && (ctx.body = createResponseBody(200, "删除成功"));
    } catch (error) {
      ctx.error(400, "文件不存在");
    }
  })
  // 保存用户的草稿，防止页面刷新消失
  .post("/u/saveUserDraft", async (ctx) => {
    const {
      title,
      content,
      date,
      markdown,
      sort,
      extra,
      to,
      contentImgReflect,
      createTime,
    } = ctx.request.body;
    let { categoryId, tags } = ctx.request.body;

    const { userId } = ctx.state.user;

    assertParams([
      { name: "content", value: content, type: "string" },
      { name: "markdown", value: markdown, type: "string" },
    ]);
    const isTopic = sort === "TOPIC" || sort === "theme";

    if (isTopic) {
      assertParams([
        { name: "categoryId", value: categoryId, type: "string" },
        { name: "title", value: title, type: "string" },
        { name: "tags", value: tags, type: "array", subType: "string" },
      ]);
    }

    let reExamine = null;

    if (isTopic) {
      if (categoryId) {
        reExamine = await CategoryModel.findById(
          categoryId,
          { tags: 1, name: 1, alias: 1 },
          { lean: true }
        );

        const { tags: dbTags } = reExamine;

        tags = tags.filter((tag) => dbTags.includes(tag));
      } else {
        categoryId = "61c32e726df75630bc7e3dad";
      }
    }

    await UserModel.updateOne(
      { userId },
      {
        $set: {
          user_draft: {
            sort,
            extra,
            to,
            category:
              isTopic && categoryId && reExamine
                ? {
                    id: getObjectId(categoryId),
                    name: reExamine.name,
                    alias: reExamine.alias,
                  }
                : null,
            title,
            tags,
            content,
            markdown,
            lastModified: date,
            contentImgReflect,
            categoryId,
            createTime,
          },
        },
      }
    );

    ctx.body = createResponseBody(200, "保存成功");
  })
  .post("/u/removeUserDraft", async (ctx) => {
    const { userId, uploadTempImgs } = ctx.state.user;
    let fileRemoveResult = null,
      draftRemoveResult = null;
    if (uploadTempImgs.length > 0) {
      const removeQuene = uploadTempImgs.map((filename) =>
        unlink(path.resolve(draftImgPath, filename))
      );
      fileRemoveResult = await Promise.allSettled(removeQuene);
      // console.log(fileRemoveResult);
    }
    draftRemoveResult = await UserModel.updateOne(
      { userId },
      { user_draft: null }
    );
    // console.log(draftRemoveResult);
    ctx.body = createResponseBody(200, "success");
  })
  .post("/u/uploadAvatar", async (ctx) => {
    const { image } = ctx.request.files;
    const { avatar, userId } = ctx.state.user;
    const userCurrAvatar = avatar.split("/").pop();
    // 判断 image 是否是文件
    if (image) {
      // 判断图片尾缀是否合法, jpg 、jpeg、png、webp
      const suffix = image.type.split("/")[1];
      const isValidSuffix = validImageTypes.includes(suffix);
      !isValidSuffix &&
        ctx.error(
          400,
          "invalid image type, image should within ['jpg', 'jpeg', 'png', 'webp']"
        );
      // 判断文件是否超出 2MB 在 app.js 中已经使用 koa-body 设置了拦截

      // 根据路径生成图片路径
      const imgName = nanoid();
      // 图片接收后的临时存储位置
      const sourcePath = image.path;
      // 新生成的图片名称
      const fullFilename = `${imgName}.${suffix}`;
      // 系统默认的用户头像
      const defaultUserAvatars = ["5u86221twd.png", "fx3xktwt6c.png"];

      // 生成图片
      try {
        // 如果用户当前头像是默认头像, 则直接存入上传的图片
        if (defaultUserAvatars.includes(userCurrAvatar)) {
          // 图片生成时的放置路径
          const targetPath = path.resolve(userAvatarPath, fullFilename);

          await generateOrUpdateImage(sourcePath, targetPath);
        } else {
          // 否则删掉之前的头像, 再存入图片
          // prettier-ignore
          const currUserAvatarPath = path.resolve(userAvatarPath, userCurrAvatar);
          const removeResult = await unlink(currUserAvatarPath);
          if (!removeResult) {
            // prettier-ignore
            await generateOrUpdateImage(sourcePath, path.resolve(userAvatarPath, fullFilename));
          }
        }

        const newAvtarPath = `http://${process.env.host}/u/${fullFilename}`;

        await UserModel.updateOne(
          { userId },
          { $set: { avatar: newAvtarPath, avatarFileName: fullFilename } }
        );

        // 返回图片路径的响应
        ctx.body = createResponseBody(200, "success", {
          data: {
            src: newAvtarPath,
            filename: fullFilename,
          },
        });
      } catch (error) {
        ctx.error(500, error.message);
      }
    } else {
      ctx.body = createResponseBody(400, "no image receive");
    }
  })
  // 记录阅读时间
  .post("/u/readTimeAdd", async (ctx) => {
    const { time } = ctx.request.body;
    const {
      user: { userId, last7ReadTime }, // 记录 7 天中的阅读时间的记录
    } = ctx.state;
    assertParams([{ name: "time", value: time, type: "number" }]);
    const lastIndex = last7ReadTime.length - 1;
    const lastReadRecord = last7ReadTime[lastIndex];
    const lastDate = lastReadRecord ? lastReadRecord.date : null;
    const now = new Date();
    const lastActiveDay = new Date(lastDate);
    const timeMethodNames = ["getFullYear", "getMonth", "getDate"];
    const isSameDay = timeMethodNames.every(
      (method) => now[method]() === lastActiveDay[method]()
    );
    const updateObj = {};
    updateObj.$inc = { readTime: time };
    // 如果存在记录
    if (lastDate) {
      // 如果是同一天, 则直接累加, 否则插入一条新记录
      if (isSameDay) {
        lastReadRecord.count += time;
        updateObj.$set = { last7ReadTime };
      } else {
        // 不是同一天， 如果近7天阅读时间统计没满, 则继续插入,
        if (last7ReadTime.length < 7) {
          updateObj.$push = { last7ReadTime: { date: +now, count: time } };
        } else {
          // 否则去除头部数据, 然后在尾部插入
          last7ReadTime.shift();
          last7ReadTime.push({ date: +now, count: time });
          updateObj.$set = { last7ReadTime };
        }
      }
    } else {
      updateObj.$push = { last7ReadTime: { date: +now, count: time } };
    }

    await UserModel.updateOne({ userId }, updateObj);

    ctx.body = createResponseBody(200, null, {
      data: { time },
    });
  })
  .post("/u/postRead", async (ctx) => {
    const { replyId } = ctx.request.body;
    const { userId } = ctx.state.user;

    assertParams([{ name: "replyId", value: replyId, type: "string" }]);

    const result = await UserModel.updateOne(
      { userId, readed_replies: { $ne: replyId } },
      { $push: { readed_replies: replyId } }
    );

    ctx.body = createResponseBody(200, "ok", { data: result });
  })
  .post("/u/topicResolve", async (ctx) => {
    const { topicId, replyId, userId, username, avatar, type } =
      ctx.request.body;

    assertParams([
      { name: "username", value: username, type: "string" },
      { name: "avatar", value: avatar, type: "string" },
      { name: "type", value: type, type: "number" },
    ]);

    !isValidObjectId(topicId) && ctx.error(400, "invalid topicId");
    !isValidObjectId(replyId) && ctx.error(400, "invalid replyId");

    const userIdTest = userId / 1e8;

    if (!(userIdTest >= 1 && userIdTest <= 9)) {
      ctx.error(400, "invalid userId");
    }

    const isAdd = !!type;

    const result1 = await TopicModel.updateOne(
      {
        _id: getObjectId(topicId),
        isResolve: { $eq: !isAdd },
      },
      {
        $set: {
          solution: isAdd
            ? { topicId, replyId, userId, username, avatar }
            : false,
        },
        isResolve: isAdd,
      }
    );

    const result2 = await UserModel.updateOne(
      { userId },
      { $inc: { solved_count: isAdd ? 1 : -1 } }
    );

    if (isUpdated([result1, result2])) {
      ctx.body = createResponseBody(200, "success", {
        data: { status: "success" },
      });
    } else {
      ctx.error(500, "server error");
    }
  })
  // 通过前端传过来的 categoryList 获取对应的是否点赞的对应的列表
  .post("/u/topicLikeList", async (ctx) => {
    const { ids = [] } = ctx.request.body;
    assertParams([
      { name: "ids", value: ids, type: "array", subType: "string" },
    ]);

    for (const id of ids) {
      if (!isValidObjectId(id)) {
        ctx.error(400, `invalid id ${id}`);
        break;
      }
    }

    const { userId } = ctx.state.user;

    // 第一个为主题 id
    const { likes_to } = await UserModel.findOne(
      { userId },
      { likes_to: 1, _id: 0 }
    );

    const result = ids.map(
      (id) =>
        +(likes_to.findIndex(({ id: toId }) => toId.toString() == id) > -1)
    );
    // 剩下的为 回复 id
    ctx.body = createResponseBody(200, "success", { data: result });
  })
  .post("/u/topicBookmarks", async (ctx) => {
    const { ids = [] } = ctx.request.body;
    assertParams([
      { name: "ids", value: ids, type: "array", subType: "string" },
    ]);

    for (const id of ids) {
      if (!isValidObjectId(id)) {
        ctx.error(400, `invalid id ${id}`);
        break;
      }
    }

    const { userId } = ctx.state.user;

    // 第一个为主题 id
    const { bookmarks } = await UserModel.findOne(
      { userId },
      { bookmarks: 1, _id: 0 }
    );

    const result = ids.map(
      (id) => bookmarks.findIndex(({ id: bmId }) => bmId.toString() === id) > -1
    );
    // 剩下的为 回复 id
    ctx.body = createResponseBody(200, "success", { data: result });
  })
  .post("/u/sendUserDeviceInfo", async (ctx) => {
    const deviceInfo = ctx.request.body;
    const { userId, userLoginDevices } = ctx.state.user;
    let result = null;
    // 判断用户的地理位置是否改变
    // 地理位置改变则插入一条设备信息
    // 否则修改上一条设备信息
    if (userLoginDevices?.length > 0) {
      const { geo: lastGeo, ip } = userLoginDevices.pop();
      const { geo: currGeo } = deviceInfo;
      // console.log(deviceInfo, lastGeo);
      const isSameGeo = Object.keys(lastGeo).every(
        (key) => lastGeo[key] === currGeo[key]
      );
      if (isSameGeo) {
        userLoginDevices.push(deviceInfo);
        result = await UserModel.updateOne(
          { userId },
          {
            $set: { userLoginDevices },
          }
        );
      } else {
        result = await UserModel.updateOne(
          { userId },
          { $push: { userLoginDevices: deviceInfo } }
        );
      }
    } else {
      result = await UserModel.updateOne(
        { userId },
        { $push: { userLoginDevices: deviceInfo } }
      );
    }

    ctx.body = createResponseBody(200, "success", { data: result });
  })
  .post("/u/reset-fullname", async (ctx) => {
    const { fullname } = ctx.request.body;
    const { userId } = ctx.state.user;

    await UserModel.updateOne({ userId }, { fullname });

    ctx.body = createResponseBody(200, "success");
  })
  .post("/u/uploadProfile", async (ctx) => {
    const { introduction, location, website, headerRemove, cardRemove } =
      ctx.request.body;
    const { headerBg, cardBg } = ctx.request.files;
    const user = ctx.state.user;
    let savedHeaderBg = user.headerBg,
      savedCardBg = user.cardBg;

    // 匹配文件名
    const reg = /([^\/]*)$/;

    // 如果 headerRemove 或 cardRemove 为 1， 则删除对应图片
    if (headerRemove === "1") {
      const lastHeaderImgName = savedHeaderBg.match(reg)[0];
      const imgPath = path.resolve(bgImgPath, lastHeaderImgName);
      await unlink(imgPath);
      savedHeaderBg = "";
    }

    if (cardRemove === "1") {
      const lastHeaderImgName = savedCardBg.match(reg)[0];
      const imgPath = path.resolve(bgImgPath, lastHeaderImgName);
      await unlink(imgPath);
      savedCardBg = "";
    }

    // 如果上传了图片，则判断之前是否存在，存在则先删除之前的图片再重新生成
    if (headerBg) {
      const typeList = headerBg.type.split("/");
      const isValidImgType = validImageTypes.includes(typeList[1]);

      typeList[0] !== "image" &&
        ctx.error("the file you upload is not a image");

      !isValidImgType && ctx.error(400, "invalid image type");

      const id = nanoid();

      if (user.headerBg) {
        const filename = user.headerBg.match(reg)[0];
        // unlink
        await unlink(path.resolve(bgImgPath, filename));
      }
      const genImgName = `${id}.${typeList[1]}`;
      const targetPath = path.resolve(bgImgPath, genImgName);
      await generateOrUpdateImage(headerBg.path, targetPath);
      savedHeaderBg = `http://${process.env.host}/bg/${genImgName}`;
    }

    if (cardBg) {
      const typeList = cardBg.type.split("/");

      typeList[0] !== "image" &&
        ctx.error("the file you upload is not a image");

      const isValidImgType = validImageTypes.includes(typeList[1]);

      !isValidImgType && ctx.error(400, "invalid image type");

      const id = nanoid();

      if (user.cardBg) {
        const filename = user.cardBg.match(reg)[0];
        // unlink
        await unlink(path.resolve(bgImgPath, filename));
      }
      const genImgName = `${id}.${typeList[1]}`;
      const targetPath = path.resolve(bgImgPath, genImgName);
      await generateOrUpdateImage(cardBg.path, targetPath);
      savedCardBg = `http://${process.env.host}/bg/${genImgName}`;
    }

    await UserModel.updateOne(
      { userId: user.userId },
      {
        introduction,
        location,
        website,
        headerBg: savedHeaderBg,
        cardBg: savedCardBg,
      }
    );

    ctx.body = createResponseBody(200, "success");
  })
  .post("/u/removeDevice", async (ctx) => {
    const { devId } = ctx.request.body;
    const { userId } = ctx.state.user;

    const result = await UserModel.updateOne(
      { userId },
      {
        $pull: {
          userLoginDevices: {
            id: devId,
          },
        },
      }
    );

    const isSuccess = isUpdated(result);

    ctx.body = {
      code: isSuccess ? 200 : 400,
      status: isSuccess ? 1 : 0,
    };
  })
  .post("/u/removeAccount", async (ctx) => {
    const { userId } = ctx.request.body;

    await UserModel.deleteOne({ userId });

    ctx.body = createResponseBody(200, "success", { status: 1 });
  });

module.exports = router;
