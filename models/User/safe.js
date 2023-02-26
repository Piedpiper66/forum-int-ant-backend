const UserSafe = {
  retryTimes: {
    type: Number,
    default: 5,
    min: 0,
    max: 5,
  },
  role: {
    type: String,
    default: "user",
    enum: ["user", "admin", "super"],
  },
  isFrozen: {
    type: Boolean,
    default: false,
  },
  nextUnfrozenDate: {
    type: Number,
    default: 0,
  },
  password: {
    type: String,
    required: true,
  },
  userLoginDevices: {
    type: [Object],
    default: [],
  },
  mailRegister: {
    type: {
      code: String,
      captcha: String,
      expire: Number,
      isActive: Boolean,
      timestamp: Number,
    },
  },
  accountRiskGuardian: Object,
};

module.exports = UserSafe;
