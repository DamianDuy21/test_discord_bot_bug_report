const { Client, GatewayIntentBits, Partials } = require("discord.js");
const express = require("express");
require("dotenv").config();

const app = express();
const port = 3000;

// Thiết lập web server đơn giản để giữ bot online
app.get("/", (req, res) => res.send("Bot is running!"));
app.listen(port, () =>
  console.log(`Web server listening at http://localhost:${port}`)
);

// ===================== START BOT CODE =====================

let msgArray = [];
let isDeletingFromDoneCommand = false;
let isDeletingFromUpdateCommand = false;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Danh sách các kênh mà bot sẽ gửi tin nhắn tới
const CHANNELS = {
  bug_pending: process.env.CHANNEL_BUG_PENDING,
  bug_thao: process.env.CHANNEL_BUG_THAO,
  bug_long: process.env.CHANNEL_BUG_LONG,
  bug_done: process.env.CHANNEL_BUG_DONE,
};

// Chuyển đổi chuỗi regex từ .env thành đối tượng RegExp
const bugPendingRegex = new RegExp(process.env.BUG_PENDING_REGEX.slice(1, -1));
const bugThaoRegex = new RegExp(process.env.BUG_THAO_REGEX.slice(1, -1));
const bugLongRegex = new RegExp(process.env.BUG_LONG_REGEX.slice(1, -1));
const bugDoneRegex = new RegExp(process.env.BUG_DONE_REGEX.slice(1, -1));

client.once("ready", () => {
  console.log(`Đã đăng nhập thành công với tên: ${client.user.tag}`);
});

// Lắng nghe sự kiện tạo mới tin nhắn
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Kiểm tra các từ khóa để quyết định gửi tới kênh nào
  const sendToChannels = [];

  if (bugPendingRegex.test(message.content))
    sendToChannels.push(CHANNELS.bug_pending);
  if (bugThaoRegex.test(message.content))
    sendToChannels.push(CHANNELS.bug_thao);
  if (bugLongRegex.test(message.content))
    sendToChannels.push(CHANNELS.bug_long);

  const doneMatch = message.content.match(bugDoneRegex);

  if (doneMatch) {
    await handleDoneCommand(message, doneMatch[1], null);
    return;
  }

  // Nếu không có từ khóa nào phù hợp, dừng lại
  if (sendToChannels.length === 0) return;

  await handleBugReport(message, sendToChannels, null);
});

// Hàm xử lý lệnh `#done`
async function handleDoneCommand(message, doneId, currentObjID) {
  const foundReport = msgArray.find((obj) => obj.ID === parseInt(doneId));

  if (!foundReport) {
    console.log(`Không tìm thấy báo cáo với ID: ${doneId}`);
    return;
  }

  const randomId = Math.floor(Math.random() * 1000000);
  const messageRefs = [{ channelId: message.channelId, id: message.id }];

  const doneChannel = await client.channels.fetch(process.env.CHANNEL_BUG_DONE);
  if (!doneChannel) {
    console.log("Không tìm thấy channel bug_done");
    return;
  }

  let originalContent = "";
  let attachments = [];
  const originalMessageRefs = foundReport.ref;

  // Lấy channelId của tin nhắn `#done`
  const currentChannelId = message.channelId;

  // Tìm tin nhắn đầu tiên có cùng channelId với tin nhắn `#done`
  const matchingRef = originalMessageRefs.find(
    (ref) => ref.channelId === currentChannelId
  );

  if (matchingRef) {
    try {
      const channel = await client.channels.fetch(matchingRef.channelId);
      const originalMessage = await channel.messages.fetch(matchingRef.id);
      originalContent = originalMessage.content;
      // Lấy attachments từ tin nhắn gốc (nếu có)
      if (originalMessage.attachments.size > 0) {
        attachments = [...originalMessage.attachments.values()];
      }
    } catch (error) {
      console.error(
        `Không thể lấy tin nhắn với ID: ${matchingRef.id} tại channel ${matchingRef.channelId}`
      );
    }
  } else {
    console.log(`Không tìm thấy tin nhắn nào trong cùng channel với #done`);
  }

  let doneReportMessage = "";
  if (currentObjID) {
    doneReportMessage = `**Done report từ ${message.channel.name} bởi ${
      message.author
    }**:\n**ID: ${currentObjID}**\n**__________**\n${originalContent.trim()}`;
  } else {
    doneReportMessage = `**Done report từ ${message.channel.name} bởi ${
      message.author
    }**:\n**ID: ${randomId}**\n**__________**\n${originalContent.trim()}`;
  }

  const doneResponse = await doneChannel.send({
    content: doneReportMessage,
    files: attachments.length > 0 ? attachments.map((att) => att.url) : [],
  });

  // Lưu tin nhắn ở channel "bug_done" vào danh sách `ref`
  messageRefs.push({
    channelId: doneResponse.channelId,
    id: doneResponse.id,
  });

  if (currentObjID) {
    msgArray = msgArray.filter((item) => item.ID !== parseInt(currentObjID));
    msgArray.push({ ID: currentObjID, ref: messageRefs });
  } else {
    msgArray.push({ ID: randomId, ref: messageRefs });
  }

  // Tạm thời vô hiệu hóa sự kiện `messageDelete`
  isDeletingFromDoneCommand = true;

  // Xóa các tin nhắn trong channel `bug_pending`
  await Promise.all(
    originalMessageRefs.map(async (ref) => {
      if (ref.channelId === process.env.CHANNEL_BUG_PENDING) {
        try {
          const channelToDelete = await client.channels.fetch(ref.channelId);
          const messageToDelete = await channelToDelete.messages.fetch(ref.id);
          await messageToDelete.delete();
          console.log(`Đã xóa tin nhắn với ID: ${ref.id}`);
        } catch (error) {
          console.error(`Lỗi khi xóa tin nhắn ID: ${ref.id}`);
        }
      }
    })
  );

  // Reset flag sau khi hoàn thành việc xóa
  isDeletingFromDoneCommand = false;

  // Xóa tin nhắn bug_pending trong msgArray
  const reportIndex = msgArray.findIndex((obj) => obj.ID === parseInt(doneId));
  if (reportIndex !== -1) {
    const reportObj = msgArray[reportIndex];
    reportObj.ref = reportObj.ref.filter(
      (msg) => msg.channelId !== process.env.CHANNEL_BUG_PENDING
    );

    if (reportObj.ref.length === 0) {
      msgArray.splice(reportIndex, 1);
    }
  }
  console.log(msgArray);
}

