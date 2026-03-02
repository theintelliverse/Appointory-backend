# 🏥 Appointory 

**A Real-time Clinical Management & Digital Health Locker System**

Appointory is a comprehensive MERN-stack platform designed to bridge the gap between clinics and patients. It features a real-time token system, automated lab referrals, and an encrypted digital health vault for patients.

---

## ✨ Key Features

### 👨‍⚕️ For Clinics (Admin, Doctor, Receptionist)
* **Live Queue Management**: Real-time patient tracking with Socket.io integration.
* **Dual Monitoring**: Separate zones for "Waiting Lounge" and "Lab Monitoring Area".
* **Instant Lab Referrals**: Doctors can refer patients to the lab; results sync back to the doctor's cabin instantly.
* **Business Intelligence**: Admins can export clinical visit data and staff performance to CSV.
* **Role-Based Access**: Secure dashboards for Admins, Doctors, Receptionists, and Lab Technicians.

### 🤒 For Patients
* **Live Lounge Tracker**: Patients can track their token status, estimated wait time, and doctor availability on their own phones.
* **Digital Health Vault**: Secure access via OTP to view consultation notes, X-rays, and diagnostic reports.
* **Unified Timeline**: A smart history that merges clinical visits with uploaded medical documents.

---

## 🚀 Tech Stack
* **Frontend**: React.js, Tailwind CSS (Morning Marigold Theme), Lucide Icons.
* **Backend**: Node.js, Express.js.
* **Database**: MongoDB (Mongoose ODM).
* **Real-time**: Socket.io.
* **Communication**: Twilio SMS API.
* **Storage**: Cloudinary (for medical images/PDFs).

---

## 🚂 Deploy Backend on Railway

The backend deployment is now configured for Railway.

### 1) Create Railway Service
1. Push this repo to GitHub.
2. In Railway, choose **New Project → Deploy from GitHub Repo**.
3. Select this repository.
4. Set **Root Directory** to `backend`.

### 2) Environment Variables
Add all required backend variables in Railway service settings (`backend/.env` values), especially:
- `PORT` (Railway provides one automatically)
- `MONGODB_URI`
- `JWT_SECRET`
- `CORS_ORIGINS`
- `FRONTEND_URL`
- Cloudinary, Firebase, Twilio, and mail credentials used by this app

### 3) Start Command
Railway uses `backend/railway.toml`, which runs:
- `npm start`

### 4) Health Check
Health endpoint used by Railway:
- `/api/health`

### Notes
- The previous Vercel deployment config (`backend/vercel.json`) has been removed.
- Socket.io works normally on Railway because the app runs as a persistent Node process.

---
