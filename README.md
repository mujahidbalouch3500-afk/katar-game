# کتار - Online 9 Goti Game

## Setup Kaise Karein

### 1. Node.js Install Karein
https://nodejs.org se Node.js download karein (v18 ya upar)

### 2. Project Folder Kholo
```bash
cd katar-game
```

### 3. Dependencies Install Karein
```bash
npm install
```

### 4. Server Chalao
```bash
node server.js
```

### 5. Browser Mein Kholo
```
http://localhost:3000
```

---

## Admin Login
- **Username:** admin
- **Password:** admin123

> ⚠️ Admin password change karne ke liye `server.js` file mein yeh line dhundein:
> `const ADMIN_PASS = 'admin123';`
> Aur apna naya password likhein.

---

## Features
- ✅ Player Registration & Login
- ✅ Real-time Online Multiplayer (Socket.io)
- ✅ Full Katar / Nine Men's Morris game
- ✅ Admin Dashboard
  - Players list + delete
  - Games history
  - Live stats (total players, active games, etc.)

---

## Internet Par Deploy Karna (Optional)
Railway.app ya Render.com par free mein deploy kar sakte hain.
