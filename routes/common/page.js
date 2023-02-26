const Router = require("koa-router");
const router = new Router();
const { io, socketMap } = require("../../utils/socket");
// const iconv = require("iconv-lite");

const TopicModel = require("../../models/Topic");
const ReplyModel = require("../../models/Reply");
const UserModel = require("../../models/User");
const CategoryModel = require("../../models/Category");
const PrivateMessage = require("../../models/PrivateMessage");

const {
  createResponseBody,
  deepClone,
  getUserLoginDevId,
} = require("../../utils/tool");
const { assertParams } = require("../../utils/exception");

const UserBasic = require("../../models/User/baisc");
const UserModal = require("../../models/User");
// const { retryTimes } = require("../../models/User/safe");

const inspect = require("util").inspect;

const getObjectId = require("mongoose").Types.ObjectId;

// 合并 db.aggregate的管道
const mergeConfig = (config) => {
  /**
   *  接口通用聚合管道
   */
  // prettier-ignore
  const aggregateConfig = [
    {
      $lookup: {
        from: "users",
        localField: "creatorId",
        foreignField: "userId",
        as: "creator",
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "categoryId",
        foreignField: "_id",
        as: "category",
      },
    },
    {
      $lookup: {
        from: "replies",
        localField: "replies",
        foreignField: "_id",
        as: "replies",
      },
    },
    {
      $project: {
        category: { name: 1, description: 1, alias: 1 },
        creator: { userId: 1, avatar: 1, username: 1 },
        replies: 1,
        replyCount: { $size: "$replies" },
        replies: { $slice: ["$replies", 5] },
        title: 1,
        createDate: 1,
        tags: 1,
        viewCount: 1,
        lastActivity: 1,
        isResolve: 1,
        resolver: "$solution.userId"
      },
    },
  ];
  return [...config].concat(aggregateConfig);
};

/**
 * 更新查找结果中的用户信息
 * @param {object[]} repliesToFix 话题的回复数组
 * @param {boolean} ignoreContent 是否不需要内容
 */
const proccessUserInfo = async (repliesToFix, ignoreContent = false) => {
  const repliesUsers = repliesToFix.map(
    ({ reply_user, userId }) => reply_user || userId
  );
  // console.log(repliesUsers);

  const userQueryRes = await UserModel.find(
    { userId: { $in: repliesUsers } },
    { _id: 0, username: 1, avatar: 1, userId: 1 },
    { lean: true }
  );

  repliesToFix.forEach((reply) => {
    const { content, reply_user } = reply;
    const queryTarget = userQueryRes.find(
      ({ userId }) => userId === (reply_user || reply.userId)
    );
    Object.assign(reply, queryTarget, {
      content: ignoreContent ? undefined : content,
    });
  });

  // return repliesToFix.map((reply) => {
  //   const queryTarget = userQueryRes.find(
  //     ({ userId }) => userId === reply.reply_user
  //   );
  //   return Object.assign(reply, queryTarget, { content: void 0 });
  // });
};

