const Queue = require('../models/Queue');
const Patient = require('../models/Patient');

// 🆕 GET LAB DASHBOARD STATISTICS
exports.getLabDashboardStats = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const filterAll = req.query.filter === 'all';
        
        const query = { clinicId: clinicId };
        
        if (!filterAll) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            query.createdAt = { $gte: today, $lt: tomorrow };
        }

        console.log(`🔬 Lab stats query for clinicId: ${clinicId}, filterAll: ${filterAll}`);

        const queueData = await Queue.find(query)
            .select('patientName patientPhone currentStage requiredTest isEmergency createdAt tokenNumber _id')
            .sort({ createdAt: -1 });

        // Calculate statistics
        const stats = {
            totalRequests: queueData.length,
            samplesCollected: queueData.filter(q => ['Lab-Pending', 'Lab-Completed'].includes(q.currentStage)).length,
            inProcess: queueData.filter(q => q.currentStage === 'Lab-Pending').length,
            completed: queueData.filter(q => q.currentStage === 'Lab-Completed').length,
            pending: queueData.filter(q => q.currentStage === 'Waiting').length
        };

        res.status(200).json({
            success: true,
            data: {
                stats,
                queueData: queueData
            }
        });
    } catch (error) {
        console.error('❌ Lab stats error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🆕 GET RECENT LAB REPORTS
exports.getRecentReports = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const filterAll = req.query.filter === 'all';
        const limit = req.query.limit || 10;

        const query = { 
            clinicId: clinicId,
            currentStage: 'Lab-Completed'
        };

        if (!filterAll) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            query.updatedAt = { $gte: today, $lt: tomorrow };
        }

        // Get recently completed lab tasks
        const recentReports = await Queue.find(query)
            .sort({ updatedAt: -1 })
            .limit(parseInt(limit))
            .select('patientName requiredTest createdAt updatedAt currentStage _id');

        res.status(200).json({
            success: true,
            data: recentReports
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 🆕 GET LAB QUEUE BY STATUS
exports.getLabQueueByStatus = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const status = req.params.status || 'Lab-Pending';

        const queueData = await Queue.find({
            clinicId: clinicId,
            currentStage: status
        })
            .sort({ isEmergency: -1, createdAt: 1 })
            .populate('doctorId', 'name specialization');

        res.status(200).json({
            success: true,
            data: queueData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.uploadLabReport = async (req, res) => {
    console.log("🚀 [1] Controller Started: Upload request received.");
    try {
        const { patientPhone, queueId } = req.params;

        // 🔍 DEBUG: Check File
        if (!req.file) {
            console.error("❌ [2] Error: req.file is missing.");
            return res.status(400).json({ success: false, message: "No file object found." });
        }
        const cloudinarySecureUrl = req.file.secure_url || req.file.path || req.file.url;
        console.log("✅ [2] File Uploaded to Cloudinary:", cloudinarySecureUrl);

        // 🔍 DEBUG: Check Queue Entry
        const queueEntry = await Queue.findById(queueId);
        if (!queueEntry) {
            console.error("❌ [3] Error: Queue session not found.");
            return res.status(404).json({ success: false, message: "Queue session not found." });
        }
        console.log("✅ [3] Queue Entry Found:", queueEntry.patientName);

        // 🔍 DEBUG: Check Patient(s)
        const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);
        let patients = await Patient.find({ phone: new RegExp(cleanPhone + '$') });

        // Fallback for inconsistent phone formats in DB
        if (!patients || patients.length === 0) {
            const allProfiles = await Patient.find({ phone: { $exists: true, $ne: null } })
                .select('name phone documents');
            patients = allProfiles.filter((profile) => {
                const normalized = String(profile.phone || '').replace(/\D/g, '').slice(-10);
                return normalized === cleanPhone;
            });
        }

        if (!patients || patients.length === 0) {
            console.log("👤 [4] Patient not found, creating new profile...");
            patients = [new Patient({
                name: queueEntry.patientName,
                phone: cleanPhone,
                documents: []
            })];
        }

        // 🗄️ Update Patient Documents for all matched profiles
        const newDocument = {
            visitId: queueId,
            title: req.body.title || "Lab Report",
            fileUrl: cloudinarySecureUrl,
            publicId: req.file.public_id || req.file.filename || null,
            fileType: req.body.fileType || "Diagnostic",
            uploadedAt: Date.now()
        };

        for (const patient of patients) {
            patient.documents.push(newDocument);
        }

        console.log(`💾 [5] Attempting to save ${patients.length} patient profile(s)...`);
        await Promise.all(patients.map((patient) => patient.save()));
        console.log("✅ [5] Patient profile(s) saved successfully.");

        // 🏷️ Update Queue Stage
        queueEntry.currentStage = 'Lab-Completed';
        await queueEntry.save();
        console.log("✅ [6] Queue stage updated to Lab-Completed.");

        // 📢 SOCKET EMIT
        if (req.io) {
            const clinicRoom = queueEntry.clinicId.toString();
            console.log("📢 [7] Emitting socket update to room:", clinicRoom);
            req.io.to(clinicRoom).emit('queueUpdate');
        }

        // 🏁 SEND RESPONSE (This stops the spinning loader)
        console.log("🏁 [8] Sending success response to frontend.");
        return res.status(200).json({
            success: true,
            message: "Report published successfully.",
            fileUrl: cloudinarySecureUrl,
            matchedProfiles: patients.length
        });

    } catch (error) {
        console.error("💥 [FATAL ERROR]:", error);
        // Ensure we send a response even on crash
        return res.status(500).json({
            success: false,
            message: "Internal server error during upload.",
            error: error.message
        });
    }
};