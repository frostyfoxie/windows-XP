/**
 * MSN Messenger '05 Encrypted ChitChat Enclave Module
 * Cryptographically secured with PBKDF2 (100k SHA-256 iterations) + AES-256-GCM.
 * Features:
 *  - Full two-way realtime DMs with automatic inbox discovery
 *  - Block/Unblock buddy in DMs with cloud-persisted blocklist
 *  - Delete DM conversation and clear conversation history
 *  - Exit from Group with presence unregistration
 *  - Chunked safe file/image encryption (no call-stack limits)
 *  - Nudge button strictly enabled in DMs with audio & window-shake
 */
window.MSNMessenger = (function () {
  let db = null;
  let userId = null;
  let username = null;
  let userAvatar = null;
  let userStatus = 'online';
  let userStatusMsg = 'Listening to: 4. Crusher-P - Echo (3:50) ♪';

  let activeGroupId = null;
  let activeDMId = null;
  let activeBuddyId = null;
  let currentEncryptionKey = null;
  let participantsVisible = true;

  const joinedGroups = new Set();
  const groupPasswords = {};
  const startedDMs = new Set();
  const blockedUsers = new Set();

  function init(firebaseDatabase, userState) {
    db = firebaseDatabase;
    userId = userState.userId;
    username = userState.username;
    userAvatar = userState.avatar;
    userStatus = userState.status || 'online';
    userStatusMsg = userState.statusMsg || 'Listening to: 4. Crusher-P - Echo (3:50) ♪';

    if (userState.joinedGroups) userState.joinedGroups.forEach(g => joinedGroups.add(g));
    if (userState.groupPasswords) Object.assign(groupPasswords, userState.groupPasswords);
    if (userState.startedDMs) userState.startedDMs.forEach(d => startedDMs.add(d));
    if (userState.blockedUsers) userState.blockedUsers.forEach(b => blockedUsers.add(b));

    updateNudgeVisibility();
    renderSidebarItems();
    updateUI();
    listenInboxDMs();
  }

  function sanitizePath(id) {
    return (id || '').replace(/[.#$\[\]\/]/g, '_').trim();
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  async function deriveKey(password, saltStr) {
    const salt = new TextEncoder().encode(saltStr);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptData(data) {
    if (!currentEncryptionKey) throw new Error("Encryption key not derived.");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, currentEncryptionKey, data);
    return {
      iv: Array.from(iv),
      data: arrayBufferToBase64(enc)
    };
  }

  async function decryptData(obj) {
    if (!currentEncryptionKey) throw new Error("Encryption key not derived.");
    const buf = base64ToArrayBuffer(obj.data);
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(obj.iv) },
      currentEncryptionKey,
      buf
    );
  }

  // Realtime Inbox Listener
  function listenInboxDMs() {
    if (!db || !userId) return;
    db.ref(`users/${userId}/dms`).on('child_added', snap => {
      const buddyId = snap.key;
      if (buddyId && buddyId !== userId) {
        startedDMs.add(buddyId);
        addDMToList(buddyId);
        persistState();
      }
    });

    db.ref(`users/${userId}/dms`).on('child_removed', snap => {
      const buddyId = snap.key;
      startedDMs.delete(buddyId);
      const item = document.querySelector(`#dmList .group-item[data-id="${buddyId}"]`);
      if (item) item.remove();
      persistState();
    });
  }

  function updateNudgeVisibility() {
    const nudgeBtn = document.getElementById('msnNudgeBtn');
    if (!nudgeBtn) return;
    if (activeDMId) {
      const isBlocked = activeBuddyId && blockedUsers.has(activeBuddyId);
      nudgeBtn.style.opacity = isBlocked ? '0.4' : '1';
      nudgeBtn.style.cursor = isBlocked ? 'not-allowed' : 'pointer';
      nudgeBtn.title = isBlocked ? 'Cannot nudge a blocked buddy' : 'Send MSN Nudge (Shakes Buddy Screen)';
    } else {
      nudgeBtn.style.opacity = '0.4';
      nudgeBtn.style.cursor = 'not-allowed';
      nudgeBtn.title = 'Nudge is only available in 1-on-1 Buddy Chats (DMs)';
    }
  }

  function updateHeaderControls() {
    const exitBtn = document.getElementById('exitGroupBtn');
    const blockBtn = document.getElementById('blockBuddyBtn');
    const deleteBtn = document.getElementById('deleteDmBtn');
    const input = document.getElementById('messageText');

    if (activeGroupId) {
      if (exitBtn) exitBtn.style.display = 'inline-flex';
      if (blockBtn) blockBtn.style.display = 'none';
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (input) {
        input.disabled = false;
        input.placeholder = "Type a message in #" + activeGroupId + "...";
      }
    } else if (activeDMId && activeBuddyId) {
      if (exitBtn) exitBtn.style.display = 'none';
      if (blockBtn) {
        blockBtn.style.display = 'inline-flex';
        const isBlocked = blockedUsers.has(activeBuddyId);
        blockBtn.innerHTML = isBlocked
          ? '<i class="fas fa-check-circle" style="color:#39b54a;"></i> Unblock'
          : '<i class="fas fa-ban" style="color:#c22f0e;"></i> Block';
        blockBtn.title = isBlocked ? "Unblock this buddy" : "Block this buddy";
      }
      if (deleteBtn) deleteBtn.style.display = 'inline-flex';

      const isBlocked = blockedUsers.has(activeBuddyId);
      if (input) {
        input.disabled = isBlocked;
        input.placeholder = isBlocked
          ? "[Blocked] You have blocked this buddy. Click Unblock to chat."
          : "Type a direct message to " + activeBuddyId + "...";
      }
    } else {
      if (exitBtn) exitBtn.style.display = 'none';
      if (blockBtn) blockBtn.style.display = 'none';
      if (deleteBtn) deleteBtn.style.display = 'none';
      if (input) {
        input.disabled = true;
        input.placeholder = "Select or join a conversation first...";
      }
    }
  }

  // Group Operations
  async function joinGroup() {
    const rawGid = document.getElementById('groupIdInput').value.trim();
    const pwd = document.getElementById('groupPasswordInput').value;

    if (!rawGid || !pwd) {
      alert("Please enter both a Room ID and an Encryption Passphrase.");
      return;
    }

    const gid = sanitizePath(rawGid);

    try {
      detachActiveChatListeners();

      activeGroupId = gid;
      activeDMId = null;
      activeBuddyId = null;
      currentEncryptionKey = await deriveKey(pwd, gid);

      joinedGroups.add(gid);
      groupPasswords[gid] = pwd;
      persistState();

      if (db) {
        db.ref(`groups/${gid}/users/${userId}`).set({
          username,
          avatar: userAvatar,
          status: userStatus,
          lastSeen: Date.now()
        }).catch(e => console.warn("Firebase presence sync error:", e));
      }

      updateChatHeader(`Group: #${gid}`, gid[0].toUpperCase(), true);
      addGroupToList(gid);
      listenGroupMessages();
      loadGroupParticipants();
      updateNudgeVisibility();
      updateHeaderControls();

      document.getElementById('groupIdInput').value = '';
      document.getElementById('groupPasswordInput').value = '';
    } catch (err) {
      console.error(err);
      alert("Encryption key derivation error: " + err.message);
    }
  }

  function exitGroup() {
    if (!activeGroupId) return;
    const gid = activeGroupId;
    if (!confirm(`Are you sure you want to leave #${gid}?`)) return;

    if (db) {
      db.ref(`groups/${gid}/users/${userId}`).remove().catch(e => console.warn(e));
      db.ref(`groups/${gid}/messages`).off();
      db.ref(`groups/${gid}/users`).off();
    }

    joinedGroups.delete(gid);
    delete groupPasswords[gid];

    const groupEl = document.querySelector(`#groupList .group-item[data-id="${gid}"]`);
    if (groupEl) groupEl.remove();

    persistState();
    resetToWelcomeScreen();
  }

  function addGroupToList(gid) {
    const list = document.getElementById('groupList');
    if ([...list.children].some(c => c.getAttribute('data-id') === gid)) return;

    const div = document.createElement('div');
    div.className = 'group-item';
    div.setAttribute('data-id', gid);
    div.innerHTML = `
      <div class="group-item-avatar">${gid[0].toUpperCase()}</div>
      <div style="flex: 1; font-weight: bold; overflow: hidden; text-overflow: ellipsis;">${gid}</div>
      <i class="fas fa-lock" style="font-size: 10px; color: #0054e3;"></i>
    `;
    div.onclick = async () => {
      let pwd = groupPasswords[gid];
      if (!pwd) {
        pwd = prompt(`Enter passphrase for Group "${gid}":`);
        if (!pwd) return;
        groupPasswords[gid] = pwd;
        persistState();
      }
      detachActiveChatListeners();
      activeGroupId = gid;
      activeDMId = null;
      activeBuddyId = null;
      currentEncryptionKey = await deriveKey(pwd, gid);
      updateChatHeader(`Group: #${gid}`, gid[0].toUpperCase(), true);
      updateNudgeVisibility();
      updateHeaderControls();
      listenGroupMessages();
      loadGroupParticipants();
    };
    list.appendChild(div);
  }

  function listenGroupMessages() {
    if (!activeGroupId || !db) return;
    const chatArea = document.getElementById('chatArea');
    chatArea.innerHTML = '<div style="font-size: 11px; color: #555; padding: 10px;"><i class="fas fa-spinner fa-spin"></i> Establishing secure E2EE channel...</div>';

    const ref = db.ref(`groups/${activeGroupId}/messages`);
    ref.off();
    ref.on('child_added', snap => appendMessage(snap.val(), true));
  }

  // Direct Messaging
  function startDM(targetBuddyId) {
    const rawOtherId = targetBuddyId || document.getElementById('dmUserInput').value.trim();
    if (!rawOtherId) return;
    const otherId = sanitizePath(rawOtherId);

    if (otherId === userId) {
      alert("Cannot open direct chat with yourself.");
      return;
    }

    detachActiveChatListeners();

    activeBuddyId = otherId;
    activeDMId = [userId, otherId].sort().join('_');
    activeGroupId = null;
    currentEncryptionKey = null;

    startedDMs.add(otherId);
    persistState();

    if (db) {
      db.ref(`users/${userId}/dms/${otherId}`).update({
        buddyId: otherId,
        lastUpdated: Date.now()
      }).catch(e => console.warn(e));

      db.ref(`users/${otherId}/dms/${userId}`).update({
        buddyId: userId,
        senderUsername: username,
        lastUpdated: Date.now()
      }).catch(e => console.warn(e));
    }

    updateChatHeader(`Buddy: ${otherId}`, otherId[0].toUpperCase(), false);
    addDMToList(otherId);
    updateNudgeVisibility();
    updateHeaderControls();
    listenDMMessages();

    const listEl = document.getElementById('participantsList');
    if (listEl) {
      const isBlocked = blockedUsers.has(otherId);
      listEl.innerHTML = `
        <div class="participant-item">
          <div class="participant-avatar"><i class="fas fa-user"></i></div>
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis;"><b>${escapeHtml(otherId)}</b> ${isBlocked ? '<span style="color:red;">[Blocked]</span>' : '(Buddy)'}</div>
        </div>
        <div class="participant-item">
          <div class="participant-avatar"><i class="fas fa-user-circle"></i></div>
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis;"><b>${escapeHtml(username)}</b> (You)</div>
        </div>
      `;
      const countEl = document.getElementById('buddyCount');
      if (countEl) countEl.innerText = '2';
    }

    const input = document.getElementById('dmUserInput');
    if (input) input.value = '';
  }

  function addDMToList(otherId) {
    const list = document.getElementById('dmList');
    if ([...list.children].some(c => c.getAttribute('data-id') === otherId)) return;

    const div = document.createElement('div');
    div.className = 'group-item';
    div.setAttribute('data-id', otherId);
    const isBlocked = blockedUsers.has(otherId);

    div.innerHTML = `
      <div class="group-item-avatar">${otherId[0].toUpperCase()}</div>
      <div style="flex: 1; font-weight: bold; overflow: hidden; text-overflow: ellipsis;">${otherId}</div>
      <i class="${isBlocked ? 'fas fa-ban' : 'far fa-comment-dots'}" style="font-size: 10px; color: ${isBlocked ? '#c00' : '#ff9900'};"></i>
    `;
    div.onclick = () => startDM(otherId);
    list.appendChild(div);
  }

  function listenDMMessages() {
    if (!activeDMId || !db) return;
    const chatArea = document.getElementById('chatArea');
    chatArea.innerHTML = '<div style="font-size: 11px; color: #555; padding: 10px;"><i class="fas fa-spinner fa-spin"></i> Connecting to Buddy DM...</div>';

    const ref = db.ref(`dms/${activeDMId}/messages`);
    ref.off();
    ref.on('child_added', snap => {
      const msg = snap.val();
      if (msg.userId !== userId && blockedUsers.has(msg.userId)) {
        return;
      }

      appendMessage(msg, false);

      if (msg.isNudge && msg.userId !== userId) {
        triggerNudgeShake();
      }
    });
  }

  function toggleBlockBuddy() {
    if (!activeBuddyId) return;
    const target = activeBuddyId;

    if (blockedUsers.has(target)) {
      blockedUsers.delete(target);
      alert(`Unblocked ${target}. You can now send and receive messages.`);
    } else {
      if (!confirm(`Are you sure you want to block ${target}? You will no longer receive messages or nudges from them.`)) return;
      blockedUsers.add(target);
    }

    persistState();
    updateHeaderControls();
    updateNudgeVisibility();

    const item = document.querySelector(`#dmList .group-item[data-id="${target}"] i`);
    if (item) {
      const isBlocked = blockedUsers.has(target);
      item.className = isBlocked ? 'fas fa-ban' : 'far fa-comment-dots';
      item.style.color = isBlocked ? '#c00' : '#ff9900';
    }

    startDM(target);
  }

  function deleteDM() {
    if (!activeDMId || !activeBuddyId) return;
    const target = activeBuddyId;
    if (!confirm(`Are you sure you want to delete the conversation with ${target}?`)) return;

    if (db) {
      db.ref(`users/${userId}/dms/${target}`).remove().catch(e => console.warn(e));
      db.ref(`dms/${activeDMId}/messages`).off();
    }

    startedDMs.delete(target);
    const item = document.querySelector(`#dmList .group-item[data-id="${target}"]`);
    if (item) item.remove();

    persistState();
    resetToWelcomeScreen();
  }

  function detachActiveChatListeners() {
    if (!db) return;
    if (activeGroupId) {
      db.ref(`groups/${activeGroupId}/messages`).off();
      db.ref(`groups/${activeGroupId}/users`).off();
    }
    if (activeDMId) {
      db.ref(`dms/${activeDMId}/messages`).off();
    }
  }

  function resetToWelcomeScreen() {
    activeGroupId = null;
    activeDMId = null;
    activeBuddyId = null;
    currentEncryptionKey = null;

    updateChatHeader("Select or Join a Conversation", "G", false);
    updateNudgeVisibility();
    updateHeaderControls();

    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
      chatArea.innerHTML = `
        <div style="background: #f0f7ff; padding: 12px; border: 1px solid #92bce3; border-radius: 4px;">
          <b>Welcome to MSN Messenger '05 ChitChat Enclave!</b>
          <p style="font-size: 11px; margin-top: 4px;">Select a room or buddy from the sidebar, or enter a new Room ID / Buddy User ID to begin chatting.</p>
        </div>
      `;
    }

    const listEl = document.getElementById('participantsList');
    if (listEl) listEl.innerHTML = '';
    const countEl = document.getElementById('buddyCount');
    if (countEl) countEl.innerText = '0';
  }

  // Nudge, Messaging, Emoticons & Files
  function sendNudge() {
    if (!activeDMId) {
      alert("Nudges are only available in 1-on-1 Buddy Chats (DMs)!");
      return;
    }

    if (activeBuddyId && blockedUsers.has(activeBuddyId)) {
      alert("You cannot nudge a blocked buddy.");
      return;
    }

    triggerNudgeShake();

    if (db) {
      db.ref(`dms/${activeDMId}/messages`).push().set({
        userId,
        username,
        avatar: userAvatar,
        isNudge: true,
        text: `⚡ [Sent you an MSN NUDGE!] ⚡`,
        timestamp: Date.now()
      });

      db.ref(`users/${activeBuddyId}/dms/${userId}`).update({
        lastUpdated: Date.now(),
        lastMessage: "Sent you a Nudge!"
      }).catch(e => console.warn(e));
    }
  }

  function triggerNudgeShake() {
    const appWin = document.getElementById('appWindow');
    if (!appWin) return;
    appWin.classList.add('nudge-shake');

    if (window.WinampPlayer) {
      const ctx = window.WinampPlayer.getAudioContext();
      if (ctx) {
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(680, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(240, ctx.currentTime + 0.35);
          gain.gain.setValueAtTime(0.5, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.35);
        } catch (e) {}
      }
    }

    setTimeout(() => appWin.classList.remove('nudge-shake'), 900);
  }

  function toggleParticipants() {
    participantsVisible = !participantsVisible;
    const p = document.getElementById('participantsPanel');
    if (p) p.classList.toggle('hidden', !participantsVisible);
  }

  function toggleEmoticonPicker() {
    const el = document.getElementById('emoticonPicker');
    if (el) el.classList.toggle('hidden');
  }

  function insertEmoticon(emo) {
    const input = document.getElementById('messageText');
    if (input) {
      input.value += ` ${emo} `;
      input.focus();
    }
    toggleEmoticonPicker();
  }

  async function sendMessage() {
    const input = document.getElementById('messageText');
    const text = input.value.trim();
    if (!text) return;

    if (!activeGroupId && !activeDMId) {
      alert("Select a room or buddy first.");
      return;
    }

    if (activeBuddyId && blockedUsers.has(activeBuddyId)) {
      alert("You cannot send messages to a blocked buddy.");
      return;
    }

    if (activeGroupId && db) {
      const encryptedObj = await encryptData(new TextEncoder().encode(text));
      db.ref(`groups/${activeGroupId}/messages`).push().set({
        userId,
        username,
        avatar: userAvatar,
        encryptedText: encryptedObj,
        timestamp: Date.now()
      });
    } else if (activeDMId && db) {
      db.ref(`dms/${activeDMId}/messages`).push().set({
        userId,
        username,
        avatar: userAvatar,
        text,
        timestamp: Date.now()
      });

      db.ref(`users/${activeBuddyId}/dms/${userId}`).update({
        lastUpdated: Date.now(),
        lastMessage: text
      }).catch(e => console.warn(e));
    }

    input.value = '';
  }

  async function sendFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!activeGroupId && !activeDMId) {
      alert("Join an encrypted group or open a DM first.");
      return;
    }

    if (activeBuddyId && blockedUsers.has(activeBuddyId)) {
      alert("You cannot send files to a blocked buddy.");
      event.target.value = '';
      return;
    }

    if (file.size > 6 * 1024 * 1024) {
      alert("File size exceeds 6 MB limit. Please select a smaller file.");
      event.target.value = '';
      return;
    }

    try {
      if (activeGroupId && db) {
        const buffer = await file.arrayBuffer();
        const encryptedObj = await encryptData(buffer);
        await db.ref(`groups/${activeGroupId}/messages`).push().set({
          userId,
          username,
          avatar: userAvatar,
          encryptedFile: encryptedObj,
          filename: file.name,
          fileType: file.type || 'application/octet-stream',
          fileSize: file.size,
          timestamp: Date.now()
        });
      } else if (activeDMId && db) {
        const reader = new FileReader();
        reader.onload = async () => {
          await db.ref(`dms/${activeDMId}/messages`).push().set({
            userId,
            username,
            avatar: userAvatar,
            file: reader.result,
            filename: file.name,
            fileType: file.type || 'application/octet-stream',
            fileSize: file.size,
            timestamp: Date.now()
          });

          db.ref(`users/${activeBuddyId}/dms/${userId}`).update({
            lastUpdated: Date.now(),
            lastMessage: `Sent an attachment: ${file.name}`
          }).catch(e => console.warn(e));
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      console.error("Failed to send file:", err);
      alert("File send error: " + err.message);
    } finally {
      event.target.value = '';
    }
  }

  async function appendMessage(msg, isEncrypted) {
    const chatArea = document.getElementById('chatArea');
    const spin = chatArea.querySelector('.fa-spinner');
    if (spin && spin.parentElement) spin.parentElement.remove();

    const isSelf = msg.userId === userId;
    const div = document.createElement('div');
    div.className = `message ${isSelf ? 'outgoing' : 'incoming'}`;

    const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const avatarHtml = msg.avatar
      ? `<div class="message-avatar" style="background-image: url('${msg.avatar}')"></div>`
      : `<div class="message-avatar">${(msg.username || 'U').charAt(0).toUpperCase()}</div>`;

    let innerHtml = '';

    if (isEncrypted) {
      if (msg.encryptedText) {
        try {
          const dec = new TextDecoder().decode(await decryptData(msg.encryptedText));
          innerHtml = `<div class="text">${escapeHtml(dec)}</div>`;
        } catch (e) {
          innerHtml = `<div class="text" style="color: #c00;">[Failed to decrypt packet - invalid key]</div>`;
        }
      } else if (msg.encryptedFile) {
        try {
          const decBuf = await decryptData(msg.encryptedFile);
          const mime = msg.fileType || 'application/octet-stream';
          const blob = new Blob([decBuf], { type: mime });
          const url = URL.createObjectURL(blob);
          if (mime.startsWith('image/')) {
            innerHtml = `
              <div class="text">
                <div style="font-size: 11px; margin-bottom: 4px;"><i class="fas fa-image" style="color: #00aa55;"></i> ${escapeHtml(msg.filename)} (${formatBytes(msg.fileSize || decBuf.byteLength)})</div>
                <a href="${url}" target="_blank"><img src="${url}" class="chat-shared-img" alt="${escapeHtml(msg.filename)}"></a>
                <a href="${url}" download="${msg.filename || 'image.png'}" class="file-attachment-link"><i class="fas fa-download"></i> Save Image</a>
              </div>
            `;
          } else {
            innerHtml = `
              <div class="text">
                <div style="font-size: 11px; margin-bottom: 2px;"><i class="fas fa-file-alt"></i> ${escapeHtml(msg.filename)} (${formatBytes(msg.fileSize || decBuf.byteLength)})</div>
                <a href="${url}" download="${msg.filename || 'file'}" class="file-attachment-link"><i class="fas fa-download"></i> Download File</a>
              </div>
            `;
          }
        } catch (e) {
          innerHtml = `<div class="text" style="color: #c00;">[File decryption error - invalid key]</div>`;
        }
      }
    } else {
      if (msg.text) {
        innerHtml = `<div class="text">${escapeHtml(msg.text)}</div>`;
      } else if (msg.file) {
        const mime = msg.fileType || '';
        if (mime.startsWith('image/') || (typeof msg.file === 'string' && msg.file.startsWith('data:image/'))) {
          innerHtml = `
            <div class="text">
              <div style="font-size: 11px; margin-bottom: 4px;"><i class="fas fa-image" style="color: #00aa55;"></i> ${escapeHtml(msg.filename || 'Photo')} (${formatBytes(msg.fileSize)})</div>
              <a href="${msg.file}" target="_blank"><img src="${msg.file}" class="chat-shared-img" alt="${escapeHtml(msg.filename || 'Photo')}"></a>
              <a href="${msg.file}" download="${msg.filename || 'photo.png'}" class="file-attachment-link"><i class="fas fa-download"></i> Save Image</a>
            </div>
          `;
        } else {
          innerHtml = `
            <div class="text">
              <div style="font-size: 11px; margin-bottom: 2px;"><i class="fas fa-file-alt"></i> ${escapeHtml(msg.filename || 'File')} (${formatBytes(msg.fileSize)})</div>
              <a href="${msg.file}" download="${msg.filename || 'attachment'}" class="file-attachment-link"><i class="fas fa-download"></i> Download File</a>
            </div>
          `;
        }
      }
    }

    div.innerHTML = `
      <div class="message-header">
        <span>${escapeHtml(msg.username || 'User')}</span>
        <span class="timestamp">${timeStr}</span>
        ${isEncrypted ? '<span class="encrypted-tag"><i class="fas fa-lock"></i> AES-256</span>' : ''}
      </div>
      <div class="message-content">
        ${avatarHtml}
        ${innerHtml}
      </div>
    `;

    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function loadGroupParticipants() {
    if (!activeGroupId || !db) return;
    const listEl = document.getElementById('participantsList');
    if (!listEl) return;
    listEl.innerHTML = '';

    db.ref(`groups/${activeGroupId}/users`).on('value', snap => {
      const users = snap.val();
      listEl.innerHTML = '';
      if (users) {
        const userCount = Object.keys(users).length;
        const countEl = document.getElementById('buddyCount');
        if (countEl) countEl.innerText = userCount;

        Object.entries(users).forEach(([id, u]) => {
          const div = document.createElement('div');
          div.className = 'participant-item';
          const av = u.avatar
            ? `<div class="participant-avatar" style="background-image: url('${u.avatar}')"></div>`
            : `<div class="participant-avatar">${(u.username || 'U').charAt(0).toUpperCase()}</div>`;
          div.innerHTML = `${av} <div style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(u.username)} ${id === userId ? '<b>(You)</b>' : ''}</div>`;
          listEl.appendChild(div);
        });
      }
    });
  }

  function updateChatHeader(title, letter, isEncrypted) {
    document.getElementById('chatTitle').innerText = title;
    const av = document.getElementById('chatAvatar');
    av.innerText = letter;
    av.style.backgroundImage = '';

    const encStatus = document.getElementById('encryptionStatusText');
    if (isEncrypted) {
      encStatus.innerHTML = '<span style="color: #00aa55;"><i class="fas fa-lock"></i> PBKDF2 + AES-256-GCM Secure Room</span>';
    } else {
      encStatus.innerHTML = '<span style="color: #ff9900;"><i class="fas fa-user-friends"></i> Direct Buddy Chat</span>';
    }
  }

  function renderSidebarItems() {
    joinedGroups.forEach(gid => addGroupToList(gid));
    startedDMs.forEach(dm => addDMToList(dm));
  }

  function updateUI() {
    const nameEl = document.getElementById('msnHeaderUsername');
    if (nameEl) nameEl.innerText = username;
    const idEl = document.getElementById('msnHeaderUserId');
    if (idEl) idEl.innerText = `(ID: ${userId})`;

    const av = document.getElementById('msnHeaderAvatar');
    if (av) {
      if (userAvatar) {
        av.innerHTML = `<img src="${userAvatar}"><div class="msn-status-dot" id="msnStatusDot"></div>`;
      } else {
        av.innerHTML = `<span>${username.charAt(0).toUpperCase()}</span><div class="msn-status-dot" id="msnStatusDot"></div>`;
      }
    }
  }

  function persistState() {
    const payload = {
      userId,
      username,
      avatar: userAvatar,
      status: userStatus,
      statusMsg: userStatusMsg,
      joinedGroups: Array.from(joinedGroups),
      groupPasswords,
      startedDMs: Array.from(startedDMs),
      blockedUsers: Array.from(blockedUsers)
    };
    localStorage.setItem('userData', JSON.stringify(payload));
    if (window.FirebaseSync) {
      window.FirebaseSync.backupUserConfig(payload);
    }
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  return {
    init,
    joinGroup,
    exitGroup,
    startDM,
    toggleBlockBuddy,
    deleteDM,
    sendNudge,
    toggleParticipants,
    toggleEmoticonPicker,
    insertEmoticon,
    sendMessage,
    sendFile,
    getUserId: () => userId,
    setListeningTrack: (trackStr) => {
      const el = document.getElementById('statusMessageInput');
      if (el) el.value = `Listening to: ${trackStr} ♪`;
    },
    updateProfile: (newName, newAvatar) => {
      if (newName) username = newName;
      if (newAvatar) userAvatar = newAvatar;
      persistState();
      updateUI();
    },
    updateStatus: (status) => {
      userStatus = status;
      const dot = document.getElementById('msnStatusDot');
      if (dot) {
        if (status === 'online') dot.style.background = '#39b54a';
        else if (status === 'busy') dot.style.background = '#ff0000';
        else if (status === 'away') dot.style.background = '#fbb040';
        else dot.style.background = '#888888';
      }
      persistState();
    }
  };
})();
