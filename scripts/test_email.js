const k = process.env.MAILERSEND_API_KEY;
const e = process.env.MAILERSEND_FROM_EMAIL;
console.log('MAILERSEND_API_KEY exists:', !!k);
console.log('MAILERSEND_FROM_EMAIL exists:', !!e);
console.log('isEmailConfigured:', !!k && !!e);
console.log('MAILERSEND_API_KEY length:', k ? k.length : 0);
console.log('MAILERSEND_FROM_EMAIL value:', e);
