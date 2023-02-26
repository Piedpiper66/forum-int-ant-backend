// del admin, add admin
const Router = require("koa-router");
const router = new Router();

const { blockIfNotAdmin } = require("../../middlewares/adminVetify");

const CategoryModel = require("../../models/Category");
const { createResponseBody } = require("../../utils/tool");

router.use(blockIfNotAdmin)

router
  .post("/del/admin", async (ctx, next) => {

    ctx.body = "tag!";
  })
  .post("/del/user", async (ctx, next) => {
    ctx.body = "tag!";
  });

module.exports = router;
