// Trigger one immediate digest email.
const { runDigestNow } = require('./dist/server/services/weeklyDigestService');
runDigestNow()
  .then((sent) => {
    console.log('DIGEST_SENT:', sent);
    process.exit(sent ? 0 : 2);
  })
  .catch((err) => {
    console.error('DIGEST_ERROR:', err && err.stack || err);
    process.exit(1);
  });
