const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');

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
// ENDPOINT 2: CUSTOMER REPLY
// ============================================
app.post('/api/customer-reply', async (req, res) => {
  console.log('📧 Processing customer reply');

  try {
    const { customerEmail, serialNumber, problemDescription, warrantyStatus } = req.body;

    const [requests] = await pool.query(
      'SELECT * FROM service_requests WHERE customer_email = ? AND status = ? LIMIT 1',
      [customerEmail, 'waiting_customer']
    );

    if (requests.length === 0) {
      return res.status(404).json({ error: 'No pending service request found' });
    }

    const request = requests[0];

    await pool.query(
      `INSERT INTO customer_responses 
       (service_request_id, serial_number, problem_description, warranty_status)
       VALUES (?, ?, ?, ?)`,
      [request.id, serialNumber, problemDescription, warrantyStatus]
    );

    const serviceOptions = await getServiceOptionsFromSheet(request.sku, warrantyStatus);

    await sendServiceOptionsEmail({
      request,
      serialNumber,
      problemDescription,
      warrantyStatus,
      serviceOptions
    });

    await pool.query(
      'UPDATE service_requests SET status = ? WHERE id = ?',
      ['options_sent', request.id]
    );

    res.json({
      success: true,
      message: 'Reply processed',
      optionsFound: serviceOptions.length
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ error: error.message });
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
  const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

  if (!API_KEY) {
    console.warn('⚠️ No Google Sheets API key configured');
    return [];
  }

  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_NAME}?key=${API_KEY}`;
    const response = await axios.get(url);
    
    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];

    const headers = rows[0];
    const manufacturer = identifyManufacturer(sku);
    const productType = identifyProductType(sku);

    const matches = rows.slice(1)
      .filter(row => {
        return row[0] === manufacturer &&
               row[1] === productType &&
               row[2] === warrantyStatus;
      })
      .map(row => {
        const obj = {};
        headers.forEach((header, i) => {
          obj[header] = row[i] || '';
        });
        return obj;
      });

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
      from: process.env.SMTP_FROM || '"Winning Service" <service@winning.com.au>',
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
      from: process.env.SMTP_FROM || '"Winning Service" <service@winning.com.au>',
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
      console.log(`📍 API endpoint: http://localhost:${PORT}/api/service-request`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
