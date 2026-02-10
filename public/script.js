// ================= SOCKET CONNECTION =================
const socket = io("https://privchat-production.up.railway.app", {
    transports: ["websocket", "polling"],
    withCredentials: true
});
const username = localStorage.getItem("username");
const room = localStorage.getItem("room");
const token = localStorage.getItem("token");

// Redirect if missing login info
if (!username || !room || !token) {
    window.location.href = "login.html";
}

// DOM Elements
const messages = document.getElementById("messages");
const msgInput = document.getElementById("msg");
const sendBtn = document.getElementById("sendBtn");
const usernameDisplay = document.getElementById("usernameDisplay");
const roomName = document.getElementById("roomName");
const dropdown = document.getElementById("dropdown");
const onlineUsersDiv = document.getElementById("onlineUsers"); // Added


// ================= REPLY FEATURE VARIABLES =================
let replyToMessage = null;      // Stores the message being replied to
let selectedReplyMsg = null;    // For swipe/drag (optional)
let startX = 0;                 // For mobile swipe detection

// 🔹 Typing Indicator Element
let typingIndicator = document.getElementById("typingIndicator");

// 🔹 ADDED (Feature 2): store my sent messages
const myMessages = {}; // messageId => <p>

// 🔹 ADDED (Edit/Delete):
let isEditing = false;
let editingMessageId = null;

// 🔹 ADDED (Mentions):
let currentRoomUsers = [];
const mentionDropdown = document.getElementById("mentionDropdown");



// ================= DISPLAY INFO IMMEDIATELY =================
usernameDisplay.innerText = "User: " + username;
roomName.innerText = "Room: " + room;

// ================= JOIN ROOM =================
socket.emit("joinRoom", { username, room, token });

// ================= RECEIVE PRIVATE MESSAGE =================
socket.on("privateMsg", data => {

    let text, messageId, sender;

    if (typeof data === "string") {
        text = data;
    } else {
        text = data.message;
        messageId = data.messageId;
        sender = data.sender;
    }

    const isMe = text.startsWith(username + ":");
    if (isMe && messageId && myMessages[messageId]) return;

    // Container
    const container = document.createElement("div");
    container.className = isMe ? "msg-container self" : "msg-container";

    // ✅ PARSE REPLY (Regex to separate reply header)
    let replyHtml = "";
    let cleanText = text;

    // Regex to match "Reply to: "quoted"\nActual message"
    const replyMatch = text.match(/^Reply to: "((?:.|\n)*?)"\n((?:.|\n)*)$/);
    if (replyMatch) {
        const replyContent = replyMatch[1];
        cleanText = replyMatch[2];
        replyHtml = `
            <div class="reply-preview">
                <strong>Replied to:</strong>
                <span>${replyContent}</span>
            </div>
        `;
    }

    // ✅ Parse Mentions
    const parsedText = cleanText.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

    // Message Bubble
    const p = document.createElement("div"); // Changed to div
    p.className = isMe ? "msg-bubble self" : "msg-bubble"; // New class
    if (messageId) p.dataset.id = messageId;

    // Detect Emoji-Only (Basic Regex)
    const isEmoji = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(parsedText.replace(/<[^>]*>/g, ""));
    if (isEmoji) p.classList.add("emoji-msg");

    // CONSTRUCT HTML
    // CONSTRUCT HTML
    // 🔹 FILE MESSAGE HANDLING
    if (text.includes("[[FILE_MSG]]")) {
        try {
            const parts = text.split("[[FILE_MSG]]");
            const fileData = JSON.parse(parts[1]);

            p.classList.add("file-msg");
            p.innerHTML = getFileMessageHTML(fileData) +
                (isMe ? `<span class="ticks" id="tick-${messageId}">✓</span>` : "");

            // Allow menu for files too (delete only)
        } catch (e) {
            console.error("File parse error", e);
            p.innerText = "Error loading attachment.";
        }
    } else {
        p.innerHTML = `
            ${replyHtml}
            <span class="msg-text">${parsedText}</span>
            ${isMe ? `<span class="ticks" id="tick-${messageId}">✓</span>` : ""}
            <span class="edited-label" id="edited-${messageId}" style="display:none;">(edited)</span>
        `;
    }

    // MENU (Inside bubble for better positioning)
    // MENU (Inside bubble for better positioning)
    // ✅ PERMISSION FIX: Only show menu if I am the sender
    if (isMe && messageId) {
        const menuBtn = document.createElement("div");
        menuBtn.className = isMe ? "msg-actions-btn" : "msg-actions-btn left-btn"; // Position check
        menuBtn.innerHTML = "⋮";
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            toggleMsgMenu(messageId);
        };

        const menu = document.createElement("div");
        menu.className = "msg-actions-menu";
        menu.id = `menu-${messageId}`;

        let menuOptions = '';
        if (isMe && !text.includes("[[FILE_MSG]]")) {
            menuOptions += `<p onclick="startEditMessage('${messageId}')">Edit</p>`;
        }
        menuOptions += `<p onclick="deleteMessage('${messageId}')">Delete</p>`;

        menu.innerHTML = menuOptions;

        p.appendChild(menuBtn);
        p.appendChild(menu);
    }

    container.appendChild(p);
    messages.appendChild(container); // Standard append
    messages.scrollTop = messages.scrollHeight;

    myMessages[messageId] = p; // Store the bubble

    if (!isMe && messageId) {
        socket.emit("messageRead", { room, messageId, username });
    }
});

