const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const Reply = {
  topicId: {
    type: Schema.Types.ObjectId,
  },
  categoryId: Schema.Types.ObjectId,
  reply_user: {
    type: Number,
    required: true,
  },
  username: String,
  avatar: String,
  // 判断是否是回复他人的回复
  to: {
    replyId: { type: Schema.Types.ObjectId },
    username: { type: String },
    avatar: { type: String },
    createTime: { type: Number },
    userId: { type: Number },
  },
  createTime: {
    type: Number,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  markdown: String,
  supports: [Number],
  lastModify: {
    type: Number,
    required: true,
  },
};

module.exports = mongoose.model("Reply", new Schema(Reply));
