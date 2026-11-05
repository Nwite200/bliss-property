(function () {
  const S = window.BlissStaff;
  let me = null;
  let rooms = [];
  let activeRoom = null;
  let socket = null;
  let socketGeneration = 0;
  const el = id => document.getElementById(id);

  function setStatus(text, tone) {
    el("chatStatus").textContent = text;
    el("chatStatus").className = `badge ${tone || "badge-gray"}`;
  }

  function renderRooms() {
    el("chatRoomList").innerHTML = rooms.length ? rooms.map(room => `
      <a href="#" class="chat-room-item ${activeRoom && activeRoom.id === room.id ? "active" : ""}" data-room="${room.id}">
        <strong>${S.escape(room.display_name || room.name)}</strong>
        <span>${S.escape(room.last_message || "No messages yet")}</span>
      </a>`).join("") : '<div class="empty-state">No chat rooms.</div>';
    el("chatRoomList").querySelectorAll("[data-room]").forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        const room = rooms.find(item => String(item.id) === link.getAttribute("data-room"));
        if (room) openRoom(room);
      });
    });
  }

  function renderMessages(messages) {
    el("chatMessages").innerHTML = messages.length ? messages.map(message => `
      <div class="chat-message ${Number(message.sender_id) === Number(me.id) ? "mine" : ""}">
        <div class="chat-message-meta">${S.escape(message.sender_name || "Staff")} · ${S.formatDateTime(message.created_at)}</div>
        <div class="chat-message-bubble">${S.escape(message.message)}</div>
      </div>`).join("") : '<div class="empty-state">No messages yet. Start the conversation.</div>';
    el("chatMessages").scrollTop = el("chatMessages").scrollHeight;
  }

  function connect(room) {
    const generation = ++socketGeneration;
    if (socket) { try { socket.close(); } catch (error) {} }
    setStatus("Connecting…", "badge-amber");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/api/chat/rooms/${room.id}/socket`);
    socket.addEventListener("open", () => {
      if (generation !== socketGeneration) return;
      setStatus("Connected", "badge-green");
      el("chatInput").disabled = false;
      el("chatSendBtn").disabled = false;
    });
    socket.addEventListener("message", event => {
      if (generation !== socketGeneration) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "history") renderMessages(data.messages || []);
        if (data.type === "message" && data.message) {
          el("chatMessages").insertAdjacentHTML("beforeend", `
            <div class="chat-message ${Number(data.message.sender_id) === Number(me.id) ? "mine" : ""}">
              <div class="chat-message-meta">${S.escape(data.message.sender_name || "Staff")} · ${S.formatDateTime(data.message.created_at)}</div>
              <div class="chat-message-bubble">${S.escape(data.message.message)}</div>
            </div>`);
          el("chatMessages").scrollTop = el("chatMessages").scrollHeight;
        }
      } catch (error) {}
    });
    socket.addEventListener("close", () => {
      if (generation !== socketGeneration) return;
      setStatus("Reconnecting…", "badge-amber");
      el("chatInput").disabled = true;
      el("chatSendBtn").disabled = true;
      if (activeRoom && activeRoom.id === room.id) {
        window.setTimeout(() => { if (generation === socketGeneration && activeRoom && activeRoom.id === room.id) connect(activeRoom); }, 2000);
      }
    });
    socket.addEventListener("error", () => {
      if (generation !== socketGeneration) return;
      setStatus("Connection error", "badge-red");
    });
  }

  async function openRoom(room) {
    activeRoom = room;
    el("chatRoomTitle").textContent = room.display_name || room.name;
    el("chatMessages").innerHTML = '<div class="empty-state">Loading messages…</div>';
    renderRooms();
    try {
      const data = await S.fetchJson(`/api/chat/rooms/${room.id}/messages`);
      renderMessages(data.messages || []);
      connect(room);
    } catch (error) {
      S.toast(error.message, true);
    }
  }

  async function loadRooms(selectId) {
    const data = await S.fetchJson("/api/chat/rooms");
    rooms = data.rooms || [];
    renderRooms();
    const room = rooms.find(item => String(item.id) === String(selectId)) || rooms[0];
    if (room) await openRoom(room);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    me = await S.initShell("chat");
    if (!me) return;
    try {
      await loadRooms();
      const staff = await S.fetchJson("/api/users");
      el("chatStaffSelect").innerHTML = '<option value="">Select staff for direct chat</option>' +
        (staff.users || []).filter(user => Number(user.id) !== Number(me.id)).map(user =>
          `<option value="${user.id}">${S.escape(user.full_name)} — ${S.escape(user.role_name)}</option>`).join("");
    } catch (error) {
      S.toast(error.message || "Unable to load chat", true);
    }

    el("startChatBtn").addEventListener("click", async () => {
      const target = Number(el("chatStaffSelect").value);
      if (!target) { S.toast("Select a staff member first", true); return; }
      try {
        const result = await S.fetchJson("/api/chat/rooms", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: target })
        });
        await loadRooms(result.room_id);
      } catch (error) { S.toast(error.message, true); }
    });

    el("chatForm").addEventListener("submit", event => {
      event.preventDefault();
      const input = el("chatInput");
      const message = input.value.trim();
      if (!message) return;
      if (!socket || socket.readyState !== WebSocket.OPEN) { S.toast("Chat is reconnecting", true); return; }
      socket.send(JSON.stringify({ message }));
      input.value = "";
    });
  });
})();
