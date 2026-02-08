const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: {
        origin: ["https://privchat-pi.vercel.app", "http://localhost:3000"],
        methods: ["GET", "POST"]
    }
});

app.use(express.static("public"));

const rooms = {};
// roomName => { token, ownerSocket, users: { username: socketId }, pending: { socketId: username } }

// 🔹 ADDED: Message status store
const messageStatus = {};
// messageId => { room, senderSocket, senderUsername, deliveredTo: [], seenBy: [] }

// Helper: get username by socket id
function getUsernameBySocket(room, socketId) {
    const roomData = rooms[room];
    if (!roomData) return null;
    for (const user in roomData.users) {
        if (roomData.users[user] === socketId) return user;
    }
    return null;
}

// 🔹 ADDED: Broadcast active users to room
function broadcastRoomUsers(room) {
    if (!rooms[room]) return;
    const userList = Object.keys(rooms[room].users);
    io.to(room).emit("roomUsers", { users: userList });
}

io.on("connection", socket => {

    // ================= JOIN ROOM =================
    socket.on("joinRoom", ({ username, room, token }) => {
        if (!username || !room || !token) {
            socket.emit("warningMsg", "All fields are required!");
            return;
        }

        if (!rooms[room]) {
            rooms[room] = {
                token,
                ownerSocket: socket.id,
                users: { [username]: socket.id },
                pending: {}
            };
            socket.join(room);
            socket.emit("privateMsg", "ROOM OWNER: You created the room.");
            broadcastRoomUsers(room);
            return;
        }

        const roomData = rooms[room];

        if (roomData.token !== token) {
            socket.emit("warningMsg", "Room token invalid. Check your room name and token.");
            return;
        }

        if (roomData.users[username]) {
            socket.emit("warningMsg", "This username is already active in the room.");
            return;
        }

        roomData.pending[socket.id] = username;
        io.to(roomData.ownerSocket).emit("joinRequest", {
            username,
            socketId: socket.id
        });

        socket.emit("privateMsg", "Waiting for owner approval...");
    });

    // ================= APPROVE / REJECT USER =================
    socket.on("approveUser", ({ room, socketId }) => {
        const roomData = rooms[room];
        if (!roomData || socket.id !== roomData.ownerSocket) return;

        const username = roomData.pending[socketId];
        if (!username) return;

        roomData.users[username] = socketId;
        delete roomData.pending[socketId];

        io.sockets.sockets.get(socketId)?.join(room);
        io.to(socketId).emit("privateMsg", "Owner approved your entry.");
        broadcastRoomUsers(room);
    });

    socket.on("rejectUser", ({ room, socketId }) => {
        const roomData = rooms[room];
        if (!roomData || socket.id !== roomData.ownerSocket) return;

        delete roomData.pending[socketId];
        io.to(socketId).emit("warningMsg", "Owner rejected your request.");
        io.sockets.sockets.get(socketId)?.disconnect();
    });

    // ================= SEND MESSAGE =================
    socket.on("privateMsg", ({ room, message, messageId }) => {
        if (!rooms[room]) return;

        const senderUsername = getUsernameBySocket(room, socket.id);

        // store message status
        messageStatus[messageId] = {
            room,
            senderSocket: socket.id,
            senderUsername,
            deliveredTo: [],
            seenBy: []
        };

        // send to other users only
        socket.to(room).emit("privateMsg", { message, messageId, sender: socket.id });

        // mark delivered to others
        for (const user in rooms[room].users) {
            if (rooms[room].users[user] !== socket.id) {
                messageStatus[messageId].deliveredTo.push(user);
            }
        }

        // notify sender
        socket.emit("messageDelivered", {
            messageId,
            deliveredTo: messageStatus[messageId].deliveredTo
        });
    });

    // ================= MESSAGE READ =================
    socket.on("messageRead", ({ room, messageId, username }) => {
        const msg = messageStatus[messageId];
        if (!msg || msg.room !== room) return;

        if (!msg.seenBy.includes(username)) {
            msg.seenBy.push(username);
        }

        const totalReceivers = Object.keys(rooms[room].users).length - 1;

        io.to(msg.senderSocket).emit("messageSeen", {
            messageId,
            seenBy: msg.seenBy,
            allSeen: msg.seenBy.length === totalReceivers
        });
    });

    // ================= DELETE MESSAGE =================
    socket.on("deleteMsg", ({ room, messageId }) => {
        if (!rooms[room]) return;
        const msg = messageStatus[messageId];
        if (!msg) return;

        // Only sender can delete
        if (msg.senderSocket !== socket.id) return;

        // remove from server store
        delete messageStatus[messageId];

        // notify all users including sender
        io.to(room).emit("deleteMsg", { messageId });
    });

    // ================= EDIT MESSAGE =================
    socket.on("editMsg", ({ room, messageId, newText }) => {
        if (!rooms[room]) return;
        const msg = messageStatus[messageId];
        if (!msg) return;

        // Only sender can edit
        if (msg.senderSocket !== socket.id) return;

        // Broadcast change
        io.to(room).emit("editMsg", { messageId, newText });
    });

    // ================= TYPING =================
    socket.on("typing", (data) => {
        if (!rooms[data.room]) return;
        socket.to(data.room).emit("typing", data);
    });

    socket.on("stopTyping", (data) => {
        if (!rooms[data.room]) return;
        socket.to(data.room).emit("stopTyping");
    });

    // ================= DISCONNECT =================
    socket.on("disconnect", () => {
        for (const room in rooms) {
            const r = rooms[room];

            for (const user in r.users) {
                if (r.users[user] === socket.id) {
                    delete r.users[user];
                    broadcastRoomUsers(room);
                }
            }

            if (r.ownerSocket === socket.id) {
                io.to(room).emit("warningMsg", "Room owner left. Room closed.");
                delete rooms[room];
            }
        }
    });

});

http.listen(3000, () =>
    console.log("Server running on http://localhost:3000")
);