// Close menus on click elsewhere
document.addEventListener("click", () => {
    document.querySelectorAll(".msg-actions-menu").forEach(m => m.style.display = "none");
});

function toggleMsgMenu(id) {
    // close others
    document.querySelectorAll(".msg-actions-menu").forEach(m => {
        if (m.id !== `menu-${id}`) m.style.display = "none";
    });
    const menu = document.getElementById(`menu-${id}`);
    if (menu) {
        menu.style.display = menu.style.display === "block" ? "none" : "block";
    }
}

function startEditMessage(id) {
    const p = myMessages[id];
    if (!p) return;

    const textSpan = p.querySelector(".msg-text");
    const text = textSpan ? textSpan.innerText : p.innerText; // fallback

    msgInput.value = text;
    msgInput.focus();

    isEditing = true;
    editingMessageId = id;
    sendBtn.innerText = "Update";
}

function deleteMessage(id) {
    if (confirm("Delete this message?")) {
        socket.emit("deleteMsg", { room, messageId: id });
    }
}

// ================= LISTENERS FOR EDIT / DELETE =================
socket.on("editMsg", ({ messageId, newText }) => {
    // Update view
    const p = document.querySelector(`.msg-bubble[data-id="${messageId}"]`);
    if (p) {
        const textSpan = p.querySelector(".msg-text");

        // ✅ Parse Mentions for Edit
        const parsedText = newText.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

        if (textSpan) textSpan.innerHTML = parsedText;
        else p.innerHTML = parsedText; // fallback if older structure

        // Show edited label
        const editedLabel = p.querySelector(".edited-label");
        if (editedLabel) editedLabel.style.display = "inline"; // Float handles position
    }
});

socket.on("deleteMsg", ({ messageId }) => {
    const p = document.querySelector(`.msg-bubble[data-id="${messageId}"]`);
    if (p) {
        p.innerHTML = `<span class="deleted-msg">This message was deleted</span>`;
        // Menu is inside bubble now (in p), so rewriting innerHTML removes it automatically.
    }
});


// ================= JOIN REQUEST =================
socket.on("joinRequest", ({ username, socketId }) => {
    if (confirm(`${username} wants to join. Approve?`)) {
        socket.emit("approveUser", { room, socketId });
    } else {
        socket.emit("rejectUser", { room, socketId });
    }
});

// ================= WARNING MESSAGE =================
socket.on("warningMsg", msg => {
    messages.innerHTML += `<div class="msg-bubble warning">${msg}</div>`;
    setTimeout(logout, 1500);
});

