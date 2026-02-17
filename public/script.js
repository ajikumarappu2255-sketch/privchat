// ================= GLOBAL ERROR HANDLER (STABILITY) =================
window.onerror = function (msg, url, lineNo, columnNo, error) {
    console.error("Global Error Caught:", msg, "Line:", lineNo, "Error:", error);
    // Prevent white screen by suppressing the error and keeping UI alive
    return true;
};

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
// ================= RECEIVE PRIVATE MESSAGE (ROBUST) =================
socket.on("privateMsg", data => {
    try {
        // 1. SAFETY: Check data existence
        if (!data) return;

        let text, messageId, sender;

        // 2. SAFETY: Handle string vs object
        if (typeof data === "string") {
            text = data;
        } else {
            text = data.message || ""; // Fallback
            messageId = data.messageId;
            sender = data.sender;
        }

        // 3. SAFETY: Ensure text is string
        if (typeof text !== "string") text = String(text);

        const isMe = text.startsWith(username + ":");
        // 4. SAFETY: Check for duplicate ID to prevent loop
        if (isMe && messageId && myMessages[messageId]) return;

        // 5. STABILITY: Check DOM Limit
        checkDOMLimit();

        // Container
        const container = document.createElement("div");
        container.className = isMe ? "msg-container self" : "msg-container";

        // ✅ PARSE REPLY (Regex to separate reply header)
        let replyHtml = "";
        let cleanText = text;

        try {
            // Regex to match "Reply to: "quoted"\nActual message"
            const replyMatch = text.match(/^Reply to: "((?:.|\n)*?)"\n((?:.|\n)*)$/);
            if (replyMatch) {
                const replyContent = replyMatch[1] || "...";
                cleanText = replyMatch[2] || "";
                replyHtml = `
                    <div class="reply-preview">
                        <strong>Replied to:</strong>
                        <span>${escapeHtml(replyContent)}</span>
                    </div>
                `;
            }
        } catch (e) { console.warn("Reply parse error", e); }

        // ✅ Parse Mentions (Safe)
        const parsedText = cleanText.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

        // Message Bubble
        const p = document.createElement("div");
        p.className = isMe ? "msg-bubble self" : "msg-bubble";
        if (messageId) p.dataset.id = messageId;

        // Detect Emoji-Only (Safe)
        try {
            const isEmoji = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(parsedText.replace(/<[^>]*>/g, ""));
            if (isEmoji) p.classList.add("emoji-msg");
        } catch (e) { /* Ignore regex error on old browsers */ }

        // CONSTRUCT HTML
        // 🔹 FILE MESSAGE HANDLING
        if (text.includes("[[FILE_MSG]]")) {
            try {
                const parts = text.split("[[FILE_MSG]]");
                // parts[1] is the JSON
                if (parts[1]) {
                    const fileData = JSON.parse(parts[1]);
                    p.classList.add("file-msg");

                    let captionHtml = "";
                    if (fileData.caption) {
                        const parsedCaption = fileData.caption.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
                        captionHtml = `<div class="msg-caption">${parsedCaption}</div>`;
                    }

                    p.innerHTML = getFileMessageHTML(fileData) +
                        captionHtml +
                        (isMe ? `<span class="ticks" id="tick-${messageId}">✓</span>` : "");
                } else {
                    throw new Error("Empty file data");
                }
            } catch (e) {
                console.error("File parse error", e);
                p.innerText = "Error loading attachment.";
            }
        } else {
            // NORMAL TEXT MESSAGE
            p.innerHTML = `
                ${replyHtml}
                <span class="msg-text">${parsedText}</span>
                ${isMe ? `<span class="ticks" id="tick-${messageId}">✓</span>` : ""}
                <span class="edited-label" id="edited-${messageId}" style="display:none;">(edited)</span>
            `;
        }

        // MENU (Inside bubble for better positioning)
        if (isMe && messageId) {
            const menuBtn = document.createElement("div");
            menuBtn.className = isMe ? "msg-actions-btn" : "msg-actions-btn left-btn";
            menuBtn.innerHTML = "⋮";
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                toggleMsgMenu(messageId);
            };

            const menu = document.createElement("div");
            menu.className = "msg-actions-menu";
            menu.id = `menu-${messageId}`;

            let menuOptions = '';
            // Disable edit for files
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

        if (messageId) myMessages[messageId] = p; // Store the bubble

        if (!isMe && messageId) {
            socket.emit("messageRead", { room, messageId, username });
        }
    } catch (err) {
        console.error("Critical Error in privateMsg handler:", err);
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
// ================= SEND MESSAGE (Updated for File) =================
function sendMessage() {
    const msg = msgInput.value.trim();

    // Check if we have a file selected OR text to send
    if (!msg && !selectedFile) return;

    // 🔹 EDIT MODE (Only for text messages, cannot edit file msgs)
    if (isEditing && editingMessageId) {
        socket.emit("editMsg", { room, messageId: editingMessageId, newText: msg });

        // Optimistic update
        const p = myMessages[editingMessageId];
        if (p) {
            const textSpan = p.querySelector(".msg-text");
            const parsedText = msg.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
            if (textSpan) textSpan.innerHTML = parsedText;
            const editedLabel = p.querySelector(".edited-label");
            if (editedLabel) editedLabel.style.display = "inline";
        }

        isEditing = false;
        editingMessageId = null;
        sendBtn.innerText = "Send";
        msgInput.value = "";
        return;
    }

    let finalMsg = msg;

    // ✅ Add reply prefix if replying
    if (replyToMessage) {
        finalMsg = `Reply to: "${replyToMessage}"\n${msg}`;
        cancelReply();
    }

    const messageId = Date.now() + "_" + Math.random().toString(36).slice(2);

    // ================= CONSTRUCT PAYLOAD =================
    let payloadMessage = "";

    if (selectedFile) {
        // 🔹 FILE + OPTIONAL CAPTION
        selectedFile.caption = finalMsg; // Add text as caption
        const fileJson = JSON.stringify(selectedFile);
        payloadMessage = `[[FILE_MSG]]${fileJson}`;
    } else {
        // 🔹 TEXT ONLY
        payloadMessage = finalMsg;
    }
    // =====================================================

    // Container
    const container = document.createElement("div");
    container.className = "msg-container self";

    // ✅ Create Bubble
    const p = document.createElement("div");
    p.className = "msg-bubble self";
    if (selectedFile) p.classList.add("file-msg"); // Specific class for files
    p.dataset.id = messageId;

    // ================= RENDER LOCAL BUBBLE =================
    if (selectedFile) {
        // Render File + Caption
        let captionHtml = "";
        if (selectedFile.caption) {
            const parsedCaption = selectedFile.caption.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
            captionHtml = `<div class="msg-caption">${parsedCaption}</div>`;
        }

        p.innerHTML = getFileMessageHTML(selectedFile) +
            captionHtml +
            `<span class="ticks" id="tick-${messageId}">✓</span>`;
    } else {
        // Render Text Only (Existing Logic)
        const parsedText = finalMsg.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

        // Detect Emoji
        const isEmoji = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(parsedText.replace(/<[^>]*>/g, ""));
        if (isEmoji) p.classList.add("emoji-msg");

        // Parse Reply
        let replyHtml = "";
        let cleanText = finalMsg;
        if (finalMsg.startsWith("Reply to:")) {
            const match = finalMsg.match(/^Reply to: "((?:.|\n)*?)"\n((?:.|\n)*)$/);
            if (match) {
                replyHtml = `
                <div class="reply-preview">
                    <strong>Replied to:</strong>
                    <span>${escapeHtml(match[1])}</span>
                </div>`;
                cleanText = match[2];
            }
        }

        const parsedCleanText = cleanText.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

        p.innerHTML = `
            ${replyHtml}
            <span class="msg-text">${parsedCleanText}</span>
            <span class="ticks" id="tick-${messageId}">✓</span>
            <span class="edited-label" id="edited-${messageId}" style="display:none;">(edited)</span>
        `;
    }
    // =====================================================

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

    // Only allow Delete for files (no edit)
    let menuOpts = `<p onclick="deleteMessage('${messageId}')">Delete</p>`;
    if (!selectedFile) {
        menuOpts = `<p onclick="startEditMessage('${messageId}')">Edit</p>` + menuOpts;
    }
    menu.innerHTML = menuOpts;

    p.appendChild(menuBtn);
    p.appendChild(menu);
    container.appendChild(p);
    messages.appendChild(container);
    messages.scrollTop = messages.scrollHeight;

    myMessages[messageId] = p;

    // ✅ SEND TO SERVER
    socket.emit("privateMsg", {
        room,
        message: `${username}: ${payloadMessage}`, // Prefixed with user for logic
        messageId,
        sender: socket.id
    });

    // Reset Input & File Selection
    msgInput.value = "";
    clearFileSelection(); // NEW: Clear file state
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

messages.addEventListener("touchend", (e) => {
    const endX = e.changedTouches[0].clientX;
    const msg = e.target.closest(".msg-bubble");
    if (!msg) return;

    if (endX - startX > 80) { // swipe right threshold
        // ======= IMPROVED CLEAN MESSAGE LOGIC =======
        const textSpan = msg.querySelector(".msg-text");
        replyToMessage = textSpan ? textSpan.innerText.trim() : msg.innerText.trim();
        // ============================================

        const replyBox = document.getElementById("replyBox");
        const replyText = document.getElementById("replyText");

        replyText.textContent = replyToMessage;
        replyBox.style.display = "flex";
    }
});

// ================= FILE SENDING FEATURE (DEFERRED SEND) =================
let selectedFile = null; // Stores file until sent

// DOM Elements for File
const fileInput = document.getElementById("fileInput");
const filePreview = document.getElementById("filePreview");
const previewImg = document.getElementById("previewImg");
const previewFileCard = document.getElementById("previewFileCard");
const previewFileName = document.getElementById("previewFileName");

if (fileInput) {
    fileInput.addEventListener("change", handleFileSelect);
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 1. Validate Size (10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        alert("File is too large! Max limit is 10MB.");
        e.target.value = ""; // reset
        return;
    }

    // 2. Read File
    const reader = new FileReader();
    reader.onload = function (event) {
        selectedFile = {
            name: file.name,
            type: file.type,
            size: formatBytes(file.size),
            data: event.target.result // Base64 string
        };
        showPreview(selectedFile);
    };
    reader.onerror = function () {
        alert("Failed to read file.");
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // reset input so same file can be selected again if cleared
}

function showPreview(file) {
    filePreview.style.display = "flex";

    if (file.type.startsWith("image/")) {
        previewImg.src = file.data;
        previewImg.style.display = "block";
        previewFileCard.style.display = "none";
    } else {
        previewImg.style.display = "none";
        previewFileCard.style.display = "flex";
        previewFileName.textContent = file.name;
    }

    msgInput.focus(); // Focus input for caption
}

function clearFileSelection() {
    selectedFile = null;
    filePreview.style.display = "none";
    previewImg.src = "";
    if (fileInput) fileInput.value = "";
}

// Generate HTML for File Message
function getFileMessageHTML(file) {
    try {
        if (!file || !file.type) return "<span>Unknown file</span>";

        const { name, type, data, size } = file;

        if (type.startsWith("image/")) {
            return `<img src="${data}" alt="${escapeHtml(name)}" onclick="openMedia('${data}', 'image')">`;
        }
        else if (type.startsWith("video/")) {
            return `<video src="${data}" controls></video>`;
        }
        else {
            // Document / PDF / Other
            return `
                <a href="${data}" download="${escapeHtml(name)}" class="file-card">
                    <span class="file-icon">📄</span>
                    <div class="file-info">
                        <div class="file-name">${escapeHtml(name)}</div>
                        <div class="file-size">${size}</div>
                    </div>
                    <span>⬇️</span>
                </a>
            `;
        }
    } catch (e) {
        return "<span>Error displaying file</span>";
    }
}

// Helper: Open Media
function openMedia(src, type) {
    try {
        const w = window.open("");
        if (type === "image") {
            w.document.write(`<img src="${src}" style="max-width:100%; height:auto;">`);
        }
    } catch (e) {
        console.warn("Popup blocked:", e);
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


// ================= STABILITY HELPERS =================

// Helper: Escape HTML to prevent XSS/broken layout
function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// STABILITY: Limit DOM Elements
function checkDOMLimit() {
    try {
        const MAX_MESSAGES = 200;
        const allMessages = messages.getElementsByClassName("msg-container");
        if (allMessages.length > MAX_MESSAGES) {
            // Remove oldest 20 messages
            for (let i = 0; i < 20; i++) {
                if (allMessages[0]) messages.removeChild(allMessages[0]);
            }
        }
    } catch (e) {
        console.warn("DOM limit check failed:", e);
    }
}

// Prevent Enter key in file input (safety)
if (fileInput) {
    fileInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
    });
}
