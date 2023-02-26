const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// const TopicSchema = require("../Schemas/Topic");

const Category = {
  name: {
    type: String,
    require: true,
    trim: true,
  },
  description: {
    type: String,
    require: true,
  },
  tags: {
    type: Array,
    require: true,
    default: [],
  },
  alias: {
    type: String,
    require: true,
  },
  topicSum: {
    type: Number,
    default: 0
  }
};

const CategorySchema = new Schema(Category);

module.exports = mongoose.model("Category", CategorySchema);