// ================= SEND MESSAGE =================
function sendMessage() {
    const msg = msgInput.value.trim();
    if (!msg) return;

    // 🔹 EDIT MODE
    if (isEditing && editingMessageId) {
        socket.emit("editMsg", { room, messageId: editingMessageId, newText: msg });

        // Optimistic update
        const p = myMessages[editingMessageId];
        if (p) {
            const textSpan = p.querySelector(".msg-text");
            // ✅ Parse Mentions for Optimistic Edit
            const parsedText = msg.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
            if (textSpan) textSpan.innerHTML = parsedText;

            const editedLabel = p.querySelector(".edited-label");
            if (editedLabel) editedLabel.style.display = "inline";
        }

        // Reset
        isEditing = false;
        editingMessageId = null;
        sendBtn.innerText = "Send";
        msgInput.value = "";
        return;
    }

    let finalMsg = msg; // Use finalMsg instead of msgInput.value

    // ✅ Add reply prefix if replying
    if (replyToMessage) {
        finalMsg = `Reply to: "${replyToMessage}"\n${msg}`;
        cancelReply();
    }

    const messageId = Date.now() + "_" + Math.random().toString(36).slice(2);

    // Container
    const container = document.createElement("div");
    container.className = "msg-container self";

    // ✅ Create Bubble
    const p = document.createElement("div");
    p.className = "msg-bubble self";
    p.dataset.id = messageId;

    // ✅ Parse
    const parsedText = finalMsg.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

    // Detect Emoji
    const isEmoji = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(parsedText.replace(/<[^>]*>/g, ""));
    if (isEmoji) p.classList.add("emoji-msg");

    // Check for reply prefix in finalMsg to split local display
    let replyHtml = "";
    let cleanText = finalMsg;

    if (finalMsg.startsWith("Reply to:")) {
        const match = finalMsg.match(/^Reply to: "((?:.|\n)*?)"\n((?:.|\n)*)$/);
        if (match) {
            replyHtml = `
            <div class="reply-preview">
                <strong>Replied to:</strong>
                <span>${match[1]}</span>
            </div>
            `;
            cleanText = match[2];
        }
    }

    // Re-parse the clean text for mentions
    const parsedCleanText = cleanText.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

    p.innerHTML = `
        ${replyHtml}
        <span class="msg-text">${parsedCleanText}</span>
        <span class="ticks" id="tick-${messageId}">✓</span>
        <span class="edited-label" id="edited-${messageId}" style="display:none;">(edited)</span>
    `;

    // Menu (Inside bubble)
    const menuBtn = document.createElement("div");
    menuBtn.className = "msg-actions-btn";
    menuBtn.innerHTML = "⋮";
    menuBtn.onclick = (e) => {
        e.stopPropagation();
        toggleMsgMenu(messageId);
    };

    const menu = document.createElement("div");
    menu.className = "msg-actions-menu";
    menu.id = `menu-${messageId}`;
    menu.innerHTML = `
      <p onclick="startEditMessage('${messageId}')">Edit</p>
      <p onclick="deleteMessage('${messageId}')">Delete</p>
    `;

    p.appendChild(menuBtn);
    p.appendChild(menu);

    container.appendChild(p);

    messages.appendChild(container);
    messages.scrollTop = messages.scrollHeight;

    myMessages[messageId] = p;

    socket.emit("privateMsg", {
        room,
        message: `${username}: ${finalMsg}`,
        messageId,
        sender: socket.id
    });

    msgInput.value = "";
    stopTyping();
}

// ================= ENTER KEY =================
function pressEnter(e) {
    if (e.key === "Enter") sendMessage();
}

// ================= LOGOUT =================
function logout() {
    localStorage.clear();
    window.location.href = "login.html";
}

// ================= DROPDOWN =================
function toggleDropdown() {
    dropdown.style.display =
        dropdown.style.display === "block" ? "none" : "block";
}

