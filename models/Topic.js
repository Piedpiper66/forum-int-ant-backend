const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const mongoosePaginate = require("mongoose-paginate");

const Topic = {
  title: {
    type: String,
    required: true,
    trim: true,
  },
  creatorId: {
    type: Number,
    required: true,
    ref: "User",
  },
  createDate: {
    type: Number,
    required: true,
  },
  lastActivity: {
    type: Number,
    default: 0,
  },
  content: {
    type: String,
    required: true,
  },
  markdown: {
    type: String,
    required: true,
  },
  categoryId: {
    type: Schema.Types.ObjectId,
    ref: "Category",
  },
  tags: {
    type: [String],
    default: [],
  },
  replies: [Schema.Types.ObjectId],
  replyLen: {
    type: Number,
    default: 0,
  },
  viewCount: {
    type: Number,
    default: 0,
  },
  supports: [{ type: Number, ref: "User" }],
  solution: {
    type: {
      topicId: Schema.Types.ObjectId,
      replyId: Schema.Types.ObjectId,
      username: String,
      userId: Number,
      avatar: String,
    },
    default: null,
  },
  isResolve: {
    type: Boolean,
    default: false,
  },
  isTopping: {
    type: Boolean,
    default: false,
  },
  subscribers: {
    type: [Number],
    default: [],
  },
};

const schema = new Schema(Topic);

mongoosePaginate.paginate.options = {
  lean: true,
  sort: {
    date: -1,
  },
  leanWithId: true,
};

schema.plugin(mongoosePaginate);

// module.exports = new Schema(Topic);
module.exports = mongoose.model("Topic", schema);
