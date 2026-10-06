const mongoose = require('../config/mongoose_connection');

const clinicSchema = mongoose.Schema({
  name: { type: String, required: true },
  clinicCode: { type: String, required: true, unique: true, uppercase: true },
  address: { type: String, required: true },
  contactPhone: { type: String, required: true },
  email: { type: String, trim: true, lowercase: true },
  openingTime: { type: String, default: '09:00' },
  closingTime: { type: String, default: '17:00' },
  breakStartTime: { type: String, default: '12:00' },
  breakEndTime: { type: String, default: '14:00' },
  slotDurationMinutes: { type: Number, default: 30, min: 10, max: 120 },
  workingDays: {
    type: [String],
    default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  },
  isActive: { type: Boolean, default: true },
  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
  
  // Billing & Queue Rules Config
  feeConsult: { type: Number, default: 500 },
  feeFollowupConsult: { type: Number, default: 300 },
  taxEnabled: { type: Boolean, default: false },
  taxRate: { type: Number, default: 0 },
  gstin: { type: String, default: '', trim: true, uppercase: true },
  feeLab: { type: Number, default: 450 },
  feeEmergency: { type: Number, default: 300 },
  feeMedicine: { type: Number, default: 120 },
  avgWaitFactor: { type: Number, default: 8 },

  // Super Admin Billing & Configuration
  isPremium: { type: Boolean, default: false },
  subscriptionPlan: { type: String, default: 'free' },
  subscriptionExpiresAt: { type: Date, default: null },
  showOnNetwork: { type: Boolean, default: true },
  customSubscriptionPrice: { type: Number },
  customTrafficLimits: {
    maxStaff: { type: Number, default: null },
    maxPatients: { type: Number, default: null },
    maxQueues: { type: Number, default: null }
  },

  // Modular Service Activations
  activeServices: [{
    service: {
      type: String,
      enum: ['billing', 'messaging', 'appointments', 'lab-connect', 'analytics', 'health-locker'],
      required: true
    },
    activatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan' }
  }],

  city: { type: String, default: '', trim: true },
  slugHistory: [{ type: String, lowercase: true, trim: true }],

  // 🌐 SEO & Google Listing Model
  seo: {
    metaTitle: { type: String, maxlength: 70, default: '' },
    metaDescription: { type: String, maxlength: 170, default: '' },
    focusKeyword: { type: String, maxlength: 60, default: '' },
    keywords: { type: [String], default: [] },
    about: { type: String, maxlength: 2000, default: '' },
    services: { type: [String], default: [] },
    faqs: [{
      q: { type: String, maxlength: 200 },
      a: { type: String, maxlength: 1000 }
    }],
    ogImageUrl: { type: String, default: '' },
    googleBusinessUrl: { type: String, default: '' },
    noindex: { type: Boolean, default: false },
    seoUpdatedAt: { type: Date },
    seoUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },

  // 🌐 SEO & Public Profile Management
  slug: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  bio: { type: String, default: '' },
  specialties: [{ type: String }],
  locationGeo: {
    lat: { type: Number, default: 28.6139 },
    lng: { type: Number, default: 77.2090 }
  },
  seoTitle: { type: String, default: '' },
  seoDescription: { type: String, default: '' },
  seoKeywords: [{ type: String }],
  socialLinks: {
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    twitter: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    youtube: { type: String, default: '' }
  },
  rating: {
    score: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  },
  accreditation: [{ type: String }],
  videoUrl: { type: String, default: '' },
  publicListingConsent: { type: Boolean, default: false },
  publicListingConsentDate: { type: Date, default: null },
  publicListingConsentIp: { type: String, default: '' },
  publicListingConsentText: { type: String, default: '' },
  milestones: {
    profileCompletedAt: { type: Date, default: null },
    firstDoctorAddedAt: { type: Date, default: null },
    firstPatientAddedAt: { type: Date, default: null },
    firstAppointmentAt: { type: Date, default: null }
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual alias: publicConsent <-> publicListingConsent
clinicSchema.virtual('publicConsent')
  .get(function() { return this.publicListingConsent; })
  .set(function(v) { this.publicListingConsent = Boolean(v); });

// Helper to sanitize slug
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Pre-save hook: auto-generate slug and maintain slugHistory (async hook compatible with Mongoose)
clinicSchema.pre('save', async function(next) {
  if (this.isModified('slug') && !this.isNew) {
    const original = await this.constructor.findById(this._id).select('slug slugHistory');
    if (original && original.slug && original.slug !== this.slug) {
      if (!this.slugHistory) this.slugHistory = [];
      if (!this.slugHistory.includes(original.slug)) {
        this.slugHistory.push(original.slug);
      }
    }
  }

  if (!this.slug) {
    const cityPart = this.city || (this.address ? this.address.split(',').pop().trim() : '');
    const raw = `${this.name || 'clinic'} ${cityPart}`.trim();
    let generatedSlug = slugify(raw) || `clinic-${Date.now()}`;
    
    const existing = await this.constructor.findOne({ slug: generatedSlug, _id: { $ne: this._id } });
    if (existing) {
      generatedSlug = `${generatedSlug}-${this.clinicCode ? this.clinicCode.toLowerCase() : Math.floor(1000 + Math.random() * 9000)}`;
    }
    this.slug = generatedSlug;
  }

  if (typeof next === 'function') {
    next();
  }
});

// Render-time effective SEO defaults (never stored to DB)
clinicSchema.methods.getEffectiveSeo = function() {
  const seo = this.seo || {};
  const name = this.name || 'Clinic';
  const city = this.city || (this.address ? this.address.split(',').pop().trim() : '') || 'India';
  const services = (seo.services && seo.services.length > 0) ? seo.services : (this.specialties || []);
  const topServices = services.slice(0, 3).join(', ');

  const defaultTitle = `${name} – ${city} | Book Appointment Online`.slice(0, 70);
  const defaultDesc = `${name} in ${city}.${topServices ? ` Top services: ${topServices}.` : ''} Live token queue, no waiting room.`.slice(0, 170);
  const defaultKeywords = Array.from(new Set([
    name.toLowerCase(),
    `clinic in ${city}`.toLowerCase(),
    `doctor in ${city}`.toLowerCase(),
    `book appointment ${city}`.toLowerCase(),
    ...services.map(s => String(s).toLowerCase().trim())
  ])).slice(0, 15);

  return {
    metaTitle: seo.metaTitle || defaultTitle,
    metaDescription: seo.metaDescription || defaultDesc,
    focusKeyword: seo.focusKeyword || '',
    keywords: (seo.keywords && seo.keywords.length > 0) ? seo.keywords : defaultKeywords,
    about: seo.about || this.bio || `Welcome to ${name}, a premier healthcare clinic in ${city} dedicated to wait-free clinical care.`,
    services: services,
    faqs: (seo.faqs && seo.faqs.length > 0) ? seo.faqs : [],
    ogImageUrl: seo.ogImageUrl || '',
    googleBusinessUrl: seo.googleBusinessUrl || '',
    noindex: Boolean(seo.noindex),
    isDefaultTitle: !seo.metaTitle,
    isDefaultDescription: !seo.metaDescription
  };
};

module.exports = mongoose.model('Clinic', clinicSchema);