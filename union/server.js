const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const port = 4000;
const dbFilePath = path.join(__dirname, 'users.json');
const messagesFilePath = path.join(__dirname, 'messages.json');

// Telegram Bot Configuration
const TELEGRAM_BOT_TOKEN = '8469492438:AAHM5wH86viXYC8sKVW9hEGMDWPd3YmFnGY';
const ADMIN_CHAT_ID = '8469492438';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
}));
app.use(express.static(path.join(__dirname, 'public')));

// Load user data from the JSON file
function loadUserData() {
    if (fs.existsSync(dbFilePath)) {
        return JSON.parse(fs.readFileSync(dbFilePath, 'utf8'));
    }
    return {};
}

// Save user data to the JSON file
function saveUserData(data) {
    fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 4));
}

// Load messages from the JSON file
function loadMessages() {
    if (fs.existsSync(messagesFilePath)) {
        return JSON.parse(fs.readFileSync(messagesFilePath, 'utf8'));
    }
    return { conversations: [] };
}

// Save message to the JSON file
function saveMessage(senderEmail, receiverEmail, message, senderName, messageType = 'user_to_admin') {
    const messages = loadMessages();
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const messageObj = {
        id: messageId,
        senderEmail,
        receiverEmail,
        senderName,
        message,
        timestamp: new Date().toISOString(),
        type: messageType,
        read: false
    };
    
    let conversation = messages.conversations.find(conv => 
        (conv.participants.includes(senderEmail) && conv.participants.includes(receiverEmail))
    );
    
    if (!conversation) {
        conversation = {
            id: `conv_${Date.now()}`,
            participants: [senderEmail, receiverEmail],
            messages: [],
            lastUpdated: new Date().toISOString()
        };
        messages.conversations.push(conversation);
    }
    
    conversation.messages.push(messageObj);
    conversation.lastUpdated = new Date().toISOString();
    
    fs.writeFileSync(messagesFilePath, JSON.stringify(messages, null, 4));
    return messageObj;
}

// Mark messages as read
function markMessagesAsRead(conversationId, readerEmail) {
    const messages = loadMessages();
    const conversation = messages.conversations.find(conv => conv.id === conversationId);
    
    if (conversation) {
        conversation.messages.forEach(msg => {
            if (msg.receiverEmail === readerEmail) {
                msg.read = true;
            }
        });
        fs.writeFileSync(messagesFilePath, JSON.stringify(messages, null, 4));
    }
}

// Check if user is admin
function isAdmin(email) {
    return email === 'westernswiftconnect@gmail.com';
}

// Register a new user
function saveUserToDb(fullname, email, password, phone, accountNumber, balance) {
    const users = loadUserData();

    if (users[email]) {
        return { success: false, message: 'User already exists' };
    }

    users[email] = {
        fullname,
        password,
        phone,
        account_number: accountNumber,
        balance: balance || 0,
        history: [],
        telegram_chat_id: null,
        role: isAdmin(email) ? 'admin' : 'user'
    };

    saveUserData(users);
    
    if (!isAdmin(email)) {
        notifyAdmin(`🆕 New user registered:\nName: ${fullname}\nEmail: ${email}\nAccount: ${accountNumber}`);
    }
    
    return { success: true, message: 'User registered successfully' };
}

// Telegram Bot Functions
function notifyAdmin(message) {
    bot.sendMessage(ADMIN_CHAT_ID, message).catch(error => {
        console.log('Error sending message to admin:', error.message);
    });
}

function notifyUser(userEmail, message, notificationType = 'admin_message', details = {}) {
    const users = loadUserData();
    const user = users[userEmail];
    
    if (user) {
        const notificationId = `notif_${Math.random().toString(36).substring(2, 15).toUpperCase()}`;
        user.history.push({
            type: 'notification',
            notificationType: notificationType,
            message: message,
            date: new Date().toISOString(),
            notificationId: notificationId,
            read: false,
            ...details
        });
        
        saveUserData(users);
        
        if (user.telegram_chat_id) {
            bot.sendMessage(user.telegram_chat_id, message).catch(error => {
                console.log('Error sending Telegram message to user:', error.message);
            });
        }
    }
}

function getUserByAccountNumber(accountNumber) {
    const users = loadUserData();
    for (const email in users) {
        if (users[email].account_number === accountNumber) {
            return { email, ...users[email] };
        }
    }
    return null;
}

function getUserByEmail(email) {
    const users = loadUserData();
    return users[email] || null;
}

function getUserByTelegramChatId(chatId) {
    const users = loadUserData();
    for (const email in users) {
        if (users[email].telegram_chat_id === chatId) {
            return { email, ...users[email] };
        }
    }
    return null;
}

