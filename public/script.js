// ================= SOCKET CONNECTION =================
const SOCKET_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? window.location.origin
    : "https://privchat-production.up.railway.app";
const socket = io(SOCKET_URL, {
    transports: ["websocket", "polling"],
    withCredentials: true
});
const username = localStorage.getItem("username");
const room = localStorage.getItem("room");
const token = localStorage.getItem("token");

// ================= SUPABASE INIT =================
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
const onlineUsersDiv = document.getElementById("onlineUsers");

// ================= REPLY FEATURE VARIABLES =================
let replyToMessage = null;
let selectedReplyMsg = null;
let startX = 0;

let typingIndicator = document.getElementById("typingIndicator");

const myMessages = {};
let isEditing = false;
let editingMessageId = null;

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

    const container = document.createElement("div");
    container.className = isMe ? "msg-container self" : "msg-container";

    let replyHtml = "";
    let cleanText = text;

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

    const parsedText = cleanText.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

    const p = document.createElement("div");
    p.className = isMe ? "msg-bubble self" : "msg-bubble";
    if (messageId) p.dataset.id = messageId;

    const isEmoji = /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(parsedText.replace(/<[^>]*>/g, ""));
    if (isEmoji) p.classList.add("emoji-msg");

    p.innerHTML = `
        ${replyHtml}
        <span class="msg-text">${parsedText}</span>
        ${isMe ? `<span class="ticks" id="tick-${messageId}">✓</span>` : ""}
        <span class="edited-label" id="edited-${messageId}" style="display:none;">(edited)</span>
    `;

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
        if (isMe) {
            menuOptions += `<p onclick="startEditMessage('${messageId}')">Edit</p>`;
        }
        menuOptions += `<p onclick="deleteMessage('${messageId}')">Delete</p>`;
        menu.innerHTML = menuOptions;

        p.appendChild(menuBtn);
        p.appendChild(menu);
    }

    container.appendChild(p);
    messages.appendChild(container);
    messages.scrollTop = messages.scrollHeight;

    myMessages[messageId] = p;

    if (!isMe && messageId) {
        socket.emit("messageRead", { room, messageId, username });
    }
});

// Close menus on click elsewhere
document.addEventListener("click", () => {
    document.querySelectorAll(".msg-actions-menu").forEach(m => m.style.display = "none");
});

function toggleMsgMenu(id) {
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
    const p = document.querySelector(`.msg-bubble[data-id="${messageId}"]`);
    if (p) {
        const textSpan = p.querySelector(".msg-text");
        const parsedText = newText.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

        if (textSpan) {
            const media = textSpan.querySelector(".media-content");
            const mediaHtml = media ? media.outerHTML : "";
            textSpan.innerHTML = mediaHtml + parsedText;
        } else {
            p.innerHTML = parsedText;
        }

        const editedLabel = p.querySelector(".edited-label");
        if (editedLabel) editedLabel.style.display = "inline";
    }
});

socket.on("deleteMsg", ({ messageId }) => {
    const p = document.querySelector(`.msg-bubble[data-id="${messageId}"]`);
    if (p) {
        p.innerHTML = `<span class="deleted-msg">This message was deleted</span>`;
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

// ================= WARNING MESSAGE — SINGLE HANDLER =================
// ✅ FIX: Removed duplicate handler. Only ONE warningMsg listener now.
socket.on("warningMsg", msg => {
    const div = document.createElement("div");
    div.className = "message warning";
    div.innerHTML = `<strong style="color:#cc0000;">⚠️ ${msg}</strong>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;

    const shouldLogout = msg.includes("rejected") || msg.includes("Room closed") || msg.includes("another device");
    if (shouldLogout) {
        setTimeout(logout, 1500);
    }
});

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
// ================= EMOJI FEATURE ====================
// =====================================================
const emojiBtn = document.getElementById("emojiBtn");
const emojiPicker = document.getElementById("emojiPicker");

emojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPicker.style.display =
        emojiPicker.style.display === "block" ? "none" : "block";
});

emojiPicker.addEventListener("click", (e) => {
    if (e.target.tagName === "SPAN") {
        msgInput.value += e.target.textContent;
        msgInput.focus();
    }
});

document.addEventListener("click", () => {
    emojiPicker.style.display = "none";
});

// ================= ONLINE USERS =================
socket.on("roomUsers", ({ users }) => {
    currentRoomUsers = users;
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
    words.pop();
    words.push(`@${user} `);
    msgInput.value = words.join(" ");
    hideMentionDropdown();
    msgInput.focus();
}

document.addEventListener("click", (e) => {
    if (e.target.closest("#mentionDropdown")) return;
    hideMentionDropdown();
});

// ================= REPLY FEATURE: Desktop + Mobile =================
messages.addEventListener("dblclick", (e) => {
    const msg = e.target.closest(".msg-bubble");
    if (!msg) return;

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

    const replyBox = document.getElementById("replyBox");
    const replyText = document.getElementById("replyText");
    replyText.textContent = replyToMessage;
    replyBox.style.display = "flex";
});

messages.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
});

messages.addEventListener("touchend", (e) => {
    const endX = e.changedTouches[0].clientX;
    const msg = e.target.closest(".msg-bubble");
    if (!msg) return;

    if (endX - startX > 80) {
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
const MAX_FILE_SIZE_MB = 50;

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

fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    files.forEach(file => {
        if (file.size === 0) {
            showFileWarning(`"${file.name}" appears to be empty or a cloud-only file. Please make sure it's fully downloaded first.`);
            return;
        }
        if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            showFileWarning(`"${file.name}" is too large. Max file size is ${MAX_FILE_SIZE_MB}MB.`);
            return;
        }
        selectedFiles.push(file);
    });

    renderFilePreviews();
    fileInput.value = "";
});

