# Security Policy

## Developer Information

- **Developer:** Lukas Esterhuizen
- **Contact:** esterhuizen2k@proton.me

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Security Standards Compliance

This application is designed to comply with:

- **OWASP Top 10** - Web Application Security Guidelines
- **ISO/IEC 27001** - Information Security Management
- **Microsoft Windows Security Requirements** - Desktop Application Standards
- **Electron Security Best Practices** - Framework-specific guidelines

## Security Features

### Authentication

- **Password Hashing:** 
  - Server-side: bcrypt with 10 salt rounds
  - Client-side: PBKDF2 (SHA-256, 100,000 iterations) via Web Crypto API
- **Authentication Mode:** Configurable via `REQUIRE_AUTH` environment variable
  - Desktop mode (default): Auto-authenticated for local single-user operation
  - Network mode (`REQUIRE_AUTH=true`): Full authentication required
- **Session Management:** JWT tokens with configurable expiration
- **Rate Limiting:** Protection against brute force attacks (5 attempts per 15 minutes)
- **Input Validation:** All user inputs are validated and sanitized
- **Legacy Migration:** Automatic upgrade of legacy password hashes on first login

### Data Protection

- **Local Storage:** SQLite database with application-level encryption support
- **API Communications:** HTTPS enforced for external connections
- **Sensitive Data:** No passwords or secrets logged
- **User Data:** Preserved on uninstall (user choice)

### Code Integrity

- **Dependency Auditing:** Regular `npm audit` checks
- **Code Signing:** Prepared for certificate signing (see below)
- **ASAR Packaging:** Disabled for transparency (configurable)

### Network Security

- **PakBus Protocol:** Secure communication with Campbell Scientific dataloggers
- **CORS Configuration:** Properly configured for API endpoints
- **WebSocket Security:** Secure WebSocket connections for real-time data
- **API Authentication:** All sensitive endpoints protected with `isAuthenticated` middleware

## Network Deployment Warning

**⚠️ CRITICAL:** When deploying Stratus to Oracle Cloud or any network-accessible environment:

1. Set `REQUIRE_AUTH=true` in your `.env` file
2. Use HTTPS (configure Nginx with SSL certificates)
3. Set a strong `CLIENT_JWT_SECRET`
4. Configure firewall rules to limit access

```env
# Required for network deployments
REQUIRE_AUTH=true
CLIENT_JWT_SECRET=your_secure_random_64_char_secret
NODE_ENV=production
```

## Code Signing Status

### Current Status: Pending

The application is prepared for code signing but currently distributed unsigned.

**Windows SmartScreen:** Users may see a warning when running the unsigned installer. This is normal for unsigned applications.

### Future Code Signing

When a code signing certificate is obtained:

1. Certificate will be from a trusted CA (DigiCert, Sectigo, GlobalSign)
2. All executables will be signed
3. Installer will be signed
4. Windows SmartScreen warnings will be eliminated

## Reporting Security Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **DO NOT** open a public GitHub issue
2. **Email:** esterhuizen2k@proton.me
3. **Subject:** [SECURITY] Stratus Weather Station - Brief Description
4. **Include:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (optional)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial Assessment:** Within 7 days
- **Fix Timeline:** Depends on severity
  - Critical: 24-48 hours
  - High: 7 days
  - Medium: 30 days
  - Low: Next release

## Security Best Practices for Users

### Installation

1. Download only from official sources (GitHub releases)
2. Verify file integrity using provided SHA-256 checksums
3. Review Windows SmartScreen warnings carefully
4. Install in user space when possible (no admin required)

### Configuration

1. Use strong passwords for any authentication
2. Keep the application updated
3. Review station configurations before deployment
4. Secure your network connections to dataloggers

### Data Handling

1. Regular backups of collected weather data
2. Secure storage of exported data files
3. Review data sharing configurations

## Security Audit Checklist

### Application Security
- [x] No hardcoded credentials in source code
- [x] API keys use environment variables
- [x] User passwords hashed with bcrypt (10 rounds)
- [x] JWT tokens for session management
- [x] Input validation on all forms
- [x] SQL injection prevention (parameterized queries)
- [x] XSS prevention (React's built-in escaping)
- [x] Error messages don't leak sensitive information

### Installer Security
- [x] EULA displayed and must be accepted
- [x] User can choose installation directory
- [x] No admin rights required by default
- [x] Clean uninstaller provided
- [x] User data preserved on uninstall
- [ ] Code signing (pending certificate)

### Electron Security
- [x] Context isolation enabled
- [x] Node integration disabled in renderer
- [x] Preload script for IPC
- [x] External links open in default browser
- [x] WebPreferences properly configured

## Dependencies

Security-relevant dependencies:

| Package | Purpose | Version |
|---------|---------|---------|
| bcryptjs | Password hashing | ^2.4.3 |
| jsonwebtoken | JWT tokens | ^9.0.2 |
| express-rate-limit | Rate limiting | ^8.2.1 |
| helmet | HTTP headers (if used) | Latest |

### Dependency Audit

Run regular security audits:

```bash
npm audit
npm audit fix
```

## Changelog

### 1.0.0 (January 2026)
- Initial security implementation
- bcrypt password hashing
- JWT session management
- Rate limiting
- Input validation
- Prepared for code signing

---

**Last Updated:** January 2026  
**Developer:** Lukas Esterhuizen  
**Contact:** esterhuizen2k@proton.me
