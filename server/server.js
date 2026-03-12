const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    maxHttpBufferSize: 5e7,
    pingTimeout: 60000,
    cors: {
        origin: function (origin, callback) {
            // Allow Vercel production and any localhost origin
            if (!origin || origin === "https://privchat-pi.vercel.app" || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ["GET", "POST"]
    }
});

app.use(express.static("public"));

const rooms = {};
// roomName => { token, ownerSocket, users: { username: {socketId, sessionId} }, pending: { socketId: username } }

// 🔹 ADDED: Message status store
const messageStatus = {};
// messageId => { room, senderSocket, senderUsername, deliveredTo: [], seenBy: [] }

// Track sockets that explicitly logged out — ignore their disconnect event
const loggedOutSockets = new Set();

// Helper: get username by socket id
function getUsernameBySocket(room, socketId) {
    const roomData = rooms[room];
    if (!roomData) return null;
    for (const user in roomData.users) {
        if (roomData.users[user].socketId === socketId) return user;
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
    socket.on("joinRoom", (data) => {
        const { username, room, token } = data;
        
        if (!username || !room || !token) {
            socket.emit("warningMsg", "All fields are required!");
            return;
        }

        if (!rooms[room]) {
            const newSessionId = Date.now().toString(36) + Math.random().toString(36).substring(2);
            rooms[room] = {
                token,
                ownerSocket: socket.id,
                users: { [username]: { socketId: socket.id, sessionId: newSessionId } },
                pending: {}
            };
            socket.join(room);
            socket.emit("privateMsg", { text: "ROOM OWNER: You created the room.", sessionId: newSessionId });
            broadcastRoomUsers(room);
            return;
        }

        const roomData = rooms[room];

        if (roomData.token !== token) {
            socket.emit("warningMsg", "Room token invalid. Check your room name and token.");
            return;
        }

        // Case-insensitive check for duplicate username in the SAME room
        let matchedExistingUsername = null;
        for (const existingUser of Object.keys(roomData.users)) {
            if (existingUser.toLowerCase() === username.toLowerCase()) {
                matchedExistingUsername = existingUser;
                break;
            }
        }

        // User already in room (session takeover / reconnect)
        if (matchedExistingUsername) {
            const oldSocketId = roomData.users[matchedExistingUsername].socketId;
            const expectedSessionId = roomData.users[matchedExistingUsername].sessionId;

            // If the client didn't provide the correct sessionId, they are a clone/imposter
            if (!data.sessionId || data.sessionId !== expectedSessionId) {
                socket.emit("warningMsg", "This username is already in use in this room.");
                return;
            }

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

                roomData.users[matchedExistingUsername].socketId = socket.id;
            }

            socket.join(room);
            socket.emit("privateMsg", { text: "Welcome back, " + matchedExistingUsername + "!", sessionId: expectedSessionId });
            broadcastRoomUsers(room);
            return;
        }

        // Verify if username is already waiting for approval
        let isAlreadyPending = false;
        for (const pendingSocketId in roomData.pending) {
            if (roomData.pending[pendingSocketId] === username) {
                isAlreadyPending = true;
                // Update their socket ID silently without sending another joinRequest popup to owner
                delete roomData.pending[pendingSocketId];
                roomData.pending[socket.id] = username;
                break;
            }
        }

        if (!isAlreadyPending) {
            roomData.pending[socket.id] = username;
            io.to(roomData.ownerSocket).emit("joinRequest", {
                username,
                socketId: socket.id
            });
        }

        socket.emit("waitingApproval", "Waiting for owner approval...");
    });

    // ================= APPROVE / REJECT USER =================
    socket.on("approveUser", ({ room, socketId, username }) => {
        const roomData = rooms[room];
        if (!roomData || socket.id !== roomData.ownerSocket) return;

        let targetUsername = username;
        let targetSocketId = socketId;

        if (!targetUsername) {
            targetUsername = roomData.pending[socketId];
        } else {
            // Find the latest socketId for this username in pending
            for (const key in roomData.pending) {
                if (roomData.pending[key] === targetUsername) {
                    targetSocketId = key;
                    break;
                }
            }
        }

        if (!targetUsername || !targetSocketId) return;

        const newSessionId = Date.now().toString(36) + Math.random().toString(36).substring(2);
        roomData.users[targetUsername] = { socketId: targetSocketId, sessionId: newSessionId };
        
        // Remove all pending entries for this username just in case
        for (const key in roomData.pending) {
            if (roomData.pending[key] === targetUsername) {
                delete roomData.pending[key];
            }
        }

        io.sockets.sockets.get(targetSocketId)?.join(room);
        io.to(targetSocketId).emit("privateMsg", { text: "Owner approved your entry.", sessionId: newSessionId });
        broadcastRoomUsers(room);
    });

    socket.on("rejectUser", ({ room, socketId, username }) => {
        const roomData = rooms[room];
        if (!roomData || socket.id !== roomData.ownerSocket) return;

        let targetUsername = username;
        let targetSocketId = socketId;

        if (!targetUsername) {
            targetUsername = roomData.pending[socketId];
        } else {
            // Find the latest socketId for this username in pending
            for (const key in roomData.pending) {
                if (roomData.pending[key] === targetUsername) {
                    targetSocketId = key;
                    break;
                }
            }
        }
        
        if (!targetSocketId) return;

        for (const key in roomData.pending) {
            if (roomData.pending[key] === targetUsername) {
                delete roomData.pending[key];
            }
        }

        io.to(targetSocketId).emit("warningMsg", "Owner rejected your request.");
        io.sockets.sockets.get(targetSocketId)?.disconnect();
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
            if (rooms[room].users[user].socketId !== socket.id) {
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
        const currentSenderSocket = rooms[room].users[msg.senderUsername]?.socketId;

        if (currentSenderSocket) {
            io.to(currentSenderSocket).emit("messageSeen", {
                messageId,
                seenBy: msg.seenBy,
                allSeen: msg.seenBy.length === totalReceivers
            });
        }
    });

    // ================= DELETE MESSAGE =================
    socket.on("deleteMsg", ({ room, messageId }) => {
        if (!rooms[room]) return;
        const msg = messageStatus[messageId];
        if (!msg) return;

        // Use current sender username to authorize, enabling delete after reconnect
        const senderUsername = getUsernameBySocket(room, socket.id);
        if (msg.senderUsername !== senderUsername) return;

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

        // Use current sender username to authorize, enabling edit after reconnect
        const senderUsername = getUsernameBySocket(room, socket.id);
        if (msg.senderUsername !== senderUsername) return;

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

    // ================= PRIVACY ALERT =================
    socket.on("privacyAlert", ({ room, action, username }) => {
        const roomData = rooms[room];
        if (!roomData || !roomData.ownerSocket) return;

        // Message strictly only the room owner
        io.to(roomData.ownerSocket).emit("warningMsg", `${username} ${action}`);
    });

    // ================= DISCONNECT =================
    socket.on("disconnect", () => {
        if (loggedOutSockets.has(socket.id)) {
            loggedOutSockets.delete(socket.id);
            return;
        }

        for (const room in rooms) {
            const r = rooms[room];

            for (const user in r.users) {
                if (r.users[user].socketId === socket.id) {
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

const PORT = process.env.PORT || 8080;
http.listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
);