router
  .get("/category", async (ctx, next) => {
    const result = await CategoryModel.find().lean();
    const now = new Date().getTime();
    const monthAgo = now - 2592000000;
    // 查询每个分类下的近一个月的话题
    const countResult = await TopicModel.aggregate([
      { $match: { createDate: { $gt: monthAgo } } },
      {
        $group: {
          _id: "$categoryId",
          count: { $sum: 1 },
        },
      },
    ]);
    // 给对应的 category 设置话题数
    result.forEach((item) => {
      // 分类 _id
      const id = item._id.toString();
      // 对应的 $group 后的 _id
      const target = countResult.find(({ _id }) => {
        return _id.toString() === id;
      });
      item.monthPosts = target ? target.count : 0;
    });
    // while (true) {}
    ctx.body = createResponseBody(200, "success", { data: result });
  })
  .get("/tags", async (ctx) => {
    const { category = "all" } = ctx.request.query;
    // console.log("tag request info:", category);
    assertParams([{ name: "category", value: category, type: "string" }]);

    let result = null;

    if (category === "all") {
      result = await CategoryModel.find(
        {},
        { tags: 1, _id: 0 },
        { lean: true }
      );
      result = [...new Set(result.reduce((p, n) => [...p, ...n.tags], []))];
    } else {
      result = await CategoryModel.findOne(
        { _id: category },
        { tags: 1, _id: 0 },
        { lean: true }
      );
      !result && ctx.error(400, `category ${category} is not exist`);
      result = result.tags;
    }
    ctx.body = createResponseBody(200, "success", { data: result });
  })
  .get("/topicRange", async (ctx) => {
    const {
      categoryId = "all",
      tag = "all",
      type = "latest",
      skip,
      limit,
    } = ctx.request.query;

    assertParams([
      { name: "categoryId", value: categoryId, type: "string" },
      { name: "tag", value: tag, type: "string" },
      { name: "skip", value: skip, type: "string" },
      { name: "limit", value: limit, type: "string" },
    ]);

    if (/[^0-9]+/.test(skip) || /[^0-9]+/.test(limit)) {
      ctx.error(400, "invalid params 'skip' or 'limit'");
    }

    if (type && !["latest", "hot", "recent"].includes(type)) {
      ctx.error(400, "invalid query 'type'");
    }

    function hasValue(value) {
      return value && value !== "all";
    }
    const commonQuery = [
      { $sort: { createDate: -1 } },
      { $skip: +skip },
      { $limit: +limit },
    ];

    const query_match = {};

    if (hasValue(categoryId)) {
      query_match.$match = { categoryId: getObjectId(categoryId) };
    }
    if (hasValue(tag)) {
      const match = query_match.$match;
      const query_tag = { tags: { $eq: tag } };
      if (match) {
        query_match.$match = Object.assign(match, query_tag);
      } else {
        query_match.$match = query_tag;
      }
    }

    if (type === "recent") {
      const now = new Date().getTime();
      const threeDayBefore = now - 3 * 24 * 60 * 60 * 1000;
      const query_recent = { createDate: { $lt: now, $gt: threeDayBefore } };
      const match = query_match.$match;
      if (query_match.$match) {
        query_match.$match = Object.assign(match, query_recent);
      } else {
        query_match.$match = query_recent;
      }
    }

    if (type === "hot") {
      const lastSort = commonQuery[0].$sort;
      const query_sort = {
        viewCount: -1,
        repliesSize: -1,
      };
      commonQuery[0].$sort = { ...query_sort, ...lastSort };
      commonQuery.unshift({
        $addFields: { repliesSize: { $size: "$replies" } },
      });
    }
    if (query_match.$match) {
      commonQuery.unshift(query_match);
    }

    // console.log(type, inspect(commonQuery, false, 5, true));

    let result = await TopicModel.aggregate(mergeConfig([...commonQuery]));

    await Promise.all(
      result.map(({ replies }) => proccessUserInfo(replies, true))
    );

    // result.forEach((item, i) => (item.replies = processReults[i]));

    ctx.body = createResponseBody(200, "success", { data: result });
  })
  // 获取用户的所有话题和回复，时间降序
  .get("/activity", async (ctx) => {
    const { username, page, pageSize, type } = ctx.request.query;
    const user = await UserModel.findOne(
      { username },
      { userId: 1 },
      { lean: true }
    );
    !user && ctx.error(400, "user with username " + username + " is not exist");
    // 一下query 表示查找 supports长度大于零的文档
    //  $nor: [{ supports: { $exists: false } }, { supports: { $size: 0 } }]
    const { userId } = user;
    const commonQuery = {
      match: {
        reply: { reply_user: userId },
        topic: { creatorId: userId },
        topic_support: { supports: { $elemMatch: { $eq: userId } } },
        reply_support: { supports: { $elemMatch: { $eq: userId } } },
        topic_resolve: [
          {
            $match: { "solution.userId": userId },
          },
          {
            $project: { replyId: { $toObjectId: "$solution.replyId" }, _id: 0 },
          },
          {
            $lookup: {
              from: "replies",
              localField: "replyId",
              foreignField: "_id",
              as: "replies",
            },
          },
          {
            $project: { reply: { $first: "$replies" } },
          },
          {
            $unwind: "$reply",
          },
          {
            $replaceRoot: { newRoot: "$reply" },
          },
        ],
      },
      lookup: {
        user: {
          from: "users",
          let: { id: "$creatorId" },
          pipeline: [
            {
              $match: { $expr: { $eq: ["$userId", "$$id"] } },
            },
            {
              $project: { avatar: 1, username: 1, userId: 1, _id: 0 },
            },
          ],
          as: "userInfo",
        },
        category: {
          from: "categories",
          let: { cateId: "$categoryId" },
          pipeline: [
            {
              $match: { $expr: { $eq: ["$_id", "$$cateId"] } },
            },
            {
              $project: { _id: 1, alias: 1, name: 1 },
            },
          ],
          as: "category",
        },
        topic: {
          from: "topics",
          localField: "topicId",
          foreignField: "_id",
          as: "topic",
        },
      },
      pagi: [{ $skip: +(page - 1) * +pageSize }, { $limit: +pageSize }],
    };

    const topicCommonLookup = [
      {
        $lookup: commonQuery.lookup.user,
      },
      {
        $lookup: commonQuery.lookup.category,
      },
      ...commonQuery.pagi,
      {
        $project: {
          topicId: "$_id",
          viewCount: 1,
          replyCount: { $size: "$replies" },
          userInfo: { $first: "$userInfo" },
          category: { $first: "$category" },
          tags: 1,
          title: 1,
          content: 1,
          createDate: 1,
          lastActivity: 1,
        },
      },
    ];

    const replyCommonLookup = [
      {
        $lookup: commonQuery.lookup.topic,
      },
      {
        $lookup: commonQuery.lookup.category,
      },
      ...commonQuery.pagi,
      {
        $project: {
          topicId: 1,
          category: { $first: "$category" },
          title: { $first: "$topic.title" },
          tags: { $first: "$topic.tags" },
          userId: "$reply_user",
          username: 1,
          avatar: 1,
          content: 1,
          createDate: "$createTime",
        },
      },
    ];

    /**
     * @param {"topic" | "reply"} ModelType
     * @param {undefined|"all"|"topic"|"reply"|"support"|"resolve"} activityType
     */
    async function getResult(ModelType, activityType) {
      const isReply = ModelType === "reply";
      if (
        (isReply && activityType === "topic") ||
        (!isReply && ["resolve", "reply"].includes(activityType))
      )
        return [];

      const Model = isReply
        ? activityType === "resolve"
          ? TopicModel
          : ReplyModel
        : TopicModel;
      let matchObj = null;
      switch (activityType) {
        case undefined:
        case "all":
          matchObj = commonQuery.match[ModelType];
          break;
        case "topic":
          matchObj = commonQuery.match.topic;
          break;
        case "reply":
          matchObj = commonQuery.match.reply;
          break;
        case "support":
          matchObj = commonQuery.match[`${ModelType}_support`];
          break;
      }

      const preFilter =
        activityType !== "resolve"
          ? [{ $match: matchObj }]
          : commonQuery.match.topic_resolve;
      const pipeline =
        ModelType === "reply" ? replyCommonLookup : topicCommonLookup;
      return await Model.aggregate([...preFilter, ...pipeline]);
    }

    let resultTopic = [];
    let resultReply = [];
    let mergeResult = [];

    resultTopic = await getResult("topic", type);
    resultReply = await getResult("reply", type);

    if (resultTopic) {
      // 将 topciResult 中的 userInfo 对象合并到根对象中
      resultTopic = resultTopic.map((item) => {
        const userInfo = item.userInfo;
        delete item.userInfo;
        return Object.assign(item, userInfo);
      });
    }
    mergeResult = resultTopic
      .concat(resultReply)
      .sort((a, b) => b.createDate - a.createDate);

    await proccessUserInfo(mergeResult);

    ctx.body = createResponseBody(200, "success", {
      data: mergeResult,
    });
  })
  .get("/topic", async (ctx) => {
    const { id, userId } = ctx.request.query;

    assertParams([{ name: "id", value: id, type: "string" }]);

    const isCalledWithUser = !!userId;
    let isUserSubscribe = false;

    const themeObjectId = getObjectId(id);

    if (isCalledWithUser) {
      assertParams([{ name: "userId", value: userId, type: "number" }]);

      await UserModel.updateOne(
        { userId, readed_topics: { $ne: themeObjectId } },
        { $push: { readed_topics: id } }
      );

      isUserSubscribe = await TopicModel.exists({
        _id: themeObjectId,
        subscribers: userId,
      });
    }

    // prettier-ignore
    const topicDetail = await TopicModel.aggregate([
      { $match: { _id: themeObjectId } },
      { $lookup: {  
        from: "replies",
        localField: "replies",
        foreignField: "_id",
        as: "replies"
      } },
      { $lookup: {
        from: "categories",
        localField: "categoryId",
        foreignField: "_id",
        as: "category"
      } },
      {
        $lookup: {
          from: "users",
          let: { userId: "$creatorId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$userId", "$$userId"]
                }
              },
            },
            {
              $project: {
                username: 1,
                avatar: 1,
                fullname: 1,
                userId: 1,
                _id: 0
              }
            },
          ],
          as: "creatorInfo"
        }
      },
      {
        $project: { __v: 0, subscribers: 0 }
      },
      {
        $addFields: {
          creatorInfo: { $first: "$creatorInfo" },
        }
      },
    ])

    if (topicDetail) {
      const detail = topicDetail[0];
      // 删除 supports属性，无用，浪费带宽
      detail.supportLen = detail.supports.length;
      delete detail.supports;
      isCalledWithUser && (detail.isSubscribe = isUserSubscribe);

      // replies同理，只需要 length 即可
      let replies = detail.replies.map((r) => {
        r.supportLen = r.supports.length;
        delete r.supports;
        return r;
      });

      let toList = replies.map((r) => r.to).filter((v) => v);

      await proccessUserInfo(replies.concat(...toList));

      await TopicModel.updateOne(
        { _id: themeObjectId },
        { $inc: { viewCount: 1 } }
      );
      // console.log(detail.supportLen);
      ctx.body = createResponseBody(200, "success", { data: detail });
    } else {
      ctx.error(400, `the topic with id ${id} is not exist`);
    }
  })
  .get("/hotest", async (ctx) => {
    const { skip, limit, cate } = ctx.request.query;

    if (/[^0-9]+/.test(skip) || /[^0-9]+/.test(limit)) {
      ctx.error(400, "invalid params 'skip' or 'limit'");
    }

    const result = await TopicModel.aggregate(
      mergeConfig([
        // { $addFields: { replyCount: { $sum: "$replies" } } },
        { $sort: { viewCount: -1, replyCount: -1 } },
        { $skip: +skip },
        { $limit: +limit },
      ])
    );

    // result.forEach(async (item) => {
    //   const replies = item.replies;
    //   if (replies && replies.length > 0) {
    //     item.replies = await proccessUserInfo(replies);
    //   }
    // });

    const processReults = await Promise.all(
      result.map(({ replies }) => proccessUserInfo(replies, true))
    );

    result.forEach((item, i) => (item.replies = processReults[i]));

    ctx.body = createResponseBody(200, "success", { data: result });
  })
  .get("/replyDetail", async (ctx) => {
    const { replyId } = ctx.request.query;

    assertParams([{ name: "replyId", value: replyId, type: "string" }]);

    const result = await ReplyModel.findOne(
      { _id: replyId },
      {
        supports: 0,
        topicId: 0,
        categoryId: 0,
      },
      {
        lean: true,
      }
    );
    !result && ctx.error(400, "reply with id" + replyId + " is not exist");
    await proccessUserInfo([result]);
    // console.log(result);

    ctx.body = createResponseBody(200, "success", { data: result });
  })
  .get("/bookmarkList", async (ctx) => {
    const { username } = ctx.request.query;

    assertParams([{ name: "username", value: username, type: "string" }]);

    const categories = await CategoryModel.find(
      {},
      { alias: 1, name: 1, _id: 1 },
      { lean: true }
    );

    // console.log(categories);

    const [queryRes] = await UserModel.aggregate([
      { $match: { username } },
      {
        $project: { bookmarks: 1, _id: 0 },
      },
      {
        $lookup: {
          from: "replies",
          // let: { id: { $toObjectId: "$bookmarks.id" } },
          // pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$id"] } } }],
          localField: "bookmarks.id",
          foreignField: "_id",
          as: "replyDetail",
        },
      },
      {
        $lookup: {
          from: "topics",
          localField: "replyDetail.topicId",
          foreignField: "_id",
          as: "reply_innerTopic",
        },
      },
      {
        $lookup: {
          from: "topics",
          localField: "bookmarks.id",
          foreignField: "_id",
          as: "topicDetail",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "topicDetail.creatorId",
          foreignField: "userId",
          as: "topic_users",
        },
      },
    ]);

    delete queryRes.bookmarks;

    const replies = queryRes.replyDetail.map((reply, index) => {
      const {
        username,
        avatar,
        reply_user: userId,
        topicId,
        categoryId,
        content,
        createTime: createDate,
        _id,
      } = reply;
      const { title, tags } = queryRes.reply_innerTopic[index];

      const category = categories.find((cate) => {
        return cate._id.toString() === categoryId.toString();
      });

      // console.log(category);

      return {
        username,
        avatar,
        userId,
        topicId,
        content,
        createDate,
        title,
        tags,
        category,
        replyId: _id,
        type: "reply",
      };
    });

    const topics = queryRes.topicDetail.map(
      ({
        creatorId: userId,
        _id: topicId,
        content,
        createDate,
        title,
        tags,
        categoryId,
      }) => {
        const category = categories.find(
          (cate) => cate._id.toString() === categoryId.toString()
        );
        const { username, avatar } = queryRes.topic_users.find(
          (user) => user.userId === userId
        );
        return {
          username,
          avatar,
          userId,
          topicId,
          content,
          createDate,
          title,
          tags,
          category,
          type: "topic",
        };
      }
    );

    const combineResult = topics.concat(replies);

    await proccessUserInfo(combineResult);

    ctx.body = createResponseBody(200, "success", { data: combineResult });
  })
  .get("/test2", async (ctx) => {
    const query = ctx.request.query;
    console.log(query);
    // console.log(x);
    ctx.body = { ...query };
  });

