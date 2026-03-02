const projectId = process.env.FB_PROJECT_ID;
const clientEmail = process.env.FB_CLIENT_EMAIL;
const privateKey = process.env.FB_PRIVATE_KEY
    ? process.env.FB_PRIVATE_KEY.replace(/\\n/g, '\n')
    : null;

const hasFirebaseEnv = Boolean(projectId && clientEmail && privateKey);

let firebaseAdmin = null;

const loadFirebaseAdmin = () => {
    if (firebaseAdmin) {
        return firebaseAdmin;
    }

    try {
        firebaseAdmin = require('firebase-admin');
        return firebaseAdmin;
    } catch {
        throw new Error('Firebase Admin SDK is not installed. Add firebase-admin to backend dependencies.');
    }
};

const getFirebaseAuth = () => {
    if (!hasFirebaseEnv) {
        throw new Error('Firebase Admin is not configured. Set FB_PROJECT_ID, FB_CLIENT_EMAIL, and FB_PRIVATE_KEY.');
    }

    const admin = loadFirebaseAdmin();

    if (admin.apps.length === 0) {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey
            })
        });
    }

    return admin.auth();
};

module.exports = { getFirebaseAuth };