// Store linked Telegram accounts
const telegramAdmins = new Map();
const pendingReplies = new Map();
const userSessions = new Map();

// Button configurations
const mainMenuButtons = {
    reply_markup: {
        keyboard: [
            ['📊 View Users', '💰 Check Balance'],
            ['💸 Send Money', '📨 Send Message'],
            ['📋 Transactions', '➕ Add Balance'],
            ['💬 View Chats', '🔔 Notifications']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    }
};

const userMenuButtons = {
    reply_markup: {
        keyboard: [
            ['💰 My Balance', '📋 My Transactions'],
            ['💬 Contact Admin', '🔔 My Notifications'],
            ['🆘 Help', '📞 Support']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    }
};

const backButton = {
    reply_markup: {
        keyboard: [['⬅️ Back to Main Menu']],
        resize_keyboard: true,
        one_time_keyboard: true
    }
};

const cancelButton = {
    reply_markup: {
        keyboard: [['❌ Cancel Operation']],
        resize_keyboard: true,
        one_time_keyboard: true
    }
};

// Enhanced Telegram Bot Interface with Buttons
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    if (telegramAdmins.has(chatId)) {
        const adminEmail = telegramAdmins.get(chatId);
        bot.sendMessage(chatId, `👋 Welcome back Admin (${adminEmail})! 
        
🏦 *Western Swift Connect - Admin Panel*

Use the buttons below to manage the system:`, {
            parse_mode: 'Markdown',
            reply_markup: mainMenuButtons.reply_markup
        });
        return;
    }
    
    bot.sendMessage(chatId, `👋 Welcome to Western Swift Connect! 
    
I'm your banking assistant. Please verify your identity to continue.

Send your registered email address to get started.`);
});

// Handle button clicks and text messages
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (text.startsWith('/')) return;
    
    const session = userSessions.get(chatId) || {};
    
    // Handle admin operations
    if (telegramAdmins.has(chatId)) {
        handleAdminMessage(chatId, text, session);
        return;
    }
    
    // Handle user operations
    handleUserMessage(chatId, text, session);
});

function handleAdminMessage(chatId, text, session) {
    const adminEmail = telegramAdmins.get(chatId);
    
    // Handle button actions
    switch(text) {
        case '📊 View Users':
            showAllUsers(chatId);
            break;
            
        case '💰 Check Balance':
            userSessions.set(chatId, { ...session, action: 'awaiting_email_balance' });
            bot.sendMessage(chatId, 'Please enter the user email to check balance:', cancelButton);
            break;
            
        case '💸 Send Money':
            userSessions.set(chatId, { ...session, action: 'awaiting_send_details' });
            bot.sendMessage(chatId, 'Please enter details in format:\nemail amount description\n\nExample: user@email.com 100 Payment', cancelButton);
            break;
            
        case '📨 Send Message':
            userSessions.set(chatId, { ...session, action: 'awaiting_message_details' });
            bot.sendMessage(chatId, 'Please enter details in format:\nemail message\n\nExample: user@email.com Hello there!', cancelButton);
            break;
            
        case '📋 Transactions':
            userSessions.set(chatId, { ...session, action: 'awaiting_email_transactions' });
            bot.sendMessage(chatId, 'Please enter the user email to view transactions:', cancelButton);
            break;
            
        case '➕ Add Balance':
            userSessions.set(chatId, { ...session, action: 'awaiting_add_balance' });
            bot.sendMessage(chatId, 'Please enter details in format:\nemail amount\n\nExample: user@email.com 500', cancelButton);
            break;
            
        case '💬 View Chats':
            showRecentChats(chatId);
            break;
            
        case '🔔 Notifications':
            showSystemNotifications(chatId);
            break;
            
        case '⬅️ Back to Main Menu':
            userSessions.delete(chatId);
            bot.sendMessage(chatId, '🏦 *Admin Main Menu*', {
                parse_mode: 'Markdown',
                reply_markup: mainMenuButtons.reply_markup
            });
            break;
            
        case '❌ Cancel Operation':
            userSessions.delete(chatId);
            bot.sendMessage(chatId, 'Operation cancelled.', {
                reply_markup: mainMenuButtons.reply_markup
            });
            break;
            
        default:
            handleAdminSession(chatId, text, session);
            break;
    }
}

