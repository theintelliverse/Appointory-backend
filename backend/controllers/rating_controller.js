const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Review = require('../models/Review');
const User = require('../models/User');
const Clinic = require('../models/Clinic');
const IndependentLab = require('../models/IndependentLab');

/**
 * Helper to safely extract patient auth payload from Bearer token
 */
const extractPatientAuth = (req) => {
    let token = req.headers.authorization;
    if (token && token.startsWith('Bearer')) {
        try {
            token = token.split(' ')[1];
            return jwt.verify(token, process.env.JWT_SECRET);
        } catch {
            return null;
        }
    }
    return null;
};

/**
 * Helper to recalculate aggregate rating and update entity in DB
 */
const recalculateTargetRating = async (targetType, targetId) => {
    const stats = await Review.aggregate([
        { $match: { targetType, targetId: new mongoose.Types.ObjectId(targetId) } },
        {
            $group: {
                _id: null,
                avgScore: { $avg: '$score' },
                totalReviews: { $sum: 1 }
            }
        }
    ]);

    const totalCount = stats[0]?.totalReviews || 0;
    const avgScore = totalCount > 0 ? Math.round(stats[0].avgScore * 10) / 10 : 0;

    let targetEntity = null;
    if (targetType === 'doctor') {
        targetEntity = await User.findByIdAndUpdate(targetId, { rating: { score: avgScore, count: totalCount } }, { new: true });
    } else if (targetType === 'clinic') {
        targetEntity = await Clinic.findByIdAndUpdate(targetId, { rating: { score: avgScore, count: totalCount } }, { new: true });
    } else if (targetType === 'lab') {
        targetEntity = await IndependentLab.findByIdAndUpdate(targetId, { rating: { score: avgScore, count: totalCount } }, { new: true });
    }

    return { score: avgScore, count: totalCount };
};

/**
 * @desc    Submit a verified rating and review for doctor, clinic, or diagnostic lab
 *          (If review already exists from this patient, updates it instead of duplicating)
 * @route   POST /api/ratings
 * @access  Public / Patient
 */
const submitRating = async (req, res) => {
    try {
        const { targetType, targetId, score, review, patientName, patientPhone } = req.body;

        // 1. Validation
        if (!targetType || !targetId || score === undefined) {
            return res.status(400).json({
                success: false,
                message: 'targetType, targetId, and score are required.'
            });
        }

        const validTypes = ['doctor', 'clinic', 'lab'];
        if (!validTypes.includes(targetType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid targetType. Must be doctor, clinic, or lab.'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(targetId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid targetId format.'
            });
        }

        const numericScore = Number(score);
        if (isNaN(numericScore) || numericScore < 1 || numericScore > 5) {
            return res.status(400).json({
                success: false,
                message: 'Score must be a number between 1 and 5.'
            });
        }

        // 2. Resolve target entity
        let targetEntity = null;
        let targetModelName = '';

        if (targetType === 'doctor') {
            targetEntity = await User.findOne({ _id: targetId, role: 'doctor' });
            targetModelName = 'User';
        } else if (targetType === 'clinic') {
            targetEntity = await Clinic.findById(targetId);
            targetModelName = 'Clinic';
        } else if (targetType === 'lab') {
            targetEntity = await IndependentLab.findById(targetId);
            targetModelName = 'IndependentLab';
        }

        if (!targetEntity) {
            return res.status(404).json({
                success: false,
                message: `${targetType.charAt(0).toUpperCase() + targetType.slice(1)} not found.`
            });
        }

        // 3. Resolve Patient Credentials
        const authUser = req.user || extractPatientAuth(req);
        const patientId = authUser?.id || authUser?._id || null;
        const cleanPhone = (patientPhone || authUser?.phone || '').toString().replace(/\D/g, '').slice(-10);

        const sanitizedReviewText = review ? review.toString().trim().replace(/[<>]/g, '') : '';
        const sanitizedPatientName = patientName ? patientName.toString().trim().replace(/[<>]/g, '') : 'Verified Patient';

        // 4. Duplicate Check: Check if patient already reviewed this target
        let existingReview = null;
        if (patientId && mongoose.Types.ObjectId.isValid(patientId)) {
            existingReview = await Review.findOne({ targetType, targetId, patientId });
        }
        if (!existingReview && cleanPhone) {
            existingReview = await Review.findOne({ targetType, targetId, patientPhone: cleanPhone });
        }

        let savedReview = null;
        let isEdit = false;

        if (existingReview) {
            // Update existing review
            isEdit = true;
            existingReview.score = Math.round(numericScore);
            existingReview.review = sanitizedReviewText;
            existingReview.patientName = sanitizedPatientName;
            if (patientId && !existingReview.patientId) existingReview.patientId = patientId;
            if (cleanPhone && !existingReview.patientPhone) existingReview.patientPhone = cleanPhone;
            savedReview = await existingReview.save();
        } else {
            // Create new review
            savedReview = await Review.create({
                targetType,
                targetId,
                targetModel: targetModelName,
                patientName: sanitizedPatientName,
                patientPhone: cleanPhone,
                patientId: patientId || null,
                score: Math.round(numericScore),
                review: sanitizedReviewText,
                isVerifiedPatient: true
            });
        }

        // 5. Recalculate updated aggregate score
        const updatedRating = await recalculateTargetRating(targetType, targetId);

        console.log(`⭐ ${isEdit ? 'Updated' : 'New'} rating for ${targetType} ${targetId}: score ${updatedRating.score} (${updatedRating.count} reviews)`);

        return res.status(isEdit ? 200 : 201).json({
            success: true,
            isEdit,
            message: isEdit ? 'Your rating has been updated successfully.' : 'Thank you! Your verified rating has been published.',
            rating: updatedRating,
            review: savedReview
        });
    } catch (error) {
        console.error('❌ Error submitting rating:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to record rating. Please try again later.'
        });
    }
};

