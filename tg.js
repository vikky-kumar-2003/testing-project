require("dotenv").config();
const { TelegramClient, Api } = require("telegram");
const { NewMessage } = require("telegram/events");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const fs = require("fs");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal"); // Keeping for local debug if needed
const express = require("express");
const qrcode = require("qrcode");
const path = require("path");

// ================= CONFIG =================
const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const PHONE_NUMBER = process.env.PHONE_NUMBER; // Fallback if no session
const TARGET_WHATSAPP_NUMBER = process.env.TARGET_WHATSAPP_NUMBER;
const PORT = process.env.PORT || 3000;

// Allowed usernames & IDs
const ALLOWED_SOURCES = ["LootVersePremiumBot", "SheinVouchers"];
const ALLOWED_IDS = ["8530434659", "-1002051429004"];

const SESSION_FILE = "session.txt";

// ================= STATE MANAGEMENT =================
const app = express();
app.use(express.urlencoded({ extended: true })); // parsing form data

// WhatsApp State
let waQrCodeData = "";
let isWaReady = false;

// Telegram State
let tgClient = null;
let isTgReady = false;
let tgQrCodeData = "";
let tgPasswordCallback = null; // Function to resolve when password is provided
let tgPasswordError = null;

// ================= WEB SERVER =================

app.get("/", async (req, res) => {
    let html = `
    <html>
        <head>
            <title>Bot Manager</title>
            <meta http-equiv="refresh" content="10">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 20px; background: #f0f2f5; color: #1c1e21; }
                .container { display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; max-width: 1200px; margin: 0 auto; }
                .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 100%; max-width: 400px; display: flex; flex-direction: column; align-items: center; }
                h1 { margin-bottom: 20px; }
                h2 { margin-top: 0; color: #333; }
                .status-badge { padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 0.9em; margin-bottom: 15px; display: inline-block; }
                .connected { background: #dcf8c6; color: #075e54; }
                .disconnected { background: #fee2e2; color: #991b1b; }
                .btn { background: #0088cc; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 16px; margin-top: 10px; text-decoration: none; display: inline-block; }
                .btn.logout { background: #dc3545; }
                .btn.login { background: #28a745; }
                .btn:hover { opacity: 0.9; }
                img.qr { width: 250px; height: 250px; margin: 15px 0; border: 1px solid #ddd; border-radius: 8px; }
                input[type="password"] { padding: 10px; border-radius: 5px; border: 1px solid #ccc; width: 100%; margin-bottom: 10px; box-sizing: border-box; }
                .error { color: red; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <h1>🤖 Bot Control Panel</h1>
            <div class="container">
    `;

    // --- WhatsApp Station ---
    html += `<div class="card">
        <h2>WhatsApp</h2>
        <span class="status-badge ${isWaReady ? 'connected' : 'disconnected'}">
            ${isWaReady ? '✅ CONNECTED' : '❌ DISCONNECTED'}
        </span>`;

    if (isWaReady) {
        html += `
            <p>Forwarding active to: <br><strong>${TARGET_WHATSAPP_NUMBER}</strong></p>
            <form action="/wa/logout" method="POST">
                <button type="submit" class="btn logout">Logout WhatsApp</button>
            </form>`;
    } else if (waQrCodeData) {
        try {
            const qrUrl = await qrcode.toDataURL(waQrCodeData);
            html += `
                <img class="qr" src="${qrUrl}" alt="WA QR">
                <p>Scan with WhatsApp (Linked Devices)</p>`;
        } catch (e) { html += `<p class="error">Error generating QR</p>`; }
    } else {
        html += `<p>⏳ Initializing Client...</p>`;
    }
    html += `</div>`;

    // --- Telegram Station ---
    html += `<div class="card">
        <h2>Telegram</h2>
        <span class="status-badge ${isTgReady ? 'connected' : 'disconnected'}">
            ${isTgReady ? '✅ CONNECTED' : '❌ DISCONNECTED'}
        </span>`;

    if (isTgReady) {
        html += `
            <p>Listening for messages...</p>
            <form action="/tg/logout" method="POST">
                <button type="submit" class="btn logout">Logout Telegram</button>
            </form>`;
    } else if (tgPasswordCallback) {
        // Waiting for 2FA Password
        html += `
            <p>🔒 <strong>2FA Password Required</strong></p>
            <form action="/tg/password" method="POST" style="width: 100%">
                <input type="password" name="password" placeholder="Enter Cloud Password" required>
                ${tgPasswordError ? `<p class="error">${tgPasswordError}</p>` : ''}
                <button type="submit" class="btn login">Submit Password</button>
            </form>`;
    } else if (tgQrCodeData) {
        try {
            const qrUrl = await qrcode.toDataURL(tgQrCodeData);
            html += `
                <img class="qr" src="${qrUrl}" alt="TG QR">
                <p>Scan with Telegram App (Settings > Devices > Link Desktop Device)</p>`;
        } catch (e) { html += `<p class="error">Error generating QR</p>`; }
    } else {
        // Not connected, no QR yet. Look for login button
        html += `
            <form action="/tg/login" method="POST">
                <button type="submit" class="btn">Login with QR Code</button>
            </form>`;
    }
    html += `</div></div></body></html>`;

    res.send(html);
});