function handleAdminSession(chatId, text, session) {
    const adminEmail = telegramAdmins.get(chatId);
    
    if (session.action) {
        switch(session.action) {
            case 'awaiting_email_balance':
                const user = getUserByEmail(text.trim().toLowerCase());
                if (user) {
                    bot.sendMessage(chatId, `💰 *Balance for ${user.fullname}:*\n\n💵 *Amount:* $${user.balance}\n📧 *Email:* ${text}\n💳 *Account:* ${user.account_number}`, {
                        parse_mode: 'Markdown',
                        reply_markup: mainMenuButtons.reply_markup
                    });
                } else {
                    bot.sendMessage(chatId, '❌ User not found. Please try again:', cancelButton);
                    return;
                }
                break;
                
            case 'awaiting_send_details':
                const sendParts = text.split(' ');
                if (sendParts.length >= 3) {
                    const email = sendParts[0];
                    const amount = parseFloat(sendParts[1]);
                    const description = sendParts.slice(2).join(' ');
                    
                    const users = loadUserData();
                    const user = users[email];
                    
                    if (!user) {
                        bot.sendMessage(chatId, "❌ User not found. Please try again:", cancelButton);
                        return;
                    }

                    user.balance += amount;
                    
                    const transactionId = `admin_txn_${Math.random().toString(36).substring(2, 15).toUpperCase()}`;
                    user.history.push({
                        type: 'credit',
                        amount: amount,
                        from: 'Admin',
                        to: user.fullname,
                        account: user.account_number,
                        transactionId: transactionId,
                        date: new Date().toISOString(),
                        senderName: 'Admin (Telegram)',
                        senderCountry: 'System',
                        description: description
                    });
                    
                    saveUserData(users);
                  
                    notifyUser(email, `💸 Incoming Transaction!\n\nAmount: $${amount}\nFrom: Admin\nDescription: ${description}\nNew Balance: $${user.balance}`, 
                        'transaction', 
                        { amount: amount, transactionId: transactionId }
                    );
                    
                    bot.sendMessage(chatId, `✅ Successfully sent $${amount} to ${user.fullname}\n📝 Description: ${description}\n🔢 Transaction ID: ${transactionId}`, {
                        reply_markup: mainMenuButtons.reply_markup
                    });
                } else {
                    bot.sendMessage(chatId, '❌ Invalid format. Please use: email amount description', cancelButton);
                    return;
                }
                break;
                
            case 'awaiting_message_details':
                const messageParts = text.split(' ');
                if (messageParts.length >= 2) {
                    const email = messageParts[0];
                    const message = messageParts.slice(1).join(' ');
                    
                    notifyUser(email, `📨 Message from Admin:\n\n${message}`, 'admin_message');
                    
                    const adminUser = getUserByEmail(adminEmail);
                    if (adminUser) {
                        saveMessage(adminUser.email, email, message, 'Admin', 'admin_to_user');
                    }
                    
                    bot.sendMessage(chatId, `✅ Message sent to user ${email}`, {
                        reply_markup: mainMenuButtons.reply_markup
                    });
                } else {
                    bot.sendMessage(chatId, '❌ Invalid format. Please use: email message', cancelButton);
                    return;
                }
                break;
                
            case 'awaiting_email_transactions':
                const userForTxn = getUserByEmail(text.trim().toLowerCase());
                if (userForTxn) {
                    showUserTransactions(chatId, text.trim().toLowerCase());
                } else {
                    bot.sendMessage(chatId, '❌ User not found. Please try again:', cancelButton);
                    return;
                }
                break;
                
            case 'awaiting_add_balance':
                const addParts = text.split(' ');
                if (addParts.length >= 2) {
                    const email = addParts[0];
                    const amount = parseFloat(addParts[1]);
                    
                    const users = loadUserData();
                    const user = users[email];
                    
                    if (!user) {
                        bot.sendMessage(chatId, "❌ User not found. Please try again:", cancelButton);
                        return;
                    }

                    user.balance += amount;
                    saveUserData(users);
                    
                    notifyUser(email, `💰 Balance Updated!\n\nAmount: +$${amount}\nNew Balance: $${user.balance}\nReason: Admin adjustment`, 
                        'balance_update',
                        { amount: amount, newBalance: user.balance }
                    );
                    
                    bot.sendMessage(chatId, `✅ Added $${amount} to ${user.fullname}'s account\n💵 New Balance: $${user.balance}`, {
                        reply_markup: mainMenuButtons.reply_markup
                    });
                } else {
                    bot.sendMessage(chatId, '❌ Invalid format. Please use: email amount', cancelButton);
                    return;
                }
                break;
                
            case 'awaiting_reply':
                const targetEmail = session.targetEmail;
                notifyUser(targetEmail, `📨 Reply from Admin:\n\n${text}`, 'admin_reply');
                
                const adminUser = getUserByEmail(adminEmail);
                if (adminUser) {
                    saveMessage(adminUser.email, targetEmail, text, 'Admin', 'admin_to_user');
                }
                
                bot.sendMessage(chatId, `✅ Reply sent to user!`, {
                    reply_markup: mainMenuButtons.reply_markup
                });
                break;
        }
        userSessions.delete(chatId);
    } else {
        // Handle regular admin messages
        if (text.includes('@') && text.includes('.')) {
            return;
        }
        
        notifyAdmin(`💬 Admin Message from ${adminEmail}:\n\n${text}`);
    }
}

