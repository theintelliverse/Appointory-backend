const crypto = require('crypto');

// Generate encryption key from JWT_SECRET
const getEncryptionKey = () => {
    const secret = process.env.JWT_SECRET || 'fallback_secret_key_appointory_32';
    // Must be exactly 32 bytes for aes-256-cbc
    return crypto.createHash('sha256').update(String(secret)).digest();
};

const encrypt = (text) => {
    if (!text) return '';
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `${iv.toString('hex')}:${encrypted}`;
    } catch (err) {
        console.error('Encryption failed:', err);
        return text;
    }
};

const decrypt = (encryptedText) => {
    if (!encryptedText) return '';
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 2) return encryptedText; // If not encrypted or in correct format, return as is
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        // Fallback to returning the input if decryption fails (e.g. it was saved as plain text before)
        return encryptedText;
    }
};

module.exports = { encrypt, decrypt };
