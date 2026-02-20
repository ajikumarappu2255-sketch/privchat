// ================= SOCKET CONNECTION =================
const socket = io("https://privchat-production.up.railway.app", {
    transports: ["websocket", "polling"],
    withCredentials: true
});
const username = localStorage.getItem("username");
const room = localStorage.getItem("room");
const token = localStorage.getItem("token");

// ================= SUPABASE INIT =================
// Supabase client for file storage (does NOT touch any chat/socket logic)
const SUPABASE_URL = "https://zmntcnftwrfdxdrcizmp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptbnRjbmZ0d3JmZHhkcmNpem1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODQ2NDAsImV4cCI6MjA4NzE2MDY0MH0.duQkcgsjIQ1-LlpEqcnD3mOaC0jOCB8K1oTGdQqoXx0";
const SUPABASE_BUCKET = "chat-files";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);



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
    p.innerHTML = `
        ${replyHtml}
        <span class="msg-text">${parsedText}</span>
        ${isMe ? `<span class="ticks" id="tick-${messageId}">✓</span>` : ""}
        <span class="edited-label" id="edited-${messageId}" style="display:none;">(edited)</span>
    `;

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
        if (isMe) {
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
    if (textSpan) {
        // Clone the span and remove the media-content child so we only get the text
        const clone = textSpan.cloneNode(true);
        const mediaInClone = clone.querySelector(".media-content");
        if (mediaInClone) mediaInClone.remove();
        msgInput.value = clone.innerText.trim();
    } else {
        msgInput.value = p.innerText.trim();
    }

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

        if (textSpan) {
            // Check for media content (files)
            const media = textSpan.querySelector(".media-content");
            const mediaHtml = media ? media.outerHTML : "";

            textSpan.innerHTML = mediaHtml + parsedText;
        } else {
            p.innerHTML = parsedText; // fallback
        }

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
    // Only log out on definitive rejection/closure messages
    const shouldLogout = msg.includes("rejected") || msg.includes("Room closed") || msg.includes("another device");
    if (shouldLogout) {
        setTimeout(logout, 1500);
    }
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

            if (textSpan) {
                // Check for media content (files)
                const media = textSpan.querySelector(".media-content");
                const mediaHtml = media ? media.outerHTML : "";

                textSpan.innerHTML = mediaHtml + parsedText;
            } else {
                p.innerHTML = parsedText; // fallback
            }

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
    const textSpan = msg.querySelector(".msg-text");
    const media = textSpan ? textSpan.querySelector(".media-content") : null;

    let replyContent = "";

    if (media) {
        if (media.querySelector("img")) replyContent = "📷 Photo";
        else if (media.querySelector("video")) replyContent = "🎥 Video";
        else if (media.querySelector("audio")) replyContent = "🎵 Audio";
        else if (media.querySelector(".chat-file")) replyContent = "📁 File";
    }

    const textOnly = textSpan ? textSpan.innerText.replace(replyContent, "").trim() : msg.innerText.trim();
    replyToMessage = replyContent ? (textOnly ? `${replyContent} ${textOnly}` : replyContent) : textOnly;
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
        const media = textSpan ? textSpan.querySelector(".media-content") : null;

        let replyContent = "";

        if (media) {
            if (media.querySelector("img")) replyContent = "📷 Photo";
            else if (media.querySelector("video")) replyContent = "🎥 Video";
            else if (media.querySelector("audio")) replyContent = "🎵 Audio";
            else if (media.querySelector(".chat-file")) replyContent = "📁 File";
        }

        const textOnly = textSpan ? textSpan.innerText.replace(replyContent, "").trim() : msg.innerText.trim();
        replyToMessage = replyContent ? (textOnly ? `${replyContent} ${textOnly}` : replyContent) : textOnly;
        // ============================================

        const replyBox = document.getElementById("replyBox");
        const replyText = document.getElementById("replyText");

        replyText.textContent = replyToMessage;
        replyBox.style.display = "flex";
    }
});


