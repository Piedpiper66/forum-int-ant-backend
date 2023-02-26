const Router = require("koa-router");
const router = new Router();
const UserModel = require("../../models/User");
const SessionModel = require("../../models/Session");
const Koapassport = require("koa-passport");
const { assertParams } = require("../../utils/exception");
const {
  createResponseBody,
  getUserInsensitiveInfo,
  getFilterObj,
} = require("../../utils/tool");
const {
  Types: { ObjectId },
  isValidObjectId,
} = require("mongoose");

const { customAlphabet } = require("nanoid");
const nanoid = customAlphabet("1234567890abcdefghijklmn", 8);

const { typeEnum, sendMail } = require("../../utils/mailSender");

const aesDecrypt = require("../../utils/aesCrypto");

const authTools = require("../../utils/authPromise");
// const { default: mongoose } = require("mongoose");

// session
/**
 * @types { id: string, username: string, userId: number, date: number }[]
 */
// const SESSIONS = [];
router.post("/send-checkEmail", async (ctx) => {
  const { user } = ctx.request.body;

  const randomId = nanoid();

  const userValidate = await UserModel.findOneAndUpdate(
    {
      $or: [{ username: user + "" }, { email: user + "" }],
    },
    {
      $set: {
        "mailRegister.captcha": randomId,
        "mailRegister.timestamp": +new Date(),
        "mailRegister.expire": 10 * 60 * 1000,
      },
    },
    { lean: true, projection: { username: 1, email: 1 } }
  );

  if (userValidate) {
    const { username, email } = userValidate;

    await sendMail(username, email, randomId, typeEnum.VALIDATE);

    ctx.body = {
      code: 200,
      status: 1,
    };
  } else {
    ctx.error(400, "用户不存在");
  }
});
router.post("/checkmail", async (ctx) => {
  const { email } = ctx.request.body;

  assertParams([{ name: "email", value: email, type: "string" }]);

  const emailExit = await UserModel.exists({ email });

  ctx.body = {
    code: 200,
    status: +emailExit, // 存在未 1, 不存在为 0
  };
});

router.post("/checkusername", async (ctx) => {
  const { username } = ctx.request.body;

  assertParams([{ name: "username", value: username, type: "string" }]);

  const usernameExit = await UserModel.exists({ username });

  ctx.body = { code: 200, message: "用户名可用", status: +usernameExit };
});

// 发送重设密码的邮箱
router.post("/check-send-email", async (ctx) => {
  const { email } = ctx.request.body;

  assertParams([{ name: "email", value: email, type: "string" }]);

  const findRes = await UserModel.findOne(
    { email },
    { mailRegister: 1, email: 1, _id: 0, username: 1 },
    { lean: true }
  );

  let sessionid;

  if (findRes) {
    sessionid = ObjectId();

    // // 如果是重设密码, 则存一个 session
    const sessionObj = {
      _id: sessionid,
      email,
      setDate: +new Date(),
    };

    await new SessionModel(sessionObj).save();

    const { mailRegister, username } = findRes;

    const newCaptcha = nanoid();

    await UserModel.updateOne(
      { email },
      {
        $set: {
          mailRegister: Object.assign(mailRegister, {
            captcha: newCaptcha,
            timestamp: +new Date(),
            expire: 10 * 60 * 1000,
          }),
        },
      }
    );

    await sendMail(username, email, newCaptcha, typeEnum.RESETPASSWORD);

    ctx.body = {
      code: 200,
      data: sessionid,
    };
  } else {
    ctx.body = {
      code: 400,
      message: "该邮箱对应的用户不存在",
    };
  }
});

// 重新设置对应邮箱用户的邮箱
router.post("/check-reset-email", async (ctx) => {
  const { email, newEmail, captcha } = ctx.request.body;

  assertParams([
    { name: "email", value: email, type: "string" },
    { name: "newMail", value: newEmail, type: "string" },
    { name: "captcha", value: captcha, type: "string" },
  ]);

  const user = await UserModel.findOne(
    { email },
    { username: 1, mailRegister: 1 },
    { lean: true }
  );

  if (user) {
    const { expire, captcha: DBCaptcha, timestamp } = user.mailRegister;

    if (captcha === DBCaptcha) {
      if (Date.now() - timestamp <= expire) {
        await UserModel.updateOne(
          { email },
          {
            email: newEmail,
            "mailRegister.captcha": "",
            "mailRegister.timestamp": "",
          },
          { lean: true }
        );

        ctx.body = { code: 200, message: "更改成功", status: 4 };
      } else {
        ctx.body = { code: 400, message: "验证码已过期", status: 3 };
      }
    } else {
      ctx.body = { code: 400, message: "验证码错误", status: 2 };
    }
  } else {
    ctx.body = { code: 400, message: `用户${user.username}不存在`, status: 1 };
  }
});

