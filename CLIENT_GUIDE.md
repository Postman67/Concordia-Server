# Concordia Client — Build Guide

This document describes everything a client developer needs to connect to and use the Concordia server.  
The server exposes two interfaces: a **REST API** (auth, channel management, message history) and a **Socket.IO WebSocket** (real-time messaging).

---

## Recommended stack

| Concern | Suggestion |
|---------|-----------|
| Framework | React, Vue 3, Svelte, or plain TypeScript |
| Socket.IO client | `socket.io-client` (same major version as the server — currently **v4**) |
| HTTP client | `fetch` (native) or `axios` |
| State management | Zustand / Pinia / Svelte stores — whatever fits your framework |
| Styling | Tailwind CSS, Shadcn/ui, or any component library |

---

## 1. Authentication

### Register

```ts
const res = await fetch('http://localhost:3000/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'alice', password: 'secret1234' }),
});
const { token, user } = await res.json();
// token: "eyJhbGci..."
// user:  { id: 1, username: "alice" }
```

### Login

```ts
const res = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'alice', password: 'secret1234' }),
});
const { token, user } = await res.json();
```

Store the `token` in memory (or `localStorage` for persistence).  
**All other REST requests** require `Authorization: Bearer <token>`.

---

## 2. Channels (REST)

### List channels

```ts
const res = await fetch('http://localhost:3000/api/channels', {
  headers: { Authorization: `Bearer ${token}` },
});
const channels = await res.json();
// [ { id: 1, name: "general", description: "...", created_at: "..." }, ... ]
```

### Create a channel

```ts
await fetch('http://localhost:3000/api/channels', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ name: 'random', description: 'Off-topic chat' }),
});
```

### Delete a channel (owner only)

```ts
await fetch(`http://localhost:3000/api/channels/${channelId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${token}` },
});
```

---

## 3. Message history (REST)

Fetch before opening a channel so the user sees past messages immediately.

```ts
// Latest 50 messages
const res = await fetch(
  `http://localhost:3000/api/messages/${channelId}?limit=50`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const messages = await res.json();
// messages are in chronological order (oldest first)
// [ { id, content, created_at, user_id, username }, ... ]
```

### Pagination (load older messages)

```ts
// Get the timestamp of the oldest message you currently have
const oldest = messages[0].created_at;

const res = await fetch(
  `http://localhost:3000/api/messages/${channelId}?limit=50&before=${encodeURIComponent(oldest)}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const olderMessages = await res.json(); // prepend to your list
```

---

## 4. Real-time (Socket.IO)

### Install

```bash
npm install socket.io-client
```

### Connect

Pass the JWT in the `auth` handshake — the server will reject the connection without it.

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token },          // your JWT
  transports: ['websocket'], // skip the polling upgrade
});

socket.on('connect', () => console.log('connected', socket.id));
socket.on('connect_error', (err) => console.error('auth failed:', err.message));
```

### Join / leave a channel

```ts
socket.emit('channel:join', channelId);

socket.on('channel:joined', ({ channelId, name }) => {
  console.log(`Joined #${name}`);
});

socket.on('user:joined', ({ channelId, user }) => {
  console.log(`${user.username} joined channel ${channelId}`);
});

// When navigating away:
socket.emit('channel:leave', channelId);
```

### Send a message

```ts
socket.emit('message:send', { channelId, content: 'Hello world!' });
```

### Receive messages

```ts
socket.on('message:new', (msg) => {
  // {
  //   id: number,
  //   channelId: number,
  //   content: string,
  //   createdAt: string,   // ISO timestamp
  //   user: { id: number, username: string }
  // }
  appendMessageToUI(msg);
});
```

### Typing indicators

```ts
let typingTimer: ReturnType<typeof setTimeout>;

inputEl.addEventListener('input', () => {
  socket.emit('typing:start', channelId);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('typing:stop', channelId), 2000);
});

socket.on('typing:update', ({ channelId, user, isTyping }) => {
  updateTypingIndicator(user.username, isTyping);
});
```

### Error handling

```ts
socket.on('error', ({ message }) => {
  showToast(`Server error: ${message}`);
});
```

---

## 5. Suggested UI structure

```
App
├── LoginPage       — register / login forms, stores token
└── ChatLayout
    ├── ChannelSidebar  — fetches channel list, handles create/delete
    └── ChatPane        — selected channel
        ├── MessageList     — REST history + socket:message:new feed
        ├── TypingIndicator — socket:typing:update
        └── MessageInput    — socket:message:send + typing:start/stop
```

---

## 6. Connection lifecycle

```
1. User logs in  →  store token
2. Open app      →  connect socket with token
3. Load channels →  GET /api/channels
4. Select channel →  GET /api/messages/:id (history)
                  →  socket.emit('channel:join', id)
5. User types    →  socket.emit('typing:start', id) / 'typing:stop'
6. User sends    →  socket.emit('message:send', { channelId, content })
7. Server acks   →  socket:message:new broadcast (including sender)
8. Navigate away →  socket.emit('channel:leave', id)
9. Log out       →  socket.disconnect(), clear token
```

---

## 7. Token refresh

The JWT is valid for **7 days**.  
Implement a simple check: if a request returns `401`, redirect the user to the login page and clear the stored token.  
Full refresh-token support can be added to the server when needed.

---

## 8. Server base URL

Put the server URL in an env variable so you can swap it per environment:

```ts
// .env (Vite example)
VITE_SERVER_URL=http://localhost:3000
```

```ts
const BASE_URL = import.meta.env.VITE_SERVER_URL;
const socket = io(BASE_URL, { auth: { token } });
```
