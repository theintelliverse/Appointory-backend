/**
 * Zero-dependency NoSQL Injection Defense Middleware
 * Recursively strips keys beginning with '$' or containing '.' from req.body, req.query, and req.params
 * to prevent MongoDB operator injection ($ne, $gt, $where, $regex, etc.)
 */
const sanitizeMongo = (req, res, next) => {
    const clean = (target) => {
        if (!target || typeof target !== 'object') return;
        for (const key of Object.keys(target)) {
            if (key.startsWith('$') || key.includes('.')) {
                delete target[key];
            } else if (typeof target[key] === 'object' && target[key] !== null) {
                clean(target[key]);
            }
        }
    };

    if (req.body) clean(req.body);
    if (req.query) clean(req.query);
    if (req.params) clean(req.params);

    next();
};

module.exports = sanitizeMongo;