// 获取用户信息, 通过 userId
router.get("/userInfo", async (ctx) => {
  const { userId, username } = ctx.request.query;
  if (username) ctx.redirect(`/common/userInfoByName?username=${username}`);

  if (!/^[0-9]{9}$/.test(userId)) {
    ctx.error(400, "invalid params 'userId'");
  }

  const keys = Object.keys(UserBasic);
  const project = keys.reduce(
    (project, key) => ((project[key] = 1), project),
    {}
  );
  Object.assign(project, {
    readTime: 1,
    createDate: 1,
    lastPostDate: 1,
    userId: 1,
  });

  const result = await UserModel.findOne({ userId }, project, {
    lean: true,
  });
  !result &&
    ctx.error(400, `the user with userId ${userId} is not exist`, {
      data: userId,
    });

  ctx.body = createResponseBody(200, "success", { data: result });
});

// 获取用户信息, 通过 username
router.get("/userInfoByName", async (ctx) => {
  const { username } = ctx.request.query;
  assertParams([{ name: "username", value: username, type: "string" }]);

  const keys = Object.keys(UserBasic);
  const project = keys.reduce(
    (project, key) => ((project[key] = 1), project),
    {}
  );
  Object.assign(project, {
    readTime: 1,
    createDate: 1,
    lastPostDate: 1,
    lastActivity: 1,
    visitCount: 1,
    userId: 1,
  });

  const result = await UserModel.findOne({ username }, project, {
    lean: true,
  });
  !result &&
    ctx.error(400, `the user with username ${username} is not exist`, {
      data: userId,
    });

  ctx.body = createResponseBody(200, "success", { data: result });
});