function renderFilePreviews() {
    Array.from(filePreviewContainer.querySelectorAll('.file-preview-item')).forEach(el => el.remove());

    const viewOnceContainer = document.getElementById('viewOnceContainer');
    if (selectedFiles.length > 0) {
        filePreviewContainer.style.display = "flex";
        if (viewOnceContainer) viewOnceContainer.style.display = "inline-flex";
    } else {
        filePreviewContainer.style.display = "none";
        if (viewOnceContainer) {
            viewOnceContainer.style.display = "none";
            const voChk = document.getElementById('viewOnceCheckbox');
            if (voChk) voChk.checked = false;
        }
        return;
    }

    selectedFiles.forEach((file, index) => {
        const item = document.createElement("div");
        item.className = "file-preview-item";

        const removeBtn = document.createElement("button");
        removeBtn.className = "preview-remove-btn";
        removeBtn.innerHTML = "\u2716";
        removeBtn.onclick = () => removeFile(index);
        item.appendChild(removeBtn);

        if (file.type.startsWith("image/")) {
            const img = document.createElement("img");
            img.src = URL.createObjectURL(file);
            item.appendChild(img);
        } else if (file.type.startsWith("video/")) {
            const video = document.createElement("video");
            video.src = URL.createObjectURL(file);
            item.appendChild(video);
        } else {
            const icon = document.createElement("div");
            icon.className = "file-preview-icon";
            icon.innerHTML = getFileIcon(file.type);
            item.appendChild(icon);

            const name = document.createElement("div");
            name.className = "file-preview-name";
            name.innerText = file.name;
            item.appendChild(name);
        }

        if (viewOnceContainer && viewOnceContainer.parentNode === filePreviewContainer) {
            filePreviewContainer.insertBefore(item, viewOnceContainer);
        } else {
            filePreviewContainer.appendChild(item);
        }
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

async function uploadToSupabase(file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uploadPath = `${Date.now()}-${safeName}`;

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

    const { data: urlData } = supabaseClient
        .storage
        .from(SUPABASE_BUCKET)
        .getPublicUrl(uploadPath);

    return urlData.publicUrl;
}

async function sendMessage() {
    const msgText = msgInput.value.trim();

    if (!msgText && selectedFiles.length === 0) return;

    if (isEditing && editingMessageId) {
        socket.emit("editMsg", { room, messageId: editingMessageId, newText: msgText });

        const p = myMessages[editingMessageId];
        if (p) {
            const textSpan = p.querySelector(".msg-text");
            const parsedText = msgText.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

            if (textSpan) {
                const media = textSpan.querySelector(".media-content");
                const mediaHtml = media ? media.outerHTML : "";
                textSpan.innerHTML = mediaHtml + parsedText;
            } else {
                p.innerHTML = parsedText;
            }

            const editedLabel = p.querySelector(".edited-label");
            if (editedLabel) editedLabel.style.display = "inline";
        }

        isEditing = false;
        editingMessageId = null;
        sendBtn.innerText = "Send";
        msgInput.value = "";
        return;
    }

    if (selectedFiles.length > 0) {
        sendBtn.disabled = true;
        sendBtn.innerText = "Sending...";
    }

    let fileHtmlContent = "";

    try {
        for (const file of selectedFiles) {
            const publicUrl = await uploadToSupabase(file);
            const safeName = file.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "&#64;");

            let fileTypeCategory = "document";
            if (file.type.startsWith("image/")) fileTypeCategory = "image";
            else if (file.type.startsWith("video/")) fileTypeCategory = "video";
            else if (file.type.startsWith("audio/")) fileTypeCategory = "audio";

            const isViewOnce = document.getElementById('viewOnceCheckbox') && document.getElementById('viewOnceCheckbox').checked;

            if (isViewOnce) {
                const encodedUrl = encodeURIComponent(publicUrl);
                if (fileTypeCategory === "document" || fileTypeCategory === "audio") {
                    fileHtmlContent += `
                    <button class="view-once-btn" data-url="${encodedUrl}" onclick="viewDocument(this)" oncontextmenu="return false;">
                        <span>${getFileIcon(file.type)}</span>
                        <span>View Once: ${safeName}</span>
                    </button><br>`;
                } else {
                    const icon = fileTypeCategory === "image" ? "🖼️" : "🎬";
                    fileHtmlContent += `
                    <button class="view-once-btn" data-url="${encodedUrl}" onclick="viewMedia(&quot;${encodedUrl}&quot;, &quot;${fileTypeCategory}&quot;, this)" oncontextmenu="return false;">
                        <span>${icon}</span>
                        <span>View Once: ${safeName}</span>
                    </button><br>`;
                }
            } else {
                if (fileTypeCategory === "image") {
                    fileHtmlContent += `<img src="${publicUrl}" class="chat-media" draggable="false" oncontextmenu="return false;" onclick="viewMedia(this.src, 'image', null)"><br>`;
                } else if (fileTypeCategory === "video") {
                    fileHtmlContent += `<video src="${publicUrl}" controls controlsList="nodownload" oncontextmenu="return false;" class="chat-media"></video><br>`;
                } else if (fileTypeCategory === "audio") {
                    fileHtmlContent += `<audio src="${publicUrl}" controls controlsList="nodownload" oncontextmenu="return false;" class="chat-media"></audio><br>`;
                } else {
                    fileHtmlContent += `
                    <a href="${publicUrl}" target="_blank" draggable="false" oncontextmenu="return false;" class="chat-file">
                        <div class="chat-file-icon">${getFileIcon(file.type)}</div>
                        <div class="chat-file-info">
                            <span class="chat-file-name">${safeName}</span>
                            <span class="chat-file-size">${(file.size / 1024).toFixed(1)} KB</span>
                        </div>
                    </a><br>`;
                }
            }
        }
    } catch (err) {
        console.error("File upload error", err);
        showFileWarning(err.message || "Upload failed. Please try again.");
        sendBtn.disabled = false;
        sendBtn.innerText = "Send";
        return;
    }

    if (fileHtmlContent) {
        fileHtmlContent = `<span class="media-content" style="display:block;">${fileHtmlContent}</span>`;
    }

    let combinedMsg = fileHtmlContent + msgText;
    let finalMsg = combinedMsg;

    if (replyToMessage) {
        finalMsg = `Reply to: "${replyToMessage}"\n${finalMsg}`;
        cancelReply();
    }

    const messageId = Date.now() + "_" + Math.random().toString(36).slice(2);

    const container = document.createElement("div");
    container.className = "msg-container self";

    const p = document.createElement("div");
    p.className = "msg-bubble self";
    p.dataset.id = messageId;

    const isEmoji = !fileHtmlContent && /^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\s)+$/u.test(msgText);
    if (isEmoji) p.classList.add("emoji-msg");

    let replyHtml = "";
    let cleanContent = finalMsg;

    if (finalMsg.startsWith("Reply to:")) {
        const match = finalMsg.match(/^Reply to: "((?:.|\n)*?)"\n((?:.|\n)*)$/);
        if (match) {
            replyHtml = `
            <div class="reply-preview">
                <strong>Replied to:</strong>
                <span>${match[1]}</span>
            </div>`;
            cleanContent = match[2];
        }
    }

    const parsedCleanText = cleanContent.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

    p.innerHTML = `
        ${replyHtml}
        <span class="msg-text">${parsedCleanText}</span>
        <span class="ticks" id="tick-${messageId}">✓</span>
        <span class="edited-label" id="edited-${messageId}" style="display:none;">(edited)</span>
    `;

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
    selectedFiles = [];
    renderFilePreviews();
    const voChk = document.getElementById('viewOnceCheckbox');
    if (voChk) voChk.checked = false;
    const voContainer = document.getElementById('viewOnceContainer');
    if (voContainer) voContainer.style.display = "none";
    sendBtn.disabled = false;
    sendBtn.innerText = "Send";
    stopTyping();
}

// ================= MEDIA VIEWER =================
window.viewMedia = function (encodedUrl, type, btnElement) {
    if (btnElement && btnElement.disabled) return;
    currentViewOnceButton = btnElement || null;

    const url = decodeURIComponent(encodedUrl);
    const modal = document.getElementById('mediaModal');
    const content = document.getElementById('mediaModalContent');

    if (type === 'image') {
        content.innerHTML = '<img src="' + url + '" draggable="false" oncontextmenu="return false;">';
    } else if (type === 'video') {
        content.innerHTML = '<video src="' + url + '" controls controlsList="nodownload" autoplay oncontextmenu="return false;"></video>';
    }

    modal.style.display = 'flex';
};

window.viewDocument = function (btnElement) {
    if (btnElement.disabled) return;

    const encodedUrl = btnElement.getAttribute('data-url');
    const url = decodeURIComponent(encodedUrl);
    window.open(url, '_blank');

    if (!btnElement.closest('.self')) {
        btnElement.innerHTML = '<span>🚫</span> <span>Viewed</span>';
        btnElement.disabled = true;
        btnElement.removeAttribute('data-url');
        btnElement.removeAttribute('onclick');
    }
};

window.closeMediaModal = function () {
    const modal = document.getElementById('mediaModal');
    const content = document.getElementById('mediaModalContent');

    content.innerHTML = '';
    modal.style.display = 'none';

    if (currentViewOnceButton && !currentViewOnceButton.closest('.self')) {
        currentViewOnceButton.innerHTML = '<span>🚫</span> <span>Viewed</span>';
        currentViewOnceButton.disabled = true;
        currentViewOnceButton.removeAttribute('data-url');
        currentViewOnceButton.removeAttribute('onclick');
    }
    currentViewOnceButton = null;
};

// =======================================================
// ================= PRIVACY PROTECTIONS =================
// =======================================================
let privacyKickTriggered = false;
let privacyHideTimer = null;
let currentViewOnceButton = null;

// Create overlay element once and reuse
function getOrCreateOverlay(message) {
    let overlay = document.querySelector('.privacy-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'privacy-overlay';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = message;
    return overlay;
}

// Immediately blur the screen (temporary - can be reversed)
function blurScreen(message) {
    getOrCreateOverlay(message);
    document.body.classList.add('privacy-screen');
}

// Remove temporary blur
function unblurScreen() {
    document.body.classList.remove('privacy-screen');
}

// Permanent kick - blur + redirect
function triggerPrivacyAlert(reason) {
    if (privacyKickTriggered) return;
    privacyKickTriggered = true;

    getOrCreateOverlay('🛡️ Privacy Protection Active<br><span style="font-size:14px;font-weight:normal;margin-top:10px;display:block;">Removing you from the room...</span>');

    document.body.classList.remove('privacy-screen');
    document.body.classList.add('privacy-blur');

    setTimeout(() => {
        socket.disconnect();
        localStorage.clear();
        window.location.href = 'login.html';
    }, 1500);
}

// ── Desktop: PrintScreen key ──────────────────────────────
window.addEventListener('keydown', (e) => {
    if (e.key === 'PrintScreen') {
        e.preventDefault();
        e.stopPropagation();
        blurScreen('🛡️ Screenshots are blocked in this chat');
        for (let i = 0; i < 5; i++) {
            navigator.clipboard.writeText('Screenshots are blocked.').catch(() => {});
        }
    }
}, true);

window.addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen') {
        triggerPrivacyAlert('attempted a screenshot (PrintScreen key)!');
        navigator.clipboard.writeText('Screenshots are disabled in this chat.').catch(() => {});
    }
});

// ── Tab switch / app minimize (all platforms) ─────────────
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        // Blur immediately so screen is hidden in the app switcher thumbnail
        blurScreen('🛡️ Screen protected<br><span style="font-size:14px;font-weight:normal;margin-top:8px;display:block;">Return to the chat to continue</span>');

        // Grace period: file picker / system UI comes back quickly
        privacyHideTimer = setTimeout(() => {
            if (document.visibilityState === 'hidden') {
                triggerPrivacyAlert('switched tabs or minimized the app!');
            }
        }, 800);
    } else if (document.visibilityState === 'visible') {
        clearTimeout(privacyHideTimer);
        if (!privacyKickTriggered) {
            unblurScreen();
        }
    }
});
