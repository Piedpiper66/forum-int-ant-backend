const { createResponseBody } = require("./tool");

function throwExceptionBody(code, message, extra) {
  throw createResponseBody(code, message, extra);
}
module.exports = {
  throwExceptionBody,
  dealCatchedError(ctx, error) {
    console.log(error);
    if (error?.code) {
      const errorResponse = error;
      ctx.status = +error.code;
      ctx.body = errorResponse;
    } else {
      ctx.status = 500;
      ctx.body = createResponseBody(500, error && error.message);
    }
  },
  assertParams(params = [{ name: "", value: null, type: "", subType: "" }]) {
    if (!Array.isArray(params)) return;
    const primitiveTypes = ["string", "number", "boolean"];
    function getType(value) {
      return Object.prototype.toString.call(value).slice(8, -1).toLowerCase();
    }

    params.forEach(({ name, value, type, subType }) => {
      if (primitiveTypes.includes(type)) {
        ((!value) && typeof value !== type) &&
          throwExceptionBody(
            400,
            // prettier-ignore
            `invalid param ${name}, required ${type}, but receive type of ${
              type === "string" && typeof value === "string" && !value ? "''" :
              getType(value)
            }`
          );
      } else if (type === "array") {
        let errSubType = null;
        let isArray = null;
        // prettier-ignore
        (
          !value ||
          !(isArray = Array.isArray(value)) ||
          value.some((item) => ((errSubType = getType(item)), typeof item !== subType))
        ) && throwExceptionBody(400,
            // prettier-ignore
            `invalid param ${name}, required [${subType}], but ${ isArray ? 'contains' : 'receive' } type of ${
              !isArray ? getType(value) : `[${ errSubType }]`}
            `
          );
      } else if (type === "object") {
        (!value || getType(value) !== "object") &&
          Object.getOwnPropertyNames(value).length === 0 &&
          throwExceptionBody(
            400,
            // prettier-ignore
            `invalid param ${name}, required ${type}, but receive type of ${getType(value)}`
          );
      }
    });
  },
};
