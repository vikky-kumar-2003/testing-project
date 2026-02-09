const { TelegramClient, Api } = require("telegram");
const { NewMessage } = require("telegram/events");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const fs = require("fs");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const express = require("express");
const qrcode = require("qrcode");
require("dotenv").config();

// ================= CONFIG =================
const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const PHONE_NUMBER = process.env.PHONE_NUMBER;
const PORT = process.env.PORT || 3000;

// Allowed usernames (fallback)
const ALLOWED_SOURCES = ["LootVersePremiumBot", "SheinVouchers"];

// Verified IDs (string format) - bot positive, channel negative
const ALLOWED_IDS = [
    "8530434659",          // Bot ka ID (@userinfobot se mila)
    "-1002051429004"       // Channel ID
    // Aur IDs chahiye toh yahan daal dena
];

const TARGET_WHATSAPP_NUMBER = process.env.TARGET_WHATSAPP_NUMBER; // WA group ID

const SESSION_FILE = "session.txt";
// =========================================

// ================= WEB SERVER & STATE =================
const app = express();
let qrCodeData = "";
let isClientReady = false;

app.get("/", async (req, res) => {
    if (isClientReady) {
        res.send(`
            <html>
                <head>
                    <title>WhatsApp Status</title>
                    <meta http-equiv="refresh" content="30">
                    <style>
                        body { font-family: sans-serif; text-align: center; padding: 50px; background: #f0f2f5; }
                        .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: inline-block; }
                        h1 { color: #25D366; }
                        .btn { background: #ff4d4d; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 16px; margin-top: 20px; }
                        .btn:hover { background: #cc0000; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>✅ WhatsApp Connected!</h1>
                        <p>Messages are being forwarded.</p>
                        <form action="/logout" method="POST">
                            <button type="submit" class="btn">LOGOUT SESSION</button>
                        </form>
                    </div>
                </body>
            </html>
        `);
    } else if (qrCodeData) {
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            res.send(`
                <html>
                    <head>
                        <title>Scan WhatsApp QR</title>
                        <meta http-equiv="refresh" content="5">
                        <style>
                            body { font-family: sans-serif; text-align: center; padding: 50px; background: #202c33; color: white; }
                            .container { background: white; padding: 30px; border-radius: 10px; display: inline-block; }
                            h2 { color: #333; margin-bottom: 20px; }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h2>Scan this QR Code</h2>
                            <img src="${qrImage}" alt="QR Code" style="width: 300px; height: 300px;">
                            <p style="color: #666; margin-top: 15px;">Refresh if not working</p>
                        </div>
                    </body>
                </html>
            `);
        } catch (err) {
            res.status(500).send("Error generating QR code");
        }
    } else {
        res.send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #f0f2f5;">
                    <h2>⏳ Initializing WhatsApp... Please wait.</h2>
                    <script>setTimeout(() => window.location.reload(), 3000);</script>
                </body>
            </html>
        `);
    }
});

app.post("/logout", async (req, res) => {
    try {
        console.log("⚠️ Logout requested from Web UI...");
        await whatsappClient.destroy();

        // Remove auth folder manually just to be safe
        const fs = require('fs');
        const path = require('path');
        const authPath = path.join(__dirname, '.wwebjs_auth');
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }

        isClientReady = false;
        qrCodeData = "";

        console.log("♻️ Client destroyed & session cleared. Restarting...");
        whatsappClient.initialize();

        res.send(`
            <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1>Logged Out</h1>
                    <p>Session cleared. Redirecting to QR page...</p>
                    <script>setTimeout(() => window.location.href = "/", 3000);</script>
                </body>
            </html>
        `);
    } catch (err) {
        console.error("Logout failed:", err);
        res.status(500).send("Logout failed: " + err.message);
    }
});

app.listen(PORT, () => {
    console.log(`🌍 Server running on port ${PORT}`);
});

// ================= WHATSAPP CLIENT =================
console.log("🚀 WhatsApp Client shuru...");
const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

whatsappClient.on("qr", (qr) => {
    console.log("📲 New QR Code received!");
    qrCodeData = qr;
    console.log(`🔗 Open this link to scan: http://localhost:${PORT} (or your Railway URL)`);
    // qrcodeTerminal.generate(qr, { small: true }); // Removed as per request
});

whatsappClient.on("ready", () => {
    console.log("✅ WhatsApp Connected & Ready!");
    isClientReady = true;
    qrCodeData = "";
});

whatsappClient.on("authenticated", () => {
    console.log("✅ WA Auth Done");
    isClientReady = true;
});