function handleUserMessage(chatId, text, session) {
    const users = loadUserData();
    let userEmail = null;
    
    for (const email in users) {
        if (users[email].telegram_chat_id === chatId) {
            userEmail = email;
            break;
        }
    }
    
    // Handle button actions for users
    if (userEmail) {
        const user = users[userEmail];
        
        switch(text) {
            case '💰 My Balance':
                bot.sendMessage(chatId, `💰 *Your Account Balance:*\n\n💵 *Amount:* $${user.balance}\n📧 *Email:* ${userEmail}\n💳 *Account:* ${user.account_number}`, {
                    parse_mode: 'Markdown',
                    reply_markup: userMenuButtons.reply_markup
                });
                break;
                
            case '📋 My Transactions':
                showUserTransactions(chatId, userEmail);
                break;
                
            case '💬 Contact Admin':
                userSessions.set(chatId, { ...session, action: 'awaiting_user_message' });
                bot.sendMessage(chatId, 'Please type your message to admin:', cancelButton);
                break;
                
            case '🔔 My Notifications':
                showUserNotifications(chatId, userEmail);
                break;
                
            case '🆘 Help':
                bot.sendMessage(chatId, `🆘 *Help Center*\n\nFor assistance, you can:\n\n• Send a message to admin using "Contact Admin"\n• Check your balance and transactions\n• Contact support during business hours\n\nWe're here to help!`, {
                    parse_mode: 'Markdown',
                    reply_markup: userMenuButtons.reply_markup
                });
                break;
                
            case '📞 Support':
                bot.sendMessage(chatId, `📞 *Support Information*\n\n🕒 Business Hours: 9AM-5PM Mon-Fri\n📧 Email: support@westernswift.com\n☎️ Phone: +1-555-0123\n\nFor urgent matters, use "Contact Admin" button.`, {
                    parse_mode: 'Markdown',
                    reply_markup: userMenuButtons.reply_markup
                });
                break;
                
            case '❌ Cancel Operation':
                userSessions.delete(chatId);
                bot.sendMessage(chatId, 'Operation cancelled.', {
                    reply_markup: userMenuButtons.reply_markup
                });
                break;
                
            default:
                if (session.action === 'awaiting_user_message') {
                    notifyAdmin(`💬 Website Chat from ${user.fullname} (${userEmail}):\n\n${text}`);
                    saveMessage(userEmail, 'westernswiftconnect@gmail.com', text, user.fullname, 'user_to_admin');
                    userSessions.delete(chatId);
                    
                    // Add quick reply button for admin
                    const replyButton = {
                        reply_markup: {
                            inline_keyboard: [[
                                {
                                    text: '📨 Quick Reply',
                                    callback_data: `quick_reply:${userEmail}`
                                }
                            ]]
                        }
                    };
                    
                    bot.sendMessage(chatId, '✅ Message sent to admin! They will reply soon.', {
                        reply_markup: userMenuButtons.reply_markup
                    });
                    
                    // Notify admin with reply option
                    bot.sendMessage(ADMIN_CHAT_ID, `💬 New message from ${user.fullname} (${userEmail}):\n\n${text}`, replyButton);
                } else if (text.includes('@') && text.includes('.')) {
                    // Email verification for linking
                    const email = text.trim().toLowerCase();
                    
                    if (users[email]) {
                        users[email].telegram_chat_id = chatId;
                        saveUserData(users);
                        
                        bot.sendMessage(chatId, `✅ Account linked successfully! You will now receive real-time notifications.`, {
                            reply_markup: userMenuButtons.reply_markup
                        });
                        notifyAdmin(`🔗 User ${email} linked their Telegram account`);
                    } else {
                        bot.sendMessage(chatId, `❌ Email not found. Please make sure you're registered on the platform.`);
                    }
                } else {
                    // Regular user message to admin
                    const user = users[userEmail];
                    notifyAdmin(`💬 Message from ${user.fullname} (${userEmail}):\n\n${text}`);
                    saveMessage(userEmail, 'westernswiftconnect@gmail.com', text, user.fullname, 'user_to_admin');
                    
                    bot.sendMessage(chatId, `✅ Message sent to admin! They will reply soon.`, {
                        reply_markup: userMenuButtons.reply_markup
                    });
                }
                break;
        }
    } else {
        // User not linked yet
        if (text.includes('@') && text.includes('.')) {
            const email = text.trim().toLowerCase();
            
            if (email === 'westernswiftconnect@gmail.com') {
                bot.sendMessage(chatId, '🔐 Please send your admin password to verify your identity.');
                
                bot.once('message', (passwordMsg) => {
                    const password = passwordMsg.text;
                    
                    if (password === 'Tomtom1@') {
                        telegramAdmins.set(chatId, email);
                        
                        bot.sendMessage(chatId, `✅ *Admin verification successful!*`, {
                            parse_mode: 'Markdown',
                            reply_markup: mainMenuButtons.reply_markup
                        });
                        
                        notifyAdmin(`🔐 Admin ${email} logged into Telegram bot`);
                        
                    } else {
                        bot.sendMessage(chatId, '❌ Invalid password. Access denied.');
                    }
                });
                
            } else {
                const users = loadUserData();
                const userEmail = text.trim().toLowerCase();
                
                if (users[userEmail]) {
                    users[userEmail].telegram_chat_id = chatId;
                    saveUserData(users);
                    
                    bot.sendMessage(chatId, `✅ Account linked successfully! You will now receive real-time notifications.`, {
                        reply_markup: userMenuButtons.reply_markup
                    });
                    notifyAdmin(`🔗 User ${userEmail} linked their Telegram account`);
                } else {
                    bot.sendMessage(chatId, `❌ Email not found. Please make sure you're registered on the platform.`);
                }
            }
        } else {
            bot.sendMessage(chatId, `Please send your registered email to link your account first.`);
        }
    }
}

