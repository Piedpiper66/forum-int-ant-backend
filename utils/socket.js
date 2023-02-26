const IO = require("koa-socket-2");
const UserModal = require("../models/User");
// 用于存放对用 userId 用户对应的 socket
const user_socket_Map = new Map();

const io = new IO({
  ioOptions: {
    cors: { origin: "*" },
  },
});

io.on("conn", ({ data: userId, socket }) => {
  // 存储 userId 和 socketId 的映射，以便于单独发送
  user_socket_Map.set(userId, socket.id);

  // console.log("map_get", userId, socket.id, user_socket_Map);

  // 断开链接应该删除，英文该用户重连值后 socketId 会改变
  socket.on("disconnect", () => {
    user_socket_Map.delete(userId);

    // console.log("map_delete", userId, socket.id, user_socket_Map);
  });
});

// 还可以收集用户更多
io.on("updateThemeViewTime", async ({ data, socket }) => {
  const { id, user, date } = data;

  await UserModal.updateOne(
    { userId: user, "subscribes.themeId": id },
    {
      $set: { "subscribes.$.lastViewTime": date },
    }
  );
});
123;

module.exports = {
  io,
  socketMap: user_socket_Map,
};
