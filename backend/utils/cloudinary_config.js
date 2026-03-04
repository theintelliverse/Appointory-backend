const cloudinary = require('cloudinary');   // ✅ NO .v2
const CloudinaryStorage = require('multer-storage-cloudinary');
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  folder: 'patient_documents',
  allowedFormats: ['jpg', 'png', 'jpeg', 'pdf'],
  filename: (req, file, cb) => {
    cb(null, `lab-${Date.now()}`);
  },
});

module.exports = { cloudinary, storage };
