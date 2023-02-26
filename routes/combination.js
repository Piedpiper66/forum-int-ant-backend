const Router = require("koa-router");
const router = new Router();
const fs = require("fs");
const { resolve } = require("path");

// 获取当前目录下的所有目录
const FileList = fs.readdirSync(__dirname, { withFileTypes: true });
const directories = FileList.filter((file) => file.isDirectory());

// let count = 0;

// 遍历各目录下的所有文件, 并组合成路由中间件数组, 分别注册到当前 router 实例下
directories.forEach((directory) => {
  const { name } = directory;
  const moduleRootPath = resolve(__dirname, name);
  const filenames = fs.readdirSync(moduleRootPath);

  const middlewares = filenames.map((filename, index) => {
    const some = require(resolve(moduleRootPath, filename)).routes();
    // count += some.router.stack.length;
    return some;
  });

  router.use(`/${name}`, ...middlewares);
});

module.exports = router;