// --- WhatsApp Actions ---
app.post("/wa/logout", async (req, res) => {
    if (whatsappClient) {
        await whatsappClient.destroy();
        // Clean auth dir
        const authPath = path.join(__dirname, '.wwebjs_auth');
        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });

        isWaReady = false;
        waQrCodeData = "";
        whatsappClient.initialize();
    }
    res.redirect("/");
});

// --- Telegram Actions ---
app.post("/tg/login", async (req, res) => {
    if (!isTgReady && !tgQrCodeData) {
        startTelegramLoginFlow();
    }
    res.redirect("/");
});

app.post("/tg/password", async (req, res) => {
    const pwd = req.body.password;
    if (tgPasswordCallback && pwd) {
        tgPasswordCallback(pwd);
        tgPasswordCallback = null; // Reset
    }
    res.redirect("/");
});

app.post("/tg/logout", async (req, res) => {
    if (tgClient) {
        try {
            await tgClient.disconnect();
            await tgClient.destroy();
        } catch (e) { }

        // Remove session file
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
        tgClient = null;
        isTgReady = false;
        tgQrCodeData = "";
        process.env.TG_SESSION = ""; // Clear from memory env too if set

        // Re-init bare client state
        initTelegramClient();
    }
    res.redirect("/");
});

app.listen(PORT, () => {
    console.log(`🌍 Web Interface running on port ${PORT}`);
});


// ================= WHATSAPP LOGIC =================
console.log("🚀 Initializing WhatsApp...");
const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        protocolTimeout: 300000 // 5 minutes timeout
    }
});

whatsappClient.on("qr", (qr) => {
    console.log("📲 New WhatsApp QR received");
    waQrCodeData = qr;
});

whatsappClient.on("ready", () => {
    console.log("✅ WhatsApp Ready!");
    isWaReady = true;
    waQrCodeData = "";
});

whatsappClient.on("authenticated", () => {
    console.log("✅ WhatsApp Authenticated");
    isWaReady = true;
});

whatsappClient.on("disconnected", () => {
    console.log("⚠️ WhatsApp Disconnected");
    isWaReady = false;
    waQrCodeData = "";
    whatsappClient.initialize();
});

whatsappClient.initialize();


// ================= TELEGRAM LOGIC =================
async function initTelegramClient() {
    console.log("🚀 Initializing Telegram Client...");

    // Check if we have session data (Env var or File)
    let sessionData = process.env.TG_SESSION || "";
    if (!sessionData && fs.existsSync(SESSION_FILE)) {
        sessionData = fs.readFileSync(SESSION_FILE, "utf8");
    }

    const stringSession = new StringSession(sessionData);

    tgClient = new TelegramClient(stringSession, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true // helpful for some environments
    });

    // Event Handler (Shared logic)
    tgClient.addEventHandler(handleTelegramMessage, new NewMessage({ incoming: true }));

    try {
        // Attempt fast connection if session exists
        if (sessionData) {
            console.log("🔄 Found session, attempting to connect...");
            await tgClient.connect();

            // Check if actually authorized
            if (await tgClient.checkAuthorization()) {
                onTelegramConnected();
            } else {
                console.log("⚠️ Session invalid or expired.");
                // Session dead, clear it so user can login via QR
                fs.writeFileSync(SESSION_FILE, "");
                isTgReady = false;
            }
        }
    } catch (err) {
        console.error("❌ Telegram Init Error:", err);
        if (err.message.includes("AUTH_KEY_DUPLICATED") || err.code === 406) {
            console.log("⚠️ Session Duplicated/Corrupted. Clearing session to allow new login...");
            if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
            process.env.TG_SESSION = ""; // Clear env var in memory
            tgClient = null;
            isTgReady = false;
        }
    }
}

