const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ✅ express-rate-limit v8: handler must be a function — do NOT use object as message
const makeHandler = (message) => (req, res) => {
    res.status(429).json({ success: false, message });
};

const baseLimiterOptions = {
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS'
};

const globalApiLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 15 * 60 * 1000,
    max: 1200,
    handler: makeHandler('Too many requests from this IP. Please try again in a few minutes.')
});

const authLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 15 * 60 * 1000,
    max: 20,
    handler: makeHandler('Too many auth attempts. Please wait 15 minutes and try again.')
});

const otpSendLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 10 * 60 * 1000,
    max: 5,
    handler: makeHandler('Too many OTP requests. Please wait 10 minutes and try again.')
});

const otpVerifyLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 10 * 60 * 1000,
    max: 15,
    handler: makeHandler('Too many OTP verification attempts. Please wait and try again.')
});

const passwordResetLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 15 * 60 * 1000,
    max: 10,
    handler: makeHandler('Too many password reset attempts. Please wait before retrying.')
});

const publicReadLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 5 * 60 * 1000,
    max: 120,
    handler: makeHandler('Public endpoint request limit reached. Slow down and retry shortly.')
});

const publicWriteLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 5 * 60 * 1000,
    max: 40,
    handler: makeHandler('Too many public write requests. Please wait before trying again.')
});

const securityHeaders = helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
});

module.exports = {
    securityHeaders,
    globalApiLimiter,
    authLimiter,
    otpSendLimiter,
    otpVerifyLimiter,
    passwordResetLimiter,
    publicReadLimiter,
    publicWriteLimiter
};
