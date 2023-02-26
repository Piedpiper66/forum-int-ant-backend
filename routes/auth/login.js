const Router = require("koa-router");
const router = new Router();
const UserModel = require("../../models/User");
const { throwExceptionBody } = require("../../utils/exception");
const {
  createResponseBody,
  getUserInsensitiveInfo,
  isUpdated,
} = require("../../utils/tool");
const authTools = require("../../utils/authPromise");

const decrypt = require("../../utils/aesCrypto");
const { nanoid } = require("nanoid");

const { socketMap, io } = require("../../utils/socket");

// 单点登录
router.post("/login", async (ctx, next) => {
  // 可以使用 username 或 邮箱 登录
  const { userIdentity, password: userSendPwd, device } = ctx.request.body;

  const UserQuery = await UserModel.findOne({
    $or: [{ email: userIdentity + "" }, { username: parseInt(userIdentity) }],
  });

  // 如果找到了该用户，则进行操作，否则返回 400
  if (UserQuery) {
    // prettier-ignore
    const { 
      retryTimes, nextUnfrozenDate, isFrozen, userId,
      _id, mailRegister, password: dbPwd, userLoginDevices
    } = UserQuery;

    const userFilter = { userId };

    // 判断该账号是否已被激活
    if (mailRegister.isActive) {
      // 存在剩余密码错误重试次数，
      // 如果不存在说明账户被冻结，所以如果当前时间以及到了解冻时间，则放行
      if (retryTimes > 0 || Date.now() >= nextUnfrozenDate) {
        // 判断密码是否正确
        // prettier-ignore
        const isCorrectPwd = await authTools.isCorrectPwd(decrypt(userSendPwd), dbPwd);
        // 密码正确，
        if (isCorrectPwd) {
          const isFirstLogin = userLoginDevices.length === 0;

          let currentDevId = isFirstLogin ? nanoid(10) : "";

          let currentDevices = null;

          // 如果无设备则跳过, 有设备则校验
          if (!isFirstLogin) {
            /**
             * 判断用户登录是否异常
             *  1. 地理位置中国家，省、市其中一个不同则异常
             *  2. 操作系统异常
             *  3. 客户端异常：浏览器不同，移动端或桌面端的类型与上次不同
             *  4. ip 异常，ip 不同，ipv4 => ipv6, ip 应该是一个 [], 当其他字段相同时，添加新的 ip
             * */
            // prettier-ignore
            const exceptionInfo = getUserExceptionFromDevices(userLoginDevices, device);
            // dbDev 是新的 ip 需要插入到的设备信息对象
            const { exception, ipIncludes, dbDev } = exceptionInfo;
            // 这里应该在 UserModal 中新增字段，该值包含一个 id 和 信息，在邮箱验证完成后验证该 id
            if (exception) {
              const id = nanoid(10);

              // prettier-ignore
              const saveRes = await UserModel.updateOne({ userId }, { $set: { accountRiskGuardian: {
              id, device, type: "add", date: Date.now(), password: userSendPwd
            } } });

              if (isUpdated(saveRes)) {
                // Forbidden
                ctx.body = createResponseBody(403, "登录设备异常", {
                  status: id,
                });
              } else {
                ctx.error(500, "服务器内部错误");
              }

              return;
            } else if (!ipIncludes) {
              const id = nanoid();

              // prettier-ignore
              const saveRes = await UserModel.updateOne({ userId }, { $set: { accountRiskGuardian: {
              id, device: dbDev, ip: device.ip, type: "insert", date: Date.now()
            } } });

              if (isUpdated(saveRes)) {
                // Forbidden
                ctx.body = createResponseBody(403, "网络环境异常", {
                  status: id,
                });
              } else {
                ctx.error(500, "服务器内部错误");
              }

              return;
            }

            // 如果此时已经有别的设备登录了，则通知已登录设备该登录的地理位置，并将其下线
            userLoginDevices.forEach((dev) => {
              const { id, isLogin } = dev;
              if (isLogin) {
                io.to(socketMap.get(`${userId}_${id}`)).emit(
                  "forceLogout",
                  device.geo
                );
              }
            });

            // 设备无异常，通过 deviceId 更改登陆状态和登录时间
            const { id: deviceId } = dbDev;

            // 登录状态除了当前设备，其他都设置为未登录
            userLoginDevices.forEach(
              (dev) => (dev.isLogin = dev.id === deviceId)
            );

            currentDevId = deviceId;
            currentDevices = userLoginDevices;
          } else {
            currentDevices = [
              {
                ...device,
                date: Date.now(),
                id: currentDevId,
                ip: [device.ip],
                isLogin: true,
              },
            ];
          }

          // 准备生成 cookie 中的 token
          // 在 playload 中增加 user的 _id, 用于 jwt 匹配成功后的用户信息查询
          const payload = { id: _id };

          // token 有效期（7天）
          const loginExpire = 7 * 24 * 60 * 60;

          // 生成 token
          const token = await authTools.genToken(payload, {
            expiresIn: loginExpire,
          });

          const commonCookieOption = {
            // 设置为 true 值后将无法通过 JS 获取
            httpOnly: false,
            maxAge: loginExpire * 1000,
          };

          // 通过 Cookie 发送 token, 设置为相同的过期时间
          ctx.cookies.set("FORUM_t", `Bearer ${token}`, commonCookieOption);
          ctx.cookies.set("LOGIN_DATE", Date.now(), commonCookieOption);
          ctx.cookies.set("DEV_ID", currentDevId, commonCookieOption);

          const updateObj = { userLoginDevices: currentDevices };

          // 如果输错过, 则重置重试次数
          retryTimes < 5 && (updateObj.retryTimes = 5);
          // 如果被冻结, 则解冻
          isFrozen && (updateObj.isFrozen = false);
          // 设置为已登录的状态
          updateObj.isLogin = true;

          await UserModel.updateOne(userFilter, updateObj);

          // 响应
          ctx.body = createResponseBody(200, "登陆成功", {
            data: getUserInsensitiveInfo(UserQuery),
          });
        } else {
          // 不能是 retryTimes === 1
          const isLastTry = retryTimes - 1 === 0;
          // 一天后解冻
          const nextUnfrozenDate = Date.now() + 24 * 60 * 60 * 1000;
          // prettier-ignore
          const updateLoginStatus = isLastTry
              ? { $inc: { retryTimes: -1 } } : 
                { $inc: { retryTimes: -1 }, $set: { isFrozen: true, nextUnfrozenDate } };

          await UserModel.updateOne(userFilter, updateLoginStatus);

          if (!isLastTry) {
            throwExceptionBody(
              400,
              `密码错误, 今日还剩${retryTimes - 1}次登录次数`
            );
          } else {
            throwExceptionBody(400, "该账号已暂时冻结, 请一天后再尝试", {
              isFrozen,
            });
          }
        }
      } else {
        // prettier-ignore
        throwExceptionBody(400, "该账号已暂时冻结, 请一天后再尝试", { isFrozen });
      }
    } else {
      ctx.body = createResponseBody(400, "账号未激活", { isActive: false });
    }
  } else {
    throwExceptionBody(400, "用户名或邮箱不存在");
  }
});

