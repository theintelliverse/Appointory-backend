require('dotenv').config();
const mongoose = require('mongoose');

const resolveMongoUri = () => {
    const candidates = [
        process.env.MONGO_URL,
        process.env.MONGODB_URI,
        process.env.MONGO_URI,
        process.env.DATABASE_URL
    ];

    const value = candidates.find((uri) => typeof uri === 'string' && uri.trim().length > 0);
    return value ? value.trim() : '';
};

const globalMongoose = global;

if (!globalMongoose.__mongooseCache) {
    globalMongoose.__mongooseCache = {
        promise: null
    };
}

const connectMongo = async () => {
    const mongoUri = resolveMongoUri();

    if (!mongoUri) {
        console.error('Missing MongoDB URI. Set one of: MONGO_URL, MONGODB_URI, MONGO_URI, or DATABASE_URL.');
        return false;
    }

    if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
        return true;
    }

    if (!globalMongoose.__mongooseCache.promise) {
        globalMongoose.__mongooseCache.promise = mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 10000,
            maxPoolSize: 10
        });
    }

    await globalMongoose.__mongooseCache.promise;
    return true;
};

connectMongo()
    .then((connected) => {
        if (connected && process.env.NODE_ENV !== 'production') {
            console.log('mongodb connected');
        }
    })
    .catch((err) => {
        const isAtlasAllowlistError = /whitelist|IP that isn't whitelisted|not authorized/i.test(err.message || '');
        if (isAtlasAllowlistError) {
            console.error('MongoDB connection error: Atlas IP is not allowlisted. Add 0.0.0.0/0 or your deployment provider egress IP in Atlas Network Access.');
            return;
        }

        console.error('MongoDB connection error:', err.message);
    });


module.exports = mongoose