// =======================================================
// ================= FILE SENDING FEATURE =================
// =======================================================

let selectedFiles = [];
const fileInput = document.getElementById("fileInput");
const filePreviewContainer = document.getElementById("filePreviewContainer");
const MAX_FILE_SIZE_MB = 50; // Supabase handles large files — no base64 limit

// Show in-chat warning without disconnecting
function showFileWarning(msg) {
    const warn = document.createElement("div");
    warn.style.cssText = `
        position: fixed;
        top: 14px;
        left: 50%;
        transform: translateX(-50%);
        background: #ff4444;
        color: white;
        padding: 10px 20px;
        border-radius: 20px;
        font-size: 13px;
        font-weight: bold;
        z-index: 99999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        text-align: center;
        max-width: 90%;
    `;
    warn.innerText = "⚠️ " + msg;
    document.body.appendChild(warn);
    setTimeout(() => warn.remove(), 3500);
}

// 1. Listen for file selection
fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Validate and add files
    files.forEach(file => {
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            showFileWarning(`"${file.name}" is too large. Max file size is ${MAX_FILE_SIZE_MB}MB.`);
            return; // Skip this file, user stays in chat
        }
        selectedFiles.push(file);
    });

    renderFilePreviews();

    // Reset input so same file can be selected again if needed (triggered by change)
    fileInput.value = "";
});

// 2. Render Previews
function renderFilePreviews() {
    filePreviewContainer.innerHTML = "";

    if (selectedFiles.length > 0) {
        filePreviewContainer.style.display = "flex";
    } else {
        filePreviewContainer.style.display = "none";
        return;
    }

    selectedFiles.forEach((file, index) => {
        const item = document.createElement("div");
        item.className = "file-preview-item";

        // Remove Button
        const removeBtn = document.createElement("button");
        removeBtn.className = "preview-remove-btn";
        removeBtn.innerHTML = "✖";
        removeBtn.onclick = () => removeFile(index);
        item.appendChild(removeBtn);

        // Preview Content
        if (file.type.startsWith("image/")) {
            const img = document.createElement("img");
            img.src = URL.createObjectURL(file);
            item.appendChild(img);
        } else if (file.type.startsWith("video/")) {
            const video = document.createElement("video");
            video.src = URL.createObjectURL(file);
            item.appendChild(video);
        } else {
            // Generic Icon
            const icon = document.createElement("div");
            icon.className = "file-preview-icon";
            icon.innerHTML = getFileIcon(file.type);
            item.appendChild(icon);

            const name = document.createElement("div");
            name.className = "file-preview-name";
            name.innerText = file.name;
            item.appendChild(name);
        }

        filePreviewContainer.appendChild(item);
    });
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFilePreviews();
}

function getFileIcon(type) {
    if (type.includes("pdf")) return "📄";
    if (type.includes("audio")) return "🎵";
    return "📁";
}

// ================= SUPABASE FILE UPLOAD =================
// Uploads a file to Supabase Storage and returns the public URL.
// Replaces the old fileToBase64 approach — only this function changes.
async function uploadToSupabase(file) {
    // Sanitize filename: remove spaces and special characters
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadPath = `${Date.now()}-${safeName}`;

    // Upload to Supabase bucket
    const { data, error } = await supabaseClient
        .storage
        .from(SUPABASE_BUCKET)
        .upload(uploadPath, file, {
            cacheControl: "3600",
            upsert: false
        });

    if (error) {
        console.error("Supabase upload error:", error.message);
        throw new Error("Upload failed: " + error.message);
    }

    // Get the public URL
    const { data: urlData } = supabaseClient
        .storage
        .from(SUPABASE_BUCKET)
        .getPublicUrl(uploadPath);

    return urlData.publicUrl;
}

