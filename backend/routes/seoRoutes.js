const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const Clinic = require('../models/Clinic');
const User = require('../models/User');
const ssrCache = require('../utils/ssr_cache');
const { publicReadLimiter } = require('../utils/security_middleware');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://appointory.in').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// HTML & Template Helpers
// ---------------------------------------------------------------------------
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeJsonLd(obj) {
    return JSON.stringify(obj)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e');
}

let cachedBaseHtml = null;
let lastHtmlLoadTime = 0;
const HTML_RELOAD_INTERVAL = 10 * 60 * 1000; // 10 minutes

function getBaseIndexHtml() {
    const now = Date.now();
    if (cachedBaseHtml && now - lastHtmlLoadTime < HTML_RELOAD_INTERVAL) {
        return cachedBaseHtml;
    }

    // Attempt 1: Custom environment path
    const candidatePaths = [
        process.env.FRONTEND_INDEX_PATH,
        path.resolve(__dirname, '../../frontend/dist/index.html'),
        path.resolve(__dirname, '../frontend/dist/index.html'),
        path.resolve(__dirname, '../../frontend/index.html')
    ].filter(Boolean);

    for (const p of candidatePaths) {
        try {
            if (fs.existsSync(p)) {
                cachedBaseHtml = fs.readFileSync(p, 'utf-8');
                lastHtmlLoadTime = now;
                return cachedBaseHtml;
            }
        } catch {
            // continue to next candidate
        }
    }

    // Fallback minimal responsive HTML shell if dist not built yet
    cachedBaseHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Appointory – Care without the Waiting Room</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
    lastHtmlLoadTime = now;
    return cachedBaseHtml;
}

