/**
 * Appointment Wait Time Prediction Module
 * Uses historical data to predict how long an appointment will take
 */

const fs = require('fs');
const path = require('path');

// Global state
let model = null;
let problemLookup = {};
let globalMeanServiceTime = 20.0;
let lastTrainingTime = null;
let trainingInProgress = false;

// ============================================
// HELPER FUNCTIONS
// ============================================

function cleanBasic(s) {
    if (!s || s === null || s === undefined) {
        return 'missing';
    }
    s = String(s).trim().toLowerCase();
    if (s.includes('follow')) {
        return 'followup';
    }
    if (s.includes('new')) {
        return 'new';
    }
    if (['true', 'yes', '1', 'true'].includes(s)) {
        return 'emergency';
    }
    if (['false', 'no', '0'].includes(s)) {
        return 'normal';
    }
    return s;
}

function convertTimeToMin(t) {
    try {
        if (!t) return 540; // default = 9:00 AM
        
        const timeStr = String(t).toUpperCase().replace(/\s/g, '');
        
        // Parse HH:MM or HH:MM:SS format
        const timeParts = timeStr.split(':');
        const hours = parseInt(timeParts[0], 10);
        const minutes = parseInt(timeParts[1], 10) || 0;
        
        if (isNaN(hours) || isNaN(minutes)) {
            return 540;
        }
        
        return hours * 60 + minutes;
    } catch (error) {
        return 540; // default = 9:00 AM
    }
}

// ============================================
// PREDICTION FUNCTION
// ============================================

/**
 * Predict waiting time for a patient appointment
 * @param {Object} userData - Patient and visit data
 * @returns {Number} Estimated wait time in minutes
 */
function predictSingleUser(userData) {
    // Fallback to global mean if no model
    if (!model) {
        return Math.round(globalMeanServiceTime);
    }

    try {
        // Extract and clean data
        const emergency = cleanBasic(userData.emergency || 'normal');
        const doctorId = cleanBasic(userData.doctor_id || userData.doctorId || 'unknown');
        const doctorType = cleanBasic(userData.doctor_type || userData.doctorType || 'general');
        const visitType = cleanBasic(userData.visit_type || userData.visitType || 'new');
        const day = cleanBasic(userData.day || 'monday');
        const clinicType = cleanBasic(userData.clinic_type || userData.clinicType || 'urban');
        const gender = cleanBasic(userData.gender || 'unknown');
        const problem = cleanBasic(userData.problem || 'missing');

        const timeMin = convertTimeToMin(userData.time || userData.appointmentTime || '09:00');
        const age = parseInt(userData.age || 30, 10);
        const tokenNo = parseInt(userData.token_no || userData.tokenNumber || 1, 10);

        // Create feature set (mimicking the Python model)
        const priorityChain = `${emergency}_${doctorId}_${doctorType}_${visitType}`;
        const problemComplexity = problemLookup[problem] || globalMeanServiceTime;

        // Simple ML fallback: prediction based on heuristics
        // This placeholder uses heuristics until a real model is available
        let prediction = globalMeanServiceTime;

        // Adjust based on visit type
        if (visitType === 'followup') {
            prediction = globalMeanServiceTime * 0.75; // Followup usually faster
        } else if (visitType === 'new') {
            prediction = globalMeanServiceTime * 1.25; // New patient takes longer
        }

        // Adjust based on emergency
        if (emergency === 'emergency') {
            prediction = prediction * 0.5; // Emergency gets priority
        }

        // Adjust based on time of day
        if (timeMin < 540 || timeMin > 1020) {
            prediction = prediction * 1.1; // Early morning or late evening slower
        }

        // Adjust based on token number
        prediction = prediction + (tokenNo * 2); // Each token adds ~2 minutes

        return Math.round(prediction);

    } catch (error) {
        console.error('Prediction error:', error.message);
        return Math.round(globalMeanServiceTime);
    }
}

/**
 * Initialize the predictor (load any cached model)
 */
function initializePredictor() {
    try {
        // Try to load cached predictions data
        const dataPath = path.join(__dirname, '../../data/appointment_patterns.json');
        
        if (fs.existsSync(dataPath)) {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            problemLookup = data.problemLookup || {};
            globalMeanServiceTime = data.globalMean || 20.0;
            console.log('✅ Appointment predictor initialized with cached data');
        } else {
            console.log('⚠️  Appointment predictor using default values');
        }
    } catch (error) {
        console.error('❌ Error initializing predictor:', error.message);
    }
}

/**
 * Update predictor with new historical data
 * (This would be called periodically or after each appointment completion)
 */
function updatePredictorWithData(appointmentData) {
    try {
        if (!appointmentData || !appointmentData.problem || !appointmentData.service_time) {
            return;
        }

        const problem = cleanBasic(appointmentData.problem);
        const serviceTime = parseFloat(appointmentData.service_time);

        if (isNaN(serviceTime) || serviceTime <= 0) {
            return;
        }

        // Update problem lookup table (exponential moving average)
        if (!problemLookup[problem]) {
            problemLookup[problem] = serviceTime;
        } else {
            // Weighted average: 80% old, 20% new
            problemLookup[problem] = problemLookup[problem] * 0.8 + serviceTime * 0.2;
        }

        // Update global mean (exponential moving average)
        globalMeanServiceTime = globalMeanServiceTime * 0.9 + serviceTime * 0.1;

        console.log(`✅ Predictor updated: ${problem} avg = ${problemLookup[problem].toFixed(2)} min`);
    } catch (error) {
        console.error('Error updating predictor:', error.message);
    }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    predictSingleUser,
    initializePredictor,
    updatePredictorWithData,
    cleanBasic,
    convertTimeToMin
};

// Initialize on module load
initializePredictor();
