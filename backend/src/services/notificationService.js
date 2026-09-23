const { google } = require('googleapis');
const db = require('../db');

/**
 * Safely masks email address for production logging (e.g. yashascr251@gmail.com -> y***1@gmail.com)
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return 'unknown';
  const [name, domain] = email.split('@');
  if (name.length <= 2) return `${name.charAt(0)}***@${domain}`;
  return `${name.charAt(0)}***${name.charAt(name.length - 1)}@${domain}`;
}

/**
 * Creates an authenticated Gmail API client using OAuth 2.0 refresh token.
 */
function getGmailClient() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/["'\s]/g, '');
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').replace(/["'\s]/g, '');
  const redirectUri = (process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback').replace(/["'\s]/g, '');
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || '').replace(/["'\s]/g, '');

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Constructs a MIME/RFC 2822 formatted email string and encodes it as base64url.
 */
function createMimeMessage({ from, to, subject, text, html }) {
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="cloudpulse_boundary"`,
    ``,
    `--cloudpulse_boundary`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    text || '',
    ``,
    `--cloudpulse_boundary`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html || text || '',
    ``,
    `--cloudpulse_boundary--`
  ];

  const mimeString = messageParts.join('\r\n');
  return Buffer.from(mimeString)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Unified, safe notification dispatch function using Gmail API OAuth 2.0.
 * Always constructs subject and body in outer scope before attempting API call.
 */
async function sendNotification({ recipientEmail, vmName, action, status, cpuAverage, reason, timestamp }) {
  if (!recipientEmail) {
    console.log(`[NOTIFICATION] Skipped: No recipient email address provided for VM '${vmName}'.`);
    return { success: false, reason: 'NO_RECIPIENT' };
  }

  const senderEmail = (process.env.GMAIL_SENDER_EMAIL || 'cloudpulse.project@gmail.com').replace(/["'\s]/g, '');
  const gmail = getGmailClient();

  if (!gmail) {
    console.log('[NOTIFICATION] Skipped: Gmail API OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) unconfigured.');
    return { success: false, reason: 'GMAIL_API_UNCONFIGURED' };
  }

  // 1. Explicit Subject Construction (Guaranteed in Scope)
  const actionTitle = action === 'START' ? 'VM Start' : 'VM Deallocation';
  const subject = `[CloudPulse Alert] Azure ${actionTitle} ${status}: ${vmName}`;

  // 2. Explicit Body Construction
  const cpuStr = cpuAverage !== null && cpuAverage !== undefined ? `${cpuAverage}%` : 'N/A';
  const formattedTime = timestamp ? new Date(timestamp).toUTCString() : new Date().toUTCString();

  const textContent = [
    `CloudPulse Azure Optimization Alert`,
    `========================================`,
    `Target VM: ${vmName}`,
    `Action: ${action}`,
    `Status: ${status}`,
    `CPU Average: ${cpuStr}`,
    `Reason: ${reason || 'N/A'}`,
    `Timestamp: ${formattedTime}`,
    `========================================`
  ].join('\n');

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #0f172a; margin-top: 0;">CloudPulse Azure Optimization Alert</h2>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
      <table style="width: 100%; border-collapse: collapse; text-align: left;">
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Target VM:</td><td style="padding: 8px 0; color: #0f172a;">${vmName}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Action:</td><td style="padding: 8px 0; color: #0f172a;">${action}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Status:</td><td style="padding: 8px 0; color: ${status === 'SUCCESS' ? '#16a34a' : '#dc2626'}; font-weight: bold;">${status}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">CPU Average:</td><td style="padding: 8px 0; color: #0f172a;">${cpuStr}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Reason:</td><td style="padding: 8px 0; color: #0f172a;">${reason || 'N/A'}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Timestamp:</td><td style="padding: 8px 0; color: #0f172a;">${formattedTime}</td></tr>
      </table>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">This email was sent automatically by CloudPulse SaaS Azure Optimization Service.</p>
    </div>
  `;

  const fromHeader = `CloudPulse <${senderEmail}>`;
  const encodedMessage = createMimeMessage({
    from: fromHeader,
    to: recipientEmail,
    subject,
    text: textContent,
    html: htmlContent
  });

  const maskedRecipient = maskEmail(recipientEmail);
  console.log(`[NOTIFICATION] Preparing notification | VM: ${vmName} | Action: ${action} | Status: ${status} | Recipient: ${maskedRecipient}`);

  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    console.log(`[NOTIFICATION] Gmail API send succeeded | VM: ${vmName} | MessageId: ${response.data.id}`);
    return { success: true, messageId: response.data.id };
  } catch (err) {
    console.error(`[NOTIFICATION] Gmail API send failed | VM: ${vmName} | Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function sendDeallocationNotification(actionRecord) {
  // Only dispatch email for SUCCESS or FAILED action outcomes
  const isSuccess = actionRecord.status === 'SUCCESS';
  const isFailure = actionRecord.status === 'FAILED';
  if (!isSuccess && !isFailure) {
    return;
  }

  // Check user notification preferences if userId is present
  if (actionRecord.userId) {
    try {
      const prefRes = await db.query(
        `SELECT deallocation_notifications FROM user_notification_preferences WHERE user_id = $1`,
        [actionRecord.userId]
      );
      if (prefRes.rows.length > 0 && prefRes.rows[0].deallocation_notifications === false) {
        console.log(`[NOTIFICATION] Skipped: User '${actionRecord.userId}' has disabled deallocation notifications.`);
        return;
      }
    } catch (prefErr) {
      console.error('[NOTIFICATION] Error checking user notification preferences:', prefErr.message);
    }
  }

  let recipientEmail = actionRecord.recipientEmail || actionRecord.userEmail || null;

  // Resolve customer email securely from database if not attached
  if (!recipientEmail && actionRecord.userId) {
    try {
      const userRes = await db.query(
        `SELECT email FROM users WHERE id = $1 AND status = 'ACTIVE'`,
        [actionRecord.userId]
      );
      if (userRes.rows.length > 0) {
        recipientEmail = userRes.rows[0].email;
      }
    } catch (dbErr) {
      console.error('[NOTIFICATION] Error resolving customer email from database:', dbErr.message);
    }
  }

  if (!recipientEmail) {
    console.log(`[NOTIFICATION] Skipped: Customer recipient email could not be resolved for VM '${actionRecord.vmName}'.`);
    return;
  }

  await sendNotification({
    recipientEmail,
    vmName: actionRecord.vmName,
    action: actionRecord.action || 'DEALLOCATE',
    status: actionRecord.status,
    cpuAverage: actionRecord.cpuAverage,
    reason: actionRecord.reason,
    timestamp: actionRecord.timestamp
  });
}

/**
 * Sends a budget threshold alert notification via Gmail API.
 */
async function sendBudgetAlertNotification({ recipientEmail, budgetName, subscriptionId, resourceGroup, currentSpend, budgetLimit, thresholdPct, currency = 'USD' }) {
  if (!recipientEmail) return { success: false, reason: 'NO_RECIPIENT' };

  const senderEmail = (process.env.GMAIL_SENDER_EMAIL || 'cloudpulse.project@gmail.com').replace(/["'\s]/g, '');
  const gmail = getGmailClient();
  if (!gmail) {
    console.log('[NOTIFICATION] Skipped budget alert: Gmail API unconfigured.');
    return { success: false, reason: 'GMAIL_API_UNCONFIGURED' };
  }

  const subject = `[CloudPulse Alert] Budget Threshold Exceeded: ${budgetName} (${thresholdPct}%)`;
  const textContent = [
    `CloudPulse Budget Alert`,
    `========================================`,
    `Budget Name: ${budgetName}`,
    `Subscription: ${subscriptionId}`,
    resourceGroup ? `Resource Group: ${resourceGroup}` : '',
    `Current Month Spend: ${currency} ${currentSpend}`,
    `Configured Budget Limit: ${currency} ${budgetLimit}`,
    `Threshold Crossed: ${thresholdPct}%`,
    `Timestamp: ${new Date().toUTCString()}`,
    `========================================`
  ].filter(Boolean).join('\n');

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #e11d48; margin-top: 0;">CloudPulse Budget Alert</h2>
      <p style="font-size: 15px; color: #334155;">A configured budget threshold has been exceeded for your account.</p>
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <p style="margin: 6px 0;"><strong>Budget:</strong> ${budgetName}</p>
        <p style="margin: 6px 0;"><strong>Subscription:</strong> ${subscriptionId}</p>
        ${resourceGroup ? `<p style="margin: 6px 0;"><strong>Resource Group:</strong> ${resourceGroup}</p>` : ''}
        <p style="margin: 6px 0;"><strong>Current Spend:</strong> ${currency} ${currentSpend}</p>
        <p style="margin: 6px 0;"><strong>Budget Limit:</strong> ${currency} ${budgetLimit}</p>
        <p style="margin: 6px 0; color: #e11d48; font-weight: bold;"><strong>Threshold Crossed:</strong> ${thresholdPct}%</p>
      </div>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">Sent automatically by CloudPulse Cloud Governance Platform.</p>
    </div>
  `;

  try {
    const rawMessage = createMimeMessage({
      from: senderEmail,
      to: recipientEmail,
      subject,
      text: textContent,
      html: htmlContent
    });

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: rawMessage }
    });

    console.log(`[NOTIFICATION] Budget alert dispatched successfully to ${maskEmail(recipientEmail)} | Message ID: ${response.data.id}`);
    return { success: true, messageId: response.data.id };
  } catch (error) {
    console.error(`[NOTIFICATION] Failed to send budget alert to ${maskEmail(recipientEmail)}:`, error.message);
    return { success: false, error: error.message };
  }
}

function verifyGmailConfiguration() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/["'\s]/g, '');
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').replace(/["'\s]/g, '');
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || '').replace(/["'\s]/g, '');
  const sender = (process.env.GMAIL_SENDER_EMAIL || 'cloudpulse.project@gmail.com').replace(/["'\s]/g, '');

  if (!clientId || !clientSecret || !refreshToken) {
    console.log('[STARTUP-DIAGNOSTICS] Gmail API configuration incomplete | Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN');
    return;
  }

  console.log(`[STARTUP-DIAGNOSTICS] Gmail API configuration initialized | Client ID: configured | Refresh token: configured | Sender: ${sender}`);
}

module.exports = {
  maskEmail,
  getGmailClient,
  createMimeMessage,
  sendNotification,
  sendDeallocationNotification,
  sendBudgetAlertNotification,
  verifyGmailConfiguration
};
