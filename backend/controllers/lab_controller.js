const Queue = require('../models/Queue');
const Patient = require('../models/Patient');
const mongoose = require('mongoose');

// 🆕 GET LAB DASHBOARD STATISTICS
exports.getLabDashboardStats = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const filterAll = req.query.filter === 'all';
        
        const query = { 
            clinicId: clinicId,
            currentStage: { $in: ['Lab-Pending', 'Lab-Processing', 'Lab-Completed', 'Lab-Rejected'] }
        };
        
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
            samplesCollected: queueData.filter(q => ['Lab-Processing', 'Lab-Completed'].includes(q.currentStage)).length,
            inProcess: queueData.filter(q => q.currentStage === 'Lab-Processing').length,
            completed: queueData.filter(q => q.currentStage === 'Lab-Completed').length,
            pending: queueData.filter(q => ['Lab-Pending', 'Waiting'].includes(q.currentStage)).length,
            rejected: queueData.filter(q => q.currentStage === 'Lab-Rejected').length
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
        // 1. Calculate Real Turnaround/Processing Time (in hours)
        const completedIds = labTasks.filter(t => t.currentStage === 'Lab-Completed').map(t => t._id.toString());
        let totalHours = 0;
        let countedMatches = 0;
        
        if (completedIds.length > 0) {
            // Find patient profiles that have matching report visitIds
            const patientsWithReports = await Patient.find({
                "documents.visitId": { $in: completedIds }
            });
            
            patientsWithReports.forEach(patient => {
                patient.documents.forEach(doc => {
                    if (doc.visitId && completedIds.includes(doc.visitId.toString())) {
                        const queueItem = labTasks.find(t => t._id.toString() === doc.visitId.toString());
                        if (queueItem && queueItem.createdAt && doc.uploadedAt) {
                            const start = new Date(queueItem.createdAt);
                            const end = new Date(doc.uploadedAt);
                            // Turnaround time in hours
                            const diffHrs = Math.max(0.5, (end - start) / (1000 * 60 * 60));
                            totalHours += diffHrs;
                            countedMatches++;
                        }
                    }
                });
            });
        }
        
        const avgProcessingTime = countedMatches > 0 ? (totalHours / countedMatches).toFixed(1) : "2.4";
        
        // 2. Success & Completion Rates
        let completedCount = labTasks.filter(q => q.currentStage === 'Lab-Completed').length;
        let totalLabTasks = labTasks.length;
        const successRate = totalLabTasks > 0 ? ((completedCount / totalLabTasks) * 100).toFixed(1) : "100.0";

        // 3. Unique Patients counted dynamically
        const uniquePatients = new Set(labTasks.map(task => task.patientPhone || task.patientName));
        const totalPatients = uniquePatients.size;
        const pendingReviews = labTasks.filter(q => q.currentStage === 'Lab-Pending').length;
        
        // 4. Monthly Aggregation
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const monthlyAggregation = await Queue.aggregate([
            {
                $match: {
                    clinicId: new mongoose.Types.ObjectId(clinicId),
                    currentStage: { $in: ['Lab-Pending', 'Lab-Completed', 'Lab-Processing'] },
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
        
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const m = d.getMonth() + 1;
            const y = d.getFullYear();
            
            const found = monthlyAggregation.find(x => x._id.month === m && x._id.year === y);
            monthlyStats.push({
                name: monthNames[m - 1],
                tests: found ? found.tests : 0,
                completed: found ? found.completed : 0
            });
        }
        
        res.status(200).json({
            success: true,
            data: {
                avgProcessingTime: `${avgProcessingTime} hrs`,
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

        // 🔍 DEBUG: Check Files (Handle both single file or multiple files array)
        let files = [];
        if (req.file) {
            files.push(req.file);
        } else if (req.files && req.files.length > 0) {
            files = req.files;
        }

        if (files.length === 0) {
            console.error("❌ [2] Error: No files uploaded.");
            return res.status(400).json({ success: false, message: "No file objects found." });
        }

        console.log(`✅ [2] Received ${files.length} file(s) for upload.`);

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

        // 🗄️ Update Patient Documents for all matched profiles for each uploaded file
        const newDocuments = files.map((file, idx) => {
            const cloudinarySecureUrl = file.secure_url || file.path || file.url;
            console.log(`🔗 File [${idx + 1}] Cloudinary URL:`, cloudinarySecureUrl);
            
            // Extract a realistic title if multiple reports are uploaded (e.g. CBC Report, Lipid Report, etc.)
            let fileTitle = req.body.title || "Diagnostic Report";
            if (files.length > 1) {
                const originalName = file.originalname ? file.originalname.split('.')[0] : `Report-${idx + 1}`;
                fileTitle = `${fileTitle} (${originalName})`;
            }

            return {
                visitId: queueId,
                title: fileTitle,
                fileUrl: cloudinarySecureUrl,
                publicId: file.public_id || file.filename || null,
                fileType: file.mimetype && file.mimetype.includes('pdf') ? 'PDF' : 'Image',
                uploadedAt: Date.now()
            };
        });

        for (const patient of patients) {
            patient.documents.push(...newDocuments);
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
            message: `${files.length} report(s) published successfully.`,
            fileUrls: newDocuments.map(d => d.fileUrl),
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