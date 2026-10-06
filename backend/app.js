// 🌐 Force IPv4 first to prevent ENETUNREACH errors in production
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const cors = require('cors');
const http = require('http'); // 🔑 Required for WebSockets
const { Server } = require('socket.io'); // 🔑 Required for WebSockets
require('dotenv').config();

// 🔑 Connect to MongoDB early so models never buffer-timeout
const mongoose = require('./config/mongoose_connection');
const { initializePredictor } = require('./AI_model/appointment_predictor');
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
const labRoutes = require('./routes/lab_routes');
const labConnectionRoutes = require('./routes/lab_connection_routes');
const superadminRoutes = require('./routes/superadmin_routes');
const billingRoutes = require('./routes/billing_routes');
const contactRoutes = require('./routes/contact_routes');
const ratingRoutes = require('./routes/rating_routes');

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
    ...parseAllowedOrigins(process.env.FRONTEND_URL),
    normalizeOrigin('https://appointory.in'),
    normalizeOrigin('https://www.appointory.in')
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

    // In local development, always permit any localhost or 127.0.0.1 port
    if (!isProduction) {
        if (
            normalizedOrigin.startsWith('http://localhost:') ||
            normalizedOrigin.startsWith('http://127.0.0.1:') ||
            normalizedOrigin.startsWith('https://localhost:')
        ) {
            return true;
        }
    }

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
    credentials: true,
    optionsSuccessStatus: 200
};

// 🔒 PRODUCTION SECRET INTEGRITY CHECK
if (process.env.NODE_ENV === 'production') {
    const weakSecrets = ['secret', 'jwtsecret', '123456', 'your_jwt_secret', 'changeme', 'appointory_secret', 'swasthyamitra_secret', 'test'];
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32 || weakSecrets.includes(secret.toLowerCase())) {
        console.error('❌ FATAL SECURITY ERROR: JWT_SECRET is missing, shorter than 32 characters, or set to an insecure default in production.');
        process.exit(1);
    }
}

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

    // 🔐 Socket Authentication Middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (token) {
            try {
                const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
                const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
                socket.user = decoded;
            } catch (err) {
                // Invalid token provided: mark unauthorized
                socket.authError = 'Invalid or expired token';
            }
        }
        next();
    });

    io.on('connection', (socket) => {
        console.log('⚡ Client Connected:', socket.id, socket.user ? `(User: ${socket.user.id}, Role: ${socket.user.role})` : '(Anonymous)');

        // 🏥 Join Clinic Room (Tenant-isolated for staff, public-isolated for TV display)
        socket.on('joinClinic', (clinicId) => {
            if (!clinicId) {
                console.error(`❌ Socket ${socket.id} tried to join an undefined room!`);
                return;
            }

            const targetClinicId = clinicId.toString();

            // If unauthenticated, allow ONLY public TV display room (no private invoice/patient events)
            if (!socket.user) {
                const publicRoom = `tv_${targetClinicId}`;
                socket.join(publicRoom);
                console.log(`📺 Anonymous socket ${socket.id} joined public TV room: ${publicRoom}`);
                socket.emit('joined', { room: publicRoom, isPublic: true });
                return;
            }

            // If authenticated as staff, enforce tenant authorization
            const userClinicId = socket.user.clinicId ? socket.user.clinicId.toString() : null;
            const isSuperAdmin = socket.user.role === 'superadmin';

            if (isSuperAdmin || userClinicId === targetClinicId) {
                socket.join(targetClinicId);
                console.log(`🏥 Authenticated staff socket ${socket.id} joined Clinic Room: ${targetClinicId}`);
                socket.emit('joined', { room: targetClinicId, isPublic: false });
            } else {
                console.warn(`🚨 Blocked cross-tenant socket join! User ${socket.user.id} tried joining clinic ${targetClinicId}`);
                socket.emit('error', { message: 'Unauthorized: Cross-clinic room access forbidden.' });
            }
        });

        // 🔬 Join Lab Room (Authorized for lab staff and connected clinics only)
        socket.on('joinLab', (labId) => {
            if (!labId) {
                console.error(`❌ Socket ${socket.id} tried to join an undefined lab room!`);
                return;
            }

            if (!socket.user) {
                socket.emit('error', { message: 'Authentication required to join lab room.' });
                return;
            }

            const targetLabRoom = `lab_${labId}`;
            const userLabId = socket.user.labId ? socket.user.labId.toString() : null;
            const isSuperAdmin = socket.user.role === 'superadmin';
            const isAuthorizedLab = socket.user.role === 'independent_lab' && userLabId === labId.toString();
            const isInHouseLab = socket.user.role === 'lab' || socket.user.role === 'doctor' || socket.user.role === 'admin';

            if (isSuperAdmin || isAuthorizedLab || isInHouseLab) {
                socket.join(targetLabRoom);
                console.log(`🔬 Socket ${socket.id} joined Lab Room: ${targetLabRoom}`);
                socket.emit('joined', { room: targetLabRoom });
            } else {
                console.warn(`🚨 Blocked unauthorized lab room join! User: ${socket.user.id}`);
                socket.emit('error', { message: 'Unauthorized: Access to this lab room is forbidden.' });
            }
        });

        socket.on('disconnect', () => {
            console.log('❌ Client Disconnected:', socket.id);
        });
    });
}