// Handle inline button callbacks
bot.on('callback_query', (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    if (data.startsWith('quick_reply:')) {
        const userEmail = data.split(':')[1];
        userSessions.set(chatId, { action: 'awaiting_reply', targetEmail: userEmail });
        
        bot.sendMessage(chatId, `💬 Quick reply to ${userEmail}:\n\nType your message:`, cancelButton);
    }
    
    bot.answerCallbackQuery(callbackQuery.id);
});

// Helper functions for admin operations
function showAllUsers(chatId) {
    const users = loadUserData();
    let message = "📊 *All Registered Users:*\n\n";
    
    Object.keys(users).forEach((email, index) => {
        const user = users[email];
        const unreadNotifications = user.history.filter(n => n.type === 'notification' && !n.read).length;
        
        message += `${index + 1}. *${user.fullname}*\n`;
        message += `   📧 Email: ${email}\n`;
        message += `   💳 Account: ${user.account_number}\n`;
        message += `   💰 Balance: $${user.balance}\n`;
        message += `   🔔 Unread: ${unreadNotifications} notifications\n`;
        message += `   👤 Role: ${user.role}\n\n`;
    });

    bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuButtons.reply_markup 
    });
}

function showRecentChats(chatId) {
    const messages = loadMessages();
    let message = "💬 *Recent User Conversations:*\n\n";
    
    const adminConversations = messages.conversations.filter(conv => 
        conv.participants.includes('westernswiftconnect@gmail.com')
    ).sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated)).slice(0, 10);
    
    if (adminConversations.length === 0) {
        message += "No recent conversations.";
    } else {
        adminConversations.forEach((conv, index) => {
            const userEmail = conv.participants.find(p => p !== 'westernswiftconnect@gmail.com');
            const user = getUserByEmail(userEmail);
            const unreadCount = conv.messages.filter(msg => 
                msg.receiverEmail === 'westernswiftconnect@gmail.com' && !msg.read
            ).length;
            
            const lastMessage = conv.messages[conv.messages.length - 1];
            message += `${index + 1}. 👤 ${user ? user.fullname : userEmail}\n`;
            message += `   📧 ${userEmail}\n`;
            message += `   💬 ${lastMessage.message.substring(0, 50)}...\n`;
            message += `   🔔 Unread: ${unreadCount} messages\n`;
            message += `   ⏰ Last: ${new Date(lastMessage.timestamp).toLocaleString()}\n\n`;
            
            // Add quick action buttons
            const actionButtons = {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📨 Reply',
                            callback_data: `quick_reply:${userEmail}`
                        },
                        {
                            text: '💰 Send Money',
                            callback_data: `quick_send:${userEmail}`
                        }
                    ]]
                }
            };
        });
    }

    bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuButtons.reply_markup 
    });
}

