# Security Policy

At **Appointory**, security and user data privacy are foundational priorities. We take all potential security vulnerabilities seriously and appreciate the efforts of the security research community to responsibly disclose findings.

---

## Supported Versions

Only the latest release and the `main` branch receive active security updates and patches.

| Version / Branch | Supported          |
| ---------------- | ------------------ |
| `main`           | :white_check_mark: |
| < 1.0.0          | :x:                |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities via public GitHub issues, discussions, or pull requests.**

If you discover a security vulnerability in Appointory, report it through one of our private channels:

1. **Email**: Send detailed findings to **[security@appointory.in](mailto:security@appointory.in)**.
   - Use the subject line: `[SECURITY] Vulnerability Report - <Brief Summary>`
2. **Contact Page**: You may also reach our team via [appointory.in/contact](https://appointory.in/contact).
3. **Security Policy Manifest**: [https://appointory.in/.well-known/security.txt](https://appointory.in/.well-known/security.txt)

### What to Include in Your Report

To help us investigate and reproduce the issue quickly, include:
- A description of the vulnerability, potential impact, and affected component(s) (e.g., backend API, auth middleware, frontend, queue system).
- Detailed step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
- Any prerequisites, configurations, or specific roles required to trigger the issue.
- Recommended mitigation or remediation steps, if known.

---

## Vulnerability Handling & Response Process

When we receive a vulnerability report:

1. **Acknowledgment**: We aim to acknowledge receipt of your report within **24–48 hours**.
2. **Assessment & Verification**: Our engineering team will review, reproduce, and determine severity based on CVSS scoring.
3. **Fix Development**: A fix will be developed and tested in a private branch or environment.
4. **Release & Disclosure**: We will publish a patch as quickly as possible. Once resolved, we will notify you and credit your responsible disclosure (if desired).

---

## Responsible Disclosure & Safe Harbor

We consider security research conducted under the following terms to be authorized:

- **Do Not Exploit**: Do not access, modify, delete, or exfiltrate real patient, clinic, or system data.
- **Do Not Disrupt**: Avoid denial-of-service (DoS/DDoS) attacks, brute-force spamming, or disruption of production services.
- **Privacy & Compliance**: Respect data privacy regulations (including India's Digital Personal Data Protection Act - DPDP 2023).
- **Coordinate Disclosure**: Allow our team reasonable time to remediate the vulnerability before publicly disclosing details.

---

Thank you for helping keep Appointory and our healthcare partners safe and secure!