router.post("/check-with-no-risk", async (ctx) => {
  const { user, id } = ctx.request.body;

  if (!id) {
    ctx.status = 400;
    ctx.error(400, "无效 id");
  }

  const UserQuery = await UserModel.findOne(
    { "accountRiskGuardian.id": id },
    null,
    { lean: true }
  );

  if (UserQuery) {
    const { userId, accountRiskGuardian, userLoginDevices } = UserQuery;
    const { device, ip, type } = accountRiskGuardian;

    // 该 devId 对应的设备登录，其他的全下线；
    let currentLoginDevId = null;

    if (type === "add") {
      // 如果是 add, device 指向新的设备对象
      currentLoginDevId = nanoid(10);

      userLoginDevices.push(
        Object.assign(device, {
          id: currentLoginDevId,
          // isLogin: true,
          date: Date.now(),
          ip: [device.ip],
        })
      );
    } else if (type === "insert") {
      // 如果是 insert, device 对象指向 数据库中的对象
      const target = userLoginDevices.find(({ id }) => id === device.id);

      currentLoginDevId = target.id;

      target.ip.push(ip);

      Object.assign(target, {
        // isLogin: true,
        date: Date.now(),
      });
    }

    // 如果此时已经有别的设备登录了，则通知已登录设备该登录的地理位置，并将其下线
    userLoginDevices.forEach((dev) => {
      const { id, isLogin } = dev;

      console.log("current dev_id", id, "isLogin", isLogin);

      /**
       * 1. 不同设备且登录的设备下线
       * 2. 同设备但不同 ip ,即 type === "insert" 时，暂时不管
       */
      if (id !== currentLoginDevId && isLogin) {
        io.to(socketMap.get(`${userId}_${id}`)).emit("forceLogout", device.geo);
        dev.isLogin = false;
        console.log(`已通知设备${id}, socketMapId: ${userId}_${id}，下线`);
      } else if (id === currentLoginDevId) {
        dev.isLogin = true;
      }
    });

    // 除了该用户，其他人都得下线
    userLoginDevices.forEach((dev) => (dev.isLogin = false));

    // 登录状态除了当前设备，其他都设置为未登录
    userLoginDevices.forEach((dev) => (dev.isLogin = dev.id === device.id));

    const { retryTimes, _id, isFrozen } = UserQuery;
    // 准备生成 cookie 中的 token
    // 在 playload 中增加 user的 _id, 用于 jwt 匹配成功后的用户信息查询
    const payload = { id: _id };

    // token 有效期（7天）
    const loginExpire = 7 * 24 * 60 * 60;

    // 生成 token
    const token = await authTools.genToken(payload, {
      expiresIn: loginExpire,
    });

    const commonCookieOption = {
      // 设置为 true 值后将无法通过 JS (document.cookie) 获取
      httpOnly: false,
      maxAge: loginExpire * 1000,
    };

    // 通过 Cookie 发送 token, 设置为相同的过期时间
    ctx.cookies.set("FORUM_t", `Bearer ${token}`, commonCookieOption);
    ctx.cookies.set("LOGIN_DATE", Date.now(), commonCookieOption);
    ctx.cookies.set("DEV_ID", device.id, commonCookieOption);

    const updateObj = { userLoginDevices };

    // 如果输错过, 则重置重试次数
    retryTimes < 5 && (updateObj.retryTimes = 5);
    // 如果被冻结, 则解冻
    isFrozen && (updateObj.isFrozen = false);
    // 设置为已登录的状态
    updateObj.isLogin = true;

    await UserModel.updateOne({ userId }, updateObj);

    // 响应
    ctx.body = createResponseBody(200, "登陆成功", {
      data: getUserInsensitiveInfo(UserQuery),
    });
  } else {
    ctx.error(400, `id ${id}不存在`);
  }
});