// 获取用户总览界面数据
router.get("/summary.json", async (ctx) => {
  const { username } = ctx.request.query;
  assertParams([{ name: "username", value: username, type: "string" }]);

  const { userId } = await UserModel.findOne(
    { username },
    { userId: 1 },
    { lean: true }
  );
  !userId && ctx.error(400, `user with username ${username} is not exist`);
  // if (!/^[0-9]{9}$/.test(userId)) {
  //   ctx.error(400, "invalid params 'userId'");
  // }

  // const user = await UserModel.findOne(
  //   { userId: +userId },
  //   { password: 0, isFrozen: 0, retryTimes: 0 }
  // );
  // 1. 访问天数
  const result = await UserModel.aggregate([
    {
      $match: { userId: { $eq: +userId } },
    },
    {
      $lookup: {
        from: "topics",
        let: { userId: "$userId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ["$creatorId", "$$userId"] }],
              },
            },
          },
          {
            $addFields: {
              replyCount: { $size: "$replies" },
              likes: { $size: "$supports" },
            },
          },
          // {
          //   $unwind: {
          //     path: "$replies",
          //     preserveNullAndEmptyArrays: true,
          //   },
          // },
          // {
          //   $group: {
          //     _id: "$_id",
          //     count: { $sum: 1 },
          //   },
          // },
          {
            $sort: {
              likes: -1,
              replyCount: -1,
              viewCount: -1,
            },
          },
          {
            $project: {
              topic_id: "$_id",
              title: 1,
              like_count: "$likes",
              isResolve: 1,
              create_at: "$createDate",
              _id: 0,
            },
          },
        ],
        as: "topics",
      },
    },
    {
      $lookup: {
        from: "replies",
        let: { user_id: "$userId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ["$reply_user", "$$user_id"] }],
              },
            },
          },
          {
            $lookup: {
              from: "topics",
              let: { topicId: "$topicId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [{ $eq: ["$_id", "$$topicId"] }],
                    },
                  },
                },
                {
                  $project: {
                    count: { $size: "$replies" },
                    title: 1,
                  },
                },
              ],
              as: "post",
            },
          },
          {
            $project: {
              post_number: { $first: "$post.count" },
              create_at: "$createTime",
              like_count: { $size: "$supports" },
              topic_id: "$topicId",
              title: { $first: "$post.title" },
            },
          },
          {
            $sort: { like_count: -1 },
          },
        ],
        as: "replies",
      },
    },
    // {
    //   $lookup: {
    //     from: "users",
    //     localField: "likes_receive",
    //     foreignField: "userId",
    //     pipeline: [
    //       {
    //         $group: {
    //           _id: "$userId",
    //           // count: { $count: {} }
    //         }
    //       },
    //     ],
    //     as: "most_liked",
    //   },
    // },
    {
      $project: {
        topic_count: { $size: "$topics" },
        post_count: { $size: "$replies" },
        day_visited: "$visitCount",
        time_read: "$readTime",
        recent_time_read: { $sum: "$last7ReadTime.count" },
        topics_entered: { $size: "$readed_topics" },
        posts_read_count: { $size: "$readed_replies" },
        solved_count: 1,
        likes_recieve: { $size: "$likes_receive" },
        likes_given: { $size: "$likes_to" },
        replies: { $slice: ["$replies", 6] },
        topics: { $slice: ["$topics", 6] },
        // { $slice: ["$likes_receive", 6] }
        most_liked_by_user: 1,
      },
    },
  ]);

  const likes_recieve = await UserModel.aggregate([
    {
      $match: { userId: { $eq: +userId } },
    },
    { $project: { likes_receive: 1, _id: 0 } },
    {
      $unwind: "$likes_receive",
    },
    {
      $replaceRoot: { newRoot: "$likes_receive" },
    },
    {
      $group: {
        _id: "$from",
        count: { $sum: 1 },
        type: { $first: "$type" },
        avatar: { $last: "$avatar" },
        username: { $last: "$username" },
        fullname: { $last: "$fullname" },
        userId: { $last: "$userId" },
        // userInfo: { $last: "$user_likes_from" },
      },
    },
    {
      $lookup: {
        from: "users",
        let: { userId: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$userId", "$$userId"] }] } } },
          {
            $project: {
              _id: 0,
              avatar: 1,
              fullname: 1,
              username: 1,
              userId: 1,
            },
          },
        ],
        as: "user_likes_from",
      },
    },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ["$$ROOT", { $first: "$user_likes_from" }],
        },
      },
    },
    { $unset: "user_likes_from" },
    {
      $sort: { count: -1 },
    },
    {
      $limit: 6,
    },
  ]);

  const likes_to = await UserModel.aggregate([
    {
      $match: { userId: { $eq: +userId } },
    },
    { $project: { likes_to: 1, _id: 0 } },
    {
      $unwind: "$likes_to",
    },
    {
      $replaceRoot: { newRoot: "$likes_to" },
    },
    {
      $group: {
        _id: "$to",
        count: { $sum: 1 },
        type: { $first: "$type" },
        avatar: { $last: "$avatar" },
        username: { $last: "$username" },
        fullname: { $first: "$fullname" },
        userId: { $last: "$userId" },
      },
    },
    {
      $lookup: {
        from: "users",
        let: { userId: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$userId", "$$userId"] }] } } },
          {
            $project: {
              _id: 0,
              avatar: 1,
              fullname: 1,
              username: 1,
              userId: 1,
            },
          },
        ],
        as: "user_likes_from",
      },
    },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ["$$ROOT", { $first: "$user_likes_from" }],
        },
      },
    },
    { $unset: "user_likes_from" },
    {
      $sort: { count: -1 },
    },
    {
      $limit: 6,
    },
  ]);
  const most_reply_to = await ReplyModel.aggregate([
    {
      $match: { reply_user: { $eq: +userId } },
    },
    {
      $project: { _id: 0, to: 1 },
    },
    {
      $unwind: "$to",
    },
    {
      $replaceRoot: { newRoot: "$to" },
    },
    {
      $group: {
        _id: "$userId",
        count: { $sum: 1 },
        avatar: { $last: "$avatar" },
        username: { $last: "$username" },
        fullname: { $last: "$fullname" },
        userId: { $last: "$userId" },
      },
    },
    {
      $lookup: {
        from: "users",
        let: { userId: "$_id" },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ["$userId", "$$userId"] }] } } },
          {
            $project: {
              _id: 0,
              avatar: 1,
              fullname: 1,
              username: 1,
              userId: 1,
            },
          },
        ],
        as: "reply_to",
      },
    },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ["$$ROOT", { $first: "$reply_to" }],
        },
      },
    },
    { $unset: "reply_to" },
    {
      $sort: { count: -1 },
    },
    {
      $limit: 6,
    },
  ]);
  // 热门分类下的主题数量与回复数量
  const topic_sum = await TopicModel.aggregate([
    {
      $match: {
        creatorId: { $eq: +userId },
      },
    },
    {
      $lookup: {
        from: "categories",
        // localField: "categoryId",
        // foreignField: "_id",
        let: { cateId: "$categoryId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$cateId"] } } },
          { $project: { alias: 1, _id: 0, name: 1 } },
        ],
        as: "category",
      },
    },
    {
      $group: {
        _id: "$categoryId",
        count: { $sum: 1 },
        name: { $first: { $first: "$category.name" } },
        alias: { $first: { $first: "$category.alias" } },
      },
    },
  ]);
  const reply_sum = await ReplyModel.aggregate([
    { $match: { reply_user: { $eq: +userId } } },
    {
      $lookup: {
        from: "categories",
        let: { cateId: "$categoryId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$cateId"] } } },
          { $project: { alias: 1, _id: 0, name: 1 } },
        ],
        as: "category",
      },
    },
    {
      $group: {
        _id: "$categoryId",
        count: { $sum: 1 },
        name: { $first: { $first: "$category.name" } },
        alias: { $first: { $first: "$category.alias" } },
      },
    },
  ]);
  const isTopicLenMax = topic_sum.length > reply_sum.length;
  const iteName = isTopicLenMax ? "topic" : "reply";
  const iterator = isTopicLenMax ? topic_sum : reply_sum;
  const otherIteName = isTopicLenMax ? "reply" : "topic";
  const otherIterator = isTopicLenMax ? reply_sum : topic_sum;
  const categoryStatics = iterator.map((item) => {
    const meta = {
      cateId: item._id,
      name: item.name,
      alias: item.alias,
    };
    meta[iteName] = item.count;
    const otherIteratorRes = otherIterator.find(
      ({ alias }) => alias === item.alias
    );
    meta[otherIteName] = otherIteratorRes ? otherIteratorRes.count : 0;
    return meta;
  });

  ctx.body = createResponseBody(200, "success", {
    data: Object.assign(result[0], {
      most_liked_by_user: likes_recieve,
      most_liked_users: likes_to,
      most_replies_to_users: most_reply_to,
      top_categories: categoryStatics,
    }),
  });
});

