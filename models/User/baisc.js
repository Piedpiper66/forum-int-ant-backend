const UserBasic = {
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  gender: {
    type: String,
    default: "male",
  },
  avatar: {
    type: String,
    default: "http://localhost:3000/u/fx3xktwt6c.png",
  },
  fullname: {
    type: String,
    default: "",
  },
  introduction: {
    type: String,
    default: "",
  },
  location: {
    type: String,
    default: "",
  },
  website: String,
  createDate: {
    type: Number,
    default: Date.now(),
  },
  // isLogin: {
  //   type: Boolean,
  //   default: false,
  // },
  cardBg: {
    type: String,
    default: "",
  },
  headerBg: {
    type: String,
    default: "",
  },
};

module.exports = UserBasic;