// ================= TYPING INDICATOR =================
let typingTimeout;
msgInput.addEventListener("input", () => {
    socket.emit("typing", { username, room });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        stopTyping();
    }, 1000);
});

function stopTyping() {
    socket.emit("stopTyping", { username, room });
}

socket.on("typing", (data) => {
    typingIndicator.style.display = "block";
    typingIndicator.textContent = `${data.username} is typing...`;
});

socket.on("stopTyping", () => {
    typingIndicator.style.display = "none";
});

function cancelReply() {
    replyToMessage = null;
    const replyBox = document.getElementById("replyBox");
    if (replyBox) replyBox.style.display = "none";
}

// ================= MESSAGE DELIVERED =================
socket.on("messageDelivered", ({ messageId }) => {
    const tick = document.getElementById(`tick-${messageId}`);
    if (tick) tick.textContent = "✓✓";
});

// ================= MESSAGE SEEN =================
socket.on("messageSeen", ({ messageId, seenBy, allSeen }) => {
    const p = myMessages[messageId];
    if (!p) return;

    const tick = document.getElementById(`tick-${messageId}`);
    if (tick && allSeen) {
        tick.style.color = "blue";
    }

    let seenDiv = p.querySelector(".seen-by");
    if (!seenDiv) {
        seenDiv = document.createElement("div");
        seenDiv.className = "seen-by";
        seenDiv.style.fontSize = "11px";
        seenDiv.style.color = "gray";
        p.appendChild(seenDiv);
    }

    seenDiv.textContent = "Seen by: " + seenBy.join(", ");
});

// =====================================================
// ================= EMOJI FEATURE (ONLY ADDED) ========
// =====================================================
const emojiBtn = document.getElementById("emojiBtn");
const emojiPicker = document.getElementById("emojiPicker");

// Toggle emoji picker
emojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPicker.style.display =
        emojiPicker.style.display === "block" ? "none" : "block";
});

// Add emoji to input
emojiPicker.addEventListener("click", (e) => {
    if (e.target.tagName === "SPAN") {
        msgInput.value += e.target.textContent;
        msgInput.focus();
    }
});

// Close emoji picker when clicking outside
document.addEventListener("click", () => {
    emojiPicker.style.display = "none";
});

// ================= ONLINE USERS =================
socket.on("roomUsers", ({ users }) => {
    currentRoomUsers = users; // Store for mentions
    if (onlineUsersDiv) {
        onlineUsersDiv.innerText = "Online: " + users.join(", ");
    }
});

// ================= MENTION DROPDOWN LOGIC =================
msgInput.addEventListener("input", (e) => {
    const val = msgInput.value;
    const lastWord = val.split(" ").pop();

    if (lastWord.startsWith("@")) {
        const query = lastWord.slice(1).toLowerCase();
        const matches = currentRoomUsers.filter(u => u.toLowerCase().startsWith(query));

        if (matches.length > 0) {
            showMentionDropdown(matches);
        } else {
            hideMentionDropdown();
        }
    } else {
        hideMentionDropdown();
    }
});

function showMentionDropdown(matches) {
    mentionDropdown.innerHTML = "";
    mentionDropdown.style.display = "block";

    matches.forEach(user => {
        const div = document.createElement("div");
        div.innerText = user;
        div.onclick = () => selectMention(user);
        mentionDropdown.appendChild(div);
    });
}

function hideMentionDropdown() {
    mentionDropdown.style.display = "none";
}

function selectMention(user) {
    const val = msgInput.value;
    const words = val.split(" ");
    words.pop(); // remove incomplete @...
    words.push(`@${user} `);
    msgInput.value = words.join(" ");
    hideMentionDropdown();
    msgInput.focus();
}

// Close dropdown on click outside
document.addEventListener("click", (e) => {
    if (e.target.closest("#mentionDropdown")) return;
    hideMentionDropdown();
});


// ================= REPLY FEATURE: Desktop + Mobile =================

