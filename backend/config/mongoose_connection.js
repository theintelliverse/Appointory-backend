require('dotenv').config();
const mongoose = require('mongoose');

const mongoUri = process.env.MONGO_URL || process.env.MONGODB_URI;
const globalMongoose = global;

if (!globalMongoose.__mongooseCache) {
    globalMongoose.__mongooseCache = {
        promise: null
    };
}

const connectMongo = async () => {
    if (!mongoUri) {
        console.error('Missing MongoDB URI. Set MONGO_URL or MONGODB_URI in backend environment variables.');
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
            console.error('MongoDB connection error: Atlas IP is not allowlisted. Add 0.0.0.0/0 or your Vercel egress IP in Atlas Network Access.');
            return;
        }

        console.error('MongoDB connection error:', err.message);
    });


module.exports = mongoose