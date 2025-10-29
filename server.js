const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
// Temporary import endpoint - DELETE AFTER FIRST USE
app.get('/admin/import-catalog', async (req, res) => {
  // Simple password protection
  if (req.query.password !== 'winning2024') {
    return res.status(403).send('Access denied');
  }
  
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked'
  });
  
  res.write('🚀 CATALOG IMPORT STARTING...\n');
  res.write('═══════════════════════════════════════\n\n');
  
  // Capture console output and send to browser
  const originalLog = console.log;
  const originalError = console.error;
  
  console.log = (...args) => {
    const message = args.join(' ') + '\n';
    res.write(message);
    originalLog(...args);
  };
  
  console.error = (...args) => {
    const message = '❌ ' + args.join(' ') + '\n';
    res.write(message);
    originalError(...args);
  };
  
  try {
    // Import the function
    const { importCatalog } = require('./import-catalog');
    await importCatalog();
    
    res.write('\n\n✨ SUCCESS! Import completed.\n');
    res.write('You can now close this window.\n');
    res.end();
    
  } catch (error) {
    res.write(`\n\n💥 ERROR: ${error.message}\n`);
    res.write(error.stack);
    res.end();
  } finally {
    // Restore console
    console.log = originalLog;
    console.error = originalError;
  }
});
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// DATABASE CONNECTION
// ============================================
let pool;

async function initDatabase() {
  const config = {
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT || 3306,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    waitForConnections: true,
    connectionLimit: 10
  };

  pool = mysql.createPool(config);
  console.log('✅ Database connected');

  await createTables();
}

async function createTables() {
  const createRequestsTable = `
    CREATE TABLE IF NOT EXISTS service_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      si_number VARCHAR(50) UNIQUE NOT NULL,
      customer_name VARCHAR(255),
      customer_email VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(50),
      customer_address TEXT,
      sku VARCHAR(100) NOT NULL,
      shipment_date VARCHAR(50),
      assigned_user_email VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'waiting_customer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_si_number (si_number),
      INDEX idx_customer_email (customer_email)
    )
  `;

  const createResponsesTable = `
    CREATE TABLE IF NOT EXISTS customer_responses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_request_id INT NOT NULL,
      serial_number VARCHAR(100),
      problem_description TEXT,
      warranty_status VARCHAR(50),
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_request_id) REFERENCES service_requests(id)
    )
  `;

  try {
    await pool.query(createRequestsTable);
    await pool.query(createResponsesTable);
    console.log('✅ Tables created/verified');
  } catch (error) {
    console.error('❌ Table creation error:', error);
  }
}

// ============================================
// EMAIL CONFIGURATION
// ============================================
let emailTransporter;