// 获取转化后的 gb2321 字符
// router.get("/mailinfo", async (ctx) => {
//   let { parseStr } = ctx.query;
//   parseStr = parseStr.toString();
//   // const buffer = iconv.encode(parseStr, "gb2312");
//   let result = "";
//   for (let i = 0; i < buffer.length; i++) {
//     result += buffer.slice(i, i + 1)[0].toString(16);
//   }
//   result = result.toUpperCase();
//   ctx.set("Content-Type", "text/plain; charset=gb2312");
//   ctx.body = result;
// });

/**
 * @param {string} str
 */
function processLimitProp(str, assistance) {
  const tokens = str.split("&");
  // console.log(tokens);
  const matchList = [];
  tokens.forEach((token, i, array) => {
    let info = null;
    let [key, value] = token.split("=");

    if (key == "category")
      value = assistance.categories.find(
        (c) => c.alias.toString() === value
      )._id;
    else if (key == "users") value = value.split(",").map((v) => +v);
    else if (key == "checkList") {
      info = +assistance.userId;
      value = value.split(",");
      if (value.includes("supported")) {
        value = "supported";
      } else {
        return;
      }
    } else if (key == "topicType" && value == "any") return;
    else if (key == "dateType") return;
    else if (key == "date") {
      let dateType = array.find((token) => token.includes("dateType"));
      value = +value;
      if (!dateType || dateType.split("=")[1] == "today") {
        info = "today";
        const currDateStart = +new Date(
          new Date(value).toLocaleDateString("zh")
        );
        const currDateEnd = currDateStart + 24 * 36e5;
        value = [currDateEnd, currDateStart];
      } else {
        info = dateType.split("=")[1];
      }
    } else if (key == "seen") {
      if (value == "all") return;
      info = assistance.readed_topics;
    } else if (key == "isMatchAllTag") return;
    else if (key == "tags") {
      value = value.split(",");
      let flag = array.find((token) => token.includes("isMatchAllTag"));
      info = flag ? +flag.split("=")[1] == "1" : false;
    } else if (key.includes("Range")) {
      value = value.split(",");
      info = value[0] == value[1];
    }
    matchList.push(getMatchObj(key, value, info));
  });
  return matchList;
}

