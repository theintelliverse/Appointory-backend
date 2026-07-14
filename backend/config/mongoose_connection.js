require('dotenv').config();
const mongoose = require('mongoose');

const mongoUri = process.env.MONGO_URL || process.env.MONGODB_URI;

// Disable buffering so queries fail immediately if MongoDB is not connected
mongoose.set('bufferCommands', false);

// Use a global cache so Vercel serverless functions reuse connections
const globalMongoose = global;
if (!globalMongoose.__mongooseCache) {
    globalMongoose.__mongooseCache = { promise: null };
}

const connectMongo = async () => {
    if (!mongoUri) {
        console.error('❌ Missing MongoDB URI. Set MONGO_URL or MONGODB_URI in .env');
        return false;
    }

    // Already connected or connecting — skip
    if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
        return true;
    }

    if (!globalMongoose.__mongooseCache.promise) {
        globalMongoose.__mongooseCache.promise = mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 15000, // How long driver waits to pick a server
            connectTimeoutMS: 15000,         // How long TCP connection is allowed to take
            socketTimeoutMS: 45000,          // How long a send/receive on a socket can take
            maxPoolSize: 10,
            minPoolSize: 2,
            retryWrites: true,
        });
    }

    await globalMongoose.__mongooseCache.promise;
    return true;
};

// Initiate connection immediately when this module is first loaded
connectMongo()
    .then((connected) => {
        if (connected && process.env.NODE_ENV !== 'production') {
            console.log('✅ MongoDB connected');
        }
    })
    .catch((err) => {
        // Reset promise so next call retries
        globalMongoose.__mongooseCache.promise = null;

        const isAtlasAllowlistError = /whitelist|IP that isn't whitelisted|not authorized/i.test(err.message || '');
        if (isAtlasAllowlistError) {
            console.error('❌ MongoDB: Atlas IP not allowlisted. Add 0.0.0.0/0 in Atlas → Network Access.');
        } else {
            console.error('❌ MongoDB connection error:', err.message);
        }
    });

module.exports = mongoose;