function initEmail() {
  emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
  console.log('✅ Email configured');
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Winning Service Automation',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ============================================
// SIMPLE REPLY FORM
// ============================================
app.get('/reply-form', (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Process Customer Reply</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    textarea { width: 100%; height: 300px; padding: 10px; font-family: monospace; font-size: 14px; border: 1px solid #ccc; border-radius: 5px; }
    button { background: #4CAF50; color: white; padding: 15px 30px; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; margin-top: 10px; }
    button:hover { background: #45a049; }
    .result { margin-top: 20px; padding: 15px; border-radius: 5px; display: none; }
    .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
  </style>
</head>
<body>
  <h1>📧 Process Customer Reply</h1>
  <p><strong>Instructions:</strong> When a customer replies to your email, copy the entire email content and paste it below.</p>
  
  <textarea id="emailContent" placeholder="Paste the customer's full email reply here (including From: line if possible)..."></textarea>
  
  <button onclick="processReply()">Process Reply</button>
  
  <div id="result" class="result"></div>
  
  <script>
    async function processReply() {
      const content = document.getElementById('emailContent').value;
      const result = document.getElementById('result');
      
      if (!content.trim()) {
        result.className = 'result error';
        result.style.display = 'block';
        result.innerHTML = '❌ Please paste email content';
        return;
      }
      
      result.innerHTML = '⏳ Processing...';
      result.className = 'result';
      result.style.display = 'block';
      
      try {
        const response = await fetch('/api/process-email-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailContent: content })
        });
        
        const data = await response.json();
        
        if (data.success) {
          result.className = 'result success';
          result.innerHTML = '✅ <strong>Success!</strong> Service options have been emailed to you.<br><br>' + 
                            '<strong>Request:</strong> ' + data.siNumber + '<br>' +
                            '<strong>Customer:</strong> ' + data.customerEmail + '<br>' +
                            '<strong>Service options found:</strong> ' + data.optionsCount;
        } else {
          result.className = 'result error';
          result.innerHTML = '❌ <strong>Error:</strong> ' + (data.error || 'Unknown error');
        }
      } catch (error) {
        result.className = 'result error';
        result.innerHTML = '❌ <strong>Error:</strong> ' + error.message;
      }
    }
  </script>
</body>
</html>
  `;
  res.send(html);
});

app.post('/api/process-email-content', async (req, res) => {
  console.log('📧 Processing manual email reply');
  
  try {
    const { emailContent } = req.body;
    
    if (!emailContent) {
      return res.status(400).json({ error: 'No email content provided' });
    }
    
    // Extract customer email from "From:" line or look for email patterns
    const fromMatch = emailContent.match(/From:.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    let customerEmail = fromMatch ? fromMatch[1] : null;
    
    // Fallback: find any email in the content
    if (!customerEmail) {
      const emailMatch = emailContent.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      customerEmail = emailMatch ? emailMatch[1] : null;
    }
    
    if (!customerEmail) {
      return res.status(400).json({ error: 'Could not find customer email address in the content' });
    }
    
    // Extract serial number
    const serialMatch = emailContent.match(/serial\s*(?:number)?[\s:]*([A-Z0-9\-]+)/i);
    const serialNumber = serialMatch ? serialMatch[1] : 'Not provided';
    
    // Extract warranty status
    const warrantyYes = /warranty[\s:]*yes/i.test(emailContent);
    const warrantyNo = /warranty[\s:]*no/i.test(emailContent);
    const warrantyStatus = warrantyYes ? 'In Warranty' : (warrantyNo ? 'Out of Warranty' : 'Unknown');
    
    // Extract problem description
    let problemDescription = '';
    const problemMatch = emailContent.match(/(?:problem|issue|description)[\s:]*(.+?)(?:\n\n|\nserial|\nwarranty|$)/is);
    if (problemMatch) {
      problemDescription = problemMatch[1].trim();
    } else {
      // Fallback: try to get main content
      const lines = emailContent.split('\n').filter(l => l.trim() && !l.match(/^(from|to|subject|date):/i));
      if (lines.length > 0) {
        problemDescription = lines.slice(0, 3).join(' ').trim();
      }
    }
    
    if (!problemDescription) {
      problemDescription = 'See customer email for details';
    }
    
    // Find the service request
    const [requests] = await pool.query(
      'SELECT * FROM service_requests WHERE customer_email = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      [customerEmail, 'waiting_customer']
    );
    
    if (requests.length === 0) {
      return res.status(404).json({ 
        error: `No pending service request found for ${customerEmail}. Make sure a request was created first.` 
      });
    }
    
    const request = requests[0];
    
    // Save response
    await pool.query(
      'INSERT INTO customer_responses (service_request_id, serial_number, problem_description, warranty_status) VALUES (?, ?, ?, ?)',
      [request.id, serialNumber, problemDescription, warrantyStatus]
    );
    
    console.log(`✅ Saved customer response for ${request.si_number}`);
    
    // Get service options
    const serviceOptions = await getServiceOptionsFromSheet(request.sku, warrantyStatus);
    
    console.log(`📋 Found ${serviceOptions.length} service options`);
    
    // Send email with options
    await sendServiceOptionsEmail({
      request,
      serialNumber,
      problemDescription,
      warrantyStatus,
      serviceOptions
    });
    
    // Update status
    await pool.query('UPDATE service_requests SET status = ? WHERE id = ?', ['options_sent', request.id]);
    
    res.json({
      success: true,
      siNumber: request.si_number,
      customerEmail: customerEmail,
      optionsCount: serviceOptions.length
    });
    
  } catch (error) {
    console.error('❌ Error processing email:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ENDPOINT 1: CREATE SERVICE REQUEST
// ============================================
app.post('/api/service-request', async (req, res) => {
  console.log('📥 Received service request');
  
  try {
    const { pageText, url, sku, assignedUserEmail } = req.body;

    if (!pageText || !sku || !assignedUserEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['pageText', 'sku', 'assignedUserEmail']
      });
    }

    const customerData = extractCustomerData(pageText);

    if (!customerData.siNumber || !customerData.email) {
      return res.status(400).json({
        error: 'Could not extract required customer data',
        extracted: customerData
      });
    }

    const [result] = await pool.query(
      `INSERT INTO service_requests 
       (si_number, customer_name, customer_email, customer_phone, 
        customer_address, sku, shipment_date, assigned_user_email, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting_customer')
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
      [
        customerData.siNumber,
        customerData.name,
        customerData.email,
        customerData.phone,
        customerData.address,
        sku,
        customerData.shipmentDate,
        assignedUserEmail
      ]
    );

    console.log(`✅ Saved request ${customerData.siNumber}`);

    await sendStaffNotification({
      assignedUserEmail,
      customerData,
      sku,
      url: url || 'N/A'
    });

    res.json({
      success: true,
      message: 'Service request created',
      siNumber: customerData.siNumber
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function extractCustomerData(pageText) {
  const extractValue = (label) => {
    const regex = new RegExp(`${label}\\s*[:]*\\s*([^\\n]+)`, 'i');
    const match = pageText.match(regex);
    return match ? match[1].trim() : '';
  };

  const address = [
    extractValue('Sell-to Address'),
    extractValue('Sell-to Address 2'),
    extractValue('Sell-to City'),
    extractValue('Sell-to State'),
    extractValue('Sell-to Post Code')
  ].filter(Boolean).join(', ');

  return {
    name: extractValue('Sell-to Customer Name'),
    email: extractValue('Sell-to Email'),
    phone: extractValue('Sell-to Mobile Phone No.'),
    address: address,
    siNumber: pageText.match(/SI\d{8}/)?.[0] || '',
    shipmentDate: extractValue('Shipment Date')
  };
}

async function getServiceOptionsFromSheet(sku, warrantyStatus) {
  const SHEET_ID = '16BTtqfZYo0X5c2uPkWLaNC2dSpvkJulFjCk2z3Cms4U';
  const SHEET_NAME = 'Service Options';

  try {
    // Use public CSV export (works for public sheets without API key)
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
    const response = await axios.get(url);
    
    // Parse CSV
    const lines = response.data.split('\n');
    if (lines.length === 0) return [];

    // Parse header row (remove quotes)
    const headerLine = lines[0];
    const headers = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < headerLine.length; i++) {
      const char = headerLine[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        headers.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    headers.push(current.trim());
    
    const manufacturer = identifyManufacturer(sku);
    const productType = identifyProductType(sku);

    console.log(`Looking for: ${manufacturer} / ${productType} / ${warrantyStatus}`);

    const matches = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Parse CSV line with proper quote handling
      const values = [];
      let currentValue = '';
      let insideQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
          values.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim());
      
      // Create object
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      
      // Check if matches
      if (row['Manufacturer'] === manufacturer &&
          row['Product Type'] === productType &&
          row['Warranty Status'] === warrantyStatus) {
        matches.push(row);
      }
    }

    console.log(`Found ${matches.length} matching options`);
    return matches;

  } catch (error) {
    console.error('Error reading Google Sheet:', error.message);
    return [];
  }
}

function identifyManufacturer(sku) {
  if (!sku) return 'Unknown';
  
  if (sku.match(/^[BC]\d/)) return 'Neff';
  if (sku.match(/^[HKGCM]\d/)) return 'Miele';
  if (sku.match(/^(DW|RB|WH|WM)/)) return 'Fisher & Paykel';
  if (sku.match(/^(SA|STA|FAB)/)) return 'Smeg';
  
  return 'Unknown';
}

function identifyProductType(sku) {
  if (!sku) return 'Appliance';
  
  if (sku.includes('DW')) return 'Dishwasher';
  if (sku.match(/^[BH]\d/) || sku.includes('OV')) return 'Oven';
  if (sku.includes('WM') || sku.includes('WH')) return 'Washing Machine';
  if (sku.includes('RB') || sku.includes('RS')) return 'Refrigerator';
  if (sku.includes('CT') || sku.includes('KM')) return 'Cooktop';
  
  return 'Appliance';
}

async function sendStaffNotification(data) {
  const emailBody = `Hi,

A new service request has been created for:
- Customer: ${data.customerData.name}
- Invoice: ${data.customerData.siNumber}
- Product: ${data.sku}

📋 Customer Details:
- Email: ${data.customerData.email}
- Phone: ${data.customerData.phone}
- Address: ${data.customerData.address}
- Purchase Date: ${data.customerData.shipmentDate}

---

✉️ COPY & PASTE - Email to Customer

---COPY FROM HERE---

Subject: Service Request - ${data.sku} - Invoice ${data.customerData.siNumber}

Hi ${data.customerData.name},

Thank you for contacting us about your appliance service request.

We have your purchase details on file (Invoice ${data.customerData.siNumber}, purchased ${data.customerData.shipmentDate}).

To help us arrange the best service for you, please reply to this email with:

- Serial number (found on your appliance)
- Description of the problem you're experiencing
- Do you believe your product is under warranty? (Yes/No)
- Photos (optional - if you believe they will assist us)

Once we receive this information, we'll respond with your service options.

Best regards,
Winning Appliances Service Team

---COPY TO HERE---

View invoice: ${data.url}
  `;

  try {
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: data.assignedUserEmail,
      subject: `📋 Service Request Ready - ${data.customerData.name} - ${data.customerData.siNumber}`,
      text: emailBody
    });
    console.log(`✅ Email sent to ${data.assignedUserEmail}`);
  } catch (error) {
    console.error('❌ Email error:', error.message);
  }
}

async function sendServiceOptionsEmail(data) {
  const { request, serialNumber, problemDescription, warrantyStatus, serviceOptions } = data;

  let optionsText = '';
  if (serviceOptions.length === 0) {
    optionsText = '⚠️ No service options found in database for this product/warranty combination.\n\n';
  } else {
    serviceOptions.forEach((option, index) => {
      optionsText += `
Option ${index + 1}: ${option['Service Agent'] || 'N/A'}

📞 Contact: ${option['Phone Number'] || 'N/A'} ${option['Business Hours'] ? `(${option['Business Hours']})` : ''}
💰 Cost: ${option['Service Call Fee'] || 'N/A'}
⏱️ Response Time: ${option['Expected Timeframe'] || 'N/A'}

${option['Phone Instructions'] || 'Contact service agent for booking'}

---
      `;
    });
  }

  const emailBody = `Hi,

🎉 ${request.customer_name} replied with appliance details!

📋 Customer Details:
- Name: ${request.customer_name}
- Email: ${request.customer_email}
- Phone: ${request.customer_phone}

🛒 Purchase Info:
- Invoice: ${request.si_number}
- SKU: ${request.sku}
- Purchase Date: ${request.shipment_date}

🔧 Appliance Details:
- Serial: ${serialNumber}
- Warranty: ${warrantyStatus}
- Problem: ${problemDescription}

---

🛠️ SERVICE OPTIONS:

${optionsText}

Copy and send to customer.
  `;

  try {
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: request.assigned_user_email,
      subject: `⚡ Customer Replied - ${request.customer_name} - Service Options Ready`,
      text: emailBody
    });
    console.log(`✅ Service options sent to ${request.assigned_user_email}`);
  } catch (error) {
    console.error('❌ Email error:', error.message);
  }
}

// ============================================
// START SERVER
// ============================================
async function startServer() {
  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    initEmail();
    await initDatabase();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Health check: http://localhost:${PORT}/health`);
      console.log(`📍 Reply form: http://localhost:${PORT}/reply-form`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
