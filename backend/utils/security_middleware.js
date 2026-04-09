const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const baseLimiterOptions = {
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS'
};

const limiterMessage = (message) => ({
    success: false,
    message
});

const globalApiLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 15 * 60 * 1000,
    max: 1200,
    message: limiterMessage('Too many requests from this IP. Please try again in a few minutes.')
});

const authLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: limiterMessage('Too many auth attempts. Please wait 15 minutes and try again.')
});

const otpSendLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: limiterMessage('Too many OTP requests. Please wait 10 minutes and try again.')
});

const otpVerifyLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 10 * 60 * 1000,
    max: 15,
    message: limiterMessage('Too many OTP verification attempts. Please wait and try again.')
});

const passwordResetLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: limiterMessage('Too many password reset attempts. Please wait before retrying.')
});

const publicReadLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 5 * 60 * 1000,
    max: 120,
    message: limiterMessage('Public endpoint request limit reached. Slow down and retry shortly.')
});

const publicWriteLimiter = rateLimit({
    ...baseLimiterOptions,
    windowMs: 5 * 60 * 1000,
    max: 40,
    message: limiterMessage('Too many public write requests. Please wait before trying again.')
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
