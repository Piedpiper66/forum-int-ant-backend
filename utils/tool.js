const { createReadStream, createWriteStream } = require("fs");
const { rename, unlink } = require("fs/promises");
const cheerio = require("cheerio");
const path = require("path");
const UserModel = require("../models/User");

const imgPathRoot = __dirname.replace("utils", "static\\images\\");
function getImgPath(dir) {
  return imgPathRoot + dir;
}

// 草稿临时存储路径
const draftImgPath = getImgPath("temp");

// 用户头像路径
const userAvatarPath = getImgPath("u");

// 主题图片存储路径
const topicImgPath = getImgPath("t");

// 用户背景图片存储路径
const bgImgPath = getImgPath("bg");

const UserBasic = require("../models/User/baisc");

/**
 * 深拷贝
 * @param { {
 *  key: string,
 *  func: () => any
 * }[] } rules 可以对某些特殊对象进行特殊处理
 */
function deepClone(obj, rules) {
  let objClone = Array.isArray(obj) ? [] : {};

  if (obj && typeof obj === "object") {
    for (let key of Object.keys(obj)) {
      //判断 obj子元素是否为对象，如果是，递归复制
      if (obj[key] && typeof obj[key] === "object") {
        let target;
        if (rules.length && (target = rules.find((v) => v.key === key))) {
          objClone[key] = target?.func(obj[key]);
        } else {
          objClone[key] = deepClone(obj[key], rules);
        }
      } else {
        //如果不是，简单复制
        objClone[key] = obj[key];
      }
    }
  }
  return objClone;
}

module.exports = {
  createResponseBody(code, message, extra = {}) {
    return {
      code,
      data: null,
      message,
      ...extra,
    };
  },
  getFilterObj(object = {}, sensitiveList, wantedList) {
    const result = {};
    const doc = object._doc || object;
    const docKeys = Object.keys(doc);

    for (const key of docKeys) {
      if (Array.isArray(wantedList)) {
        if (wantedList.includes(key)) {
          result[key] = object[key];
        }
      } else if (Array.isArray(sensitiveList)) {
        if (!sensitiveList.includes(key)) {
          result[key] = object[key];
        }
      }
    }
    return result;
  },
  getUserInsensitiveInfo(userProfile = {}) {
    const neededKeys = Object.keys(UserBasic).concat(
      "user_draft",
      "userLoginDevices",
      "userId"
    );
    return neededKeys.reduce(
      (filtered, key) => ((filtered[key] = userProfile[key]), filtered),
      {}
    );
  },
  /**
   *  生成或更新一张图片
   *  @param imageSourceBufferPath: 图片字节流临时存储路径
   *  @param imageTargetBufferPath: 图片字节流写入路径
   * */
  generateOrUpdateImage: (
    imageSourceBufferPath = "",
    imageTargetBufferPath = ""
  ) => {
    return new Promise((resolve, reject) => {
      if (!imageSourceBufferPath && !imageTargetBufferPath) {
        reject("empty source or target path!");
        return false;
      }
      const reader = createReadStream(imageSourceBufferPath);
      const upStream = createWriteStream(imageTargetBufferPath);

      reader
        .pipe(upStream, { end: true })
        .on("error", (err) => reject(err))
        .on("finish", () => {
          console.log("图片已生成");
          resolve(true);
        });
    });
  },
  draftImgPath,
  userAvatarPath,
  topicImgPath,
  bgImgPath,
  /**
   * 处理用户上传的图片，以及 markdown 中 `<img />` 的 `src`
   * @param { string[] } uploadTempImgs
   * @param { string } content
   * @param { string } markdown
   */
  async copeUploadFiles(uploadTempImgs, content, markdown) {
    // 如果存在上传的图片
    if (uploadTempImgs.length > 0) {
      // 只存在于临时文件夹中的图片
      const rmFiles = [];
      // 同时存在于话题中的图片
      const topicFiles = [];
      // 分类
      // 由于用于可能上传了临时文件之后，又在没发送话题的情况下删掉了，而服务器中的文件还在
      // 此时需要把之前的临时文件删除
      uploadTempImgs.forEach((filename) => {
        const isFileExist = content.includes(filename);
        !isFileExist ? rmFiles.push(filename) : topicFiles.push(filename);
      });
      // 将存在于文章中的临时图片文件移动到话题图片文件夹下
      const renameQuene = topicFiles.map((filename) =>
        rename(
          path.resolve(draftImgPath, filename),
          path.resolve(topicImgPath, filename)
        )
      );
      await Promise.all(renameQuene);

      // 删除临时上传的图片中未出现在上传的文章中的图片
      if (rmFiles.length > 0) {
        const removeQuene = rmFiles.map((filename) =>
          unlink(path.resolve(draftImgPath, filename))
        );
        await Promise.all(removeQuene);
      }
    }

    let replacedContent = "";
    {
      let $ = cheerio.load(markdown, null, false);

      // 将 src 中的 /temp 置换为 /t
      $("img").each((i, el) => {
        const prodSrc = $(el).attr("src").replace("/temp/", "/t/");
        $(el).attr("src", "");
        $(el).attr("data-src", prodSrc);
        $(el).attr("alt", "");
      });
      // 转换后的文本
      replacedContent = $.html();

      $ = null;
    }

    return replacedContent;
  },
  /**
   * 用于判断用户更新是否完成
   * @param { { nModified: 0 | 1, ok: 0 | 1 } | { nModified: 0 | 1, ok: 0 | 1 }[] } result
   */
  isUpdated(result) {
    if (Array.isArray(result)) {
      return result.every(({ nModified, ok }) => nModified && ok);
    } else {
      return !!(result.nModified && result.ok);
    }
  },
  deepClone,
  /**
   * @param { number[] } users
   */
  async getUserLoginDevId(users) {
    const query = await UserModel.find(
      { userId: { $in: users }, "userLoginDevices.isLogin": true },
      {
        "userLoginDevices.id": 1,
        "userLoginDevices.isLogin.$": 1,
        userId: 1,
        _id: 0,
      },
      {
        lean: true,
      }
    );

    return query.map(
      ({ userId, userLoginDevices }) => `${userId}_${userLoginDevices[0].id}`
    );
  },
};