// Function triggered by Web UI "Login with QR"
async function startTelegramLoginFlow() {
    if (isTgReady) return;
    console.log("📸 Starting Telegram QR Flow...");

    try {
        if (!tgClient) await initTelegramClient();
        if (!tgClient.connected) await tgClient.connect();

        // If not connected, we start the QR flow
        await tgClient.signInUserWithQrCode(
            { apiId: API_ID, apiHash: API_HASH },
            {
                qrCode: async (code) => {
                    console.log("📸 New Telegram QR Code generated");
                    tgQrCodeData = `tg://login?token=${code.token.toString("base64url")}`;
                },
                password: async (hint) => {
                    console.log("🔒 2FA Password needed. Hint:", hint);
                    tgQrCodeData = ""; // Clear QR, show password UI
                    return new Promise((resolve) => {
                        tgPasswordCallback = resolve;
                    });
                },
                onError: (err) => {
                    console.error("TG Login Error:", err);
                    tgPasswordError = err.message;
                }
            }
        );

        // If successful
        onTelegramConnected();

    } catch (err) {
        console.error("Telegram Login Flow Failed:", err);
        // Reset state so user can try again
        tgQrCodeData = "";
    }
}

async function onTelegramConnected() {
    console.log("✅ Telegram Connected Successfully!");
    isTgReady = true;
    tgQrCodeData = "";
    tgPasswordCallback = null;

    // Save session
    const sessionStr = tgClient.session.save();
    fs.writeFileSync(SESSION_FILE, sessionStr);

    // Start Keep-Alive
    startKeepAlive();
}

function startKeepAlive() {
    setInterval(async () => {
        if (!isTgReady || !tgClient) return;
        try {
            await tgClient.getMe();
        } catch (err) {
            console.error("Keep-Alive Ping Failed:", err.message);
        }
    }, 30000);
}

// ================= QUEUE LOGIC =================
const msgQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue || msgQueue.length === 0) return;
    isProcessingQueue = true;

    while (msgQueue.length > 0) {
        const item = msgQueue.shift();
        try {
            const startTime = Date.now();
            await whatsappClient.sendMessage(TARGET_WHATSAPP_NUMBER, item.text);
            const duration = Date.now() - startTime;
            console.log(`🚀 WhatsApp sent: "${item.text.substring(0, 20)}..." (⏱️ ${duration}ms) | Queue: ${msgQueue.length}`);

            // Artificial delay removed for speed
            // await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.error("❌ Forward Queue Error:", err.message);
            // If error, slight pause to recover
            await new Promise(r => setTimeout(r, 500));
        }
    }

    isProcessingQueue = false;
}

// ================= MESSAGE HANDLER =================
async function handleTelegramMessage(event) {
    if (!isWaReady) return; // Can't forward if WA is down

    const message = event.message;
    if (!message || message.out) return;

    // ... (Existing filtering logic) ...
    const senderId = message.senderId?.toString();
    const chatId = message.chatId?.toString();

    let isAllowed = ALLOWED_IDS.includes(senderId) || ALLOWED_IDS.includes(chatId);

    if (!isAllowed) {
        try {
            const sender = await message.getSender().catch(() => null);
            const chat = await message.getChat().catch(() => null);
            if (sender?.username && ALLOWED_SOURCES.includes(sender.username)) isAllowed = true;
            if (chat?.username && ALLOWED_SOURCES.includes(chat.username)) isAllowed = true;
        } catch { }
    }

    if (isAllowed) {
        let text = message.text || "[Sirf media - text nahi]";

        // Cleaning
        text = text.replace(/\*\*/g, "*")
            .replace("⚡ *FAST DROP*", "")
            .replace("⚡ *Men’s Product Alert (Superfast)*", "")
            .replace(/Buy Cheap Vouchers.*\n/g, "")
            .replace(/🛒\s*\*{0,2}Buy Vouchers\*{0,2}:.*@SheinXVouchers_Bot/gi, "")
            .replace(/⚙️\s*\*{0,2}Powered by\*{0,2}:.*@SheinXCodes/gi, "")
            .trim();

        if (text.length > 0) {
            console.log(`� Added to Queue: "${text.substring(0, 20)}..."`);
            msgQueue.push({ text });
            processQueue();
        } else {
            console.log("⚠️ Cleared text empty - skip");
        }
    }
}

// Start
initTelegramClient();