function getMatchObj(key, value, info) {
  let obj = {};
  /**
   * todo
   *  1. checkList -> onlyTitle
   * */

  // prettier-ignore
  switch (key) {
    case "users": obj.creatorId = { $in: value }; break;
    case "category": obj.categoryId = getObjectId(value); break;
    case "tags": obj.tags = info ? { $all: value } : { $in: value }; break;
    case "seen": 
      switch (value) {
        case "seen": obj._id = { $in: info }; break;
        case "unseen": obj._id = { $not: { $in: info } }; break;
      }; break;
    case "checkList":
      switch (value) {
        case "supported": obj.supports = { $elemMatch: { $eq: info } }; break;
      }; break;
    case "topicType":
      switch (value) {
        case "noReplies": obj.replies = { $size: 0 }; break;
        case "resolved": obj.isResolve = true; break;
        case "unresolved": obj.isResolve = false; break;
      }; break;
    case "dateType": break;
    case "date":
      switch (info) {
        case "before": obj.createDate = { $lt: value }; break;
        case "after": obj.createDate = { $gt: value }; break;
        default: obj.createDate = { $lt: value[0], $gt: value[1] };
      }; break;
      // $where: "this.num.length < 3" }
    case "postsRange": 
      switch (info) {
        case true: obj.replyLen = { $eq
          : +value[0] }; break;
        case false: obj.replyLen = { $gte: +value[0], $lte: +value[1] }; break;
      }; break;
    case "viewsRange": 
      switch (info) {
        case true: obj.viewCount = { $eq: +value[0] }; break;
        case false: obj.viewCount = { $gte: +value[0], $lte: +value[1] }; break;
      }; break;
  }
  return obj;
}