// Middlewares
app.use((req, res, next) => {
    console.log(`📡 [${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const sanitizeMongo = require('./middlewares/mongo_sanitize');

app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(sanitizeMongo);
app.use('/api', globalApiLimiter);

// 🔒 Block search crawlers from indexing private API endpoints
app.use(['/api/queue/status', '/api/patient', '/api/admin', '/api/receptionist', '/api/superadmin', '/api/slots'], (req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    next();
});

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
app.use('/api/public/verify/invoice', publicReadLimiter);

// 📢 Inject Socket.io into every request
// This allows you to use req.io.to(clinicId).emit() in your controllers
app.use((req, res, next) => {
    req.io = io;
    next();
});

const publicSeoRoutes = require('./routes/public_seo_routes');
const publicSeoController = require('./controllers/public_seo_controller');
const { checkMaintenanceMode, checkSubscription } = require('./utils/auth_middleware');

// Routes
app.use(checkMaintenanceMode);

// 🌐 Public SSR Clinic & Directory Routes, Dynamic Sitemap, and Robots.txt
const seoRoutes = require('./routes/seoRoutes');
app.use('/', seoRoutes);

// 🌐 Public AI Search & LLM Context Endpoints
app.get('/llms.txt', publicSeoController.generateLlmTxt);
app.get('/llms-full.txt', publicSeoController.generateLlmTxt);
app.get('/ai.txt', publicSeoController.generateLlmTxt);
app.use('/api/public/seo', publicSeoRoutes);
app.post('/api/public/clinic-inquiry', publicWriteLimiter, publicSeoController.submitClinicInquiry);

// 🛡️ Public Anti-Fraud Invoice Verification Endpoint
const billingController = require('./controllers/billing_controller');
app.get('/api/public/verify/invoice/:id', publicReadLimiter, billingController.verifyPublicInvoice);

const slotHoldRoutes = require('./routes/slot_hold_routes');
app.use('/api/slots', slotHoldRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/staff', checkSubscription, staffRoutes);
app.use('/api/queue', checkSubscription, queueRoutes);
app.use('/api/clinic', checkSubscription, clinicroutes);
app.use('/api/call', checkSubscription, callRoutes);
app.use('/api/lab', checkSubscription, labRoutes);
app.use('/api/lab-connect', checkSubscription, labConnectionRoutes);
app.use('/api/billing', checkSubscription, billingRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/ratings', ratingRoutes);

// Health Check
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/', (req, res) => {
    res.send('Appointory Backend is running...');
});

// Error Handler
app.use((err, req, res, next) => {
    console.error('❌ GLOBAL ERROR:', err.message);
    if (process.env.NODE_ENV !== 'production' && err.stack) {
        console.error(err.stack);
    }
    const isProd = process.env.NODE_ENV === 'production';
    const statusCode = err.status || err.statusCode || 500;
    const clientMessage = (isProd && statusCode >= 500)
        ? 'Internal Server Error'
        : (err.message || 'An unexpected error occurred');

    res.status(statusCode).json({
        success: false,
        message: clientMessage
    });
});

const PORT = process.env.PORT || 5000;

if (!isVercel && require.main === module) {
    // 🔑 Wait for MongoDB to be ready before accepting connections
    const startServer = async () => {
        try {
            // Ensure the mongoose connection promise resolves before listening
            if (mongoose.connection.readyState !== 1) {
                await new Promise((resolve, reject) => {
                    mongoose.connection.once('open', resolve);
                    mongoose.connection.once('error', reject);
                    // Fallback: start anyway after 12s even if still connecting
                    setTimeout(resolve, 12000);
                });
            }
        } catch (err) {
            console.error('⚠️  MongoDB did not connect before server start:', err.message);
        }

        // Initialize AI Prediction Model
        try {
            console.log('🤖 Initializing AI Appointment Predictor...');
            await initializePredictor();
            console.log('✅ AI Predictor Ready.');
        } catch (err) {
            console.error('⚠️ AI Predictor initialization failed:', err.message);
        }

        // 🔑 IMPORTANT: Listen using 'server', not 'app'
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server & WebSockets running on port ${PORT} (Production: ${isProduction})`);
        });
    };

    startServer();
}

// 🛡️ Catch unhandled errors to prevent sudden server crashes in production
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
});

module.exports = app;