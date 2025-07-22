const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: ['https://vidochat.neocities.org'],
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'],
        credentials: true
    }
});

// In-memory queues for matchmaking
const queues = {
    waitingMales18: [],
    waitingMalesUnder: [],
    waitingFemales18: [],
    waitingFemalesUnder: []
};

// Active rooms
const rooms = new Map();

// Root route to avoid "Cannot GET /" error
app.get('/', (req, res) => res.status(200).send('Video chat backend running'));

// Health check endpoint
app.get('/health', (req, res) => res.status(200).send('OK'));

function findMatch(user) {
    let queue;
    if (user.gender === 'female') {
        queue = user.ageGroup === '18+' ? queues.waitingMales18 : queues.waitingMalesUnder;
    } else {
        queue = user.ageGroup === '18+' ? queues.waitingFemales18 : queues.waitingFemalesUnder;
        if (queue.length === 0) {
            queue = user.ageGroup === '18+' ? queues.waitingMales18 : queues.waitingMalesUnder;
        }
    }

    if (queue.length > 0) {
        const partner = queue.shift();
        const roomId = `${user.id}-${partner.id}`;
        rooms.set(roomId, [user, partner]);
        io.to(user.id).emit('matched', { room: roomId, partnerNickname: partner.nickname, initiator: true });
        io.to(partner.id).emit('matched', { room: roomId, partnerNickname: user.nickname, initiator: false });
        return true;
    }
    return false;
}

io.on('connection', (socket) => {
    socket.on('joinQueue', ({ nickname, gender, ageGroup }) => {
        const user = { id: socket.id, nickname, gender, ageGroup };
        const queueName = `waiting${gender.charAt(0).toUpperCase() + gender.slice(1)}${ageGroup === '18+' ? '18' : 'Under'}`;
        if (!queues[queueName]) {
            socket.emit('error', 'Invalid queue');
            return;
        }

        if (!findMatch(user)) {
            queues[queueName].push(user);
        }
    });

    socket.on('signal', ({ room, signalData }) => {
        const roomUsers = rooms.get(room);
        if (roomUsers) {
            const partner = roomUsers.find(u => u.id !== socket.id);
            if (partner) {
                io.to(partner.id).emit('signal', { signalData });
            }
        }
    });

    socket.on('chatMessage', ({ room, message }) => {
        const roomUsers = rooms.get(room);
        if (roomUsers) {
            const partner = roomUsers.find(u => u.id !== socket.id);
            if (partner) {
                io.to(partner.id).emit('message', message);
            }
        }
    });

    socket.on('leaveRoom', (room) => {
        const roomUsers = rooms.get(room);
        if (roomUsers) {
            const partner = roomUsers.find(u => u.id !== socket.id);
            if (partner) {
                io.to(partner.id).emit('partnerDisconnected');
            }
            rooms.delete(room);
        }
    });

    socket.on('disconnect', () => {
        // Remove from queue if waiting
        for (const queue of Object.values(queues)) {
            const index = queue.findIndex(u => u.id === socket.id);
            if (index !== -1) {
                queue.splice(index, 1);
                break;
            }
        }
        // Notify partner if in room
        for (const [roomId, users] of rooms) {
            if (users.some(u => u.id === socket.id)) {
                const partner = users.find(u => u.id !== socket.id);
                if (partner) {
                    io.to(partner.id).emit('partnerDisconnected');
                }
                rooms.delete(roomId);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
