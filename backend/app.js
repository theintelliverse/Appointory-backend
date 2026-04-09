// 🌐 Force IPv4 first to prevent ENETUNREACH errors in production
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const http = require('http'); // 🔑 Required for WebSockets
const { Server } = require('socket.io'); // 🔑 Required for WebSockets
require('dotenv').config();
const {
    securityHeaders,
    globalApiLimiter,
    authLimiter,
    otpSendLimiter,
    otpVerifyLimiter,
    passwordResetLimiter,
    publicReadLimiter,
    publicWriteLimiter
} = require('./utils/security_middleware');

// ✅ Import email service (initializes automatically on module load)
const { initializeEmailService } = require('./utils/send_email');

// Initialize email service in the background
initializeEmailService().catch(error => {
    console.warn('⚠️  Email service initialization failed:', error.message);
    // Continue running - email errors won't crash the server
});

const authRoutes = require('./routes/auth_routes');
const staffRoutes = require('./routes/staff_routes');
const queueRoutes = require('./routes/queue_routes');
const clinicroutes = require('./routes/clinic_routes');
const callRoutes = require('./routes/call_routes');

const app = express();
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const isProduction = process.env.NODE_ENV === 'production';
let server = null;
let io = null;

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
    ...parseAllowedOrigins(process.env.FRONTEND_URL)
]);

if (!isProduction) {
    allowedOrigins.add(normalizeOrigin('http://localhost:5173'));
}

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
if (!isVercel) {
    server = http.createServer(app); // 🔑 Create HTTP server
    io = new Server(server, {
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
}

// Middlewares
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use('/api', globalApiLimiter);

// Auth/staff login hard limits
app.use('/api/auth/register-clinic', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/patient/login-with-password', authLimiter);
app.use('/api/auth/patient/register', authLimiter);
app.use('/api/auth/patient/register-with-otp-password', authLimiter);

// OTP abuse protection
app.use('/api/auth/patient/send-otp', otpSendLimiter);
app.use('/api/auth/patient/verify-otp', otpVerifyLimiter);
app.use('/api/auth/patient/verify-locker', otpVerifyLimiter);
app.use('/api/auth/patient/change-password-with-otp', otpVerifyLimiter);

// Password reset abuse protection
app.use('/api/auth/forgot-password', passwordResetLimiter);
app.use('/api/auth/reset-password', passwordResetLimiter);
app.use('/api/auth/patient/forgot-password', passwordResetLimiter);
app.use('/api/auth/patient/reset-password', passwordResetLimiter);

// Public endpoint rate limits
app.use('/api/queue/public/status', publicReadLimiter);
app.use('/api/auth/queue/public/status', publicReadLimiter);
app.use('/api/queue/public/doctor-display', publicReadLimiter);
app.use('/api/staff/public/doctors', publicReadLimiter);
app.use('/api/queue/public/checkin', publicWriteLimiter);
app.use('/api/queue/public/cancel', publicWriteLimiter);
app.use('/api/auth/patient/request-checkin', publicWriteLimiter);

// 📢 Inject Socket.io into every request
// This allows you to use req.io.to(clinicId).emit() in your controllers
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/clinic', clinicroutes);
app.use('/api/call', callRoutes);

// Health Check
app.get('/', (req, res) => {
    res.send('Appointory Backend is running...');
});

app.get('/api/health', (req, res) => {
    res.status(200).json({
        success: true,
        environment: process.env.NODE_ENV || 'development',
        serverless: isVercel,
        socketEnabled: !isVercel,
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 5000;

if (!isVercel && require.main === module) {
    // 🔑 IMPORTANT: Listen using 'server', not 'app'
    server.listen(PORT, () => {
        if (!isProduction) {
            console.log(`🚀 Server & WebSockets running on port ${PORT}`);
        }
    });
}

module.exports = app;