/**
 * @desc    Get verified reviews and rating stats for a doctor, clinic, or lab
 *          ⚠️ IDENTITY PROTECTION: Patient identity is masked as "Verified Patient" for public display.
 * @route   GET /api/ratings/:targetType/:targetId
 * @access  Public
 */
const getRatings = async (req, res) => {
    try {
        const { targetType, targetId } = req.params;

        if (!['doctor', 'clinic', 'lab'].includes(targetType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid targetType. Must be doctor, clinic, or lab.'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(targetId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid targetId format.'
            });
        }

        // Fetch recent reviews
        const reviews = await Review.find({ targetType, targetId })
            .select('score review isVerifiedPatient createdAt')
            .sort({ createdAt: -1 })
            .limit(30);

        // 🔒 MEDICAL PRIVACY PROTECTION: Mask patient identity for public reviews
        const sanitizedReviews = reviews.map(r => ({
            _id: r._id,
            patientName: 'Verified Patient', // Never expose real patient names publicly
            score: r.score,
            review: r.review,
            isVerifiedPatient: true,
            createdAt: r.createdAt
        }));

        // Fetch target rating summary
        let targetEntity = null;
        if (targetType === 'doctor') {
            targetEntity = await User.findById(targetId).select('name rating specialization');
        } else if (targetType === 'clinic') {
            targetEntity = await Clinic.findById(targetId).select('name rating address');
        } else if (targetType === 'lab') {
            targetEntity = await IndependentLab.findById(targetId).select('labName rating address');
        }

        return res.status(200).json({
            success: true,
            rating: targetEntity?.rating || { score: 0, count: 0 },
            totalReviews: reviews.length,
            reviews: sanitizedReviews
        });
    } catch (error) {
        console.error('❌ Error fetching ratings:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch ratings.'
        });
    }
};

/**
 * @desc    Get all reviews submitted by the authenticated patient for their patient panel
 * @route   GET /api/ratings/my-reviews
 * @access  Private (Patient) / Phone query fallback
 */
const getPatientReviews = async (req, res) => {
    try {
        const authUser = req.user || extractPatientAuth(req);
        const patientId = authUser?.id || authUser?._id;
        const rawPhone = authUser?.phone || req.query.phone || '';
        const cleanPhone = rawPhone ? rawPhone.toString().replace(/\D/g, '').slice(-10) : '';

        const conditions = [];
        if (patientId && mongoose.Types.ObjectId.isValid(patientId)) {
            conditions.push({ patientId: new mongoose.Types.ObjectId(patientId) });
        }
        if (cleanPhone) {
            conditions.push({ patientPhone: cleanPhone });
        }

        if (conditions.length === 0) {
            return res.status(200).json({ success: true, total: 0, reviews: [] });
        }

        const reviews = await Review.find({ $or: conditions })
            .populate('targetId')
            .sort({ updatedAt: -1 });

        const formatted = reviews.map(r => {
            const target = r.targetId;
            let targetName = 'Healthcare Provider';
            let targetSubtitle = '';

            if (r.targetType === 'doctor' && target) {
                targetName = target.name ? `Dr. ${target.name}` : 'Doctor';
                targetSubtitle = target.specialization || 'Consultant Specialist';
            } else if (r.targetType === 'clinic' && target) {
                targetName = target.name || 'Clinic';
                targetSubtitle = target.address || 'Clinic Facility';
            } else if (r.targetType === 'lab' && target) {
                targetName = target.labName || 'Diagnostic Lab';
                targetSubtitle = target.address || 'Laboratory';
            }

            return {
                _id: r._id,
                targetType: r.targetType,
                targetId: r.targetId?._id || r.targetId,
                targetName,
                targetSubtitle,
                score: r.score,
                review: r.review,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt
            };
        });

        return res.status(200).json({
            success: true,
            total: formatted.length,
            reviews: formatted
        });
    } catch (err) {
        console.error('❌ Error fetching patient reviews:', err);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve your reviews.'
        });
    }
};

/**
 * @desc    Edit/update an existing review submitted by the patient
 * @route   PUT /api/ratings/:reviewId
 * @access  Private (Patient)
 */
const updateReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { score, review } = req.body;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ success: false, message: 'Invalid review ID.' });
        }

        const numericScore = Number(score);
        if (isNaN(numericScore) || numericScore < 1 || numericScore > 5) {
            return res.status(400).json({ success: false, message: 'Score must be between 1 and 5.' });
        }

        const existingReview = await Review.findById(reviewId);
        if (!existingReview) {
            return res.status(404).json({ success: false, message: 'Review not found.' });
        }

        // Verify patient ownership if auth user is present
        const authUser = req.user || extractPatientAuth(req);
        const patientId = authUser?.id || authUser?._id;
        const rawPhone = authUser?.phone || req.body.patientPhone || '';
        const cleanPhone = rawPhone ? rawPhone.toString().replace(/\D/g, '').slice(-10) : '';

        if (patientId && existingReview.patientId && existingReview.patientId.toString() !== patientId.toString()) {
            return res.status(403).json({ success: false, message: 'Unauthorized to edit this review.' });
        }

        // Update fields
        existingReview.score = Math.round(numericScore);
        if (review !== undefined) {
            existingReview.review = review.toString().trim().replace(/[<>]/g, '');
        }
        await existingReview.save();

        // Recalculate target aggregate score
        const updatedRating = await recalculateTargetRating(existingReview.targetType, existingReview.targetId);

        console.log(`✏️ Updated review ${reviewId} for ${existingReview.targetType}: new score ${updatedRating.score}`);

        return res.status(200).json({
            success: true,
            message: 'Your review has been updated successfully.',
            review: existingReview,
            rating: updatedRating
        });
    } catch (err) {
        console.error('❌ Error updating review:', err);
        return res.status(500).json({ success: false, message: 'Failed to update review.' });
    }
};

/**
 * @desc    Delete a review submitted by the patient
 * @route   DELETE /api/ratings/:reviewId
 * @access  Private (Patient)
 */
const deleteReview = async (req, res) => {
    try {
        const { reviewId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({ success: false, message: 'Invalid review ID.' });
        }

        const existingReview = await Review.findById(reviewId);
        if (!existingReview) {
            return res.status(404).json({ success: false, message: 'Review not found.' });
        }

        const targetType = existingReview.targetType;
        const targetId = existingReview.targetId;

        await Review.findByIdAndDelete(reviewId);

        // Recalculate target aggregate score
        const updatedRating = await recalculateTargetRating(targetType, targetId);

        return res.status(200).json({
            success: true,
            message: 'Review deleted successfully.',
            rating: updatedRating
        });
    } catch (err) {
        console.error('❌ Error deleting review:', err);
        return res.status(500).json({ success: false, message: 'Failed to delete review.' });
    }
};

/**
 * @desc    Search doctors, clinics, and labs for patient rating selection
 * @route   GET /api/ratings/search
 * @access  Public
 */
const searchTargets = async (req, res) => {
    try {
        const { q = '', type = 'all' } = req.query;
        const queryStr = q.toString().trim();
        const regex = new RegExp(queryStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

        let doctors = [];
        let clinics = [];
        let labs = [];

        if (type === 'all' || type === 'doctor') {
            doctors = await User.find({
                role: 'doctor',
                isActive: true,
                ...(queryStr ? { $or: [{ name: regex }, { specialization: regex }] } : {})
            })
            .populate('clinicId', 'name')
            .select('name specialization rating profileImage clinicId')
            .limit(10);
        }

        if (type === 'all' || type === 'clinic') {
            clinics = await Clinic.find({
                isActive: true,
                ...(queryStr ? { $or: [{ name: regex }, { address: regex }] } : {})
            })
            .select('name address rating logo')
            .limit(10);
        }

        if (type === 'all' || type === 'lab') {
            labs = await IndependentLab.find({
                isActive: true,
                ...(queryStr ? { $or: [{ labName: regex }, { address: regex }] } : {})
            })
            .select('labName address rating logo')
            .limit(10);
        }

        const results = [
            ...doctors.map(d => ({
                id: d._id,
                name: d.name,
                type: 'doctor',
                subtitle: `${d.specialization || 'Physician'}${d.clinicId?.name ? ` • ${d.clinicId.name}` : ''}`,
                rating: d.rating || { score: 0, count: 0 }
            })),
            ...clinics.map(c => ({
                id: c._id,
                name: c.name,
                type: 'clinic',
                subtitle: c.address || 'Clinic Facility',
                rating: c.rating || { score: 0, count: 0 }
            })),
            ...labs.map(l => ({
                id: l._id,
                name: l.labName,
                type: 'lab',
                subtitle: l.address || 'Diagnostic Laboratory',
                rating: l.rating || { score: 0, count: 0 }
            }))
        ];

        return res.status(200).json({
            success: true,
            results
        });
    } catch (err) {
        console.error('❌ Error searching rating targets:', err);
        return res.status(500).json({ success: false, message: 'Search failed' });
    }
};

module.exports = {
    submitRating,
    getRatings,
    getPatientReviews,
    updateReview,
    deleteReview,
    searchTargets
};
