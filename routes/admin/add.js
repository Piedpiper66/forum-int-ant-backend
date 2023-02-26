const Router = require("koa-router");
const router = new Router();
// const UserModel = require("../../models/User");
const CategoryModel = require("../../models/Category");
const {
  throwExceptionBody,
  dealCatchedError,
  assertParams,
} = require("../../utils/exception");
const { createResponseBody, getFilterObj } = require("../../utils/tool");
const { decryptToken } = require("../../utils/authPromise");
const { blockIfNotAdmin } = require("../../middlewares/adminVetify");

// router.use(blockIfNotAdmin);

router
  .post("/add/category", async (ctx) => {
    const { name, description, tags } = ctx.request.body;

    assertParams([
      { name: "name", value: name, type: "string" },
      { name: "description", value: description, type: "string" },
      { name: "tags", value: tags, type: "array" },
    ]);

    const isCategortExist = await CategoryModel.exists({ name });
    isCategortExist && ctx.error(400, `category "${name}" has already exist`);
    const schema = { name, description, tags };
    await new CategoryModel(schema).save();
    ctx.body = createResponseBody(200, "category saved!", { data: schema });
  })
  .post("/add/tags", async (ctx) => {
    const { category, tags } = ctx.request.body;

    assertParams([
      { name: "category", value: category, type: "string" },
      { name: "tags", value: tags, type: "array" },
    ]);

    const categroyExist = await CategoryModel.findOne(
      { name: category },
      { tags: 1 }
    );

    !categroyExist &&
      throwExceptionBody(400, `category ${category} is not exist`);

    const mergedTags = [...new Set(tags.concat(categroyExist.tags))];
    // console.log(mergedTags);

    const result = await CategoryModel.updateOne(
      { name: category },
      { $set: { tags: mergedTags } }
    );

    ctx.body = createResponseBody(200, "更新成功", {
      data: result,
      merged: mergedTags,
    });
  })
  .post("/add/categoryField", async (ctx) => {
    const { category, fields } = ctx.request.body;
    console.log(fields);
    assertParams([
      { name: "category", value: category, type: "string" },
      { name: "fields", value: fields, type: "array", subType: "object" },
    ]);

    const result = await CategoryModel.exists({ name: category });

    !result && ctx.error(400, `category ${category} is not exist`);

    const merged = fields.reduce(
      (pre, next) => ((pre[next.key] = next.value), pre),
      {}
    );

    const updateRes = await CategoryModel.updateOne(
      { name: category },
      { $set: merged }
    );

    ctx.body = updateRes;
  });

module.exports = router;
