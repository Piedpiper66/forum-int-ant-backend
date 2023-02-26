const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PrivateMessage = new Schema({
  id: String,
  from: {
    type: Number,
    require: true,
  },
  to: {
    type: {
      user: Number,
      msgId: String,
    },
    require: true,
  },
  title: {
    type: String,
    require: true,
  },
  content: {
    type: String,
    require: true,
  },
  markdown: {
    type: String,
    require: true,
  },
  createDate: {
    type: Number,
    require: true,
  },
  isChecked: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("Private", PrivateMessage);
