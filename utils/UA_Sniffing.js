/**
 *    截取自 Vue 2.6.14 第 530 行
 */
const inBrowser = typeof window !== "undefined";
const UA = inBrowser && window.navigator.userAgent.toLowerCase();
const isIE = UA && /msie|trident/.test(UA);
const isIE9 = UA && UA.indexOf("msie 9.0") > 0;
const isEdge = UA && UA.indexOf("edge/") > 0;
const isAndroid =
  (UA && UA.indexOf("android") > 0) || weexPlatform === "android";
const isIOS = (UA && /iphone|ipad|ipod|ios/.test(UA)) || weexPlatform === "ios";
const isChrome = UA && /chrome\/\d+/.test(UA) && !isEdge;
const isFF = UA && UA.match(/firefox\/(\d+)/);

const isMobile =
  isAndroid ||
  isIOS ||
  (window.navigator.userAgentData && window.navigator.userAgentData.mobile);

export default {
  UA,
  isIE,
  isIE9,
  isEdge,
  isAndroid,
  isIOS,
  isChrome,
  isPhantomJS,
  isFF,
  isMobile,
};