// 重设密码
router.post(
  "/reset-pwd",
  // Koapassport.authenticate("jwt", { session: false }),
  async (ctx) => {
    const { password, sessionid, email, noSession } = ctx.request.body;

    let result;

    console.log(noSession);

    // 查看 email 与 sessionid 是否能对应
    if (!noSession) {
      result = await SessionModel.exists({
        _id: ObjectId(sessionid),
        email,
      });
    }

    if (noSession || result) {
      // const { userId } = ctx.state.user;
      const decrypted = aesDecrypt(password);

      if (decrypted) {
        const passwordEncrypted = await authTools.encryptPwd(decrypted);

        await UserModel.updateOne({ email }, { password: passwordEncrypted });

        !noSession &&
          (await SessionModel.deleteOne({ _id: ObjectId(sessionid) }));

        ctx.body = createResponseBody(200, "修改成功", { status: 0 });
      } else {
        ctx.error(500, "服务器出错");
      }
    } else {
      ctx.error(400, "信息有误");
    }
  }
);

// ------------- 或许丢弃 -------------------
// router.post(
//   "/gen-pwd-session",
//   Koapassport.authenticate("jwt", { session: false }),
//   async (ctx) => {
//     const { date } = ctx.request.body;

//     const { userId, username, email } = ctx.state.user;

//     const sessionid = ObjectId();

//     // prettier-ignore
//     const sessionObj = { _id: sessionid, username, userId, email, setDate: date, expire: 600 /* 秒 */ };

//     // SESSIONS.push(sessionObj);
//     await new SessionModel(sessionObj).save();

//     const info = await sendMail(username, email, sessionid, 0);
//     /**
//      *   {
//           accepted: [ '1353262774@qq.com' ],
//           rejected: [],
//           envelopeTime: 126,
//           messageTime: 109,
//           messageSize: 993,
//           response: '250 Mail OK queued as smtp13,EcCowAAH6pONaCdiDzW+Gg--.24616S3 1646749837',
//           envelope: { from: '18571712071@163.com', to: [ '1353262774@qq.com' ] },
//           messageId: '<b90b1684-4958-cb10-9c80-6f3d2d0e8c5a@163.com>'
//         }
//      *
//     */
//     console.log("set-pwd-mail-info", info);
//     ctx.body = createResponseBody(200, null, { status: 0 });
//   }
// );

// router.post(
//   "/check-pwd-reset-valid",
//   Koapassport.authenticate("jwt", { session: false }),
//   async (ctx) => {
//     const { username } = ctx.state.user;
//     const { date, sessionid } = ctx.request.body;

//     if (!parseInt(date)) ctx.error(400, "invalid param date");

//     let targetIndex = -1;
//     if (!isValidObjectId(sessionid)) {
//       ctx.error(400, "无效的 sessionid");
//     }
//     // const targetSession = SESSIONS.find(({ id }, index) => {
//     //   const compare = id === sessionid;
//     //   compare && (targetIndex = index);
//     //   return compare;
//     // });
//     // const id =
//     const targetSession = await SessionModel.findOne(
//       { _id: ObjectId(sessionid) },
//       null,
//       { lean: true }
//     );
//     // 已登录, 存在 session, 未过期, 是本人, 全满足则成功响应
//     if (targetSession) {
//       console.log(date - targetSession.setDate);
//       //
//       if ((date - targetSession.setDate) / 1000 <= targetSession.expire) {
//         //
//         if (targetSession.username === username) {
//           // 删除 session
//           // const index
//           // SESSIONS.splice(targetIndex, 1);
//           ctx.body = createResponseBody(200, null, { status: 0 });
//         } else {
//           ctx.error(403, "无权访问", { status: 3 });
//         }
//       } else {
//         await SessionModel.remove({ _id: ObjectId(sessionid) });
//         ctx.error(403, "链接已过期", { status: 1 });
//       }
//     } else {
//       ctx.error(400, `sessionid ${sessionid} 不存在`);
//     }
//   }
// );
// ------------- 或许丢弃 -------------------

router.get(
  "/current",
  Koapassport.authenticate("jwt", { session: false }),
  async (ctx) => {
    const { user } = ctx.state;
    const { lastActivity, userId } = user;
    const now = new Date();
    const lastActiveDay = new Date(lastActivity);
    const timeMethodNames = ["getFullYear", "getMonth", "getDate"];

    // 年月日都不相同，则判断为新的登录次数
    const isDiff = timeMethodNames.some(
      (method) => now[method]() !== lastActiveDay[method]()
    );

    const updateObj = {};
    isDiff && (updateObj.$inc = { visitCount: 1 });
    updateObj.$set = { lastActivity: +now };

    const refreshUser = await UserModel.findOneAndUpdate(
      { userId },
      updateObj,
      {
        lean: true,
        new: true,
      }
    );

    const filterInfo = getUserInsensitiveInfo(refreshUser);

    ctx.body = createResponseBody(200, "vertify success", {
      data: filterInfo,
    });
  }
);

module.exports = router;