router.get("/search", async (ctx) => {
  const { q, page, pageSize, user, order, limit, userId } = ctx.request.query;

  let regexp = new RegExp(q, "i");

  // options 的筛选条件：通用
  let isLimited = limit && limit.length > 0;
  let topicLimited = [];
  let replyLimited = [];
  if (isLimited) {
    const assistance = {};
    if (userId && !/[^\d]/.test(userId)) {
      let { readed_topics } = await UserModel.findOne(
        { userId: +userId },
        { readed_topics: 1 },
        { lean: true }
      );
      assistance.readed_topics = readed_topics;
      assistance.userId = userId;
    }
    const categories = await CategoryModel.find(
      {},
      { alias: 1, _id: 1 },
      { lean: true }
    );
    assistance.categories = categories;

    // 将 limit 的字符串转换为对应的选项对象
    topicLimited = processLimitProp(limit, assistance);
    replyLimited = processLimitProp(limit, assistance);
    // console.log(inspect(topicLimited, false, Infinity, true));
  }

  // order 阶段：通用
  let orderStage = [];
  let inserted = null;
  // 需要放在 addFields 后面, likes 和 views 都是新生成的
  switch (order) {
    case "support":
      inserted = { $sort: { likes: -1 } };
      break;
    case "view":
      inserted = { $sort: { views: -1 } };
      break;
    case "latestTopic":
      inserted = { $sort: { createDate: -1 } };
      break;
    case "latestReply":
      inserted = { $sort: { createTime: -1 } };
      break;
  }
  inserted && orderStage.push(inserted);

  /**************     判断只有主题还是只有回复，还是全有，还是包含了用户     **************/

  // prettier-ignore
  let topic_search_len = [], topicSearchResult = [];
  // 查询的不单是最近的主题
  if (order !== "latestReply") {
    const onlyContentTitleMatchObj = {
      $or: [{ title: { $regex: regexp } }, { content: { $regex: regexp } }],
    };

    let mayWithOptionMathObj = null;

    if (topicLimited.length) {
      // onlyTitle => 去除 title
      !!~limit.indexOf("onlyTitle") && onlyContentTitleMatchObj.$or.pop();

      topicLimited.unshift(onlyContentTitleMatchObj);

      mayWithOptionMathObj = { $and: topicLimited };
    }

    const topicMatchObj = mayWithOptionMathObj ?? onlyContentTitleMatchObj;

    topic_search_len = await TopicModel.find(
      topicMatchObj,
      { creatorId: 1 },
      { lean: true }
    );

    // 主题的搜索结果
    topicSearchResult = await TopicModel.aggregate([
      {
        $match: topicMatchObj,
      },
      {
        $addFields: {
          likes: { $size: "$supports" },
          views: "$viewCount",
        },
      },
      ...orderStage,
      {
        $skip: (+page - 1) * +pageSize || 0,
      },
      {
        $limit: +pageSize || 20,
      },
      {
        $lookup: {
          from: "categories",
          localField: "categoryId",
          foreignField: "_id",
          as: "category",
        },
      },
      {
        $lookup: {
          from: "users",
          let: { id: "$creatorId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$userId", "$$id"] } } },
            {
              $project: {
                userId: 1,
                username: 1,
                fullname: 1,
                avatar: 1,
                _id: 0,
              },
            },
          ],
          as: "user",
        },
      },
      {
        $project: {
          topicId: "$_id",
          _id: 0,
          likes: 1,
          title: 1,
          content: 1,
          total: 1,
          views: 1,
          tags: 1,
          isResolve: 1,
          createDate: 1,
          categoryName: { $first: "$category.name" },
          categoryAlias: { $first: "$category.alias" },
          userInfo: { $first: "$user" },
          type: "topic",
        },
      },
      {
        $unset: "user",
      },
    ]);
  }

  // prettier-ignore
  let reply_search_len = [], repliesSearchResult = [];
  // 查询的是回复
  if (!order || order === "latestReply") {
    const onlyContentMatchObj = { content: { $regex: regexp } };

    let mayWithOptionMathObj = null;

    if (replyLimited.length) {
      replyLimited.unshift(onlyContentMatchObj);

      mayWithOptionMathObj = { $and: replyLimited };
    }
    const ReplyMatchObj = mayWithOptionMathObj ?? onlyContentMatchObj;

    reply_search_len = await ReplyModel.find(
      ReplyMatchObj,
      { __v: 1 },
      { lean: true }
    );

    // 回复的搜索结果
    repliesSearchResult = await ReplyModel.aggregate([
      {
        $match: ReplyMatchObj,
      },
      {
        $addFields: {
          likes: { $size: "$supports" },
        },
      },
      ...orderStage,
      {
        $skip: (+page - 1) * +pageSize || 0,
      },
      {
        $limit: +pageSize || 20,
      },
      {
        $lookup: {
          from: "users",
          let: { id: "$reply_user" },
          pipeline: [
            { $match: { $expr: { $eq: ["$userId", "$$id"] } } },
            {
              $project: {
                userId: 1,
                username: 1,
                fullname: 1,
                avatar: 1,
                _id: 0,
              },
            },
          ],
          as: "user",
        },
      },
      {
        $project: {
          topicId: 1,
          content: 1,
          likes: 1,
          replyId: "$_id",
          type: "reply",
          createTime: 1,
          _id: 0,
          userInfo: { $first: "$user" },
        },
      },
      {
        $unset: "user",
      },
      {
        $lookup: {
          from: "topics",
          let: { id: "$topicId" },
          pipeline: [
            {
              $match: { $expr: { $eq: ["$_id", "$$id"] } },
            },
            {
              $lookup: {
                from: "categories",
                localField: "categoryId",
                foreignField: "_id",
                as: "category",
              },
            },
            {
              $project: {
                _id: 0,
                title: 1,
                tags: 1,
                isResolve: 1,
                categoryName: { $first: "$category.name" },
                categoryAlias: { $first: "$category.alias" },
                views: "$viewCount",
              },
            },
          ],
          as: "topicDetail",
        },
      },
      {
        $replaceRoot: {
          newRoot: { $mergeObjects: ["$$ROOT", { $first: "$topicDetail" }] },
        },
      },
      {
        $unset: "topicDetail",
      },
    ]);
  }

  const needUser = user !== "0";
  let userSearchRes = null;
  if (needUser) {
    // 用户的搜索结果
    userSearchRes = await UserModel.find(
      {
        $or: [
          { username: { $regex: regexp } },
          { fullname: { $regex: regexp } },
        ],
      },
      {
        userId: 1,
        username: 1,
        fullname: 1,
        avatar: 1,
        _id: 0,
      }
    )
      .skip((+page - 1) * +pageSize || 0)
      .limit(+pageSize || 6);
  }

  // 当前结果
  const records = [...topicSearchResult, ...repliesSearchResult];

  if (order === "supports") {
    records.sort((a, b) => b.likes - a.likes);
  } else if (order === "views") {
    records.sort((a, b) => b.views - a.views);
  }

  const result = {
    total: topic_search_len.length + reply_search_len.length,
    records,
    users: needUser ? userSearchRes : undefined,
  };

  ctx.body = createResponseBody(200, "success", { data: result });
});

