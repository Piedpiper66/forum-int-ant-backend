const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const { customAlphabet } = require("nanoid");
const nanoid = customAlphabet("1234567890", 9);

const Basic = require("./User/baisc");
const Extend = require("./User/extend");
const Safe = require("./User/safe");
const Setting = require("./User/settings");

const User = {
  userId: {
    type: Number,
    default: nanoid(),
    unique: true,
  },
  topics: [{ type: Schema.Types.ObjectId, ref: "Topic" }],
  ...Basic,
  ...Extend,
  ...Safe,
};

module.exports = mongoose.model("User", new Schema(User));
