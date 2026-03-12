const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    maxHttpBufferSize: 5e7,
    pingTimeout: 60000,
    cors: {
        origin: ["https://privchat-pi.vercel.app"],
        methods: ["GET", "POST"]
    }
});

app.use(express.static("public"));

const rooms = {};
const messageStatus = {};

// Track sockets that explicitly logged out — ignore their disconnect event
const loggedOutSockets = new Set();

function getUsernameBySocket(room, socketId) {
    const roomData = rooms[room];
    if (!roomData) return null;
    for (const user in roomData.users) {
        if (roomData.users[user] === socketId) return user;
    }
    return null;
}

function broadcastRoomUsers(room) {
    if (!rooms[room]) return;
    const userList = Object.keys(rooms[room].users);
    io.to(room).emit("roomUsers", { users: userList });
}

// Central cleanup: remove socket from all rooms
function removeSocketFromRooms(socketId) {
    for (const room in rooms) {
        const r = rooms[room];

        // Remove from pending
        for (const sid in r.pending) {
            if (sid === socketId) delete r.pending[sid];
        }

        // Remove from users
        for (const user in r.users) {
            if (r.users[user] === socketId) {
                delete r.users[user];
                broadcastRoomUsers(room);
                break;
            }
        }

        // If owner left, close the room
        if (r.ownerSocket === socketId) {
            io.to(room).emit("warningMsg", "Room owner left. Room closed.");
            delete rooms[room];
        }
    }
}

io.on("connection", socket => {

    // ===== EXPLICIT LOGOUT =====
    // Client emits this before clearing localStorage and redirecting
    socket.on("logout", () => {
        loggedOutSockets.add(socket.id);
        removeSocketFromRooms(socket.id);
        socket.disconnect(true);
    });

    // ===== JOIN ROOM =====
    socket.on("joinRoom", ({ username, room, token }) => {
        if (!username || !room || !token) {
            socket.emit("warningMsg", "All fields are required!");
            return;
        }

        // Create room if it doesn't exist
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

        // User already in room (session takeover / reconnect)
        if (roomData.users[username]) {
            const oldSocketId = roomData.users[username];

            if (oldSocketId !== socket.id) {
                // Silently kill old socket (same person, no warning needed)
                const oldSock = io.sockets.sockets.get(oldSocketId);
                if (oldSock) {
                    loggedOutSockets.add(oldSocketId); // prevent disconnect handler from firing
                    oldSock.disconnect(true);
                }

                // Transfer ownership if old socket was owner
                if (roomData.ownerSocket === oldSocketId) {
                    roomData.ownerSocket = socket.id;
                }

                roomData.users[username] = socket.id;
            }

            socket.join(room);
            socket.emit("privateMsg", "Welcome back, " + username + "!");
            broadcastRoomUsers(room);
            return;
        }

        // New user — needs owner approval
        roomData.pending[socket.id] = username;
        io.to(roomData.ownerSocket).emit("joinRequest", { username, socketId: socket.id });
        socket.emit("privateMsg", "Waiting for owner approval...");
    });

    // ===== APPROVE / REJECT =====
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
        io.sockets.sockets.get(socketId)?.disconnect(true);
    });

    // ===== MESSAGING =====
    socket.on("privateMsg", ({ room, message, messageId }) => {
        if (!rooms[room]) return;

        const senderUsername = getUsernameBySocket(room, socket.id);
        messageStatus[messageId] = {
            room,
            senderSocket: socket.id,
            senderUsername,
            deliveredTo: [],
            seenBy: []
        };

        socket.to(room).emit("privateMsg", { message, messageId, sender: socket.id });

        for (const user in rooms[room].users) {
            if (rooms[room].users[user] !== socket.id) {
                messageStatus[messageId].deliveredTo.push(user);
            }
        }

        socket.emit("messageDelivered", { messageId, deliveredTo: messageStatus[messageId].deliveredTo });
    });

    socket.on("messageRead", ({ room, messageId, username }) => {
        const msg = messageStatus[messageId];
        if (!msg || msg.room !== room) return;

        if (!msg.seenBy.includes(username)) msg.seenBy.push(username);

        const totalReceivers = Object.keys(rooms[room].users).length - 1;
        const currentSenderSocket = rooms[room].users[msg.senderUsername];
        if (currentSenderSocket) {
            io.to(currentSenderSocket).emit("messageSeen", {
                messageId,
                seenBy: msg.seenBy,
                allSeen: msg.seenBy.length === totalReceivers
            });
        }
    });

    socket.on("deleteMsg", ({ room, messageId }) => {
        if (!rooms[room]) return;
        const msg = messageStatus[messageId];
        const senderUsername = getUsernameBySocket(room, socket.id);
        if (!msg || msg.senderUsername !== senderUsername) return;
        delete messageStatus[messageId];
        io.to(room).emit("deleteMsg", { messageId });
    });

    socket.on("editMsg", ({ room, messageId, newText }) => {
        if (!rooms[room]) return;
        const msg = messageStatus[messageId];
        const senderUsername = getUsernameBySocket(room, socket.id);
        if (!msg || msg.senderUsername !== senderUsername) return;
        io.to(room).emit("editMsg", { messageId, newText });
    });

    // ===== TYPING =====
    socket.on("typing", (data) => {
        if (!rooms[data.room]) return;
        socket.to(data.room).emit("typing", data);
    });

    socket.on("stopTyping", (data) => {
        if (!rooms[data.room]) return;
        socket.to(data.room).emit("stopTyping");
    });

    // ===== PRIVACY =====
    socket.on("privacyAlert", ({ room, username, reason }) => {
        if (!rooms[room]) return;
        io.to(room).emit("warningMsg", `🚨 <b>PRIVACY ALERT:</b> ${username} ${reason}`);
    });

    socket.on("privacyKick", ({ room, username, reason }) => {
        if (!rooms[room]) return;
        io.to(room).emit("warningMsg", `🚫 <b>${username}</b> was automatically removed from the room due to a privacy violation: <em>${reason}</em>`);
    });

    // ===== DISCONNECT =====
    socket.on("disconnect", () => {
        // Clean logout already handled above — skip
        if (loggedOutSockets.has(socket.id)) {
            loggedOutSockets.delete(socket.id);
            return;
        }
        // Unclean disconnect (network drop, browser close, tab killed)
        removeSocketFromRooms(socket.id);
    });

});

const PORT = process.env.PORT || 8080;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