function render404(res, message = 'Clinic Not Found or Private') {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <title>Clinic Not Found (404) | Appointory</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #faf8f5; color: #1e293b; text-align: center; padding: 60px 20px; line-height: 1.6; }
        .box { max-width: 520px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 24px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        h1 { color: #0f766e; font-size: 1.5rem; margin-bottom: 12px; }
        p { color: #64748b; font-size: 0.95rem; margin-bottom: 24px; }
        .btn { display: inline-block; background: #0d9488; color: #fff; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 0.9rem; }
        .btn:hover { background: #0f766e; }
    </style>
</head>
<body>
    <div class="box">
        <h1>404 – Clinic Profile Not Found</h1>
        <p>${escapeHtml(message)}</p>
        <a href="${SITE_URL}" class="btn">Explore Appointory</a>
    </div>
</body>
</html>`);
}

// ---------------------------------------------------------------------------
// 🏥 1. GET /c/:slug - SERVER-RENDERED CLINIC PROFILE
// ---------------------------------------------------------------------------
router.get('/c/:slug', publicReadLimiter, async (req, res, next) => {
    try {
        const rawSlug = String(req.params.slug || '').toLowerCase().trim();
        if (!rawSlug) return next();

        const isBookRequest = req.query.book === '1' || req.query.book === 'true';

        // 🎯 If this is a direct booking request (?book=1 / QR Code Scan), immediately redirect to /book
        if (isBookRequest) {
            let bookingClinic = await Clinic.findOne({ slug: rawSlug, isActive: true });
            if (!bookingClinic) {
                bookingClinic = await Clinic.findOne({ slugHistory: rawSlug, isActive: true });
            }
            if (!bookingClinic) {
                bookingClinic = await Clinic.findOne({ clinicCode: rawSlug.toUpperCase(), isActive: true });
            }
            if (!bookingClinic && /^[0-9a-fA-F]{24}$/.test(rawSlug)) {
                bookingClinic = await Clinic.findOne({ _id: rawSlug, isActive: true });
            }
            if (!bookingClinic && rawSlug === 'clinic') {
                bookingClinic = await Clinic.findOne({ isActive: true });
            }

            if (bookingClinic) {
                return res.redirect(302, `/book?clinicId=${bookingClinic._id}&clinic=${bookingClinic.slug || bookingClinic.clinicCode}&utm_source=qr`);
            } else {
                return res.redirect(302, `/book?clinic=${encodeURIComponent(rawSlug)}&utm_source=qr`);
            }
        }

        // Check SSR Cache first
        const cacheKey = `page:/c/${rawSlug}`;
        const cachedHtml = ssrCache.get(cacheKey);
        if (cachedHtml) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
            return res.status(200).send(cachedHtml);
        }

        // 1. Check if slug exists in slugHistory -> 301 Permanent Redirect
        const historyMatch = await Clinic.findOne({ slugHistory: rawSlug, isActive: true });
        if (historyMatch && historyMatch.slug && historyMatch.slug !== rawSlug) {
            const queryPart = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
            return res.redirect(301, `/c/${historyMatch.slug}${queryPart}`);
        }

        // 2. Query clinic by current slug, with fallbacks for clinicCode, ObjectId, or generic 'clinic'
        let clinic = await Clinic.findOne({ slug: rawSlug, isActive: true });
        if (!clinic) {
            clinic = await Clinic.findOne({ clinicCode: rawSlug.toUpperCase(), isActive: true });
        }
        if (!clinic && /^[0-9a-fA-F]{24}$/.test(rawSlug)) {
            clinic = await Clinic.findOne({ _id: rawSlug, isActive: true });
        }
        if (!clinic && rawSlug === 'clinic') {
            clinic = await Clinic.findOne({ isActive: true });
        }

        if (!clinic) {
            return render404(res, 'The requested clinic profile does not exist or is inactive.');
        }

        // 3. DPDP Consent & Noindex check
        // If clinic opted out or hasn't consented, allow direct link visitors to view profile but set noindex header
        const isOptedOut = !clinic.publicListingConsent || clinic.seo?.noindex === true;
        if (isOptedOut) {
            res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        }

        // 4. Fetch associated specialist doctors with explicit directory consent
        const doctors = await User.find({
            clinicId: clinic._id,
            role: 'doctor',
            isActive: true,
            publicListingConsent: true
        }).select('name specialization slug profileImage consultationFee experience');

        const effectiveSeo = clinic.getEffectiveSeo();
        const city = clinic.city || (clinic.address ? clinic.address.split(',').pop().trim() : '') || 'India';
        const canonicalUrl = `${SITE_URL}/c/${clinic.slug}`;
        const bookingUrl = `${SITE_URL}/c/${clinic.slug}?book=1`;
        const ogImage = effectiveSeo.ogImageUrl || `${SITE_URL}/og-image.png`;

        // 5. Construct Structured Data (JSON-LD)
        const jsonLdBlocks = [];

        // MedicalClinic
        const clinicSchema = {
            "@context": "https://schema.org",
            "@type": "MedicalClinic",
            "@id": canonicalUrl,
            "name": clinic.name,
            "url": canonicalUrl,
            "telephone": clinic.contactPhone,
            "image": ogImage,
            "priceRange": `₹${clinic.feeConsult || 500}`,
            "currenciesAccepted": "INR",
            "paymentAccepted": ["Cash", "UPI", "Credit Card", "Debit Card"],
            "address": {
                "@type": "PostalAddress",
                "streetAddress": clinic.address,
                "addressLocality": city,
                "addressCountry": "IN"
            },
            "potentialAction": {
                "@type": "ReserveAction",
                "target": {
                    "@type": "EntryPoint",
                    "urlTemplate": bookingUrl,
                    "actionPlatform": [
                        "http://schema.org/DesktopWebPlatform",
                        "http://schema.org/MobileWebPlatform"
                    ]
                },
                "result": {
                    "@type": "Reservation",
                    "name": "Doctor Consultation Booking"
                }
            }
        };

        if (clinic.locationGeo?.lat && clinic.locationGeo?.lng) {
            clinicSchema.geo = {
                "@type": "GeoCoordinates",
                "latitude": clinic.locationGeo.lat,
                "longitude": clinic.locationGeo.lng
            };
        }

        if (effectiveSeo.services && effectiveSeo.services.length > 0) {
            clinicSchema.medicalSpecialty = effectiveSeo.services;
            clinicSchema.availableService = effectiveSeo.services.map(s => ({
                "@type": "MedicalProcedure",
                "name": s
            }));
        }

        if (effectiveSeo.googleBusinessUrl) {
            clinicSchema.sameAs = [effectiveSeo.googleBusinessUrl];
        }

        if (clinic.openingTime && clinic.closingTime) {
            clinicSchema.openingHoursSpecification = [{
                "@type": "OpeningHoursSpecification",
                "dayOfWeek": clinic.workingDays && clinic.workingDays.length > 0
                    ? clinic.workingDays.map(d => d.charAt(0).toUpperCase() + d.slice(1))
                    : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
                "opens": clinic.openingTime,
                "closes": clinic.closingTime
            }];
        }

        if (clinic.rating?.count > 0 && clinic.rating?.score > 0) {
            clinicSchema.aggregateRating = {
                "@type": "AggregateRating",
                "ratingValue": clinic.rating.score,
                "reviewCount": clinic.rating.count
            };
        }

        jsonLdBlocks.push(clinicSchema);

        // FAQPage (if FAQs present)
        if (effectiveSeo.faqs && effectiveSeo.faqs.length > 0) {
            jsonLdBlocks.push({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": effectiveSeo.faqs.map(f => ({
                    "@type": "Question",
                    "name": f.q,
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": f.a
                    }
                }))
            });
        }

        // BreadcrumbList
        jsonLdBlocks.push({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL },
                { "@type": "ListItem", "position": 2, "name": "Clinics", "item": `${SITE_URL}/clinics` },
                { "@type": "ListItem", "position": 3, "name": city, "item": `${SITE_URL}/clinics/${encodeURIComponent(city.toLowerCase())}` },
                { "@type": "ListItem", "position": 4, "name": clinic.name, "item": canonicalUrl }
            ]
        });

        // 6. Build Crawlable Static HTML Fallback inside <div id="root">
        const servicesListHtml = effectiveSeo.services && effectiveSeo.services.length > 0
            ? `<section style="margin:24px 0;">
                 <h2 style="font-size:1.25rem;color:#0f766e;margin-bottom:8px;">Clinical Services</h2>
                 <ul style="list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px;">
                   ${effectiveSeo.services.map(s => `<li style="background:#f0fdfa;border:1px solid #99f6e4;color:#0f766e;padding:6px 14px;border-radius:999px;font-size:0.875rem;font-weight:600;">${escapeHtml(s)}</li>`).join('')}
                 </ul>
               </section>`
            : '';

        const doctorsListHtml = doctors.length > 0
            ? `<section style="margin:24px 0;">
                 <h2 style="font-size:1.25rem;color:#0f766e;margin-bottom:12px;">Consulting Doctors</h2>
                 <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:16px;">
                   ${doctors.map(d => `
                     <div style="border:1px solid #e2e8f0;padding:16px;border-radius:16px;background:#fff;">
                       <h3 style="margin:0 0 4px;font-size:1.1rem;color:#0f172a;">${escapeHtml(d.name)}</h3>
                       <p style="margin:0 0 8px;color:#0d9488;font-size:0.875rem;font-weight:600;">${escapeHtml(d.specialization || 'Physician')}</p>
                       <p style="margin:0 0 12px;font-size:0.85rem;color:#64748b;">Fee: ₹${escapeHtml(d.consultationFee || clinic.feeConsult || 500)}</p>
                       <a href="${SITE_URL}/d/${escapeHtml(d.slug || d._id)}" style="color:#0f766e;font-weight:700;text-decoration:none;font-size:0.85rem;">View Doctor Profile &rarr;</a>
                     </div>
                   `).join('')}
                 </div>
               </section>`
            : '';

        const faqsHtml = effectiveSeo.faqs && effectiveSeo.faqs.length > 0
            ? `<section style="margin:24px 0;">
                 <h2 style="font-size:1.25rem;color:#0f766e;margin-bottom:12px;">Frequently Asked Questions</h2>
                 <div style="display:flex;flex-direction:column;gap:12px;">
                   ${effectiveSeo.faqs.map(f => `
                     <details style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;">
                       <summary style="font-weight:700;color:#0f172a;cursor:pointer;">${escapeHtml(f.q)}</summary>
                       <p style="margin:10px 0 0;color:#475569;font-size:0.9rem;line-height:1.6;">${escapeHtml(f.a)}</p>
                     </details>
                   `).join('')}
                 </div>
               </section>`
            : '';

        const crawlableBody = `
          <header style="max-width:880px;margin:24px auto;padding:0 20px;font-family:system-ui,-apple-system,sans-serif;color:#1e293b;">
            <div style="display:inline-block;background:#ccfbf1;color:#0f766e;padding:4px 12px;border-radius:999px;font-size:0.8rem;font-weight:700;margin-bottom:12px;">Verified Healthcare Provider</div>
            <h1 style="font-size:2.5rem;font-weight:900;color:#0f172a;margin:0 0 12px;line-height:1.2;">${escapeHtml(clinic.name)}</h1>
            <div style="display:flex;flex-wrap:wrap;gap:16px;color:#475569;font-size:0.95rem;margin-bottom:16px;">
              <span>📍 <strong>Address:</strong> ${escapeHtml(clinic.address)}</span>
              <span>🏙️ <strong>City:</strong> ${escapeHtml(city)}</span>
              <span>📞 <strong>Phone:</strong> ${escapeHtml(clinic.contactPhone)}</span>
              <span>⏰ <strong>Hours:</strong> ${escapeHtml(clinic.openingTime || '09:00')} - ${escapeHtml(clinic.closingTime || '17:00')}</span>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:18px;border-radius:16px;margin:20px 0;line-height:1.7;color:#334155;">
              ${escapeHtml(effectiveSeo.about)}
            </div>
            <div style="margin:24px 0;">
              <a href="${bookingUrl}" style="display:inline-block;background:#0d9488;color:#fff;font-weight:700;padding:14px 28px;border-radius:14px;text-decoration:none;font-size:1rem;box-shadow:0 4px 12px rgba(13,148,136,0.25);">Book Appointment Online (₹${clinic.feeConsult || 500})</a>
            </div>
            ${servicesListHtml}
            ${doctorsListHtml}
            ${faqsHtml}
          </header>
        `;

        // 7. Inject Meta Tags & JSON-LD into base index.html
        let fullHtml = getBaseIndexHtml();

        // Title
        fullHtml = fullHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(effectiveSeo.metaTitle)}</title>`);

        // Meta Description
        fullHtml = fullHtml.replace(/<meta name="description"[\s\S]*?>/i, `<meta name="description" content="${escapeHtml(effectiveSeo.metaDescription)}">`);

        // Canonical
        if (fullHtml.includes('<link rel="canonical"')) {
            fullHtml = fullHtml.replace(/<link rel="canonical"[\s\S]*?>/i, `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`);
        } else {
            fullHtml = fullHtml.replace('</head>', `  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">\n</head>`);
        }

        // Open Graph & Twitter Tags
        const socialTags = `
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Appointory">
  <meta property="og:title" content="${escapeHtml(effectiveSeo.metaTitle)}">
  <meta property="og:description" content="${escapeHtml(effectiveSeo.metaDescription)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="en_IN">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(effectiveSeo.metaTitle)}">
  <meta name="twitter:description" content="${escapeHtml(effectiveSeo.metaDescription)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  <script type="application/ld+json">${safeJsonLd(jsonLdBlocks)}</script>
`;
        fullHtml = fullHtml.replace('</head>', `${socialTags}\n</head>`);

        // Replace <div id="root"> content with crawlable body
        fullHtml = fullHtml.replace('<div id="root"></div>', `<div id="root">${crawlableBody}</div>`);

        // Cache in memory for 5 minutes
        ssrCache.set(cacheKey, fullHtml, 5 * 60 * 1000);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
        return res.status(200).send(fullHtml);
    } catch (error) {
        console.error('❌ Error in SSR /c/:slug:', error);
        return next();
    }
});

// ---------------------------------------------------------------------------
// 🏙️ 2. GET /clinics/:city - CITY DIRECTORY SSR PAGE
// ---------------------------------------------------------------------------
router.get('/clinics/:city', publicReadLimiter, async (req, res, next) => {
    try {
        const rawCity = String(req.params.city || '').trim();
        if (!rawCity) return next();

        const cacheKey = `dir:${rawCity.toLowerCase()}`;
        const cachedHtml = ssrCache.get(cacheKey);
        if (cachedHtml) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
            return res.status(200).send(cachedHtml);
        }

        const cityRegex = new RegExp(`^${rawCity}$`, 'i');
        const clinics = await Clinic.find({
            isActive: true,
            publicListingConsent: true,
            'seo.noindex': { $ne: true },
            $or: [
                { city: cityRegex },
                { address: new RegExp(rawCity, 'i') }
            ]
        }).select('name slug address city specialties feeConsult seo rating');

        const displayCity = rawCity.charAt(0).toUpperCase() + rawCity.slice(1);
        const title = `Best Clinics in ${displayCity} – Book Online | Appointory`.slice(0, 70);
        const description = `Find verified clinics and OPD doctors in ${displayCity}. Book instant appointments with zero waiting room delays on Appointory.`.slice(0, 170);
        const canonicalUrl = `${SITE_URL}/clinics/${encodeURIComponent(rawCity.toLowerCase())}`;

        // Schema: ItemList
        const itemListSchema = {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": `Clinics in ${displayCity}`,
            "url": canonicalUrl,
            "itemListElement": clinics.map((c, idx) => ({
                "@type": "ListItem",
                "position": idx + 1,
                "url": `${SITE_URL}/c/${c.slug}`,
                "name": c.name
            }))
        };

        const breadcrumbsSchema = {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL },
                { "@type": "ListItem", "position": 2, "name": "Clinics", "item": `${SITE_URL}/clinics` },
                { "@type": "ListItem", "position": 3, "name": displayCity, "item": canonicalUrl }
            ]
        };

        const clinicsListHtml = clinics.length > 0
            ? clinics.map(c => `
                <div style="border:1px solid #e2e8f0;padding:20px;border-radius:18px;background:#fff;margin-bottom:16px;">
                  <h2 style="margin:0 0 6px;font-size:1.35rem;color:#0f172a;"><a href="${SITE_URL}/c/${escapeHtml(c.slug)}" style="color:#0f172a;text-decoration:none;">${escapeHtml(c.name)}</a></h2>
                  <p style="margin:0 0 8px;color:#64748b;font-size:0.9rem;">📍 ${escapeHtml(c.address)}</p>
                  <p style="margin:0 0 12px;font-size:0.875rem;color:#0d9488;font-weight:600;">Consultation: ₹${c.feeConsult || 500}</p>
                  <a href="${SITE_URL}/c/${escapeHtml(c.slug)}?book=1" style="display:inline-block;background:#0d9488;color:#fff;font-weight:700;padding:8px 18px;border-radius:10px;text-decoration:none;font-size:0.875rem;">Book Appointment &rarr;</a>
                </div>
              `).join('')
            : `<p style="color:#64748b;font-size:1rem;">No publicly listed clinics currently found in ${escapeHtml(displayCity)}. Check back soon!</p>`;

        const crawlableBody = `
          <header style="max-width:880px;margin:32px auto;padding:0 20px;font-family:system-ui,-apple-system,sans-serif;color:#1e293b;">
            <p style="color:#0d9488;font-weight:700;text-transform:uppercase;font-size:0.85rem;margin-bottom:6px;">City Directory &bull; ${escapeHtml(displayCity)}</p>
            <h1 style="font-size:2.25rem;font-weight:900;color:#0f172a;margin:0 0 12px;">Clinics in ${escapeHtml(displayCity)}</h1>
            <p style="color:#475569;font-size:1.05rem;line-height:1.6;margin-bottom:24px;">Browse trusted outpatient clinics and specialist doctors in ${escapeHtml(displayCity)}. Track your queue token live and eliminate waiting room crowding.</p>
            <div style="margin-top:24px;">
              ${clinicsListHtml}
            </div>
            <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;">
              <a href="${SITE_URL}/clinics" style="color:#0f766e;font-weight:700;text-decoration:none;">&larr; View All Cities</a>
            </div>
          </header>
        `;

        let fullHtml = getBaseIndexHtml();
        fullHtml = fullHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
        fullHtml = fullHtml.replace(/<meta name="description"[\s\S]*?>/i, `<meta name="description" content="${escapeHtml(description)}">`);

        const headAdditions = `
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <script type="application/ld+json">${safeJsonLd([itemListSchema, breadcrumbsSchema])}</script>
`;
        fullHtml = fullHtml.replace('</head>', `${headAdditions}\n</head>`);
        fullHtml = fullHtml.replace('<div id="root"></div>', `<div id="root">${crawlableBody}</div>`);

        ssrCache.set(cacheKey, fullHtml, 5 * 60 * 1000);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
        return res.status(200).send(fullHtml);
    } catch (error) {
        console.error('❌ Error in SSR /clinics/:city:', error);
        return next();
    }
});