function showSystemNotifications(chatId) {
    const users = loadUserData();
    let message = "🔔 *Recent System Notifications:*\n\n";
    let notificationCount = 0;
    
    Object.keys(users).forEach(email => {
        const user = users[email];
        const recentNotifications = user.history
            .filter(entry => entry.type === 'notification')
            .slice(-5)
            .reverse();
        
        if (recentNotifications.length > 0) {
            message += `👤 *${user.fullname} (${email})*:\n`;
            recentNotifications.forEach((notif, index) => {
                message += `   ${index + 1}. ${notif.notificationType}\n`;
                message += `      ${notif.message.split('\n')[0]}\n`;
                message += `      ⏰ ${new Date(notif.date).toLocaleString()}\n\n`;
                notificationCount++;
            });
        }
    });
    
    if (notificationCount === 0) {
        message += "No recent notifications.";
    }

    bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: mainMenuButtons.reply_markup 
    });
}

function showUserTransactions(chatId, email) {
    const user = getUserByEmail(email);
    
    if (!user) {
        bot.sendMessage(chatId, "❌ User not found");
        return;
    }

    let message = `📋 *Transaction History for ${user.fullname}:*\n\n`;
    const recentTransactions = user.history.slice(-10).reverse();
    
    if (recentTransactions.length === 0) {
        message += "No transactions found.";
    } else {
        recentTransactions.forEach((entry, index) => {
            if (entry.type === 'notification') {
                message += `${index + 1}. 🔔 NOTIFICATION - ${entry.notificationType}\n`;
                message += `   📝 ${entry.message.split('\n')[0]}\n`;
            } else {
                const emoji = entry.type === 'credit' ? '⬆️' : '⬇️';
                message += `${index + 1}. ${emoji} ${entry.type.toUpperCase()} - $${entry.amount}\n`;
                if (entry.from) message += `   👤 From: ${entry.from}\n`;
                if (entry.to) message += `   👥 To: ${entry.to}\n`;
            }
            message += `   📅 ${new Date(entry.date).toLocaleString()}\n`;
            message += `   🔢 ID: ${entry.transactionId || entry.notificationId}\n`;
            if (entry.description) message += `   📋 Desc: ${entry.description}\n`;
            message += `\n`;
        });
    }

    const isAdmin = telegramAdmins.has(chatId);
    bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: isAdmin ? mainMenuButtons.reply_markup : userMenuButtons.reply_markup
    });
}

function showUserNotifications(chatId, email) {
    const user = getUserByEmail(email);
    
    if (!user) {
        bot.sendMessage(chatId, "❌ User not found");
        return;
    }

    let message = `🔔 *Your Notifications:*\n\n`;
    const recentNotifications = user.history
        .filter(entry => entry.type === 'notification')
        .slice(-10)
        .reverse();
    
    if (recentNotifications.length === 0) {
        message += "No notifications found.";
    } else {
        recentNotifications.forEach((notif, index) => {
            message += `${index + 1}. ${notif.notificationType}\n`;
            message += `   ${notif.message.split('\n')[0]}\n`;
            message += `   ⏰ ${new Date(notif.date).toLocaleString()}\n\n`;
        });
    }

    bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: userMenuButtons.reply_markup
    });
}

// Routes (unchanged from original code)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    const users = loadUserData();

    if ((email === 'westernswiftconnect@gmail.com' && password === 'Tomtom1@') || (users[email] && users[email].password === password)) {
        req.session.email = email;
        req.session.isAdmin = isAdmin(email);
        res.redirect('/dashboard');
    } else {
        res.send('Invalid credentials');
    }
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.post('/register', (req, res) => {
    const { fullname, email, password, phone, accountNumber, balance } = req.body;
    const result = saveUserToDb(fullname, email, password, phone, accountNumber, balance);
    res.json(result);
});