router.get("/topicRecommend", async (ctx) => {
  const { categoryId, tags, title, content, topicId } = ctx.request.query;
  const cateRes = await CategoryModel.find(
    {},
    { tags: 1, _id: 0 },
    { lean: true }
  );

  const lowerTitle = title.toLocaleLowerCase();
  const lowerContent = content.toLocaleLowerCase();

  const allTag = cateRes.reduce((pre, next) => pre.concat(next.tags), []);

  // 通过 title 查询出潜在的 tag, 因为用户可能并没有选 tag
  const tagsByTitle = allTag.filter((tag) => !!~lowerTitle.indexOf(tag));
  const tagsByContent = allTag.filter((tag) => !!~lowerContent.indexOf(tag));

  // 去重
  const combineTags = [...new Set([tags, ...tagsByTitle, ...tagsByContent])];

  const result = await TopicModel.aggregate([
    {
      $match: {
        $and: [{ _id: { $not: { $eq: getObjectId(topicId) } } }],
        $or: [
          { categoryId: getObjectId(categoryId) },
          { tags: { $in: combineTags } },
        ],
      },
    },
    {
      $sort: { createDate: -1 },
    },
    {
      $limit: 4,
    },
    {
      $lookup: {
        from: "categories",
        localField: "categoryId",
        foreignField: "_id",
        as: "category",
      },
    },
  ]);

  ctx.body = createResponseBody(200, "success", { data: result });
});

router.post("/test-re", async (ctx, next) => {
  const { date, ids } = ctx.request.body;
  ctx.request.query.validate = 333;

  const result = await getUserLoginDevId(ids);

  // ctx.redirect(`/common/test123?redirect=${true}`);
  // await next();
  ctx.body = {
    code: 200,
    data: result,
  };

  // io.to(socketMap.get(+userId)).emit("update_private", private);
});

router.get("/test123", (ctx) => {
  console.log("123");
  const { redirect } = ctx.request.query;

  ctx.body = {
    code: 307,
    data: "redirect",
    redirect: ctx.status,
  };
});

module.exports = router;