// Hàm xử lý báo cáo bug
async function handleBugReport(message, sendToChannels, currentObjID) {
  const randomId = Math.floor(Math.random() * 1000000);
  const messageRefs = [{ channelId: message.channelId, id: message.id }];

  await Promise.all(
    sendToChannels.map(async (channelId) => {
      const bugReportChannel = await client.channels.fetch(channelId);
      if (bugReportChannel) {
        const attachments = message.attachments.map(
          (attachment) => attachment.url
        );
        const contentWithoutHashtags = message.content
          .replace(/#\S+|<@\d+>/g, "")
          .trim();
        let reportMessage = "";

        if (currentObjID) {
          reportMessage = `**Bug report từ ${message.channel.name} bởi ${
            message.author
          }**:\n**ID: ${currentObjID}**\n${
            contentWithoutHashtags || "(Không có nội dung văn bản)"
          }`;
        } else {
          reportMessage = `**Bug report từ ${message.channel.name} bởi ${
            message.author
          }**:\n**ID: ${randomId}**\n${
            contentWithoutHashtags || "(Không có nội dung văn bản)"
          }`;
        }

        const messageResponse = await bugReportChannel.send({
          content: reportMessage,
          files: attachments,
        });

        messageRefs.push({
          channelId: messageResponse.channelId,
          id: messageResponse.id,
        });
      }
    })
  );

  if (currentObjID) {
    msgArray = msgArray.filter((item) => item.ID !== parseInt(currentObjID));
    msgArray.push({ ID: currentObjID, ref: messageRefs });
  } else {
    msgArray.push({ ID: randomId, ref: messageRefs });
  }
  console.log(msgArray);
}

// Lắng nghe sự kiện xóa tin nhắn
// Tạo một Set để lưu trữ các messageId đã xóa để tránh vòng lặp vô hạn
const deletedMessagesSet = new Set();

client.on("messageDelete", async (deletedMessage) => {
  // Nếu đang xóa từ lệnh #done, bỏ qua sự kiện này
  if (isDeletingFromDoneCommand || isDeletingFromUpdateCommand) return;

  const deletedChannelId = deletedMessage.channelId;
  const deletedMessageId = deletedMessage.id;

  // Nếu tin nhắn vừa bị xóa nằm trong Set, bỏ qua xử lý
  if (deletedMessagesSet.has(deletedMessageId)) {
    deletedMessagesSet.delete(deletedMessageId);
    return;
  }

  for (const obj of msgArray) {
    const foundRef = obj.ref.find(
      (ref) => ref.channelId === deletedChannelId && ref.id === deletedMessageId
    );

    if (foundRef) {
      for (const ref of obj.ref) {
        if (ref.channelId === deletedChannelId && ref.id === deletedMessageId) {
          obj.ref = obj.ref.filter(
            (item) =>
              item.channelId !== deletedChannelId ||
              item.id !== deletedMessageId
          );
        } else {
          try {
            const channel = await client.channels.fetch(ref.channelId);
            const messageToDelete = await channel.messages.fetch(ref.id);

            obj.ref = obj.ref.filter(
              (item) => item.channelId !== ref.channelId || item.id !== ref.id
            );

            deletedMessagesSet.add(ref.id);

            await messageToDelete.delete();
            console.log(
              `Đã xóa tin nhắn với ID (delete): ${ref.id} tại channel ${ref.channelId}`
            );
          } catch (error) {
            console.error(
              `Lỗi khi xóa tin nhắn với ID (delete): ${ref.id} tại channel ${ref.channelId}:`,
              error
            );
          }
        }
      }

      if (obj.ref.length === 0) {
        msgArray = msgArray.filter((item) => item.ID !== obj.ID);
      }

      console.log(msgArray);
    }
  }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (
    newMessage.author.bot ||
    (oldMessage.content === newMessage.content &&
      oldMessage.attachments.size === newMessage.attachments.size)
  )
    return;

  // Đánh dấu rằng đang xóa từ lệnh `messageUpdate` để tránh vòng lặp vô hạn
  isDeletingFromUpdateCommand = true;

  let currentObjID = null;

  // Sử dụng logic tương tự như `messageDelete` để xóa tất cả các tin nhắn liên quan trong `msgArray`
  const updatedChannelId = newMessage.channelId;
  const updatedMessageId = newMessage.id;

  // Duyệt qua từng báo cáo trong `msgArray`
  for (const obj of msgArray) {
    const foundRef = obj.ref.find(
      (ref) => ref.channelId === updatedChannelId && ref.id === updatedMessageId
    );

    if (foundRef) {
      currentObjID = obj.ID;
      for (const ref of obj.ref) {
        if (ref.channelId !== updatedChannelId && ref.id !== updatedMessageId) {
          try {
            const channel = await client.channels.fetch(ref.channelId);
            const messageToDelete = await channel.messages.fetch(ref.id);

            // Xóa tin nhắn khỏi mảng `ref` của báo cáo
            obj.ref = obj.ref.filter(
              (item) => item.channelId !== ref.channelId && item.id !== ref.id
            );

            deletedMessagesSet.add(ref.id);

            // Xóa tin nhắn trên Discord
            await messageToDelete.delete();
            console.log(
              `Đã xóa tin nhắn với ID (update): ${ref.id} tại channel ${ref.channelId}`
            );
          } catch (error) {
            console.error(
              `Lỗi khi xóa tin nhắn với ID (update): ${ref.id} tại channel ${ref.channelId}:`,
              error
            );
          }
        }
      }

      // Xóa báo cáo khỏi `msgArray` nếu không còn tin nhắn nào
      if (obj.ref.length === 0) {
        msgArray = msgArray.filter((item) => item.ID !== obj.ID);
      }
    }
  }

  // Reset lại flag sau khi hoàn thành xóa
  isDeletingFromUpdateCommand = false;

  console.log("msgArray sau khi cập nhật:", msgArray);

  // Kiểm tra các từ khóa để quyết định gửi tới kênh nào
  const sendToChannels = [];

  if (bugPendingRegex.test(newMessage.content))
    sendToChannels.push(CHANNELS.bug_pending);
  if (bugThaoRegex.test(newMessage.content))
    sendToChannels.push(CHANNELS.bug_thao);
  if (bugLongRegex.test(newMessage.content))
    sendToChannels.push(CHANNELS.bug_long);

  // Kiểm tra nếu tin nhắn mới có hashtag #done
  const doneMatch = newMessage.content.match(bugDoneRegex);
  if (doneMatch) {
    await handleDoneCommand(newMessage, doneMatch[1], currentObjID);
    return;
  }

  // Nếu không có từ khóa nào phù hợp, dừng lại
  if (sendToChannels.length === 0) return;

  await handleBugReport(newMessage, sendToChannels, currentObjID);
});

// Đăng nhập bot
client.login(process.env.DISCORD_BOT_TOKEN);