/**
 * 判断用户登录是否异常
 *  1. 地理位置中国家，省、市其中一个不同则异常
 *  2. 操作系统异常
 *  3. 客户端异常：浏览器不同，移动端或桌面端的类型与上次不同
 *  4. ip 异常，ip 不同，ipv4 => ipv6, ip 应该是一个 [], 当其他字段相同时，添加新的 ip
 *  @param { any[] } devices
 *  @param { any } device
 * */
function getUserExceptionFromDevices(devices, device) {
  const { geo: userCurrentGeo, os, isMobile, browser, ip } = device;
  // 第一次登录，则正常
  if (devices.length === 0) {
    return getRes(false, false);
  } else {
    for (const dev of devices) {
      const _geo = dev.geo;
      // 地理位置
      const isSameGeo = Object.keys(_geo).every(
        (area) => (userCurrentGeo[area] = _geo[area])
      );

      // 操作系统
      const isSameOs = dev.os === os;

      // 客户端
      const isSameClient = dev.isMobile === isMobile && dev.browser === browser;

      // IP
      const isExistIp =
        dev.ip.includes(ip) ||
        dev.ip.some((devip) => shallowEqualIp(devip, ip));

      const isSameDevice = isSameGeo && isSameOs && isSameClient;

      if (!isSameDevice) {
        // 设备不同, 继续找
        continue;
      } else if (isSameDevice && !isExistIp) {
        // 设备同，但 ip 不同
        return getRes(false, false, dev);
      } else if (isSameDevice && isExistIp) {
        // 全相同
        return getRes(false, true, dev);
      }
    }

    // 能走到这里说明设备当前登录信息不存在
    return getRes(true, false);
  }

  /**
   * @param { boolean } exp 是否异常
   * @param { boolean } ipIncludes 是否存在 ip
   * @param { any } device 设备同但 ip 不同的信息对象 | 完全匹配时的对象，需要他的 id
   */
  function getRes(exception, ipIncludes = false, device) {
    return { exception, ipIncludes, dbDev: device };
  }

  /**
   * @param { string } ip1 比对 ip
   * @param { string } ip2 目标 ip
   * 在局域网中，xxx.xxx.xxx.XXX 前24位通常相同，后 8 位通常会变更
   * 这种情况算相同
   */
  function shallowEqualIp(ip1, ip2) {
    const chunks1 = ip1.split(".").slice(0, 3);
    const chunks2 = ip2.split(".").slice(0, 3);

    return chunks1.every((segment, index) => segment === chunks2[index]);
  }
}

module.exports = router;
