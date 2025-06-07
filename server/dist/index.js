"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: ["http://localhost:8080", "http://127.0.0.1:8080"],
        methods: ['GET', 'POST']
    }
});
app.use((0, cors_1.default)({ origin: ["http://localhost:8080", "http://127.0.0.1:8080"] }));
// 参加中プレイヤー一覧
const players = [];
let playerCount = 0;
// ゲーム用山札
let deck = [];
// 場のカード
let fieldCard = null;
// 手を置いたタイムスタンプ記録用
let touchActions = [];
let touchTimeout = null;
// プレイヤーの手札枚数管理
const playerHands = {};
io.on('connection', (socket) => {
    // プレイヤー名を自動割り振り
    playerCount++;
    const playerName = `プレイヤー${playerCount}`;
    const player = { id: socket.id, name: playerName };
    players.push(player);
    console.log(`クライアント接続: ${socket.id} (${playerName})`);
    // クライアントに自分のプレイヤー名と全体リストを送信
    socket.emit('playerInfo', { id: socket.id, name: playerName });
    io.emit('playerList', players);
    io.emit('handInfo', playerHands);
    socket.emit('messageFromServer', 'サーバーへようこそ！');
    // クライアント接続時に場のカードを送信
    socket.emit('fieldCard', fieldCard);
    socket.on('messageFromClient', (data) => {
        console.log(`クライアント(${socket.id})から:`, data);
    });
    // ゲーム開始時にデッキ生成・シャッフル
    socket.on('startGame', () => {
        deck = shuffle(createDeck());
        fieldCard = null;
        for (const id in playerHands)
            playerHands[id] = 0;
        io.emit('deckInfo', { remaining: deck.length });
        io.emit('fieldCard', fieldCard);
        io.emit('handInfo', playerHands);
        console.log('デッキ生成・シャッフル:', deck.length, '枚');
    });
    // カードをめくるリクエスト
    socket.on('drawCard', () => {
        if (deck.length > 0) {
            fieldCard = deck.shift();
            io.emit('deckInfo', { remaining: deck.length });
            io.emit('fieldCard', fieldCard);
            // 「1」「3」「9」判定
            if ([1, 3, 9].includes(fieldCard.value)) {
                io.emit('touchPhase', true);
                touchActions = [];
                if (touchTimeout)
                    clearTimeout(touchTimeout);
                touchTimeout = setTimeout(() => {
                    io.emit('touchPhase', false);
                    if (touchActions.length > 0) {
                        // 最も遅かった人だけがペナルティ
                        const last = touchActions[touchActions.length - 1];
                        // 最速と最遅が同じ場合（1人だけ押した場合）はペナルティ
                        if (touchActions.length === 1) {
                            playerHands[last.id] = (playerHands[last.id] || 0) + (fieldCard ? 1 : 0);
                            io.emit('handInfo', playerHands);
                            io.emit('touchResult', { loserId: last.id, field: [...(fieldCard ? [fieldCard] : [])] });
                        }
                        else {
                            // 最遅のみペナルティ
                            playerHands[last.id] = (playerHands[last.id] || 0) + (fieldCard ? 1 : 0);
                            io.emit('handInfo', playerHands);
                            io.emit('touchResult', { loserId: last.id, field: [...(fieldCard ? [fieldCard] : [])] });
                        }
                    }
                    else {
                        io.emit('touchResult', null);
                    }
                }, 2000);
            }
            else {
                io.emit('touchPhase', false);
                // 誤タッチ判定: 2秒間だけ受付
                touchActions = [];
                if (touchTimeout)
                    clearTimeout(touchTimeout);
                touchTimeout = setTimeout(() => {
                    if (touchActions.length > 0) {
                        // 最初に押した人がペナルティ
                        const first = touchActions[0];
                        playerHands[first.id] = (playerHands[first.id] || 0) + (fieldCard ? 1 : 0);
                        io.emit('handInfo', playerHands);
                        io.emit('touchResult', { loserId: first.id, field: [...(fieldCard ? [fieldCard] : [])], mistake: true });
                    }
                    else {
                        io.emit('touchResult', null);
                    }
                }, 2000);
            }
        }
    });
    // 手を置くアクション
    socket.on('touchField', () => {
        // 既に押した人は無視
        if (touchActions.find(a => a.id === socket.id))
            return;
        touchActions.push({ id: socket.id, time: Date.now() });
    });
    socket.on('disconnect', () => {
        // 切断時にプレイヤーリストから削除
        const idx = players.findIndex(p => p.id === socket.id);
        if (idx !== -1) {
            console.log(`クライアント切断: ${socket.id} (${players[idx].name})`);
            players.splice(idx, 1);
            io.emit('playerList', players);
        }
        else {
            console.log(`クライアント切断: ${socket.id}`);
        }
        delete playerHands[socket.id];
        io.emit('handInfo', playerHands);
    });
});
// デッキ生成関数
function createDeck() {
    const suits = ['S', 'H', 'D', 'C'];
    const deck = [];
    for (const suit of suits) {
        for (let v = 1; v <= 13; v++) {
            deck.push({ suit, value: v });
        }
    }
    // ジョーカー2枚
    deck.push({ suit: 'JOKER', value: 0 });
    deck.push({ suit: 'JOKER', value: 0 });
    return deck;
}
// シャッフル関数（Fisher-Yates）
function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`サーバー起動: http://localhost:${PORT}`);
});
