const Queue = require('../models/Queue');
const Patient = require('../models/Patient');

const normalizeToHttps = (url) => {
    if (!url || typeof url !== 'string') {
        return null;
    }

    if (url.startsWith('https://')) {
        return url;
    }

    if (url.startsWith('http://')) {
        return `https://${url.slice('http://'.length)}`;
    }

    return url;
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
        console.log("✅ [2] File Uploaded to Cloudinary:", req.file.path);

        // 🔍 DEBUG: Check Queue Entry
        const queueEntry = await Queue.findById(queueId);
        if (!queueEntry) {
            console.error("❌ [3] Error: Queue session not found.");
            return res.status(404).json({ success: false, message: "Queue session not found." });
        }
        console.log("✅ [3] Queue Entry Found:", queueEntry.patientName);

        // 🔍 DEBUG: Check Patient
        const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);
        let patient = await Patient.findOne({ phone: new RegExp(cleanPhone + '$') });

        if (!patient) {
            console.log("👤 [4] Patient not found, creating new profile...");
            patient = new Patient({
                name: queueEntry.patientName,
                phone: cleanPhone,
                documents: []
            });
        }

        const secureUploadedUrl = normalizeToHttps(
            req.file?.secure_url || req.file?.path || req.file?.url || null
        );
        const uploadedUrl = normalizeToHttps(
            req.file?.path || req.file?.secure_url || req.file?.url || null
        );

        if (!secureUploadedUrl || !uploadedUrl) {
            console.error("❌ [4] Upload object missing accessible URL:", req.file);
            return res.status(500).json({
                success: false,
                message: "Upload succeeded but file URL could not be resolved."
            });
        }

        // 🗄️ Update Patient Documents
        patient.documents.push({
            visitId: queueId,
            title: req.body.title || "Lab Report",
            fileUrl: uploadedUrl,
            secureUrl: secureUploadedUrl,
            fileType: req.body.fileType || "Diagnostic",
            uploadedAt: Date.now()
        });

        console.log("💾 [5] Attempting to save patient profile...");
        await patient.save();
        console.log("✅ [5] Patient saved successfully.");

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
            fileUrl: uploadedUrl,
            secureUrl: secureUploadedUrl
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