const express = require('express');
const cors = require('cors');
const http = require('http'); // 🔑 Required for WebSockets
const { Server } = require('socket.io'); // 🔑 Required for WebSockets
require('dotenv').config();

const authRoutes = require('./routes/auth_routes');
const patientAuthRoutes = require('./routes/patient_auth_routes');
const staffRoutes = require('./routes/staff_routes');
const queueRoutes = require('./routes/queue_routes');
const clinicroutes = require('./routes/clinic_routes');
const contactRoutes = require('./routes/contact_routes');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const server = http.createServer(app);

const normalizeOrigin = (origin) => {
    if (!origin || typeof origin !== 'string') {
        return '';
    }

    const trimmedOrigin = origin.trim().replace(/\/+$/, '');
    if (!trimmedOrigin) {
        return '';
    }

    try {
        const parsed = new URL(trimmedOrigin);
        return `${parsed.protocol}//${parsed.host}`.toLowerCase();
    } catch {
        return trimmedOrigin.toLowerCase();
    }
};

const parseAllowedOrigins = (value) => {
    if (!value) {
        return [];
    }

    return value
        .split(',')
        .map((origin) => normalizeOrigin(origin))
        .filter(Boolean);
};

const allowedOrigins = new Set([
    ...parseAllowedOrigins(process.env.CORS_ORIGINS),
    ...parseAllowedOrigins(process.env.FRONTEND_URL),
    normalizeOrigin('http://localhost:5173')
]);

const vercelProjectPrefixes = new Set();
for (const configuredOrigin of allowedOrigins) {
    if (!configuredOrigin.includes('.vercel.app')) {
        continue;
    }

    try {
        const hostname = new URL(configuredOrigin).hostname.toLowerCase();
        const prefix = hostname.split('.vercel.app')[0];
        if (prefix) {
            vercelProjectPrefixes.add(prefix);
        }
    } catch {
        continue;
    }
}

const isAllowedVercelPreviewOrigin = (origin) => {
    if (!origin || vercelProjectPrefixes.size === 0) {
        return false;
    }

    try {
        const hostname = new URL(origin).hostname.toLowerCase();
        if (!hostname.endsWith('.vercel.app')) {
            return false;
        }

        for (const prefix of vercelProjectPrefixes) {
            if (hostname === `${prefix}.vercel.app` || hostname.startsWith(`${prefix}-`)) {
                return true;
            }
        }

        return false;
    } catch {
        return false;
    }
};

const isOriginAllowed = (origin) => {
    if (!origin) {
        return true;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    return allowedOrigins.has(normalizedOrigin) || isAllowedVercelPreviewOrigin(normalizedOrigin);
};

const corsOptions = {
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            return callback(null, true);
        }

        if (!isProduction) {
            console.warn(`CORS blocked origin: ${origin}`);
            console.warn(`Allowed origins: ${Array.from(allowedOrigins).join(', ')}`);
        }

        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'],
    credentials: true
};

// 🛠️ Initialize Socket.io
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (isOriginAllowed(origin)) {
                return callback(null, true);
            }
            return callback(new Error('Socket origin not allowed'));
        },
        methods: ["GET", "POST", "PATCH", "DELETE"]
    }
});

io.on('connection', (socket) => {
    console.log('⚡ Client Connected:', socket.id);

    socket.on('joinClinic', (clinicId) => {
        if (!clinicId) {
            console.error(`❌ Socket ${socket.id} tried to join an undefined room!`);
            return;
        }
        socket.join(clinicId.toString());
        console.log(`🏥 Socket ${socket.id} successfully joined Room: ${clinicId}`);

        // Let the client know they joined successfully
        socket.emit('joined', { room: clinicId });
    });

    socket.on('disconnect', () => {
        console.log('❌ Client Disconnected:', socket.id);
    });
});

// Middlewares
app.set('trust proxy', 1);
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

// 📢 Inject Socket.io into every request
// This allows you to use req.io.to(clinicId).emit() in your controllers
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/patient', patientAuthRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/clinic', clinicroutes);
app.use('/api/contact', contactRoutes);

// Health Check
app.get('/', (req, res) => {
    res.send('Swasthya-Mitra Backend is running...');
});

app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        environment: process.env.NODE_ENV || 'development',
        serverless: false,
        socketEnabled: true,
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 5000;

// 🔑 IMPORTANT: Listen using 'server', not 'app'
server.listen(PORT, () => {
    if (!isProduction) {
        console.log(`🚀 Server & WebSockets running on port ${PORT}`);
    }
});

module.exports = app;