// ================= UPDATE SEND MESSAGE =================
async function sendMessage() {
    const msgText = msgInput.value.trim();

    // Prevent empty send
    if (!msgText && selectedFiles.length === 0) return;

    // 🔹 EDIT MODE (Text Only for now, disabling file attachment adding during edit for simplicity)
    if (isEditing && editingMessageId) {
        // ... (Edit logic remains similar, but ensure we don't accidentally wipe existing files if we just edit text)
        // For this task, strict rule: "Do NOT break edit". 
        // Existing edit logic only replaces text. 
        // Improvement: If message had files, we should probably keep them? 
        // Current implementation replaces innerHTML in optimistic update.

        socket.emit("editMsg", { room, messageId: editingMessageId, newText: msgText });

        // Optimistic update
        const p = myMessages[editingMessageId];
        if (p) {
            const textSpan = p.querySelector(".msg-text");
            // ✅ Parse Mentions for Optimistic Edit
            const parsedText = msgText.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

            // If textSpan exists, we only update text. This preserves other siblings like images?
            // Actually, initial structure: innerHTML = ... <span class="msg-text">...</span> ...
            // So updating textSpan.innerHTML is safe for files IF files are outside textSpan.
            // My plan below puts files INSIDE msg-text or sibling? 
            // BEST PRACTICE: Put files as separate block inside bubble.

            if (textSpan) {
                // Preserve any media-content (files/images) — only update text part
                const media = textSpan.querySelector(".media-content");
                const mediaHtml = media ? media.outerHTML : "";
                textSpan.innerHTML = mediaHtml + parsedText;
            } else {
                // Fallback (older messages with no textSpan)
                p.innerHTML = parsedText;
            }

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

    // ================= NORMAL SEND =================

    // Show Loading if files present
    if (selectedFiles.length > 0) {
        sendBtn.disabled = true;
        sendBtn.innerText = "Sending...";
    }

    let fileHtmlContent = "";

    try {
        // ===== SUPABASE UPLOAD: replaces old fileToBase64 approach =====
        for (const file of selectedFiles) {
            // Upload to Supabase and get public URL
            const publicUrl = await uploadToSupabase(file);

            // Escape filename for safe display
            const safeName = file.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "&#64;");

            // Build file HTML using the public URL (same structure as before)
            if (file.type.startsWith("image/")) {
                fileHtmlContent += `<img src="${publicUrl}" class="chat-media" onclick="viewMedia(this.src, 'image')"><br>`;
            } else if (file.type.startsWith("video/")) {
                fileHtmlContent += `<video src="${publicUrl}" controls class="chat-media"></video><br>`;
            } else if (file.type.startsWith("audio/")) {
                fileHtmlContent += `<audio src="${publicUrl}" controls class="chat-media"></audio><br>`;
            } else {
                // Document / PDF / other
                fileHtmlContent += `
                <a href="${publicUrl}" download="${safeName}" target="_blank" class="chat-file">
                    <div class="chat-file-icon">${getFileIcon(file.type)}</div>
                    <div class="chat-file-info">
                        <span class="chat-file-name">${safeName}</span>
                        <span class="chat-file-size">${(file.size / 1024).toFixed(1)} KB</span>
                    </div>
                </a><br>`;
            }
        }
        // ===== END SUPABASE UPLOAD =====
    } catch (err) {
        console.error("File upload error", err);
        showFileWarning("Upload failed. Check your connection and try again.");
        sendBtn.disabled = false;
        sendBtn.innerText = "Send";
        return;
    }

    // Wrap files in a container if they exist
    if (fileHtmlContent) {
        fileHtmlContent = `<span class="media-content" style="display:block;">${fileHtmlContent}</span>`;
    }

    let combinedMsg = fileHtmlContent + msgText;
    let finalMsg = combinedMsg;

    // ✅ Add reply prefix if replying
    if (replyToMessage) {
        finalMsg = `Reply to: "${replyToMessage}"\n${finalMsg}`;
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

    // Detect Emoji
    // Warning: Regex might match base64. Only run emoji check on text part? 
    // Ideally we skip emoji class if it has files.
    const isEmoji = !fileHtmlContent && /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(msgText);
    if (isEmoji) p.classList.add("emoji-msg");

    // Reply Logic
    let replyHtml = "";
    let cleanContent = finalMsg;

    if (finalMsg.startsWith("Reply to:")) {
        const match = finalMsg.match(/^Reply to: "((?:.|\n)*?)"\n((?:.|\n)*)$/);
        if (match) {
            replyHtml = `
            <div class="reply-preview">
                <strong>Replied to:</strong>
                <span>${match[1]}</span>
            </div>
            `;
            cleanContent = match[2];
        }
    }

    // Parse Mentions (only in text)
    // We assume cleanContent = <span class="media-content">...</span> text
    // We can't easily split it safely with regex since HTML nests.
    // BUT we know we constructed it as fileHtmlContent + msgText.
    // Simplification: just parse mentions in the WHOLE string. 
    // Base64 is safe (no @).
    const parsedCleanText = cleanContent.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

    // Structural Fix: Use .msg-text to match receiver logic
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
    menu.innerHTML = `
      <p onclick="startEditMessage('${messageId}')">Edit</p>
      <p onclick="deleteMessage('${messageId}')">Delete</p>
    `;

    p.appendChild(menuBtn);
    p.appendChild(menu);

    container.appendChild(p);
    messages.appendChild(container); // Append properly
    messages.scrollTop = messages.scrollHeight;

    myMessages[messageId] = p;

    socket.emit("privateMsg", {
        room,
        message: `${username}: ${finalMsg}`,
        messageId,
        sender: socket.id
    });

    // Cleanup
    msgInput.value = "";
    selectedFiles = [];
    renderFilePreviews();
    sendBtn.disabled = false;
    sendBtn.innerText = "Send";
    stopTyping();
}

// Media Viewer (Optional simple lightbox)
function viewMedia(src, type) {
    if (type === 'image') {
        const win = window.open("", "_blank");
        win.document.write(`<img src="${src}" style="max-width:100%">`);
    }
}

// =====================================================
// =========== SECURITY MONITORING SYSTEM =============
// =====================================================
// Deterrence + enforcement system. No existing logic touched.

(function initSecurityMonitor() {

    // --- Config ---
    let warningCount = 0;
    const MAX_WARNINGS = 2;

    // Determine if current user is the room owner
    // Owners are not monitored (they have full access)
    const isOwner = (localStorage.getItem("token") === "owner");

    // DOM refs
    const overlay = document.getElementById("securityOverlay");
    const countMsg = document.getElementById("securityCountMsg");
    const appRoot = document.querySelector(".app");

    // --- Central warning function ---
    function triggerSecurityWarning(type) {
        if (isOwner) return; // Never warn the owner

        warningCount++;

        // Emit to server → forwards to room owner
        socket.emit("security-warning", {
            room,
            user: username,
            type,
            count: warningCount
        });

        if (warningCount >= MAX_WARNINGS) {
            // 2nd violation → kick immediately
            kickUser();
            return;
        }

        // 1st violation → show warning overlay + blur
        showSecurityOverlay(`Warning ${warningCount}/${MAX_WARNINGS}: You have 1 chance remaining.`);

        // Auto-dismiss overlay after 4s and unblur
        setTimeout(hideSecurityOverlay, 4000);
    }

    // --- Show overlay + blur ---
    function showSecurityOverlay(message) {
        countMsg.textContent = message;
        overlay.style.display = "flex";
        if (appRoot) appRoot.classList.add("chat-blurred");
    }

    // --- Hide overlay + unblur ---
    function hideSecurityOverlay() {
        overlay.style.display = "none";
        if (appRoot) appRoot.classList.remove("chat-blurred");
    }

    // --- Auto-kick ---
    function kickUser() {
        overlay.style.display = "none";

        socket.emit("kick-user", { room, user: username });

        // Small delay so socket event fires before redirect
        setTimeout(() => {
            alert("⛔ You have been removed due to suspicious activity.");
            window.location.href = "/login.html";
        }, 300);
    }

    // ===================================================
    // A. TAB SWITCH / APP BACKGROUND (3s grace period)
    //    visibilitychange fires on both desktop and mobile
    // ===================================================
    let bgTimer = null;
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            // Start a 3-second grace period before counting as a violation
            bgTimer = setTimeout(() => {
                triggerSecurityWarning("APP_BACKGROUND");
            }, 3000);
        } else {
            // User came back before grace period — cancel
            clearTimeout(bgTimer);
            bgTimer = null;
            hideSecurityOverlay();
        }
    });

    // ===================================================
    // B. MOBILE: pagehide (fires when app fully minimised)
    // ===================================================
    window.addEventListener("pagehide", () => {
        clearTimeout(bgTimer);
        triggerSecurityWarning("APP_BACKGROUND");
    });

    // ===================================================
    // C. KEY SHORTCUTS: PrintScreen, Ctrl+Shift+S, Ctrl+P
    // ===================================================
    document.addEventListener("keydown", (e) => {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        if (
            e.key === "PrintScreen" ||
            (ctrl && shift && e.key.toLowerCase() === "s") ||
            (ctrl && e.key.toLowerCase() === "p")
        ) {
            e.preventDefault();
            triggerSecurityWarning("SCREENSHOT_ATTEMPT");
        }
    });

    // ===================================================
    // D. DEVTOOLS DETECTION
    //    Large gap between outerWidth and innerWidth
    //    indicates devtools panel is open on the side
    // ===================================================
    let devToolsOpen = false;
    setInterval(() => {
        if (isOwner) return;
        const threshold = 160;
        const widthDiff = window.outerWidth - window.innerWidth;
        const heightDiff = window.outerHeight - window.innerHeight;

        if (widthDiff > threshold || heightDiff > threshold) {
            if (!devToolsOpen) {
                devToolsOpen = true;
                triggerSecurityWarning("DEVTOOLS_OPEN");
            }
        } else {
            devToolsOpen = false;
        }
    }, 2000);

    // ===================================================
    // OWNER: receive security warning notifications
    // ===================================================
    socket.on("security-warning", ({ user, type, count }) => {
        if (!isOwner) return; // Only owner sees these notices

        const notice = document.createElement("div");
        notice.className = "security-notice";
        notice.textContent = `🔔 ${user} triggered "${type}" (warning ${count}/${MAX_WARNINGS})`;

        const msgContainer = document.getElementById("messages");
        if (msgContainer) {
            msgContainer.appendChild(notice);
            msgContainer.scrollTop = msgContainer.scrollHeight;
        }
    });

    // ===================================================
    // OWNER: receive user-kicked notification
    // ===================================================
    socket.on("user-kicked", (kickedUser) => {
        if (!isOwner) return;
        const notice = document.createElement("div");
        notice.className = "security-notice";
        notice.textContent = `⛔ ${kickedUser} was auto-kicked for suspicious activity.`;
        const msgContainer = document.getElementById("messages");
        if (msgContainer) {
            msgContainer.appendChild(notice);
            msgContainer.scrollTop = msgContainer.scrollHeight;
        }
    });

    // ===================================================
    // WATERMARK: diagonal tiled username + timestamp
    // ===================================================
    function buildWatermark() {
        const wm = document.getElementById("chatWatermark");
        if (!wm) return;
        wm.innerHTML = ""; // Clear old tiles

        const now = new Date();
        const stamp = now.toLocaleString("en-IN", { hour12: true });
        const label = `${username}  ${stamp}`;

        // Tile every 220x120px
        const cols = Math.ceil(window.innerWidth / 200) + 2;
        const rows = Math.ceil(window.innerHeight / 110) + 2;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const tile = document.createElement("span");
                tile.className = "watermark-tile";
                tile.textContent = label;
                tile.style.left = `${c * 210 - 60}px`;
                tile.style.top = `${r * 115}px`;
                wm.appendChild(tile);
            }
        }
    }

    // Build watermark immediately, refresh timestamp every 60s
    buildWatermark();
    setInterval(buildWatermark, 60000);
    window.addEventListener("resize", buildWatermark);

})(); // IIFE — keeps all security vars private, zero pollution
