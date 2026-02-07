var https = require('https');

var apiKey = process.env.MAILERSEND_API_KEY;
var fromEmail = process.env.MAILERSEND_FROM_EMAIL || 'noreply@stratusweather.co.za';

var html = [
  '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:12px;border:1px solid #e2e8f0">',
  '<h2 style="color:#22c55e;margin:0 0 16px 0">&#9989; Email Alerts Working!</h2>',
  '<p style="color:#4b5563;margin:0 0 12px 0">Your Stratus Weather Server alarm email alerts are correctly configured.</p>',
  '<p style="color:#4b5563;margin:0 0 12px 0">When alarm thresholds are breached, all designated admin users will receive email notifications automatically.</p>',
  '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">',
  '<p style="color:#9ca3af;font-size:12px;margin:0">Sent at: ' + new Date().toISOString() + '</p>',
  '</div>'
].join('');

var payload = JSON.stringify({
  from: { email: fromEmail, name: 'Stratus Weather' },
  to: [{ email: 'esterhuizen2k@proton.me' }],
  subject: 'Stratus Weather - Email Alert Test',
  html: html
});

var options = {
  hostname: 'api.mailersend.com',
  port: 443,
  path: '/v1/email',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

var req = https.request(options, function(res) {
  var body = '';
  res.on('data', function(d) { body += d; });
  res.on('end', function() {
    console.log('Status:', res.statusCode);
    if (res.statusCode === 202) {
      console.log('SUCCESS: Test email sent to esterhuizen2k@proton.me');
    } else {
      console.log('Response:', body);
    }
    process.exit(0);
  });
});
req.on('error', function(e) { console.error('Error:', e.message); process.exit(1); });
req.write(payload);
req.end();