// ---------------------------------------------------------------------------
// 🌍 3. GET /clinics - ALL CITIES DIRECTORY SSR PAGE
// ---------------------------------------------------------------------------
router.get('/clinics', publicReadLimiter, async (req, res, next) => {
    try {
        const cacheKey = 'page:/clinics';
        const cachedHtml = ssrCache.get(cacheKey);
        if (cachedHtml) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
            return res.status(200).send(cachedHtml);
        }

        const clinics = await Clinic.find({
            isActive: true,
            publicListingConsent: true,
            'seo.noindex': { $ne: true }
        }).select('city address name');

        // Tally cities
        const cityCounts = {};
        for (const c of clinics) {
            const city = c.city || (c.address ? c.address.split(',').pop().trim() : '') || 'Other';
            if (city) {
                const norm = city.trim();
                cityCounts[norm] = (cityCounts[norm] || 0) + 1;
            }
        }

        const title = 'Verified Clinics in India by City – Book Online | Appointory';
        const description = 'Browse outpatient healthcare clinics and polyclinics across Indian cities. Experience zero waiting room delay with Appointory live TV tokens.';
        const canonicalUrl = `${SITE_URL}/clinics`;

        const cityEntries = Object.entries(cityCounts).sort((a, b) => b[1] - a[1]);

        const cityCardsHtml = cityEntries.length > 0
            ? cityEntries.map(([cityName, count]) => `
                <a href="${SITE_URL}/clinics/${encodeURIComponent(cityName.toLowerCase())}" style="display:block;border:1px solid #e2e8f0;padding:18px;border-radius:16px;background:#fff;text-decoration:none;color:#1e293b;box-shadow:0 2px 4px rgba(0,0,0,0.02);">
                  <h2 style="margin:0 0 4px;font-size:1.15rem;color:#0f766e;">${escapeHtml(cityName)}</h2>
                  <p style="margin:0;color:#64748b;font-size:0.875rem;">${count} Registered Clinic${count > 1 ? 's' : ''}</p>
                </a>
              `).join('')
            : '<p>Directory updating. Check back shortly.</p>';

        const crawlableBody = `
          <header style="max-width:880px;margin:32px auto;padding:0 20px;font-family:system-ui,-apple-system,sans-serif;color:#1e293b;">
            <p style="color:#0d9488;font-weight:700;text-transform:uppercase;font-size:0.85rem;margin-bottom:6px;">National Directory &bull; India</p>
            <h1 style="font-size:2.25rem;font-weight:900;color:#0f172a;margin:0 0 12px;">Clinics in India by City</h1>
            <p style="color:#475569;font-size:1.05rem;line-height:1.6;margin-bottom:24px;">Explore outpatient polyclinics and diagnostic centres offering real-time token tracking and 0% GST billing.</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:16px;margin-top:24px;">
              ${cityCardsHtml}
            </div>
          </header>
        `;

        let fullHtml = getBaseIndexHtml();
        fullHtml = fullHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
        fullHtml = fullHtml.replace(/<meta name="description"[\s\S]*?>/i, `<meta name="description" content="${escapeHtml(description)}">`);

        const headAdditions = `
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
`;
        fullHtml = fullHtml.replace('</head>', `${headAdditions}\n</head>`);
        fullHtml = fullHtml.replace('<div id="root"></div>', `<div id="root">${crawlableBody}</div>`);

        ssrCache.set(cacheKey, fullHtml, 5 * 60 * 1000);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
        return res.status(200).send(fullHtml);
    } catch (error) {
        console.error('❌ Error in SSR /clinics:', error);
        return next();
    }
});

