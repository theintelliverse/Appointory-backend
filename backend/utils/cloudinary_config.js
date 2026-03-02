const { v2: cloudinary } = require('cloudinary');
const cloudinaryStoragePackage = require('multer-storage-cloudinary');
require('dotenv').config();

const CloudinaryStorage =
  cloudinaryStoragePackage.CloudinaryStorage || cloudinaryStoragePackage;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async () => ({
    folder: 'patient_documents',
    resource_type: 'auto',
    public_id: `lab-${Date.now()}`,
    allowed_formats: ['jpg', 'png', 'jpeg', 'pdf', 'webp']
  })
});

module.exports = { cloudinary, storage };
