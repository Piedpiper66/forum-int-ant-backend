const Koa = require("koa");
const app = new Koa();
const port = process.env.PORT || 3000;
const { mongourl } = require("./config/db");
const errorHandler = require("./middlewares/errorHandler");
const path = require("path");
const { io: socket } = require("./utils/socket");

socket.attach(app);

// 数据库
const mongoose = require("mongoose");
mongoose
  .connect(
    mongourl, //  数据库接口
    {
      useNewUrlParser: true,
      useUnifiedTopology: true, //  使用新的服务器发现和监视引擎,  因当前版本将在未来版本中移除.
      useFindAndModify: false, //  使正常使用 FindAnd..., FindByIdAnd... 之类方法
    }
  )
  .then(async (res) => {
    const currentConnection = res.connections[0];
    const DBName = currentConnection.name;
    console.info(`数据库 ${DBName} 连接成功!`);
    // const mongoInstance = currentConnection.getClient().db(DBName);
    // try {
    //   await mongoInstance.createCollection(SocketCollection, {
    //     capped: true,
    //     size: 1e6,
    //   });
    // } catch (e) {
    //   // collection already exists
    // }
    // const mongoCollection = mongoInstance.collection(SocketCollection);

    // io.adapter(createAdapter(mongoCollection));

    // // io.of("/topic").adapter.on("create-room", (room) => {
    // //   console.log(`room ${room} was created`);
    // // });
    // io.of("/").adapter.on("message", (data) => {
    //   console.log(data);
    // });
  })
  .catch((err) => {
    console.log(err.message || err);
  });

/** 第三方中间 **/
// 处理 ctx.request.body
app.use(
  require("koa-body")({
    multipart: true,
    formidable: {
      maxFileSize: 3 * 1024 * 1024,
    },
  })
);

// 静态资源管理
const koaStatic = require("koa-static");
app.use(
  koaStatic(path.join(__dirname + "/static/images"), {
    maxage: 1000 * 60 * 60 * 2,
    index: false,
    hidden: false,
    defer: false,
    setHeaders(ctx) {
      ctx.setHeader("Access-Control-Allow-Origin", "http://localhost:8080");
    },
  })
);

/** 自定义中间件 **/
app
  .use(async (ctx, next) => {
    ctx.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Content-Length, Authorization, Accept, X-Requested-With, Set-Cookies"
    );
    // 如果请求首部中包含 cookie，则设置 * 无效
    ctx.set("Access-Control-Allow-Origin", "http://localhost:8080");
    ctx.set("Access-Control-Allow-Credentials", true);
    ctx.set(
      "Access-Control-Allow-Methods",
      "PUT, POST, GET, DELETE, OPTIONS, TRACE"
    );
    ctx.set("X-Powered-By", "Koa2");
    if (["OPTIONS", "TRACE"].includes(ctx.method)) {
      ctx.body = 200;
    } else {
      await next();
    }
  })
  .use(errorHandler);

// 用户状态认证
const passport = require("koa-passport");
const jwtCharge = require("./config/passport");
app.use(passport.initialize());
jwtCharge(passport);

// 路由
const router = require("./routes/combination");
app.use(router.routes());

app.listen(port, () => {
  process.env.host = `localhost:${port}`;
  console.log(`koa 服务器已运行在端口:: ${port}`);
});
