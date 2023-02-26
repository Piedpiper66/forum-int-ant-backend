const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const Type = {
  
};

module.exports = mongoose.model("Comment", new Schema(Type));