// DESKTOP: double-click to reply
messages.addEventListener("dblclick", (e) => {
    const msg = e.target.closest(".msg-bubble");
    if (!msg) return;

    // ======= IMPROVED CLEAN MESSAGE LOGIC =======
    // Only grab .msg-text content, ignoring ticks/menu/reply-preview
    const textSpan = msg.querySelector(".msg-text");
    replyToMessage = textSpan ? textSpan.innerText.trim() : msg.innerText.trim();
    // ============================================

    const replyBox = document.getElementById("replyBox");
    const replyText = document.getElementById("replyText");

    replyText.textContent = replyToMessage;
    replyBox.style.display = "flex";
});

// MOBILE: swipe right to reply
messages.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
});

// ================= FILE SENDING FEATURE =================

const fileInput = document.getElementById("fileInput");

// File Selection Listener
fileInput.addEventListener("change", handleFileSelect);

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 1. Validate Size (10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        alert("File is too large! Max limit is 10MB.");
        fileInput.value = ""; // reset
        return;
    }

    // 2. Read File
    const reader = new FileReader();
    reader.onload = function (event) {
        const fileData = {
            name: file.name,
            type: file.type,
            size: formatBytes(file.size),
            data: event.target.result // Base64 string
        };
        sendFile(fileData);
    };
    reader.readAsDataURL(file);
    fileInput.value = ""; // reset for next use
}

// Send File Message
function sendFile(fileData) {
    const messageId = Date.now() + "_" + Math.random().toString(36).slice(2);

    // Create Local Bubble (Optimistic UI)
    const container = document.createElement("div");
    container.className = "msg-container self";

    const p = document.createElement("div");
    p.className = "msg-bubble self file-msg";
    p.dataset.id = messageId;

    p.innerHTML = getFileMessageHTML(fileData) +
        `<span class="ticks" id="tick-${messageId}">✓</span>`;

    // Menu for Delete
    const menuBtn = document.createElement("div");
    menuBtn.className = "msg-actions-btn";
    menuBtn.innerHTML = "⋮";
    menuBtn.onclick = (e) => {
        e.stopPropagation();
        toggleMsgMenu(messageId);
    };

    const menu = document.createElement("div");
    menu.className = "msg-actions-menu";
    menu.id = `menu-${messageId}`;
    menu.innerHTML = `<p onclick="deleteMessage('${messageId}')">Delete</p>`; // No edit for files

    p.appendChild(menuBtn);
    p.appendChild(menu);

    container.appendChild(p);
    messages.appendChild(container);
    messages.scrollTop = messages.scrollHeight;

    myMessages[messageId] = p;

    // Send to Server
    // Prefix [[FILE_MSG]] + JSON
    const payload = JSON.stringify(fileData);
    const finalMsg = `[[FILE_MSG]]${payload}`;

    socket.emit("privateMsg", {
        room,
        message: `${username}: ${finalMsg}`,
        messageId,
        sender: socket.id
    });
}

// Generate HTML for File Message
function getFileMessageHTML(file) {
    const { name, type, data, size } = file;

    if (type.startsWith("image/")) {
        return `<img src="${data}" alt="${name}" onclick="openMedia('${data}', 'image')">`;
    }
    else if (type.startsWith("video/")) {
        return `<video src="${data}" controls></video>`;
    }
    else {
        // Document / PDF / Other
        return `
            <a href="${data}" download="${name}" class="file-card">
                <span class="file-icon">📄</span>
                <div class="file-info">
                    <div class="file-name">${name}</div>
                    <div class="file-size">${size}</div>
                </div>
                <span>⬇️</span>
            </a>
        `;
    }
}

// Helper: Open Media (Full Screen / New Tab)
function openMedia(src, type) {
    const w = window.open("");
    if (type === "image") {
        w.document.write(`<img src="${src}" style="max-width:100%; height:auto;">`);
    }
}

// Helper: Format Bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Prevent Enter key in file input (just in case)
fileInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
});