app.post('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/dashboard', (req, res) => {
    if (!req.session.email) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.post('/transfer', (req, res) => {
    if (!req.session.email) {
        return res.redirect('/login');
    }

    const { account_number, amount, bank, recipientName, senderCountry } = req.body;
    const users = loadUserData();
    const senderEmail = req.session.email;

    if (!users[senderEmail]) {
        return res.send('Sender not found');
    }

    if (bank !== 'Western Union') {
        return res.send('This transfer is only supported for Western Union');
    }

    const senderData = users[senderEmail];
    const senderBalance = parseFloat(senderData.balance);

    if (senderBalance >= parseFloat(amount)) {
        let recipientFound = false;

        for (const userEmail in users) {
            if (users[userEmail].account_number === parseInt(account_number)) {
                recipientFound = true;
                const recipientData = users[userEmail];
                recipientData.balance += parseFloat(amount);
                senderData.balance -= parseFloat(amount);

                const transactionId = `txn_${Math.random().toString(36).substring(2, 15).toUpperCase()}`;

                senderData.history.push({
                    type: 'debit',
                    amount,
                    to: recipientData.fullname,
                    account: senderData.account_number,
                    receiptAccount: recipientData.account_number,
                    transactionId: transactionId,
                    date: new Date().toISOString(),
                    senderName: senderData.fullname,
                    senderCountry,
                });

                recipientData.history.push({
                    type: 'credit',
                    amount,
                    from: senderData.account_number,
                    account: recipientData.account_number,
                    transactionId: transactionId,
                    date: new Date().toISOString(),
                    senderName: senderData.fullname,
                    senderCountry,
                    to: recipientData.fullname,
                });

                saveUserData(users);
                
                notifyUser(userEmail, `💸 Incoming Transfer!\n\nAmount: $${amount}\nFrom: ${senderData.fullname}\nTransaction ID: ${transactionId}`, 
                    'transaction_received',
                    { amount: amount, from: senderData.fullname, transactionId: transactionId }
                );
                
                notifyUser(senderEmail, `💸 Transfer Sent!\n\nAmount: $${amount}\nTo: ${recipientData.fullname}\nTransaction ID: ${transactionId}`, 
                    'transaction_sent',
                    { amount: amount, to: recipientData.fullname, transactionId: transactionId }
                );
                
                return res.send('Transfer successful and history updated!');
            }
        }

        if (!recipientFound) {
            return res.send('Recipient not found');
        }
    } else {
        return res.send('Insufficient funds');
    }
});

app.get('/history', (req, res) => {
    if (!req.session.email) {
        return res.status(401).json({ error: 'User not logged in' });
    }

    const users = loadUserData();
    const userEmail = req.session.email;

    if (users[userEmail]) {
        const history = users[userEmail].history;
        res.json(history);
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

app.get('/chat', (req, res) => {
    if (!req.session.email) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.post('/chat', (req, res) => {
    if (!req.session.email) {
        return res.redirect('/login');
    }
    const { message } = req.body;
    const userEmail = req.session.email;
    const users = loadUserData();
    const user = users[userEmail];
    
    if (user) {
        saveMessage(userEmail, 'westernswiftconnect@gmail.com', message, user.fullname, 'user_to_admin');
        notifyAdmin(`💬 Website Chat from ${user.fullname} (${userEmail}):\n\n${message}`);
    }
    
    res.send('Message sent!');
});

app.get('/admin-chat', (req, res) => {
    if (!req.session.email || !isAdmin(req.session.email)) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/conversations', (req, res) => {
    if (!req.session.email || !isAdmin(req.session.email)) {
        return res.status(401).json({ error: 'Unauthorized access' });
    }

    const messages = loadMessages();
    const adminConversations = messages.conversations.filter(conv => 
        conv.participants.includes('westernswiftconnect@gmail.com')
    ).map(conv => {
        const userEmail = conv.participants.find(p => p !== 'westernswiftconnect@gmail.com');
        const user = getUserByEmail(userEmail);
        const unreadCount = conv.messages.filter(msg => 
            msg.receiverEmail === 'westernswiftconnect@gmail.com' && !msg.read
        ).length;
        
        return {
            id: conv.id,
            userEmail: userEmail,
            userName: user ? user.fullname : userEmail,
            lastMessage: conv.messages[conv.messages.length - 1],
            unreadCount: unreadCount,
            lastUpdated: conv.lastUpdated
        };
    }).sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
    
    res.json(adminConversations);
});

app.get('/api/conversation/:conversationId', (req, res) => {
    if (!req.session.email) {
        return res.status(401).json({ error: 'Unauthorized access' });
    }

    const { conversationId } = req.params;
    const messages = loadMessages();
    const conversation = messages.conversations.find(conv => conv.id === conversationId);
    
    if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
    }
    
    if (conversation.participants.includes(req.session.email)) {
        markMessagesAsRead(conversationId, req.session.email);
    }
    
    res.json(conversation.messages);
});

app.post('/api/admin-chat', (req, res) => {
    if (!req.session.email || !isAdmin(req.session.email)) {
        return res.status(401).json({ error: 'Unauthorized access' });
    }

    const { message, userEmail } = req.body;
    const adminEmail = req.session.email;
    
    saveMessage(adminEmail, userEmail, message, 'Admin', 'admin_to_user');
    
    notifyUser(userEmail, `📨 Message from Admin:\n\n${message}`, 'admin_message');
    
    res.json({ success: true, message: 'Message sent to user!' });
});

app.get('/fetch-messages', (req, res) => {
    if (!req.session.email) {
        return res.status(401).json({ error: 'User not logged in' });
    }

    const messages = loadMessages();
    const userConversations = messages.conversations.filter(conv => 
        conv.participants.includes(req.session.email)
    );
    
    res.json(userConversations);
});

app.get('/data', (req, res) => {
    if (!req.session.email) {
        return res.status(401).json({ error: 'User not logged in' });
    }

    const users = loadUserData();
    const userEmail = req.session.email;

    if (users[userEmail]) {
        res.json(users[userEmail]);
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

app.get('/fetch-users', (req, res) => {
    if (!req.session.email || !isAdmin(req.session.email)) {
        return res.status(401).json({ error: 'Unauthorized access' });
    }
    const users = loadUserData();
    const userList = Object.keys(users).map(email => ({
        email: email,
        fullname: users[email].fullname,
        role: users[email].role
    }));
    res.json(userList);
});

app.post('/api/transfer', (req, res) => {
    const { accountNumber, bank, recipientName, amount } = req.body;
    const users = loadUserData();
    const senderEmail = req.session.email;
    const senderData = users[senderEmail];

    if (!senderData) {
        return res.status(400).json({ message: 'Sender not found. Please log in again.' });
    }

    if (parseFloat(amount) > senderData.balance) {
        return res.status(400).json({ message: 'Insufficient funds.' });
    }

    senderData.balance -= parseFloat(amount);

    const transactionId = `txn_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const senderHistory = {
        type: 'debit',
        amount: parseFloat(amount),
        date: new Date().toISOString(),
        senderName: senderData.fullname,
        senderCountry: "Nigeria",
        account: senderData.account_number,
        receiptAccount: accountNumber,
        transactionId: transactionId,
        from: senderData.account_number,
        to: recipientName
    };

    senderData.history.push(senderHistory);

    saveUserData(users);
    
    notifyUser(senderEmail, `💸 Transfer Initiated!\n\nAmount: $${amount}\nTo: ${recipientName}\nTransaction ID: ${transactionId}`, 
        'transaction_sent',
        { amount: amount, to: recipientName, transactionId: transactionId }
    );
    
    res.status(200).json({ 
        message: 'Transfer successful!',
        transactionId: transactionId
    });
});

app.post('/api/admin-transfer', (req, res) => {
    if (!req.session.email || !isAdmin(req.session.email)) {
        return res.status(401).json({ error: 'Unauthorized access' });
    }

    const { userEmail, amount, description } = req.body;
    const users = loadUserData();
    
    if (!users[userEmail]) {
        return res.status(400).json({ message: 'User not found' });
    }

    users[userEmail].balance += parseFloat(amount);
    
    const transactionId = `admin_txn_${Math.random().toString(36).substring(2, 15).toUpperCase()}`;
    users[userEmail].history.push({
        type: 'credit',
        amount: parseFloat(amount),
        from: 'western Union FL florida USA',
        to: users[userEmail].fullname,
        account: users[userEmail].account_number,
        transactionId: transactionId,
        date: new Date().toISOString(),
        senderName: 'Admin',
        senderCountry: 'System',
        description: description || 'Admin transfer'
    });

    saveUserData(users);
    
    notifyUser(userEmail, `💰 Admin Transfer Received!\n\nAmount: $${amount}\nDescription: ${description || 'Admin transfer'}\nNew Balance: $${users[userEmail].balance}`, 
        'admin_transfer',
        { amount: amount, description: description, newBalance: users[userEmail].balance }
    );
    
    res.json({ message: 'Funds transferred successfully!' });
});

app.get('/notifications', (req, res) => {
    if (!req.session.email) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'notifications.html'));
});

app.post('/api/mark-notification-read', (req, res) => {
    if (!req.session.email) {
        return res.status(401).json({ error: 'User not logged in' });
    }

    const { notificationId } = req.body;
    const users = loadUserData();
    const userEmail = req.session.email;
    const user = users[userEmail];

    if (user) {
        const notification = user.history.find(item => 
            item.notificationId === notificationId || item.transactionId === notificationId
        );
        if (notification) {
            notification.read = true;
            saveUserData(users);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Notification not found' });
        }
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
    console.log(`Telegram bot is running with button interface...`);
    console.log(`Admin email: westernswiftconnect@gmail.com`);
    console.log(`Admin password: Tomtom1@`);
});
