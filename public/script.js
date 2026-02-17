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
let selectedFiles = []; // Store selected files

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

        // ✅ PARSE FILE vs TEXT
        let isFile = false;
        let fileData = null;
        let cleanText = text;

        // Check for File signature: "username: ##FILE##{JSON}"
        const userPrefix = text.split(": ")[0] + ": ";
        const potentiallyContent = text.substring(userPrefix.length);

        if (potentiallyContent.startsWith("##FILE##")) {
            try {
                const jsonStr = potentiallyContent.substring(8); // Remove ##FILE##
                fileData = JSON.parse(jsonStr);
                isFile = true;
                cleanText = fileData.caption || ""; // Caption is the display text
            } catch (e) {
                console.warn("File parse error:", e);
                cleanText = "[Invalid File]";
            }
        } else {
            // Standard text message processing
            if (isMe) cleanText = text.substring(username.length + 2); // Remove "User: "
            else cleanText = text.substring(text.indexOf(":") + 2);
        }

        // ✅ PARSE REPLY (Regex to separate reply header)
        let replyHtml = "";

        try {
            // Regex to match "Reply to: "quoted"\nActual message"
            const replyMatch = cleanText.match(/^Reply to: "((?:.|\n)*?)"\n((?:.|\n)*)$/);
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
        if (isFile) p.classList.add("file-bubble");

        // Detect Emoji-Only (Safe) - Only if not a file
        if (!isFile) {
            try {
                const isEmoji = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(parsedText.replace(/<[^>]*>/g, ""));
                if (isEmoji) p.classList.add("emoji-msg");
            } catch (e) { /* Ignore regex error upon old browsers */ }
        }

        // CONTENT RENDERING
        let contentHtml = "";

        if (isFile && fileData) {
            // RENDER FILE
            const { fileType, data, name, size } = fileData;

            if (fileType.startsWith("image/")) {
                contentHtml = `<img src="${data}" class="file-preview-img" onclick="viewImage('${data}')" alt="${escapeHtml(name)}">`;
            } else if (fileType.startsWith("video/")) {
                contentHtml = `<video src="${data}" controls class="file-preview-video"></video>`;
            } else if (fileType.startsWith("audio/")) {
                contentHtml = `<audio src="${data}" controls class="file-preview-audio"></audio>`;
            } else {
                // Documents / Others
                contentHtml = `
                    <a href="${data}" download="${name}" class="file-link">
                        <span class="file-icon">${getFileIcon(name)}</span>
                        <div class="file-info">
                            <span class="file-name">${escapeHtml(name)}</span>
                            <span class="file-type-size">${formatSize(size)}</span>
                        </div>
                        <span class="download-icon">⬇</span>
                    </a>
                `;
            }
            // Add Caption
            if (parsedText) {
                contentHtml += `<div class="file-caption">${parsedText}</div>`;
            }

        } else {
            // NORMAL TEXT
            contentHtml = `<span class="msg-text">${parsedText}</span>`;
        }

        p.innerHTML = `
            ${replyHtml}
            ${contentHtml}
            ${isMe ? `<span class="ticks" id="tick-${messageId}">✓</span>` : ""}
            <span class="edited-label" id="edited-${messageId}" style="display:none;">(edited)</span>
        `;

        // MENU (Inside bubble for better positioning)
        // Disable Edit for Files
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

            // Files cannot be edited, only deleted
            let menuItems = `<p onclick="deleteMessage('${messageId}')">Delete</p>`;
            if (!isFile) {
                menuItems = `<p onclick="startEditMessage('${messageId}')">Edit</p>` + menuItems;
            }

            menu.innerHTML = menuItems;

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
async function sendMessage() {
    const msg = msgInput.value.trim();

    // 🔹 EDIT MODE (Text only - Edit disabled for files)
    if (isEditing && editingMessageId) {
        if (!msg) return; // Prevent empty edit
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

    // Prevent empty sends (Must have text OR files)
    if (!msg && selectedFiles.length === 0) return;

    // 1. SEND FILES FIRST
    if (selectedFiles.length > 0) {
        loadingOverlay.style.display = "flex";

        // Clone array to prevent race conditions if clearing
        const filesToSend = [...selectedFiles];
        selectedFiles = []; // Clear immediately

        // Reset UI
        attachBtn.innerHTML = "📎";
        attachBtn.style.color = "#555";

        for (const file of filesToSend) {
            try {
                await processAndSendFile(file);
            } catch (err) {
                console.error("Error sending file:", err);
                alert("Failed to send " + file.name);
            }
        }
        loadingOverlay.style.display = "none";
    }

    // 2. SEND TEXT (If exists)
    if (msg) {
        let finalMsg = msg;

        // reply prefix
        if (replyToMessage) {
            finalMsg = `Reply to: "${replyToMessage}"\n${msg}`;
            cancelReply();
        }

        const messageId = Date.now() + "_" + Math.random().toString(36).slice(2);

        // Create Bubble (Optimistic)
        const container = document.createElement("div");
        container.className = "msg-container self";

        const p = document.createElement("div");
        p.className = "msg-bubble self";
        p.dataset.id = messageId;

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

        // Menu
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
        menu.innerHTML = `<p onclick="startEditMessage('${messageId}')">Edit</p>
                          <p onclick="deleteMessage('${messageId}')">Delete</p>`;

        p.appendChild(menuBtn);
        p.appendChild(menu);
        container.appendChild(p);
        messages.appendChild(container);
        messages.scrollTop = messages.scrollHeight;

        myMessages[messageId] = p;

        // Send to Server
        socket.emit("privateMsg", {
            room,
            message: `${username}: ${finalMsg}`,
            messageId,
            sender: socket.id
        });

        msgInput.value = "";
        stopTyping();
    }
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

// ==========================================================
// ================= FILE HANDLER LOGIC =====================
// ==========================================================

const fileInput = document.getElementById("fileInput");
const attachBtn = document.getElementById("attachBtn");
const loadingOverlay = document.getElementById("loadingOverlay");

// 1. Trigger File Input
attachBtn.addEventListener("click", () => {
    fileInput.click();
});

// 2. Handle File Selection
fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Validate Files
    for (const file of files) {
        if (file.size > 10 * 1024 * 1024) { // 10MB
            alert(`File ${file.name} is too large (Max 10MB)`);
            fileInput.value = ""; // Reset
            return;
        }
    }

    // Add to 'selectedFiles' for later
    selectedFiles = [...selectedFiles, ...files];

    // Update UI to show count
    attachBtn.innerHTML = `📎 <span style="font-size:12px; color:green; font-weight:bold;">(${selectedFiles.length})</span>`;
    attachBtn.style.color = "#007bff";

    fileInput.value = ""; // Reset input so same file can be selected again if needed (but we stored it)
});

// 3. Process File -> Base64 -> Send
async function processAndSendFile(file) {
    let base64Data;

    // Compress Image if needed
    if (file.type.startsWith("image/")) {
        base64Data = await compressImage(file);
    } else {
        base64Data = await readFileAsBase64(file);
    }

    const filePayload = {
        type: "file",
        fileType: file.type,
        name: file.name,
        size: file.size,
        data: base64Data,
        caption: ""
    };

    const messageId = Date.now() + "_" + Math.random().toString(36).slice(2);
    const jsonStr = JSON.stringify(filePayload);
    const finalMsg = "##FILE##" + jsonStr;

    // Optimistic UI (Render immediately)
    renderOptimisticFile(filePayload, messageId);

    // Send to Server
    socket.emit("privateMsg", {
        room,
        message: `${username}: ${finalMsg}`,
        messageId,
        sender: socket.id
    });
}

// 4. Helper: Read File
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

// 5. Helper: Compress Image
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const MAX_WIDTH = 800; // Resize to max 800px width
                const scaleSize = MAX_WIDTH / img.width;

                if (scaleSize < 1) {
                    canvas.width = MAX_WIDTH;
                    canvas.height = img.height * scaleSize;
                } else {
                    canvas.width = img.width;
                    canvas.height = img.height;
                }

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // Compress to JPEG 0.7 quality
                resolve(canvas.toDataURL("image/jpeg", 0.7));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

// 6. Optimistic Render Helper
function renderOptimisticFile(fileData, messageId) {
    const { fileType, data, name, size } = fileData;

    const container = document.createElement("div");
    container.className = "msg-container self";

    const p = document.createElement("div");
    p.className = "msg-bubble file-bubble self";
    p.dataset.id = messageId;

    let contentHtml = "";

    if (fileType.startsWith("image/")) {
        contentHtml = `<img src="${data}" class="file-preview-img" onclick="viewImage('${data}')" alt="${escapeHtml(name)}">`;
    } else if (fileType.startsWith("video/")) {
        contentHtml = `<video src="${data}" controls class="file-preview-video"></video>`;
    } else if (fileType.startsWith("audio/")) {
        contentHtml = `<audio src="${data}" controls class="file-preview-audio"></audio>`;
    } else {
        contentHtml = `
            <a href="${data}" download="${name}" class="file-link">
                <span class="file-icon">${getFileIcon(name)}</span>
                <div class="file-info">
                    <span class="file-name">${escapeHtml(name)}</span>
                    <span class="file-type-size">${formatSize(size)}</span>
                </div>
                <span class="download-icon">⬇</span>
            </a>
        `;
    }

    p.innerHTML = `
        ${contentHtml}
        <span class="ticks" id="tick-${messageId}">✓</span>
        <div class="msg-actions-btn" onclick="event.stopPropagation(); toggleMsgMenu('${messageId}')">⋮</div>
        <div class="msg-actions-menu" id="menu-${messageId}">
            <p onclick="deleteMessage('${messageId}')">Delete</p>
        </div>
    `;

    container.appendChild(p);
    messages.appendChild(container);
    messages.scrollTop = messages.scrollHeight;

    myMessages[messageId] = p;
}

// 7. Utilities
function getFileIcon(filename) {
    if (filename.endsWith(".pdf")) return "📄";
    if (filename.match(/\.(doc|docx)$/i)) return "📝";
    if (filename.match(/\.(xls|xlsx)$/i)) return "📊";
    if (filename.endsWith(".zip")) return "📦";
    if (filename.endsWith(".txt")) return "📃";
    return "📁";
}

function formatSize(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function viewImage(src) {
    const win = window.open();
    win.document.write(`<img src="${src}" style="max-width:100%">`);
}


