const cloudinary = require('cloudinary').v2;
const CloudinaryStoragePkg = require('multer-storage-cloudinary');
const CloudinaryStorage = CloudinaryStoragePkg.CloudinaryStorage || CloudinaryStoragePkg;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'patient_documents',
    allowed_formats: ['jpg', 'png', 'jpeg', 'pdf', 'webp'],
    resource_type: 'auto',
    filename: (req, file, cb) => {
      cb(null, `lab-${Date.now()}`);
    }
  }
});

module.exports = { cloudinary, storage };
