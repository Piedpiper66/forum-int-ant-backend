const mongoose = require("mongoose");

const UserExtend = {
  avatarFileName: String, // 用户头像的文件名
  lastPostDate: {
    type: Number,
    default: 0,
  },
  lastActivity: {
    type: Number,
    default: Date.now(),
  },
  user_draft: {
    type: {
      sort: String,
      category: {
        type: {
          name: String,
          id: mongoose.Schema.Types.ObjectId,
          alias: String,
        },
        default: {},
      },
      categoryId: mongoose.Schema.Types.ObjectId,
      title: {
        type: String,
        default: "",
      },
      tags: {
        type: [String],
        default: [],
      },
      extra: Object,
      to: {
        type: [Number],
        default: [],
      },
      content: String,
      markdown: String,
      contentImgReflect: Object,
      lastModified: Number,
      createTime: Number,
    },
    default: null,
  },
  uploadTempImgs: {
    type: [String],
    default: [],
  },
  tempAvatar: String,
  visitCount: {
    type: Number,
    default: 0,
  },
  readTime: {
    // 阅读时间
    type: Number,
    default: 0,
  },
  last7ReadTime: {
    // 近7天阅读时间
    type: [{ date: Number, count: Number }],
    default: [],
  },
  readed_replies: {
    // 帖子（回复）阅读数量
    type: [mongoose.SchemaTypes.ObjectId],
    default: [],
  },
  readed_topics: {
    // 主题阅读数量
    type: [mongoose.SchemaTypes.ObjectId],
    default: [],
  },
  // 送出的喜欢数量
  likes_to: {
    type: [
      {
        to: Number,
        id: mongoose.SchemaTypes.ObjectId,
        type: {
          type: String,
          require: true,
          validate: {
            validator: (type) => ["reply", "topic"].includes(type),
            message: "点赞类型不正确",
          },
        },
        avatar: String,
        username: String,
        fullname: String,
      },
    ],
    default: [],
  },
  // 收到的喜欢数量
  likes_receive: {
    type: [
      {
        from: Number,
        id: mongoose.SchemaTypes.ObjectId,
        type: {
          type: String,
          require: true,
          validate: {
            validator: (type) => ["reply", "topic"].includes(type),
            message: "点赞类型不正确",
          },
        },
        avatar: String,
        username: String,
        fullname: String,
      },
    ],
    default: [],
  },
  // 解决方案数量
  solved_count: {
    type: Number,
    default: 0,
  },
  bookmarks: {
    type: [
      {
        type: {
          type: String,
          require: true,
          validate: {
            validator: (type) => ["reply", "topic"].includes(type),
            message: "点赞类型不正确",
          },
        },
        id: mongoose.SchemaTypes.ObjectId,
        date: Number,
      },
    ],
    default: [],
  },

  // 发送的私信
  msg_send: {
    type: [String],
    default: [],
  },
  // 接收的私信
  msg_receive: {
    type: [String],
    default: [],
  },
  // 订阅的主题
  subscribes: {
    type: [{ themeId: mongoose.SchemaTypes.ObjectId, lastViewTime: Number }],
    default: [],
  },
};

module.exports = UserExtend;
