const Router = require("koa-router");
const router = new Router();
const UserModel = require("../../models/User");
const CategoryModel = require("../../models/Category");
const exception = require("../../utils/exception");
const { createResponseBody, getFilterObj } = require("../../utils/tool");
const { blockIfNotAdmin } = require("../../middlewares/adminVetify");

// router.use(blockIfNotAdmin);

router
  .post("/del/category", async (ctx) => {
    const { category } = ctx.request.body;
    exception.assertParams([
      { name: "category", value: category, type: "string" },
    ]);
    const result = await CategoryModel.remove({ name: category });

    ctx.body = createResponseBody(200, "删除成功", { data: result });
  })
  .post("/del/tags", async (ctx) => {
    const { category, tags } = ctx.request.body;

    exception.assertParams([
      { name: "category", value: category, type: "string" },
      { name: "tags", value: tags, type: "array", subType: "string" },
    ]);

    const categoryExist = await CategoryModel.exists({ name: category });
    !categoryExist && ctx.error(400, `category ${category} is not exist`);

    const removeResult = await CategoryModel.updateOne(
      { name: category },
      { $pullAll: { tags } }
    );

    ctx.body = createResponseBody(200, "删除成功", { data: removeResult });
  })
  .post("/del/reply", async (ctx) => {
    ctx.body = "213";
  })
  .post("/del/user", async (ctx) => {
    ctx.body = "213";
  });

module.exports = router;
