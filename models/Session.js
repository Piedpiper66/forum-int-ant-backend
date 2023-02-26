const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const Session = {
  expire: {
    type: Number,
    default: 6000, // 10分钟
  },
  setDate: {
    type: Number,
    require: true,
  },
  userId: Number,
  username: String,
  email: String,
};

module.exports = mongoose.model("Session", new Schema(Session));
