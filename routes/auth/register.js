const Router = require("koa-router");
const router = new Router();

const decrypt = require("../../utils/aesCrypto");

const { customAlphabet } = require("nanoid");
const nanoid = customAlphabet("1234567890abcdefghijklmn", 8);
const UserModel = require("../../models/User");
const {
  throwExceptionBody,
  dealCatchedError,
  assertParams,
} = require("../../utils/exception");
const authTools = require("../../utils/authPromise");

const { sendMail, typeEnum } = require("../../utils/mailSender");
const { createResponseBody, isUpdated } = require("../../utils/tool");

router.post("/register", async (ctx) => {
  // const { username, password, email, fullname = "" } = ctx.request.body;

  // console.log(username, password, email, fullname);

  // assertParams([
  //   { name: "username", value: username, type: "string" },
  //   { name: "password", value: password, type: "string" },
  //   { name: "email", value: email, type: "string" },
  //   { name: "fullname", value: fullname, type: "string" },
  // ]);

  // 将前端传输的加密密码解密
  // const userPwd = decrypt(password);

  const { info } = ctx.request.body;

  if (!info || typeof info !== "string") {
    ctx.error(400, "无效的参数");
  }

  const decryptedInfo = decrypt(info);

  const { email, username, fullname, password } = JSON.parse(decryptedInfo);

  const captcha = nanoid();

  const passwordEncrypted = await authTools.encryptPwd(password);

  const userModel = {
    username,
    password: passwordEncrypted,
    email,
    fullname,
    mailRegister: {
      captcha,
      expire: 10 * 60 * 1000, // 10 分钟
      isActive: false,
      timestamp: Date.now(),
    },
  };

  const { info: mailInfo } = await sendMail(
    username,
    email,
    captcha,
    typeEnum.REGISTER
  );

  await new UserModel(userModel).save();

  ctx.body = {
    code: 200,
    status: 1,
    info: mailInfo,
  };
});

router.post("/send-active-mail", async (ctx) => {
  const { identity } = ctx.request.body;

  const result = await UserModel.findOne(
    {
      $or: [{ username: identity }, { email: identity }],
    },
    { username: 1, email: 1, mailRegister: 1, _id: 0 },
    { lean: true }
  );
  console.log(result);
  if (result) {
    const { username, email, mailRegister } = result;

    const code = nanoid(10);

    await UserModel.updateOne(
      { email },
      {
        $set: {
          mailRegister: Object.assign(mailRegister, {
            captcha: code,
            timestamp: Date.now(),
          }),
        },
      }
    );

    await sendMail(username, email, code, typeEnum.REGISTER);

    ctx.body = createResponseBody(200, "success", { status: 1 });
  } else {
    ctx.error(400, "user is not exist");
  }
});

router.post("/resendMail", async (ctx) => {
  const { username, email, date, resetType } = ctx.request.body;
  const isReset =
    typeof resetType === "number" && [0, 1, 2].includes(resetType);
  console.log(isReset);
  let query = null;

  // if (!isReset) {
  const queryProp = username ? "username" : email ? "email" : "";
  query = { [queryProp]: username || email };
  // } else {
  //   query = { username };
  // }
  console.log(query);
  const result = await UserModel.findOne(
    query,
    { mailRegister: 1, email: 1, _id: 0, username: 1 },
    { lean: true }
  );
  // console.log(result);
  if (result) {
    const { mailRegister } = result;

    const mailTo = isReset ? email : result.email;

    const newCaptcha = nanoid();

    await UserModel.updateOne(query, {
      $set: {
        mailRegister: Object.assign(mailRegister, {
          code: newCaptcha,
          timestamp: date,
        }),
      },
    });
    await sendMail(
      result.username,
      mailTo,
      newCaptcha,
      isReset ? resetType : undefined
    );

    ctx.body = createResponseBody(200, null, { status: 0 });
  } else {
    ctx.error(400, `用户${username}不存在`);
  }
});

router.post("/sendMailCaptcha", async (ctx) => {
  // 如果是已注册的账号需要接收验证码，使用 email
  // 如果是要更换邮件需要接收验证码，则还需要 newEmail
  const { email, newEmail } = ctx.request.body;
  console.log(email, newEmail);
  assertParams([
    { name: "email", value: email, type: "string" },
    { name: "new-email", value: newEmail, type: "string" },
  ]);

  const user = await UserModel.findOne(
    { email },
    { mailRegister: 1, username: 1, _id: 0 },
    { lean: true }
  );

  if (user) {
    const captcha = nanoid();

    await sendMail(user.username, newEmail, captcha, typeEnum.RESETEMAIL);

    await UserModel.updateOne(
      { email },
      {
        $set: {
          mailRegister: Object.assign(user.mailRegister, {
            captcha,
            timestamp: Date.now(),
            expire: 10 * 60 * 1000,
          }),
        },
      }
    );

    ctx.body = {
      code: 200,
      status: 1,
    };
  } else {
    ctx.body = { code: 400, status: 0, message: "该邮箱所对应的用户不存在!" };
  }
});

// 激活邮箱和重设邮箱
router.post("/mailCaptchaCheck", async (ctx) => {
  const { captcha, user, reset, newEmail } = ctx.request.body;

  const result = await UserModel.findOne(
    { $or: [{ username: user }, { email: user }] },
    { mailRegister: 1, email: 1, _id: 0 },
    { lean: true }
  );

  // const isResetEmail = typeof reset === "boolean" && reset;
  if (result) {
    const { email, mailRegister } = result;

    const { expire, timestamp, isActive, captcha: DBCaptcha } = mailRegister;

    if (captcha === DBCaptcha) {
      // 如果验证码没过期, 成功响应
      if (Date.now() - timestamp <= expire) {
        const setObject = { mailRegister };

        // 注册激活账号
        if (!isActive) {
          setObject.lastActivity = Date.now();
          setObject.mailRegister.isActive = true;
        }

        setObject.mailRegister.captcha = "";

        console.log(setObject);

        const result = await UserModel.updateOne(
          { email },
          {
            $set: setObject,
          }
        );
        console.log(result);

        if (isUpdated(result)) {
          ctx.body = createResponseBody(200, "验证成功", { status: 4 });
        } else {
          ctx.error(500, "服务器内部错误");
        }

        // else {
        //   // 重设邮箱
        //   await UserModel.updateOne(query, {
        //     $set: { email: newEmail },
        //   });
        //   ctx.body = createResponseBody(200, "重设成功", { status: 0 });
        // }
      } else {
        ctx.body = createResponseBody(400, "验证码已过期", {
          status: 3,
        });
      }
    } else {
      ctx.body = createResponseBody(400, "验证码错误", { status: 2 });
    }
  } else {
    ctx.body = createResponseBody(400, `用户 ${username} 不存在`, {
      status: 1,
    });
  }
});

module.exports = router;
