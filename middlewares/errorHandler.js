module.exports = async (ctx, next) => {
  try {
    ctx.error = (code, message, extra) => {
      ctx.throw({ code, data: null, message, ...extra });
    };
    await next();
  } catch (e) {
    ctx.response.body = e.code
      ? { ...e }
      : {
          code: e.status || 500,
          data: null,
          message: e.message || "服务器错误",
        };
  }
};