// ---------------------------------------------------------------------------
// 🗺️ 4. GET /sitemap.xml - DYNAMIC GOOGLE SITEMAP
// ---------------------------------------------------------------------------
router.get('/sitemap.xml', async (req, res) => {
    try {
        const cached = ssrCache.get('sitemap:xml');
        if (cached) {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            return res.status(200).send(cached);
        }

        const clinics = await Clinic.find({
            isActive: true,
            publicListingConsent: true,
            'seo.noindex': { $ne: true }
        }).select('slug city updatedAt createdAt');

        const doctors = await User.find({
            role: 'doctor',
            isActive: true,
            publicListingConsent: true
        }).select('slug updatedAt createdAt');

        const distinctCities = Array.from(new Set(clinics.map(c => c.city).filter(Boolean)));

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

        // Core Static Pages
        const staticPages = [
            { path: '', priority: '1.0', changefreq: 'daily' },
            { path: 'clinics', priority: '0.9', changefreq: 'daily' },
            { path: 'pricing', priority: '0.9', changefreq: 'weekly' },
            { path: 'blog', priority: '0.85', changefreq: 'weekly' },
            { path: 'features/queue-management', priority: '0.9', changefreq: 'weekly' },
            { path: 'features/token-display-tv', priority: '0.9', changefreq: 'weekly' },
            { path: 'features/gst-billing', priority: '0.9', changefreq: 'weekly' },
            { path: 'features/lab-network', priority: '0.85', changefreq: 'weekly' },
            { path: 'features/digital-prescription', priority: '0.85', changefreq: 'weekly' },
            { path: 'for/clinics', priority: '0.85', changefreq: 'weekly' },
            { path: 'for/doctors', priority: '0.85', changefreq: 'weekly' },
            { path: 'for/labs', priority: '0.85', changefreq: 'weekly' },
            { path: 'compare/appointory-vs-practo', priority: '0.8', changefreq: 'monthly' },
            { path: 'about', priority: '0.7', changefreq: 'monthly' },
            { path: 'press', priority: '0.7', changefreq: 'monthly' },
            { path: 'links', priority: '0.7', changefreq: 'weekly' }
        ];

        const nowIso = new Date().toISOString();

        for (const p of staticPages) {
            xml += `  <url>\n    <loc>${SITE_URL}/${p.path}</loc>\n    <lastmod>${nowIso.slice(0, 10)}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>\n`;
        }

        // City Directory Pages
        for (const city of distinctCities) {
            xml += `  <url>\n    <loc>${SITE_URL}/clinics/${encodeURIComponent(city.toLowerCase())}</loc>\n    <lastmod>${nowIso.slice(0, 10)}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.85</priority>\n  </url>\n`;
        }

        // Clinic Public Pages (only consented & non-noindex)
        for (const c of clinics) {
            const lastMod = (c.updatedAt || c.createdAt || new Date()).toISOString().slice(0, 10);
            xml += `  <url>\n    <loc>${SITE_URL}/c/${c.slug}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
        }

        // Doctor Public Pages (only consented)
        for (const d of doctors) {
            const lastMod = (d.updatedAt || d.createdAt || new Date()).toISOString().slice(0, 10);
            xml += `  <url>\n    <loc>${SITE_URL}/d/${d.slug || d._id}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.85</priority>\n  </url>\n`;
        }

        xml += `</urlset>`;

        ssrCache.set('sitemap:xml', xml, 15 * 60 * 1000);

        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(xml);
    } catch (error) {
        console.error('❌ Sitemap generation error:', error);
        res.status(500).send('<!-- Sitemap Error -->');
    }
});

// ---------------------------------------------------------------------------
// 🤖 5. GET /robots.txt - ROBOTS POLICY
// ---------------------------------------------------------------------------
router.get('/robots.txt', (req, res) => {
    const robots = `User-agent: *
Allow: /
Allow: /c/
Allow: /clinics/
Allow: /d/
Allow: /l/
Allow: /features/
Allow: /for/
Allow: /pricing
Allow: /blog
Allow: /compare/
Allow: /about
Allow: /press
Allow: /links
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /ai.txt
Disallow: /api/
Disallow: /admin
Disallow: /doctor
Disallow: /reception
Disallow: /lab/portal
Disallow: /patient
Disallow: /verify

User-agent: GPTBot
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /doctor
Disallow: /patient

User-agent: PerplexityBot
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /doctor
Disallow: /patient

User-agent: ClaudeBot
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /doctor
Disallow: /patient

Sitemap: ${SITE_URL}/sitemap.xml
`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(robots);
});

module.exports = router;
