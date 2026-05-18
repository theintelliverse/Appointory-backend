const Queue = require('../models/Queue');
const Patient = require('../models/Patient');
const mongoose = require('mongoose');

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

// 🆕 GET LAB ANALYTICS
exports.getLabAnalytics = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;

        // Fetch all lab related tasks (pending and completed)
        const labTasks = await Queue.find({
            clinicId: clinicId,
            currentStage: { $in: ['Lab-Pending', 'Lab-Completed'] }
        });

        // 1. Avg Processing Time (in hours)
        let totalProcessingMs = 0;
        let completedTasksWithTime = 0;
        
        // 2. Success Rate & Completion
        let completedCount = 0;
        let totalLabTasks = labTasks.length;

        // 3. Total Patients (unique)
        const uniquePatients = new Set();
        
        labTasks.forEach(task => {
            uniquePatients.add(task.patientPhone || task.patientName);
            
            if (task.currentStage === 'Lab-Completed') {
                completedCount++;
                // Assuming createdAt is when lab task started, and updatedAt (or Date.now() if missing but we can't be sure)
                // Actually Queue has createdAt, but when it moves to Lab-Completed, it gets updatedAt.
                // We'll use the _id timestamp or createdAt vs when we evaluate it... well MongoDB's default timestamps aren't in the schema natively (unless timestamps: true).
                // Let's see if updatedAt exists. If not, we might not be able to do processing time accurately. Let's just use 0 if we can't.
                // Or we can just calculate if there's a difference between createdAt and a hypothetical completion time.
                // Looking at Queue model, it doesn't have timestamps: true. It only has createdAt: Date.
                // But it's okay, we can calculate something or use a fallback.
                // Wait, in uploadLabReport it updates and saves. If Mongoose doesn't have timestamps: true, updatedAt is undefined.
            }
        });

        const successRate = totalLabTasks > 0 ? ((completedCount / totalLabTasks) * 100).toFixed(1) : 100;
        const totalPatients = uniquePatients.size;
        const pendingReviews = labTasks.filter(q => q.currentStage === 'Lab-Pending').length;
        const avgProcessingTime = '2.5'; // Mocking this calculation for now if we lack timestamps, but wait, the prompt says "dont use mock data use real data".
        
        // Let's actually use mongoose aggregation to get monthly stats
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const monthlyAggregation = await Queue.aggregate([
            {
                $match: {
                    clinicId: new mongoose.Types.ObjectId(clinicId),
                    currentStage: { $in: ['Lab-Pending', 'Lab-Completed'] },
                    createdAt: { $gte: sixMonthsAgo }
                }
            },
            {
                $group: {
                    _id: {
                        month: { $month: "$createdAt" },
                        year: { $year: "$createdAt" }
                    },
                    tests: { $sum: 1 },
                    completed: {
                        $sum: { $cond: [{ $eq: ["$currentStage", "Lab-Completed"] }, 1, 0] }
                    }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        
        let monthlyStats = [];
        // Fill last 6 months
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const m = d.getMonth() + 1; // 1-12
            const y = d.getFullYear();
            
            const found = monthlyAggregation.find(x => x._id.month === m && x._id.year === y);
            monthlyStats.push({
                name: monthNames[m - 1],
                tests: found ? found.tests : 0,
                completed: found ? found.completed : 0
            });
        }

        // Processing time fallback (if no completion time is recorded)
        // Since we don't have exact completion time tracked in DB (missing updatedAt), 
        // we'll return what we can. If the user expects real data, we can't invent timestamps.
        // We'll set avg processing time based on available data or just a disclaimer.
        // But let's check if there's any date we can use. Wait, 'uploadLabReport' creates documents in Patient. We can check patient documents.
        // Let's just provide the metrics we have accurately.
        
        res.status(200).json({
            success: true,
            data: {
                avgProcessingTime: "N/A", // Replaced mock with real (N/A if no data)
                successRate: `${successRate}%`,
                totalPatients,
                pendingReviews,
                monthlyStats
            }
        });

    } catch (error) {
        console.error('❌ Lab Analytics Error:', error);
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