whatsappClient.on("auth_failure", (msg) => {
    console.error("❌ WA Auth Fail:", msg);
    isClientReady = false;
});

whatsappClient.on("disconnected", (reason) => {
    console.log("⚠️ WhatsApp Client was disconnected:", reason);
    isClientReady = false;
    qrCodeData = "";
    // Auto re-initialize happens? usually requires manual re-init logic if not using reload
    whatsappClient.initialize();
});

whatsappClient.initialize();

// ================= TELEGRAM CLIENT =================
const sessionString = process.env.TG_SESSION || (fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, "utf8") : "");
const stringSession = new StringSession(sessionString);

(async () => {
    console.log("🔐 Telegram se connect ho raha...");

    const client = new TelegramClient(stringSession, API_ID, API_HASH, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: PHONE_NUMBER,
        password: async () => await input.text("2FA Password (agar hai toh): "),
        phoneCode: async () => await input.text("OTP daal bhai: "),
        onError: (err) => console.error("Start mein error:", err),
    });

    fs.writeFileSync(SESSION_FILE, client.session.save());
    console.log("✅ Telegram Login Success!");

    const me = await client.getMe();
    console.log(`🙋‍♂️ Tu login hai: ${me.username || me.firstName} (ID: ${me.id})`);

    // ================= POWER KEEP-ALIVE (bot private msgs ke liye must) =================
    setInterval(async () => {
        try {
            await Promise.all([
                client.getDialogs({ limit: 4 }),                // Dialogs refresh
                client.getMe(),                                 // Self check
                client.invoke(new Api.updates.GetState({}))     // Force updates pull
            ]);
            console.log("🔄 Keep-alive chal raha (private/bot updates safe)");
        } catch (err) {
            console.error("Keep-alive fail:", err.message);
        }
    }, 20000);  // 20 seconds - tested reliable

    // ================= BOT INTERACTION REMINDER =================
    console.log("\n⚠️ ZAROORI: Abhi bot ke private chat mein jaa aur '/start' ya 'hi' bhej de!");
    console.log("   Bina iske bot ke private msgs miss ho sakte hain (Telegram rule)");
    console.log("   Bhej ke baad script restart kar dena → messages aane lagenge\n");

    // ================= MESSAGE HANDLER =================
    const messageHandler = async (event) => {
        const message = event.message;
        if (!message || message.out) return; // sirf incoming

        // Debug - har incoming pe yeh dikhega
        console.log("\n=== 🔥 INCOMING MESSAGE PAKDA ===");
        console.log("From Bot?     :", message.sender?.bot || false);
        console.log("Sender ID     :", message.senderId?.toString() || "nahi mila");
        console.log("Chat ID       :", message.chatId?.toString() || "nahi mila");
        console.log("Text (start)  :", (message.text || "[media ya empty]").substring(0, 120));
        console.log("===============================\n");

        // Allowed check
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
            console.log("📩 Yeh allowed source hai - Forward kar raha...");

            let text = message.text || "[Sirf media - text nahi]";

            // Cleaning (tera original)
            text = text.replace(/\*\*/g, "*")
                .replace("⚡ *FAST DROP*", "")
                .replace("⚡ *Men’s Product Alert (Superfast)*", "")
                .replace(`Buy Cheap Vouchers🫶\n🛒 Buy Vouchers\n\nFree Rs500 SHEIN Coupon⚡️\n💰 Free ₹500\n😄 Group And Info`, "")
                .replace(/🛒\s*\*{0,2}Buy Vouchers\*{0,2}:.*@SheinXVouchers_Bot/gi, "")
                .replace(/⚙️\s*\*{0,2}Powered by\*{0,2}:.*@SheinXCodes/gi, "")
                .trim();

            if (text.length > 0) {
                try {
                    await whatsappClient.sendMessage(TARGET_WHATSAPP_NUMBER, text);
                    console.log(`🚀 WhatsApp pe pahunch gaya: "${text.substring(0, 60)}..."`);
                } catch (err) {
                    console.error("❌ WA bhejte waqt error:", err.message);
                }
            } else {
                console.log("⚠️ Cleaning ke baad text khali - skip");
            }
        } else {
            console.log("🚫 Allowed nahi - ignore kar diya");
        }
    };

    // Events register
    client.addEventHandler(messageHandler, new NewMessage({ incoming: true }));

    console.log("🎧 Sun raha hu ab - Bot + Channel dono aa jayenge!");

    // Crash avoid
    process.on('uncaughtException', err => console.error("Unexpected error avoid:", err));
})();